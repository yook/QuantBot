import { 
  ProjectData, 
  ProjectSummary, 
  SortedRequestOptions, 
  Stats, 
  GetAllDataRequest,
  SortedUrlsResponse,
  UrlData,
  ProjectStatsSync,
  ProjectStatsData,
  CrawlerStatus,
  QueueUpdate,
  TableUpdate,
  // categories
  CategoriesListResponse,
  CategoriesProgressPayload,
  CategoriesAddedPayload,
  SimpleProjectPayload,
  ErrorPayload,
  // keywords
  KeywordsListResponse,
  KeywordsLoadedMoreResponse,
  KeywordUpdatedPayload,
  KeywordsExportResponse,
  KeywordsProgressPayload,
  PercentageProgressPayload,
  // typing
  TypingSamplesListResponse
} from "./schema";

// Server -> Client events the renderer listens to
export interface ServerToClientEvents {
  // Note: socket.io reserved events like 'connect' are provided separately by the library

  // project list and project data
  "all-projects-data": (data: ProjectSummary[]) => void;
  "project-data": (data: ProjectData | null) => void;
  "new-project-data": (newDoc: { id: string | number }) => void;

  // crawler lifecycle
  stopping: (data: CrawlerStatus) => void;
  stopped: (data: CrawlerStatus) => void;
  complete: () => void;

  // connection lifecycle (socket.io system events)
  reconnect: (attemptNumber: number) => void;
  reconnect_error: (error: Error) => void;

  // stats granular updates
  fetched: (data: QueueUpdate) => void;
  queue: (data: QueueUpdate) => void;
  statsUpdate: (stats: Partial<Stats>) => void;

  // per-stat convenience events
  disallow: (count: number) => void;
  "stat-html": (data: { count: number; projectId: string | number }) => void;
  "stat-jscss": (data: { count: number; projectId: string | number }) => void;
  "stat-image": (data: { count: number; projectId: string | number }) => void;
  "stat-redirect": (data: { count: number; projectId: string | number }) => void;
  "stat-error": (data: { count: number; projectId: string | number }) => void;
  "stat-depth3": (data: { count: number; projectId: string | number }) => void;
  "stat-depth5": (data: { count: number; projectId: string | number }) => void;
  "stat-depth6": (data: { count: number; projectId: string | number }) => void;
  "stat-other": (data: { count: number; projectId: string | number }) => void;

  // table updates and responses
  "data-updated": (data: TableUpdate) => void;
  // dynamic event for sorted data response
  [dynamicEvent: `sorted-urls-data-${string}`]: (response: SortedUrlsResponse) => void;

  // project management
  deleted: (count: number) => void;
  "crawler-data-cleared": (data: { projectId: string | number }) => void;
  "delete-error": (errorMessage: string) => void;
  projectDeleted: (deletedProjectId: number) => void;
  projectDeleteError: (errorMessage: string) => void;
  "project-save-error": (errorMessage: string) => void;

  // export
  "urls-all-data": (data: UrlData[]) => void;
  // project stats responses
  "project-stats-data": (data: ProjectStatsData) => void;
  "project-stats-error": (message: string) => void;

  // keywords export (server -> client)
  "keywords:export-data": (data: KeywordsExportResponse) => void;

  // manual stats sync
  "project-stats-synced": (payload: ProjectStatsSync) => void;

  // categories (server -> client)
  "categories:list": (data: CategoriesListResponse) => void;
  "categories:progress": (data: CategoriesProgressPayload) => void;
  "categories:added": (data: CategoriesAddedPayload) => void;
  "categories:cleared": (data: SimpleProjectPayload) => void;
  "categories:error": (data: ErrorPayload) => void;

