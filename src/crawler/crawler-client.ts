import type { CrawlerEvent, CrawlerJob, CrawlerResult } from '../types/crawler-protocol';

export type CrawlerEventHandler = (event: CrawlerEvent) => void;
export type CrawlerStartedHandler = (event: Extract<CrawlerEvent, { type: 'started' }>) => void;

export interface CrawlerClient {
  start(job: CrawlerJob): Promise<CrawlerResult>;
  stop(projectId: number): Promise<CrawlerResult>;
  getMode(): 'ipc' | 'remote';
  onEvent(handler: CrawlerEventHandler): void;
  offEvent(handler: CrawlerEventHandler): void;
}

export function onCrawlerStarted(client: CrawlerClient, handler: CrawlerStartedHandler) {
  const wrapper: CrawlerEventHandler = (event) => {
    if (event.type === 'started') handler(event as Extract<CrawlerEvent, { type: 'started' }>);
  };
  client.onEvent(wrapper);
  return () => client.offEvent(wrapper);
}
