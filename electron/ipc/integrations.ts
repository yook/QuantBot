import { ipcMain } from 'electron';
import type { IpcContext } from './types';
// Note: do not require CommonJS secret-store at module top-level because
// the main process is ESM (`"type": "module"`). We'll dynamically import
// `electron/db/secret-store.cjs` inside handlers to avoid `require is not defined`.

export function registerIntegrationsIpc(ctx: IpcContext) {
  const { getWindow } = ctx;

  ipcMain.handle('integrations:get', async (_event, projectId, service) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      const account = String(service);
      let secret: string | null = null;
      let hasKey = false;
      let maskedKey: string | null = null;
      try {
        const ssMod = await import('../db/secret-store.cjs');
        const ss = (ssMod && (ssMod.default || ssMod)) as any;
        if (ss && typeof ss.getSecret === 'function') {
          secret = await ss.getSecret(account);
        }
      } catch (e) {
        console.warn('secretStore getSecret error', e && (e as any).message ? (e as any).message : e);
      }
      hasKey = !!secret;
      if (secret) {
        maskedKey = secret.length >= 8 ? `${secret.slice(0, 4)}...${secret.slice(-4)}` : `${secret.slice(0, 2)}...${secret.slice(-2)}`;
      }
      const payload = { projectId, service, hasKey, maskedKey };
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('integrations:info', payload);
      }
      return { success: true, data: payload };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('integrations:setKey', async (_event, projectId, service, key) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      const account = String(service);
      const w = getWindow();
      if (!key || key === '') {
        try {
          const ssMod = await import('../db/secret-store.cjs');
          const ss = (ssMod && (ssMod.default || ssMod)) as any;
          if (ss && typeof ss.deleteSecret === 'function') {
            await ss.deleteSecret(account);
          }
        } catch (e) {
          console.warn('secretStore deleteSecret error', e && (e as any).message ? (e as any).message : e);
        }
        if (w && !w.isDestroyed()) {
          w.webContents.send('integrations:deleted', { projectId, service });
        }
        return { success: true, data: { deleted: true } };
      }
      try {
        const ssMod = await import('../db/secret-store.cjs');
        const ss = (ssMod && (ssMod.default || ssMod)) as any;
        if (ss && typeof ss.saveSecret === 'function') {
          await ss.saveSecret(account, key);
        } else {
          throw new Error('secret-store saveSecret not available');
        }
      } catch (e) {
        return { success: false, error: (e && (e as any).message) || String(e) };
      }
      if (w && !w.isDestroyed()) {
        w.webContents.send('integrations:setKey:ok', { projectId, service });
      }
      return { success: true, data: { saved: true } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('integrations:delete', async (_event, projectId, service) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      const account = String(service);
      try {
        const ssMod = await import('../db/secret-store.cjs');
        const ss = (ssMod && (ssMod.default || ssMod)) as any;
        if (ss && typeof ss.deleteSecret === 'function') {
          await ss.deleteSecret(account);
        }
      } catch (e) {
        console.warn('secretStore deleteSecret error', e && (e as any).message ? (e as any).message : e);
      }
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('integrations:deleted', { projectId, service });
      }
      return { success: true, data: { deleted: true } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('integrations:migrateKey', async (_event, _projectId, service) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      return { success: false, error: 'migrateKey is no longer supported' };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // Proxy integration handlers removed
}
