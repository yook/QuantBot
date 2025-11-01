import * as XLSX from "xlsx";
import ipcClient from "./socket-client";
import { toRaw } from "vue";
import { useProjectStore } from "./project";
import moment from "moment";
import type { ColumnDef } from "../types/schema";

export function formatSimilarity(val: any) {
  if (val === null || typeof val === "undefined" || val === "") return "";
  const num = Number(val);
  if (Number.isNaN(num)) return val;
  const v = num <= 1 ? num * 100 : num;
  return `${v.toFixed(2)}%`;
}

export interface ExportRequest {
  projectId: number | string | undefined;
  currentDb: string;
  header: string[];
  allColumns: ColumnDef[];
}

export async function downloadDataFromProject(req: ExportRequest) {
  const { projectId, currentDb, header, allColumns } = req;

  // Fetch full dataset via IPC based on currentDb
  const pid = projectId ? Number(projectId) : undefined;
  if (!pid) throw new Error("Invalid projectId");

  let data: any[] = [];
  if (currentDb === "urls") {
    data = (await ipcClient.getUrlsAll(pid)) || [];
  } else if (currentDb === "keywords") {
    data = (await ipcClient.getKeywordsAll(pid)) || [];
  } else {
    // Fallback: try urls
    data = (await ipcClient.getUrlsAll(pid)) || [];
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No data received for export");
  }

  const filterCol = allColumns.filter((item: ColumnDef) => header.includes(item.prop));

  const headerData: Record<string, string> = {};
  filterCol.forEach((item: ColumnDef) => {
    headerData[item.prop] = item.name;
  });

  const book = XLSX.utils.book_new();

  const arr = data.slice();

  const newArr = arr
    .map((el: Record<string, any>) => {
      if (el.date) {
        el.date = moment(el.date).format("YYYY-MM-DD HH:mm:ss");
      }
      return el;
    })
    .map((el: Record<string, any>) => {
      const obj: Record<string, any> = {};
      header.forEach((item: string) => {
        obj[item] = el[item];
      });
      return obj;
    });

  newArr.unshift(headerData);

  const wd = XLSX.utils.json_to_sheet(newArr, {
    header: header,
    skipHeader: true,
  });
  XLSX.utils.book_append_sheet(book, wd, currentDb);

  const fileName = `${currentDb}-report.xlsx`;
  XLSX.writeFile(book, fileName);
  console.log('[Export] Saved file:', fileName);
}

// Convenience wrapper: export current DB table using project store state
/**
 * Canonical export API for crawler table data.
 *
 * Use exportCrawlerData() to trigger exporting the currently selected
 * crawler table from the active project. The function checks that there
 * is data to export before requesting all rows from the backend.
 */
export async function exportCrawlerData(): Promise<boolean> {
  const project = useProjectStore();

  const hasData = (typeof project.tableDataLength === "number" && project.tableDataLength > 0)
    || (Array.isArray(project.tableData) && project.tableData.length > 0);

  if (!hasData) {
    // Nothing to export — return false so caller can show UI feedback
    return false;
  }

  const header = (project.data.columns && project.data.columns[project.currentDb])
    ? project.data.columns[project.currentDb]
    : [];
  try {
    await downloadDataFromProject({
      projectId: project.data.id as number | string | undefined,
      currentDb: project.currentDb,
      header,
      allColumns: project.allColumns,
    });
    console.log("Export finished successfully");
    return true;
  } catch (err: any) {
    console.error("Export failed:", err);
    alert(
      "Ошибка при экспорте: " + (err && err.message ? err.message : String(err))
    );
    return false;
  }
}

export function downloadKeywords(exportColumns: any[]) {
  const project = useProjectStore();

  if (!project.currentProjectId) {
    console.error("No project selected");
    return;
  }

  (async () => {
    const pid = project.currentProjectId ? Number(project.currentProjectId) : undefined;
    if (!pid) {
      console.warn("Invalid project id");
      return;
    }
    const keywordsData = await ipcClient.getKeywordsAll(pid);
    const data = { keywords: keywordsData || [] } as any;
    if (!data.keywords || data.keywords.length === 0) {
      console.warn("No keywords data received");
      return;
    }

    const incomingCols = Array.isArray(exportColumns) ? toRaw(exportColumns) : [];

    // Expand logical combined columns into concrete export columns
    const cols: any[] = [];
    incomingCols.forEach((c: any) => {
      // Skip internal/action columns from export
      if (!c || c.prop === "_actions") return;

      if (c.prop === "category_info") {
        cols.push({ prop: "category_name", name: "Категория", width: 240 });
        cols.push({
          prop: "category_similarity",
          name: "Достоверность категории",
          width: 140,
        });
      } else if (c.prop === "class_info") {
        cols.push({ prop: "class_name", name: "Тип", width: 240 });
        cols.push({
          prop: "class_similarity",
          name: "Достоверность типа",
          width: 160,
        });
      } else {
        cols.push(c);
      }
    });

    // Prepare header order and keys
    const headers = cols.map((c) => ({ key: c.prop, title: c.name || c.prop }));

    // If no headers provided, fallback to defaults
    if (headers.length === 0) {
      headers.push({ key: "id", title: "ID" });
      headers.push({ key: "keyword", title: "Keyword" });
      headers.push({ key: "created_at", title: "Created" });
    }

    // Prepare data for export according to specified columns
    const exportData = data.keywords.map((item: any) => {
      const row: Record<string, any> = {};
      headers.forEach((h) => {
        const key = h.key;
        let val = item[key];
        if (key === "created_at") {
          val = val ? new Date(val).toLocaleString() : "";
        }
        if (key === "category_similarity" || key === "class_similarity") {
          val = formatSimilarity(val);
        }
        row[h.title] = val;
      });
      return row;
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, "Keywords");

    // Save file
    const date = new Date().toISOString().split("T")[0];
    const projectName = project.data?.name || "keywords";
    const filename = `${projectName}-keywords-${date}.xlsx`;

    // Use SheetJS writeFile to trigger download (browser) / write file (electron)
    XLSX.writeFile(wb, filename);
    console.log('[Export] Saved keywords file:', filename);
  })().catch((e) => console.error('[Export] keywords export error:', e));
}

