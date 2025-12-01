// Shared domain types inferred from JSON schemas

export interface Stats {
  fetched: number;
  queue: number;
  disallow: number;
  html: number;
  jscss: number;
  image: number;
  redirect: number;
  error: number;
  depth3: number;
  depth5: number;
  depth6: number;
  other: number;
}

export interface ParserField {
  name: string;
  prop: string;
  selector: string;
  find: string;
  attrClass: string;
  getLength: boolean;
}

export interface ColumnDef {
  name: string;
  prop: string;
  width?: number;
  minWidth?: number;
  disabled?: boolean;
}

export interface SettingsFile {
  settings: ColumnDef[];
}

export interface ReportOption {
  value: string;
  label: string;
  status: string;
}

export interface ReportGroup {
  label: string;
  options: ReportOption[];
}

export interface ReportsFile {
  reports: ReportGroup[];
}

export interface CrawlerConfig {
  maxDepth: number;
  maxConcurrency: number;
  interval: number;
  timeout: number;
  parseScriptTags: boolean;
  parseImages: boolean;
  stripQuerystring: boolean;
  sortQueryParameters: boolean;
  respectRobotsTxt: boolean;
  scanSubdomains: boolean;
  userAgent: string;
}

export interface NewProjectFile {
  name: string;
  url: string;
  freezed: boolean;
  stats: Stats;
  crawler: CrawlerConfig;
  parser: ParserField[];
  columns: Record<string, string[]>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  url?: string;
}

export interface ProjectData extends NewProjectFile {
  id?: number | string;
  columnWidths?: Record<string, number>;
}

// Sort configuration for table requests
export interface SortOption {
  [key: string]: 1 | -1; // MongoDB-style sort: 1 for ascending, -1 for descending
}

export interface SortedRequestOptions {
  id: number | string;
  sort: SortOption;
  limit: number;
  skip: number;
  db: string;
  requestId?: string;
}

export interface GetAllDataRequest {
  id: number | string | undefined;
  db: string;
  fields: Record<string, number>;
}

// Socket response types
export interface SortedUrlsResponse {
  data?: any[];
  total?: number;
}

// URL data structure based on the default columns
export interface UrlData {
  _id?: string;
  url: string;
  referrer?: string;
  depth?: number;
  code?: number;
  location?: string;
  contentType?: string;
  protocol?: string;
  actualDataSize?: number;
  requestTime?: number;
  requestLatency?: number;
  downloadTime?: number;
  status?: string;
  date?: string;
  error_type?: string;
  error_message?: string;
  created_at?: string;
  // Dynamic parser fields
  [key: string]: any;
}

// Project management payloads
export interface ProjectStatsSync {
  success: boolean;
  projectId?: number | string;
  stats?: Partial<Stats>;
  error?: string;
}

export interface CrawlerStatus {
  message: string;
  freezed?: boolean;
}

export interface StatUpdate {
  [key: string]: number;
}

export interface QueueUpdate {
  fetched?: number;
  queue?: number;
  projectId?: number | string;
}

export interface TableUpdate {
  projectId: number | string;
  tableName: string;
}

// ===== Domain models for keywords/categories/typing =====

export interface Category {
  id?: number | string;
  name: string;
  [key: string]: any;
}

export interface Keyword {
  id?: number | string;
  keyword: string;
  [key: string]: any;
}

export interface Sample {
  id?: number | string;
  label: string;
  text: string;
  [key: string]: any;
}

// ===== Socket payloads for categories =====

export interface CategoriesListResponse {
  projectId: number | string;
  categories: Category[];
  totalCount: number;
  skip: number;
  hasMore: boolean;
}

export interface CategoriesProgressPayload {
  projectId: number | string;
  progress: number; // 0..100
  processed: number;
  total: number;
}

export interface CategoriesAddedPayload {
  projectId: number | string;
  added: number;
}

export interface SimpleProjectPayload {
  projectId: number | string;
  [key: string]: any;
}

export interface ErrorPayload {
  message: string;
  projectId?: number | string;
  [key: string]: any;
}

// ===== Socket payloads for keywords =====

export interface KeywordsListResponse {
  projectId: number | string;
  keywords: Keyword[];
  totalCount: number;
  skip: number;
  hasMore: boolean;
  searchQuery?: string;
  timeoutId?: number;
  promiseResolve?: () => void;
}

export type KeywordsLoadedMoreResponse = KeywordsListResponse;

export interface KeywordUpdatedPayload {
  projectId: number | string;
  keyword: Keyword;
}

export interface KeywordsProgressPayload {
  projectId: number | string;
  progress: number; // 0..100
  processed?: number;
  total?: number;
}

export interface PercentageProgressPayload {
  projectId: number | string;
  percentage?: number; // 0..100
}

// ===== Socket payloads for typing samples =====

export interface TypingSamplesListResponse {
  projectId?: number | string;
  samples: Sample[];
  total?: number;
}

// Project stats data structure returned by `get-project-stats`
export interface ProjectStatsData {
  totalUrls: number;
  statusCounts: Record<string, number>;
  dailyStats: Record<string, number>;
  lastUpdated: string;
}

// Keywords export response (full keyword objects for export)
export interface KeywordsExportResponse {
  projectId: number | string;
  keywords: Keyword[];
}

// ===== Shared options (centralized) =====

export interface LoadCategoriesOptions {
  skip?: number;
  limit?: number;
  sort?: Record<string, number>;
}

export interface LoadKeywordsOptions {
  skip?: number;
  limit?: number;
  sort?: Record<string, number>;
  resetSearch?: boolean;
}

export interface LoadSamplesOptions {
  skip?: number;
  limit?: number;
}

export interface Stopword {
  id: number;
  project_id: number;
  word: string;
  created_at: string;
}

