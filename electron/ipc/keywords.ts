import path from 'path';
import { fileURLToPath } from 'url';
import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export function registerKeywordsIpc(ctx: IpcContext) {
  const { db } = ctx;

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
      const result = db.prepare('INSERT INTO keywords (keyword, project_id, category_id, disabled) VALUES (?, ?, ?, ?)')
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
      const insertStmt = db.prepare('INSERT OR IGNORE INTO keywords (keyword, project_id) VALUES (?, ?)');
      let inserted = 0;
      const insertMany = db.transaction((kws: string[]) => {
        for (const kw of kws) {
          const info = insertStmt.run(kw, projectId);
          if (info.changes > 0) inserted++;
        }
      });
      insertMany(keywords);
      try {
        const facadePath = path.join(process.env.APP_ROOT || path.join(path.dirname(new URL(import.meta.url).pathname), '..'), 'electron', 'db', 'index.cjs');
        const dbFacade = require(facadePath);
        if (dbFacade && dbFacade.keywords && typeof dbFacade.keywords.applyStopWords === 'function') {
          await dbFacade.keywords.applyStopWords(projectId);
        } else if (dbFacade && typeof dbFacade.keywordsApplyStopWords === 'function') {
          await dbFacade.keywordsApplyStopWords(projectId);
        }
      } catch (e) {
        console.error('[IPC] Error applying stop-words after insertBulk:', e);
      }
      const result = { inserted, total: keywords.length, skipped: keywords.length - inserted };
      return { success: true, data: result };
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