  // keywords (server -> client)
  "keywords:list": (data: KeywordsListResponse) => void;
  "keywords:loaded-more": (data: KeywordsLoadedMoreResponse) => void;
  "keywords:updated": (data: KeywordUpdatedPayload) => void;
  "keywords:added": (data: SimpleProjectPayload & { added?: number }) => void;
  "keywords:removed": (data: SimpleProjectPayload) => void;
  "keywords:cleared": (data: SimpleProjectPayload) => void;
  "keywords:progress": (data: KeywordsProgressPayload) => void;
  "keywords:categorization-started": (data: SimpleProjectPayload) => void;
  "keywords:categorization-progress": (data: PercentageProgressPayload) => void;
  "keywords:categorization-finished": (data: SimpleProjectPayload) => void;
  "keywords:categorization-error": (data: ErrorPayload) => void;
  "keywords:typing-started": (data: SimpleProjectPayload) => void;
  "keywords:typing-progress": (data: PercentageProgressPayload) => void;
  "keywords:typing-finished": (data: SimpleProjectPayload) => void;
  "keywords:typing-error": (data: ErrorPayload) => void;
  "keywords:clustering-started": (data: SimpleProjectPayload) => void;
  "keywords:clustering-progress": (data: PercentageProgressPayload) => void;
  "keywords:clustering-finished": (data: SimpleProjectPayload) => void;
  "keywords:clustering-error": (data: ErrorPayload) => void;
  // generic keywords error
  "keywords:error": (data: ErrorPayload) => void;

  // typing (server -> client)
  "typing:samples:list": (data: TypingSamplesListResponse) => void;
  "typing:samples:added": (data: SimpleProjectPayload) => void;
  "typing:samples:updated": (data: SimpleProjectPayload) => void;
  "typing:samples:deleted": (data: SimpleProjectPayload) => void;
  "typing:samples:cleared": (data: SimpleProjectPayload) => void;
  "typing:error": (data: ErrorPayload) => void;
}

// Client -> Server events the renderer emits
export interface ClientToServerEvents {
  // projects
  "get-all-projects": () => void;
  "get-project": (projectId: string | number) => void;
  "change-project": (projectId: string | number) => void;
  "save-new-project": (data: ProjectData) => void;
  "update-project": (data: ProjectData) => void;
  "delete-project": (projectId: string | number | null) => void;
  "delete-all": (projectId: string | number | null) => void;
  "clear-embeddings-cache": () => void;

  // crawler
  startCrauler: (data: ProjectData) => void;
  freezeQueue: () => void;

  // table
  "get-sorted-urls": (options: SortedRequestOptions) => void;
  "get-all-data": (req: GetAllDataRequest) => void;

  // stats
  "sync-project-stats": (projectId: number) => void;

  // keywords export (client -> server)
  "keywords:export": (data: { projectId: string | number }) => void;

  // categories (client -> server)
  "categories:get": (data: { projectId: string | number; skip?: number; limit?: number; sort?: Record<string, number>; timeoutId?: number }) => void;
  "categories:add": (data: { projectId: string | number; categories: string }) => void;
  "categories:clear": (data: { projectId: string | number }) => void;
  "categories:delete": (data: { projectId: string | number; id: string | number }) => void;

  // keywords (client -> server)
  "keywords:get": (data: { projectId: string | number; skip?: number; limit?: number; sort?: Record<string, number>; searchQuery?: string; timeoutId?: number }) => void;
  "keywords:load-more": (data: { projectId: string | number; skip: number; limit: number }) => void;
  "keywords:add": (data: { projectId: string | number; keywords: string; createdAt?: string; windowStart?: number; windowSize?: number }) => void;
  "keywords:remove": (data: { projectId: string | number; keyword: string; windowStart?: number; windowSize?: number }) => void;
  "keywords:clear": (data: { projectId: string | number }) => void;
  "keywords:delete": (data: { projectId: string | number; id: string | number }) => void;
  "keywords:start-categorization": (data: { projectId: string | number }) => void;
  "keywords:start-typing": (data: { projectId: string | number }) => void;
  "keywords:start-clustering": (data: { 
    projectId: string | number; 
    algorithm: string;
    eps: number; 
    minPts?: number;
  }) => void;

  // typing samples (client -> server)
  "typing:samples:get": (data: { projectId: string | number; skip?: number; limit?: number }) => void;
  "typing:samples:add": (data: { projectId: string | number; samples: Array<{ label: string; text: string }> }) => void;
  "typing:samples:clear": (data: { projectId: string | number }) => void;
  "typing:samples:delete": (data: { projectId: string | number; id: string | number }) => void;
  "typing:samples:update": (data: { projectId: string | number; id: string | number; fields: Record<string, any> }) => void;
}
