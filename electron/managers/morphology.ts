import { spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import type { ChildProcess } from 'node:child_process';
import { acquirePowerSaveBlocker, releasePowerSaveBlocker } from './utils.js';
import type { MorphologyCtx } from './types.js';

type ActiveJob = {
  child?: ChildProcess;
  abortController: AbortController;
  manuallyStopped?: boolean;
  powerBlockerId?: number | null;
};

const activeJobs = new Map<number, ActiveJob>();

function cleanupJob(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    releasePowerSaveBlocker(job.powerBlockerId);
    activeJobs.delete(projectId);
  }
  return job;
}

export function stopMorphologyWorker(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    console.log(`Stopping morphology worker for project ${projectId}`);
    job.manuallyStopped = true;
    job.abortController.abort();
    if (job.child) {
      job.child.kill();
    }
  }
}

export async function startMorphologyWorker(ctx: MorphologyCtx, projectId: number) {
  if (activeJobs.has(projectId)) {
    console.warn(`Morphology worker for project ${projectId} is already running.`);
    return;
  }

  const abortController = new AbortController();
  const powerBlockerId = acquirePowerSaveBlocker(`morphology:${projectId}`);
  activeJobs.set(projectId, { abortController, manuallyStopped: false, powerBlockerId });

  const { getWindow, resolvedDbPath } = ctx;
  const devCandidate = path.join(process.cwd(), 'electron', 'workers', 'morphologyWorker.cjs');
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'workers', 'morphologyWorker.cjs')
    : null;
  const workerPath = fs.existsSync(devCandidate)
    ? devCandidate
    : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);

  const emitProgress = (stage: string, payload: Record<string, any>) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:morphology-progress', {
        projectId,
        stage,
        ...payload,
      });
    }
  };

  console.log(`Starting morphology worker for project ${projectId}`);

  try {
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    };

    const child = spawn(process.execPath, [workerPath], {
      signal: abortController.signal,
      env,
    });

    activeJobs.get(projectId)!.child = child;

    // Парсим построчно, так как stdout может приходить пачками
    let stdoutBuffer = '';
    child.stdout?.on('data', (data) => {
      stdoutBuffer += data.toString();

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const message = JSON.parse(trimmed);
          if (message.type === 'progress') {
            emitProgress('processing', {
              processed: message.processed,
              total: message.total,
              percent: Math.round((message.processed / message.total) * 100),
            });
          } else if (message.type === 'complete') {
            emitProgress('complete', { percent: 100 });
          }
        } catch (e) {
          console.log('morphologyWorker stdout (unparsed):', trimmed);
        }
      }
    });

    child.stderr?.on('data', (data) => {
      console.error('morphologyWorker stderr:', data.toString());
    });

    child.on('exit', (code) => {
      console.log(`Morphology worker for project ${projectId} exited with code ${code}`);
      const job = cleanupJob(projectId);
      
      if (job?.manuallyStopped) {
        emitProgress('stopped', {});
      } else if (code !== 0) {
        emitProgress('error', { error: `Worker exited with code ${code}` });
      }
    });

    child.on('error', (err) => {
      console.error('[Morphology Worker Error]', err);
      cleanupJob(projectId);
      emitProgress('error', { error: err.message });
    });

    // Отправляем параметры воркеру
    child.stdin?.write(JSON.stringify({ projectId, dbPath: resolvedDbPath }) + '\n');
    child.stdin?.end();
  } catch (err: any) {
    console.error('[Morphology Worker Error]', err);
    cleanupJob(projectId);
    emitProgress('error', { error: err.message });
  }
}
