import path from 'path';
import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export function registerStopwordsIpc(ctx: IpcContext) {
  const { db } = ctx;

  ipcMain.handle('db:stopwords:getAll', async (_event, projectId) => {
    try {
      const result = db.prepare('SELECT * FROM stop_words WHERE project_id = ?').all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:insert', async (_event, projectId, word) => {
    try {
      if (!db) {
        return { success: false, error: 'Database not initialized' };
      }
      const result = db.prepare('INSERT OR IGNORE INTO stop_words (project_id, word) VALUES (?, ?)').run(projectId, word);

      try {
        const facadePath = path.join(process.env.APP_ROOT || path.join(path.dirname(new URL(import.meta.url).pathname), '..'), 'electron', 'db', 'index.cjs');
        const dbFacade = require(facadePath);
        if (dbFacade && dbFacade.keywords && typeof dbFacade.keywords.applyStopWords === 'function') {
          await dbFacade.keywords.applyStopWords(projectId);
        } else if (dbFacade && typeof dbFacade.keywordsApplyStopWords === 'function') {
          await dbFacade.keywordsApplyStopWords(projectId);
        }
      } catch (e) {
        console.error('[IPC] Error applying stop-words after insert:', e);
      }
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:delete', async (_event, id) => {
    try {
      const row: any = db.prepare('SELECT project_id FROM stop_words WHERE id = ?').get(id);
      const projectId = row ? row.project_id : null;
      const result = db.prepare('DELETE FROM stop_words WHERE id = ?').run(id);
      if (projectId) {
        try {
          const facadePath = path.join(process.env.APP_ROOT || path.join(path.dirname(new URL(import.meta.url).pathname), '..'), 'electron', 'db', 'index.cjs');
          const dbFacade = require(facadePath);
          if (dbFacade && dbFacade.keywords && typeof dbFacade.keywords.applyStopWords === 'function') {
            await dbFacade.keywords.applyStopWords(projectId);
          } else if (dbFacade && typeof dbFacade.keywordsApplyStopWords === 'function') {
            await dbFacade.keywordsApplyStopWords(projectId);
          }
        } catch (e) {
          console.error('[IPC] Error applying stop-words after delete:', e);
        }
      }
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:deleteByProject', async (_event, projectId) => {
    try {
      const result = db.prepare('DELETE FROM stop_words WHERE project_id = ?').run(projectId);
      try {
        const facadePath = path.join(process.env.APP_ROOT || path.join(path.dirname(new URL(import.meta.url).pathname), '..'), 'electron', 'db', 'index.cjs');
        const dbFacade = require(facadePath);
        if (dbFacade && dbFacade.keywords && typeof dbFacade.keywords.applyStopWords === 'function') {
          await dbFacade.keywords.applyStopWords(projectId);
        } else if (dbFacade && typeof dbFacade.keywordsApplyStopWords === 'function') {
          await dbFacade.keywordsApplyStopWords(projectId);
        }
      } catch (e) {
        console.error('[IPC] Error applying stop-words after deleteByProject:', e);
      }
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
