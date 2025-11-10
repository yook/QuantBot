import { app, BrowserWindow, shell, ipcMain, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import Database from "better-sqlite3";

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

// ===== Database Initialization =====
function initializeDatabase() {
  try {
    // Determine DB path
    let dbPath = process.env.DB_PATH;
    if (!dbPath) {
      const userDataPath = path.join(os.homedir(), ".quantbot");
      dbPath = path.join(userDataPath, "quantbot.db");
    }

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    console.log("[Main] Initializing database at:", dbPath);

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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ).run();
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_projects_url ON projects(url);"
    ).run();

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
        color TEXT,
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

    // Categories table
    db.prepare(
      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
    ).run();
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id);"
    ).run();
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_project_name ON categories(project_id, name);"
    ).run();

    // Typing samples table
    db.prepare(
      `CREATE TABLE IF NOT EXISTS typing_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        sample TEXT NOT NULL,
        date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
    ).run();
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_typing_samples_project ON typing_samples(project_id);"
    ).run();

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
      const result = db!.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:insert', async (_event, name, url) => {
    try {
      console.log('[IPC] db:projects:insert payload:', { name, url });
      const result = db!.prepare('INSERT INTO projects (name, url) VALUES (?, ?)').run(name, url);
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
      
      if (searchQuery && searchQuery.trim()) {
        sql += ' AND keyword LIKE ?';
        params.push(`%${searchQuery}%`);
      }
      
      // Sort
      if (sort && sort.column) {
        const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
        sql += ` ORDER BY ${sort.column} ${direction}`;
      } else {
        sql += ' ORDER BY id';
      }
      
      // Pagination
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, skip);
      
      const rows = db!.prepare(sql).all(...params);

      // Get total count for this query
      let countSql = 'SELECT COUNT(*) as total FROM keywords WHERE project_id = ?';
      const countParams: any[] = [projectId];
      if (searchQuery && searchQuery.trim()) {
        countSql += ' AND keyword LIKE ?';
        countParams.push(`%${searchQuery}%`);
      }
      const countResult = db!.prepare(countSql).get(...countParams);

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

  ipcMain.handle('db:keywords:insert', async (_event, keyword, projectId, categoryId, color, disabled) => {
    try {
      const result = db!.prepare(
        'INSERT INTO keywords (keyword, project_id, category_id, color, disabled) VALUES (?, ?, ?, ?, ?)'
      ).run(keyword, projectId, categoryId, color, disabled);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:update', async (_event, keyword, categoryId, color, disabled, id) => {
    try {
      const result = db!.prepare(
        'UPDATE keywords SET keyword = ?, category_id = ?, color = ?, disabled = ? WHERE id = ?'
      ).run(keyword, categoryId, color, disabled, id);
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
      const result = db!.prepare(
        'UPDATE keywords SET cluster = ? WHERE id = ?'
      ).run(cluster, id);
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
      const result = db!.prepare('SELECT * FROM categories WHERE project_id = ?').all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:insert', async (_event, name, projectId, color) => {
    try {
      const result = db!.prepare(
        'INSERT INTO categories (name, project_id, color) VALUES (?, ?, ?)'
      ).run(name, projectId, color);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:update', async (_event, name, color, id) => {
    try {
      const result = db!.prepare(
        'UPDATE categories SET name = ?, color = ? WHERE id = ?'
      ).run(name, color, id);
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

  // Typing
  ipcMain.handle('db:typing:getAll', async (_event, projectId) => {
    try {
      const result = db!.prepare('SELECT * FROM typing_samples WHERE project_id = ?').all(projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:insert', async (_event, projectId, url, sample, date) => {
    try {
      const result = db!.prepare(
        'INSERT INTO typing_samples (project_id, url, sample, date) VALUES (?, ?, ?, ?)'
      ).run(projectId, url, sample, date);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:update', async (_event, url, sample, date, id) => {
    try {
      const result = db!.prepare(
        'UPDATE typing_samples SET url = ?, sample = ?, date = ? WHERE id = ?'
      ).run(url, sample, date, id);
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
      const result = db!.prepare(
        'INSERT OR IGNORE INTO stop_words (project_id, word) VALUES (?, ?)'
      ).run(projectId, word);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:delete', async (_event, id) => {
    try {
      const result = db!.prepare('DELETE FROM stop_words WHERE id = ?').run(id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:deleteByProject', async (_event, projectId) => {
    try {
      const result = db!.prepare('DELETE FROM stop_words WHERE project_id = ?').run(projectId);
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
      const project_id = options.id;
      const limit = options.limit || 50;
      const offset = options.skip || 0;

      let sortBy = 'id';
      let order = 'ASC';

      if (options.sort && typeof options.sort === 'object') {
        const sortKeys = Object.keys(options.sort);
        if (sortKeys.length > 0) {
          sortBy = sortKeys[0];
          order = options.sort[sortBy] === -1 ? 'DESC' : 'ASC';
        }
      }

      const sql = `SELECT * FROM urls WHERE project_id = ? ORDER BY ${sortBy} ${order} LIMIT ? OFFSET ?`;
      const result = db!.prepare(sql).all(project_id, limit, offset);
      return { success: true, data: result };
    } catch (error: any) {
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
    const categories = db!.prepare('SELECT * FROM categories WHERE project_id = ?').all(projectId);
    const keywords = db!.prepare('SELECT * FROM keywords WHERE project_id = ?').all(projectId);

    if (!keywords || keywords.length === 0) {
      console.warn(`No keywords found for project ${projectId}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'No keywords found for project',
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
      embeddingStats = await attachEmbeddingsToKeywords(keywords, { chunkSize: 40 });
      console.log('Embedding stats:', embeddingStats);
    } catch (embErr: any) {
      console.error('[categorization] Failed to prepare embeddings:', embErr?.message || embErr);
      if (win && !win.isDestroyed()) {
        win.webContents.send('keywords:categorization-error', {
          projectId,
          message: 'Не удалось получить эмбеддинги для категоризации. Проверьте OpenAI ключ.',
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

    const child = spawn('node', [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`], {
      env: Object.assign({}, process.env),
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
    const typingSamples = db!.prepare('SELECT * FROM typing_samples WHERE project_id = ?').all(projectId);
    const keywords = db!.prepare('SELECT * FROM keywords WHERE project_id = ?').all(projectId);

    // Create temporary directory and input file
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'typing-'));
    const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
    const input = JSON.stringify({ typingSamples: typingSamples || [], keywords: keywords || [] });
    
    await fs.promises.writeFile(inputPath, input, 'utf8');
    console.log(`Created typing input file: ${inputPath}`);

    const child = spawn('node', [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`], {
      env: Object.assign({}, process.env),
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
          
          // Update keyword in DB
          if (obj.id && obj.className !== undefined) {
            db!.prepare('UPDATE keywords SET class_name = ?, class_similarity = ? WHERE id = ?')
              .run(obj.className, obj.similarity || null, obj.id);
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
      console.error(`[Typing Worker ${projectId} ERROR]`, data.toString().trim());
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
    const keywords = db!.prepare('SELECT * FROM keywords WHERE project_id = ?').all(projectId) as any[];

    if (!keywords || keywords.length === 0) {
      console.warn(`No keywords found for project ${projectId}`);
      if (win) {
        win.webContents.send('keywords:clustering-error', {
          projectId,
          message: 'No keywords found for project',
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
    
    const child = spawn('node', args, {
      env: Object.assign({}, process.env),
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
          
          // Update keyword cluster in DB
          if (obj.id && obj.cluster !== undefined) {
            db!.prepare('UPDATE keywords SET cluster = ? WHERE id = ?')
              .run(obj.cluster, obj.id);
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

