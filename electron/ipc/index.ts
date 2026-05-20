import type { IpcContext } from './types';
import { registerProjectsIpc } from './projects.js';
import { registerUrlsIpc } from './urls.js';
import { ipcMain } from 'electron';
import { isCrawlerWorkerRunning, startCrawlerWorker, stopCrawlerWorker } from '../managers/crawler.js';
import { isParserWorkerRunning, startParserWorker, stopParserWorker } from '../managers/parser.js';
import { clampCrawlerConfigForPlan } from '../../src/utils/plan-limit-normalizers.js';
import { FREE_PLAN_LIMITS, isFreePlan } from '../../src/config/plan-limits.js';

export function registerAllIpc(ctx: IpcContext) {
  registerProjectsIpc(ctx);
  registerUrlsIpc(ctx);

  // Crawler controls
  ipcMain.handle('crawler:start', async (_e, project) => {
    try {
      if (!project || typeof project.id !== 'number' || !project.url || typeof project.url !== 'string') {
        return { success: false, error: 'Invalid crawler start payload' };
      }
      if (isParserWorkerRunning(project.id)) {
        return { success: false, code: 'PROCESS_CONFLICT', error: 'Нельзя запустить краулинг во время парсинга' };
      }
      project.crawler = clampCrawlerConfigForPlan(project.crawler || {});
      if (isFreePlan()) {
        const urlsRow = ctx.db.prepare("SELECT COUNT(*) as count FROM urls WHERE project_id = ?").get(project.id) as any;
        const disallowedRow = ctx.db.prepare("SELECT COUNT(*) as count FROM disallowed WHERE project_id = ?").get(project.id) as any;
        const currentTotal = Number(urlsRow?.count || 0) + Number(disallowedRow?.count || 0);
        const remaining = Math.max(0, FREE_PLAN_LIMITS.urlsPerProject - currentTotal);
        if (remaining <= 0) {
          return {
            success: false,
            code: 'FREE_URLS_LIMIT',
            error: 'В бесплатной версии доступно до 1 000 URL на проект. В Pro-версии нет ограничений по количеству URL.',
          };
        }
        const currentMaxUrls = Number(project.crawler?.maxUrls || 0);
        if (!Number.isFinite(currentMaxUrls) || currentMaxUrls <= 0 || currentMaxUrls > remaining) {
          project.crawler.maxUrls = remaining;
        }
      }
      const started = startCrawlerWorker(
        { db: ctx.db, getWindow: ctx.getWindow, resolvedDbPath: ctx.resolvedDbPath },
        project,
      );
      if (!started) {
        return { success: false, error: 'Crawler worker is already running or failed to start' };
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('crawler:stop', async (_e, projectId?: number) => {
    try {
      if (typeof projectId !== 'number' || projectId <= 0) {
        return { success: false, error: 'Invalid projectId' };
      }
      const result = stopCrawlerWorker(projectId as number | undefined);
      if (!result || !result.stopped) {
        return {
          success: false,
          error: result?.error || 'Crawler worker is not running for this project',
        };
      }
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('parser:start', async (_e, project) => {
    try {
      if (!project || typeof project.id !== 'number') {
        return { success: false, error: 'Invalid parser start payload' };
      }
      if (isCrawlerWorkerRunning(project.id)) {
        return { success: false, code: 'PROCESS_CONFLICT', error: 'Нельзя запустить парсинг во время краулинга' };
      }
      project.crawler = clampCrawlerConfigForPlan(project.crawler || {});
      const started = startParserWorker(
        { db: ctx.db, getWindow: ctx.getWindow, resolvedDbPath: ctx.resolvedDbPath },
        project,
      );
      if (!started) {
        return { success: false, error: 'Parser worker is already running or failed to start' };
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('parser:stop', async (_e, projectId?: number) => {
    try {
      if (typeof projectId !== 'number' || projectId <= 0) {
        return { success: false, error: 'Invalid projectId' };
      }
      stopParserWorker(projectId as number | undefined);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
