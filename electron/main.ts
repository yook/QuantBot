import { app, BrowserWindow, shell, dialog, ipcMain } from "electron";
import path from "path";
import fs from "fs";
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

// Provide current BrowserWindow to IPC/worker modules
const getWindow = () => win;
let updateDownloaded = false;
let updateAvailable = false;
let updateInfo: any = null;
let installOnDownload = false;
let devRelaunchMarkWritten = false;

const getDevRelaunchMarkerPath = () => {
  try {
    const userData = app.getPath("userData");
    return path.join(userData, "dev-update-relaunch.json");
  } catch {
    return null;
  }
};

const getDevRelaunchKey = () => {
  const feed = process.env.UPDATE_FEED_URL || "";
  return `${app.getVersion()}|${feed}`;
};

const hasDevRelaunchMarker = () => {
  try {
    const markerPath = getDevRelaunchMarkerPath();
    if (!markerPath || !fs.existsSync(markerPath)) return false;
    const raw = fs.readFileSync(markerPath, "utf-8");
    const data = JSON.parse(raw);
    return data && data.key === getDevRelaunchKey();
  } catch {
    return false;
  }
};

const writeDevRelaunchMarker = () => {
  try {
    const markerPath = getDevRelaunchMarkerPath();
    if (!markerPath) return;
    const payload = { key: getDevRelaunchKey(), at: new Date().toISOString() };
    fs.writeFileSync(markerPath, JSON.stringify(payload));
    devRelaunchMarkWritten = true;
  } catch {
    // ignore
  }
};

