import path from 'path';
import fs from 'fs';
import os from 'os';
import { type ChildProcess } from 'node:child_process';
// fileURLToPath not required here
import type { CrawlerCtx } from './types.js';
import { acquirePowerSaveBlocker, releasePowerSaveBlocker } from './utils.js';
import { runWorker, type WorkerRunResult } from './worker-runner.js';
type CrawlerEntry = { runner: WorkerRunResult; child: ChildProcess; powerBlockerId: number | null };
const crawlerChildren: Map<number, CrawlerEntry> = new Map();

export function isCrawlerWorkerRunning(projectId?: number) {
  if (typeof projectId === 'number') {
    return crawlerChildren.has(projectId);
  }
  return crawlerChildren.size > 0;
}

function cleanupCrawlerEntry(projectId: number) {
  const entry = crawlerChildren.get(projectId);
  if (entry) {
    releasePowerSaveBlocker(entry.powerBlockerId);
    crawlerChildren.delete(projectId);
  }
  return entry;
}

export function startCrawlerWorker(ctx: CrawlerCtx, project: { id: number; url: string; crawler?: any; parser?: any }): boolean {
  const { getWindow, resolvedDbPath } = ctx;
  if (!project || !project.id || !project.url) {
    console.warn('[CrawlerWorker] Invalid project payload', project);
    return false;
  }
  if (crawlerChildren.has(project.id)) {
    console.warn('[CrawlerWorker] Worker already running for project', project.id);
    return false;
  }
  if (!resolvedDbPath) {
    console.error('[CrawlerWorker] DB path not resolved');
    return false;
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
      ? path.join(process.resourcesPath, 'app.asar', 'electron', 'workers', 'crawlerWorker.cjs')
      : null;
    const workerPath = fs.existsSync(devCandidate)
      ? devCandidate
      : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);
    console.log('[CrawlerWorker] Spawning worker', { workerPath, projectId: project.id, url: project.url });
    powerBlockerId = acquirePowerSaveBlocker(`crawler:${project.id}`);
    const crawlerTimeoutMs =
      typeof (project.crawler && project.crawler.timeoutMs) === 'number'
        ? Number(project.crawler.timeoutMs)
        : 0;
    const runner = runWorker({
      name: `crawler:${project.id}`,
      workerPath,
      args: [`--config=${cfgPath}`],
      timeoutMs: crawlerTimeoutMs > 0 ? crawlerTimeoutMs : undefined,
      env: Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        PAGEVIEWER_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      onJson: (msg: any) => {
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
              if (msg && msg.stat) {
                w.webContents.send(`crawler:stat:${msg.stat}`, { projectId: project.id, ...msg });
              }
              break;
            case 'started':
              w.webContents.send('crawler:started', { projectId: project.id, ...msg });
              break;
            case 'render':
              w.webContents.send('crawler:render', { projectId: project.id, ...msg });
              break;
            case 'limit_reached':
              w.webContents.send('crawler:limit', { projectId: project.id, ...msg });
              break;
            default:
              break;
          }
        }
      },
      onStdErr: (text: string) => {
        console.error('[CrawlerWorker ERR]', text);
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          w.webContents.send('crawler:error', { projectId: project.id, message: text });
        }
      },
      onExit: (code, signal) => {
        console.log('[CrawlerWorker] exit', { projectId: project.id, code, signal });
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          w.webContents.send('crawler:finished', { projectId: project.id, code, signal });
        }
        cleanupCrawlerEntry(project.id);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      },
    });
    const child = runner.child;
    crawlerChildren.set(project.id, { runner, child, powerBlockerId });
    return true;
  } catch (e: any) {
    releasePowerSaveBlocker(powerBlockerId);
    console.error('[CrawlerWorker] Failed to start:', e?.message || e);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('crawler:error', { projectId: project.id, message: e?.message || String(e) });
    }
    return false;
  }
}

export function stopCrawlerWorker(projectId?: number) {
  if (typeof projectId === 'number') {
    const entry = crawlerChildren.get(projectId);
    if (entry && !entry.child.killed) {
      console.log('[CrawlerWorker] Stopping worker for project', projectId);
      const signaled = entry.runner.stop();
      return { stopped: signaled, projectId };
    }
    return { stopped: false, projectId, error: 'Crawler worker is not running for this project' };
  }
  // Stop all
  let stopped = 0;
  for (const [id, entry] of Array.from(crawlerChildren.entries())) {
    try {
      if (entry.child && !entry.child.killed) {
        console.log('[CrawlerWorker] Stopping worker for project', id);
        if (entry.runner.stop()) stopped += 1;
      }
    } catch (e) {}
  }
  return { stopped: stopped > 0, stoppedCount: stopped };
}
