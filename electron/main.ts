import { app, BrowserWindow, shell, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "fs";
import os from "os";

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
let dbWorkerProcess: ChildProcess | null = null;

// DB Worker IPC bridge
let dbRequestId = 0;
const dbPendingRequests = new Map<number, { resolve: Function; reject: Function }>();

function dbCall(method: string, ...params: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!dbWorkerProcess || dbWorkerProcess.killed) {
      return reject(new Error('DB worker not running'));
    }

    const id = ++dbRequestId;
    dbPendingRequests.set(id, { resolve, reject });

    const request = JSON.stringify({ id, method, params }) + '\n';
    dbWorkerProcess.stdin?.write(request);

    // Timeout after 30s
    setTimeout(() => {
      if (dbPendingRequests.has(id)) {
        dbPendingRequests.delete(id);
        reject(new Error('DB request timeout'));
      }
    }, 30000);
  });
}

// Register IPC handlers for renderer DB operations
function registerIpcHandlers() {
  // Projects
  ipcMain.handle('db:projects:getAll', async () => {
    try {
      const result = await dbCall('projects:getAll');
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:get', async (_event, id) => {
    try {
      const result = await dbCall('projects:get', id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:insert', async (_event, name, url) => {
    try {
      const result = await dbCall('projects:insert', name, url);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:update', async (_event, name, url, id) => {
    try {
      const result = await dbCall('projects:update', name, url, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:projects:delete', async (_event, id) => {
    try {
      const result = await dbCall('projects:delete', id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Keywords
  ipcMain.handle('db:keywords:getAll', async (_event, projectId) => {
    try {
      const result = await dbCall('keywords:getAll', projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:getWindow', async (_event, projectId, skip, limit, sort, searchQuery) => {
    try {
      const result = await dbCall('keywords:getWindow', projectId, skip, limit, sort, searchQuery);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:insert', async (_event, keyword, projectId, categoryId, color, disabled) => {
    try {
      const result = await dbCall('keywords:insert', keyword, projectId, categoryId, color, disabled);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:update', async (_event, keyword, categoryId, color, disabled, id) => {
    try {
      const result = await dbCall('keywords:update', keyword, categoryId, color, disabled, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:delete', async (_event, id) => {
    try {
      const result = await dbCall('keywords:delete', id);
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
      const result = await dbCall('keywords:insertBulk', keywords, projectId);
      console.log('[Main IPC] db:keywords:insertBulk success:', result);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Main IPC] db:keywords:insertBulk error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateCategory', async (_event, id, categoryName, categorySimilarity) => {
    try {
      const result = await dbCall('keywords:updateCategory', id, categoryName, categorySimilarity);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateClass', async (_event, id, className, classSimilarity) => {
    try {
      const result = await dbCall('keywords:updateClass', id, className, classSimilarity);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:updateCluster', async (_event, id, cluster) => {
    try {
      const result = await dbCall('keywords:updateCluster', id, cluster);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:keywords:deleteByProject', async (_event, projectId) => {
    try {
      const result = await dbCall('keywords:deleteByProject', projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Categories
  ipcMain.handle('db:categories:getAll', async (_event, projectId) => {
    try {
      const result = await dbCall('categories:getAll', projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:insert', async (_event, name, projectId, color) => {
    try {
      const result = await dbCall('categories:insert', name, projectId, color);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:update', async (_event, name, color, id) => {
    try {
      const result = await dbCall('categories:update', name, color, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:categories:delete', async (_event, id) => {
    try {
      const result = await dbCall('categories:delete', id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Typing
  ipcMain.handle('db:typing:getAll', async (_event, projectId) => {
    try {
      const result = await dbCall('typing:getAll', projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:insert', async (_event, projectId, url, sample, date) => {
    try {
      const result = await dbCall('typing:insert', projectId, url, sample, date);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:update', async (_event, url, sample, date, id) => {
    try {
      const result = await dbCall('typing:update', url, sample, date, id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:delete', async (_event, id) => {
    try {
      const result = await dbCall('typing:delete', id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:typing:deleteByProject', async (_event, projectId) => {
    try {
      const result = await dbCall('typing:deleteByProject', projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Stopwords
  ipcMain.handle('db:stopwords:getAll', async (_event, projectId) => {
    try {
      const result = await dbCall('stopwords:getAll', projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:insert', async (_event, projectId, word) => {
    try {
      const result = await dbCall('stopwords:insert', projectId, word);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:delete', async (_event, id) => {
    try {
      const result = await dbCall('stopwords:delete', id);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:stopwords:deleteByProject', async (_event, projectId) => {
    try {
      const result = await dbCall('stopwords:deleteByProject', projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // URLs
  ipcMain.handle('db:urls:getAll', async (_event, projectId) => {
    try {
      const result = await dbCall('urls:getAll', projectId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:getSorted', async (_event, options) => {
    try {
      const result = await dbCall('urls:getSorted', options);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:urls:count', async (_event, projectId) => {
    try {
      const result = await dbCall('urls:count', projectId);
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

// Start DB worker process
function startDbWorker(): boolean {
  if (dbWorkerProcess) {
    console.log('DB worker already running');
    return true;
  }

  // In dev: use source file from electron/ directory
  // In production: use copied file from dist-electron/
  const workerPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "electron", "db-worker.cjs")
    : path.join(__dirname, "..", "electron", "db-worker.cjs");

  const execCmd = app.isPackaged ? process.execPath : "node";
  console.log("Starting DB worker:", execCmd, workerPath);

  // Set DB path via environment variable
  // Always use local db/projects.db relative to app root
  const dbPath = path.join(__dirname, '..', 'db', 'projects.db');

  console.log("DB path:", dbPath);

  try {
    const proc = spawn(execCmd, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, DB_PATH: dbPath },
    });

    dbWorkerProcess = proc;

    // Handle responses from worker
    let buffer = '';
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          const pending = dbPendingRequests.get(response.id);
          if (pending) {
            dbPendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (err) {
          console.error('Failed to parse DB worker response:', err);
        }
      }
    });

    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (data) => {
      console.log('[DB Worker]', data.toString().trim());
    });

    proc.on('error', (err) => {
      console.error('DB worker process error:', err);
      dbWorkerProcess = null;
    });

    proc.on('exit', (code, sig) => {
      console.log('DB worker exited', code, sig);
      dbWorkerProcess = null;
      // Reject all pending requests
      for (const [id, pending] of dbPendingRequests.entries()) {
        pending.reject(new Error('DB worker exited'));
        dbPendingRequests.delete(id);
      }
    });

    return true;
  } catch (e: any) {
    console.error("Failed to start DB worker:", e?.message || String(e));
    return false;
  }
}

// Worker process runners for categorization, typing, clustering
async function startCategorizationWorker(projectId: number) {
  const workerPath = path.join(__dirname, '..', 'worker', 'assignCategorization.cjs');
  
  console.log(`Starting categorization worker for project ${projectId}`);
  
  try {
    // Load categories and keywords from DB
    const categories = await dbCall('categories:getAll', projectId);
    const keywords = await dbCall('keywords:getAll', projectId);

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
            dbCall('keywords:updateCategory', obj.id, obj.bestCategoryName, obj.similarity || null)
              .catch(err => console.error('Failed to update keyword category:', err));
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
    const typingSamples = await dbCall('typing:getAll', projectId);
    const keywords = await dbCall('keywords:getAll', projectId);

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
            dbCall('keywords:updateClass', obj.id, obj.className, obj.similarity || null)
              .catch(err => console.error('Failed to update keyword class:', err));
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
    const keywords = await dbCall('keywords:getAll', projectId);

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
            dbCall('keywords:updateCluster', obj.id, obj.cluster)
              .catch(err => console.error('Failed to update keyword cluster:', err));
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

// Stop DB worker
function stopDbWorker() {
  if (dbWorkerProcess) {
    console.log('Stopping DB worker...');
    dbWorkerProcess.kill('SIGTERM');
    dbWorkerProcess = null;
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
  stopDbWorker(); // Ensure DB worker is stopped before quit
});

app.whenReady().then(() => {
  console.log('[Main] App ready, starting DB worker...');
  const ok = startDbWorker();
  if (!ok) {
    console.error('[Main] Failed to start DB worker');
    app.quit();
    return;
  }

  console.log('[Main] DB worker started, registering IPC handlers...');
  registerIpcHandlers(); // Register IPC handlers
  
  console.log('[Main] Creating window...');
  createWindow(); // Then create window

  // Проверка обновлений и уведомление пользователя
  autoUpdater.checkForUpdatesAndNotify();
});

