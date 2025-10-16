import { 
  ProjectData, 
  ProjectSummary, 
  SortedRequestOptions, 
  Stats, 
  GetAllDataRequest,
  SortedUrlsResponse,
  UrlData,
  ProjectStatsSync,
  CrawlerStatus,
  QueueUpdate,
  TableUpdate
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

  // stats granular updates
  fetched: (data: QueueUpdate) => void;
  queue: (data: QueueUpdate) => void;
  statsUpdate: (stats: Partial<Stats>) => void;

  // per-stat convenience events
  disallow: (count: number) => void;
  "stat-html": (count: number) => void;
  "stat-jscss": (count: number) => void;
  "stat-image": (count: number) => void;
  "stat-redirect": (count: number) => void;
  "stat-error": (count: number) => void;
  "stat-depth3": (count: number) => void;
  "stat-depth5": (count: number) => void;
  "stat-depth6": (count: number) => void;
  "stat-other": (count: number) => void;

  // table updates and responses
  "data-updated": (data: TableUpdate) => void;
  // dynamic event for sorted data response
  [dynamicEvent: `sorted-urls-data-${string}`]: (response: SortedUrlsResponse) => void;

  // project management
  deleted: (count: number) => void;
  "delete-error": (errorMessage: string) => void;
  projectDeleted: () => void;
  projectDeleteError: (errorMessage: string) => void;
  "project-save-error": (errorMessage: string) => void;

  // export
  "urls-all-data": (data: UrlData[]) => void;

  // manual stats sync
  "project-stats-synced": (payload: ProjectStatsSync) => void;

  // keywords
  "keywords-data": (data: any[]) => void;
  "keyword-added": (keyword: any) => void;
  "keyword-deleted": (keywordId: string | number) => void;
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

  // keywords
  "get-keywords": (projectId: string | number) => void;
  "add-keyword": (data: { projectId: string | number; keyword: any }) => void;
  "delete-keyword": (data: { projectId: string | number; keywordId: string | number }) => void;
}
