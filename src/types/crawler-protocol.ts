// Shared crawler protocol types for local IPC and future remote transport

export type CrawlerJob = {
  projectId: number;
  startUrl: string;
  crawlerConfig: Record<string, any>;
  parserConfig: Array<Record<string, any>>;
};

export type CrawlerEventType =
  | 'progress'
  | 'stat'
  | 'row'
  | 'url'
  | 'error'
  | 'finished'
  | 'queue'
  | 'started'
  | 'render'
  | 'limit_reached';

export type CrawlerEventBase = {
  type: CrawlerEventType;
  projectId: number;
  timestamp?: string;
};

export type CrawlerProgressEvent = CrawlerEventBase & {
  type: 'progress' | 'queue';
  fetched?: number;
  queue?: number;
  message?: string;
  seeded?: number;
  signal?: string;
};

export type CrawlerStatEvent = CrawlerEventBase & {
  type: 'stat';
  stat: string;
  value: number;
};

export type CrawlerRowEvent = CrawlerEventBase & {
  type: 'row';
  row?: Record<string, any>;
  data?: Record<string, any>;
};

export type CrawlerUrlEvent = CrawlerEventBase & {
  type: 'url';
  url: string;
};

export type CrawlerErrorEvent = CrawlerEventBase & {
  type: 'error';
  message: string;
  url?: string;
  stage?: string;
  status?: number;
  error?: string;
};

export type CrawlerFinishedEvent = CrawlerEventBase & {
  type: 'finished';
  code?: number | null;
  signal?: string | null;
  fetched?: number;
};

export type CrawlerRenderEvent = CrawlerEventBase & {
  type: 'render';
  mode?: 'chromium' | 'lightweight' | string;
  level?: 'warn' | 'error' | 'info' | string;
  url?: string;
  message?: string;
};

export type CrawlerEvent =
  | CrawlerProgressEvent
  | CrawlerStatEvent
  | CrawlerRowEvent
  | CrawlerUrlEvent
  | CrawlerErrorEvent
  | CrawlerFinishedEvent
  | CrawlerRenderEvent
  | (CrawlerEventBase & { type: 'limit_reached'; reason?: string; limit?: number; fetched?: number; message?: string })
  | (CrawlerEventBase & { type: 'started'; startUrl: string });

export type CrawlerResult = {
  projectId: number;
  ok: boolean;
  error?: string;
};
