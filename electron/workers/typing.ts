import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import type { TypingCtx } from './types.js';

export async function startTypingWorker(ctx: TypingCtx, projectId: number) {
  const { db, getWindow, resolvedDbPath, typingLabelColumn, typingTextColumn, typingDateColumn } = ctx;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const devCandidate = path.join(process.cwd(), 'worker', 'trainAndClassify.cjs');
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'worker', 'trainAndClassify.cjs')
    : null;
  const workerPath = fs.existsSync(devCandidate)
    ? devCandidate
    : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);
  const win = getWindow();

  console.log(`Starting typing worker for project ${projectId}`);

  try {
    const dateAlias = typingDateColumn ? `${typingDateColumn} AS date,` : '';
    const typingSamples = db.prepare(`SELECT id, project_id, ${typingLabelColumn} AS label, ${typingTextColumn} AS text, ${dateAlias} created_at FROM typing_samples WHERE project_id = ?`).all(projectId);
    const keywords = db.prepare('SELECT * FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1)').all(projectId) as any[];

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
        return;
      }
    } catch (e) {
      console.warn('[Typing] Failed to check typing_samples labels count', e);
    }

    if (!keywords || keywords.length === 0) {
      console.warn(`Не найдены целевые ключевые слова для проекта ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:typing-error', { projectId, messageKey: 'keywords.noTargetKeywords', message: 'Не найдены целевые ключевые слова для проекта' });
        }
      return;
    }

    // Clear previous classification (class_name / class_similarity) for the project to avoid stale values
    try {
      db.prepare('UPDATE keywords SET class_name = NULL, class_similarity = NULL WHERE project_id = ?').run(projectId);
    } catch (e) {
      console.warn('[Typing] Failed to clear previous class values', e);
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
