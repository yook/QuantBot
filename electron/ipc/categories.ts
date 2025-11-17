import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function registerCategoriesIpc(ctx: IpcContext) {
  const { db, categoriesNameColumn } = ctx;

  ipcMain.handle('db:categories:getAll', async (_event, projectId) => {
    try {
      const result = db.prepare(`SELECT id, project_id, ${categoriesNameColumn} AS category_name, created_at FROM categories WHERE project_id = ?`).all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:insert', async (_event, name, projectId) => {
    try {
      const info = db.prepare(`INSERT INTO categories (${categoriesNameColumn}, project_id) VALUES (?, ?)`).run(name, projectId);
      if (!info || info.changes === 0) {
        return { success: false, error: 'No rows inserted (duplicate?)' };
      }
      const inserted = db.prepare(`SELECT id, project_id, ${categoriesNameColumn} AS category_name, created_at FROM categories WHERE id = ?`).get(info.lastInsertRowid);
      return { success: true, data: inserted };
    } catch (error: any) {
      const msg = error?.message || String(error);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('db:categories:update', async (_event, name, id) => {
    try {
      const result = db.prepare(`UPDATE categories SET ${categoriesNameColumn} = ? WHERE id = ?`).run(name, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:delete', async (_event, id) => {
    try {
      const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
