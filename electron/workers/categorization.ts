import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { once } from 'node:events';
import type { CategorizationCtx } from './types.js';
import { isRateLimitError } from './utils.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export async function startCategorizationWorker(ctx: CategorizationCtx, projectId: number) {
  const { db, getWindow, resolvedDbPath, categoriesNameColumn } = ctx;
  const devCandidate = path.join(process.cwd(), 'worker', 'assignCategorization.cjs');
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'worker', 'assignCategorization.cjs')
    : null;
  const workerPath = fs.existsSync(devCandidate)
    ? devCandidate
    : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);
  const win = getWindow();

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
    const keywords = db.prepare('SELECT * FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1)').all(projectId) as any[];

    if (!keywords || keywords.length === 0) {
      console.warn(`Не найдены целевые ключевые слова для проекта ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          messageKey: 'keywords.noTargetKeywords',
          message: 'Не найдены целевые ключевые слова для проекта',
        });
      }
      return;
    }

  // Attach embeddings (from new DB facade module)
  console.log(`Attaching embeddings to ${keywords.length} keywords...`);
  const base = process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const embeddings = require(path.join(base, 'electron', 'db', 'embeddings.cjs'));
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
          message: rateLimited ? 'Request failed with status code 429' : 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.',
        });
      }
      return;
    }

    if (!embeddingStats.embedded) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.',
        });
      }
      return;
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'categorization-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);

    // Stream the input to avoid creating a huge string in memory
    const keywordCount = keywords.length;
    const avgEmbeddingSize = keywords[0]?.embedding?.length || 1536;
    const estimatedSizeMB = Math.round((keywordCount * avgEmbeddingSize * 8) / (1024 * 1024));
    console.log(`[categorization] Writing ${keywordCount} keywords (~${estimatedSizeMB} MB estimated) to temp file...`);

    try {
      const writeStream = fs.createWriteStream(inputPath, { encoding: 'utf8' });
      const writeChunk = async (chunk: string) => {
        if (!writeStream.write(chunk)) {
          await once(writeStream, 'drain');
        }
      };

      try {
        await writeChunk('{"categories":');
        await writeChunk(JSON.stringify(categories || []));
        await writeChunk(',"keywords":[');
        for (let i = 0; i < keywords.length; i++) {
          if (i > 0) await writeChunk(',');
          await writeChunk(JSON.stringify(keywords[i]));
        }
        await writeChunk(']');
        await writeChunk('}');
        writeStream.end();
        await once(writeStream, 'finish');
      } catch (streamErr) {
        writeStream.destroy();
        throw streamErr;
      }

      console.log(`[categorization] Successfully wrote input file: ${inputPath}`);
    } catch (writeErr: any) {
      console.error('[categorization] Failed to write input file:', writeErr?.message || writeErr);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: `Не удалось подготовить данные для категоризации (примерный размер: ~${estimatedSizeMB} MB). ${writeErr?.message || 'Unknown error'}`,
          status: 'WRITE_ERROR',
          debug: { keywordCount, estimatedSizeMB, error: writeErr?.message }
        });
      }
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      return;
    }

    let env = Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
    });

    const child = spawn(process.execPath, [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`], {
      env,
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
          w.webContents.send('keywords:categorization-error', {
            projectId,
            message: 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.',
          });
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
