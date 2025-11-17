import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node:child_process';
import type { CategorizationCtx } from './types.js';
import { isRateLimitError } from './utils.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export async function startCategorizationWorker(ctx: CategorizationCtx, projectId: number) {
  const { db, getWindow, resolvedDbPath, categoriesNameColumn } = ctx;
  const workerPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'worker', 'assignCategorization.cjs');
  const win = getWindow();

  console.log(`Starting categorization worker for project ${projectId}`);

  try {
    const categories = db.prepare(`SELECT id, project_id, ${categoriesNameColumn} AS category_name, created_at FROM categories WHERE project_id = ?`).all(projectId);
    const keywords = db.prepare('SELECT * FROM keywords WHERE project_id = ? AND target_query = 1').all(projectId) as any[];

    if (!keywords || keywords.length === 0) {
      console.warn(`No target keywords (target_query=1) found for project ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'No target keywords (target_query=1) found for project',
        });
      }
      return;
    }

  // Attach embeddings (from new DB facade module)
  console.log(`Attaching embeddings to ${keywords.length} keywords...`);
  const embeddings = require(path.join(process.env.APP_ROOT || path.join(path.dirname(new URL(import.meta.url).pathname), '..'), 'electron', 'db', 'embeddings.cjs'));
  const attachEmbeddingsToKeywords = embeddings.attachEmbeddingsToKeywords;

    let embeddingStats: any;
    try {
      embeddingStats = await attachEmbeddingsToKeywords(keywords, { chunkSize: 10 });
      console.log('Embedding stats:', embeddingStats);
    } catch (embErr: any) {
      console.error('[categorization] Failed to prepare embeddings:', embErr?.message || embErr);
      if (win && !win.isDestroyed()) {
        const rateLimited = isRateLimitError(embErr);
        win.webContents.send('keywords:categorization-error', {
          projectId,
          status: rateLimited ? 429 : undefined,
          message: rateLimited ? 'Request failed with status code 429' : 'Не удалось получить эмбеддинги для категоризации. Проверьте OpenAI ключ.',
        });
      }
      return;
    }

    if (!embeddingStats.embedded) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'Не удалось подготовить эмбеддинги для категоризации.',
        });
      }
      return;
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'categorization-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
    const input = JSON.stringify({ categories: categories || [], keywords });
    await fs.promises.writeFile(inputPath, input, 'utf8');

    const child = spawn(process.execPath, [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`], {
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
        console.log(`[Categorization Worker ${projectId}]`, line);
        try {
          const obj = JSON.parse(line);
          processed++;
          if (obj.id && obj.bestCategoryName !== undefined) {
            db.prepare('UPDATE keywords SET category_name = ?, category_similarity = ? WHERE id = ?')
              .run(obj.bestCategoryName, obj.similarity || null, obj.id);
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
          const progress = Math.round((processed / keywords.length) * 100);
          const w = getWindow();
          if (w && !w.isDestroyed()) {
            w.webContents.send('keywords:categorization-progress', { projectId, progress });
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

    child.on('exit', async (code) => {
      console.log(`Categorization worker exited with code ${code}`);
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        if (code === 0) {
          w.webContents.send('keywords:categorization-finished', { projectId });
        } else {
          w.webContents.send('keywords:categorization-error', { projectId, message: `Worker exited with code ${code}` });
        }
      }
    });
  } catch (error: any) {
    console.error('Failed to start categorization worker:', error);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:categorization-error', { projectId, message: error.message || 'Failed to start worker' });
    }
  }
}
