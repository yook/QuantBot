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
