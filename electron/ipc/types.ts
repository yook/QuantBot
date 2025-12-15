import type Database from 'better-sqlite3';
import type { BrowserWindow } from 'electron';

export type IpcContext = {
  db: Database.Database;
  getWindow: () => BrowserWindow | null;
  resolvedDbPath: string | null;
  typingLabelColumn: string;
  typingTextColumn: string;
  typingDateColumn: string | null;
};
