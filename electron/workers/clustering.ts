import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import type { ClusteringCtx } from './types.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export async function startClusteringWorker(ctx: ClusteringCtx, projectId: number, algorithm: string, eps: number, minPts?: number) {
  const { db, getWindow, resolvedDbPath } = ctx;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const workerPath = path.join(__dirname, '..', 'worker', 'clusterСomponents.cjs');
  const win = getWindow();

  console.log(`Starting clustering worker for project ${projectId}`, { algorithm, eps, minPts });

  try {
    const keywords = db.prepare('SELECT * FROM keywords WHERE project_id = ? AND target_query = 1').all(projectId) as any[];
    if (!keywords || keywords.length === 0) {
      console.warn(`No target keywords (target_query=1) found for project ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:clustering-error', { projectId, message: 'No target keywords (target_query=1) found for project' });
      }
      return;
    }

  console.log(`[clustering] Attaching embeddings to ${keywords.length} keywords...`);
  const base = process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const embeddings = require(path.join(base, 'electron', 'db', 'embeddings.cjs'));
  const attachEmbeddingsToKeywords = embeddings.attachEmbeddingsToKeywords;
    try {
      const embeddingStats = await attachEmbeddingsToKeywords(keywords, { chunkSize: 10 });
      console.log('[clustering] Embedding stats:', embeddingStats);
      if (!embeddingStats.embedded) {
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          w.webContents.send('keywords:clustering-error', { projectId, message: 'Не удалось подготовить эмбеддинги для кластеризации.' });
        }
        return;
      }
    } catch (embErr: any) {
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
      return;
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clustering-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
    const input = JSON.stringify({ keywords, algorithm, eps, minPts });
    await fs.promises.writeFile(inputPath, input, 'utf8');

    // For 'components' algorithm the worker expects a similarity `threshold` (not `eps`),
    // for 'dbscan' the worker expects `eps` (cosine distance). Map accordingly.
    const args = [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`, `--algorithm=${algorithm}`];
    if (algorithm === 'components') {
      args.push(`--threshold=${eps}`);
    } else {
      args.push(`--eps=${eps}`);
    }
    if (minPts !== undefined) args.push(`--minPts=${minPts}`);

    const child = spawn(process.execPath, args, {
      env: Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
          const progress = Math.round((processed / keywords.length) * 100);
          const w = getWindow();
          if (w && !w.isDestroyed()) {
            w.webContents.send('keywords:clustering-progress', { projectId, progress });
          }
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

    child.on('exit', async (code) => {
      console.log(`Clustering worker exited with code ${code}`);
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        if (code === 0) {
          w.webContents.send('keywords:clustering-finished', { projectId });
        } else {
          w.webContents.send('keywords:clustering-error', { projectId, message: `Worker exited with code ${code}` });
        }
      }
    });
  } catch (error: any) {
    console.error('Failed to start clustering worker:', error);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:clustering-error', { projectId, message: error.message || 'Failed to start worker' });
    }
  }
}
