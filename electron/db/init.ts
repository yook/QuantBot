import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { getDatabasePath } from '../db-path.js';
import { initSchema } from './schema.js';

export type DbInitResult = {
  db: Database.Database;
  dbPath: string;
  categoriesNameColumn: string;
  typingLabelColumn: string;
  typingTextColumn: string;
  typingDateColumn: string | null;
};

export function createDatabase(opts: { isDev: boolean }): DbInitResult {
  const { isDev } = opts;

  // Resolve database path using shared helper
  const dbPath = getDatabasePath(isDev);

  // Ensure directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Expose path to other modules/processes
  process.env.QUANTBOT_DB_DIR = dbDir;
  process.env.DB_PATH = dbPath;

  // Write a small log file to help debugging
  try {
    const dbLogPath = path.join(dbDir, 'db-path.log');
    const logContent = `[Main] DB path: ${dbPath}\nstartedAt: ${new Date().toISOString()}\n`;
    fs.writeFileSync(dbLogPath, logContent, { encoding: 'utf8' });
  } catch (err) {
    // non-fatal
  }

  // Open database
  const db = new Database(dbPath);

  // Pragmas tuned for desktop/local workloads
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -200000');
  db.pragma('mmap_size = 268435456');
  db.pragma('auto_vacuum = INCREMENTAL');
  db.pragma('temp_store = MEMORY');

  // Initialize schema and capture detected compatibility columns
  const {
    categoriesNameColumn,
    typingLabelColumn,
    typingTextColumn,
    typingDateColumn,
  } = initSchema(db);

  return {
    db,
    dbPath,
    categoriesNameColumn,
    typingLabelColumn,
    typingTextColumn,
    typingDateColumn,
  };
}
