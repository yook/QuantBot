import type { CrawlerEvent } from '../types/crawler-protocol';

export interface CrawlerStorage {
  saveUrlRow(projectId: number, row: Record<string, any>): Promise<void>;
  saveDisallowed(projectId: number, row: Record<string, any>): Promise<void>;
  updateStats(projectId: number, stat: string, value: number): Promise<void>;
  loadVisited(projectId: number): Promise<Set<string>>;
}

// Optional helper to persist events in a storage-agnostic way
export async function persistCrawlerEvent(
  storage: CrawlerStorage,
  event: CrawlerEvent
): Promise<void> {
  switch (event.type) {
    case 'row':
      if (event.row) {
        return storage.saveUrlRow(event.projectId, event.row);
      }
      return;
    case 'error':
      return storage.saveDisallowed(event.projectId, {
        message: event.message,
        url: event.url,
      });
    case 'stat':
      return storage.updateStats(event.projectId, event.stat, event.value);
    default:
      return;
  }
}
