import { powerSaveBlocker } from 'electron';

export function acquirePowerSaveBlocker(reason: string): number | null {
  try {
    const id = powerSaveBlocker.start('prevent-app-suspension');
    console.log(`[PowerSave] Enabled (${reason}) id=${id}`);
    return id;
  } catch (err) {
    console.warn(`[PowerSave] Failed to enable (${reason})`, err);
    return null;
  }
}

export function releasePowerSaveBlocker(id?: number | null): void {
  if (typeof id !== 'number') return;
  try {
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id);
      console.log(`[PowerSave] Released id=${id}`);
    }
  } catch (err) {
    console.warn(`[PowerSave] Failed to release id=${id}`, err);
  }
}

export function isRateLimitError(err: any): boolean {
  try {
    const msg = (err && (err.message || err.toString())) || '';
    const status = (err && (err.status || err.code)) || null;
    return /429/.test(String(msg)) || String(status) === '429' || /rate limit/i.test(msg);
  } catch (_e) {
    return false;
  }
}
