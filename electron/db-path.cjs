/**
 * Unified database path resolution for all modules (CommonJS version)
 * Ensures main process, workers, and socket helpers use the same DB file
 */
const path = require('path');
const os = require('os');

/**
 * Get the database file path
 * This function must return the same path in all contexts:
 * - Main Electron process
 * - Worker processes
 * - Socket helper modules
 */
function getDatabasePath(isDev = false) {
  // Allow override via environment variable
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }

  // Check if we're in dev mode via VITE_DEV_SERVER_URL or explicit flag
  const isDevMode = isDev || process.env.VITE_DEV_SERVER_URL;

  // In development mode, use local db folder for easier debugging
  if (isDevMode) {
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
function getDatabaseDir(isDev = false) {
  return path.dirname(getDatabasePath(isDev));
}

module.exports = {
  getDatabasePath,
  getDatabaseDir,
};
