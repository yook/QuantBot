import { defineStore } from "pinia";
import { ipcClient } from "./socket-client";
import { getCrawlerClient, onCrawlerStarted } from "../crawler";
import settingsJson from "./schema/table-name-prop.json";
import reportsJson from "./schema/table-reports.json";
import newProjectJson from "./schema/new-project.json";
import activeColumnsJson from "./schema/table-active-colums.json";
import { reloadFirstPage } from "./table-data-service";
import { clampCrawlerConfigForPlan } from "../utils/plan-limit-normalizers";
import { ElMessage, ElMessageBox } from "element-plus";
// import { useAppStore } from './app'
// import { ipcRenderer } from 'electron'

// You can name the return value of `defineStore()` anything you want,
// but it's best to use the name of the store and surround it with `use`
// and `Store` (e.g. `useUserStore`, `useCartStore`, `useProductStore`)
// the first argument is a unique id of the store across your application
// Import shared types
import type {
  Stats,
  ColumnDef,
  ProjectSummary,
  ProjectData,
  SortedRequestOptions,
  ReportsFile,
  SettingsFile,
  NewProjectFile,
  UrlData,
  SortOption,
  TableFilterOption,
} from "../types/schema";

const CURRENT_PROJECT_STORAGE_KEY = "currentProjectId";

function readStoredProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

function persistProjectId(id: string | number | null | undefined) {
  try {
    if (id == null || String(id).trim() === "") {
      localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, String(id));
  } catch (_) {}
}

function getAvailableColumnProps(defaultColumns: ColumnDef[], parserColumns: any[]) {
  const availableProps = new Set<string>();

  for (const column of defaultColumns || []) {
    if (column?.prop) {
      availableProps.add(String(column.prop));
    }
  }

  for (const column of parserColumns || []) {
    if (column?.prop) {
      availableProps.add(String(column.prop));
    }
  }

  return availableProps;
}

function sanitizeProjectColumnState(data: any, defaultColumns: ColumnDef[]) {
  if (!data || typeof data !== "object") {
    return;
  }

  const availableProps = getAvailableColumnProps(
    defaultColumns,
    Array.isArray(data.parser) ? data.parser : [],
  );

  if (data.columns && typeof data.columns === "object") {
    for (const dbKey of Object.keys(data.columns)) {
      const columns = data.columns[dbKey];

      if (!Array.isArray(columns)) {
        delete data.columns[dbKey];
        continue;
      }

      data.columns[dbKey] = columns.filter(
        (prop: unknown) => typeof prop === "string" && availableProps.has(prop),
      );
    }
  }

  if (data.columnWidths && typeof data.columnWidths === "object") {
    for (const dbKey of Object.keys(data.columnWidths)) {
      const widths = data.columnWidths[dbKey];

      if (!widths || typeof widths !== "object") {
        delete data.columnWidths[dbKey];
        continue;
      }

      for (const prop of Object.keys(widths)) {
        if (!availableProps.has(prop)) {
          delete widths[prop];
        }
      }
    }
  }

  try {
    const projectId = data.id ? String(data.id) : "";

    if (projectId && typeof localStorage !== "undefined" && data.columns) {
      for (const dbKey of Object.keys(data.columns)) {
        localStorage.setItem(
          `table-columns-${projectId}-${dbKey}`,
          JSON.stringify(data.columns[dbKey] || []),
        );
      }
    }
  } catch (_error) {}
}

function mergeParserContentIntoRow<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== "object") {
    return row;
  }

  const out: Record<string, any> = { ...row };
  if (typeof out.content !== "string" || out.content.length === 0) {
    return out as T;
  }

  try {
    const parsed = JSON.parse(out.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return out as T;
    }

    for (const k of Object.keys(parsed)) {
      if (typeof out[k] === "undefined") {
        out[k] = (parsed as Record<string, unknown>)[k];
      }
    }
  } catch (_e) {
    // Keep original row when `content` is not a valid JSON object.
  }

  return out as T;
}

const NUMERIC_FILTER_FIELDS = new Set([
  "id",
  "project_id",
  "depth",
  "code",
  "actualDataSize",
  "requestTime",
  "requestLatency",
  "downloadTime",
]);

function normalizeFilterNumber(value: unknown): number {
  return Number(String(value ?? "").trim().replace(",", "."));
}

function rowMatchesTableFilters(row: Record<string, any>, filters: TableFilterOption[]): boolean {
  if (!Array.isArray(filters) || filters.length === 0) return true;

  return filters.every((filter) => {
    const field = String(filter?.field || "");
    const operator = String(filter?.operator || "");
    if (!field || !operator) return true;

    const rawRowValue = row?.[field];
    const rawFilterValue = filter.value;

    if (NUMERIC_FILTER_FIELDS.has(field) || ["gt", "gte", "lt", "lte", "between"].includes(operator)) {
      const rowValue = normalizeFilterNumber(rawRowValue);
      const value = normalizeFilterNumber(rawFilterValue);
      if (!Number.isFinite(rowValue) || !Number.isFinite(value)) return false;

      if (operator === "eq") return rowValue === value;
      if (operator === "neq") return rowValue !== value;
      if (operator === "gt") return rowValue > value;
      if (operator === "gte") return rowValue >= value;
      if (operator === "lt") return rowValue < value;
      if (operator === "lte") return rowValue <= value;
      if (operator === "between") {
        const secondValue = normalizeFilterNumber(filter.secondValue);
        if (!Number.isFinite(secondValue)) return false;
        return rowValue >= Math.min(value, secondValue) && rowValue <= Math.max(value, secondValue);
      }
    }

    const rowValue = String(rawRowValue ?? "").toLowerCase();
    const value = String(rawFilterValue ?? "").toLowerCase();
    if (!value && operator !== "neq") return false;

    if (operator === "contains") return rowValue.includes(value);
    if (operator === "eq") return rowValue === value;
    if (operator === "neq") return rowValue !== value;
    if (operator === "startsWith") return rowValue.startsWith(value);
    if (operator === "endsWith") return rowValue.endsWith(value);
    return true;
  });
}

