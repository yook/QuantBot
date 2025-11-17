import { app, BrowserWindow, shell, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
 
// newProjectDefaults moved to IPC modules; no longer needed here
import { createDatabase } from "./db/init.ts";
import { registerAllIpc } from "./ipc/index.ts";
import { stopCrawlerWorker } from "./workers/crawler.ts";

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
// Persist resolved database path for worker access
let resolvedDbPath: string | null = null;
// Column name for category text (some older DBs use 'category_name')
let categoriesNameColumn = 'name';
// Typing samples schema compatibility (old: label,text | new: url,sample)
let typingLabelColumn = 'label';
let typingTextColumn = 'text';
let typingDateColumn: string | null = 'date';

// Provide current BrowserWindow to IPC/worker modules
const getWindow = () => win;

// ===== Database Initialization =====
function initializeDatabase() {
  try {
    const isDev = !!VITE_DEV_SERVER_URL;
    const res = createDatabase({ isDev });
    db = res.db;
    resolvedDbPath = res.dbPath;
    categoriesNameColumn = res.categoriesNameColumn || categoriesNameColumn;
    typingLabelColumn = res.typingLabelColumn || typingLabelColumn;
    typingTextColumn = res.typingTextColumn || typingTextColumn;
    typingDateColumn = res.typingDateColumn || typingDateColumn;
    console.log('[Main] Database initialized via electron/db/init.ts:', resolvedDbPath);
  } catch (err: any) {
    console.error('[Main] Failed to initialize database via createDatabase():', err && err.message ? err.message : err);
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
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send('main-process-log', {
        level,
        message: args.map((a) => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
        }),
      });
    } catch (_) {}
  } else {
    logBuffer.push({ level, args });
    if (logBuffer.length > 1000) logBuffer.shift();
  }
}

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
  // Politely stop crawler worker if running (module handles internal state)
  try { stopCrawlerWorker(); } catch {}
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
    if (!db) throw new Error('DB not initialized');
    registerAllIpc({
      db,
      getWindow,
      resolvedDbPath,
      categoriesNameColumn,
      typingLabelColumn,
      typingTextColumn,
      typingDateColumn,
    });
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

  // Проверка обновлений и уведомление пользователя (только для production releases)
  if (process.env.NODE_ENV === 'production' && !process.env.VITE_DEV_SERVER_URL) {
    console.log('[Main] Checking for updates...');
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('[Main] Auto-update check failed:', err.message);
    });
  } else {
    console.log('[Main] Skipping auto-update check in development mode');
  }
}).catch((error) => {
  console.error('[Main] Fatal error in app.whenReady:', error);
  console.error('[Main] Stack:', error.stack);
  app.quit();
});

// Crawler handlers are registered via ipc/index.ts

