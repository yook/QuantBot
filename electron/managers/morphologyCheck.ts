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

export function stopMorphologyCheckWorker(projectId: number) {
  const job = activeJobs.get(projectId);
  if (job) {
    console.log(`Stopping morphology check worker for project ${projectId}`);
    job.manuallyStopped = true;
    job.abortController.abort();
    if (job.child) {
      job.child.kill();
    }
  }
}

export async function startMorphologyCheckWorker(ctx: MorphologyCtx, projectId: number) {
  if (activeJobs.has(projectId)) {
    console.warn(`Morphology check worker for project ${projectId} is already running.`);
    return;
  }

  const abortController = new AbortController();
  const powerBlockerId = acquirePowerSaveBlocker(`morphology-check:${projectId}`);
  activeJobs.set(projectId, { abortController, manuallyStopped: false, powerBlockerId });

  const { getWindow, resolvedDbPath } = ctx;
  const devCandidate = path.join(process.cwd(), 'electron', 'workers', 'morphologyCheck.cjs');
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'workers', 'morphologyCheck.cjs')
    : null;
  const workerPath = fs.existsSync(devCandidate)
    ? devCandidate
    : (packagedCandidate && fs.existsSync(packagedCandidate) ? packagedCandidate : devCandidate);

  const emitProgress = (stage: string, payload: Record<string, any>) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('keywords:morphology-check-progress', {
        projectId,
        stage,
        ...payload,
      });
    }
  };

  console.log(`Starting morphology check worker for project ${projectId}`);

  try {
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    };

    const child = spawn(process.execPath, [workerPath], {
      signal: abortController.signal,
      env,
    });

    const job = activeJobs.get(projectId);
    if (job) job.child = child;

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
          if (message.type === 'processing') {
            emitProgress('processing', {
              processed: message.processed,
              total: message.total,
              percent: message.percent ?? (message.total ? Math.round((message.processed / message.total) * 100) : 100),
            });
          } else if (message.type === 'complete') {
            emitProgress('complete', {
              processed: message.processed,
              total: message.total,
              percent: 100,
            });
          } else if (message.type === 'error') {
            emitProgress('error', { error: message.message || trimmed, detail: message.detail });
          } else if (message.type === 'stopped') {
            emitProgress('stopped', {});
          }
        } catch (_e) {
          console.log('morphologyCheck stdout (unparsed):', trimmed);
        }
      }
    });

    child.stderr?.on('data', (data) => {
      console.error('morphologyCheck stderr:', data.toString());
    });

    child.on('exit', (code) => {
      console.log(`Morphology check worker for project ${projectId} exited with code ${code}`);
      const jobState = cleanupJob(projectId);
      if (jobState?.manuallyStopped) {
        emitProgress('stopped', {});
      } else if (code !== 0) {
        emitProgress('error', { error: `Worker exited with code ${code}` });
      } else {
        emitProgress('complete', { percent: 100 });
      }
    });

    child.on('error', (err) => {
      console.error('[Morphology Check Worker Error]', err);
      cleanupJob(projectId);
      emitProgress('error', { error: err.message });
    });

    child.stdin?.write(JSON.stringify({ projectId, dbPath: resolvedDbPath }) + '\n');
    child.stdin?.end();
  } catch (err: any) {
    console.error('[Morphology Check Worker Error]', err);
    cleanupJob(projectId);
    emitProgress('error', { error: err.message });
  }
}
