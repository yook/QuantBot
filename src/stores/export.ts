import { ipcClient } from "./socket-client";
import { useProjectStore } from "./project";
import type {
  ExportColumnOption,
  ExportFormat,
  ExportScope,
  ExportUrlsRequest,
} from "../types/schema";

export interface ExportCrawlerDataOptions {
  projectId?: number | string;
  projectName?: string;
  db?: string;
  sort?: ExportUrlsRequest["sort"];
  filters?: ExportUrlsRequest["filters"];
  columns?: ExportColumnOption[];
  format?: ExportFormat;
  scope?: ExportScope;
  rows?: Record<string, any>[];
}

export async function exportCrawlerData(options: ExportCrawlerDataOptions = {}) {
  const project = useProjectStore();

  const projectId = options.projectId || project.data.id;
  if (!projectId) {
    throw new Error("Invalid projectId");
  }

  const scope = options.scope || "filtered";
  const format = options.format || "xlsx";
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const hasCurrentRows = scope === "current" && rows.length > 0;
  const hasFilteredRows =
    scope === "filtered" &&
    ((typeof project.tableTotalCount === "number" && project.tableTotalCount > 0) ||
      (typeof project.tableDataLength === "number" && project.tableDataLength > 0) ||
      (Array.isArray(project.tableData) && project.tableData.length > 0));

  if (!hasCurrentRows && !hasFilteredRows) {
    return false;
  }

  const result = await ipcClient.exportUrls({
    projectId,
    projectName: options.projectName || project.currentProjectName || project.data.name || "",
    db: options.db || project.getActiveTableDb(),
    sort: options.sort || project.sort,
    filters: Array.isArray(options.filters) ? options.filters : project.currentTableFilters,
    columns: Array.isArray(options.columns) ? options.columns : [],
    format,
    scope,
    rows,
  });

  return result;
}
