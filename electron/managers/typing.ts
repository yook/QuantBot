import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import type { TypingCtx } from './types.js';
import type { ChildProcess } from 'node:child_process';
import { acquirePowerSaveBlocker, releasePowerSaveBlocker } from './utils.js';

const require = createRequire(import.meta.url);

type ActiveJob = {
  child?: ChildProcess;
  abortController: AbortController;
  manuallyStopped?: boolean;
  powerBlockerId?: number | null;
};

const activeJobs = new Map<number, ActiveJob>();

function cleanupJob(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    releasePowerSaveBlocker(job.powerBlockerId);
    activeJobs.delete(projectId);
  }
  return job;
}

export function stopTypingWorker(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    console.log(`Stopping typing worker for project ${projectId}`);
    job.manuallyStopped = true;
    job.abortController.abort();
    if (job.child) {
      job.child.kill();
    }
  }
}

export async function startTypingWorker(ctx: TypingCtx, projectId: number) {
  if (activeJobs.has(projectId)) {
    console.warn(`Typing worker for project ${projectId} is already running.`);
    return;
  }
  const abortController = new AbortController();
  const powerBlockerId = acquirePowerSaveBlocker(`typing:${projectId}`);
  activeJobs.set(projectId, { abortController, manuallyStopped: false, powerBlockerId });

  const { db, getWindow, resolvedDbPath, typingLabelColumn, typingTextColumn, typingDateColumn } = ctx;
  const devCandidate = path.join(process.cwd(), 'electron', 'workers', 'trainAndClassify.cjs');
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'workers', 'trainAndClassify.cjs')
    : null;
  const workerPath = fs.existsSync(devCandidate)
    ? devCandidate
    : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);
  const win = getWindow();
  const sendStoppedEvent = () => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:typing-stopped', { projectId });
    }
  };
  const emitProgress = (stage: string, payload: Record<string, any>) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:typing-progress', {
        projectId,
        stage,
        ...payload,
      });
    }
  };

  console.log(`Starting typing worker for project ${projectId}`);

  try {
    const dateAlias = typingDateColumn ? `${typingDateColumn} AS date,` : '';
    const typingSamples = db.prepare(`SELECT id, project_id, ${typingLabelColumn} AS label, ${typingTextColumn} AS text, ${dateAlias} created_at FROM typing_samples WHERE project_id = ?`).all(projectId);
    const keywordCountRow = db
      .prepare('SELECT COUNT(*) as cnt FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1)')
      .get(projectId) as { cnt?: number } | undefined;
    let keywordsTotal = Number(keywordCountRow?.cnt ?? 0);

    // Проверяем, задано ли достаточное количество классов в `typing_samples`
    try {
      const labels = Array.from(new Set((typingSamples || []).map((s: any) => s.label).filter(Boolean)));
      const labelCount = labels.length;
      if (labelCount < 2) {
        console.warn(`[Typing] Not enough labels in typing_samples for project ${projectId}: ${labelCount}`, { labels });
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:typing-error', {
            projectId,
            message: 'Задайте не менее двух классов в образцах (typing_samples) для классификации.',
            detectedLabels: labelCount,
            labelsSample: labels.slice(0, 10),
          });
        }
        cleanupJob(projectId);
        return;
      }
    } catch (e) {
      console.warn('[Typing] Failed to check typing_samples labels count', e);
    }

    if (!keywordsTotal) {
      console.warn(`Не найдены целевые ключевые слова для проекта ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:typing-error', { projectId, messageKey: 'keywords.noTargetKeywords', message: 'Не найдены целевые ключевые слова для проекта' });
        }
      cleanupJob(projectId);
      return;
    }

    // Clear previous classification (class_name / class_similarity) for the project to avoid stale values
    try {
      db.prepare('UPDATE keywords SET class_name = NULL, class_similarity = NULL WHERE project_id = ?').run(projectId);
    } catch (e) {
      console.warn('[Typing] Failed to clear previous class values', e);
    }

    // Attach embeddings (from new DB facade module)
    console.log(`Preparing embeddings for ${keywordsTotal} keywords and ${typingSamples.length} samples...`);
    const base = process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const embeddings = require(path.join(base, 'electron', 'db', 'embeddings.cjs'));
    const attachEmbeddingsToKeywords = embeddings.attachEmbeddingsToKeywords;
    const readChunkEnv = Number(process.env.TYPING_KEYWORD_CHUNK || 1000);
    const keywordReadChunk = Number.isFinite(readChunkEnv) && readChunkEnv > 0 ? Math.max(1, Math.floor(readChunkEnv)) : 1000;
    const keywordsStmt = db.prepare('SELECT * FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1) AND id > ? ORDER BY id LIMIT ?');

    let tmpDir: string | null = null;
    let inputPath: string | null = null;
    let writeStream: ReturnType<typeof fs.createWriteStream> | null = null;
    const estimatedSizeMB = Math.round((keywordsTotal * 1536 * 8) / (1024 * 1024));

    try {
      // 1. Embed typing samples (classes)
      emitProgress('embeddings-categories', {
        fetched: 0,
        total: typingSamples.length,
        percent: typingSamples.length ? 0 : 100,
      });
      await attachEmbeddingsToKeywords(typingSamples, {
        chunkSize: 64,
        abortSignal: abortController.signal,
        onProgress: (p: any) => {
          emitProgress('embeddings-categories', {
            fetched: p.fetched,
            total: typeof p.total !== 'undefined' ? p.total : typingSamples.length,
            percent: p.percent,
          });
        }
      });
      emitProgress('embeddings-categories', {
        fetched: typingSamples.length,
        total: typingSamples.length,
        percent: typingSamples.length ? 100 : 0,
      });

      // 2. Embed keywords + stream to temp file
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'typing-'));
      inputPath = path.join(tmpDir, `input-${Date.now()}.jsonl`);
      console.log(`[typing] Writing ${keywordsTotal} keywords (~${estimatedSizeMB} MB estimated) to temp JSONL file...`);

      writeStream = fs.createWriteStream(inputPath, { encoding: 'utf8' });
      const writeChunk = async (chunk: string) => {
        if (!writeStream) throw new Error('Write stream is not initialized');
        if (!writeStream.write(chunk)) {
          await once(writeStream, 'drain');
        }
      };

      emitProgress('embeddings', {
        fetched: 0,
        total: keywordsTotal,
        percent: keywordsTotal ? 0 : 100,
      });

      let processedKeywords = 0;
      let lastKeywordId = 0;
      while (processedKeywords < keywordsTotal) {
        const chunk = keywordsStmt.all(projectId, lastKeywordId, keywordReadChunk) as any[];
        if (!chunk.length) {
          break;
        }

        const chunkBaseProgress = processedKeywords;
        await attachEmbeddingsToKeywords(chunk, { 
          chunkSize: 64,
          abortSignal: abortController.signal,
          onProgress: (p: any) => {
            const chunkProgress = Math.min(
              p.fetched || 0,
              p.total || chunk.length
            );
            const globalFetched = Math.min(
              chunkBaseProgress + chunkProgress,
              keywordsTotal
            );
            const percent = keywordsTotal ? Math.round((globalFetched / keywordsTotal) * 100) : 100;
            emitProgress('embeddings', {
              fetched: globalFetched,
              total: keywordsTotal,
              percent,
            });
          }
        });

        try {
          for (const keyword of chunk) {
            await writeChunk(JSON.stringify(keyword) + '\n');
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
        console.warn(`[Typing] Keyword count changed during processing. Expected ${keywordsTotal}, processed ${processedKeywords}.`);
        keywordsTotal = processedKeywords;
      }

      try {
        writeStream.end();
        await once(writeStream, 'finish');
        writeStream = null;
      } catch (streamErr) {
        (streamErr as any).__writeError = true;
        throw streamErr;
      }

      emitProgress('embeddings', {
        fetched: keywordsTotal,
        total: keywordsTotal,
        percent: keywordsTotal ? 100 : 0,
      });

      console.log(`[typing] Successfully wrote input file: ${inputPath}`);
    } catch (embErr: any) {
      const job = activeJobs.get(projectId);
      if (writeStream) {
        try { writeStream.destroy(); } catch (_) {}
      }
      if (tmpDir) {
        try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
      if (embErr?.message === 'Aborted' && job?.manuallyStopped) {
        cleanupJob(projectId);
        sendStoppedEvent();
        return;
      }
      if (embErr?.__writeError) {
        console.error('[typing] Failed to write input file:', embErr?.message || embErr);
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:typing-error', {
            projectId,
            message: `Не удалось подготовить данные для классификации (примерный размер: ~${estimatedSizeMB} MB). ${embErr?.message || 'Unknown error'}`,
            status: 'WRITE_ERROR',
            debug: { keywordCount: keywordsTotal, estimatedSizeMB, error: embErr?.message }
          });
        }
      } else {
        console.error('[typing] Failed to prepare embeddings:', embErr?.message || embErr);
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:typing-error', {
            projectId,
            message: 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.',
          });
        }
      }
      cleanupJob(projectId);
      return;
    }

    if (!tmpDir || !inputPath) {
      console.error('[typing] Temporary input file missing after embedding stage.');
      if (tmpDir) {
        try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
      cleanupJob(projectId);
      return;
    }

    const tmpDirResolved = tmpDir;
    const inputPathResolved = inputPath;

    console.log(`[Typing] workerPath: ${workerPath}, resolvedDbPath: ${resolvedDbPath}`);
    try {
      const exists = fs.existsSync(workerPath);
      console.log(`[Typing] workerPath exists: ${exists}`);
      if (!exists) {
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          w.webContents.send('keywords:typing-error', { projectId, message: `Worker файл не найден: ${workerPath}` });
        }
        cleanupJob(projectId);
        return;
      }
    } catch (e) {
      console.warn('[Typing] Failed to stat workerPath', e);
    }

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
        console.log(`[Typing Worker ${projectId}]`, line);
        try {
          const obj = JSON.parse(line);
          // If worker emitted a progress update, forward it to UI
          if (obj && obj.type === 'progress') {
            const w = getWindow();
            if (w && !w.isDestroyed()) {
              w.webContents.send('keywords:typing-progress', Object.assign({ projectId }, obj));
            }
            continue;
          }
          processed++;
          const cname = obj.bestCategoryName ?? obj.className ?? null;
          if (obj.id && cname !== null) {
            // Normalize similarity to 0..1 before writing
            let sim: any = obj.similarity;
            try {
              if (typeof sim === 'string') sim = sim.trim().replace('%', '');
                sim = Number(sim);
                if (!Number.isFinite(sim) || Number.isNaN(sim)) sim = null;
                else {
                    // Round to 4 decimals to avoid floating point noise
                    sim = Number(sim.toFixed(4));
                    // Special-case: treat 0.01 as exact match => 1
                    if (sim === 0.01) sim = 1;
                    if (sim > 1 && sim <= 100) sim = sim / 100;
                    sim = Math.max(0, Math.min(1, sim));
                }
            } catch (_) {
              sim = null;
            }

            db.prepare('UPDATE keywords SET class_name = ?, class_similarity = ? WHERE id = ?')
              .run(cname, sim, obj.id);
            try {
              const updated = db.prepare('SELECT * FROM keywords WHERE id = ?').get(obj.id);
              const w = getWindow();
              if (updated && w && !w.isDestroyed()) {
                w.webContents.send('keywords:updated', { projectId, keyword: updated });
              }
            } catch (e) {
              console.warn('[Main] Failed to notify renderer about keywords:updated for typing', e);
            }
          }
          if (keywordsTotal > 0) {
            const progress = Math.round((processed / keywordsTotal) * 100);
            emitProgress('classification', {
              progress,
              percent: progress,
              processed,
              total: keywordsTotal,
            });
          }
        } catch (e) {
          if (line.includes('progress:')) {
            const match = line.match(/progress: (\d+)/);
            const w = getWindow();
            if (match && w && !w.isDestroyed()) {
              w.webContents.send('keywords:typing-progress', { projectId, progress: parseInt(match[1]) });
            }
          }
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    let stderrRateLimited = false;
    let lastStderr = '';
    child.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      lastStderr = text;
      console.error(`[Typing Worker ${projectId} ERROR]`, text);
      if (/429/.test(text) || /rate limit/i.test(text)) {
        stderrRateLimited = true;
      }
      // do not immediately send UI error here — wait for process exit to decide final status
    });

    child.on('exit', async (code, signal) => {
      const jobState = activeJobs.get(projectId);
      const manuallyStopped = jobState?.manuallyStopped;
      cleanupJob(projectId);
      console.log(`Typing worker exited with code ${code}, signal ${signal}`);
      try { await fs.promises.rm(tmpDirResolved, { recursive: true, force: true }); } catch {}
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        if (manuallyStopped) {
          sendStoppedEvent();
          return;
        }
        if (code === 0) {
          w.webContents.send('keywords:typing-finished', { projectId });
        } else {
          // If process was killed by signal, code will be null — log signal
          if (signal) {
            console.error(`[Typing] Worker killed by signal: ${signal}`);
          }
          // Decide message based on stderr detection (rate limit) or generic failure
          const payload: any = { projectId };
          if (stderrRateLimited) {
            payload.status = 429;
            payload.message = 'Request failed with status code 429';
          } else {
            payload.message = 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.';
            // attach last stderr for debugging
            if (lastStderr) payload.debug = lastStderr.substring(0, 1024);
          }
          w.webContents.send('keywords:typing-error', payload);
        }
      }
    });
  } catch (error: any) {
    const jobState = cleanupJob(projectId);
    const manuallyStopped = jobState?.manuallyStopped;
    if (error.message === 'Aborted') {
      console.log(`Typing for project ${projectId} aborted.`);
      if (manuallyStopped) {
        sendStoppedEvent();
        return;
      }
      return;
    }
    console.error('Failed to start typing worker:', error);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:typing-error', { projectId, message: error.message || 'Failed to start worker' });
    }
  }
}