export const useProjectStore = defineStore("project", {
  state: () => ({
    data: {
      ...(newProjectJson as NewProjectFile),
      columnWidths: {},
    } as ProjectData,
    projects: [] as ProjectSummary[],
    projectsLoaded: false,
    currentDb: "urls",
    type: "all",
    currentProjectId: null as string | null,
    newProjectForm: false,
    crawlerConfigDialog: false,
    settingsTab: "general",
    running: false,
    crawlerRunningProjects: {} as Record<string, boolean>,
    parserRunningProjects: {} as Record<string, boolean>,
    crawlerStoppingProjects: {} as Record<string, boolean>,
    parserStoppingProjects: {} as Record<string, boolean>,
    defaultColumns: (settingsJson as SettingsFile).settings,
    tableReports: (reportsJson as ReportsFile).reports,
    currentPage: 1,
    activePage: "1",
    tableData: [] as UrlData[],
    tableDataLength: 0,
    tableTotalCount: 0,
    tableWindowStart: 0,
    tableRevision: 0,
    currentTableFilters: [] as TableFilterOption[],
    sort: { id: 1 } as SortOption,
    tableLoading: true,
    start: false,
    currentUrl: "",
    fetched: 0,
    queue: 0,
    socketReady: false,
    tableUpdateTimeout: null as NodeJS.Timeout | null,
    // Track running state separately for crawler and parser per project
    crawlerStoppingSnapshot: {} as Record<string, { fetched?: number; queue?: number; disallow?: number }>,
    crawlerJustRestarted: {} as Record<string, boolean>,
    // Live stats for projects that may be running but are not currently selected
    liveStats: {} as Record<string, { fetched?: number; queue?: number }>,
    lastFinishedAt: {} as Record<string, string>,
    crawlerProgressByProject: {} as Record<string, { fetched: number; queue: number }>,
    parserProgressByProject: {} as Record<string, { fetched: number; queue: number }>,
    lastCrawlerFinishedAt: {} as Record<string, string>,
    lastParserFinishedAt: {} as Record<string, string>,
  }),

  getters: {
    currentTableProfile: (state) => (state.activePage === "3" ? "parser" : state.currentDb),
    isCrawlerRunning: (state) => !!state.crawlerRunningProjects[String(state.currentProjectId || '')],
    isParserRunning: (state) => !!state.parserRunningProjects[String(state.currentProjectId || '')],
    isCrawlerBusy: (state) => !!state.crawlerRunningProjects[String(state.currentProjectId || '')] || !!state.crawlerStoppingProjects[String(state.currentProjectId || '')],
    isParserBusy: (state) => !!state.parserRunningProjects[String(state.currentProjectId || '')] || !!state.parserStoppingProjects[String(state.currentProjectId || '')],
    isAnyWorkerBusy: (state) => !!state.crawlerRunningProjects[String(state.currentProjectId || '')] || !!state.parserRunningProjects[String(state.currentProjectId || '')] || !!state.crawlerStoppingProjects[String(state.currentProjectId || '')] || !!state.parserStoppingProjects[String(state.currentProjectId || '')],
    currentProjectName: (state) => {
      if (state.currentProjectId && state.projects.length > 0) {
        const p = state.projects.find((x) => String(x.id) === String(state.currentProjectId));
        return p ? p.name : "";
      }
      return "";
    },
    percentage: (state) => {
      if (!state.data.stats) return 0;
      const fetched = state.data.stats.fetched ?? 0;
      const queue = state.data.stats.queue ?? 0;
      const total = fetched + queue;
      return total > 0 ? Math.round((fetched / total) * 100) : 0;
    },
    crawlerPercentage: (state) => {
      const pid = String(state.currentProjectId || '');
      const p = state.crawlerProgressByProject[pid] || { fetched: 0, queue: 0 };
      const total = Number(p.fetched || 0) + Number(p.queue || 0);
      return total > 0 ? Math.round((Number(p.fetched || 0) / total) * 100) : 0;
    },
    parserPercentage: (state) => {
      const pid = String(state.currentProjectId || '');
      const p = state.parserProgressByProject[pid] || { fetched: 0, queue: 0 };
      const total = Number(p.fetched || 0) + Number(p.queue || 0);
      return total > 0 ? Math.round((Number(p.fetched || 0) / total) * 100) : 0;
    },
    tableColumns: (state) => {
      // Normalize defaults and parser columns, deduplicate by `prop`, and ensure `name`
      const seen = new Set<string>();
      const normalize = (cols: any[]): ColumnDef[] => {
        if (!Array.isArray(cols)) return [] as ColumnDef[];
        const out: ColumnDef[] = [];
        for (const c of cols) {
          if (!c || typeof c !== "object") continue;
          const prop = (c as any).prop;
          if (!prop || typeof prop !== "string") continue;
          if (seen.has(prop)) continue;
          const name = (c as any).name && String((c as any).name).trim() ? String((c as any).name) : prop;
          out.push({ ...(c as any), name, prop } as ColumnDef);
          seen.add(prop);
        }
        return out;
      };

      const tableProfile = state.activePage === "3" ? "parser" : state.currentDb;
      const defaults = normalize(state.defaultColumns ?? []);
      const parserCols = normalize(state.data.parser ?? []);
      const all: ColumnDef[] = [...defaults, ...parserCols];

      // Determine enabled columns: prefer per-DB config; fallback to static defaults; else all props
      let enabledColumns: string[] =
        (state.data.columns && state.data.columns[tableProfile]) || [];
      if (!enabledColumns || enabledColumns.length === 0) {
        const fromStatic = (activeColumnsJson as any)?.[tableProfile];
        if ((!enabledColumns || enabledColumns.length === 0) && tableProfile === "parser") {
          enabledColumns = parserCols.map((c) => c.prop);
        } else if (Array.isArray(fromStatic) && fromStatic.length > 0) {
          enabledColumns = fromStatic as string[];
        } else {
          enabledColumns = all.map((c) => c.prop);
        }
      }

      // Build the resulting columns respecting the explicit enabledColumns order
      let enabledList = Array.isArray(enabledColumns) ? [...enabledColumns] : [];
      if (tableProfile === "parser") {
        enabledList = ["url", ...enabledList.filter((p) => String(p) !== "url")];
      }
      // Keep parser-derived fields visible in crawler(html) and parser tables,
      // even when an older saved column set does not contain newly added parser props.
      if (
        tableProfile === "urls" ||
        tableProfile === "html"
      ) {
        for (const c of parserCols) {
          if (c?.prop && !enabledList.includes(c.prop)) {
            enabledList.push(c.prop);
          }
        }
      }
      const resultOrdered: ColumnDef[] = [];

      for (const prop of enabledList) {
        const found = all.find((c) => c.prop === prop);
        if (found) {
          resultOrdered.push(found);
        }
      }

      // Ensure uniqueness while preserving order
      const seenProps = new Set<string>();
      const uniqueOrdered = resultOrdered.filter((c) => {
        if (!c || !c.prop) return false;
        if (seenProps.has(c.prop)) return false;
        seenProps.add(c.prop);
        return true;
      });

      const rowNumberColumn: ColumnDef = { name: "#", prop: "_rowNumber", width: 60, minWidth: 60 } as any;
      // Prefer url first if present in the ordered list
      const urlIndex = uniqueOrdered.findIndex((c) => c.prop === 'url');
      if (urlIndex === -1) return [rowNumberColumn, ...uniqueOrdered];

      const urlCol = uniqueOrdered[urlIndex];
      const others = uniqueOrdered.filter((_, idx) => idx !== urlIndex);
      return [rowNumberColumn, urlCol, ...others];
    },
    allColumns: (state) => {
      // Normalize and deduplicate by prop; ensure name labels exist
      const seen = new Set<string>();
      const out: ColumnDef[] = [];
      const pushCols = (cols: any[]) => {
        if (!Array.isArray(cols)) return;
        for (const c of cols) {
          if (!c || typeof c !== "object") continue;
          const prop = (c as any).prop;
          if (!prop || typeof prop !== "string") continue;
          if (seen.has(prop)) continue;
          const name = (c as any).name && String((c as any).name).trim() ? String((c as any).name) : prop;
          out.push({ ...(c as any), name, prop, disabled: prop === "url" } as ColumnDef);
          seen.add(prop);
        }
      };
      pushCols(state.defaultColumns ?? []);
      pushCols(state.data.parser ?? []);
      return out;
    },
    success: (state) => {
      if (!state.data.stats) return 0;
      return (state.data.stats.html ?? 0) + (state.data.stats.jscss ?? 0) + (state.data.stats.image ?? 0);
    },
    totalRecords: (state) => {
      if (!state.data.stats) return 0;
      let total = 0;
      for (const k of Object.keys(state.data.stats) as (keyof Stats)[]) {
        const v = state.data.stats[k];
        if (typeof v === "number" && k !== "fetched" && k !== "queue") total += v;
      }
      return total;
    },
    projectsList: (state) => state.projects.map((p) => ({ label: p.name, value: String(p.id) })),
  },

  actions: {
    bumpTableRevision() {
      this.tableRevision = (Number(this.tableRevision || 0) + 1) % 1000000000;
    },

    getActiveTableDb() {
      return this.activePage === '3' ? 'parser' : this.currentDb;
    },

    syncCurrentProjectRunningState() {
      this.running = !!this.isAnyWorkerBusy;
    },

    getProcessConflictMessage(process: 'crawler' | 'parser') {
      return process === 'crawler'
        ? 'Нельзя запустить краулинг во время парсинга'
        : 'Нельзя запустить парсинг во время краулинга';
    },

    async getProjects() {
      console.log('[Project Store] getProjects called');
      const data = await ipcClient.getProjectsAll();
      console.log('[Project Store] Projects loaded:', data);
      if (Array.isArray(data)) this.projects = data;
      this.projectsLoaded = true;
      const storageId = readStoredProjectId();
      console.log('[Project Store] Stored project ID from localStorage:', storageId);
      if (this.projects.length > 0) {
        const idx = this.projects.findIndex((p) => String(p.id) === String(storageId));
        this.currentProjectId = idx >= 0 ? String(storageId) : String(this.projects[0].id);
        console.log('[Project Store] Selected project ID:', this.currentProjectId, idx >= 0 ? '(restored)' : '(fallback to first)');
        persistProjectId(this.currentProjectId);
        const projectData = await ipcClient.getProject(Number(this.currentProjectId));
        if (projectData) {
          Object.assign(this.data, projectData);
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          if (!this.data.columns) this.data.columns = {};
          // Ensure parser is an array to avoid Element Plus table errors (data.reduce)
          if (!Array.isArray((this.data as any).parser)) {
            (this.data as any).parser = (newProjectJson as NewProjectFile).parser || [];
          }
          // Ensure crawler config exists
          if (!this.data.crawler || typeof this.data.crawler !== 'object') {
            this.data.crawler = (newProjectJson as NewProjectFile).crawler;
          }
          this.data.crawler = clampCrawlerConfigForPlan(this.data.crawler);
          sanitizeProjectColumnState(this.data, this.defaultColumns);
          reloadFirstPage({
            projectStore: this,
            projectId: this.data.id as number | string,
            sort: this.sort,
            db: this.getActiveTableDb(),
            limit: 50,
          });
        }
      } else {
        this.newProjectForm = true;
      }
    },

    async refreshProjectsList() {
      const data = await ipcClient.getProjectsAll();
      if (Array.isArray(data)) this.projects = data;
      this.projectsLoaded = true;
    },

    socketOn() {
      if ((window as any).__socketListenersRegistered) return;
      (window as any).__socketListenersRegistered = true;
      this.socketReady = true;
      this.getProjects();

      // Note: Event listeners for crawler updates will need to be implemented
      // via IPC events when crawler functionality is added
      // TODO: Implement crawler events via IPC
      // - crawler-data-cleared
      // - queue, fetched, stopped
      // - data-updated
      // - stat-html, stat-jscss, stat-image, stat-redirect, stat-error
      // - stat-depth3, stat-depth5, stat-depth6, stat-other
      // - disallow
      // - projectDeleted, projectDeleteError
    },

    async updateProject() {
      try {
        const ipc: any = (ipcClient as any).ipc;
        if (!ipc) {
          console.warn('[Project Store] ipcRenderer not available');
          return;
        }
        const id = Number(this.data.id);
        if (!id || Number.isNaN(id)) {
          console.warn('[Project Store] updateProject: invalid project id', this.data && (this.data as any).id);
          return;
        }
        sanitizeProjectColumnState(this.data, this.defaultColumns);
        this.data.crawler = clampCrawlerConfigForPlan(this.data.crawler);
        // Persist basic project fields (name/url) as well
        try {
          await ipcClient.updateProject(this.data.name || '', this.data.url || '', id);
        } catch (e: any) {
          console.warn('[Project Store] update name/url failed:', e?.message || e);
        }
        // Convert reactive objects to plain JSON to avoid "An object could not be cloned"
        const crawler = JSON.parse(JSON.stringify(this.data.crawler || {}));
        const parser = JSON.parse(
          JSON.stringify(Array.isArray((this.data as any).parser) ? (this.data as any).parser : [])
        );
        const columns = JSON.parse(JSON.stringify(this.data.columns || {}));
        const stats = JSON.parse(JSON.stringify(this.data.stats || {}));
        const freezed = !!this.data.freezed;
        const res = await ipc.invoke('db:projects:updateConfigs', id, crawler, parser, columns, stats, freezed);
        if (!res || !res.success) {
          console.warn('[Project Store] updateConfigs failed', res?.error);
        }
      } catch (e: any) {
        console.error('[Project Store] updateProject error:', e?.message || e);
      }
    },

    async saveNewProject(form: { name: string; url: string }) {
      console.log('[Project Store] saveNewProject called:', form);
      const data: ProjectData = { ...(newProjectJson as NewProjectFile) } as ProjectData;
      data.name = form.name;
      data.url = form.url;
      console.log('[Project Store] Insert payload:', { name: data.name, url: data.url });
      
      console.log('[Project Store] Inserting project:', data.name, data.url);
      const result = await ipcClient.insertProject(data.name, data.url || '');
      console.log('[Project Store] Insert result:', result);
      
      if (result && result.success && result.data?.lastInsertRowid) {
        this.currentProjectId = String(result.data.lastInsertRowid);
        this.currentTableFilters = [];
        persistProjectId(result.data.lastInsertRowid);
        this.newProjectForm = false;
        await this.refreshProjectsList();
        const projectData = await ipcClient.getProject(Number(result.data.lastInsertRowid));
        if (projectData) {
          Object.assign(this.data, projectData);
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          if (!this.data.columns) this.data.columns = {};
          await reloadFirstPage({
            projectStore: this,
            projectId: this.data.id as number | string,
            sort: this.sort,
            db: this.getActiveTableDb(),
            limit: 50,
          });
        }
      } else {
        console.error('[Project Store] Failed to insert project, result:', result);
        if (result?.code === 'FREE_PROJECTS_LIMIT') {
          const proUrl = (import.meta.env && import.meta.env.VITE_PRO_URL) || 'https://example.com/pro';
          ElMessageBox({
            title: 'Лимит бесплатной версии',
            message: `
              <div style="text-align:left;">В бесплатной версии можно создать до 3 проектов. В Pro-версии нет ограничений по количеству проектов.</div>
              <div style="margin-top:14px; display:flex; justify-content:center;">
                <a href="${proUrl}" target="_blank" rel="noopener noreferrer"
                   style="display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 16px;border-radius:8px;background:var(--el-color-primary);color:#fff;text-decoration:none;font-weight:500;">
                  Перейти на Pro
                </a>
              </div>
            `,
            dangerouslyUseHTMLString: true,
            showConfirmButton: false,
            showClose: true,
            closeOnClickModal: true,
            closeOnPressEscape: true,
          }).catch(() => {});
        } else if (result?.error) {
          ElMessage.warning(String(result.error));
        }
      }
    },

    async changeProject(id: string) {
      this.tableData = [];
      this.tableDataLength = 0;
      this.tableTotalCount = 0;
      this.tableWindowStart = 0;
      this.bumpTableRevision();
      this.currentTableFilters = [];
      this.tableLoading = true;
      persistProjectId(id);
      console.log('[Project Store] Changed to project ID:', id);
      this.currentProjectId = id;

      const projectData = await ipcClient.getProject(Number(id));
      if (projectData) {
        Object.assign(this.data, projectData);
        
        // Ensure stats exists
        if (!this.data.stats) {
          this.data.stats = (newProjectJson as NewProjectFile).stats;
        }
        
        // Ensure columns exists
        if (!this.data.columns) {
          this.data.columns = {};
        }
        
        // Deep merge crawler config with defaults (preserve loaded values, add missing defaults)
        if (!this.data.crawler || typeof this.data.crawler !== 'object') {
          this.data.crawler = (newProjectJson as NewProjectFile).crawler;
        } else {
          this.data.crawler = { 
            ...(newProjectJson as NewProjectFile).crawler, 
            ...this.data.crawler 
          };
        }
        this.data.crawler = clampCrawlerConfigForPlan(this.data.crawler);
        
        // Ensure parser is an array with defaults if empty
        if (!Array.isArray((this.data as any).parser) || (this.data as any).parser.length === 0) {
          (this.data as any).parser = (newProjectJson as NewProjectFile).parser || [];
        }
        sanitizeProjectColumnState(this.data, this.defaultColumns);
        
        // Ensure we show the main `urls` table by default when switching projects
        // (prevents empty views when user had another DB selected previously)
        this.currentDb = 'urls';
      // If we have live stats for this project (it's running elsewhere), merge them into loaded data
      const live = this.liveStats[String(this.data.id)];
      if (live) {
        if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
        try {
          (this.data.stats as any).fetched = typeof live.fetched === 'number' ? live.fetched : (this.data.stats as any).fetched;
          (this.data.stats as any).queue = typeof live.queue === 'number' ? live.queue : (this.data.stats as any).queue;
        } catch (_) {}
      }
        // Load initial window and await completion so UI shows rows immediately
        await reloadFirstPage({
          projectStore: this,
          projectId: this.data.id as number | string,
          sort: this.sort,
          db: this.getActiveTableDb(),
          limit: 50,
        });
        await this.refreshCrawlerStatsFromDb(Number(this.data.id));
      }
      this.tableLoading = false;
    // Reflect running status for selected project
    this.syncCurrentProjectRunningState();
    },

    async refreshCrawlerStatsFromDb(projectId?: number) {
      try {
        const pid = Number(projectId || this.data?.id || 0);
        if (!pid || Number.isNaN(pid)) return;
        const dbStats = await ipcClient.getCrawlerStats(pid);
        if (!dbStats || typeof dbStats !== 'object') return;
        if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
        const prevQueue = Number((this.data.stats as any)?.queue || 0);
        (this.data.stats as any).fetched = Number(dbStats.fetched || 0);
        // Keep runtime queue value if crawl is running/stopping; DB snapshot can't restore in-memory queue
        (this.data.stats as any).queue = this.isCrawlerBusy ? prevQueue : Number(dbStats.queue || 0);
        (this.data.stats as any).disallow = Number(dbStats.disallow || 0);
        (this.data.stats as any).html = Number(dbStats.html || 0);
        (this.data.stats as any).jscss = Number(dbStats.jscss || 0);
        (this.data.stats as any).image = Number(dbStats.image || 0);
        (this.data.stats as any).redirect = Number(dbStats.redirect || 0);
        (this.data.stats as any).error = Number(dbStats.error || 0);
        (this.data.stats as any).depth3 = Number(dbStats.depth3 || 0);
        (this.data.stats as any).depth5 = Number(dbStats.depth5 || 0);
        (this.data.stats as any).depth6 = Number(dbStats.depth6 || 0);
      } catch (e: any) {
        console.warn('[Project Store] refreshCrawlerStatsFromDb failed:', e?.message || e);
      }
    },

    initCrawlerIpcEvents() {
      const ipc: any = (ipcClient as any).ipc;
      if (!ipc || (window as any).__crawlerListenersRegistered) return;
      (window as any).__crawlerListenersRegistered = true;
      const crawlerClient = getCrawlerClient(undefined, ipc);
      try {
        console.log('[Crawler IPC] client mode:', crawlerClient.getMode());
      } catch (_) {}
      
      // Debounced save of stats to DB (avoid saving on every single update)
      let statsSaveTimeout: NodeJS.Timeout | null = null;
      let dbStatsRefreshTimeout: NodeJS.Timeout | null = null;
      let lastProgressAt = 0;
      let progressTimer: NodeJS.Timeout | null = null;
      const resetProgressTimer = () => {
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = setTimeout(() => {
          try {
            console.warn('[Crawler IPC] No progress detected. Queue may be empty or stale.');
          } catch (_) {}
        }, 15000);
      };
      const scheduleStatsSave = () => {
        if (statsSaveTimeout) clearTimeout(statsSaveTimeout);
        statsSaveTimeout = setTimeout(() => {
          this.updateProject().catch((e: any) => {
            console.warn('[Project Store] Auto-save stats failed:', e?.message || e);
          });
        }, 2000); // Save stats 2s after last update
      };
      const scheduleDbStatsRefresh = (projectId?: number | string) => {
        if (dbStatsRefreshTimeout) clearTimeout(dbStatsRefreshTimeout);
        dbStatsRefreshTimeout = setTimeout(() => {
          this.refreshCrawlerStatsFromDb(Number(projectId || this.currentProjectId || this.data?.id || 0)).catch(() => {});
        }, 350);
      };
      
      const updateStat = (field: keyof Stats, value: number) => {
        if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
        (this.data.stats as any)[field] = value;
        scheduleStatsSave();
      };
      crawlerClient.onEvent((event) => {
        if (!event) return;
        if (event.type === 'progress') {
          try {
            console.log('[Crawler IPC] progress', {
              projectId: event.projectId,
              fetched: event.fetched,
              queue: event.queue,
            });
          } catch (_) {}
          lastProgressAt = Date.now();
          resetProgressTimer();
          const pid = String(event.projectId);
          const isParserProcess = !!this.parserRunningProjects[pid] || !!this.parserStoppingProjects[pid];
          if (this.crawlerStoppingProjects[pid] && !this.crawlerRunningProjects[pid]) return;
          const prevFetched = Number(this.data?.stats?.fetched ?? 0);
          const prevQueue = Number(this.data?.stats?.queue ?? 0);
          const hasFetched = typeof event.fetched === 'number';
          const hasQueue = typeof event.queue === 'number';
          const nextFetched = hasFetched ? Number(event.fetched as number) : prevFetched;
          const nextQueue = hasQueue ? Number(event.queue as number) : prevQueue;
          const isResumeWarmup =
            !!this.crawlerJustRestarted[pid] &&
            nextQueue === 0 &&
            prevQueue > 0 &&
            nextFetched <= prevFetched;
          if (pid === String(this.currentProjectId) && isResumeWarmup) {
            return;
          }
          if (pid === String(this.currentProjectId)) {
            if (hasQueue) updateStat('queue', nextQueue);
            const progressBucket = isParserProcess ? this.parserProgressByProject : this.crawlerProgressByProject;
            const prevProgress = progressBucket[pid] || { fetched: 0, queue: 0 };
            progressBucket[pid] = {
              fetched: hasFetched ? nextFetched : Number(prevProgress.fetched || 0),
              queue: hasQueue ? nextQueue : Number(prevProgress.queue || 0),
            };
            if (!isParserProcess && hasFetched) {
              scheduleDbStatsRefresh(pid);
            }
            if (!isParserProcess && this.tableDataLength === 0 && nextFetched > 0) {
              reloadFirstPage({
                projectStore: this,
                projectId: this.data.id as number | string,
                sort: this.sort,
                db: this.getActiveTableDb(),
                limit: 300,
              }).catch(() => {});
            }
            if (this.crawlerJustRestarted[pid] && (nextQueue > 0 || nextFetched > prevFetched)) {
              try { delete this.crawlerJustRestarted[pid]; } catch (_) {}
            }
          } else {
            try {
              const prevLive = this.liveStats[pid] || {};
              this.liveStats[pid] = {
                fetched: hasFetched ? nextFetched : (prevLive.fetched as number | undefined),
                queue: hasQueue ? nextQueue : (prevLive.queue as number | undefined),
              };
            } catch (_) {}
            if (!isParserProcess && hasFetched) {
              scheduleDbStatsRefresh(pid);
            }
          }
        } else if (event.type === 'queue') {
          // Queue updates do not count as progress; keep timer running
          try {
            console.log('[Crawler IPC] queue', {
              projectId: event.projectId,
              queue: event.queue,
              message: (event as any).message,
            });
          } catch (_) {}
          const pid = String(event.projectId);
          const isParserProcess = !!this.parserRunningProjects[pid] || !!this.parserStoppingProjects[pid];
          if (this.crawlerStoppingProjects[pid] && !this.crawlerRunningProjects[pid]) return;
          const hasQueue = typeof event.queue === 'number';
          const nextQueue = hasQueue ? Number(event.queue as number) : Number(this.data?.stats?.queue ?? 0);
          const prevQueue = Number(this.data?.stats?.queue ?? 0);
          const isResumeWarmup = !!this.crawlerJustRestarted[pid] && nextQueue === 0 && prevQueue > 0;
          if (!hasQueue) {
            return;
          }
          if (pid === String(this.currentProjectId) && isResumeWarmup) {
            return;
          }
          if (pid === String(this.currentProjectId)) {
            updateStat('queue', nextQueue);
            const progressBucket = isParserProcess ? this.parserProgressByProject : this.crawlerProgressByProject;
            const prevProgress = progressBucket[pid] || { fetched: 0, queue: 0 };
            progressBucket[pid] = {
              fetched: Number(prevProgress.fetched || 0),
              queue: nextQueue,
            };
            if (this.crawlerJustRestarted[pid] && nextQueue > 0) {
              try { delete this.crawlerJustRestarted[pid]; } catch (_) {}
            }
          } else {
            try {
              this.liveStats[pid] = Object.assign(this.liveStats[pid] || {}, { queue: nextQueue });
            } catch (_) {}
          }
        } else if (event.type === 'finished') {
          const pid = String(event.projectId);
          const isParserProcess = !!this.parserRunningProjects[pid] || !!this.parserStoppingProjects[pid];
          if (isParserProcess) {
            try { this.parserRunningProjects[pid] = false; } catch (_) {}
            try { delete this.parserStoppingProjects[pid]; } catch (_) {}
          } else {
            try { this.crawlerRunningProjects[pid] = false; } catch (_) {}
          }
          if (pid === String(this.currentProjectId)) {
            this.syncCurrentProjectRunningState();
            try {
              this.lastFinishedAt[pid] = new Date().toISOString();
              if (isParserProcess) {
                this.lastParserFinishedAt[pid] = this.lastFinishedAt[pid];
              } else {
                this.lastCrawlerFinishedAt[pid] = this.lastFinishedAt[pid];
              }
              if (this.data.stats) {
                (this.data.stats as any).finishedAt = this.lastFinishedAt[pid];
              }
            } catch (_) {}
            const wasStopping = !isParserProcess && !!this.crawlerStoppingProjects[pid];
            const snapshot = !isParserProcess ? this.crawlerStoppingSnapshot[pid] : undefined;
            const isLateFinish = !isParserProcess && !!this.crawlerJustRestarted[pid];
            if (!isParserProcess) {
              try { delete this.crawlerStoppingProjects[pid]; } catch (_) {}
              try { delete this.crawlerStoppingSnapshot[pid]; } catch (_) {}
              try { delete this.crawlerJustRestarted[pid]; } catch (_) {}
            }
            if (!wasStopping) {
              // Force queue to 0 on finish to avoid stale progress
              // Skip if this is a late finish from previous run after fast restart
              if (!isLateFinish) {
                try {
                  updateStat('queue', 0);
                  const progressBucket = isParserProcess ? this.parserProgressByProject : this.crawlerProgressByProject;
                  const prevProgress = progressBucket[pid] || { fetched: 0, queue: 0 };
                  progressBucket[pid] = {
                    fetched: typeof (event as any).fetched === 'number'
                      ? Number((event as any).fetched)
                      : Number(prevProgress.fetched || 0),
                    queue: 0,
                  };
                } catch (_) {}
                scheduleStatsSave();
                reloadFirstPage({
                  projectStore: this,
                  projectId: this.data.id as number | string,
                  sort: this.sort,
                  db: this.getActiveTableDb(),
                  limit: 300,
                }).catch((e: any) => {
                  console.warn('[Project Store] refresh table after finish failed:', e?.message || e);
                });
                this.bumpTableRevision();
                if (!isParserProcess) {
                  scheduleDbStatsRefresh(pid);
                }
              }
            } else if (snapshot) {
              try {
                if (typeof snapshot.queue === 'number') updateStat('queue', snapshot.queue);
                if (typeof snapshot.fetched === 'number') updateStat('fetched', snapshot.fetched);
                if (!isParserProcess) {
                  const prevProgress = this.crawlerProgressByProject[pid] || { fetched: 0, queue: 0 };
                  this.crawlerProgressByProject[pid] = {
                    fetched: typeof snapshot.fetched === 'number' ? Number(snapshot.fetched) : Number(prevProgress.fetched || 0),
                    queue: typeof snapshot.queue === 'number' ? Number(snapshot.queue) : Number(prevProgress.queue || 0),
                  };
                }
              } catch (_) {}
            }
          }
          if (!lastProgressAt || Date.now() - lastProgressAt > 15000) {
            try {
              console.warn('[Crawler IPC] Finished without progress. Queue may be empty or stale.');
            } catch (_) {}
          }
        } else if (event.type === 'error') {
          const pid = String(event.projectId);
          const msg = String(event.message || '').toLowerCase();
          const nonFatal = msg.includes('fetcherror')
            || msg.includes('fetchtimeout')
            || msg.includes('fetchclienterror')
            || msg === '404' || msg.includes('404');
          if (nonFatal) {
            console.warn('[Crawler IPC] non-fatal:', event.message, (event as any).url || '');
            if (pid === String(this.currentProjectId)) {
              try {
                const current = this.data.stats?.error ?? 0;
                (this.data.stats as any).error = current + 1;
              } catch (_) {}
            } else {
              try {
                this.liveStats[pid] = Object.assign(this.liveStats[pid] || {}, { error: (this.liveStats[pid] as any)?.error ? (this.liveStats[pid] as any).error + 1 : 1 });
              } catch (_) {}
            }
            return;
          }
          console.error('[Crawler IPC] fatal error:', event.message);
          if (this.parserRunningProjects[pid] || this.parserStoppingProjects[pid]) {
            try { this.parserRunningProjects[pid] = false; } catch (_) {}
            try { delete this.parserStoppingProjects[pid]; } catch (_) {}
          } else {
            try { this.crawlerRunningProjects[pid] = false; } catch (_) {}
          }
          if (pid === String(this.currentProjectId)) this.syncCurrentProjectRunningState();
        } else if (event.type === 'stat') {
          if (String(event.projectId) !== String(this.currentProjectId)) return;
          const stat = (event as any).stat;
          const value = typeof (event as any).value === 'number' ? (event as any).value : 0;
          if (stat === 'queue' && typeof (event as any).value !== 'number') return;
          if (stat && this.data.stats && stat in this.data.stats) {
            updateStat(stat as keyof Stats, value);
          }
        } else if (event.type === 'url') {
          try {
            console.log('[Crawler IPC] url', {
              projectId: event.projectId,
              url: (event as any).url,
            });
          } catch (_) {}
          if (String(event.projectId) === String(this.currentProjectId)) {
            if (this.tableDataLength < 50) {
              reloadFirstPage({
                projectStore: this,
                projectId: this.data.id as number | string,
                sort: this.sort,
                db: this.getActiveTableDb(),
                limit: 50,
              });
            }
          }
        } else if (event.type === 'render') {
          if (String(event.projectId) !== String(this.currentProjectId)) return;
          const level = String((event as any).level || 'info').toLowerCase();
          const mode = (event as any).mode || 'render';
          const message = (event as any).message || 'render event';
          const url = (event as any).url || '';
          const line = `[Crawler Render][${mode}] ${message}${url ? ` url=${url}` : ''}`;
          if (level === 'error') {
            console.error(line);
          } else if (level === 'warn') {
            console.warn(line);
          } else {
            console.log(line);
          }
        } else if (event.type === 'limit_reached') {
          if (String(event.projectId) !== String(this.currentProjectId)) return;
          const message = String((event as any).message || '');
          if (message) {
            ElMessage.warning(message);
          }
          try {
            console.warn('[Crawler IPC] limit reached', {
              reason: (event as any).reason,
              limit: (event as any).limit,
              fetched: (event as any).fetched,
            });
          } catch (_) {}
        } else if (event.type === 'row') {
          if (String(event.projectId) !== String(this.currentProjectId)) return;
          const row = mergeParserContentIntoRow((event as any).row);
          if (!row || typeof row !== 'object') return;
          // Keep live updates consistent with current table filter (urls vs disallow)
          try {
            const dbKey = String(this.activePage === '3' ? 'parser' : this.currentDb || 'urls');
            const isDisallowed =
              row.status === 'disallowed' ||
              row.error_type === 'fetchdisallowed' ||
              row.error_type === 'path_restricted';
            if (dbKey === 'disallow') {
              if (!isDisallowed) return;
            } else if (dbKey === 'parser') {
              // Parser table should reflect original uploaded URLs including 3xx/4xx/5xx statuses.
              // Do not filter by resource type/code here.
            } else if (dbKey === 'urls') {
              if (isDisallowed) return;
            } else if (row.type && dbKey !== String(row.type)) {
              // For typed views (html/image/jscss/etc.)
              return;
            }
          } catch (_) {}
          const activeFilters = Array.isArray(this.currentTableFilters) ? this.currentTableFilters : [];
          const existingIndex = this.tableData.findIndex(
            (item: any) => String(item?.url || '') === String(row.url || ''),
          );
          if (activeFilters.length > 0 && !rowMatchesTableFilters(row, activeFilters)) {
            if (existingIndex >= 0) {
              this.tableData.splice(existingIndex, 1);
              this.tableDataLength = this.tableData.length;
              this.bumpTableRevision();
            }
            return;
          }
          try {
            console.log('[Crawler IPC] checked', {
              projectId: event.projectId,
              url: row.url,
              code: row.code,
              status: row.status,
            });
          } catch (_) {}
          const sortObj = this.sort || ({ id: 1 } as any);
          const sortKey = Object.keys(sortObj)[0] || 'id';
          const orderDesc = sortObj[sortKey] === -1;
          if (existingIndex >= 0) {
            this.tableData.splice(existingIndex, 1, {
              ...this.tableData[existingIndex],
              ...row,
            });
          } else if (sortKey === 'id') {
            if (orderDesc) this.tableData.unshift(row);
            else this.tableData.push(row);
          } else {
            this.tableData.unshift(row);
          }
          const maxWindow = 300;
          if (this.tableData.length > maxWindow) {
            if (orderDesc) this.tableData.pop(); else this.tableData.shift();
          }
          this.tableDataLength = this.tableData.length;
          this.bumpTableRevision();
        }
      });
      onCrawlerStarted(crawlerClient, (event) => {
        const pid = String(event.projectId);
        const isParserProcess = String((event as any).startUrl || '') === 'batch:uploaded-urls';
        if (isParserProcess) {
          try { delete this.parserStoppingProjects[pid]; } catch (_) {}
          try { this.parserRunningProjects[pid] = true; } catch (_) {}
          try {
            this.parserProgressByProject[pid] = this.parserProgressByProject[pid] || { fetched: 0, queue: 0 };
          } catch (_) {}
          if (pid === String(this.currentProjectId)) {
            this.syncCurrentProjectRunningState();
          }
          try {
            console.log('[Crawler IPC] started', {
              projectId: pid,
              startUrl: event.startUrl,
            });
          } catch (_) {}
          return;
        }
        const wasStopping = !!this.crawlerStoppingProjects[pid];
        const snapshot = this.crawlerStoppingSnapshot[pid];
        
        // Restore snapshot if resuming after stop (prevents late finished from zeroing queue)
        if (wasStopping && snapshot && pid === String(this.currentProjectId)) {
          try {
            if (typeof snapshot.queue === 'number') updateStat('queue', snapshot.queue);
            if (typeof snapshot.fetched === 'number') updateStat('fetched', snapshot.fetched);
            if (typeof snapshot.disallow === 'number') updateStat('disallow', snapshot.disallow);
          } catch (_) {}
        }
        
        // Mark that we just restarted (for late finished detection)
        if (wasStopping) {
          try { this.crawlerJustRestarted[pid] = true; } catch (_) {}
        }
        
        // Now safe to clear stop gates
        try { delete this.crawlerStoppingProjects[pid]; } catch (_) {}
        try { delete this.crawlerStoppingSnapshot[pid]; } catch (_) {}
        try { this.crawlerRunningProjects[pid] = true; } catch (_) {}
        try {
          const prev = this.crawlerProgressByProject[pid] || { fetched: 0, queue: 0 };
          this.crawlerProgressByProject[pid] = {
            fetched: typeof snapshot?.fetched === 'number' ? Number(snapshot.fetched) : Number(prev.fetched || 0),
            queue: typeof snapshot?.queue === 'number' ? Number(snapshot.queue) : Number(prev.queue || 0),
          };
        } catch (_) {}
        if (pid === String(this.currentProjectId)) {
          this.syncCurrentProjectRunningState();
        }
        try {
          console.log('[Crawler IPC] started', {
            projectId: pid,
            startUrl: event.startUrl,
          });
        } catch (_) {}
      });
      
      
      
    },

    async startCrawlerIPC(url?: string) {
      if (url) this.data.url = url;
      if (!this.currentProjectId) {
        console.warn('[Project Store] startCrawlerIPC: no currentProjectId');
        return { success: false, error: 'No current project selected' };
      }
      this.initCrawlerIpcEvents();
      if (this.isParserBusy) {
        return { success: false, code: 'PROCESS_CONFLICT', error: this.getProcessConflictMessage('crawler') };
      }
      if (!this.data.crawler || typeof this.data.crawler !== 'object') {
        this.data.crawler = (newProjectJson as NewProjectFile).crawler;
      }
      this.data.crawler = clampCrawlerConfigForPlan(this.data.crawler);
      if (!Array.isArray(this.data.parser)) {
        this.data.parser = (newProjectJson as NewProjectFile).parser || [];
      }
      const ipc: any = (ipcClient as any).ipc;
      if (!ipc) {
        console.warn('[Project Store] ipcRenderer unavailable');
        return;
      }
      try {
        // const pid = String(this.currentProjectId);
        // Keep stop flags until we receive `started` for the new run.
        // This avoids a race where late `finished` from the previous run
        // briefly overwrites queue to 0 and causes UI flicker.

        let persistedQueueExists = false;
        try {
          const qRes = await ipc.invoke('crawler:queue:exists', Number(this.currentProjectId));
          persistedQueueExists = !!(qRes && qRes.success && qRes.data && qRes.data.exists);
        } catch (_) {}

        // Resume when either UI state says freezed or a frozen queue file exists
        // (important after app restart/crash where freezed may be false in memory).
        const resumeFromQueue = !!this.data.freezed || persistedQueueExists;
        if (resumeFromQueue) {
          try { this.crawlerJustRestarted[String(this.currentProjectId)] = true; } catch (_) {}
        } else {
          try { delete this.crawlerJustRestarted[String(this.currentProjectId)]; } catch (_) {}
        }
        // Clear per-run tables only when NOT resuming
        if (!resumeFromQueue) {
          try {
            await ipc.invoke('db:crawler:clear', Number(this.currentProjectId));
            await ipc.invoke('crawler:queue:clear', Number(this.currentProjectId));
            // Reset stats locally so UI doesn't show stale counters from previous runs
            const zeroStats: Stats = {
              fetched: 0, queue: 0, disallow: 0, html: 0, jscss: 0, image: 0,
              redirect: 0, error: 0, depth3: 0, depth5: 0, depth6: 0, other: 0,
            } as Stats;
            this.data.stats = Object.assign({}, zeroStats);
            (this.data.stats as any).finishedAt = '';
            // Also clear table view state
            this.tableData = [];
            this.tableDataLength = 0;
            this.tableTotalCount = 0;
            this.tableWindowStart = 0;
            this.bumpTableRevision();
            try { this.lastFinishedAt[String(this.currentProjectId)] = ''; } catch (_) {}
            try { this.lastCrawlerFinishedAt[String(this.currentProjectId)] = ''; } catch (_) {}
            try { this.crawlerProgressByProject[String(this.currentProjectId)] = { fetched: 0, queue: 0 }; } catch (_) {}
          } catch (e) {
            console.warn('[Project Store] pre-start clear failed', e);
          }
        }
        // Persist latest settings before starting the worker
        if (resumeFromQueue) {
          try { this.data.freezed = false; } catch (_) {}
        }
        await this.updateProject();
        const payload = {
          id: Number(this.data.id),
          url: this.data.url,
          crawler: JSON.parse(JSON.stringify(this.data.crawler || {})),
          parser: JSON.parse(JSON.stringify(this.data.parser || [])),
        };
        const res = await ipc.invoke('crawler:start', payload);
        if (!res || !res.success) {
          console.warn('[Project Store] crawler:start rejected', res?.error || 'unknown error');
          try { this.crawlerRunningProjects[String(this.data.id)] = false; } catch (_) {}
          this.syncCurrentProjectRunningState();
          return res || { success: false, error: 'Crawler start rejected' };
        }
        // mark this project as running
        try { this.crawlerRunningProjects[String(this.data.id)] = true; } catch (_) {}
        try {
          const pid = String(this.data.id);
          const prev = this.crawlerProgressByProject[pid] || { fetched: 0, queue: 0 };
          this.crawlerProgressByProject[pid] = resumeFromQueue
            ? prev
            : { fetched: 0, queue: 0 };
        } catch (_) {}
        this.syncCurrentProjectRunningState();
        return { success: true };
      } catch (e: any) {
        console.error('[Project Store] crawler:start invoke error', e?.message || e);
        return { success: false, error: e?.message || String(e) };
      }
    },

    async startParserIPC(options?: { mode?: 'all' | 'filtered'; filters?: TableFilterOption[] }) {
      if (!this.currentProjectId) {
        console.warn('[Project Store] startParserIPC: no currentProjectId');
        return { success: false, error: 'No current project selected' };
      }
      this.initCrawlerIpcEvents();
      const ipc: any = (ipcClient as any).ipc;
      if (!ipc) {
        console.warn('[Project Store] ipcRenderer unavailable');
        return { success: false, error: 'ipcRenderer unavailable' };
      }
      if (this.isCrawlerBusy) {
        return { success: false, code: 'PROCESS_CONFLICT', error: this.getProcessConflictMessage('parser') };
      }
      this.data.crawler = clampCrawlerConfigForPlan(this.data.crawler);
      try {
        const mode = options?.mode === 'filtered' ? 'filtered' : 'all';
        const filters = JSON.parse(JSON.stringify(Array.isArray(options?.filters) ? options?.filters : []));
        let parserUrls: string[] = [];

        if (mode === 'filtered') {
          const filteredRows = await ipcClient.getUrlsSorted({
            id: Number(this.currentProjectId),
            sort: this.sort,
            skip: 0,
            limit: 0,
            db: 'parser',
            filters,
          });
          parserUrls = Array.from(new Set(
            (Array.isArray(filteredRows) ? filteredRows : [])
              .map((row: any) => String(row?.url || '').trim())
              .filter((url: string) => !!url),
          ));
          if (!parserUrls.length) {
            return { success: false, error: 'Нет записей, подходящих под текущие фильтры' };
          }
        }

        try {
          const resetRes = mode === 'filtered'
            ? { success: true, data: { updated: parserUrls.length } }
            : { success: true, data: { updated: 0 } };
          if (!resetRes || !resetRes.success) {
            return resetRes || { success: false, error: 'Parser reset failed' };
          }
          const zeroStats: Stats = {
            fetched: 0, queue: 0, disallow: 0, html: 0, jscss: 0, image: 0,
            redirect: 0, error: 0, depth3: 0, depth5: 0, depth6: 0, other: 0,
          } as Stats;
          this.data.stats = Object.assign({}, zeroStats);
          (this.data.stats as any).finishedAt = '';
          this.bumpTableRevision();
          try { this.lastFinishedAt[String(this.currentProjectId)] = ''; } catch (_) {}
          try { this.lastParserFinishedAt[String(this.currentProjectId)] = ''; } catch (_) {}
          try { this.parserProgressByProject[String(this.currentProjectId)] = { fetched: 0, queue: 0 }; } catch (_) {}
        } catch (e) {
          console.warn('[Project Store] pre-parser-start reset failed', e);
        }
        if (!Array.isArray(this.data.parser)) {
          this.data.parser = (newProjectJson as NewProjectFile).parser || [];
        }
        await this.updateProject();
        const payload = {
          id: Number(this.data.id),
          crawler: JSON.parse(JSON.stringify(this.data.crawler || {})),
          parser: JSON.parse(JSON.stringify(this.data.parser || [])),
          parserUrls,
        };
        const res = await ipc.invoke('parser:start', payload);
        if (!res || !res.success) {
          console.warn('[Project Store] parser:start rejected', res?.error || 'unknown error');
          try { this.parserRunningProjects[String(this.data.id)] = false; } catch (_) {}
          this.syncCurrentProjectRunningState();
          return res || { success: false, error: 'Parser start rejected' };
        }
        try { this.parserRunningProjects[String(this.data.id)] = true; } catch (_) {}
        try {
          this.parserProgressByProject[String(this.data.id)] = this.parserProgressByProject[String(this.data.id)] || { fetched: 0, queue: 0 };
        } catch (_) {}
        this.syncCurrentProjectRunningState();
        return { success: true };
      } catch (e: any) {
        console.error('[Project Store] parser:start invoke error', e?.message || e);
        return { success: false, error: e?.message || String(e) };
      }
    },

    stopParserIPC(projectId?: string) {
      const ipc: any = (ipcClient as any).ipc;
      if (!ipc) return;
      const idToStop = projectId || String(this.currentProjectId || '');
      if (!idToStop) return;
      try {
        this.parserStoppingProjects[String(idToStop)] = true;
      } catch (_) {}
      try {
        ipc.invoke('parser:stop', Number(idToStop));
      } catch (e: any) {
        console.error('[Project Store] parser:stop invoke error', e?.message || e);
      }
      try { this.parserRunningProjects[String(idToStop)] = false; } catch (_) {}
      if (String(this.currentProjectId) === String(idToStop)) this.syncCurrentProjectRunningState();
    },

    async stopCrawlerIPC(projectId?: string) {
      const ipc: any = (ipcClient as any).ipc;
      if (!ipc) return;
      const idToStop = projectId || String(this.currentProjectId || '');
      if (!idToStop) return;
      const pid = String(idToStop);
      const progress = this.crawlerProgressByProject[pid];
      try {
        this.crawlerStoppingProjects[pid] = true;
        this.crawlerStoppingSnapshot[pid] = {
          fetched: String(this.currentProjectId) === pid ? (this.data.stats?.fetched ?? 0) : progress?.fetched,
          queue: String(this.currentProjectId) === pid ? (this.data.stats?.queue ?? 0) : progress?.queue,
          disallow: String(this.currentProjectId) === pid ? (this.data.stats?.disallow ?? 0) : undefined,
        };
      } catch (_) {}
      let stopAccepted = false;
      try {
        const res = await ipc.invoke('crawler:stop', Number(idToStop));
        stopAccepted = !!(res && res.success);
        if (!stopAccepted) {
          console.warn('[Project Store] crawler:stop rejected', res?.error || 'unknown error');
        }
      } catch (e: any) {
        console.error('[Project Store] crawler:stop invoke error', e?.message || e);
      }
      if (!stopAccepted) {
        try {
          delete this.crawlerStoppingProjects[pid];
          delete this.crawlerStoppingSnapshot[pid];
        } catch (_) {}
        try { this.crawlerRunningProjects[pid] = false; } catch (_) {}
        if (String(this.currentProjectId) === String(idToStop)) this.syncCurrentProjectRunningState();
        return;
      }
      try {
        // Mark project as freezed so next run resumes from saved queue
        if (String(this.currentProjectId) === String(idToStop)) {
          this.data.freezed = true;
          await this.updateProject();
        }
      } catch (_) {}
      try { this.crawlerRunningProjects[String(idToStop)] = false; } catch (_) {}
      if (String(this.currentProjectId) === String(idToStop)) this.syncCurrentProjectRunningState();

      // Fail-safe unlock: if `finished` doesn't arrive for a manual stop,
      // clear stopping flags so parser controls are not blocked indefinitely.
      setTimeout(() => {
        try {
          if (!this.crawlerRunningProjects[pid] && this.crawlerStoppingProjects[pid]) {
            delete this.crawlerStoppingProjects[pid];
            delete this.crawlerStoppingSnapshot[pid];
            delete this.crawlerJustRestarted[pid];
            if (String(this.currentProjectId) === pid) this.syncCurrentProjectRunningState();
          }
        } catch (_) {}
      }, 1500);
    },

    // downloadData removed — use exportCrawlerData from `src/stores/export` directly

    async getsortedDb(options: Partial<SortedRequestOptions>) {
      const projectId = options && options.id ? options.id : (this.data.id as number | string | undefined);
      if (!projectId) {
        this.tableLoading = false;
        return;
      }
      if (!this.tableData.length) this.tableLoading = true;

      const requestOptions: SortedRequestOptions = {
        id: projectId,
        sort: (options.sort as SortOption) || this.sort,
        limit: options.limit || 50,
        skip: options.skip || 0,
        filters: Array.isArray(options.filters) ? options.filters : this.currentTableFilters,
        db:
          (options.db as string) ||
          (this.activePage === '3' ? 'parser' : this.currentDb),
      } as SortedRequestOptions;
      this.currentTableFilters = Array.isArray(requestOptions.filters)
        ? [...requestOptions.filters]
        : [];

      console.log('📊 [Project Store] getsortedDb called with:', {
        requestedDb: options.db,
        currentDb: this.currentDb,
        finalDb: requestOptions.db,
        projectId: requestOptions.id,
        limit: requestOptions.limit,
        skip: requestOptions.skip,
        filters: Array.isArray(requestOptions.filters) ? requestOptions.filters.length : 0,
      });

      try {
        const response = await ipcClient.getUrlsSorted(requestOptions);
        console.log('📊 [Project Store] Response received:', {
          db: requestOptions.db,
          rowCount: Array.isArray(response) ? response.length : 0,
          isArray: Array.isArray(response),
        });
        
        // Get total count for the current table
        const totalCount = await ipcClient.getUrlsCount(
          Number(projectId),
          requestOptions.db,
          Array.isArray(requestOptions.filters) ? requestOptions.filters : [],
        );
        console.log('📊 [Project Store] Total count for table:', {
          db: requestOptions.db,
          totalCount,
        });
        this.tableTotalCount = totalCount;
        this.tableWindowStart = requestOptions.skip;
        
        if (
          Array.isArray(response) &&
          response.length === 0 &&
          totalCount > 0 &&
          Number(requestOptions.skip || 0) > 0
        ) {
          // Window can become stale (e.g. after switching table/page with previous large skip).
          // Fallback to first window to avoid "count > 0 but empty table".
          const fallbackOptions: SortedRequestOptions = {
            ...requestOptions,
            skip: 0,
          };
          const firstWindow = await ipcClient.getUrlsSorted(fallbackOptions);
          this.tableWindowStart = 0;
          if (Array.isArray(firstWindow)) {
            let mapped = firstWindow.map((row: any) => mergeParserContentIntoRow(row));
            this.tableData = mapped;
            this.tableDataLength = mapped.length;
          } else {
            this.tableData = [];
            this.tableDataLength = 0;
          }
          this.tableLoading = false;
          return;
        }

        if (Array.isArray(response)) {
          let mapped = response.map((row: any) => mergeParserContentIntoRow(row));
          this.tableData = mapped;
          this.tableDataLength = mapped.length;
        } else {
          this.tableData = [];
          this.tableDataLength = 0;
          this.tableTotalCount = 0;
          this.tableWindowStart = 0;
        }
      } catch (error) {
        console.error('[Project Store] Error loading sorted URLs:', error);
        this.tableData = [];
        this.tableDataLength = 0;
        this.tableTotalCount = 0;
        this.tableWindowStart = 0;
      }
      this.tableLoading = false;
    },

    async deleteData() {
      if (!this.currentProjectId) return;
      try {
        const ipc: any = (ipcClient as any).ipc;
        if (!ipc) {
          console.warn('[Project Store] ipcRenderer not available');
          return;
        }
        const isParserPage = this.activePage === '3';
        const clearChannel = isParserPage ? 'db:parser:clear' : 'db:crawler:clear';
        const res = await ipc.invoke(clearChannel, Number(this.currentProjectId));
        if (res && res.success) {
          // reset local state
          this.tableData = [];
          this.tableDataLength = 0;
          this.tableTotalCount = 0;
          this.tableWindowStart = 0;
          this.bumpTableRevision();
          // Reset crawler stats only when clearing crawler dataset.
          // Parser clear must not zero crawler widgets.
          if (!isParserPage) {
            const zeroStats: Stats = {
              fetched: 0, queue: 0, disallow: 0, html: 0, jscss: 0, image: 0,
              redirect: 0, error: 0, depth3: 0, depth5: 0, depth6: 0, other: 0,
            } as Stats;
            this.data.stats = Object.assign({}, zeroStats);
            // Also remove persisted queue file so next run starts clean
            try {
              await ipc.invoke('crawler:queue:clear', Number(this.currentProjectId));
            } catch (e) {
              console.warn('[Project Store] crawler:queue:clear invoke failed', e);
            }
          }
        } else {
          console.warn(`[Project Store] ${clearChannel} failed`, res?.error);
        }
      } catch (e: any) {
        console.error('[Project Store] deleteData error:', e?.message || e);
      }
    },

    async deleteProject() {
      if (!this.currentProjectId) return;
      
      try {
        const res = await ipcClient.deleteProject(Number(this.currentProjectId));

        // Make sure deletion actually happened in the DB
        if (!res || (typeof res.changes === 'number' && res.changes === 0)) {
          console.warn('[Project Store] deleteProject: deletion did not report changes', res);
          throw new Error('Project deletion failed or no rows affected');
        }

        // Удаляем проект из списка
        const deletedIndex = this.projects.findIndex((p) => String(p.id) === String(this.currentProjectId));
        if (deletedIndex !== -1) {
          this.projects.splice(deletedIndex, 1);
        }

        // Переключаемся на первый проект или показываем форму создания
        if (this.projects.length > 0) {
          await this.changeProject(String(this.projects[0].id));
        } else {
          this.currentProjectId = null;
          persistProjectId(null);
          this.newProjectForm = true;
        }
      } catch (error) {
        console.error('[Project Store] Error deleting project:', error);
      }
    },

  },
});
