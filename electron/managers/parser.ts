import path from 'path';
import fs from 'fs';
import os from 'os';
import { type ChildProcess } from 'node:child_process';
import type { CrawlerCtx } from './types.js';
import { acquirePowerSaveBlocker, releasePowerSaveBlocker } from './utils.js';
import { runWorker, type WorkerRunResult } from './worker-runner.js';

type ParserEntry = {
  runner: WorkerRunResult;
  child: ChildProcess;
  powerBlockerId: number | null;
};

const parserChildren: Map<number, ParserEntry> = new Map();

export function isParserWorkerRunning(projectId?: number) {
  if (typeof projectId === 'number') {
    return parserChildren.has(projectId);
  }
  return parserChildren.size > 0;
}

function cleanupParserEntry(projectId: number) {
  const entry = parserChildren.get(projectId);
  if (entry) {
    releasePowerSaveBlocker(entry.powerBlockerId);
    parserChildren.delete(projectId);
  }
  return entry;
}

export function startParserWorker(
  ctx: CrawlerCtx,
  project: { id: number; crawler?: any; parser?: any; parserUrls?: string[] },
): boolean {
  const { getWindow, resolvedDbPath } = ctx;
  if (!project || !project.id) {
    console.warn('[ParserWorker] Invalid project payload', project);
    return false;
  }
  if (parserChildren.has(project.id)) {
    console.warn('[ParserWorker] Worker already running for project', project.id);
    return false;
  }
  if (!resolvedDbPath) {
    console.error('[ParserWorker] DB path not resolved');
    return false;
  }

  let powerBlockerId: number | null = null;
  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-'));
    const cfgPath = path.join(tmpDir, 'config.json');
    const payload = {
      projectId: project.id,
      crawlerConfig: project.crawler || {},
      parserConfig: Array.isArray(project.parser) ? project.parser : [],
      parserUrls: Array.isArray(project.parserUrls) ? project.parserUrls : [],
      dbPath: resolvedDbPath,
    };
    fs.writeFileSync(cfgPath, JSON.stringify(payload), 'utf8');

    const devCandidate = path.join(
      process.cwd(),
      'electron',
      'workers',
      'parserBatchWorker.cjs',
    );
    const packagedCandidate = process.resourcesPath
      ? path.join(
          process.resourcesPath,
          'app.asar',
          'electron',
          'workers',
          'parserBatchWorker.cjs',
        )
      : null;
    const workerPath = fs.existsSync(devCandidate)
      ? devCandidate
      : packagedCandidate && fs.existsSync(packagedCandidate)
        ? packagedCandidate
        : devCandidate;

    console.log('[ParserWorker] Spawning worker', {
      workerPath,
      projectId: project.id,
    });

    powerBlockerId = acquirePowerSaveBlocker(`parser:${project.id}`);

    const runner = runWorker({
      name: `parser:${project.id}`,
      workerPath,
      args: [`--config=${cfgPath}`],
      env: Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        PAGEVIEWER_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      onJson: (msg: any) => {
        const w = getWindow();
        if (!w || w.isDestroyed()) return;
        switch (msg.type) {
          case 'progress':
            w.webContents.send('crawler:progress', { projectId: project.id, ...msg });
            break;
          case 'finished':
            w.webContents.send('crawler:finished', { projectId: project.id, ...msg });
            break;
          case 'error':
            w.webContents.send('crawler:error', { projectId: project.id, ...msg });
            break;
          case 'row':
            w.webContents.send('crawler:row', { projectId: project.id, ...msg });
            break;
          case 'started':
            w.webContents.send('crawler:started', { projectId: project.id, ...msg });
            break;
          case 'render':
            w.webContents.send('crawler:render', { projectId: project.id, ...msg });
            break;
          default:
            break;
        }
      },
      onStdErr: (text: string) => {
        console.error('[ParserWorker ERR]', text);
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          w.webContents.send('crawler:error', { projectId: project.id, message: text });
        }
      },
      onExit: (code, signal) => {
        console.log('[ParserWorker] exit', { projectId: project.id, code, signal });
        cleanupParserEntry(project.id);
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}
      },
    });

    parserChildren.set(project.id, {
      runner,
      child: runner.child,
      powerBlockerId,
    });
    return true;
  } catch (e: any) {
    releasePowerSaveBlocker(powerBlockerId);
    console.error('[ParserWorker] Failed to start:', e?.message || e);
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('crawler:error', {
        projectId: project.id,
        message: e?.message || String(e),
      });
    }
    return false;
  }
}

export function stopParserWorker(projectId?: number) {
  if (typeof projectId === 'number') {
    const entry = parserChildren.get(projectId);
    if (entry && !entry.child.killed) {
      console.log('[ParserWorker] Stopping worker for project', projectId);
      entry.runner.stop();
      cleanupParserEntry(projectId);
    }
    return;
  }

  for (const [id, entry] of Array.from(parserChildren.entries())) {
    try {
      if (entry.child && !entry.child.killed) {
        console.log('[ParserWorker] Stopping worker for project', id);
        entry.runner.stop();
      }
    } catch (_) {}
    cleanupParserEntry(id);
  }
}
