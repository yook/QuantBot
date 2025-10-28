import { app, BrowserWindow, shell } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath, pathToFileURL } from "url";
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

// splash HTML will be built at runtime inside createWindow() so we can point
// the <img> to the correct `quant.png` location (dev vs packaged path).

let win: BrowserWindow | null;
let socketServerProcess: ChildProcess | null = null;

// Start socket server
function startSocketServer() {
  // Strategy:
  // 1) In dev: require and run local `socket/server.cjs` from project root.
  // 2) In packaged app: prefer the unpacked artifact placed by electron-builder
  //    (resources/app.asar.unpacked/socket/server.cjs). Require it in-process
  //    via createRequire to avoid having to spawn an external `node` binary.
  // 3) Fallback: if unpacked not found, attempt ASAR extraction (legacy).

  const isPackaged = app.isPackaged;
  const requireFrom = createRequire(import.meta.url);
  const fs = requireFrom("fs");
  const os = requireFrom("os");
  let socketPath: string | null = null;
  let cwd: string | null = null;

  try {
    if (isPackaged) {
      // Prefer requiring the server from inside app.asar — this allows the server
      // to resolve its dependencies from the bundled node_modules inside the asar.
      const asarServerPath = path.join(
        process.resourcesPath,
        "app.asar",
        "socket",
        "server.cjs"
      );
      try {
        if (fs.existsSync(path.join(process.resourcesPath, "app.asar"))) {
          console.log("Attempting to require socket server from app.asar:", asarServerPath);
          // Create a require function scoped to the server file so that
          // the server's internal requires resolve relative to its location
          const requireForAsarServer = createRequire(asarServerPath);
          const serverModuleFromAsar = requireForAsarServer(asarServerPath);
          if (serverModuleFromAsar && typeof serverModuleFromAsar.startSocketServer === "function") {
            serverModuleFromAsar.startSocketServer();
            console.log("Socket server started from app.asar in-process.");
            return;
          }
        }
      } catch (e) {
        console.warn("Requiring server from app.asar failed — will try unpacked/extract fallback:", e);
      }

      // Fallback: check for an unpacked copy placed by electron-builder (recommended)
      const unpackedPath = path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "socket",
        "server.cjs"
      );
      const unpackedDir = path.join(process.resourcesPath, "app.asar.unpacked", "socket");

      if (fs.existsSync(unpackedPath)) {
        console.log("Found unpacked socket server at:", unpackedPath);
        socketPath = unpackedPath;
        cwd = unpackedDir;
      } else {
        // If socket folder wasn't unpacked, fall back to extracting the socket folder to a temp dir.
        const asarPath = path.join(process.resourcesPath, "app.asar");
        if (fs.existsSync(asarPath)) {
          console.log("app.asar found at:", asarPath, "— extracting socket to temp dir");
          const tempDir = os.tmpdir();
          const extractPath = path.join(tempDir, "quantbot-socket-" + Date.now());
          fs.mkdirSync(extractPath, { recursive: true });
          try {
            const asar = requireFrom("@electron/asar");
            asar.extractAll(asarPath, extractPath);
            socketPath = path.join(extractPath, "socket", "server.cjs");
            cwd = path.join(extractPath, "socket");
            console.log("Extracted socket to:", socketPath);
          } catch (e) {
            console.error("Failed to extract socket from ASAR:", e);
          }
        }
      }
    } else {
      // Development mode — use project-local socket folder
      socketPath = path.join(process.env.APP_ROOT!, "socket", "server.cjs");
      cwd = path.join(process.env.APP_ROOT!, "socket");
    }

    if (!socketPath || !fs.existsSync(socketPath)) {
      console.error("Socket server script not found at expected path:", socketPath);
      return;
    }

    console.log("Starting socket server from:", socketPath);
    console.log("Working directory:", cwd);
    console.log("Is packaged:", isPackaged);

    // Prefer to load the CJS module into the current (main) process using createRequire.
    // This avoids spawning an external Node binary and prevents ASAR / path issues.
    try {
      // Load the CJS module using a require() bound to the socket script path
      const requireForServer = createRequire(socketPath);
      const serverModule = requireForServer(socketPath);
      if (serverModule && typeof serverModule.startSocketServer === "function") {
        // Start server (port optional, defaults inside module)
        serverModule.startSocketServer();
        console.log("Socket server started in-process.");
        return;
      }
      console.warn("Socket module does not export startSocketServer(); falling back to child process spawn");
    } catch (err) {
      console.warn("In-process require failed, falling back to spawn():", err);
    }

    // Fallback: spawn an external process (older behaviour). Use `node` if available.
    // Note: when packaged, node may not be available in PATH — but spawn is kept as a fallback.
    socketServerProcess = spawn("node", [socketPath], {
      cwd: cwd || undefined,
      stdio: ["inherit", "inherit", "inherit"],
    });

    socketServerProcess.on("error", (error) => {
      console.error("Socket server child process error:", error);
    });

    socketServerProcess.on("exit", (code) => {
      console.log(`Socket server exited with code ${code}`);
      socketServerProcess = null;
    });
  } catch (error) {
    console.error("Failed to start socket server:", error);
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
  // create splash window
  const splash = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: true,
    webPreferences: {
      scrollBounce: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  // Build splash HTML pointing to the quant.png file so we show the logo spinning.
  // Prefer embedding the PNG as base64 to avoid file:// resolution issues in packaged apps.
  const imagePath = path.join(process.env.VITE_PUBLIC || "", "quant.png");
  let imageSrc = pathToFileURL(imagePath).toString();
  try {
    const buf = fs.readFileSync(imagePath);
    const b64 = buf.toString("base64");
    imageSrc = `data:image/png;base64,${b64}`;
  } catch (e: any) {
    console.warn("Failed to read quant.png for splash embed, falling back to file:// URL:", e && e.message);
  }

  const splashHtml = `<!doctype html><html><head><meta charset="utf-8"/><style>html,body{height:100%;width:100%;margin:0;background:transparent;overflow:hidden !important;}body,html, #root{height:100%;} .splash-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;overflow:hidden;} .splash-box{display:flex;flex-direction:column;align-items:center;gap:12px;pointer-events:auto} img{width:120px;height:120px;animation:pulse 1.5s ease-in-out infinite;display:block;user-select:none;-webkit-user-drag:none;box-shadow:none !important;will-change:transform;backface-visibility:hidden;} @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}} .label{font-family:sans-serif;color:#666;text-align:center;font-size:13px;pointer-events:none;text-shadow:none !important;}</style></head><body><div class="splash-container"><div class="splash-box"><img src="${imageSrc}" alt="logo"/></div></div></body></html>`;
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`).catch(() => {});

  // create main window hidden
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "quant.png"),
    width: 1400,
    height: 700,
    show: false,
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
  try { if (!splash.isDestroyed()) splash.close(); } catch {}
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
    try { if (!splash.isDestroyed()) splash.close(); } catch {}
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

