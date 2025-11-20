import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import type { TypingCtx } from './types.js';

export async function startTypingWorker(ctx: TypingCtx, projectId: number) {
  const { db, getWindow, resolvedDbPath, typingLabelColumn, typingTextColumn, typingDateColumn } = ctx;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const workerPath = path.join(__dirname, '..', 'worker', 'trainAndClassify.cjs');
  const win = getWindow();

  console.log(`Starting typing worker for project ${projectId}`);

  try {
    const dateAlias = typingDateColumn ? `${typingDateColumn} AS date,` : '';
    const typingSamples = db.prepare(`SELECT id, project_id, ${typingLabelColumn} AS label, ${typingTextColumn} AS text, ${dateAlias} created_at FROM typing_samples WHERE project_id = ?`).all(projectId);
    const keywords = db.prepare('SELECT * FROM keywords WHERE project_id = ? AND target_query = 1').all(projectId) as any[];

    // Проверяем, задано ли достаточное количество классов (категорий) для обучения/классификации
    try {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM categories WHERE project_id = ?').get(projectId);
      const catCount = Number((row as any)?.cnt ?? (row as any)?.count ?? (row as any)?.COUNT ?? (row as any)?.CNT ?? 0);
      if (catCount < 2) {
        console.warn(`[Typing] Not enough categories for project ${projectId}: ${catCount}`);
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:typing-error', {
            projectId,
            message: 'Задайте не менее двух классов для классификации.',
          });
        }
        return;
      }
    } catch (e) {
      console.warn('[Typing] Failed to check categories count', e);
    }

    if (!keywords || keywords.length === 0) {
      console.warn(`No target keywords (target_query=1) found for project ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:typing-error', { projectId, message: 'No target keywords (target_query=1) found for project' });
      }
      return;
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'typing-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
    const input = JSON.stringify({ typingSamples: typingSamples || [], keywords: keywords || [] });
    await fs.promises.writeFile(inputPath, input, 'utf8');

    console.log(`[Typing] workerPath: ${workerPath}, resolvedDbPath: ${resolvedDbPath}`);
    try {
      const exists = fs.existsSync(workerPath);
      console.log(`[Typing] workerPath exists: ${exists}`);
      if (!exists) {
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          w.webContents.send('keywords:typing-error', { projectId, message: `Worker файл не найден: ${workerPath}` });
        }
        return;
      }
    } catch (e) {
      console.warn('[Typing] Failed to stat workerPath', e);
    }

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
        console.log(`[Typing Worker ${projectId}]`, line);
        try {
          const obj = JSON.parse(line);
          processed++;
          const cname = obj.bestCategoryName ?? obj.className ?? null;
          if (obj.id && cname !== null) {
            db.prepare('UPDATE keywords SET class_name = ?, class_similarity = ? WHERE id = ?')
              .run(cname, obj.similarity ?? null, obj.id);
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
          if (keywords && keywords.length > 0) {
            const progress = Math.round((processed / keywords.length) * 100);
            const w = getWindow();
            if (w && !w.isDestroyed()) {
              w.webContents.send('keywords:typing-progress', { projectId, progress });
            }
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
      console.log(`Typing worker exited with code ${code}, signal ${signal}`);
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      const w = getWindow();
      if (w && !w.isDestroyed()) {
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
    console.error('Failed to start typing worker:', error);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:typing-error', { projectId, message: error.message || 'Failed to start worker' });
    }
  }
}
