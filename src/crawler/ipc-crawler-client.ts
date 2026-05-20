import type { CrawlerClient, CrawlerEventHandler } from './crawler-client';
import type { CrawlerEvent, CrawlerJob, CrawlerResult } from '../types/crawler-protocol';

export class IpcCrawlerClient implements CrawlerClient {
  private ipc: any;
  private wrappedHandlers = new Map<CrawlerEventHandler, (event: any, data: any) => void>();

  constructor(ipcRenderer?: any) {
    this.ipc = ipcRenderer || (window as any).ipcRenderer;
  }

  async start(job: CrawlerJob): Promise<CrawlerResult> {
    if (!this.ipc || typeof this.ipc.invoke !== 'function') {
      return { projectId: job.projectId, ok: false, error: 'ipcRenderer.invoke not available' };
    }
    const payload = {
      id: job.projectId,
      url: job.startUrl,
      crawler: job.crawlerConfig,
      parser: job.parserConfig,
    };
    try {
      const res = await this.ipc.invoke('crawler:start', payload);
      if (res && res.success) return { projectId: job.projectId, ok: true };
      return { projectId: job.projectId, ok: false, error: res?.error || 'start failed' };
    } catch (e: any) {
      return { projectId: job.projectId, ok: false, error: e?.message || String(e) };
    }
  }

  getMode(): 'ipc' | 'remote' {
    return 'ipc';
  }

  async stop(projectId: number): Promise<CrawlerResult> {
    if (!this.ipc || typeof this.ipc.invoke !== 'function') {
      return { projectId, ok: false, error: 'ipcRenderer.invoke not available' };
    }
    try {
      const res = await this.ipc.invoke('crawler:stop', projectId);
      if (res && res.success) return { projectId, ok: true };
      return { projectId, ok: false, error: res?.error || 'stop failed' };
    } catch (e: any) {
      return { projectId, ok: false, error: e?.message || String(e) };
    }
  }

  onEvent(handler: CrawlerEventHandler): void {
    if (!this.ipc) return;
    const wrapped = (_event: any, payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      handler(payload as CrawlerEvent);
    };
    this.wrappedHandlers.set(handler, wrapped);
    const channels = [
      'crawler:progress',
      'crawler:queue',
      'crawler:finished',
      'crawler:error',
      'crawler:url',
      'crawler:row',
      'crawler:stat',
      'crawler:stat:html',
      'crawler:stat:image',
      'crawler:stat:jscss',
      'crawler:stat:redirect',
      'crawler:stat:error',
      'crawler:stat:depth3',
      'crawler:stat:depth5',
      'crawler:stat:depth6',
      'crawler:stat:disallow',
      'crawler:started',
      'crawler:render',
      'crawler:limit',
    ];
    for (const ch of channels) this.ipc.on(ch, wrapped);
  }

  offEvent(handler: CrawlerEventHandler): void {
    if (!this.ipc) return;
    const wrapped = this.wrappedHandlers.get(handler);
    if (!wrapped) return;
    const channels = [
      'crawler:progress',
      'crawler:queue',
      'crawler:finished',
      'crawler:error',
      'crawler:url',
      'crawler:row',
      'crawler:stat',
      'crawler:started',
      'crawler:render',
      'crawler:limit',
    ];
    for (const ch of channels) this.ipc.off(ch, wrapped);
    this.wrappedHandlers.delete(handler);
  }
}
