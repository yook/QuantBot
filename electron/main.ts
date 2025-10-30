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
function startSocketServer() {
  const isPackaged = app.isPackaged;
  const requireFrom = createRequire(import.meta.url);
  const path = requireFrom("path");

  let socketPath: string | null = null;

  if (isPackaged) {
    // Path for packaged app
    socketPath = path.join(process.resourcesPath, "app.asar.unpacked", "socket", "server.cjs");
    console.log("Packaged app detected, socket path:", socketPath);
  } else {
    // Path for development
    socketPath = path.join(__dirname, "../socket/server.cjs");
    console.log("Development mode, socket path:", socketPath);
  }

  if (socketPath) {
    console.log("Starting socket server process...");
    // In development we should run the socket server with the system `node`
    // to avoid launching a full Electron binary which can attempt to load
    // renderer/native modules (and cause architecture mismatches).
    const nodePath = isPackaged ? process.execPath : "node";
    console.log("Spawning socket server using:", nodePath);
    socketServerProcess = spawn(nodePath, [socketPath], {
      stdio: "inherit",
      // In dev use shell so `node` is resolved via PATH; when packaged we
      // call the exact executable so shell=false is safer.
      shell: !isPackaged,
    });

    socketServerProcess.on("error", (err) => {
      console.error("Failed to start socket server:", err);
    });

    socketServerProcess.on("exit", (code) => {
      console.log(`Socket server exited with code ${code}`);
    });

    socketServerProcess.on("spawn", () => {
      console.log("Socket server process spawned successfully");
    });
  } else {
    console.error("Could not determine socket server path");
  }
}

// Stop socket server
function stopSocketServer() {
  if (socketServerProcess) {
    console.log("Stopping socket server...");
    socketServerProcess.kill("SIGTERM");
    socketServerProcess = null;
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
  stopSocketServer(); // Stop socket server when app closes
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
  startSocketServer(); // Start socket server first
  createWindow(); // Then create window

  // Проверка обновлений и уведомление пользователя
  autoUpdater.checkForUpdatesAndNotify();
});

