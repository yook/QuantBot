import type Database from 'better-sqlite3';
import type { BrowserWindow } from 'electron';

export type BaseWorkerCtx = {
  db: Database.Database;
  getWindow: () => BrowserWindow | null;
  resolvedDbPath: string | null;
};

export type CrawlerCtx = BaseWorkerCtx;
