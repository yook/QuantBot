import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export function registerKeywordsIpc(ctx: IpcContext) {
  const { db, getWindow, resolvedDbPath } = ctx;

  ipcMain.handle('db:keywords:getAll', async (_event, projectId) => {
    try {
      const result = db.prepare('SELECT * FROM keywords WHERE project_id = ? ORDER BY id').all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:getWindow', async (_event, projectId, skip, limit, sort, searchQuery) => {
    try {
      let sql = 'SELECT * FROM keywords WHERE project_id = ?';
      const params: any[] = [projectId];

      const q = typeof searchQuery === 'string' ? searchQuery.trim() : '';
      let explicitTargetFilter: number | null = null;
      if (q) {
        const m = q.match(/^target:\s*(1|0|true|false|yes|no)$/i);
        if (m) {
          const v = m[1].toLowerCase();
          explicitTargetFilter = (v === '1' || v === 'true' || v === 'yes') ? 1 : 0;
        }
      }

      if (explicitTargetFilter !== null) {
        sql += ' AND target_query = ?';
        params.push(explicitTargetFilter);
      } else if (q) {
        sql += ' AND (keyword LIKE ? OR blocking_rule LIKE ? OR category_name LIKE ? OR class_name LIKE ?)';
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }

      const allowedSortColumns = [
        'id', 'keyword', 'blocking_rule', 'created_at', 'category_id', 'category_name',
        'category_similarity', 'class_name', 'class_similarity', 'cluster_label', 'target_query'
      ];

      let orderByClause = ' ORDER BY id DESC';
      if (sort && typeof sort === 'object') {
        if (sort.column) {
          const direction = String(sort.direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
          if (allowedSortColumns.includes(sort.column)) {
            orderByClause = ` ORDER BY ${sort.column} ${direction}`;
          }
        } else {
          const keys = Object.keys(sort || {});
          if (keys.length > 0) {
            const col = keys[0];
            const val = sort[col];
            const direction = val === -1 || String(val).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
            if (allowedSortColumns.includes(col)) {
              orderByClause = ` ORDER BY ${col} ${direction}`;
            }
          }
        }
      }

      sql += orderByClause;
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, skip);

      const rows = db.prepare(sql).all(...params);

      let countSql = 'SELECT COUNT(*) as total FROM keywords WHERE project_id = ?';
      const countParams: any[] = [projectId];
      if (q) {
        if (explicitTargetFilter !== null) {
          countSql += ' AND target_query = ?';
          countParams.push(explicitTargetFilter);
        } else {
          const like = `%${q}%`;
          countSql += ' AND (keyword LIKE ? OR blocking_rule LIKE ? OR category_name LIKE ? OR class_name LIKE ?)';
          countParams.push(like, like, like, like);
        }
      }
      const countResult: any = db.prepare(countSql).get(...countParams);

      const result = { keywords: rows, total: countResult.total, skip, limit };
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:insert', async (_event, keyword, projectId, categoryId, _color, disabled) => {
    try {
      const result = db.prepare('INSERT INTO keywords (keyword, project_id, category_id, disabled, target_query) VALUES (?, ?, ?, ?, NULL)')
        .run(keyword, projectId, categoryId, disabled);
      try {
        // Use DB facade to apply stop-words (migrated from legacy socket helpers)
        const base = process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
        const facadePath = path.join(base, 'electron', 'db', 'index.cjs');
        const dbFacade = require(facadePath);
        if (dbFacade && dbFacade.keywords && typeof dbFacade.keywords.applyStopWords === 'function') {
          await dbFacade.keywords.applyStopWords(projectId);
        } else if (dbFacade && typeof dbFacade.keywordsApplyStopWords === 'function') {
          // compatibility alias
          await dbFacade.keywordsApplyStopWords(projectId);
        }
      } catch (e) {
        console.error('[IPC] Error applying stop-words after keyword insert:', e);
      }
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:update', async (_event, keyword, categoryId, _color, disabled, id) => {
    try {
      const result = db.prepare('UPDATE keywords SET keyword = ?, category_id = ?, disabled = ? WHERE id = ?')
        .run(keyword, categoryId, disabled, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:delete', async (_event, id) => {
    try {
      const result = db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:insertBulk', async (_event, keywords, projectId) => {
    try {
      if (!Array.isArray(keywords)) {
        throw new Error(`Expected keywords to be an array, got ${typeof keywords}`);
      }
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      return await new Promise((resolve, reject) => {
        const win = getWindow ? getWindow() : undefined;
        // Resolve worker path: prefer packaged location when present, otherwise fall back to source path.
        const packagedCandidate = process.resourcesPath
          ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'db-worker.cjs')
          : null;
        const devCandidate = path.join(process.cwd(), 'electron', 'db-worker.cjs');
        // Prefer dev worker when available (dev workflow). Fall back to packaged location.
        const workerPath = fs.existsSync(devCandidate)
          ? devCandidate
          : packagedCandidate && fs.existsSync(packagedCandidate)
          ? packagedCandidate
          : devCandidate;
        const child = require('child_process').spawn(process.execPath, [workerPath], {
          env: Object.assign({}, process.env, {
            DB_PATH: resolvedDbPath || process.env.DB_PATH,
            ELECTRON_RUN_AS_NODE: '1',
          }),
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let childExited = false;
        let requestSent = false;

        // Write JSON-RPC request to worker stdin after ensuring child is ready
        const req = { id: 1, method: 'keywords:insertBulk', params: [keywords, projectId] };
        
        // Wait a bit for child to initialize, then send request
        setTimeout(() => {
          if (childExited) {
            console.error('[IPC] db-worker exited before sending request');
            reject(new Error('db-worker exited before request could be sent'));
            return;
          }
          
          try {
            console.log('[IPC] Sending request to db-worker:', { method: req.method, paramsCount: req.params.length });
            child.stdin.write(JSON.stringify(req) + '\n');
            requestSent = true;
            console.log('[IPC] Request sent to db-worker successfully');
          } catch (e: any) {
            console.error('[IPC] Failed to write to db-worker stdin:', e);
            if (!childExited) {
              reject(new Error(`Failed to send request to db-worker: ${e.message}`));
            }
          }
        }, 100); // Small delay to allow child to initialize

        let stdoutBuf = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          stdoutBuf += chunk;
          const lines = stdoutBuf.split('\n');
          stdoutBuf = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              // Do not forward worker 'progress' events to renderer to avoid UI spam
              if (obj && obj.type === 'progress') {
                continue;
              }
              // final JSON-RPC response
              if (obj && obj.id === 1) {
                if (obj.error) {
                  reject(new Error(obj.error));
                } else {
                  resolve({ success: true, data: obj.result });
                }
              }
            } catch (e) {
              // ignore non-json lines
            }
          }
        });

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (d: string) => {
          const text = String(d).trim();
          console.error('[db-worker stderr]', text);
          // Filter out informational messages from db-worker to avoid cluttering UI
          if (text.includes('[DB Worker]')) {
            // Skip sending these to UI
            return;
          }
          if (win && !win.isDestroyed()) win.webContents.send('keywords:import-progress', { type: 'error', message: text });
        });

        child.on('error', (err: any) => {
          childExited = true;
          console.error('[IPC] db-worker error event:', err);
          reject(new Error(`db-worker failed to start: ${err.message}`));
        });

        child.on('close', (code: number) => {
          childExited = true;
          if (code !== 0) {
            reject(new Error(`db-worker exited with code ${code}`));
          } else if (!requestSent) {
            reject(new Error('db-worker exited before request was processed'));
          }
        });
      });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateCategory', async (_event, id, categoryName, categorySimilarity) => {
    try {
      const result = db.prepare('UPDATE keywords SET category_name = ?, category_similarity = ? WHERE id = ?')
        .run(categoryName, categorySimilarity, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateClass', async (_event, id, className, classSimilarity) => {
    try {
      const result = db.prepare('UPDATE keywords SET class_name = ?, class_similarity = ? WHERE id = ?')
        .run(className, classSimilarity, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateCluster', async (_event, id, cluster) => {
    try {
      const result = db.prepare('UPDATE keywords SET cluster = ?, cluster_label = ? WHERE id = ?').run(cluster, String(cluster), id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:deleteByProject', async (_event, projectId) => {
    try {
      const result = db.prepare('DELETE FROM keywords WHERE project_id = ?').run(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
