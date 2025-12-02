import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import keytar from 'keytar';
// Note: do not require CommonJS secret-store at module top-level because
// the main process is ESM (`"type": "module"`). We'll dynamically import
// `electron/db/secret-store.cjs` inside handlers to avoid `require is not defined`.

const INTEGRATION_SERVICE = 'site-analyzer';

export function registerIntegrationsIpc(ctx: IpcContext) {
  const { getWindow } = ctx;

  ipcMain.handle('integrations:get', async (_event, projectId, service) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      const account = String(service);
      let secret: string | null = null;
      let hasKey = false;
      let maskedKey: string | null = null;
      if (account === 'openai') {
        try {
          const ssMod = await import('../db/secret-store.cjs');
          const ss = (ssMod && (ssMod.default || ssMod)) as any;
          if (ss && typeof ss.getSecret === 'function') {
            secret = await ss.getSecret(account);
          }
        } catch (e) {
          console.warn('secretStore getSecret error', e && (e as any).message ? (e as any).message : e);
        }
      } else {
        secret = await keytar.getPassword(INTEGRATION_SERVICE, account);
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
        if (account === 'openai') {
          try {
            const ssMod = await import('../db/secret-store.cjs');
            const ss = (ssMod && (ssMod.default || ssMod)) as any;
            if (ss && typeof ss.deleteSecret === 'function') {
              await ss.deleteSecret(account);
            }
          } catch (e) {
            console.warn('secretStore deleteSecret error', e && (e as any).message ? (e as any).message : e);
          }
        } else {
          await keytar.deletePassword(INTEGRATION_SERVICE, account);
        }
        if (w && !w.isDestroyed()) {
          w.webContents.send('integrations:deleted', { projectId, service });
        }
        return { success: true, data: { deleted: true } };
      }
      if (account === 'openai') {
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
      } else {
        await keytar.setPassword(INTEGRATION_SERVICE, account, key);
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
      if (account === 'openai') {
        try {
          const ssMod = await import('../db/secret-store.cjs');
          const ss = (ssMod && (ssMod.default || ssMod)) as any;
          if (ss && typeof ss.deleteSecret === 'function') {
            await ss.deleteSecret(account);
          }
        } catch (e) {
          console.warn('secretStore deleteSecret error', e && (e as any).message ? (e as any).message : e);
        }
      } else {
        await keytar.deletePassword(INTEGRATION_SERVICE, account);
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
      const account = String(service);
      // only migrate for openai by default; this uses keytar to read and moves into DB
      try {
        const ssMod = await import('../db/secret-store.cjs');
        const ss = (ssMod && (ssMod.default || ssMod)) as any;
        if (ss && typeof ss.migrateFromKeytar === 'function') {
          const res = await ss.migrateFromKeytar(keytar, INTEGRATION_SERVICE, account);
          return { success: true, data: res };
        }
        return { success: false, error: 'secret-store migrateFromKeytar not available' };
      } catch (e) {
        return { success: false, error: e && (e as any).message ? (e as any).message : String(e) };
      }
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // Proxy integration handlers removed
}
