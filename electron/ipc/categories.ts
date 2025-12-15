import { ipcMain } from 'electron';
import type { IpcContext } from './types';

const CATEGORY_SELECT_BASE = 'SELECT id, project_id, keyword AS category_name, color, disabled, has_embedding, created_at FROM keywords WHERE project_id = ? AND is_category = 1';
const SORTABLE_COLUMNS: Record<string, string> = {
  id: 'id',
  category_name: 'keyword',
  created_at: 'created_at',
};

function resolveSort(column?: string): string | null {
  if (!column) return null;
  const normalized = String(column).trim();
  return SORTABLE_COLUMNS[normalized] || null;
}

function buildOrderBy(sort?: Record<string, number>): string {
  if (!sort || typeof sort !== 'object') return ' ORDER BY id DESC';
  const { column, direction, ...rest } = sort as Record<string, any>;
  let sortColumn = resolveSort(column) || null;
  let dir = direction;
  if (!sortColumn) {
    const entry = Object.entries(rest)[0];
    if (entry) {
      sortColumn = resolveSort(entry[0]);
      dir = entry[1];
    }
  }
  if (!sortColumn) return ' ORDER BY id DESC';
  const directionStr = String(dir).toLowerCase();
  const order = dir === -1 || directionStr === 'desc' ? 'DESC' : 'ASC';
  return ` ORDER BY ${sortColumn} ${order}`;
}

export function registerCategoriesIpc(ctx: IpcContext) {
  const { db } = ctx;

  ipcMain.handle('db:categories:getAll', async (_event, projectId) => {
    try {
      const rows = db
        .prepare(`${CATEGORY_SELECT_BASE} ORDER BY id`)
        .all(projectId);
      return { success: true, data: rows };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:getWindow', async (_event, projectId, skip, limit, sort, searchQuery) => {
    try {
      const params: any[] = [projectId];
      let sql = CATEGORY_SELECT_BASE;
      const q = typeof searchQuery === 'string' ? searchQuery.trim() : '';
      if (q) {
        sql += ' AND LOWER(keyword) LIKE ?';
        params.push(`%${q.toLowerCase()}%`);
      }

      sql += buildOrderBy(sort);

      if (typeof skip === 'number' && skip >= 0 && typeof limit === 'number' && limit > 0) {
        sql += ' LIMIT ? OFFSET ?';
        params.push(limit, skip);
      } else if (typeof limit === 'number' && limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
      }

      const data = db.prepare(sql).all(...params);

      let totalSql = 'SELECT COUNT(*) as count FROM keywords WHERE project_id = ? AND is_category = 1';
      const totalParams: any[] = [projectId];
      if (q) {
        totalSql += ' AND LOWER(keyword) LIKE ?';
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
      const normalized = typeof name === 'string' ? name.trim().toLowerCase() : String(name || '').toLowerCase();
      const result = db
        .prepare('INSERT INTO keywords (keyword, project_id, is_category, has_embedding, is_keyword) VALUES (?, ?, 1, 0, 0)')
        .run(normalized, projectId);
      if (!result || result.changes === 0) {
        return { success: false, error: 'No rows inserted (duplicate?)' };
      }
      const inserted = db
        .prepare(`${CATEGORY_SELECT_BASE} AND id = ?`)
        .get(projectId, result.lastInsertRowid);
      return { success: true, data: inserted };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:update', async (_event, name, id) => {
    try {
      const normalized = typeof name === 'string' ? name.trim().toLowerCase() : String(name || '').toLowerCase();
      const result = db
        .prepare('UPDATE keywords SET keyword = ? WHERE id = ? AND is_category = 1')
        .run(normalized, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:insertBulk', async (_event, categories, projectId) => {
    try {
      if (!Array.isArray(categories)) {
        throw new Error('Categories must be an array');
      }
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      let inserted = 0;
      let skipped = 0;
      const insert = db.prepare(
        'INSERT OR IGNORE INTO keywords (keyword, project_id, is_category, has_embedding, is_keyword) VALUES (?, ?, 1, 0, 0)'
      );

      for (const category of categories) {
        const trimmed = typeof category === 'string' ? category.trim() : String(category || '');
        const normalized = trimmed.toLowerCase();
        if (!normalized) {
          skipped++;
          continue;
        }
        try {
          const res = insert.run(normalized, projectId);
          if (res && res.changes > 0) {
            inserted++;
          } else {
            skipped++;
          }
        } catch (err) {
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
      const result = db
        .prepare('DELETE FROM keywords WHERE id = ? AND is_category = 1')
        .run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:deleteByProject', async (_event, projectId) => {
    try {
      const result = db
        .prepare('DELETE FROM keywords WHERE project_id = ? AND is_category = 1')
        .run(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}