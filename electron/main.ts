import { app, BrowserWindow, shell, dialog, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

// newProjectDefaults moved to IPC modules; no longer needed here
import { createDatabase } from "./db/init.ts";
import { registerAllIpc } from "./ipc/index.ts";
import { stopCrawlerWorker } from "./managers/crawler.ts";

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
    typingLabelColumn = res.typingLabelColumn ?? typingLabelColumn;
    typingTextColumn = res.typingTextColumn ?? typingTextColumn;
    // typingDateColumn can be `null` to indicate the DB has no date column — accept null explicitly
    typingDateColumn = res.typingDateColumn;
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

// Форматирование ошибочного значения в безопасную строку для логов
function errMsg(e: unknown): string {
  if (e == null) return String(e);
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
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

    // Подробное логирование событий автообновления для отладки
    try {
        autoUpdater.on('checking-for-update', () => {
          console.log('[AutoUpdater] checking-for-update');
          try { win?.webContents.send('auto-updater', { event: 'checking-for-update' }); } catch (e) {}
        });

        autoUpdater.on('update-available', (info) => {
          console.log('[AutoUpdater] update-available', info);
          try { win?.webContents.send('auto-updater', { event: 'update-available', info }); } catch (e) {}
        });

        autoUpdater.on('update-not-available', (info) => {
          console.log('[AutoUpdater] update-not-available', info);
          try { win?.webContents.send('auto-updater', { event: 'update-not-available', info }); } catch (e) {}
        });

        autoUpdater.on('error', (err) => {
          console.error('[AutoUpdater] error', errMsg(err));
          try { win?.webContents.send('auto-updater', { event: 'error', error: errMsg(err) }); } catch (e) {}
        });

        autoUpdater.on('download-progress', (progress) => {
          // progress has properties: bytesPerSecond, percent, total, transferred
          console.log('[AutoUpdater] download-progress', progress);
          try { win?.webContents.send('auto-updater', { event: 'download-progress', progress }); } catch (e) {}
        });

        autoUpdater.on('update-downloaded', (info) => {
          console.log('[AutoUpdater] update-downloaded', info);
          try { win?.webContents.send('auto-updater', { event: 'update-downloaded', info }); } catch (e) {}
        });
    } catch (e) {
        console.error('[Main] Failed to attach autoUpdater listeners:', errMsg(e));
    }

    autoUpdater.checkForUpdatesAndNotify().catch(err => {
        console.error('[Main] Auto-update check failed:', errMsg(err));
    });
  } else {
    console.log('[Main] Skipping auto-update check in development mode');
  }
}).catch((error) => {
  console.error('[Main] Fatal error in app.whenReady:', error);
  console.error('[Main] Stack:', error.stack);
  app.quit();
});

// IPC handlers to respond to renderer requests related to auto-updater
try {
  // Open release page in external browser
  ipcMain.on('auto-updater-open-release', (_event: Electron.IpcMainEvent, url?: string) => {
    try {
      const target = url || 'https://github.com/yook/QuantBot/releases/latest';
      console.log('[Main] Opening release URL:', target);
      shell.openExternal(target);
    } catch (err) {
      console.error('[Main] Failed to open external URL for release:', (err as any)?.message || err);
    }
  });

  // Quit and install (called after update downloaded and user confirmed)
  ipcMain.on('auto-updater-quit-and-install', () => {
    try {
      console.log('[Main] Received request to quit and install update');
      // This will quit the app and install the update
      autoUpdater.quitAndInstall();
    } catch (err) {
      console.error('[Main] quitAndInstall failed:', (err as any)?.message || err);
    }
  });

  // Start download of update when renderer requests it
  ipcMain.on('auto-updater-download', async () => {
    try {
      console.log('[Main] Received request to download update');
      // downloadUpdate returns a Promise
      await autoUpdater.downloadUpdate();
      console.log('[Main] downloadUpdate() resolved');
    } catch (err) {
      console.error('[Main] downloadUpdate failed:', (err as any)?.message || err);
      try { win?.webContents.send('auto-updater', { event: 'error', error: (err as any)?.message || String(err) }); } catch (_) {}
    }
  });
} catch (err) {
  console.error('[Main] Failed to register auto-updater IPC handlers:', (err as any)?.message || err);
}

// Crawler handlers are registered via ipc/index.ts

