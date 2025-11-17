import path from 'path';
import fs from 'fs';
import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function registerUrlsIpc(ctx: IpcContext) {
  const { db, getWindow, resolvedDbPath } = ctx;

  ipcMain.handle('db:urls:getAll', async (_event, projectId) => {
    try {
      const result = db.prepare('SELECT * FROM urls WHERE project_id = ?').all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:getSorted', async (_event, options) => {
    try {
      const project_id = options.id;
      const limit = options.limit || 50;
      const offset = options.skip || 0;
      const dbTable = options.db || 'urls';

      let sortBy = 'id';
      let order = 'ASC';
      if (options.sort && typeof options.sort === 'object') {
        const sortKeys = Object.keys(options.sort);
        if (sortKeys.length > 0) {
          sortBy = sortKeys[0];
          order = options.sort[sortBy] === -1 ? 'DESC' : 'ASC';
        }
      }

      let sql: string;
      let params: any[];
      const limitClause = limit > 0 ? `LIMIT ? OFFSET ?` : '';

      if (dbTable === 'disallow') {
        sql = `SELECT * FROM disallowed WHERE project_id = ? ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, limit, offset] : [project_id];
      } else if (dbTable === 'urls') {
        sql = `SELECT * FROM urls WHERE project_id = ? ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, limit, offset] : [project_id];
      } else {
        sql = `SELECT * FROM urls WHERE project_id = ? AND type = ? ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, dbTable, limit, offset] : [project_id, dbTable];
      }

      const result = db.prepare(sql).all(...params);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:count', async (_event, projectId) => {
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM urls WHERE project_id = ?').get(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:getAllForExport', async (_event, options) => {
    try {
      const project_id = options.id;
      const dbTable = options.db || 'urls';

      let sortBy = 'id';
      let order = 'ASC';
      if (options.sort && typeof options.sort === 'object') {
        const sortKeys = Object.keys(options.sort);
        if (sortKeys.length > 0) {
          sortBy = sortKeys[0];
          order = options.sort[sortBy] === -1 ? 'DESC' : 'ASC';
        }
      }

      let sql: string;
      let params: any[];
      if (dbTable === 'disallow') {
        sql = `SELECT * FROM disallowed WHERE project_id = ? ORDER BY ${sortBy} ${order}`;
        params = [project_id];
      } else if (dbTable === 'urls') {
        sql = `SELECT * FROM urls WHERE project_id = ? ORDER BY ${sortBy} ${order}`;
        params = [project_id];
      } else {
        sql = `SELECT * FROM urls WHERE project_id = ? AND type = ? ORDER BY ${sortBy} ${order}`;
        params = [project_id, dbTable];
      }

      const result = db.prepare(sql).all(...params);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:crawler:clear', async (_event, projectId) => {
    try {
      const infoUrls = db.prepare('DELETE FROM urls WHERE project_id = ?').run(projectId);
      let disallowedDeleted = 0;
      try {
        const infoDis = db.prepare('DELETE FROM disallowed WHERE project_id = ?').run(projectId);
        disallowedDeleted = infoDis?.changes || 0;
      } catch (_e) {}
      try {
        db.prepare('UPDATE projects SET queue_size = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);
      } catch (_e) {}
      const payload = { projectId, urlsDeleted: infoUrls?.changes || 0, disallowedDeleted };
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('crawler:data-cleared', payload);
      }
      return { success: true, data: payload };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('crawler:queue:clear', async (_event, projectId) => {
    try {
      if (!resolvedDbPath) {
        return { success: false, error: 'DB path is not resolved' };
      }
      const dbDir = path.dirname(resolvedDbPath);
      const queueDir = path.join(dbDir, String(projectId));
      const queueFile = path.join(queueDir, 'queue');
      try { fs.rmSync(queueFile, { force: true }); } catch {}
      try {
        const files = fs.readdirSync(queueDir);
        if (!files || files.length === 0) { fs.rmdirSync(queueDir); }
      } catch {}
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('crawler:queue:cleared', { projectId });
      }
      return { success: true, data: { projectId } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
