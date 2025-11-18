import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'url';
import type { CrawlerCtx } from './types.js';

const crawlerChildren: Map<number, ChildProcess> = new Map();

export function startCrawlerWorker(ctx: CrawlerCtx, project: { id: number; url: string; crawler?: any; parser?: any }) {
  const { getWindow, resolvedDbPath } = ctx;
  if (!project || !project.id || !project.url) {
    console.warn('[CrawlerWorker] Invalid project payload', project);
    return;
  }
  if (crawlerChildren.has(project.id)) {
    console.warn('[CrawlerWorker] Worker already running for project', project.id);
    return;
  }
  if (!resolvedDbPath) {
    console.error('[CrawlerWorker] DB path not resolved');
    return;
  }
  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawler-'));
    const cfgPath = path.join(tmpDir, 'config.json');
    const payload = {
      projectId: project.id,
      startUrl: project.url,
      crawlerConfig: project.crawler || {},
      parserConfig: Array.isArray(project.parser) ? project.parser : [],
      dbPath: resolvedDbPath,
    };
    fs.writeFileSync(cfgPath, JSON.stringify(payload), 'utf8');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const workerPath = path.join(__dirname, '..', 'worker', 'crawlerWorker.cjs');
    console.log('[CrawlerWorker] Spawning worker', { workerPath, projectId: project.id, url: project.url });
    const child = spawn(process.execPath, [workerPath, `--config=${cfgPath}`], {
      env: Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    crawlerChildren.set(project.id, child);
    child.stdout?.setEncoding('utf8');
    let buf = '';
    child.stdout?.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line.trim());
          const w = getWindow();
          if (w && !w.isDestroyed()) {
            switch (msg.type) {
              case 'progress':
                w.webContents.send('crawler:progress', { projectId: project.id, ...msg });
                break;
              case 'queue':
                w.webContents.send('crawler:queue', { projectId: project.id, ...msg });
                break;
              case 'finished':
                w.webContents.send('crawler:finished', { projectId: project.id, ...msg });
                break;
              case 'error':
                w.webContents.send('crawler:error', { projectId: project.id, ...msg });
                break;
              case 'url':
                w.webContents.send('crawler:url', { projectId: project.id, ...msg });
                break;
              case 'row':
                w.webContents.send('crawler:row', { projectId: project.id, ...msg });
                break;
              case 'stat':
                w.webContents.send('crawler:stat', { projectId: project.id, ...msg });
                break;
              default:
                break;
            }
          }
        } catch (_e) {
          console.log('[CrawlerWorker]', line.trim());
        }
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data: any) => {
      const text = String(data).trim();
      console.error('[CrawlerWorker ERR]', text);
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('crawler:error', { projectId: project.id, message: text });
      }
    });
    child.on('exit', (code, signal) => {
      console.log('[CrawlerWorker] exit', { projectId: project.id, code, signal });
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('crawler:finished', { projectId: project.id, code, signal });
      }
      try { crawlerChildren.delete(project.id); } catch (_) {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    });
  } catch (e: any) {
    console.error('[CrawlerWorker] Failed to start:', e?.message || e);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('crawler:error', { projectId: project.id, message: e?.message || String(e) });
    }
  }
}

export function stopCrawlerWorker(projectId?: number) {
  if (typeof projectId === 'number') {
    const child = crawlerChildren.get(projectId);
    if (child && !child.killed) {
      console.log('[CrawlerWorker] Stopping worker for project', projectId);
      child.kill('SIGTERM');
      crawlerChildren.delete(projectId);
    }
    return;
  }
  // Stop all
  for (const [id, child] of Array.from(crawlerChildren.entries())) {
    try {
      if (child && !child.killed) {
        console.log('[CrawlerWorker] Stopping worker for project', id);
        child.kill('SIGTERM');
      }
    } catch (e) {}
    crawlerChildren.delete(id);
  }
}
