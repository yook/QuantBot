import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "module";

// Автообновление
import { autoUpdater } from "electron-updater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
let socketServerProcess: ChildProcess | null = null;

// Prevent running multiple full Electron instances (avoid multiple windows)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // If we couldn't get the lock, another instance is already running — quit this one.
  app.quit();
}

// Start socket server
function startSocketServer(): boolean {
  // Prefer spawning a separate process to avoid loading native bindings into
  // the Electron main process (architecture mismatches). Always spawn.
  try {
    startSocketServerProcess();
    return true;
  } catch (e: any) {
    console.warn('Failed to spawn socket server process:', e?.message || String(e));
    return false;
  }
}

// Spawn-based server start (safer for native modules). Use this when direct
// require fails due to native binding/arch mismatches.
function startSocketServerProcess() {
  if (socketServerProcess) {
    console.log('Socket server process already started');
    return;
  }

  // Prefer system `node` from PATH so native modules are loaded with the
  // matching system Node.js runtime rather than Electron's embedded node.
  const socketPath = path.resolve(__dirname, "../socket/server.cjs");
  console.log('Spawning socket server process with system node:', socketPath);

  const proc = spawn('node', [socketPath], { stdio: 'inherit', shell: false });
  socketServerProcess = proc;

  proc.on('error', (err) => {
    console.error('Socket server process error:', err);
  });

  proc.on('exit', (code, sig) => {
    console.log('Socket server process exited', code, sig);
    socketServerProcess = null;
  });
}

// Stop socket server
function stopSocketServer() {
  try {
    // If we spawned the server process, terminate it
    if (socketServerProcess) {
      console.log('Stopping spawned socket server process...');
      socketServerProcess.kill('SIGTERM');
      socketServerProcess = null;
      return;
    }

    const socketPath = path.resolve(__dirname, "../socket/server.cjs");
    const requireFrom = createRequire(import.meta.url);
    const socketModule = requireFrom(socketPath);
    if (socketModule && typeof socketModule.stopSocketServer === 'function') {
      socketModule.stopSocketServer();
    }
  } catch (e: any) {
    console.warn("Failed to stop socket server:", e?.message || String(e));
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
  stopSocketServer(); // Ensure socket server is stopped before quit
});

app.whenReady().then(() => {
  const ok = startSocketServer();
  if (!ok) {
    // fallback to spawn-based server start (works better with native bindings)
    startSocketServerProcess();
  }

  createWindow(); // Then create window

  // Проверка обновлений и уведомление пользователя
  autoUpdater.checkForUpdatesAndNotify();
});

