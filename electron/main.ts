import { app, BrowserWindow, shell, ipcMain, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import Database from "better-sqlite3";
import keytar from "keytar";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import newProjectDefaults from "../src/stores/schema/new-project.json" assert { type: "json" };

// Автообновление
import { autoUpdater } from "electron-updater";

// Define __filename and __dirname for ES modules (needed for better-sqlite3 and bindings)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Make them globally available for CommonJS dependencies
(globalThis as any).__filename = __filename;
(globalThis as any).__dirname = __dirname;

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

// Main window will be created at runtime inside createWindow()

let win: BrowserWindow | null;
let db: Database.Database | null = null;
// Crawler worker child process (replaces previous socket server)
let crawlerChild: import('node:child_process').ChildProcess | null = null;
// Persist resolved database path for worker access
let resolvedDbPath: string | null = null;
// Column name for category text (some older DBs use 'category_name')
let categoriesNameColumn = 'name';
// Typing samples schema compatibility (old: label,text | new: url,sample)
let typingLabelColumn = 'label';
let typingTextColumn = 'text';
let typingDateColumn: string | null = 'date';

function isRateLimitError(err: any): boolean {
  try {
    const msg = (err && (err.message || err.toString())) || '';
    const status = (err && (err.status || err.code)) || null;
    return /429/.test(String(msg)) || String(status) === '429' || /rate limit/i.test(msg);
  } catch (_e) {
    return false;
  }
}

// ===== Database Initialization =====
function initializeDatabase() {
  try {
    // Determine DB path
    let dbPath = process.env.DB_PATH;
    if (!dbPath) {
      // In dev (Vite dev server) keep DB inside the project for easier debugging
      if (VITE_DEV_SERVER_URL) {
        const repoRoot = process.env.APP_ROOT || __dirname;
        dbPath = path.join(repoRoot, "db", "projects.db");
      } else {
        const userDataPath = path.join(os.homedir(), ".quantbot");
        dbPath = path.join(userDataPath, "quantbot.db");
      }
    }

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

  console.log("[Main] Initializing database at:", dbPath);
  resolvedDbPath = dbPath; // remember for worker spawning
  
  // Set QUANTBOT_DB_DIR for socket/db-sqlite.cjs module to use the same DB
  process.env.QUANTBOT_DB_DIR = path.dirname(dbPath);

    // Also write the DB path into a small log file next to the database for quick inspection
    try {
      const dbLogPath = path.join(path.dirname(dbPath), 'db-path.log');
      const logContent = `[Main] DB path: ${dbPath}\nstartedAt: ${new Date().toISOString()}\n`;
      fs.writeFileSync(dbLogPath, logContent, { encoding: 'utf8' });
      console.log('[Main] Wrote DB path log to:', dbLogPath);
    } catch (err: any) {
      console.warn('[Main] Failed to write DB path log:', err && err.message ? err.message : err);
    }

    console.log("[Main] Creating Database instance...");
    db = new Database(dbPath);
    console.log("[Main] Database instance created");
    
    console.log("[Main] Setting pragmas...");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -200000");
    db.pragma("mmap_size = 268435456");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma("temp_store = MEMORY");
    console.log("[Main] Pragmas set");

    // Initialize schema
    console.log("[Main] Creating tables...");
    // Projects table
    db.prepare(
      `CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url  TEXT NOT NULL,
        freezed INTEGER DEFAULT 0,
        queue_size INTEGER DEFAULT 0,
        crawler TEXT,
        parser  TEXT,
        ui_columns TEXT,
        stats TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ).run();
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_projects_url ON projects(url);"
    ).run();

    // Add stats column if it doesn't exist (migration for existing DBs)
    try {
      const cols: any[] = db.prepare("PRAGMA table_info('projects')").all();
      const colNames = (cols || []).map((c: any) => c && c.name);
      if (!colNames.includes('stats')) {
        db.prepare("ALTER TABLE projects ADD COLUMN stats TEXT;").run();
        console.log('[Main] Added stats column to projects table');
      }
    } catch (err: any) {
      console.warn('[Main] Failed to add stats column:', err?.message || err);
    }

    // URLs table
    db.prepare(
      `CREATE TABLE IF NOT EXISTS urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        type TEXT,
        url TEXT NOT NULL,
        referrer TEXT,
        depth INTEGER,
        code INTEGER,
        contentType TEXT,
        protocol TEXT,
        location TEXT,
        actualDataSize INTEGER,
        requestTime INTEGER,
        requestLatency INTEGER,
        downloadTime INTEGER,
        status TEXT,
        date TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
    ).run();
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_urls_project ON urls(project_id);"
    ).run();
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_project_url ON urls(project_id, url);"
    ).run();

    // Keywords table
    db.prepare(
      `CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        category_id INTEGER,
        disabled INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
    ).run();
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_keywords_project ON keywords(project_id);"
    ).run();
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_project_keyword ON keywords(project_id, keyword);"
    ).run();

    // Ensure extended columns exist on keywords (safe, idempotent migrations)
    try {
      const kcols: any[] = db.prepare("PRAGMA table_info('keywords')").all();
      const knames = (kcols || []).map((c: any) => c && c.name);
      const addIfMissing = (name: string, type: string, extraSql?: string) => {
        if (!knames.includes(name)) {
          try {
            db!.prepare(`ALTER TABLE keywords ADD COLUMN ${name} ${type};`).run();
          } catch (e) {
            console.warn(`[Main] Failed to add column ${name} on keywords:`, (e as any)?.message || e);
          }
          if (extraSql) {
            try { db!.prepare(extraSql).run(); } catch (_e) {}
          }
        }
      };
      // Columns used by categorization/typing/clustering and filtering
      addIfMissing('category_name', 'TEXT');
      addIfMissing('category_similarity', 'REAL');
      addIfMissing('class_name', 'TEXT');
      addIfMissing('class_similarity', 'REAL');
      addIfMissing('cluster', 'TEXT');
      addIfMissing('blocking_rule', 'TEXT');
      addIfMissing('target_query', 'INTEGER DEFAULT 1', "CREATE INDEX IF NOT EXISTS idx_keywords_target_query ON keywords(target_query);");
    } catch (e) {
      console.warn('[Main] Failed to ensure keywords extended columns:', (e as any)?.message || e);
    }

    // Categories table
    db.prepare(
      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
    ).run();
    // Indexes for categories will be created after we detect which column stores the category text

    // Detect if older DBs use 'category_name' instead of 'name'
    try {
      const cols: any[] = db.prepare("PRAGMA table_info('categories')").all();
      const names = (cols || []).map((c: any) => c && c.name);
      if (names.includes('name')) {
        categoriesNameColumn = 'name';
      } else if (names.includes('category_name')) {
        categoriesNameColumn = 'category_name';
      }
      console.log('[Main] categoriesNameColumn resolved to:', categoriesNameColumn);
    } catch (err: any) {
      console.warn('[Main] Failed to detect categories column name:', err && err.message ? err.message : err);
    }

    // Create indexes for categories based on detected column name
    try {
      db.prepare("CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id);").run();
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_project_name ON categories(project_id, ${categoriesNameColumn});`).run();
    } catch (err: any) {
      console.warn('[Main] Failed to create categories indexes:', err && err.message ? err.message : err);
    }

    // Typing samples table
    db.prepare(
      `CREATE TABLE IF NOT EXISTS typing_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        -- flexible columns (one of these pairs will be used)
        label TEXT,
        text  TEXT,
        url   TEXT,
        sample TEXT,
        date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
    ).run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_typing_samples_project ON typing_samples(project_id);").run();

    // Detect which columns actually store typing label/text
    try {
      const tcols: any[] = db.prepare("PRAGMA table_info('typing_samples')").all();
      const tnames = (tcols || []).map(c => c && c.name);
      const hasLabel = tnames.includes('label');
      const hasText = tnames.includes('text');
      const hasUrl = tnames.includes('url');
      const hasSample = tnames.includes('sample');
      const hasDate = tnames.includes('date');
      if (hasLabel && hasText) {
        typingLabelColumn = 'label';
        typingTextColumn = 'text';
      } else if (hasUrl && hasSample) {
        typingLabelColumn = 'url';
        typingTextColumn = 'sample';
      }
      typingDateColumn = hasDate ? 'date' : null;
      console.log('[Main] typing samples columns resolved:', { typingLabelColumn, typingTextColumn, typingDateColumn });
    } catch (err: any) {
      console.warn('[Main] Failed to detect typing_samples columns:', err && err.message ? err.message : err);
    }

    // Stopwords table
    db.prepare(
      `CREATE TABLE IF NOT EXISTS stop_words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        word TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
    ).run();
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_stop_words_project ON stop_words(project_id);"
    ).run();
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_stop_words_project_word ON stop_words(project_id, word);"
    ).run();

    // Embeddings cache table (если отсутствует)
    try {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS embeddings_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          vector_model TEXT,
          embedding BLOB,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      ).run();
      db.prepare(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_cache_key ON embeddings_cache(key, vector_model);'
      ).run();
      console.log('[Main] embeddings_cache table ready');
    } catch (err: any) {
      console.error('[Main] Failed to create embeddings_cache table:', err?.message || err);
    }

    console.log("[Main] Database schema initialized successfully");
  } catch (err: any) {
    console.error("[Main] Failed to initialize database:", err.message);
    throw err;
  }
}

