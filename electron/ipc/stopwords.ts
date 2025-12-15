import path from 'path';
import os from 'os';
import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import fs from 'fs';
import { spawn } from 'child_process';
 

export function registerStopwordsIpc(ctx: IpcContext) {
  const { db, getWindow, resolvedDbPath } = ctx;

  // Bulk import: spawn worker which emits JSON lines to stdout; forward them to renderer
  ipcMain.handle('stopwords:import', (event, { projectId, dbPath, words, applyToKeywords = true }) => {
    return new Promise(async (resolve, reject) => {
      const callerWebContents = event && event.sender ? event.sender : undefined;
      const sendToRenderer = (channel: string, payload: any) => {
        let delivered = false;
        if (callerWebContents) {
          try {
            const alive = typeof callerWebContents.isDestroyed === 'function' ? !callerWebContents.isDestroyed() : true;
            if (alive) {
              callerWebContents.send(channel, payload);
              delivered = true;
            }
          } catch (_) {
            // ignore send errors
          }
        }
        if (!delivered) {
          try {
            const fallbackWin = getWindow ? getWindow() : undefined;
            if (fallbackWin && !fallbackWin.isDestroyed()) {
              fallbackWin.webContents.send(channel, payload);
            }
          } catch (_) {
            // ignore fallback errors
          }
        }
      };
      const cfg = { projectId, dbPath: dbPath || resolvedDbPath || process.cwd(), stopWords: words, applyToKeywords, batchSize: 500 };
      // Write config into system temporary directory to avoid writing inside
      // read-only application bundle (app.asar) or other protected CWD.
      const tmpDir = process.env.TMPDIR || os.tmpdir();
      const cfgPath = path.join(tmpDir, `tmp-stopwords-${Date.now()}.json`);
      try { fs.writeFileSync(cfgPath, JSON.stringify(cfg), { encoding: 'utf8' }); } catch (e) { return reject(e); }

      const packagedCandidate = process.resourcesPath
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'worker', 'stopwordsProcessor.cjs')
        : null;
      const devCandidate = path.join(process.cwd(), 'electron', 'workers', 'stopwordsProcessor.cjs');
      const workerPath = fs.existsSync(devCandidate)
        ? devCandidate
        : packagedCandidate && fs.existsSync(packagedCandidate)
        ? packagedCandidate
        : devCandidate;
      let env = Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        DB_PATH: cfg.dbPath || resolvedDbPath || process.env.DB_PATH,
      });

      const child = spawn(process.execPath, [workerPath, `--config=${cfgPath}`], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Capture final summary emitted by the worker (but still avoid forwarding
      // frequent progress updates to UI). We will forward only errors to the
      // renderer and keep summary locally to return it to the caller.
      let summary: any = null;
      let totalImported = 0;
      let stdoutBuffer = '';
      child.stdout.on('data', (data) => {
        stdoutBuffer += String(data);
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const l of lines) {
          if (!l) continue;
          try {
            const obj = JSON.parse(l);
            if (!obj) continue;
            // Record progress/summary information locally but do not forward
            // regular progress events to avoid flooding the UI.
            if (obj.type === 'progress') {
              // keep track of totalImported if worker reports it
              try {
                if (typeof obj.totalImported === 'number') totalImported = obj.totalImported;
                if (obj.stage === 'import' && typeof obj.inserted === 'number') {
                  // intermediate imported count
                }
              } catch (_e) {}
              continue;
            }

            // Capture explicit 'finished' summary emitted by worker
            if (obj.type === 'finished') {
              summary = obj;
              continue;
            }

            // Forward only errors (so UI can show failure messages)
            if (obj.type === 'error') sendToRenderer('stopwords:progress', obj);
          } catch (e) {
            // ignore JSON parse errors for malformed lines
          }
        }
      });

      child.on('error', (err) => {
        try { fs.unlinkSync(cfgPath); } catch (_e) {}
        sendToRenderer('stopwords:progress', { type: 'error', message: String(err) });
        return reject(err);
      });

      child.stderr.on('data', (d) => {
        sendToRenderer('stopwords:progress', { type: 'error', message: String(d) });
      });

      child.on('close', async (code) => {
        try { fs.unlinkSync(cfgPath); } catch (_e) {}
        if (code === 0) {
          // Worker finished successfully. Return captured summary if available.
          try {
            const inserted = summary && typeof summary.inserted === 'number' ? summary.inserted : (summary && summary.inserted ? Number(summary.inserted) : 0);
            const total = (summary && typeof summary.total === 'number') ? summary.total : (typeof totalImported === 'number' ? totalImported : undefined);
            const skipped = typeof total === 'number' ? Math.max(0, total - inserted) : undefined;
            const payload: any = { ok: true, inserted };
            if (typeof skipped === 'number') payload.skipped = skipped;
            if (typeof total !== 'undefined') payload.totalImported = total;
            resolve(payload);
          } catch (e) {
            // Fallback: resolve basic ok
            resolve({ ok: true });
          }
        } else reject(new Error(`worker exit ${code}`));
      });
    });
  });

  // Run applyStopWords in a worker and stream apply-progress events
  ipcMain.handle('stopwords:apply', (event, { projectId, dbPath }) => {
    return new Promise(async (resolve, reject) => {
      const callerWebContents = event && event.sender ? event.sender : undefined;
      const sendToRenderer = (channel: string, payload: any) => {
        let delivered = false;
        if (callerWebContents) {
          try {
            const alive = typeof callerWebContents.isDestroyed === 'function' ? !callerWebContents.isDestroyed() : true;
            if (alive) {
              callerWebContents.send(channel, payload);
              delivered = true;
            }
          } catch (_) {}
        }
        if (!delivered) {
          try {
            const fallbackWin = getWindow ? getWindow() : undefined;
            if (fallbackWin && !fallbackWin.isDestroyed()) {
              fallbackWin.webContents.send(channel, payload);
            }
          } catch (_) {}
        }
      };

      const cfg = { projectId, dbPath: dbPath || resolvedDbPath || process.cwd() };
      // Use system temp directory for config file
      const tmpDir = process.env.TMPDIR || os.tmpdir();
      const cfgPath = path.join(tmpDir, `tmp-stopwords-apply-${Date.now()}.json`);
      try { fs.writeFileSync(cfgPath, JSON.stringify(cfg), { encoding: 'utf8' }); } catch (e) { return reject(e); }

      const packagedApplyCandidate = process.resourcesPath
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'worker', 'stopwordsApply.cjs')
        : null;
      const devApplyCandidate = path.join(process.cwd(), 'electron', 'workers', 'stopwordsApply.cjs');
      const workerPath = fs.existsSync(devApplyCandidate)
        ? devApplyCandidate
        : packagedApplyCandidate && fs.existsSync(packagedApplyCandidate)
        ? packagedApplyCandidate
        : devApplyCandidate;
      let env = Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        DB_PATH: cfg.dbPath || resolvedDbPath || process.env.DB_PATH,
      });

      const child = spawn(process.execPath, [workerPath, `--config=${cfgPath}`], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutBufferApply = '';
      child.stdout.on('data', (data) => {
        stdoutBufferApply += String(data);
        const lines = stdoutBufferApply.split('\n');
        stdoutBufferApply = lines.pop() || '';
        for (const l of lines) {
          if (!l) continue;
          try {
            const obj = JSON.parse(l);
            // forward apply-progress events
            if (obj && obj.type === 'apply-progress') {
              // Ensure renderer knows which project this progress belongs to
              try { obj.projectId = projectId; } catch (_) {}
              sendToRenderer('stopwords:apply-progress', obj);
              continue;
            }
            if (obj && obj.type === 'finished-apply') {
              // Forward finished-apply as apply-progress with type finished-apply
              try { obj.projectId = projectId; } catch (_) {}
              sendToRenderer('stopwords:apply-progress', obj);
              continue;
            }
            if (obj && obj.type === 'error') {
              try { obj.projectId = projectId; } catch (_) {}
              sendToRenderer('stopwords:apply-progress', obj);
              continue;
            }
          } catch (e) {
            // ignore JSON parse errors
          }
        }
      });

      child.on('error', (err) => {
        try { fs.unlinkSync(cfgPath); } catch (_e) {}
        sendToRenderer('stopwords:apply-progress', { type: 'error', message: String(err) });
        return reject(err);
      });

      child.stderr.on('data', (d) => {
        sendToRenderer('stopwords:apply-progress', { type: 'error', message: String(d) });
      });

      child.on('close', (code) => {
        try { fs.unlinkSync(cfgPath); } catch (_e) {}
        if (code === 0) resolve({ ok: true });
        else reject(new Error(`stopwords apply worker exit ${code}`));
      });
    });
  });

  // Existing DB handlers
  ipcMain.handle('db:stopwords:getAll', async (_event, projectId) => {
    try {
      const result = db.prepare('SELECT * FROM stop_words WHERE project_id = ?').all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:getWindow', async (_event, projectId, skip, limit, sort, searchQuery) => {
    try {
      let sql = 'SELECT * FROM stop_words WHERE project_id = ?';
      const params: any[] = [projectId];

      const q = typeof searchQuery === 'string' ? searchQuery.trim() : '';
      if (q) {
        sql += ' AND word LIKE ?';
        params.push(`%${q}%`);
      }

      const allowedSortColumns = ['id', 'word'];

      let orderByClause = ' ORDER BY id DESC';
      if (sort && typeof sort === 'object') {
        const clauses: string[] = [];
        for (const [col, dir] of Object.entries(sort)) {
          if (allowedSortColumns.includes(col) && (dir === 1 || dir === -1)) {
            clauses.push(`${col} ${dir === 1 ? 'ASC' : 'DESC'}`);
          }
        }
        if (clauses.length > 0) {
          orderByClause = ' ORDER BY ' + clauses.join(', ');
        }
      }

      sql += orderByClause;

      if (typeof skip === 'number' && skip > 0) {
        sql += ' LIMIT ? OFFSET ?';
        params.push(limit || 100, skip);
      } else if (typeof limit === 'number' && limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
      }

      const data = db.prepare(sql).all(...params);
      let totalSql = 'SELECT COUNT(*) as count FROM stop_words WHERE project_id = ?';
      const totalParams: any[] = [projectId];
      if (q) {
        totalSql += ' AND word LIKE ?';
        totalParams.push(`%${q}%`);
      }
      const totalResult = db.prepare(totalSql).get(...totalParams) as { count: number } | undefined;
      const total = totalResult?.count || 0;

      return { success: true, data, total };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:insert', async (_event, projectId, word) => {
    try {
      if (!db) return { success: false, error: 'Database not initialized' };
      const result = db.prepare('INSERT OR IGNORE INTO stop_words (project_id, word) VALUES (?, ?)').run(projectId, word);

      // Intentionally not applying stop-words to keywords here — only saving stop-word to DB
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:delete', async (_event, id) => {
    try {
      db.prepare('SELECT project_id FROM stop_words WHERE id = ?').get(id); // read row but do not apply to keywords
      const result = db.prepare('DELETE FROM stop_words WHERE id = ?').run(id);
      // Intentionally not applying stop-words to keywords after deletion — only modifying stop_words table
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:deleteByProject', async (_event, projectId) => {
    try {
      const result = db.prepare('DELETE FROM stop_words WHERE project_id = ?').run(projectId);
      // Intentionally not applying stop-words after deleteByProject — only removing stop_words rows
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
