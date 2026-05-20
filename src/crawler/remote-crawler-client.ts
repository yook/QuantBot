import type { CrawlerClient, CrawlerEventHandler } from './crawler-client';
import type { CrawlerJob, CrawlerResult } from '../types/crawler-protocol';

// Remote crawler stub (transport not implemented yet)
export class RemoteCrawlerClient implements CrawlerClient {
  async start(job: CrawlerJob): Promise<CrawlerResult> {
    return { projectId: job.projectId, ok: false, error: 'RemoteCrawlerClient not implemented' };
  }

  async stop(projectId: number): Promise<CrawlerResult> {
    return { projectId, ok: false, error: 'RemoteCrawlerClient not implemented' };
  }

  getMode(): 'ipc' | 'remote' {
    return 'remote';
  }

  onEvent(_handler: CrawlerEventHandler): void {
    // no-op
  }

  offEvent(_handler: CrawlerEventHandler): void {
    // no-op
  }
}
