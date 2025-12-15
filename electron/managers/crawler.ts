import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, type ChildProcess } from 'node:child_process';
// fileURLToPath not required here
import type { CrawlerCtx } from './types.js';
import { acquirePowerSaveBlocker, releasePowerSaveBlocker } from './utils.js';
type CrawlerEntry = { child: ChildProcess; powerBlockerId: number | null };
const crawlerChildren: Map<number, CrawlerEntry> = new Map();

function cleanupCrawlerEntry(projectId: number) {
  const entry = crawlerChildren.get(projectId);
  if (entry) {
    releasePowerSaveBlocker(entry.powerBlockerId);
    crawlerChildren.delete(projectId);
  }
  return entry;
}

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
  let powerBlockerId: number | null = null;
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
    const devCandidate = path.join(process.cwd(), 'electron', 'workers', 'crawlerWorker.cjs');
    const packagedCandidate = process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'workers', 'crawlerWorker.cjs')
      : null;
    const workerPath = fs.existsSync(devCandidate)
      ? devCandidate
      : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);
    console.log('[CrawlerWorker] Spawning worker', { workerPath, projectId: project.id, url: project.url });
    powerBlockerId = acquirePowerSaveBlocker(`crawler:${project.id}`);
    const child = spawn(process.execPath, [workerPath, `--config=${cfgPath}`], {
      env: Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    crawlerChildren.set(project.id, { child, powerBlockerId });
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
      cleanupCrawlerEntry(project.id);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    });
  } catch (e: any) {
    releasePowerSaveBlocker(powerBlockerId);
    console.error('[CrawlerWorker] Failed to start:', e?.message || e);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('crawler:error', { projectId: project.id, message: e?.message || String(e) });
    }
  }
}

export function stopCrawlerWorker(projectId?: number) {
  if (typeof projectId === 'number') {
    const entry = crawlerChildren.get(projectId);
    if (entry && !entry.child.killed) {
      console.log('[CrawlerWorker] Stopping worker for project', projectId);
      entry.child.kill('SIGTERM');
      cleanupCrawlerEntry(projectId);
    }
    return;
  }
  // Stop all
  for (const [id, entry] of Array.from(crawlerChildren.entries())) {
    try {
      if (entry.child && !entry.child.killed) {
        console.log('[CrawlerWorker] Stopping worker for project', id);
        entry.child.kill('SIGTERM');
      }
    } catch (e) {}
    cleanupCrawlerEntry(id);
  }
}
