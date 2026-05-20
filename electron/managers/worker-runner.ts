import { spawn, type ChildProcess } from 'node:child_process';

export type WorkerRunOptions = {
  name: string;
  workerPath: string;
  args: string[];
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  onJson?: (msg: any) => void;
  onStdErr?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

export type WorkerRunResult = {
  child: ChildProcess;
  stop: () => boolean;
};

export function runWorker(opts: WorkerRunOptions): WorkerRunResult {
  const child = spawn(process.execPath, [opts.workerPath, ...opts.args], {
    env: Object.assign({}, process.env, opts.env || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  let timeoutId: NodeJS.Timeout | null = null;
  let forceKillId: NodeJS.Timeout | null = null;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      try {
        stopChild('SIGTERM');
      } catch (_) {}
    }, opts.timeoutMs);
  }

  const stopChild = (signal: NodeJS.Signals) => {
    if (child.killed || child.exitCode !== null || child.signalCode !== null) return false;
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
      return true;
    } catch (_) {
      try {
        return child.kill(signal);
      } catch (_) {
        return false;
      }
    }
  };

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
        if (opts.onJson) opts.onJson(msg);
      } catch (_e) {
        // Non-JSON logs are ignored here; caller may handle separately if needed
      }
    }
  });

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (data: any) => {
    const text = String(data).trim();
    if (opts.onStdErr) opts.onStdErr(text);
  });

  child.on('exit', (code, signal) => {
    if (timeoutId) clearTimeout(timeoutId);
    if (forceKillId) clearTimeout(forceKillId);
    if (opts.onExit) opts.onExit(code, signal as NodeJS.Signals | null);
  });

  return {
    child,
    stop: () => {
      const signaled = stopChild('SIGTERM');
      if (signaled && !forceKillId) {
        forceKillId = setTimeout(() => {
          try {
            stopChild('SIGKILL');
          } catch (_) {}
        }, 5000);
      }
      return signaled;
    },
  };
}