// ===== Database Initialization =====
function initializeDatabase() {
  try {
    const isDev = !!VITE_DEV_SERVER_URL;
    const res = createDatabase({ isDev });
    db = res.db;
    resolvedDbPath = res.dbPath;
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
let rendererLogReady = false;
let isForwardingMainLog = false;

function sendLogToRenderer(level: LogLevel, args: any[]) {
  const canSend = (() => {
    if (!win || win.isDestroyed()) return false;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed() || wc.isCrashed()) return false;
    if (!rendererLogReady) return false;
    try {
      const frame = wc.mainFrame;
      if (!frame) return false;
      if (typeof (frame as any).isDestroyed === 'function' && (frame as any).isDestroyed()) {
        return false;
      }
    } catch (_e) {
      return false;
    }
    return true;
  })();

  if (!canSend) {
    logBuffer.push({ level, args });
    if (logBuffer.length > 1000) logBuffer.shift();
    return;
  }

  if (isForwardingMainLog) {
    return;
  }

  try {
    isForwardingMainLog = true;
    win!.webContents.send('main-process-log', {
      level,
      message: args.map((a) => {
        try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
      }),
    });
  } catch (_e) {
    // Swallow transport errors here to avoid console.error recursion.
  } finally {
    isForwardingMainLog = false;
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
    icon: path.join(process.env.VITE_PUBLIC, "pageviewer.png"),
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
  rendererLogReady = true;
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

  win.webContents.on("render-process-gone", () => {
    rendererLogReady = false;
  });
  win.on("closed", () => {
    rendererLogReady = false;
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
  const forceUpdater =
    process.env.VITE_FORCE_UPDATER === '1' || process.env.FORCE_UPDATER === '1';
  const updateFeedUrl = process.env.UPDATE_FEED_URL;
  if (updateFeedUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: updateFeedUrl });
      console.log('[Main] autoUpdater feed URL set to:', updateFeedUrl);
    } catch (e) {
      console.error('[Main] Failed to set autoUpdater feed URL:', errMsg(e));
    }
  }
  if ((app.isPackaged && !process.env.VITE_DEV_SERVER_URL) || forceUpdater) {
    console.log('[Main] Checking for updates...');
    if (forceUpdater) {
      try { (autoUpdater as any).forceDevUpdateConfig = true; } catch (_) {}
    }
    try { autoUpdater.autoDownload = false; } catch (_) {}

    // Подробное логирование событий автообновления для отладки
    try {
        autoUpdater.on('checking-for-update', () => {
          console.log('[AutoUpdater] checking-for-update');
          try { win?.webContents.send('auto-updater', { event: 'checking-for-update' }); } catch (e) {}
        });

        autoUpdater.on('update-available', (info) => {
          console.log('[AutoUpdater] update-available', info);
          updateAvailable = true;
          updateInfo = info;
          try { win?.webContents.send('auto-updater', { event: 'update-available', info }); } catch (e) {}
        });

        autoUpdater.on('update-not-available', (info) => {
          console.log('[AutoUpdater] update-not-available', info);
          updateAvailable = false;
          updateInfo = null;
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
          updateDownloaded = true;
          updateInfo = info;
          try { win?.webContents.send('auto-updater', { event: 'update-downloaded', info }); } catch (e) {}
          if (installOnDownload) {
            console.log('[AutoUpdater] installOnDownload=true, calling quitAndInstall');
            installOnDownload = false;
            try {
              autoUpdater.quitAndInstall(false, true);
            } catch (e) {
              console.error('[AutoUpdater] quitAndInstall failed:', errMsg(e));
            }
          }
          if (!app.isPackaged) {
            const devRelaunchEnabled = process.env.DEV_RELAUNCH === '1';
            if (devRelaunchEnabled) {
              console.log('[AutoUpdater] Dev mode: DEV_RELAUNCH=1 set, skipping auto relaunch (button-driven)');
              return;
            }
            if (VITE_DEV_SERVER_URL) {
              console.log('[AutoUpdater] Dev mode: VITE_DEV_SERVER_URL detected, skipping auto relaunch to avoid blank window');
              return;
            }
            if (hasDevRelaunchMarker()) {
              console.log('[AutoUpdater] Dev mode: relaunch already done for this version/feed, skipping');
              return;
            }
            if (!devRelaunchMarkWritten) {
              writeDevRelaunchMarker();
            }
            console.log('[AutoUpdater] Dev mode: relaunching app without applying update');
            try {
              app.relaunch();
              app.exit(0);
            } catch (e) {
              console.error('[AutoUpdater] Dev relaunch failed:', errMsg(e));
            }
          }
        });
    } catch (e) {
        console.error('[Main] Failed to attach autoUpdater listeners:', errMsg(e));
    }

    autoUpdater.checkForUpdates().catch(err => {
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
      const target = url || 'https://github.com/yook/PageViewer/releases/latest';
      console.log('[Main] Opening release URL:', target);
      shell.openExternal(target);
    } catch (err) {
      console.error('[Main] Failed to open external URL for release:', (err as any)?.message || err);
    }
  });

  // Quit and install (called after update downloaded and user confirmed)
  ipcMain.on('auto-updater-quit-and-install', () => {
    try {
      console.log('[Main] Received request to quit and install update', {
        isPackaged: app.isPackaged,
        updateDownloaded,
      });
      if (!app.isPackaged) {
        const devRelaunchEnabled = process.env.DEV_RELAUNCH === '1';
        if (VITE_DEV_SERVER_URL && !devRelaunchEnabled) {
          console.log('[Main] Dev mode: VITE_DEV_SERVER_URL detected, skipping relaunch to avoid blank window');
          try { win?.webContents.send('auto-updater', { event: 'dev-relaunch-skipped' }); } catch (_) {}
          return;
        }
        console.log('[Main] Dev mode: quit-and-install requested, relaunching without applying update');
        setTimeout(() => {
          try {
            const relaunchEnv = { ...process.env };
            if (VITE_DEV_SERVER_URL) {
              relaunchEnv.VITE_DEV_SERVER_URL = VITE_DEV_SERVER_URL;
            }
            (app as any).relaunch({
              args: process.argv.slice(1),
              env: relaunchEnv,
            });
            app.exit(0);
          } catch (e) {
            console.error('[Main] Dev relaunch failed:', errMsg(e));
          }
        }, 1200);
        return;
      }
      if (updateDownloaded) {
        // This will quit the app and install the update
        autoUpdater.quitAndInstall(false, true);
      } else {
        console.warn('[Main] quitAndInstall requested but update is not downloaded; downloading now');
        installOnDownload = true;
        try { autoUpdater.downloadUpdate(); } catch (e) {
          console.error('[Main] downloadUpdate failed:', errMsg(e));
        }
      }
    } catch (err) {
      console.error('[Main] quitAndInstall failed:', (err as any)?.message || err);
      try {
        app.relaunch();
        app.exit(0);
      } catch (_) {}
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

  // Trigger update check explicitly
  ipcMain.on('auto-updater-check', async () => {
    try {
      console.log('[Main] Received request to check for updates');
      await autoUpdater.checkForUpdates();
    } catch (err) {
      console.error('[Main] checkForUpdates failed:', (err as any)?.message || err);
      try { win?.webContents.send('auto-updater', { event: 'error', error: (err as any)?.message || String(err) }); } catch (_) {}
    }
  });

  // Query current updater state (e.g., after UI mount)
  ipcMain.handle('auto-updater-status', async () => {
    return { available: updateAvailable, downloaded: updateDownloaded, info: updateInfo };
  });
} catch (err) {
  console.error('[Main] Failed to register auto-updater IPC handlers:', (err as any)?.message || err);
}

// Crawler handlers are registered via ipc/index.ts

