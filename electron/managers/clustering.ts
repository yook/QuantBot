import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { once } from 'node:events';
import type { ClusteringCtx } from './types.js';
import { createRequire } from 'module';
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

const hasEmbeddingFlag = (value: unknown) => value === 1 || value === true || value === '1';

function cleanupJob(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    releasePowerSaveBlocker(job.powerBlockerId);
    activeJobs.delete(projectId);
  }
  return job;
}

export function stopClusteringWorker(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    console.log(`Stopping clustering worker for project ${projectId}`);
    job.manuallyStopped = true;
    job.abortController.abort();
    if (job.child) {
      job.child.kill();
    }
  }
}

export async function startClusteringWorker(ctx: ClusteringCtx, projectId: number, algorithm: string, eps: number, minPts?: number) {
  if (activeJobs.has(projectId)) {
    console.warn(`Clustering worker for project ${projectId} is already running.`);
    return;
  }
  const abortController = new AbortController();
  const powerBlockerId = acquirePowerSaveBlocker(`clustering:${projectId}`);
  activeJobs.set(projectId, { abortController, manuallyStopped: false, powerBlockerId });

  const { db, getWindow, resolvedDbPath } = ctx;
  const devCandidate = path.join(process.cwd(), 'electron', 'workers', 'clusterСomponents.cjs');
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'workers', 'clusterСomponents.cjs')
    : null;
  const workerPath = fs.existsSync(devCandidate)
    ? devCandidate
    : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);
  const win = getWindow();
  const sendStoppedEvent = () => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:clustering-stopped', { projectId });
    }
  };
  const emitProgress = (stage: string, payload: Record<string, any>) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:clustering-progress', {
        projectId,
        stage,
        ...payload,
      });
    }
  };

  const logDetails =
    algorithm === 'components'
      ? `algorithm=components threshold=${eps}`
      : `algorithm=dbscan eps=${eps}` + (typeof minPts !== 'undefined' ? ` minPts=${minPts}` : '');
  console.log(`Starting clustering worker for project ${projectId} (${logDetails})`);

  try {
    // Clear previous clustering results for this project to avoid stale labels in UI
    try {
      const stmt = db.prepare('UPDATE keywords SET cluster = NULL, cluster_label = NULL WHERE project_id = ?');
      const res = stmt.run(projectId);
      console.log(`[clustering] Cleared previous clustering results: ${res.changes} rows`);
      const w0 = getWindow();
      if (w0 && !w0.isDestroyed()) {
        w0.webContents.send('keywords:clusters-reset', { projectId, cleared: res.changes });
      }
    } catch (clearErr) {
      console.warn('[clustering] Failed to clear previous clustering results:', (clearErr as any)?.message || clearErr);
    }

    const keywordCountRow = db
      .prepare('SELECT COUNT(*) as cnt FROM keywords WHERE project_id = ? AND is_keyword = 1 AND (target_query IS NULL OR target_query = 1)')
      .get(projectId) as { cnt?: number } | undefined;
    let keywordsTotal = Number(keywordCountRow?.cnt ?? 0);

    if (!keywordsTotal) {
      console.warn(`Не найдены целевые ключевые слова для проекта ${projectId}`);
      if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:clustering-error', { projectId, messageKey: 'keywords.noTargetKeywords', message: 'Не найдены целевые ключевые слова для проекта' });
        }
      cleanupJob(projectId);
      return;
    }
    const keywordsReadyRow = db
      .prepare(
        'SELECT COUNT(*) as ready FROM keywords WHERE project_id = ? AND is_keyword = 1 AND (target_query IS NULL OR target_query = 1) AND has_embedding = 1'
      )
      .get(projectId) as { ready?: number } | undefined;
    const cachedKeywords = Math.min(Number(keywordsReadyRow?.ready ?? 0), keywordsTotal);
    let keywordsReadyCount = cachedKeywords;
    let keywordsNeedWarmup = keywordsReadyCount < keywordsTotal;
    let cacheOnlyMode = !keywordsNeedWarmup;

    const emitEmbeddingProgress = () => {
      const percent = keywordsTotal ? Math.round((keywordsReadyCount / keywordsTotal) * 100) : 100;
      emitProgress('embeddings', {
        fetched: keywordsReadyCount,
        total: keywordsTotal,
        percent,
      });
    };

    emitEmbeddingProgress();
    if (!keywordsNeedWarmup) {
      console.log('[clustering] Все целевые ключевые слова уже имеют эмбеддинги в кэше, пропускаем обращения к OpenAI.');
    }
  console.log(`[clustering] Preparing embeddings for ${keywordsTotal} keywords...`);
  const base = process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const embeddings = require(path.join(base, 'electron', 'db', 'embeddings.cjs'));
  const attachEmbeddingsToKeywords = embeddings.attachEmbeddingsToKeywords;
    const readChunkEnv = Number(process.env.CLUSTERING_KEYWORD_CHUNK || 1000);
    const keywordReadChunk = Number.isFinite(readChunkEnv) && readChunkEnv > 0 ? Math.max(1, Math.floor(readChunkEnv)) : 1000;
    const keywordsStmt = db.prepare('SELECT * FROM keywords WHERE project_id = ? AND is_keyword = 1 AND (target_query IS NULL OR target_query = 1) AND id > ? ORDER BY id LIMIT ?');

    let tmpDir: string | null = null;
    let inputPath: string | null = null;
    let writeStream: ReturnType<typeof fs.createWriteStream> | null = null;
    const estimatedSizeMB = Math.round((keywordsTotal * 1536 * 8) / (1024 * 1024));

    try {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clustering-'));
      inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
      console.log(`[clustering] Writing ${keywordsTotal} keywords (~${estimatedSizeMB} MB estimated) to temp JSONL file...`);

      writeStream = fs.createWriteStream(inputPath, { encoding: 'utf8' });
      const writeChunk = async (chunk: string) => {
        if (!writeStream) throw new Error('Write stream is not initialized');
        if (!writeStream.write(chunk)) {
          await once(writeStream, 'drain');
        }
      };

      let processedKeywords = 0;
      let lastKeywordId = 0;
      let embeddedTotal = 0;
      while (processedKeywords < keywordsTotal) {
        const chunk = keywordsStmt.all(projectId, lastKeywordId, keywordReadChunk) as any[];
        if (!chunk.length) {
          break;
        }

        const missingBefore = new Set<number>();
        for (let i = 0; i < chunk.length; i++) {
          const keywordRow: any = chunk[i];
          if (!keywordRow) continue;
          if (!hasEmbeddingFlag(keywordRow.has_embedding)) {
            missingBefore.add(i);
          }
        }

        let chunkStats: any;
        const attachOptions: Record<string, any> = {
          chunkSize: 64,
          abortSignal: abortController.signal,
        };
        if (cacheOnlyMode) {
          attachOptions.cacheOnly = true;
        }
        try {
          chunkStats = await attachEmbeddingsToKeywords(chunk, attachOptions);
        } catch (attachErr: any) {
          if (cacheOnlyMode && attachErr?.code === 'EMBEDDING_CACHE_MISS') {
            console.warn('[clustering] Не все эмбеддинги найдены в кэше, включаем догрев через OpenAI.');
            cacheOnlyMode = false;
            keywordsNeedWarmup = true;
            chunkStats = await attachEmbeddingsToKeywords(chunk, {
              chunkSize: 64,
              abortSignal: abortController.signal,
            });
          } else {
            throw attachErr;
          }
        }
        embeddedTotal += chunkStats?.embedded || 0;

        let chunkNewlyEmbedded = 0;
        for (const idx of missingBefore) {
          const kw = chunk[idx];
          if (kw && Array.isArray((kw as any).embedding) && (kw as any).embedding.length) {
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
      }

      if (processedKeywords < keywordsTotal) {
        console.warn(`[clustering] Keyword count changed during processing. Expected ${keywordsTotal}, processed ${processedKeywords}.`);
        keywordsTotal = processedKeywords;
      }

      if (!embeddedTotal) {
        throw new Error('No embeddings prepared for clustering');
      }

      try {
        writeStream.end();
        await once(writeStream, 'finish');
        writeStream = null;
      } catch (streamErr) {
        (streamErr as any).__writeError = true;
        throw streamErr;
      }

      keywordsReadyCount = keywordsTotal;
      emitEmbeddingProgress();

      console.log(`[clustering] Successfully wrote input file (JSONL): ${inputPath}`);
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
        console.error('[clustering] Failed to write input file:', embErr?.message || embErr);
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          w.webContents.send('keywords:clustering-error', {
            projectId,
            message: `Не удалось подготовить данные для кластеризации (размер: ~${estimatedSizeMB} MB). ${embErr?.message || 'Unknown error'}`,
            status: 'WRITE_ERROR',
            debug: { keywordCount: keywordsTotal, estimatedSizeMB, error: embErr?.message }
          });
        }
      } else {
        console.error('[clustering] Failed to prepare embeddings:', embErr?.message || embErr);
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          const rateLimited = /429/.test(String(embErr?.message)) || /rate limit/i.test(String(embErr?.message));
          w.webContents.send('keywords:clustering-error', {
            projectId,
            status: rateLimited ? 429 : undefined,
            message: rateLimited ? 'Request failed with status code 429' : 'Не удалось получить эмбеддинги для кластеризации. Проверьте OpenAI ключ.',
          });
        }
      }
      cleanupJob(projectId);
      return;
    }

    if (!tmpDir || !inputPath) {
      console.error('[clustering] Temporary input file missing after embedding stage.');
      if (tmpDir) {
        try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
      cleanupJob(projectId);
      return;
    }

    const tmpDirResolved = tmpDir;
    const inputPathResolved = inputPath;

    // For 'components' algorithm the worker expects a similarity `threshold` (not `eps`),
    // for 'dbscan' the worker expects `eps` (cosine distance). Map accordingly.
    const args = [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPathResolved}`, `--algorithm=${algorithm}`];
    if (algorithm === 'components') {
      args.push(`--threshold=${eps}`);
    } else {
      args.push(`--eps=${eps}`);
    }
    if (minPts !== undefined) args.push(`--minPts=${minPts}`);

    let env = Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
    });

    const child = spawn(process.execPath, args, {
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
        console.log(`[Clustering Worker ${projectId}]`, line);
        try {
          const obj = JSON.parse(line);
          processed++;
          if (obj.id && obj.cluster !== undefined) {
            db.prepare('UPDATE keywords SET cluster = ?, cluster_label = ? WHERE id = ?')
              .run(obj.cluster, String(obj.cluster), obj.id);
            try {
              const updated = db.prepare('SELECT * FROM keywords WHERE id = ?').get(obj.id);
              const w = getWindow();
              if (updated && w && !w.isDestroyed()) {
                w.webContents.send('keywords:updated', { projectId, keyword: updated });
              }
            } catch (e) {
              console.warn('[Main] Failed to notify renderer about keywords:updated for clustering', e);
            }
          }
          const progress = keywordsTotal ? Math.round((processed / keywordsTotal) * 100) : 100;
          emitProgress('clustering', {
            progress,
            percent: progress,
            processed,
            total: keywordsTotal,
          });
        } catch (e) {
          if (line.includes('progress:')) {
            const match = line.match(/progress: (\d+)/);
            const w = getWindow();
            if (match && w && !w.isDestroyed()) {
              w.webContents.send('keywords:clustering-progress', { projectId, progress: parseInt(match[1]) });
            }
          }
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data) => {
      console.error(`[Clustering Worker ${projectId} ERROR]`, data.toString().trim());
    });

    child.on('exit', async (code, signal) => {
      const jobState = activeJobs.get(projectId);
      const manuallyStopped = jobState?.manuallyStopped;
      cleanupJob(projectId);
      console.log(`Clustering worker exited with code ${code}, signal ${signal}`);
      try { await fs.promises.rm(tmpDirResolved, { recursive: true, force: true }); } catch {}
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        if (manuallyStopped) {
          sendStoppedEvent();
          return;
        }
        if (code === 0) {
          w.webContents.send('keywords:clustering-finished', { projectId });
        } else {
          w.webContents.send('keywords:clustering-error', { projectId, message: `Worker exited with code ${code}` });
        }
      }
    });
  } catch (error: any) {
    const jobState = cleanupJob(projectId);
    const manuallyStopped = jobState?.manuallyStopped;
    if (error.message === 'Aborted') {
      console.log(`Clustering for project ${projectId} aborted.`);
      if (manuallyStopped) {
        sendStoppedEvent();
        return;
      }
      return;
    }
    console.error('Failed to start clustering worker:', error);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:clustering-error', { projectId, message: error.message || 'Failed to start worker' });
    }
  }
}
