import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function registerEmbeddingsIpc(ctx: IpcContext) {
  const { db, getWindow } = ctx;

  ipcMain.handle('embeddings:getCacheSize', async () => {
    try {
      const row: any = db.prepare('SELECT COUNT(*) as count FROM embeddings_cache').get();
      const size = row ? Number(row.count) : 0;
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('embeddings-cache-size', { size });
      }
      return { success: true, data: { size } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('embeddings:clearCache', async () => {
    try {
      const info = db.prepare('DELETE FROM embeddings_cache').run();
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('embeddings-cache-cleared');
      }
      return { success: true, data: { changes: info?.changes ?? 0 } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
