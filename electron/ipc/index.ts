import type { IpcContext } from './types';
import { registerProjectsIpc } from './projects.js';
import { registerKeywordsIpc } from './keywords.js';
import { registerCategoriesIpc } from './categories.js';
import { registerTypingIpc } from './typing.js';
import { registerStopwordsIpc } from './stopwords.js';
import { registerUrlsIpc } from './urls.js';
import { registerEmbeddingsIpc } from './embeddings.js';
import { registerIntegrationsIpc } from './integrations.js';
import { ipcMain } from 'electron';
import { startCategorizationWorker } from '../workers/categorization.js';
import { startTypingWorker } from '../workers/typing.js';
import { startClusteringWorker } from '../workers/clustering.js';
import { startCrawlerWorker, stopCrawlerWorker } from '../workers/crawler.js';

export function registerAllIpc(ctx: IpcContext) {
  registerProjectsIpc(ctx);
  registerKeywordsIpc(ctx);
  registerCategoriesIpc(ctx);
  registerTypingIpc(ctx);
  registerStopwordsIpc(ctx);
  registerUrlsIpc(ctx);
  registerEmbeddingsIpc(ctx);
  registerIntegrationsIpc(ctx);

  // Worker starters
  ipcMain.handle('keywords:start-categorization', async (_event, projectId) => {
    try {
      await startCategorizationWorker({
        db: ctx.db,
        getWindow: ctx.getWindow,
        resolvedDbPath: ctx.resolvedDbPath,
        categoriesNameColumn: ctx.categoriesNameColumn,
      }, projectId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('keywords:start-typing', async (_event, projectId) => {
    try {
      await startTypingWorker({
        db: ctx.db,
        getWindow: ctx.getWindow,
        resolvedDbPath: ctx.resolvedDbPath,
        typingLabelColumn: ctx.typingLabelColumn,
        typingTextColumn: ctx.typingTextColumn,
        typingDateColumn: ctx.typingDateColumn,
      }, projectId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('keywords:start-clustering', async (_event, projectId, algorithm, eps, minPts) => {
    try {
      await startClusteringWorker({
        db: ctx.db,
        getWindow: ctx.getWindow,
        resolvedDbPath: ctx.resolvedDbPath,
      }, projectId, algorithm, eps, minPts);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Crawler controls
  ipcMain.handle('crawler:start', async (_e, project) => {
    try {
      await startCrawlerWorker({ db: ctx.db, getWindow: ctx.getWindow, resolvedDbPath: ctx.resolvedDbPath }, project);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('crawler:stop', async (_e, projectId?: number) => {
    try {
      stopCrawlerWorker(projectId as number | undefined);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
