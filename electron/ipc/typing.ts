import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function registerTypingIpc(ctx: IpcContext) {
  const { db, typingLabelColumn, typingTextColumn, typingDateColumn } = ctx;

  ipcMain.handle('db:typing:getAll', async (_event, projectId) => {
    try {
      const dateAlias = typingDateColumn ? `${typingDateColumn} AS date,` : '';
      const result = db.prepare(`SELECT id, project_id, ${typingLabelColumn} AS label, ${typingTextColumn} AS text, ${dateAlias} created_at FROM typing_samples WHERE project_id = ?`).all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:insert', async (_event, projectId, urlOrLabel, sampleOrText, date) => {
    try {
      const cols = ['project_id', typingLabelColumn, typingTextColumn];
      const vals: any[] = [projectId, urlOrLabel, sampleOrText];
      if (typingDateColumn) { cols.push(typingDateColumn); vals.push(date); }
      const placeholders = cols.map(() => '?').join(', ');
      const info = db.prepare(`INSERT INTO typing_samples (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
      if (!info || info.changes === 0) {
        return { success: false, error: 'No typing sample inserted' };
      }
      const dateAlias = typingDateColumn ? `${typingDateColumn} AS date,` : '';
      const inserted = db.prepare(`SELECT id, project_id, ${typingLabelColumn} AS label, ${typingTextColumn} AS text, ${dateAlias} created_at FROM typing_samples WHERE id = ?`).get(info.lastInsertRowid);
      return { success: true, data: inserted };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:update', async (_event, urlOrLabel, sampleOrText, date, id) => {
    try {
      const sets: string[] = [`${typingLabelColumn} = ?`, `${typingTextColumn} = ?`];
      const args: any[] = [urlOrLabel, sampleOrText];
      if (typingDateColumn) { sets.push(`${typingDateColumn} = ?`); args.push(date); }
      args.push(id);
      const result = db.prepare(`UPDATE typing_samples SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:delete', async (_event, id) => {
    try {
      const result = db.prepare('DELETE FROM typing_samples WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:deleteByProject', async (_event, projectId) => {
    try {
      const result = db.prepare('DELETE FROM typing_samples WHERE project_id = ?').run(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
