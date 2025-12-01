import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function registerCategoriesIpc(ctx: IpcContext) {
  const { db, categoriesNameColumn } = ctx;

  ipcMain.handle('db:categories:getWindow', async (_event, projectId, skip, limit, sort, searchQuery) => {
    try {
      let sql = `SELECT id, project_id, ${categoriesNameColumn} AS category_name, created_at FROM categories WHERE project_id = ?`;
      const params: any[] = [projectId];

      const q = typeof searchQuery === 'string' ? searchQuery.trim() : '';
      if (q) {
        sql += ` AND LOWER(${categoriesNameColumn}) LIKE ?`;
        params.push(`%${q.toLowerCase()}%`);
      }

      const allowedSortColumns = ['id', categoriesNameColumn];

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
      let totalSql = `SELECT COUNT(*) as count FROM categories WHERE project_id = ?`;
      const totalParams: any[] = [projectId];
      if (q) {
        totalSql += ` AND LOWER(${categoriesNameColumn}) LIKE ?`;
        totalParams.push(`%${q.toLowerCase()}%`);
      }
      const totalResult = db.prepare(totalSql).get(...totalParams) as { count: number } | undefined;
      const total = totalResult?.count || 0;

      return { success: true, data, total };
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

  ipcMain.handle('db:categories:insertBulk', async (_event, categories, projectId) => {
    try {
      let inserted = 0;
      let skipped = 0;

      // Используем транзакцию для массовой вставки
      const insert = db.prepare(`INSERT OR IGNORE INTO categories (${categoriesNameColumn}, project_id) VALUES (?, ?)`);

      for (const category of categories) {
        try {
          const result = insert.run(category, projectId);
          if (result.changes > 0) {
            inserted++;
          } else {
            skipped++;
          }
        } catch (error) {
          console.warn(`Failed to insert category "${category}":`, error);
          skipped++;
        }
      }

      return { success: true, data: { inserted, skipped } };
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

  ipcMain.handle('db:categories:deleteByProject', async (_event, projectId) => {
    try {
      const result = db.prepare('DELETE FROM categories WHERE project_id = ?').run(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}