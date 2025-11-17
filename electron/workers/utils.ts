export function isRateLimitError(err: any): boolean {
  try {
    const msg = (err && (err.message || err.toString())) || '';
    const status = (err && (err.status || err.code)) || null;
    return /429/.test(String(msg)) || String(status) === '429' || /rate limit/i.test(msg);
  } catch (_e) {
    return false;
  }
}
