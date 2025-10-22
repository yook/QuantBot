import * as xlsx from "xlsx";
import socket from "./socket-client";
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

  return new Promise<void>((resolve, reject) => {
    try {
      const fields: Record<string, number> = {};
      header.forEach((element: string) => {
        if (element !== "_rowNumber") {
          fields[element] = 1;
        }
      });

      const requestData = {
        id: projectId,
        db: currentDb,
        fields: fields,
      };

      socket.emit("get-all-data", requestData);

        socket.once("urls-all-data", (data: any[]) => {
        if (!data || !Array.isArray(data) || data.length === 0) {
          reject(new Error("No data received for export"));
          return;
        }

        const filterCol = allColumns.filter((item: ColumnDef) => {
          return header.includes(item.prop);
        });

        const headerData: Record<string, string> = {};
        filterCol.forEach((item: ColumnDef) => {
          headerData[item.prop] = item.name;
        });

        const book = xlsx.utils.book_new();

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

        const wd = xlsx.utils.json_to_sheet(newArr, {
          header: header,
          skipHeader: true,
        });
        xlsx.utils.book_append_sheet(book, wd, currentDb);

        const fileName = `${currentDb}-report.xlsx`;
        xlsx.writeFile(book, fileName);

        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
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

  // Request all keywords from backend with full fields
  socket.emit("keywords:export", { projectId: project.currentProjectId });

  socket.once("keywords:export-data", (data: any) => {
    if (!data || !data.keywords || data.keywords.length === 0) {
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
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(exportData);
    xlsx.utils.book_append_sheet(wb, ws, "Keywords");

    // Save file
    const date = new Date().toISOString().split("T")[0];
    const projectName = project.data?.name || "keywords";
    const filename = `${projectName}-keywords-${date}.xlsx`;

    // Use SheetJS writeFile to trigger download (browser) / write file (electron)
    xlsx.writeFile(wb, filename);
  });
}

