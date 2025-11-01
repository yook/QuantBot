import { app, BrowserWindow, shell, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "module";
import fs from "fs";

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

// IPC-based in-memory socket adapter (replaces network socket.io for renderer)
const ipcIo = {
  sockets: {
    sockets: new Map(), // id -> socketAdapter
  },
};

const socketsByInstance = new Map(); // clientInstanceId -> socketAdapter

function createSocketAdapter(webContents: Electron.WebContents, clientInstanceId: string) {
  const id = `ipc-${Math.random().toString(36).slice(2, 8)}`;
  const listeners = new Map();

  const socket = {
    id,
    handshake: { query: { clientInstanceId }, headers: {} },
    on(event: string, handler: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    once(event: string, handler: (...args: any[]) => void) {
      const onceWrapper = (...args: any[]) => {
        this.off(event, onceWrapper);
        handler(...args);
      };
      this.on(event, onceWrapper);
    },
    off(event: string, handler?: (...args: any[]) => void) {
      if (!listeners.has(event)) return;
      if (!handler) return listeners.delete(event);
      const arr = listeners.get(event).filter((h: any) => h !== handler);
      listeners.set(event, arr);
    },
    emit(event: string, ...args: any[]) {
      try {
        // Forward to renderer process using same event name
        webContents.send(event, ...args);
      } catch (e) {
        console.error('Failed to send IPC event to renderer', e);
      }
    },
    // Socket.IO compatibility: to() returns this socket (broadcast to room)
    // In IPC context, we only have one client per socket, so just return self
    to(_room: string) {
      return this;
    },
    // Called when renderer sends an event to this socket
    __receive(event: string, ...args: any[]) {
      const arr = listeners.get(event) || [];
      for (const h of arr) {
        try {
          h(...args);
        } catch (e) {
          console.error('Socket handler error', e);
        }
      }
    },
    disconnect() {
      // cleanup
      ipcIo.sockets.sockets.delete(id);
      if (clientInstanceId && socketsByInstance.get(clientInstanceId) === socket) {
        socketsByInstance.delete(clientInstanceId);
      }
    },
  } as any;

  ipcIo.sockets.sockets.set(id, socket);
  socketsByInstance.set(clientInstanceId, socket);
  return socket;
}

// Register IPC handlers for renderer to connect and emit events
function registerIpcSocketHandlers() {
  // connect: create adapter and register server handlers
  ipcMain.handle('socket:connect', (event: Electron.IpcMainInvokeEvent, { clientInstanceId } = {}) => {
    const wc = event.sender;
    if (!clientInstanceId) {
      return { ok: false, error: 'missing clientInstanceId' };
    }
    // Already connected? reuse
    if (socketsByInstance.has(clientInstanceId)) {
      return { ok: true };
    }

    const socket = createSocketAdapter(wc, clientInstanceId);

    // Register existing socket handlers (reuse socket/Handler*.cjs)
    try {
      const requireFrom = createRequire(import.meta.url);
      const registerProject = requireFrom(path.join(__dirname, "../socket/HandlerProject.cjs"));
      const registerCrawler = requireFrom(path.join(__dirname, "../socket/HandlerCrawler.cjs"));
      const registerKeywords = requireFrom(path.join(__dirname, "../socket/HandlerKeywords.cjs"));
      const registerCategories = requireFrom(path.join(__dirname, "../socket/HandlerCategories.cjs"));
      const registerIntegrations = requireFrom(path.join(__dirname, "../socket/HandlerIntegrations.cjs"));
      const registerTyping = requireFrom(path.join(__dirname, "../socket/HandlerTyping.cjs"));

      registerProject(ipcIo, socket);
      registerCrawler(ipcIo, socket);
      registerKeywords(ipcIo, socket);
      registerCategories(ipcIo, socket);
      registerIntegrations(ipcIo, socket);
      registerTyping(ipcIo, socket);
    } catch (err) {
      console.warn('Failed to register socket handlers via IPC adapter:', String(err));
    }

    return { ok: true };
  });

  // emit: renderer sends event to main/socket
  ipcMain.handle('socket:emit', (_event: Electron.IpcMainInvokeEvent, { clientInstanceId, eventName, args } = {}) => {
    const socket = socketsByInstance.get(clientInstanceId);
    if (!socket) return { ok: false, error: 'not connected' };
    socket.__receive(eventName, ...(Array.isArray(args) ? args : [args]));
    return { ok: true };
  });

  ipcMain.handle('socket:disconnect', (_event: Electron.IpcMainInvokeEvent, { clientInstanceId } = {}) => {
    const socket = socketsByInstance.get(clientInstanceId);
    if (socket) {
      socket.disconnect();
    }
    return { ok: true };
  });
}

// IPC socket handlers will be registered when startSocketServer() is called.

// Prevent running multiple full Electron instances (avoid multiple windows)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // If we couldn't get the lock, another instance is already running — quit this one.
  app.quit();
}

// Start socket server
function startSocketServer(): boolean {
  // Switch to IPC-driven in-process socket adapter. Register IPC handlers so
  // renderers can `invoke('socket:connect')` and `invoke('socket:emit', ...)`.
  try {
    registerIpcSocketHandlers();
    return true;
  } catch (e) {
    console.warn('Failed to register IPC socket handlers:', String(e));
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

  // Choose executable depending on whether app is packaged:
  // - In dev we prefer system `node` (so native bindings match system Node and
  //   we avoid loading them into the Electron main process).
  // - In packaged app (portable) there may be no `node` on user's PATH, so
  //   spawn Electron's bundled binary (process.execPath) to run the server
  //   with the embedded node runtime. When packaged, native modules should
  //   be rebuilt for Electron and included in `app.asar.unpacked`.
  const socketPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "socket", "server.cjs")
    : path.resolve(__dirname, "../socket/server.cjs");

  const execCmd = app.isPackaged ? process.execPath : "node";
  console.log("Spawning socket server process:", execCmd, socketPath);

  // In packaged apps (portable) there's no attached console — capture child
  // stdout/stderr into a log file under userData so we can inspect failures.
  let proc: ChildProcess | null = null;
  try {
    if (app.isPackaged) {
      const userLogDir = app.getPath("userData") || process.cwd();
      try {
        fs.mkdirSync(userLogDir, { recursive: true });
      } catch (e) {
        /* ignore */
      }
      const logPath = path.join(userLogDir, "socket-server.log");
      const outFd = fs.openSync(logPath, "a");
      const errFd = fs.openSync(logPath, "a");

      if (!fs.existsSync(socketPath)) {
        const msg = `Socket server entry not found at ${socketPath}\n`;
        fs.writeSync(outFd, msg);
        console.error(msg);
      }

      proc = spawn(execCmd, [socketPath], {
        stdio: ["ignore", outFd, errFd],
        shell: false,
      });
      fs.writeSync(outFd, `Spawned socket server process pid=${proc.pid}\n`);
    } else {
      // Dev: inherit console for immediate feedback
      proc = spawn(execCmd, [socketPath], { stdio: "inherit", shell: false });
    }
    socketServerProcess = proc;

    if (proc !== null) {
      proc.on("error", (err) => {
        console.error("Socket server process error:", err);
        try {
          const userLogDir = app.getPath("userData") || process.cwd();
          const logPath = path.join(userLogDir, "socket-server.log");
          fs.appendFileSync(logPath, `Socket server process error: ${String(err)}\n`);
        } catch (e) {}
      });

      proc.on("exit", (code, sig) => {
        console.log("Socket server process exited", code, sig);
        try {
          const userLogDir = app.getPath("userData") || process.cwd();
          const logPath = path.join(userLogDir, "socket-server.log");
          fs.appendFileSync(logPath, `Socket server exited code=${code} sig=${sig}\n`);
        } catch (e) {}
        socketServerProcess = null;
      });
    }
  } catch (e: any) {
    console.error("Failed to spawn socket server process:", e?.message || String(e));
  }
  socketServerProcess = proc;
  // Attach final safety handlers only if the process was created.
  if (proc) {
    proc.on('error', (err) => {
      console.error('Socket server process error:', err);
    });

    proc.on('exit', (code, sig) => {
      console.log('Socket server process exited', code, sig);
      socketServerProcess = null;
    });
  }
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

