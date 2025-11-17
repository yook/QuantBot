import type Database from 'better-sqlite3';
import type { BrowserWindow } from 'electron';

export type BaseWorkerCtx = {
  db: Database.Database;
  getWindow: () => BrowserWindow | null;
  resolvedDbPath: string | null;
};

export type CategorizationCtx = BaseWorkerCtx & {
  categoriesNameColumn: string;
};

export type TypingCtx = BaseWorkerCtx & {
  typingLabelColumn: string;
  typingTextColumn: string;
  typingDateColumn: string | null;
};

export type ClusteringCtx = BaseWorkerCtx;
export type CrawlerCtx = BaseWorkerCtx;