// --- Bridge main-process logs to renderer console ---
type LogLevel = 'log' | 'info' | 'warn' | 'error';
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
const logBuffer: Array<{ level: LogLevel; args: any[] }> = [];

function sendLogToRenderer(level: LogLevel, args: any[]) {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('app-log', { level, args });
    } else {
      logBuffer.push({ level, args });
    }
  } catch (_e) {
    // ignore
  }
}

// Monkey-patch console methods to mirror logs to renderer
console.log = (...args: any[]) => {
  originalConsole.log(...args);
  sendLogToRenderer('log', args);
};
console.info = (...args: any[]) => {
  originalConsole.info(...args);
  sendLogToRenderer('info', args);
};
console.warn = (...args: any[]) => {
  originalConsole.warn(...args);
  sendLogToRenderer('warn', args);
};
console.error = (...args: any[]) => {
  originalConsole.error(...args);
  sendLogToRenderer('error', args);
};

// Register IPC handlers for renderer DB operations
function registerIpcHandlers() {
  // Projects
  ipcMain.handle('db:projects:getAll', async () => {
    try {
      console.log('[IPC] db:projects:getAll called');
      const result = db!.prepare('SELECT * FROM projects ORDER BY id DESC').all();
      console.log('[IPC] db:projects:getAll result:', Array.isArray(result) ? `count=${result.length}` : result);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[IPC] db:projects:getAll error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:get', async (_event, id) => {
    try {
      const row: any = db!.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (!row) return { success: true, data: null };
      // Parse JSON columns to proper shapes for renderer
      const parseJson = (val: any, fallback: any) => {
        if (val === null || typeof val === 'undefined') return fallback;
        if (typeof val === 'object') return val;
        if (typeof val === 'string') {
          const s = val.trim();
          if (!s) return fallback;
          try { return JSON.parse(s); } catch { return fallback; }
        }
        return fallback;
      };
      
      // Deep merge crawler config with defaults (preserve DB values, fill missing with defaults)
      const crawlerFromDb = parseJson(row.crawler, {});
      const crawler = { ...newProjectDefaults.crawler, ...crawlerFromDb };
      
      // Parser: use DB value if exists, otherwise defaults
      const parserFromDb = parseJson(row.parser, []);
      const parser = Array.isArray(parserFromDb) && parserFromDb.length > 0 
        ? parserFromDb 
        : newProjectDefaults.parser;
      
      const data = {
        ...row,
        crawler,
        parser,
        columns: parseJson(row.ui_columns, newProjectDefaults.columns || {}),
        stats: parseJson(row.stats, newProjectDefaults.stats || null),
      };
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:insert', async (_event, name, url) => {
    try {
      console.log('[IPC] db:projects:insert payload:', { name, url });
      // Инициализируем crawler и parser значениями по умолчанию из new-project.json
      const defaultCrawler = JSON.stringify(newProjectDefaults.crawler || {});
      const defaultParser = JSON.stringify(newProjectDefaults.parser || []);
      const defaultStats = JSON.stringify(newProjectDefaults.stats || {});
      const defaultColumns = JSON.stringify(newProjectDefaults.columns || {});
      
      const result = db!.prepare(
        'INSERT INTO projects (name, url, crawler, parser, stats, ui_columns) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(name, url, defaultCrawler, defaultParser, defaultStats, defaultColumns);
      console.log('[IPC] db:projects:insert result:', result);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[IPC] db:projects:insert error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:update', async (_event, name, url, id) => {
    try {
      const result = db!.prepare('UPDATE projects SET name = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, url, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Update crawler/parser/ui_columns/stats JSON for a project
  ipcMain.handle('db:projects:updateConfigs', async (_event, id, crawler, parser, columns, stats) => {
    try {
      // Normalize and validate id
      const pid = typeof id === 'number' ? id : Number(id);
      if (!pid || Number.isNaN(pid)) {
        console.warn('[IPC] db:projects:updateConfigs invalid project id:', id);
        return { success: false, error: 'Invalid project id' };
      }
      const crawlerJson = JSON.stringify(crawler ?? {});
      const parserJson = JSON.stringify(Array.isArray(parser) ? parser : []);
      const columnsJson = JSON.stringify(columns ?? {});
      const statsJson = stats ? JSON.stringify(stats) : null;
      const stmt = db!.prepare('UPDATE projects SET crawler = ?, parser = ?, ui_columns = ?, stats = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      const result = stmt.run(crawlerJson, parserJson, columnsJson, statsJson, pid);
      console.log('[IPC] db:projects:updateConfigs saved', { id: pid, changes: result.changes });
      return { success: true, data: { changes: result.changes } };
    } catch (error: any) {
      console.error('[IPC] db:projects:updateConfigs error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:delete', async (_event, id) => {
    try {
      const result = db!.prepare('DELETE FROM projects WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Keywords
  ipcMain.handle('db:keywords:getAll', async (_event, projectId) => {
    try {
      const result = db!.prepare('SELECT * FROM keywords WHERE project_id = ? ORDER BY id').all(projectId);
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
        // Support special filter: target:1 or target:0 or target:true/false/yes/no
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
        // Search across multiple text columns: keyword, blocking_rule, category_name, class_name
        sql += ' AND (keyword LIKE ? OR blocking_rule LIKE ? OR category_name LIKE ? OR class_name LIKE ?)';
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }
      
      // Sort: accept either { column, direction } or a numeric sort object { field: 1/-1 }
      const allowedSortColumns = [
        'id',
        'keyword',
        'created_at',
        'category_id',
        'category_name',
        'category_similarity',
        'class_name',
        'class_similarity',
        'cluster_label',
        'target_query'
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
      
      // Pagination
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, skip);
      
      const rows = db!.prepare(sql).all(...params);

      // Get total count for this query
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
  const countResult: any = db!.prepare(countSql).get(...countParams);

      const result = {
        keywords: rows,
        total: countResult.total,
        skip,
        limit,
      };

      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:insert', async (_event, keyword, projectId, categoryId, _color, disabled) => {
    try {
      const result = db!.prepare(
        'INSERT INTO keywords (keyword, project_id, category_id, disabled) VALUES (?, ?, ?, ?)'
      ).run(keyword, projectId, categoryId, disabled);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:update', async (_event, keyword, categoryId, _color, disabled, id) => {
    try {
      const result = db!.prepare(
        'UPDATE keywords SET keyword = ?, category_id = ?, disabled = ? WHERE id = ?'
      ).run(keyword, categoryId, disabled, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:delete', async (_event, id) => {
    try {
      const result = db!.prepare('DELETE FROM keywords WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:insertBulk', async (_event, keywords, projectId) => {
    console.log('[Main IPC] db:keywords:insertBulk handler called:', {
      keywordsType: Array.isArray(keywords) ? 'array' : typeof keywords,
      keywordsCount: Array.isArray(keywords) ? keywords.length : 'N/A',
      projectIdType: typeof projectId,
      projectId
    });
    
    try {
      if (!Array.isArray(keywords)) {
        throw new Error(`Expected keywords to be an array, got ${typeof keywords}`);
      }
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const insertStmt = db!.prepare(
        'INSERT OR IGNORE INTO keywords (keyword, project_id) VALUES (?, ?)'
      );
      let inserted = 0;
      const insertMany = db!.transaction((kws: string[]) => {
        for (const kw of kws) {
          const info = insertStmt.run(kw, projectId);
          if (info.changes > 0) inserted++;
        }
      });
      insertMany(keywords);
      
      // After inserting, apply stop-words rules so target_query and blocking_rule are set
      try {
        // Use the socket DB helper which contains keywordsApplyStopWords implementation
        // require relative to project root
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const socketDbPath = path.join(process.env.APP_ROOT || __dirname, 'socket', 'db-sqlite.cjs');
        console.log('[Main IPC] Loading socket db-sqlite from:', socketDbPath);
        const socketDb = require(socketDbPath);
        if (socketDb && typeof socketDb.keywordsApplyStopWords === 'function') {
          console.log('[Main IPC] Applying stop-words after insertBulk for project', projectId);
          await socketDb.keywordsApplyStopWords(projectId);
          console.log('[Main IPC] Stop-words applied successfully after insertBulk');
        } else {
          console.warn('[Main IPC] keywordsApplyStopWords function not found in socket db-sqlite');
        }
      } catch (e) {
        console.error('[Main IPC] Error applying stop-words after insertBulk:', e);
      }

      const result = {
        inserted,
        total: keywords.length,
        skipped: keywords.length - inserted,
      };
      console.log('[Main IPC] db:keywords:insertBulk success:', result);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Main IPC] db:keywords:insertBulk error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateCategory', async (_event, id, categoryName, categorySimilarity) => {
    try {
      const result = db!.prepare(
        'UPDATE keywords SET category_name = ?, category_similarity = ? WHERE id = ?'
      ).run(categoryName, categorySimilarity, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateClass', async (_event, id, className, classSimilarity) => {
    try {
      const result = db!.prepare(
        'UPDATE keywords SET class_name = ?, class_similarity = ? WHERE id = ?'
      ).run(className, classSimilarity, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateCluster', async (_event, id, cluster) => {
    try {
      const result = db!
        .prepare('UPDATE keywords SET cluster = ?, cluster_label = ? WHERE id = ?')
        .run(cluster, String(cluster), id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:deleteByProject', async (_event, projectId) => {
    try {
      const result = db!.prepare('DELETE FROM keywords WHERE project_id = ?').run(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Categories
  ipcMain.handle('db:categories:getAll', async (_event, projectId) => {
    try {
      const result = db!.prepare(`SELECT id, project_id, ${categoriesNameColumn} AS category_name, created_at FROM categories WHERE project_id = ?`).all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:insert', async (_event, name, projectId) => {
    try {
      console.log('[IPC] db:categories:insert payload:', { name, projectId });
      const info = db!.prepare(
        `INSERT INTO categories (${categoriesNameColumn}, project_id) VALUES (?, ?)`
      ).run(name, projectId);

      if (!info || info.changes === 0) {
        console.warn('[IPC] db:categories:insert: no rows inserted (possible duplicate)');
        return { success: false, error: 'No rows inserted (duplicate?)' };
      }

  const inserted = db!.prepare(`SELECT id, project_id, ${categoriesNameColumn} AS category_name, created_at FROM categories WHERE id = ?`).get(info.lastInsertRowid);
      return { success: true, data: inserted };
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('[IPC] db:categories:insert error:', msg);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('db:categories:update', async (_event, name, id) => {
    try {
      const result = db!.prepare(
        `UPDATE categories SET ${categoriesNameColumn} = ? WHERE id = ?`
      ).run(name, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:delete', async (_event, id) => {
    try {
      const result = db!.prepare('DELETE FROM categories WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Typing (schema-compatible)
  ipcMain.handle('db:typing:getAll', async (_event, projectId) => {
    try {
      const result = db!.prepare(`SELECT id, project_id, ${typingLabelColumn} AS label, ${typingTextColumn} AS text, ${typingDateColumn ? typingDateColumn + ' AS date,' : ''} created_at FROM typing_samples WHERE project_id = ?`).all(projectId);
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
      const info = db!.prepare(`INSERT INTO typing_samples (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);

      if (!info || info.changes === 0) {
        return { success: false, error: 'No typing sample inserted' };
      }
      const inserted = db!.prepare(`SELECT id, project_id, ${typingLabelColumn} AS label, ${typingTextColumn} AS text, ${typingDateColumn ? typingDateColumn + ' AS date,' : ''} created_at FROM typing_samples WHERE id = ?`).get(info.lastInsertRowid);
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
      const result = db!.prepare(`UPDATE typing_samples SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:delete', async (_event, id) => {
    try {
      const result = db!.prepare('DELETE FROM typing_samples WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:deleteByProject', async (_event, projectId) => {
    try {
      const result = db!.prepare('DELETE FROM typing_samples WHERE project_id = ?').run(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Stopwords
  ipcMain.handle('db:stopwords:getAll', async (_event, projectId) => {
    try {
      const result = db!.prepare('SELECT * FROM stop_words WHERE project_id = ?').all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:insert', async (_event, projectId, word) => {
    try {
      console.log('[Main IPC] db:stopwords:insert called with projectId:', projectId, 'word:', word);
      console.log('[Main IPC] db instance:', db ? 'exists' : 'NULL');
      
      if (!db) {
        console.error('[Main IPC] Database not initialized!');
        return { success: false, error: 'Database not initialized' };
      }
      
      const result = db.prepare(
        'INSERT OR IGNORE INTO stop_words (project_id, word) VALUES (?, ?)'
      ).run(projectId, word);
      
      console.log('[Main IPC] Insert result:', result);
      console.log('[Main IPC] Changes:', result.changes, 'LastInsertRowid:', result.lastInsertRowid);

      // Apply stop-words rules to keywords after modification
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const socketDbPath = path.join(process.env.APP_ROOT || __dirname, 'socket', 'db-sqlite.cjs');
        console.log('[Main IPC] Loading socket db-sqlite from:', socketDbPath);
        const socketDb = require(socketDbPath);
        if (socketDb && typeof socketDb.keywordsApplyStopWords === 'function') {
          console.log('[Main IPC] Applying stop-words for project:', projectId);
          await socketDb.keywordsApplyStopWords(projectId);
          console.log('[Main IPC] Stop-words applied successfully');
        } else {
          console.warn('[Main IPC] keywordsApplyStopWords function not found in socket db-sqlite');
        }
      } catch (e) {
        console.error('[Main IPC] Error applying stop-words after insert:', e);
      }
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Main IPC] db:stopwords:insert error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:delete', async (_event, id) => {
    try {
      // Get project_id BEFORE deletion
      const row: any = db!.prepare('SELECT project_id FROM stop_words WHERE id = ?').get(id);
      const projectId = row ? row.project_id : null;
      
      // Now delete the stop word
      const result = db!.prepare('DELETE FROM stop_words WHERE id = ?').run(id);
      
      // Re-apply stop-words rules after deletion
      if (projectId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const socketDbPath = path.join(process.env.APP_ROOT || __dirname, 'socket', 'db-sqlite.cjs');
          console.log('[Main IPC] Loading socket db-sqlite from:', socketDbPath);
          const socketDb = require(socketDbPath);
          if (socketDb && typeof socketDb.keywordsApplyStopWords === 'function') {
            console.log('[Main IPC] Re-applying stop-words after deletion for project:', projectId);
            await socketDb.keywordsApplyStopWords(projectId);
            console.log('[Main IPC] Stop-words re-applied successfully');
          } else {
            console.warn('[Main IPC] keywordsApplyStopWords function not found in socket db-sqlite');
          }
        } catch (e) {
          console.error('[Main IPC] Error applying stop-words after delete:', e);
        }
      }
      
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:deleteByProject', async (_event, projectId) => {
    try {
      const result = db!.prepare('DELETE FROM stop_words WHERE project_id = ?').run(projectId);
      
      // Re-apply stop-words rules (will reset all to target_query=1 since no stopwords left)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const socketDbPath = path.join(process.env.APP_ROOT || __dirname, 'socket', 'db-sqlite.cjs');
        console.log('[Main IPC] Loading socket db-sqlite from:', socketDbPath);
        const socketDb = require(socketDbPath);
        if (socketDb && typeof socketDb.keywordsApplyStopWords === 'function') {
          console.log('[Main IPC] Re-applying stop-words after deleteByProject for project:', projectId);
          await socketDb.keywordsApplyStopWords(projectId);
          console.log('[Main IPC] Stop-words re-applied successfully (all reset to target_query=1)');
        } else {
          console.warn('[Main IPC] keywordsApplyStopWords function not found in socket db-sqlite');
        }
      } catch (e) {
        console.error('[Main IPC] Error applying stop-words after deleteByProject:', e);
      }
      
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // URLs
  ipcMain.handle('db:urls:getAll', async (_event, projectId) => {
    try {
      const result = db!.prepare('SELECT * FROM urls WHERE project_id = ?').all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:getSorted', async (_event, options) => {
    try {
      console.log('[Electron IPC] db:urls:getSorted received:', options);
      
      const project_id = options.id;
      const limit = options.limit || 50;
      const offset = options.skip || 0;
      const dbTable = options.db || 'urls'; // Default to urls if not specified

      let sortBy = 'id';
      let order = 'ASC';

      if (options.sort && typeof options.sort === 'object') {
        const sortKeys = Object.keys(options.sort);
        if (sortKeys.length > 0) {
          sortBy = sortKeys[0];
          order = options.sort[sortBy] === -1 ? 'DESC' : 'ASC';
        }
      }

      let sql: string;
      let params: any[];

      // Build SQL based on table type
      // Note: limit=0 means no limit (get all rows)
      const limitClause = limit > 0 ? `LIMIT ? OFFSET ?` : '';
      
      // Choose table based on db parameter
      if (dbTable === 'disallow') {
        sql = `SELECT * FROM disallowed WHERE project_id = ? ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, limit, offset] : [project_id];
      } else if (dbTable === 'urls') {
        sql = `SELECT * FROM urls WHERE project_id = ? ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, limit, offset] : [project_id];
      } else {
        // Filter by type for other tables (html, image, etc.)
        sql = `SELECT * FROM urls WHERE project_id = ? AND type = ? ORDER BY ${sortBy} ${order} ${limitClause}`;
        params = limit > 0 ? [project_id, dbTable, limit, offset] : [project_id, dbTable];
      }

      console.log('[Electron IPC] Executing SQL:', { sql, params, dbTable, limit });
      const result = db!.prepare(sql).all(...params);
      console.log('[Electron IPC] Query result:', { rowCount: result.length, dbTable });
      
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Electron IPC] db:urls:getSorted error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:count', async (_event, projectId) => {
    try {
      const result = db!.prepare('SELECT COUNT(*) as count FROM urls WHERE project_id = ?').get(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Export-only IPC handler that fetches ALL rows without pagination
  // Used exclusively for data export, doesn't affect UI state
  ipcMain.handle('db:urls:getAllForExport', async (_event, options) => {
    try {
      console.log('[Electron IPC] db:urls:getAllForExport received:', options);
      
      const project_id = options.id;
      const dbTable = options.db || 'urls';

      let sortBy = 'id';
      let order = 'ASC';

      if (options.sort && typeof options.sort === 'object') {
        const sortKeys = Object.keys(options.sort);
        if (sortKeys.length > 0) {
          sortBy = sortKeys[0];
          order = options.sort[sortBy] === -1 ? 'DESC' : 'ASC';
        }
      }

      let sql: string;
      let params: any[];

      // Build SQL based on table type - NO LIMIT for export
      if (dbTable === 'disallow') {
        sql = `SELECT * FROM disallowed WHERE project_id = ? ORDER BY ${sortBy} ${order}`;
        params = [project_id];
      } else if (dbTable === 'urls') {
        sql = `SELECT * FROM urls WHERE project_id = ? ORDER BY ${sortBy} ${order}`;
        params = [project_id];
      } else {
        // Filter by type for other tables (html, image, etc.)
        sql = `SELECT * FROM urls WHERE project_id = ? AND type = ? ORDER BY ${sortBy} ${order}`;
        params = [project_id, dbTable];
      }

      console.log('[Electron IPC Export] Executing SQL:', { sql, params, dbTable });
      const result = db!.prepare(sql).all(...params);
      console.log('[Electron IPC Export] Query result:', { rowCount: result.length, dbTable });
      
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Electron IPC] db:urls:getAllForExport error:', error);
      return { success: false, error: error.message };
    }
  });

  // Clear crawler data for a project (urls + disallowed if exists), reset queue_size
  ipcMain.handle('db:crawler:clear', async (_event, projectId) => {
    try {
      const infoUrls = db!.prepare('DELETE FROM urls WHERE project_id = ?').run(projectId);
      let disallowedDeleted = 0;
      try {
        const infoDis = db!.prepare('DELETE FROM disallowed WHERE project_id = ?').run(projectId);
        disallowedDeleted = infoDis?.changes || 0;
      } catch (_e) {
        // disallowed table may not exist in this schema — ignore
      }
      try {
        db!.prepare('UPDATE projects SET queue_size = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);
      } catch (_e) {}
      const payload = { projectId, urlsDeleted: infoUrls?.changes || 0, disallowedDeleted };
      if (win && !win.isDestroyed()) {
        win.webContents.send('crawler:data-cleared', payload);
      }
      return { success: true, data: payload };
    } catch (error: any) {
      console.error('[IPC] db:crawler:clear error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  // Clear persisted crawler queue file for a project: db/<projectId>/queue
  ipcMain.handle('crawler:queue:clear', async (_event, projectId) => {
    try {
      if (!resolvedDbPath) {
        return { success: false, error: 'DB path is not resolved' };
      }
      const dbDir = path.dirname(resolvedDbPath);
      const queueDir = path.join(dbDir, String(projectId));
      const queueFile = path.join(queueDir, 'queue');
      try {
        fs.rmSync(queueFile, { force: true });
      } catch (_e) {}
      // Optionally, remove empty project dir
      try {
        const files = fs.readdirSync(queueDir);
        if (!files || files.length === 0) {
          fs.rmdirSync(queueDir);
        }
      } catch (_e) {}
      // Notify renderer for UI feedback if needed
      if (win && !win.isDestroyed()) {
        win.webContents.send('crawler:queue:cleared', { projectId });
      }
      return { success: true, data: { projectId } };
    } catch (error: any) {
      console.error('[IPC] crawler:queue:clear error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  // ==== Integrations: OpenAI key management via keytar ====
  const INTEGRATION_SERVICE = 'site-analyzer';

  ipcMain.handle('integrations:get', async (_event, projectId, service) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      const account = String(service);
      const secret = await keytar.getPassword(INTEGRATION_SERVICE, account);
      const hasKey = !!secret;
      let maskedKey: string | null = null;
      if (secret) {
        maskedKey = secret.length >= 8
          ? `${secret.slice(0, 4)}...${secret.slice(-4)}`
          : `${secret.slice(0, 2)}...${secret.slice(-2)}`;
      }
      const payload = { projectId, service, hasKey, maskedKey };
      if (win && !win.isDestroyed()) {
        win.webContents.send('integrations:info', payload);
      }
      return { success: true, data: payload };
    } catch (error: any) {
      console.error('[IPC] integrations:get error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('integrations:setKey', async (_event, projectId, service, key) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      const account = String(service);
      if (!key || key === '') {
        await keytar.deletePassword(INTEGRATION_SERVICE, account);
        if (win && !win.isDestroyed()) {
          win.webContents.send('integrations:deleted', { projectId, service });
        }
        return { success: true, data: { deleted: true } };
      }
      await keytar.setPassword(INTEGRATION_SERVICE, account, key);
      if (win && !win.isDestroyed()) {
        win.webContents.send('integrations:setKey:ok', { projectId, service });
      }
      return { success: true, data: { saved: true } };
    } catch (error: any) {
      console.error('[IPC] integrations:setKey error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('integrations:delete', async (_event, projectId, service) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      const account = String(service);
      await keytar.deletePassword(INTEGRATION_SERVICE, account);
      if (win && !win.isDestroyed()) {
        win.webContents.send('integrations:deleted', { projectId, service });
      }
      return { success: true, data: { deleted: true } };
    } catch (error: any) {
      console.error('[IPC] integrations:delete error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  // ==== Embeddings cache (size / clear) ====
  ipcMain.handle('embeddings:getCacheSize', async () => {
    try {
      const row: any = db!.prepare('SELECT COUNT(*) as count FROM embeddings_cache').get();
      const size = row ? Number(row.count) : 0;
      // send event to renderer so existing listeners receive it
      if (win && !win.isDestroyed()) {
        win.webContents.send('embeddings-cache-size', { size });
      }
      return { success: true, data: { size } };
    } catch (error: any) {
      console.error('[IPC] embeddings:getCacheSize error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('embeddings:clearCache', async () => {
    try {
      const info = db!.prepare('DELETE FROM embeddings_cache').run();
      // уведомим рендерер совместимым событием
      if (win && !win.isDestroyed()) {
        win.webContents.send('embeddings-cache-cleared');
      }
      return { success: true, data: { changes: info?.changes ?? 0 } };
    } catch (error: any) {
      console.error('[IPC] embeddings:clearCache error:', error?.message || error);
      return { success: false, error: error.message };
    }
  });

  // Process runners: categorization, typing, clustering
  ipcMain.handle('keywords:start-categorization', async (_event, projectId) => {
    try {
      // Start categorization worker
      startCategorizationWorker(projectId);
      return { success: true };
    } catch (error: any) {
      console.error('Categorization start error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('keywords:start-typing', async (_event, projectId) => {
    try {
      // Start typing worker
      startTypingWorker(projectId);
      return { success: true };
    } catch (error: any) {
      console.error('Typing start error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('keywords:start-clustering', async (_event, projectId, algorithm, eps, minPts) => {
    try {
      // Start clustering worker
      startClusteringWorker(projectId, algorithm, eps, minPts);
      return { success: true };
    } catch (error: any) {
      console.error('Clustering start error:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('IPC handlers registered');
}

// Prevent running multiple full Electron instances (avoid multiple windows)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // If we couldn't get the lock, another instance is already running — quit this one.
  app.quit();
}

// Worker process runners for categorization, typing, clustering
async function startCategorizationWorker(projectId: number) {
  const workerPath = path.join(__dirname, '..', 'worker', 'assignCategorization.cjs');
  
  console.log(`Starting categorization worker for project ${projectId}`);
  
  try {
    // Load categories and keywords from DB
  const categories = db!.prepare(`SELECT id, project_id, ${categoriesNameColumn} AS category_name, created_at FROM categories WHERE project_id = ?`).all(projectId);
  // Process only target keywords
  const keywords = db!.prepare('SELECT * FROM keywords WHERE project_id = ? AND target_query = 1').all(projectId);

    if (!keywords || keywords.length === 0) {
      console.warn(`No target keywords (target_query=1) found for project ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'No target keywords (target_query=1) found for project',
        });
      }
      return;
    }

    // Attach embeddings to keywords using the embeddings helper
    console.log(`Attaching embeddings to ${keywords.length} keywords...`);
    const HandlerKeywords = require(path.join(__dirname, '..', 'socket', 'HandlerKeywords.cjs'));
    const attachEmbeddingsToKeywords = HandlerKeywords.attachEmbeddingsToKeywords;
    
    let embeddingStats;
    try {
      // более щадящая нагрузка по умолчанию
      embeddingStats = await attachEmbeddingsToKeywords(keywords, { chunkSize: 10 });
      console.log('Embedding stats:', embeddingStats);
    } catch (embErr: any) {
      console.error('[categorization] Failed to prepare embeddings:', embErr?.message || embErr);
      if (win && !win.isDestroyed()) {
        const rateLimited = isRateLimitError(embErr);
        win.webContents.send('keywords:categorization-error', {
          projectId,
          status: rateLimited ? 429 : undefined,
          message: rateLimited ? 'Request failed with status code 429' : 'Не удалось получить эмбеддинги для категоризации. Проверьте OpenAI ключ.',
        });
      }
      return;
    }

    if (!embeddingStats.embedded) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'Не удалось подготовить эмбеддинги для категоризации.',
        });
      }
      return;
    }

    // Create temporary directory and input file
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'categorization-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
    const input = JSON.stringify({ categories: categories || [], keywords });
    
    await fs.promises.writeFile(inputPath, input, 'utf8');
    console.log(`Created input file: ${inputPath}`);

    const child = spawn(process.execPath, [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`], {
      env: Object.assign({}, process.env, { 
        ELECTRON_RUN_AS_NODE: '1',
        QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Parse progress and results from stdout
    let processed = 0;
    child.stdout?.setEncoding('utf8');
    let stdoutBuffer = '';
    
    child.stdout?.on('data', (data) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        
        console.log(`[Categorization Worker ${projectId}]`, line);
        
        // Try to parse as JSON result
        try {
          const obj = JSON.parse(line);
          processed++;
          
          // Update keyword in DB
          if (obj.id && obj.bestCategoryName !== undefined) {
            db!.prepare('UPDATE keywords SET category_name = ?, category_similarity = ? WHERE id = ?')
              .run(obj.bestCategoryName, obj.similarity || null, obj.id);
            try {
              // Fetch updated row and notify renderer so it can merge the single-row change
              const updated = db!.prepare('SELECT * FROM keywords WHERE id = ?').get(obj.id);
              if (updated && win && !win.isDestroyed()) {
                win.webContents.send('keywords:updated', { projectId, keyword: updated });
              }
            } catch (e) {
              console.warn('[Main] Failed to notify renderer about keywords:updated for categorization', e && (e as any).message ? (e as any).message : e);
            }
          }

          // Send progress update
          const progress = Math.round((processed / keywords.length) * 100);
          if (win && !win.isDestroyed()) {
            console.log(`Sending categorization progress: ${progress}% (${processed}/${keywords.length})`);
            win.webContents.send('keywords:categorization-progress', {
              projectId,
              progress,
            });
          }
        } catch (e) {
          // Not JSON, might be a log message
          if (line.includes('progress:')) {
            const match = line.match(/progress: (\d+)/);
            if (match && win) {
              win.webContents.send('keywords:categorization-progress', {
                projectId,
                progress: parseInt(match[1]),
              });
            }
          }
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data) => {
      console.error(`[Categorization Worker ${projectId} ERROR]`, data.toString().trim());
    });

    child.on('exit', async (code) => {
      console.log(`Categorization worker exited with code ${code}`);
      console.log(`Window exists: ${!!win}, isDestroyed: ${win?.isDestroyed()}`);
      
      // Cleanup temp file
      try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to cleanup temp dir:', e);
      }

      if (win && !win.isDestroyed()) {
        if (code === 0) {
          console.log(`Sending keywords:categorization-finished for project ${projectId}`);
          win.webContents.send('keywords:categorization-finished', { projectId });
        } else {
          win.webContents.send('keywords:categorization-error', {
            projectId,
            message: `Worker exited with code ${code}`,
          });
        }
      }
    });
  } catch (error: any) {
    console.error('Failed to start categorization worker:', error);
    if (win) {
      win.webContents.send('keywords:categorization-error', {
        projectId,
        message: error.message || 'Failed to start worker',
      });
    }
  }
}

async function startTypingWorker(projectId: number) {
  const workerPath = path.join(__dirname, '..', 'worker', 'trainAndClassify.cjs');
  
  console.log(`Starting typing worker for project ${projectId}`);
  
  try {
  // Load typing samples and keywords from DB
  const typingSamples = db!.prepare(`SELECT id, project_id, ${typingLabelColumn} AS label, ${typingTextColumn} AS text, ${typingDateColumn ? typingDateColumn + ' AS date,' : ''} created_at FROM typing_samples WHERE project_id = ?`).all(projectId);
    // Process only target keywords
    const keywords = db!.prepare('SELECT * FROM keywords WHERE project_id = ? AND target_query = 1').all(projectId);

    if (!keywords || keywords.length === 0) {
      console.warn(`No target keywords (target_query=1) found for project ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:typing-error', {
          projectId,
          message: 'No target keywords (target_query=1) found for project',
        });
      }
      return;
    }

    // Create temporary directory and input file
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'typing-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
    const input = JSON.stringify({ typingSamples: typingSamples || [], keywords: keywords || [] });
    
    await fs.promises.writeFile(inputPath, input, 'utf8');
    console.log(`Created typing input file: ${inputPath}`);

    const child = spawn(process.execPath, [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`], {
      env: Object.assign({}, process.env, { 
        ELECTRON_RUN_AS_NODE: '1',
        QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let processed = 0;
    child.stdout?.setEncoding('utf8');
    let stdoutBuffer = '';
    
    child.stdout?.on('data', (data) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        
        console.log(`[Typing Worker ${projectId}]`, line);
        
          try {
          const obj = JSON.parse(line);
          processed++;

          // Update keyword in DB — support worker output shape (bestCategoryName) and legacy className
          const cname = obj.bestCategoryName ?? obj.className ?? null;
          if (obj.id && cname !== null) {
            db!.prepare('UPDATE keywords SET class_name = ?, class_similarity = ? WHERE id = ?')
              .run(cname, obj.similarity ?? null, obj.id);
            try {
              const updated = db!.prepare('SELECT * FROM keywords WHERE id = ?').get(obj.id);
              if (updated && win && !win.isDestroyed()) {
                win.webContents.send('keywords:updated', { projectId, keyword: updated });
              }
            } catch (e) {
              console.warn('[Main] Failed to notify renderer about keywords:updated for typing', e && (e as any).message ? (e as any).message : e);
            }
          }

          // Send progress
          if (keywords && keywords.length > 0) {
            const progress = Math.round((processed / keywords.length) * 100);
            if (win) {
              win.webContents.send('keywords:typing-progress', {
                projectId,
                progress,
              });
            }
          }
        } catch (e) {
          // Not JSON, check for progress message
          if (line.includes('progress:')) {
            const match = line.match(/progress: (\d+)/);
            if (match && win) {
              win.webContents.send('keywords:typing-progress', {
                projectId,
                progress: parseInt(match[1]),
              });
            }
          }
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      console.error(`[Typing Worker ${projectId} ERROR]`, text);
      if (/429/.test(text) || /rate limit/i.test(text)) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:typing-error', {
            projectId,
            status: 429,
            message: 'Request failed with status code 429',
          });
        }
      }
    });

    child.on('exit', async (code) => {
      console.log(`Typing worker exited with code ${code}`);
      
      // Cleanup
      try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to cleanup temp dir:', e);
      }

      if (win) {
        if (code === 0) {
          win.webContents.send('keywords:typing-finished', { projectId });
        } else {
          win.webContents.send('keywords:typing-error', {
            projectId,
            message: `Worker exited with code ${code}`,
          });
        }
      }
    });
  } catch (error: any) {
    console.error('Failed to start typing worker:', error);
    if (win) {
      win.webContents.send('keywords:typing-error', {
        projectId,
        message: error.message || 'Failed to start worker',
      });
    }
  }
}

async function startClusteringWorker(projectId: number, algorithm: string, eps: number, minPts?: number) {
  const workerPath = path.join(__dirname, '..', 'worker', 'clusterСomponents.cjs');
  
  console.log(`Starting clustering worker for project ${projectId}`, { algorithm, eps, minPts });
  
  try {
    // Load keywords from DB
  // Process only target keywords
  const keywords = db!.prepare('SELECT * FROM keywords WHERE project_id = ? AND target_query = 1').all(projectId) as any[];

    if (!keywords || keywords.length === 0) {
      console.warn(`No target keywords (target_query=1) found for project ${projectId}`);
      if (win) {
        win.webContents.send('keywords:clustering-error', {
          projectId,
          message: 'No target keywords (target_query=1) found for project',
        });
      }
      return;
    }

    // Attach embeddings to keywords using the embeddings helper
    console.log(`[clustering] Attaching embeddings to ${keywords.length} keywords...`);
    const HandlerKeywords = require(path.join(__dirname, '..', 'socket', 'HandlerKeywords.cjs'));
    const attachEmbeddingsToKeywords = HandlerKeywords.attachEmbeddingsToKeywords;
    try {
      const embeddingStats = await attachEmbeddingsToKeywords(keywords, { chunkSize: 10 });
      console.log('[clustering] Embedding stats:', embeddingStats);
      if (!embeddingStats.embedded) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('keywords:clustering-error', {
            projectId,
            message: 'Не удалось подготовить эмбеддинги для кластеризации.',
          });
        }
        return;
      }
    } catch (embErr: any) {
      console.error('[clustering] Failed to prepare embeddings:', embErr?.message || embErr);
      if (win && !win.isDestroyed()) {
        const rateLimited = isRateLimitError(embErr);
        win.webContents.send('keywords:clustering-error', {
          projectId,
          status: rateLimited ? 429 : undefined,
          message: rateLimited ? 'Request failed with status code 429' : 'Не удалось получить эмбеддинги для кластеризации. Проверьте OpenAI ключ.',
        });
      }
      return;
    }

    // Create temporary directory and input file
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clustering-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
  const input = JSON.stringify({ keywords, algorithm, eps, minPts });
    
    await fs.promises.writeFile(inputPath, input, 'utf8');
    console.log(`Created clustering input file: ${inputPath}`);

    const args = [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`, `--algorithm=${algorithm}`, `--eps=${eps}`];
    if (minPts !== undefined) {
      args.push(`--minPts=${minPts}`);
    }
    
    const child = spawn(process.execPath, args, {
      env: Object.assign({}, process.env, { 
        ELECTRON_RUN_AS_NODE: '1',
        QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let processed = 0;
    child.stdout?.setEncoding('utf8');
    let stdoutBuffer = '';
    
    child.stdout?.on('data', (data) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        
        console.log(`[Clustering Worker ${projectId}]`, line);
        
        try {
          const obj = JSON.parse(line);
          processed++;
          
          // Update keyword cluster in DB (and sync human-readable label)
          if (obj.id && obj.cluster !== undefined) {
            db!
              .prepare('UPDATE keywords SET cluster = ?, cluster_label = ? WHERE id = ?')
              .run(obj.cluster, String(obj.cluster), obj.id);
            try {
              const updated = db!.prepare('SELECT * FROM keywords WHERE id = ?').get(obj.id);
              if (updated && win && !win.isDestroyed()) {
                win.webContents.send('keywords:updated', { projectId, keyword: updated });
              }
            } catch (e) {
              console.warn('[Main] Failed to notify renderer about keywords:updated for clustering', e && (e as any).message ? (e as any).message : e);
            }
          }

          // Send progress
          const progress = Math.round((processed / keywords.length) * 100);
          if (win) {
            win.webContents.send('keywords:clustering-progress', {
              projectId,
              progress,
            });
          }
        } catch (e) {
          // Not JSON
          if (line.includes('progress:')) {
            const match = line.match(/progress: (\d+)/);
            if (match && win) {
              win.webContents.send('keywords:clustering-progress', {
                projectId,
                progress: parseInt(match[1]),
              });
            }
          }
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data) => {
      console.error(`[Clustering Worker ${projectId} ERROR]`, data.toString().trim());
    });

    child.on('exit', async (code) => {
      console.log(`Clustering worker exited with code ${code}`);
      
      // Cleanup
      try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to cleanup temp dir:', e);
      }

      if (win) {
        if (code === 0) {
          win.webContents.send('keywords:clustering-finished', { projectId });
        } else {
          win.webContents.send('keywords:clustering-error', {
            projectId,
            message: `Worker exited with code ${code}`,
          });
        }
      }
    });
  } catch (error: any) {
    console.error('Failed to start clustering worker:', error);
    if (win) {
      win.webContents.send('keywords:clustering-error', {
        projectId,
        message: error.message || 'Failed to start worker',
      });
    }
  }
}

function createWindow() {
  // Prevent creating multiple windows
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }

  // create main window
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "quant.png"),
    width: 1400,
    height: 700,
    show: false, // Start hidden, will show after loading
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Handle file downloads and reveal in Finder/Explorer after completion
  const ses = win.webContents.session;
  ses.on("will-download", (_event, downloadItem, _webContents) => {
    console.log("Starting download:", downloadItem.getFilename());
    console.log("Total bytes:", downloadItem.getTotalBytes());

    downloadItem.on("done", (_event, state) => {
      const itemPath = downloadItem.getSavePath();
      if (state === "completed") {
        console.log("Download successfully completed:", itemPath);
        // Automatically reveal the downloaded file in Finder/Explorer
        shell.showItemInFolder(itemPath);
      } else {
        console.log(`Download failed: ${state}`);
      }
    });
  });

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
  win?.webContents.send("main-process-message", (new Date()).toLocaleString());
  if (!win?.isVisible()) win?.show();
  // Flush buffered main-process logs to renderer console
  try {
    if (logBuffer.length) {
      for (const entry of logBuffer.splice(0, logBuffer.length)) {
        sendLogToRenderer(entry.level, entry.args);
      }
    }
  } catch (_e) {}
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  // Fallback: if renderer doesn't fire did-finish-load, show main window after timeout
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  }, 15000);
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  // Close database connection
  if (db) {
    console.log('[Main] Closing database...');
    db.close();
    db = null;
  }
  // Stop crawler worker process
  try {
    if (crawlerChild && !crawlerChild.killed) {
      console.log('[Main] Killing crawler worker process');
      crawlerChild.kill('SIGTERM');
    }
  } catch (e: any) {
    console.warn('[Main] Failed to kill crawler worker process:', e?.message || e);
  } finally {
    crawlerChild = null;
  }
});

app.whenReady().then(() => {
  console.log('[Main] App ready, initializing database...');
  try {
    initializeDatabase();
    console.log('[Main] Database initialized successfully');
  } catch (error: any) {
    console.error('[Main] Fatal: Failed to initialize database:', error);
    console.error('[Main] Stack:', error.stack);
    dialog.showErrorBox('Database Error', `Failed to initialize database: ${error.message}`);
    app.quit();
    return;
  }

  console.log('[Main] Registering IPC handlers...');
  try {
    registerIpcHandlers();
    console.log('[Main] IPC handlers registered');
  } catch (error: any) {
    console.error('[Main] Fatal: Failed to register IPC handlers:', error);
    console.error('[Main] Stack:', error.stack);
    app.quit();
    return;
  }
  
  console.log('[Main] Creating window...');
  try {
    createWindow();
    console.log('[Main] Window created');
  } catch (error: any) {
    console.error('[Main] Fatal: Failed to create window:', error);
    console.error('[Main] Stack:', error.stack);
    app.quit();
    return;
  }

  // Проверка обновлений и уведомление пользователя
  console.log('[Main] Checking for updates...');
  autoUpdater.checkForUpdatesAndNotify();
}).catch((error) => {
  console.error('[Main] Fatal error in app.whenReady:', error);
  console.error('[Main] Stack:', error.stack);
  app.quit();
});

// ================= Crawler worker (IPC-based) =================
function startCrawlerWorker(project: { id: number; url: string; crawler?: any; parser?: any }) {
  if (!project || !project.id || !project.url) {
    console.warn('[CrawlerWorker] Invalid project payload', project);
    return;
  }
  if (crawlerChild && !crawlerChild.killed) {
    console.warn('[CrawlerWorker] Already running');
    return;
  }
  if (!resolvedDbPath) {
    console.error('[CrawlerWorker] DB path not resolved');
    return;
  }
  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawler-'));
    const cfgPath = path.join(tmpDir, 'config.json');
    const payload = {
      projectId: project.id,
      startUrl: project.url,
      crawlerConfig: project.crawler || {},
      parserConfig: Array.isArray(project.parser) ? project.parser : [],
      dbPath: resolvedDbPath,
    };
    fs.writeFileSync(cfgPath, JSON.stringify(payload), 'utf8');
    const workerPath = path.join(__dirname, '..', 'worker', 'crawlerWorker.cjs');
    console.log('[CrawlerWorker] Spawning worker', { workerPath, projectId: project.id, url: project.url });
    crawlerChild = spawn(process.execPath, [workerPath, `--config=${cfgPath}`], {
      env: Object.assign({}, process.env, { 
        ELECTRON_RUN_AS_NODE: '1',
        QUANTBOT_DB_DIR: resolvedDbPath ? path.dirname(resolvedDbPath) : undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    crawlerChild.stdout?.setEncoding('utf8');
    let buf = '';
    crawlerChild.stdout?.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line.trim());
          if (win && !win.isDestroyed()) {
            switch (msg.type) {
              case 'progress':
                win.webContents.send('crawler:progress', { projectId: project.id, ...msg });
                break;
              case 'queue':
                win.webContents.send('crawler:queue', { projectId: project.id, ...msg });
                break;
              case 'finished':
                win.webContents.send('crawler:finished', { projectId: project.id, ...msg });
                break;
              case 'error':
                win.webContents.send('crawler:error', { projectId: project.id, ...msg });
                break;
              case 'url':
                win.webContents.send('crawler:url', { projectId: project.id, ...msg });
                break;
              case 'row':
                win.webContents.send('crawler:row', { projectId: project.id, ...msg });
                break;
              case 'stat':
                win.webContents.send('crawler:stat', { projectId: project.id, ...msg });
                break;
              default:
                // unknown message type
                break;
            }
          }
        } catch (_e) {
          console.log('[CrawlerWorker]', line.trim());
        }
      }
    });
    crawlerChild.stderr?.setEncoding('utf8');
    crawlerChild.stderr?.on('data', (data) => {
      const text = String(data).trim();
      console.error('[CrawlerWorker ERR]', text);
      if (win && !win.isDestroyed()) {
        win.webContents.send('crawler:error', { projectId: project.id, message: text });
      }
    });
    crawlerChild.on('exit', (code, signal) => {
      console.log('[CrawlerWorker] exit', { code, signal });
      if (win && !win.isDestroyed()) {
        win.webContents.send('crawler:finished', { projectId: project.id, code, signal });
      }
      crawlerChild = null;
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    });
  } catch (e: any) {
    console.error('[CrawlerWorker] Failed to start:', e?.message || e);
    if (win && !win.isDestroyed()) {
      win.webContents.send('crawler:error', { projectId: project.id, message: e?.message || String(e) });
    }
  }
}

function stopCrawlerWorker() {
  if (crawlerChild && !crawlerChild.killed) {
    console.log('[CrawlerWorker] Stopping worker');
    crawlerChild.kill('SIGTERM');
  }
}

ipcMain.handle('crawler:start', async (_e, project) => {
  startCrawlerWorker(project);
  return { success: true };
});
ipcMain.handle('crawler:stop', async (_e) => {
  stopCrawlerWorker();
  return { success: true };
});

