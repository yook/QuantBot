/**
 * Unified database path resolution for all modules
 * Ensures main process, workers, and socket helpers use the same DB file
 */
import path from 'path';
import os from 'os';

/**
 * Get the database file path
 * This function must return the same path in all contexts:
 * - Main Electron process
 * - Worker processes
 * - Socket helper modules
 */
export function getDatabasePath(isDev: boolean = false): string {
  // Allow override via environment variable
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }

  // In development mode, use local db folder for easier debugging
  if (isDev) {
    const repoRoot = process.env.APP_ROOT || process.cwd();
    return path.join(repoRoot, 'db', 'quantbot.db');
  }

  // In production, use user's home directory
  const userDataPath = path.join(os.homedir(), '.quantbot');
  return path.join(userDataPath, 'quantbot.db');
}

/**
 * Get the database directory path (for QUANTBOT_DB_DIR env var)
 */
export function getDatabaseDir(isDev: boolean = false): string {
  return path.dirname(getDatabasePath(isDev));
}
