import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import newProjectDefaults from '../../src/stores/schema/new-project.json' assert { type: 'json' };

export function registerProjectsIpc(ctx: IpcContext) {
  const { db } = ctx;

  ipcMain.handle('db:projects:getAll', async () => {
    try {
      const result = db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:get', async (_event, id) => {
    try {
      const row: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (!row) return { success: true, data: null };
      const parseJson = (val: any, fallback: any) => {
        if (val === null || typeof val === 'undefined') return fallback;
        if (typeof val === 'object') return val;
        if (typeof val === 'string') {
          const s = val.trim();
          if (!s) return fallback;
          try { return JSON.parse(s); } catch { return fallback; }
        }
        return fallback;
      };
      const crawlerFromDb = parseJson(row.crawler, {});
      const crawler = { ...newProjectDefaults.crawler, ...crawlerFromDb };
      const parserFromDb = parseJson(row.parser, []);
      const parser = Array.isArray(parserFromDb) && parserFromDb.length > 0 ? parserFromDb : newProjectDefaults.parser;
      const data = {
        ...row,
        crawler,
        parser,
        columns: parseJson(row.ui_columns, newProjectDefaults.columns || {}),
        stats: parseJson(row.stats, newProjectDefaults.stats || null),
      };
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:insert', async (_event, name, url) => {
    try {
      const defaultCrawler = JSON.stringify(newProjectDefaults.crawler || {});
      const defaultParser = JSON.stringify(newProjectDefaults.parser || []);
      const defaultStats = JSON.stringify(newProjectDefaults.stats || {});
      const defaultColumns = JSON.stringify(newProjectDefaults.columns || {});
      const result = db.prepare(
        'INSERT INTO projects (name, url, crawler, parser, stats, ui_columns) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(name, url, defaultCrawler, defaultParser, defaultStats, defaultColumns);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:update', async (_event, name, url, id) => {
    try {
      const result = db.prepare('UPDATE projects SET name = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, url, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:updateConfigs', async (_event, id, crawler, parser, columns, stats) => {
    try {
      const pid = typeof id === 'number' ? id : Number(id);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid project id' };
      }
      const crawlerJson = JSON.stringify(crawler ?? {});
      const parserJson = JSON.stringify(Array.isArray(parser) ? parser : []);
      const columnsJson = JSON.stringify(columns ?? {});
      const statsJson = stats ? JSON.stringify(stats) : null;
      const stmt = db.prepare('UPDATE projects SET crawler = ?, parser = ?, ui_columns = ?, stats = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      const result = stmt.run(crawlerJson, parserJson, columnsJson, statsJson, pid);
      return { success: true, data: { changes: result.changes } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:delete', async (_event, id) => {
    try {
      const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
