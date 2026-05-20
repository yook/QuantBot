export type CrawlerMode = 'ipc' | 'remote';

function readCrawlerModeFromEnv(): CrawlerMode | null {
  const raw = (import.meta as any).env?.VITE_CRAWLER_MODE;
  if (raw === 'ipc' || raw === 'remote') return raw;
  return null;
}

export const runtimeConfig = {
  crawlerMode: (readCrawlerModeFromEnv() || 'ipc') as CrawlerMode,
};
