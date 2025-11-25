import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

// Handler: import stopwords via worker and stream progress to renderer
ipcMain.handle('stopwords:import', (event, { projectId, dbPath, words, applyToKeywords = true }) => {
  return new Promise((resolve, reject) => {
    const win = BrowserWindow.getAllWindows()[0];
    const cfg = { projectId, dbPath, stopWords: words, applyToKeywords, batchSize: 500 };
    const cfgPath = path.join(process.cwd(), `tmp-stopwords-${Date.now()}.json`);
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));

    const workerPath = path.join(process.cwd(), 'worker', 'stopwordsProcessor.cjs');
    const child = spawn(process.execPath, [workerPath, `--config=${cfgPath}`], { cwd: process.cwd() });

    child.stdout.on('data', (data) => {
      const lines = String(data).split('\n').filter(Boolean);
      for(const l of lines){
        try{
          const obj = JSON.parse(l);
          // forward to renderer
          if(win && !win.isDestroyed()) win.webContents.send('stopwords:progress', obj);
          if(obj && obj.type === 'finished'){
            // cleanup
          }
        }catch(e){ }
      }
    });

    child.stderr.on('data', (d)=>{ if(win && !win.isDestroyed()) win.webContents.send('stopwords:progress', { type:'error', message:String(d) }); });

    child.on('close', (code) => {
      try{ fs.unlinkSync(cfgPath); }catch(_){ }
      if(code === 0) resolve({ ok:true }); else reject(new Error(`worker exit ${code}`));
    });
  });
});
import path from 'path';
import { fileURLToPath } from 'url';
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
        const base = process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
        const facadePath = path.join(base, 'electron', 'db', 'index.cjs');
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
