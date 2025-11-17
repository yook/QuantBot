import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import keytar from 'keytar';

const INTEGRATION_SERVICE = 'site-analyzer';

export function registerIntegrationsIpc(ctx: IpcContext) {
  const { getWindow } = ctx;

  ipcMain.handle('integrations:get', async (_event, projectId, service) => {
    try {
      if (!service) return { success: false, error: 'service is required' };
      const account = String(service);
      const secret = await keytar.getPassword(INTEGRATION_SERVICE, account);
      const hasKey = !!secret;
      let maskedKey: string | null = null;
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
        await keytar.deletePassword(INTEGRATION_SERVICE, account);
        if (w && !w.isDestroyed()) {
          w.webContents.send('integrations:deleted', { projectId, service });
        }
        return { success: true, data: { deleted: true } };
      }
      await keytar.setPassword(INTEGRATION_SERVICE, account, key);
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
      await keytar.deletePassword(INTEGRATION_SERVICE, account);
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('integrations:deleted', { projectId, service });
      }
      return { success: true, data: { deleted: true } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
