import path from 'path';
import fs from 'fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import type { CategorizationCtx } from './types.js';
import { acquirePowerSaveBlocker, isRateLimitError, releasePowerSaveBlocker } from './utils.js';
import { createRequire } from 'module';
import type { ChildProcess } from 'node:child_process';
const require = createRequire(import.meta.url);

type ActiveJob = {
  child?: ChildProcess;
  abortController: AbortController;
  manuallyStopped?: boolean;
  powerBlockerId?: number | null;
};

const activeJobs = new Map<number, ActiveJob>();

const hasEmbeddingFlag = (value: unknown) => value === 1 || value === true || value === '1';

function cleanupJob(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    releasePowerSaveBlocker(job.powerBlockerId);
    activeJobs.delete(projectId);
  }
  return job;
}

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
  const powerBlockerId = acquirePowerSaveBlocker(`categorization:${projectId}`);
  activeJobs.set(projectId, { abortController, manuallyStopped: false, powerBlockerId });

  const { db, getWindow, resolvedDbPath } = ctx;
  const devCandidate = path.join(process.cwd(), 'electron', 'workers', 'assignCategorization.cjs');
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'workers', 'assignCategorization.cjs')
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

  const releaseEmbeddingPayload = (records: any[]) => {
    if (!Array.isArray(records)) return;
    for (const rec of records) {
      if (!rec || typeof rec !== 'object') continue;
      if ('embedding' in rec) delete (rec as any).embedding;
      if ('vector' in rec) delete (rec as any).vector;
      if ('embeddingSource' in rec) delete (rec as any).embeddingSource;
    }
  };

  console.log(`Starting categorization worker for project ${projectId}`);

  try {
    // Проверяем, есть ли заданные категории для проекта (нужно минимум 2 класса для категоризации)
    try {
      const cntRow = db
        .prepare('SELECT COUNT(*) as cnt FROM keywords WHERE project_id = ? AND is_category = 1')
        .get(projectId);
      const categoryCount = Number((cntRow as any)?.cnt ?? 0);
      if (categoryCount < 2) {
        console.warn(`[Categorization] Not enough categories for project ${projectId}: ${categoryCount}`);
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:categorization-error', {
            projectId,
            message: 'Задайте не менее двух категорий для категоризации.',
          });
        }
        cleanupJob(projectId);
        return;
      }
    } catch (e) {
      console.warn('[Categorization] Failed to check categories count', e);
    }

    let categories = db
      .prepare(
        'SELECT id, project_id, keyword AS category_name, has_embedding, created_at FROM keywords WHERE project_id = ? AND is_category = 1 ORDER BY id'
      )
      .all(projectId);

    const initialCategoryCount = categories.length;

    // Deduplicate and cap categories to avoid OOM on huge lists
    const dedupMap = new Map<string, boolean>();
    const deduped: any[] = [];
    for (const c of categories) {
      const key = (c as any)?.category_name ? String((c as any).category_name).trim().toLowerCase() : '';
      if (!key) continue;
      if (dedupMap.has(key)) continue;
      dedupMap.set(key, true);
      deduped.push(c);
    }
    if (deduped.length !== initialCategoryCount) {
      console.warn(`[Categorization] Deduped categories: ${initialCategoryCount} -> ${deduped.length}`);
    }

    const CATEGORY_LIMIT = Number(process.env.CATEGORY_LIMIT || 0);
    if (CATEGORY_LIMIT > 0 && deduped.length > CATEGORY_LIMIT) {
      console.warn(`[Categorization] Categories exceed limit ${CATEGORY_LIMIT}: ${deduped.length}. Proceeding with batching may be slow/huge.`);
    }
  categories = deduped;
  const totalCategories = categories.length;
    // Clear previous categorization results for the project to avoid stale values
    try {
      db.prepare('UPDATE keywords SET category_name = NULL, category_similarity = NULL WHERE project_id = ?').run(projectId);
    } catch (e) {
      console.warn('[Categorization] Failed to clear previous category values', e);
    }
    const keywordCountRow = db
      .prepare(
        'SELECT COUNT(*) as cnt FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1) AND is_keyword = 1'
      )
      .get(projectId) as { cnt?: number } | undefined;
    let keywordsTotal = Number(keywordCountRow?.cnt ?? 0);
    let combinedTotal = keywordsTotal + totalCategories;

    if (!keywordsTotal) {
      console.warn(`Не найдены целевые ключевые слова для проекта ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          messageKey: 'keywords.noTargetKeywords',
          message: 'Не найдены целевые ключевые слова для проекта',
        });
      }
      cleanupJob(projectId);
      return;
    }

  // Attach embeddings (from new DB facade module)
  console.log(`Preparing embeddings for ${keywordsTotal} keywords and ${totalCategories} categories...`);
  const base = process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const embeddings = require(path.join(base, 'electron', 'db', 'embeddings.cjs'));
  const attachEmbeddingsToKeywords = embeddings.attachEmbeddingsToKeywords;
  const readChunkEnv = Number(process.env.CATEGORIZATION_KEYWORD_CHUNK || 1000);
  const keywordReadChunk = Number.isFinite(readChunkEnv) && readChunkEnv > 0 ? Math.max(1, Math.floor(readChunkEnv)) : 1000;
  const categoryReadChunk = Number(process.env.CATEGORIZATION_CATEGORY_CHUNK || keywordReadChunk);
    const keywordsStmt = db.prepare(
      'SELECT * FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1) AND is_keyword = 1 AND id > ? ORDER BY id LIMIT ?'
    );

    const keywordsReadyRow = db
      .prepare(
        'SELECT COUNT(*) as ready FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1) AND is_keyword = 1 AND has_embedding = 1'
      )
      .get(projectId) as { ready?: number } | undefined;
    const keywordsWithEmbedding = Math.min(Number(keywordsReadyRow?.ready ?? 0), keywordsTotal);
    const keywordsNeedWarmup = keywordsWithEmbedding < keywordsTotal;

    const categoriesReadyRow = db
      .prepare('SELECT COUNT(*) as ready FROM keywords WHERE project_id = ? AND is_category = 1 AND has_embedding = 1')
      .get(projectId) as { ready?: number } | undefined;
    const categoriesWithEmbedding = Math.min(Number(categoriesReadyRow?.ready ?? 0), totalCategories);
    const categoriesNeedWarmup = categoriesWithEmbedding < totalCategories;

    let embeddingStats: any = { total: keywordsTotal, embedded: 0, fetched: 0, missing: keywordsTotal };
    let categoriesReadyCount = categoriesWithEmbedding;
    let keywordsReadyCount = keywordsWithEmbedding;

    const emitEmbeddingProgress = () => {
      const fetched = categoriesReadyCount + keywordsReadyCount;
      const percent = combinedTotal ? Math.round((fetched / combinedTotal) * 100) : 100;
      emitProgress('embeddings', {
        fetched,
        total: combinedTotal,
        percent,
      });
    };

    try {
      emitEmbeddingProgress();

      if (!categoriesNeedWarmup) {
        categoriesReadyCount = totalCategories;
      }
      if (!keywordsNeedWarmup) {
        keywordsReadyCount = keywordsTotal;
        embeddingStats.embedded = keywordsTotal;
        embeddingStats.missing = 0;
      }

      if (!categoriesNeedWarmup && !keywordsNeedWarmup) {
        emitEmbeddingProgress();
        console.log('[categorization] Все эмбеддинги уже есть в кэше, прогрев пропускаем.');
      }

      // 1) Прогреваем эмбеддинги категорий (через cache/OpenAI)
      if (totalCategories && categoriesNeedWarmup) {
        let processedCategories = 0;
        while (processedCategories < totalCategories) {
          const chunk = categories.slice(processedCategories, processedCategories + categoryReadChunk);
          const missingBefore = new Set<number>();
          for (let i = 0; i < chunk.length; i++) {
            const row: any = chunk[i];
            if (!row) continue;
            if (!hasEmbeddingFlag(row.has_embedding)) {
              missingBefore.add(i);
            }
          }

          await attachEmbeddingsToKeywords(chunk, {
            chunkSize: 64,
            abortSignal: abortController.signal,
          });

          let chunkNewlyEmbedded = 0;
          for (const idx of missingBefore) {
            const row = chunk[idx];
            if (row && Array.isArray((row as any).embedding) && (row as any).embedding.length) {
              chunkNewlyEmbedded++;
            }
          }
          if (chunkNewlyEmbedded > 0) {
            categoriesReadyCount = Math.min(
              totalCategories,
              categoriesReadyCount + chunkNewlyEmbedded
            );
            emitEmbeddingProgress();
          }

          processedCategories += chunk.length;
          releaseEmbeddingPayload(chunk);
        }
        // Drop references только если прогревали
        categories = [];
      } else if (!categoriesNeedWarmup) {
        // Всё уже в кэше, можно освободить массив категорий сразу
        categories = [];
      }

      let processedKeywords = 0;
      let lastKeywordId = 0;
      while (processedKeywords < keywordsTotal && keywordsNeedWarmup) {
        const chunk = keywordsStmt.all(projectId, lastKeywordId, keywordReadChunk) as any[];
        if (!chunk.length) {
          break;
        }

        const missingBefore = new Set<number>();
        for (let i = 0; i < chunk.length; i++) {
          const row: any = chunk[i];
          if (!row) continue;
          if (!hasEmbeddingFlag(row.has_embedding)) {
            missingBefore.add(i);
          }
        }

        const chunkStats = await attachEmbeddingsToKeywords(chunk, {
          chunkSize: 64,
          abortSignal: abortController.signal,
        });

        embeddingStats.embedded += chunkStats?.embedded || 0;
        embeddingStats.fetched += chunkStats?.fetched || 0;

        let chunkNewlyEmbedded = 0;
        for (const idx of missingBefore) {
          const row = chunk[idx];
          if (row && Array.isArray((row as any).embedding) && (row as any).embedding.length) {
            chunkNewlyEmbedded++;
          }
        }
        if (chunkNewlyEmbedded > 0) {
          keywordsReadyCount = Math.min(
            keywordsTotal,
            keywordsReadyCount + chunkNewlyEmbedded
          );
          emitEmbeddingProgress();
        }

        processedKeywords += chunk.length;
        const tail = chunk[chunk.length - 1] as any;
        if (tail && typeof tail.id === 'number') {
          lastKeywordId = tail.id;
        }
        releaseEmbeddingPayload(chunk);
        chunk.length = 0;
      }

      if (keywordsNeedWarmup && processedKeywords < keywordsTotal) {
        console.warn(`[Categorization] Keyword count changed during processing. Expected ${keywordsTotal}, processed ${processedKeywords}.`);
        keywordsTotal = processedKeywords;
        combinedTotal = totalCategories + keywordsTotal;
      }

      embeddingStats.total = keywordsTotal;
      embeddingStats.missing = Math.max(0, keywordsTotal - embeddingStats.embedded);

      categoriesReadyCount = totalCategories;
      keywordsReadyCount = keywordsTotal;
      emitEmbeddingProgress();

      console.log('[categorization] Эмбеддинги категорий и ключей прогреты в кэше');
      console.log('Embedding stats:', embeddingStats);
    } catch (embErr: any) {
      const job = activeJobs.get(projectId);
      if (embErr?.message === 'Aborted' && job?.manuallyStopped) {
        cleanupJob(projectId);
        sendStoppedEvent();
        return;
      }
      console.error('[categorization] Failed to prepare embeddings:', embErr?.message || embErr);
      if (embErr?.stack) console.error('[categorization] stack:', embErr.stack);
      if (win && !win.isDestroyed()) {
        const rateLimited = isRateLimitError(embErr);
        win.webContents.send('keywords:categorization-error', {
          projectId,
          status: rateLimited ? 429 : undefined,
          message: rateLimited
            ? 'Request failed with status code 429'
            : `Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ. ${embErr?.message || ''}`,
          debug: embErr ? { message: embErr?.message, code: embErr?.code, name: embErr?.name } : undefined,
        });
      }
      cleanupJob(projectId);
      return;
    }

    if (!embeddingStats.embedded) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.',
        });
      }
      cleanupJob(projectId);
      return;
    }

    let env = Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      NODE_OPTIONS: '--max-old-space-size=4096',
    });

    const child: ChildProcess = spawn(process.execPath, [workerPath, `--projectId=${projectId}`], {
      env,
      stdio: 'pipe',
    });

    const job = activeJobs.get(projectId);
    if (job) job.child = child;

    // Сразу переключаем UI на этап категоризации, чтобы не зависать на лейбле эмбеддингов
    const wStart = getWindow();
    if (wStart && !wStart.isDestroyed()) {
      wStart.webContents.send('keywords:categorization-progress', {
        projectId,
        stage: 'categorization',
        processed: 0,
        total: keywordsTotal,
        percent: 0,
      });
    }

    let processed = 0;
    child.stdout?.setEncoding('utf8');
    let stdoutBuffer = '';

    child.stdout?.on('data', (data: string | Buffer) => {
      stdoutBuffer += data.toString();
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
    child.stderr?.on('data', (data: string | Buffer) => {
      console.error(`[Categorization Worker ${projectId} ERROR]`, data.toString().trim());
    });

    child.on('exit', async (code: number | null, signal: NodeJS.Signals | null) => {
      const jobState = cleanupJob(projectId);
      const manuallyStopped = jobState?.manuallyStopped;
      
      // Enhanced logging for debugging production crashes
      if (code === null) {
        console.error(`[Categorization] Worker exited with code=null, signal=${signal}. Likely killed by OS (OOM) or unhandled exception.`);
        console.error(`[Categorization] Last processed: ${processed}/${keywordsTotal} keywords (${Math.round(processed/keywordsTotal*100)}%)`);
      } else {
        console.log(`Categorization worker exited with code ${code}, signal ${signal}`);
      }
      
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
    const jobState = cleanupJob(projectId);
    const manuallyStopped = jobState?.manuallyStopped;
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
