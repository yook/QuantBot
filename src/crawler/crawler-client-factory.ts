import { IpcCrawlerClient } from './ipc-crawler-client';
import { RemoteCrawlerClient } from './remote-crawler-client';
import type { CrawlerClient } from './crawler-client';
import { runtimeConfig } from '../config/runtime';

export type CrawlerClientMode = 'ipc' | 'remote';

export function getCrawlerClient(mode?: CrawlerClientMode, ipcRenderer?: any): CrawlerClient {
  const resolvedMode = mode || runtimeConfig.crawlerMode || 'ipc';

  if (resolvedMode === 'remote') return new RemoteCrawlerClient();
  return new IpcCrawlerClient(ipcRenderer);
}
