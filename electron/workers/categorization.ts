import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { once } from 'node:events';
import type { CategorizationCtx } from './types.js';
import { isRateLimitError } from './utils.js';
import { createRequire } from 'module';
import type { ChildProcess } from 'node:child_process';
const require = createRequire(import.meta.url);

type ActiveJob = {
  child?: ChildProcess;
  abortController: AbortController;
  manuallyStopped?: boolean;
};

const activeJobs = new Map<number, ActiveJob>();

export function stopCategorizationWorker(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    console.log(`Stopping categorization worker for project ${projectId}`);
    job.manuallyStopped = true;
    job.abortController.abort();
    if (job.child) {
      job.child.kill();
    }
  }
}

export async function startCategorizationWorker(ctx: CategorizationCtx, projectId: number) {
  if (activeJobs.has(projectId)) {
    console.warn(`Categorization worker for project ${projectId} is already running.`);
    return;
  }
  const abortController = new AbortController();
  activeJobs.set(projectId, { abortController, manuallyStopped: false });

  const { db, getWindow, resolvedDbPath, categoriesNameColumn } = ctx;
  const devCandidate = path.join(process.cwd(), 'worker', 'assignCategorization.cjs');
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'worker', 'assignCategorization.cjs')
    : null;
  const workerPath = fs.existsSync(devCandidate)
    ? devCandidate
    : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);
  const win = getWindow();
  const sendStoppedEvent = () => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:categorization-stopped', { projectId });
    }
  };
  const emitProgress = (stage: string, payload: Record<string, any>) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:categorization-progress', {
        projectId,
        stage,
        ...payload,
      });
    }
  };

  console.log(`Starting categorization worker for project ${projectId}`);

  try {
    // Проверяем, есть ли заданные категории для проекта (нужно минимум 2 класса для категоризации)
    try {
      const cntRow = db.prepare('SELECT COUNT(*) as cnt FROM categories WHERE project_id = ?').get(projectId);
      const categoryCount = Number((cntRow as any)?.cnt ?? 0);
      if (categoryCount < 2) {
        console.warn(`[Categorization] Not enough categories for project ${projectId}: ${categoryCount}`);
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:categorization-error', {
            projectId,
            message: 'Задайте не менее двух категорий для категоризации.',
          });
        }
        activeJobs.delete(projectId);
        return;
      }
    } catch (e) {
      console.warn('[Categorization] Failed to check categories count', e);
    }

    const categories = db.prepare(`SELECT id, project_id, ${categoriesNameColumn} AS category_name, created_at FROM categories WHERE project_id = ?`).all(projectId);
    // Clear previous categorization results for the project to avoid stale values
    try {
      db.prepare('UPDATE keywords SET category_name = NULL, category_similarity = NULL WHERE project_id = ?').run(projectId);
    } catch (e) {
      console.warn('[Categorization] Failed to clear previous category values', e);
    }
    const keywordCountRow = db
      .prepare('SELECT COUNT(*) as cnt FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1)')
      .get(projectId) as { cnt?: number } | undefined;
    let keywordsTotal = Number(keywordCountRow?.cnt ?? 0);

    if (!keywordsTotal) {
      console.warn(`Не найдены целевые ключевые слова для проекта ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          messageKey: 'keywords.noTargetKeywords',
          message: 'Не найдены целевые ключевые слова для проекта',
        });
      }
      activeJobs.delete(projectId);
      return;
    }

  // Attach embeddings (from new DB facade module)
  console.log(`Preparing embeddings for ${keywordsTotal} keywords and ${categories.length} categories...`);
  const base = process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const embeddings = require(path.join(base, 'electron', 'db', 'embeddings.cjs'));
  const attachEmbeddingsToKeywords = embeddings.attachEmbeddingsToKeywords;
  const readChunkEnv = Number(process.env.CATEGORIZATION_KEYWORD_CHUNK || 1000);
  const keywordReadChunk = Number.isFinite(readChunkEnv) && readChunkEnv > 0 ? Math.max(1, Math.floor(readChunkEnv)) : 1000;
  const keywordsStmt = db.prepare('SELECT * FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1) AND id > ? ORDER BY id LIMIT ?');

    let embeddingStats: any = { total: keywordsTotal, embedded: 0, fetched: 0, missing: keywordsTotal };
    let tmpDir: string | null = null;
    let inputPath: string | null = null;
    let writeStream: ReturnType<typeof fs.createWriteStream> | null = null;
    const avgEmbeddingSize = (categories[0] as any)?.embedding?.length || 1536;
    const estimatedSizeMB = Math.round((keywordsTotal * avgEmbeddingSize * 8) / (1024 * 1024));

    try {
      // 1. Embed categories
      emitProgress('embeddings-categories', {
        fetched: 0,
        total: categories.length,
        percent: categories.length ? 0 : 100,
      });
      await attachEmbeddingsToKeywords(categories, {
        chunkSize: 10,
        abortSignal: abortController.signal,
        onProgress: (p: any) => {
          emitProgress('embeddings-categories', {
            fetched: p.fetched,
            total: typeof p.total !== 'undefined' ? p.total : categories.length,
            percent: p.percent,
          });
        }
      });
      emitProgress('embeddings-categories', {
        fetched: categories.length,
        total: categories.length,
        percent: 100,
      });

      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'categorization-'));
      inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
      console.log(`[categorization] Writing ${keywordsTotal} keywords (~${estimatedSizeMB} MB estimated) to temp file...`);

      writeStream = fs.createWriteStream(inputPath, { encoding: 'utf8' });
      const writeChunk = async (chunk: string) => {
        if (!writeStream!.write(chunk)) {
          await once(writeStream!, 'drain');
        }
      };

      try {
        await writeChunk('{"categories":');
        await writeChunk(JSON.stringify(categories || []));
        await writeChunk(',"keywords":[');
      } catch (streamErr) {
        (streamErr as any).__writeError = true;
        throw streamErr;
      }

      emitProgress('embeddings', {
        fetched: 0,
        total: keywordsTotal,
        percent: keywordsTotal ? 0 : 100,
      });

      let processedKeywords = 0;
      let wroteAnyKeyword = false;
      let lastKeywordId = 0;
      while (processedKeywords < keywordsTotal) {
        const chunk = keywordsStmt.all(projectId, lastKeywordId, keywordReadChunk) as any[];
        if (!chunk.length) {
          break;
        }

        const chunkBaseProgress = processedKeywords;
        const chunkStats = await attachEmbeddingsToKeywords(chunk, {
          chunkSize: 10,
          abortSignal: abortController.signal,
          onProgress: (p: any) => {
            const chunkProgress = Math.min(p.fetched || 0, chunk.length);
            const globalFetched = Math.min(chunkBaseProgress + chunkProgress, keywordsTotal);
            const percent = keywordsTotal ? Math.round((globalFetched / keywordsTotal) * 100) : 100;
            emitProgress('embeddings', {
              fetched: globalFetched,
              total: keywordsTotal,
              percent,
            });
          }
        });

        embeddingStats.embedded += chunkStats?.embedded || 0;
        embeddingStats.fetched += chunkStats?.fetched || 0;

        try {
          for (const keyword of chunk) {
            if (wroteAnyKeyword) await writeChunk(',');
            await writeChunk(JSON.stringify(keyword));
            wroteAnyKeyword = true;
          }
        } catch (streamErr) {
          (streamErr as any).__writeError = true;
          throw streamErr;
        }

        processedKeywords += chunk.length;
        const tail = chunk[chunk.length - 1] as any;
        if (tail && typeof tail.id === 'number') {
          lastKeywordId = tail.id;
        }
        const percent = keywordsTotal ? Math.round((processedKeywords / keywordsTotal) * 100) : 100;
        emitProgress('embeddings', {
          fetched: processedKeywords,
          total: keywordsTotal,
          percent,
        });
      }

      if (processedKeywords < keywordsTotal) {
        console.warn(`[Categorization] Keyword count changed during processing. Expected ${keywordsTotal}, processed ${processedKeywords}.`);
        keywordsTotal = processedKeywords;
      }

      embeddingStats.total = keywordsTotal;
      embeddingStats.missing = Math.max(0, keywordsTotal - embeddingStats.embedded);

      try {
        await writeChunk(']');
        await writeChunk('}');
        writeStream.end();
        await once(writeStream, 'finish');
      } catch (streamErr) {
        (streamErr as any).__writeError = true;
        throw streamErr;
      }

      emitProgress('embeddings', {
        fetched: keywordsTotal,
        total: keywordsTotal,
        percent: keywordsTotal ? 100 : 0,
      });

      console.log(`[categorization] Successfully wrote input file: ${inputPath}`);
      console.log('Embedding stats:', embeddingStats);
    } catch (embErr: any) {
      const job = activeJobs.get(projectId);
      if (writeStream) {
        try { writeStream.destroy(); } catch (_) {}
      }
      if (tmpDir) {
        try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
      if (embErr?.message === 'Aborted' && job?.manuallyStopped) {
        activeJobs.delete(projectId);
        sendStoppedEvent();
        return;
      }
      if (embErr?.__writeError) {
        console.error('[categorization] Failed to write input file:', embErr?.message || embErr);
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:categorization-error', {
            projectId,
            message: `Не удалось подготовить данные для категоризации (примерный размер: ~${estimatedSizeMB} MB). ${embErr?.message || 'Unknown error'}`,
            status: 'WRITE_ERROR',
            debug: { keywordCount: keywordsTotal, estimatedSizeMB, error: embErr?.message }
          });
        }
      } else {
        console.error('[categorization] Failed to prepare embeddings:', embErr?.message || embErr);
        if (win && !win.isDestroyed()) {
          const rateLimited = isRateLimitError(embErr);
          win.webContents.send('keywords:categorization-error', {
            projectId,
            status: rateLimited ? 429 : undefined,
            message: rateLimited ? 'Request failed with status code 429' : 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.',
          });
        }
      }
      activeJobs.delete(projectId);
      return;
    }

    if (!embeddingStats.embedded) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.',
        });
      }
      if (tmpDir) {
        try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
      activeJobs.delete(projectId);
      return;
    }

    if (!tmpDir || !inputPath) {
      console.error('[categorization] Temporary input file missing after embedding stage.');
      activeJobs.delete(projectId);
      return;
    }

    const tmpDirResolved = tmpDir;
    const inputPathResolved = inputPath;

    let env = Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
    });

    const child = spawn(process.execPath, [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPathResolved}`], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const job = activeJobs.get(projectId);
    if (job) job.child = child;

    let processed = 0;
    child.stdout?.setEncoding('utf8');
    let stdoutBuffer = '';

    child.stdout?.on('data', (data) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        console.log(`[Categorization Worker ${projectId}]`, line);
        try {
          const obj = JSON.parse(line);
          // If worker emitted a progress update, forward it to UI
          if (obj && obj.type === 'progress') {
            const w = getWindow();
            if (w && !w.isDestroyed()) {
              const pct = obj.total && obj.total > 0 ? Math.round((obj.fetched / obj.total) * 100) : undefined;
              w.webContents.send('keywords:categorization-progress', Object.assign({ projectId, stage: obj.stage, fetched: obj.fetched, total: obj.total, percent: pct }, obj));
            }
            continue;
          }
          processed++;
          if (obj.id && obj.bestCategoryName !== undefined) {
            // Normalize similarity to 0..1 before writing (worker may return 0..1 or 0..100)
            let sim: any = obj.similarity;
            try {
                if (typeof sim === 'string') sim = sim.trim().replace('%', '');
                sim = Number(sim);
                if (!Number.isFinite(sim) || Number.isNaN(sim)) sim = null;
                else {
                  // Round to 4 decimal places before normalization to avoid
                  // floating-point artifacts (e.g. 0.010000000000000002)
                  sim = Number(sim.toFixed(4));
                  // Special-case: treat 0.01 (artifact) as exact match => 1
                  if (sim === 0.01) sim = 1;
                  if (sim > 1 && sim <= 100) sim = sim / 100;
                  sim = Math.max(0, Math.min(1, sim));
                }
            } catch (_) {
              sim = null;
            }

            db.prepare('UPDATE keywords SET category_name = ?, category_similarity = ? WHERE id = ?')
              .run(obj.bestCategoryName, sim, obj.id);
            try {
              const updated = db.prepare('SELECT * FROM keywords WHERE id = ?').get(obj.id);
              const w = getWindow();
              if (updated && w && !w.isDestroyed()) {
                w.webContents.send('keywords:updated', { projectId, keyword: updated });
              }
            } catch (e) {
              console.warn('[Main] Failed to notify renderer about keywords:updated for categorization', e);
            }
          }
          const progress = keywordsTotal ? Math.round((processed / keywordsTotal) * 100) : 100;
          const w = getWindow();
          if (w && !w.isDestroyed()) {
            w.webContents.send('keywords:categorization-progress', { 
              projectId, 
              progress, 
              percent: progress,
              processed,
              total: keywordsTotal,
              stage: 'categorization'
            });
          }
        } catch (e) {
          if (line.includes('progress:')) {
            const match = line.match(/progress: (\d+)/);
            const w = getWindow();
            if (match && w && !w.isDestroyed()) {
              w.webContents.send('keywords:categorization-progress', { projectId, progress: parseInt(match[1]) });
            }
          }
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data) => {
      console.error(`[Categorization Worker ${projectId} ERROR]`, data.toString().trim());
    });

    child.on('exit', async (code, signal) => {
      const jobState = activeJobs.get(projectId);
      const manuallyStopped = jobState?.manuallyStopped;
      activeJobs.delete(projectId);
      console.log(`Categorization worker exited with code ${code}, signal ${signal}`);
      try { await fs.promises.rm(tmpDirResolved, { recursive: true, force: true }); } catch {}
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        if (manuallyStopped) {
          sendStoppedEvent();
          return;
        }
        if (code === 0) {
          w.webContents.send('keywords:categorization-finished', { projectId });
        } else {
          w.webContents.send('keywords:categorization-error', {
            projectId,
            message: 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.',
          });
        }
      }
    });
  } catch (error: any) {
    const jobState = activeJobs.get(projectId);
    const manuallyStopped = jobState?.manuallyStopped;
    activeJobs.delete(projectId);
    if (error.message === 'Aborted') {
      console.log(`Categorization for project ${projectId} aborted.`);
      if (manuallyStopped) {
        sendStoppedEvent();
        return;
      }
      return;
    }
    console.error('Failed to start categorization worker:', error);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:categorization-error', { projectId, message: error.message || 'Failed to start worker' });
    }
  }
}
