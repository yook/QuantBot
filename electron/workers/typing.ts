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
    child.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      console.error(`[Typing Worker ${projectId} ERROR]`, text);
      const w = getWindow();
      if (/429/.test(text) || /rate limit/i.test(text)) {
        if (w && !w.isDestroyed()) {
          w.webContents.send('keywords:typing-error', { projectId, status: 429, message: 'Request failed with status code 429' });
        }
      }
    });

    child.on('exit', async (code) => {
      console.log(`Typing worker exited with code ${code}`);
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        if (code === 0) {
          w.webContents.send('keywords:typing-finished', { projectId });
        } else {
          w.webContents.send('keywords:typing-error', { projectId, message: `Worker exited with code ${code}` });
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
