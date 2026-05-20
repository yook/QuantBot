import path from 'path';
import fs from 'fs';
import { app, dialog, ipcMain, shell } from 'electron';
import * as XLSX from 'xlsx';
import type { IpcContext } from './types';
import { FREE_PLAN_LIMITS, isFreePlan } from '../../src/config/plan-limits.js';

export function registerUrlsIpc(ctx: IpcContext) {
  const { db, getWindow, resolvedDbPath } = ctx;
  const getProjectTotalUrls = (projectId: number) => {
    const urlsRow = db
      .prepare("SELECT COUNT(*) as count FROM urls WHERE project_id = ?")
      .get(projectId) as any;
    const disallowedRow = db
      .prepare("SELECT COUNT(*) as count FROM disallowed WHERE project_id = ?")
      .get(projectId) as any;
    return Number(urlsRow?.count || 0) + Number(disallowedRow?.count || 0);
  };

  const SORT_FIELDS_URLS = new Set([
    'id', 'project_id', 'source', 'type', 'url', 'referrer', 'depth', 'code', 'contentType',
    'protocol', 'location', 'actualDataSize', 'requestTime', 'requestLatency',
    'downloadTime', 'status', 'date', 'content', 'created_at',
  ]);
  const SORT_FIELDS_DISALLOW = new Set([
    'id', 'project_id', 'url', 'error_type', 'code', 'status', 'referrer',
    'depth', 'protocol', 'error_message', 'created_at',
  ]);

  const PARSER_NUMERIC_SORT_SUFFIXES = ['length', 'quantity'];

  const isSafeJsonKey = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''));

  const isParserNumericField = (field: string) => {
    const normalized = String(field || '').toLowerCase();
    return PARSER_NUMERIC_SORT_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
  };

  const getSortConfig = (dbTable: string, sortOption: any) => {
    let requestedField = 'id';
    let order = 'ASC';

    if (sortOption && typeof sortOption === 'object') {
      const sortKeys = Object.keys(sortOption);
      if (sortKeys.length > 0) {
        requestedField = String(sortKeys[0] || 'id');
        order = sortOption[requestedField] === -1 ? 'DESC' : 'ASC';
      }
    }

    if (dbTable === 'parser' && isSafeJsonKey(requestedField) && !SORT_FIELDS_URLS.has(requestedField)) {
      const jsonPath = `$.${requestedField}`;
      if (isParserNumericField(requestedField)) {
        return {
          sortBy: `CAST(COALESCE(json_extract(content, '${jsonPath}'), 0) AS REAL)`,
          order,
        };
      }

      return {
        sortBy: `LOWER(COALESCE(json_extract(content, '${jsonPath}'), ''))`,
        order,
      };
    }

    return {
      sortBy: normalizeSortField(dbTable, requestedField),
      order,
    };
  };

  const normalizeSortField = (dbTable: string, requested: string) => {
    const field = String(requested || 'id');
    const allowed = dbTable === 'disallow' ? SORT_FIELDS_DISALLOW : SORT_FIELDS_URLS;
    return allowed.has(field) ? field : 'id';
  };

  const normalizeLimit = (val: any, fallback = 200) => {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, 1000);
  };

  const NUMERIC_FIELDS = new Set([
    'id',
    'project_id',
    'depth',
    'code',
    'actualDataSize',
    'requestTime',
    'requestLatency',
    'downloadTime',
  ]);

  const FILTER_FIELD_ALIASES = new Map<string, string>([
    ['http-код', 'code'],
    ['http код', 'code'],
    ['http-code', 'code'],
    ['http_code', 'code'],
    ['httpcode', 'code'],
    ['hhtp-код', 'code'],
    ['hhtp код', 'code'],
    ['hhtp-code', 'code'],
    ['hhtp_code', 'code'],
    ['hhtpcode', 'code'],
    ['код ответа http', 'code'],
    ['http response code', 'code'],
    ['status code', 'code'],
    ['statuscode', 'code'],
  ]);

  const FILTER_OPERATOR_ALIASES = new Map<string, string>([
    ['=', 'eq'],
    ['==', 'eq'],
    ['equals', 'eq'],
    ['равно', 'eq'],
    ['!=', 'neq'],
    ['<>', 'neq'],
    ['not equals', 'neq'],
    ['не равно', 'neq'],
    ['>', 'gt'],
    ['больше', 'gt'],
    ['>=', 'gte'],
    ['больше или равно', 'gte'],
    ['<', 'lt'],
    ['меньше', 'lt'],
    ['<=', 'lte'],
    ['меньше или равно', 'lte'],
    ['диапазон', 'between'],
  ]);

  const normalizeFilterField = (field: any) => {
    const raw = String(field || '').trim();
    const normalized = raw.toLowerCase();
    return FILTER_FIELD_ALIASES.get(normalized) || raw;
  };

  const normalizeFilterOperator = (operator: any) => {
    const raw = String(operator || '').trim();
    const normalized = raw.toLowerCase();
    return FILTER_OPERATOR_ALIASES.get(normalized) || raw;
  };

  const normalizeFilters = (input: any) => {
    if (!Array.isArray(input)) return [];
    return input
      .filter((item) => item && typeof item === 'object')
      .slice(0, 20)
      .map((item) => ({
        field: normalizeFilterField(item.field),
        operator: normalizeFilterOperator(item.operator),
        value: item.value,
        secondValue: item.secondValue,
      }))
      .filter((item) => !!item.field && !!item.operator);
  };

  const getFilterFieldExpression = (dbTable: string, field: string) => {
    if (dbTable === 'disallow') {
      return SORT_FIELDS_DISALLOW.has(field) ? field : null;
    }
    if (dbTable === 'parser') {
      if (SORT_FIELDS_URLS.has(field)) return field;
      if (isSafeJsonKey(field)) return `json_extract(content, '$.${field}')`;
      return null;
    }
    return SORT_FIELDS_URLS.has(field) ? field : null;
  };

  const isNumericFilterField = (dbTable: string, field: string) => {
    if (NUMERIC_FIELDS.has(field)) return true;
    return dbTable === 'parser' && isParserNumericField(field);
  };

  const buildFilterSql = (dbTable: string, inputFilters: any) => {
    const filters = normalizeFilters(inputFilters);
    if (!filters.length) return { clause: '', params: [] as any[] };

    const clauses: string[] = [];
    const params: any[] = [];

    for (const filter of filters) {
      const fieldExpr = getFilterFieldExpression(dbTable, filter.field);
      if (!fieldExpr) continue;

      const textExpr = `LOWER(CAST(COALESCE(${fieldExpr}, '') AS TEXT))`;
      const numExpr = `CAST(COALESCE(${fieldExpr}, 0) AS REAL)`;
      const isNumeric = isNumericFilterField(dbTable, filter.field);
      const rawValue = filter.value;
      const normalizedTextValue = String(rawValue ?? '').toLowerCase();

      switch (filter.operator) {
        case 'contains':
          if (!normalizedTextValue) break;
          clauses.push(`${textExpr} LIKE ?`);
          params.push(`%${normalizedTextValue}%`);
          break;
        case 'startsWith':
          if (!normalizedTextValue) break;
          clauses.push(`${textExpr} LIKE ?`);
          params.push(`${normalizedTextValue}%`);
          break;
        case 'endsWith':
          if (!normalizedTextValue) break;
          clauses.push(`${textExpr} LIKE ?`);
          params.push(`%${normalizedTextValue}`);
          break;
        case 'eq': {
          if (isNumeric) {
            const numericValue = Number(rawValue);
            if (!Number.isFinite(numericValue)) break;
            clauses.push(`${numExpr} = ?`);
            params.push(numericValue);
          } else {
            clauses.push(`${textExpr} = ?`);
            params.push(normalizedTextValue);
          }
          break;
        }
        case 'neq': {
          if (isNumeric) {
            const numericValue = Number(rawValue);
            if (!Number.isFinite(numericValue)) break;
            clauses.push(`${numExpr} != ?`);
            params.push(numericValue);
          } else {
            clauses.push(`${textExpr} != ?`);
            params.push(normalizedTextValue);
          }
          break;
        }
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const numericValue = Number(rawValue);
          if (!Number.isFinite(numericValue)) break;
          const op = filter.operator === 'gt' ? '>' : filter.operator === 'gte' ? '>=' : filter.operator === 'lt' ? '<' : '<=';
          clauses.push(`${numExpr} ${op} ?`);
          params.push(numericValue);
          break;
        }
        case 'between': {
          const from = Number(rawValue);
          const to = Number(filter.secondValue);
          if (!Number.isFinite(from) || !Number.isFinite(to)) break;
          clauses.push(`${numExpr} BETWEEN ? AND ?`);
          params.push(Math.min(from, to), Math.max(from, to));
          break;
        }
        default:
          break;
      }
    }

    if (!clauses.length) return { clause: '', params: [] as any[] };
    return {
      clause: ` AND (${clauses.join(' AND ')})`,
      params,
    };
  };

  const mergeParserContentIntoExportRow = (row: any) => {
    if (!row || typeof row !== 'object') return row;
    const merged = { ...row };
    if (typeof merged.content !== 'string' || !merged.content.trim()) return merged;
    try {
      const parsed = JSON.parse(merged.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const key of Object.keys(parsed)) {
          if (typeof merged[key] === 'undefined') merged[key] = parsed[key];
        }
      }
    } catch (_) {}
    return merged;
  };

  const normalizeExportValue = (value: any) => {
    if (Array.isArray(value)) return value.join('; ');
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (_) {
        return String(value);
      }
    }
    return value ?? '';
  };

  const normalizeExportColumns = (columns: any[], rows: any[]) => {
    const normalized = Array.isArray(columns)
      ? columns
          .filter((column) => column && typeof column === 'object' && column.prop && column.prop !== '_rowNumber')
          .map((column) => ({
            prop: String(column.prop),
            name: String(column.name || column.prop),
          }))
      : [];

    if (normalized.length > 0) return normalized;

    const firstRow = rows.find((row) => row && typeof row === 'object');
    if (!firstRow) return [];
    return Object.keys(firstRow)
      .filter((prop) => prop !== '_rowNumber')
      .map((prop) => ({ prop, name: prop }));
  };

  const buildExportRowsSql = (dbTable: string, projectId: any, filters: any, sort: any) => {
    const filterSql = buildFilterSql(dbTable, filters);
    const { sortBy, order } = getSortConfig(dbTable, sort);
    let sql: string;
    let params: any[];

    if (dbTable === 'disallow') {
      sql = `SELECT * FROM disallowed WHERE project_id = ?${filterSql.clause} ORDER BY ${sortBy} ${order}`;
      params = [projectId, ...filterSql.params];
    } else if (dbTable === 'parser') {
      sql = `SELECT * FROM urls
             WHERE project_id = ?
               AND source = 'parser'
               AND type = 'html'
               AND (code IS NULL OR code != 404)
               ${filterSql.clause}
             ORDER BY ${sortBy} ${order}`;
      params = [projectId, ...filterSql.params];
    } else if (dbTable === 'urls') {
      sql = `SELECT * FROM urls
             WHERE project_id = ?
               AND COALESCE(source, 'crawler') = 'crawler'
               ${filterSql.clause}
             ORDER BY ${sortBy} ${order}`;
      params = [projectId, ...filterSql.params];
    } else if (dbTable === 'jscss') {
      sql = `SELECT * FROM urls
             WHERE project_id = ?
               AND COALESCE(source, 'crawler') = 'crawler'
               AND type IN ('jscss', 'script', 'style')
               ${filterSql.clause}
             ORDER BY ${sortBy} ${order}`;
      params = [projectId, ...filterSql.params];
    } else {
      sql = `SELECT * FROM urls
             WHERE project_id = ?
               AND COALESCE(source, 'crawler') = 'crawler'
               AND type = ?
               ${filterSql.clause}
             ORDER BY ${sortBy} ${order}`;
      params = [projectId, dbTable, ...filterSql.params];
    }

    return { sql, params };
  };

  const buildExportFileBuffer = (rows: any[], columns: { prop: string; name: string }[], format: string) => {
    const matrix = rows.map((row) => {
      const out: Record<string, any> = {};
      for (const column of columns) {
        out[column.name] = normalizeExportValue(row[column.prop]);
      }
      return out;
    });

    if (format === 'json') {
      const jsonRows = rows.map((row) => {
        const out: Record<string, any> = {};
        for (const column of columns) {
          out[column.prop] = normalizeExportValue(row[column.prop]);
        }
        return out;
      });
      return Buffer.from(JSON.stringify(jsonRows, null, 2), 'utf8');
    }

    const worksheet = XLSX.utils.json_to_sheet(matrix, {
      header: columns.map((column) => column.name),
    });

    if (format === 'csv') {
      return Buffer.from(`\uFEFF${XLSX.utils.sheet_to_csv(worksheet)}`, 'utf8');
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Export');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  const sanitizeExportFilePart = (value: any, fallback: string) => {
    const normalized = String(value || '').trim();
    if (!normalized) return fallback;
    return normalized
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[-. ]+$/g, '')
      .slice(0, 80) || fallback;
  };

  const getExportDatePart = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getExportDialogOptions = (dbTable: string, format: string, projectName?: string) => {
    const ext = format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'xlsx';
    const labels: Record<string, string> = {
      json: 'JSON',
      csv: 'CSV',
      xlsx: 'Excel Workbook',
    };
    const safeProjectName = sanitizeExportFilePart(projectName, 'project');
    const safeDbTable = sanitizeExportFilePart(dbTable, 'report');
    const fileName = `${safeProjectName}-${getExportDatePart()}-${safeDbTable}.${ext}`;
    let defaultDirectory = process.cwd();
    try {
      defaultDirectory = app.getPath('downloads') || defaultDirectory;
    } catch (_) {}
    return {
      title: 'Сохранить экспорт',
      defaultPath: path.join(defaultDirectory, fileName),
      filters: [{ name: labels[ext], extensions: [ext] }],
    };
  };

  const ensureExportExtension = (filePath: string, format: string) => {
    const ext = format === 'json' ? '.json' : format === 'csv' ? '.csv' : '.xlsx';
    return path.extname(filePath).toLowerCase() === ext ? filePath : `${filePath}${ext}`;
  };

  ipcMain.handle('db:urls:getAll', async (_event, projectId) => {
    try {
      const result = db.prepare("SELECT * FROM urls WHERE project_id = ? AND COALESCE(source, 'crawler') = 'crawler'").all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:current:get', async (_event, projectId, skip, limit) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }
      const lim = normalizeLimit(limit, 200);
      const off = Math.max(0, Number(skip || 0));
      const rows = db.prepare(
        `SELECT * FROM urls_current
         WHERE project_id = ?
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`
      ).all(pid, lim, off);
      return { success: true, data: rows };
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
      const filterSql = buildFilterSql(dbTable, options.filters);

      const { sortBy, order } = getSortConfig(dbTable, options.sort);

      let sql: string;
      let params: any[];
      const limitClause = limit > 0 ? `LIMIT ? OFFSET ?` : '';

      if (dbTable === 'disallow') {
        sql = `SELECT * FROM disallowed WHERE project_id = ?${filterSql.clause} ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, ...filterSql.params, limit, offset] : [project_id, ...filterSql.params];
      } else if (dbTable === 'parser') {
        sql = `SELECT * FROM urls
               WHERE project_id = ?
                 AND source = 'parser'
                 ${filterSql.clause}
               ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, ...filterSql.params, limit, offset] : [project_id, ...filterSql.params];
      } else if (dbTable === 'urls') {
        sql = `SELECT * FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 ${filterSql.clause}
               ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, ...filterSql.params, limit, offset] : [project_id, ...filterSql.params];
      } else if (dbTable === 'jscss') {
        sql = `SELECT * FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 AND type IN ('jscss', 'script', 'style')
                 ${filterSql.clause}
               ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, ...filterSql.params, limit, offset] : [project_id, ...filterSql.params];
      } else {
        sql = `SELECT * FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 AND type = ?
                 ${filterSql.clause}
               ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, dbTable, ...filterSql.params, limit, offset] : [project_id, dbTable, ...filterSql.params];
      }

      const result = db.prepare(sql).all(...params);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:count', async (_event, projectId, dbTable = 'urls', filters = []) => {
    try {
      const filterSql = buildFilterSql(dbTable, filters);
      let sql: string;
      if (dbTable === 'disallow') {
        sql = `SELECT COUNT(*) as count FROM disallowed WHERE project_id = ?${filterSql.clause}`;
        const result = db.prepare(sql).get(projectId, ...filterSql.params);
        return { success: true, data: result };
      } else if (dbTable === 'parser') {
        sql = `SELECT COUNT(*) as count FROM urls
               WHERE project_id = ?
                 AND source = 'parser'
                 ${filterSql.clause}`;
        const result = db.prepare(sql).get(projectId, ...filterSql.params);
        return { success: true, data: result };
      } else if (dbTable === 'urls') {
        sql = `SELECT COUNT(*) as count FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 ${filterSql.clause}`;
        const result = db.prepare(sql).get(projectId, ...filterSql.params);
        return { success: true, data: result };
      } else if (dbTable === 'jscss') {
        sql = `SELECT COUNT(*) as count FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 AND type IN ('jscss', 'script', 'style')
                 ${filterSql.clause}`;
        const result = db.prepare(sql).get(projectId, ...filterSql.params);
        return { success: true, data: result };
      } else {
        // For specific types like 'html', 'image', etc.
        sql = `SELECT COUNT(*) as count FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 AND type = ?
                 ${filterSql.clause}`;
        const result = db.prepare(sql).get(projectId, dbTable, ...filterSql.params);
        return { success: true, data: result };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stats:crawler:get', async (_event, projectId) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }

      const typeStats = db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN type = 'html' THEN 1 ELSE 0 END) as html,
            SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END) as image,
            SUM(CASE WHEN type IN ('jscss', 'script', 'style') OR contentType LIKE '%javascript%' OR contentType LIKE '%css%' THEN 1 ELSE 0 END) as jscss
          FROM urls
          WHERE project_id = ?
            AND COALESCE(source, 'crawler') = 'crawler'
          `,
        )
        .get(pid) as any;

      const codeStats = db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN code >= 300 AND code < 400 THEN 1 ELSE 0 END) as redirect,
            SUM(CASE WHEN code >= 400 THEN 1 ELSE 0 END) as error
          FROM urls
          WHERE project_id = ?
            AND COALESCE(source, 'crawler') = 'crawler'
          `,
        )
        .get(pid) as any;

      const depthStats = db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN depth <= 3 THEN 1 ELSE 0 END) as depth3,
            SUM(CASE WHEN depth = 4 OR depth = 5 THEN 1 ELSE 0 END) as depth5,
            SUM(CASE WHEN depth >= 6 THEN 1 ELSE 0 END) as depth6
          FROM urls
          WHERE project_id = ?
            AND COALESCE(source, 'crawler') = 'crawler'
          `,
        )
        .get(pid) as any;

      const fetchedRow = db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM urls
          WHERE project_id = ?
            AND COALESCE(source, 'crawler') = 'crawler'
          `,
        )
        .get(pid) as any;

      const disallowRow = db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM disallowed
          WHERE project_id = ?
          `,
        )
        .get(pid) as any;

      const stats = {
        fetched: Number(fetchedRow?.count || 0),
        queue: 0,
        disallow: Number(disallowRow?.count || 0),
        html: Number(typeStats?.html || 0),
        jscss: Number(typeStats?.jscss || 0),
        image: Number(typeStats?.image || 0),
        redirect: Number(codeStats?.redirect || 0),
        error: Number(codeStats?.error || 0),
        depth3: Number(depthStats?.depth3 || 0),
        depth5: Number(depthStats?.depth5 || 0),
        depth6: Number(depthStats?.depth6 || 0),
      };

      return { success: true, data: stats };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:deleteFiltered', async (_event, projectId, dbTable = 'urls', filters = []) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }

      const filterSql = buildFilterSql(dbTable, filters);
      if (!filterSql.clause) {
        return { success: false, error: 'No active filters' };
      }

      let sql = '';
      let params: any[] = [];

      if (dbTable === 'disallow') {
        sql = `DELETE FROM disallowed WHERE project_id = ?${filterSql.clause}`;
        params = [pid, ...filterSql.params];
      } else if (dbTable === 'parser') {
        sql = `DELETE FROM urls
               WHERE project_id = ?
                 AND source = 'parser'
                 ${filterSql.clause}`;
        params = [pid, ...filterSql.params];
      } else if (dbTable === 'urls') {
        sql = `DELETE FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 ${filterSql.clause}`;
        params = [pid, ...filterSql.params];
      } else if (dbTable === 'jscss') {
        sql = `DELETE FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 AND type IN ('jscss', 'script', 'style')
                 ${filterSql.clause}`;
        params = [pid, ...filterSql.params];
      } else {
        sql = `DELETE FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 AND type = ?
                 ${filterSql.clause}`;
        params = [pid, dbTable, ...filterSql.params];
      }

      const info = db.prepare(sql).run(...params);
      const deleted = info?.changes || 0;
      return { success: true, data: { deleted } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:bulkInsert', async (_event, projectId, urls) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }
      if (!Array.isArray(urls)) {
        return { success: false, error: 'Invalid urls payload' };
      }

      let inputUrls = Array.isArray(urls) ? urls : [];
      let skippedByLimit = 0;
      if (isFreePlan()) {
        const currentCount = getProjectTotalUrls(pid);
        const remaining = Math.max(0, FREE_PLAN_LIMITS.urlsPerProject - currentCount);
        if (remaining <= 0) {
          return {
            success: false,
            code: 'FREE_URLS_LIMIT',
            error: 'В бесплатной версии доступно до 1 000 URL на проект. В Pro-версии нет ограничений по количеству URL.',
            data: { inserted: 0, ignored: 0, skippedByLimit: inputUrls.length, total: inputUrls.length },
          };
        }
        if (inputUrls.length > remaining) {
          skippedByLimit = inputUrls.length - remaining;
          inputUrls = inputUrls.slice(0, remaining);
        }
      }

      const insertStmt = db.prepare(
        `INSERT OR IGNORE INTO urls
          (project_id, source, type, url, status, date, content)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      const now = new Date().toISOString();
      let inserted = 0;
      let ignored = 0;

      const tx = db.transaction((items: string[]) => {
        for (const url of items) {
          const info = insertStmt.run(
            pid,
            'parser',
            'html',
            String(url),
            'uploaded',
            now,
            JSON.stringify({ source: 'parser' })
          );
          if (info && info.changes > 0) inserted++;
          else ignored++;
        }
      });

      tx(inputUrls);
      return {
        success: true,
        data: { inserted, ignored, skippedByLimit, total: Array.isArray(urls) ? urls.length : 0 },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:export', async (_event, options = {}) => {
    try {
      const projectId = options.projectId || options.id;
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }

      const dbTable = String(options.db || 'urls');
      const format = String(options.format || 'xlsx').toLowerCase();
      if (!['xlsx', 'csv', 'json'].includes(format)) {
        return { success: false, error: 'Invalid export format' };
      }

      const scope = String(options.scope || 'filtered');
      let rows: any[] = [];
      if (scope === 'current') {
        rows = Array.isArray(options.rows) ? options.rows : [];
      } else {
        const { sql, params } = buildExportRowsSql(dbTable, pid, options.filters, options.sort);
        rows = db.prepare(sql).all(...params);
      }

      let mergedRows = rows.map((row) => mergeParserContentIntoExportRow(row));
      let exportTruncated = false;
      if (isFreePlan() && format === 'xlsx' && mergedRows.length > FREE_PLAN_LIMITS.exportRows) {
        mergedRows = mergedRows.slice(0, FREE_PLAN_LIMITS.exportRows);
        exportTruncated = true;
      }
      const columns = normalizeExportColumns(options.columns, mergedRows);
      if (!mergedRows.length) {
        return { success: false, error: 'No rows to export' };
      }
      if (!columns.length) {
        return { success: false, error: 'No columns to export' };
      }

      const browserWindow = getWindow();
      const dialogOptions = getExportDialogOptions(dbTable, format, options.projectName);
      const result = browserWindow
        ? await dialog.showSaveDialog(browserWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

      if (result.canceled || !result.filePath) {
        return { success: true, data: { canceled: true } };
      }

      const filePath = ensureExportExtension(result.filePath, format);
      const buffer = buildExportFileBuffer(mergedRows, columns, format);
      fs.writeFileSync(filePath, buffer);
      shell.showItemInFolder(filePath);
      return {
        success: true,
        data: {
          path: filePath,
          rows: mergedRows.length,
          format,
          scope,
          exportTruncated,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:getAllForExport', async (_event, options) => {
    try {
      const project_id = options.id;
      const dbTable = options.db || 'urls';

      const { sortBy, order } = getSortConfig(dbTable, options.sort);

      let sql: string;
      let params: any[];
      if (dbTable === 'disallow') {
        sql = `SELECT * FROM disallowed WHERE project_id = ? ORDER BY ${sortBy} ${order}`;
        params = [project_id];
      } else if (dbTable === 'parser') {
        sql = `SELECT * FROM urls
               WHERE project_id = ?
                 AND source = 'parser'
               ORDER BY ${sortBy} ${order}`;
        params = [project_id];
      } else if (dbTable === 'urls') {
        sql = `SELECT * FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
               ORDER BY ${sortBy} ${order}`;
        params = [project_id];
      } else if (dbTable === 'jscss') {
        sql = `SELECT * FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 AND type IN ('jscss', 'script', 'style')
               ORDER BY ${sortBy} ${order}`;
        params = [project_id];
      } else {
        sql = `SELECT * FROM urls
               WHERE project_id = ?
                 AND COALESCE(source, 'crawler') = 'crawler'
                 AND type = ?
               ORDER BY ${sortBy} ${order}`;
        params = [project_id, dbTable];
      }

      const result = db.prepare(sql).all(...params);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:url-history:get', async (_event, projectId, url, paramKey, limit) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'Invalid url' };
      }
      if (!paramKey || typeof paramKey !== 'string') {
        return { success: false, error: 'Invalid paramKey' };
      }
      const lim = normalizeLimit(limit, 200);
      const rows = db.prepare(
        `SELECT * FROM url_param_history
         WHERE project_id = ? AND url = ? AND param_key = ?
         ORDER BY changed_at DESC
         LIMIT ?`
      ).all(pid, url, paramKey, lim);
      return { success: true, data: rows };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:crawler:clear', async (_event, projectId) => {
    try {
      const infoUrls = db.prepare("DELETE FROM urls WHERE project_id = ? AND COALESCE(source, 'crawler') = 'crawler'").run(projectId);
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

  ipcMain.handle('db:parser:reset', async (_event, projectId) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }

      const result = db.prepare(
        `UPDATE urls
         SET type = 'html',
             referrer = NULL,
             depth = NULL,
             code = NULL,
             contentType = NULL,
             protocol = NULL,
             location = NULL,
             actualDataSize = NULL,
             requestTime = NULL,
             requestLatency = NULL,
             downloadTime = NULL,
             status = 'uploaded',
             date = CURRENT_TIMESTAMP,
             content = ?
         WHERE project_id = ?
           AND source = 'parser'`
      ).run(JSON.stringify({ source: 'parser' }), pid);

      const payload = { projectId: pid, updated: result?.changes || 0 };
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('parser:data-reset', payload);
      }
      return { success: true, data: payload };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:parser:resetFiltered', async (_event, projectId, filters = []) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }

      const filterSql = buildFilterSql('parser', filters);
      if (!filterSql.clause) {
        return { success: false, error: 'No active filters' };
      }

      const result = db.prepare(
        `UPDATE urls
         SET type = 'html',
             referrer = NULL,
             depth = NULL,
             code = NULL,
             contentType = NULL,
             protocol = NULL,
             location = NULL,
             actualDataSize = NULL,
             requestTime = NULL,
             requestLatency = NULL,
             downloadTime = NULL,
             status = 'uploaded',
             date = CURRENT_TIMESTAMP,
             content = ?
         WHERE project_id = ?
           AND source = 'parser'
           ${filterSql.clause}`
      ).run(JSON.stringify({ source: 'parser' }), pid, ...filterSql.params);

      const payload = { projectId: pid, updated: result?.changes || 0 };
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('parser:data-reset', payload);
      }
      return { success: true, data: payload };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:parser:clear', async (_event, projectId) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }

      const infoUrls = db.prepare("DELETE FROM urls WHERE project_id = ? AND source = 'parser'").run(pid);
      const payload = { projectId: pid, urlsDeleted: infoUrls?.changes || 0 };
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('parser:data-cleared', payload);
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

  ipcMain.handle('crawler:queue:exists', async (_event, projectId) => {
    try {
      const pid = typeof projectId === 'number' ? projectId : Number(projectId);
      if (!pid || Number.isNaN(pid)) {
        return { success: false, error: 'Invalid projectId' };
      }
      if (!resolvedDbPath) {
        return { success: false, error: 'DB path is not resolved' };
      }

      const dbDir = path.dirname(resolvedDbPath);
      const queueFile = path.join(dbDir, String(pid), 'queue');
      let exists = false;
      let size = 0;
      try {
        if (fs.existsSync(queueFile)) {
          const stat = fs.statSync(queueFile);
          exists = stat.isFile();
          size = typeof stat.size === 'number' ? stat.size : 0;
        }
      } catch (_) {}

      return { success: true, data: { projectId: pid, exists, size } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
