import { defineStore } from "pinia";
import { ipcClient } from "./socket-client";
import settingsJson from "./schema/table-name-prop.json";
import reportsJson from "./schema/table-reports.json";
import newProjectJson from "./schema/new-project.json";
import activeColumnsJson from "./schema/table-active-colums.json";
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
} from "../types/schema";

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
    running: false,
    defaultColumns: (settingsJson as SettingsFile).settings,
    tableReports: (reportsJson as ReportsFile).reports,
    currentPage: 1,
    activePage: "1",
    tableData: [] as UrlData[],
    tableDataLength: 0,
    sort: { id: 1 } as SortOption,
    tableLoading: true,
    start: false,
    currentUrl: "",
    fetched: 0,
    queue: 0,
    socketReady: false,
    tableUpdateTimeout: null as NodeJS.Timeout | null,
  }),

  getters: {
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

      const defaults = normalize(state.defaultColumns ?? []);
      const parserCols = normalize(state.data.parser ?? []);
      const all: ColumnDef[] = [...defaults, ...parserCols];

      // Determine enabled columns: prefer per-DB config; fallback to static defaults; else all props
      let enabledColumns: string[] =
        (state.data.columns && state.data.columns[state.currentDb]) || [];
      if (!enabledColumns || enabledColumns.length === 0) {
        const key = state.currentDb;
        const fromStatic = (activeColumnsJson as any)?.[key];
        if (Array.isArray(fromStatic) && fromStatic.length > 0) {
          enabledColumns = fromStatic as string[];
        } else {
          enabledColumns = all.map((c) => c.prop);
        }
      }

      // Filter by enabled list and keep order: url first, then others; dedup just in case
      const enabledSet = new Set(enabledColumns);
      const filtered = all.filter((c) => enabledSet.has(c.prop));
      const rowNumberColumn: ColumnDef = { name: "#", prop: "_rowNumber", width: 60, minWidth: 60 } as any;
      const urlCol = filtered.find((c) => c.prop === "url");
      const others = filtered.filter((c) => c.prop !== "url");
      return urlCol ? [rowNumberColumn, urlCol, ...others] : [rowNumberColumn, ...others];
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
    async getProjects() {
      console.log('[Project Store] getProjects called');
      const data = await ipcClient.getProjectsAll();
      console.log('[Project Store] Projects loaded:', data);
      if (Array.isArray(data)) this.projects = data;
      this.projectsLoaded = true;
      const storageId = localStorage.getItem("currentProjectId");
      if (this.projects.length > 0) {
        const idx = this.projects.findIndex((p) => String(p.id) === String(storageId));
        this.currentProjectId = idx >= 0 ? String(storageId) : String(this.projects[0].id);
        localStorage.setItem("currentProjectId", String(this.currentProjectId));
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
          this.getsortedDb({ id: this.data.id as number | string, sort: this.sort, skip: 0, limit: 50, db: this.currentDb });
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
        const res = await ipc.invoke('db:projects:updateConfigs', id, crawler, parser, columns, stats);
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
      
      if (result && result.lastInsertRowid) {
        this.currentProjectId = String(result.lastInsertRowid);
        localStorage.setItem("currentProjectId", String(result.lastInsertRowid));
        this.newProjectForm = false;
        await this.refreshProjectsList();
        const projectData = await ipcClient.getProject(Number(result.lastInsertRowid));
        if (projectData) {
          Object.assign(this.data, projectData);
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          if (!this.data.columns) this.data.columns = {};
          this.getsortedDb({ id: this.data.id as number | string, sort: this.sort, skip: 0, limit: 50, db: this.currentDb });
        }
      } else {
        console.error('[Project Store] Failed to insert project, result:', result);
      }
    },

    async changeProject(id: string) {
      this.tableData = [];
      this.tableLoading = true;
      localStorage.setItem("currentProjectId", id);
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
        
        // Ensure parser is an array with defaults if empty
        if (!Array.isArray((this.data as any).parser) || (this.data as any).parser.length === 0) {
          (this.data as any).parser = (newProjectJson as NewProjectFile).parser || [];
        }
        
        this.getsortedDb({ id: this.data.id as number | string, sort: this.sort, skip: 0, limit: 50, db: this.currentDb });
      }
      this.tableLoading = false;
    },

    initCrawlerIpcEvents() {
      const ipc: any = (ipcClient as any).ipc;
      if (!ipc || (window as any).__crawlerListenersRegistered) return;
      (window as any).__crawlerListenersRegistered = true;
      
      // Debounced save of stats to DB (avoid saving on every single update)
      let statsSaveTimeout: NodeJS.Timeout | null = null;
      const scheduleStatsSave = () => {
        if (statsSaveTimeout) clearTimeout(statsSaveTimeout);
        statsSaveTimeout = setTimeout(() => {
          this.updateProject().catch((e: any) => {
            console.warn('[Project Store] Auto-save stats failed:', e?.message || e);
          });
        }, 2000); // Save stats 2s after last update
      };
      
      const updateStat = (field: keyof Stats, value: number) => {
        if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
        (this.data.stats as any)[field] = value;
        scheduleStatsSave();
      };
      ipc.on('crawler:progress', (_e: any, payload: any) => {
        if (!payload || String(payload.projectId) !== String(this.currentProjectId)) return;
        updateStat('fetched', payload.fetched || 0);
        const nextQueue = typeof payload.queue === 'number' ? payload.queue : 0;
        // Preserve non-zero queue when worker sends transient 0 on start/stop
        const currentQueue = this.data.stats?.queue ?? 0;
        if (nextQueue > 0 || currentQueue === 0) {
          updateStat('queue', nextQueue);
        }
        // else: ignore drop to 0 if we had a queue before (resume scenario)
      });
      ipc.on('crawler:queue', (_e: any, payload: any) => {
        if (!payload || String(payload.projectId) !== String(this.currentProjectId)) return;
        const nextQueue = typeof payload.queue === 'number' ? payload.queue : 0;
        const currentQueue = this.data.stats?.queue ?? 0;
        if (nextQueue > 0 || currentQueue === 0) {
          updateStat('queue', nextQueue);
        }
      });
      ipc.on('crawler:finished', (_e: any, payload: any) => {
        if (!payload || String(payload.projectId) !== String(this.currentProjectId)) return;
        this.running = false;
        // Save final stats on finish
        scheduleStatsSave();
      });
      ipc.on('crawler:error', (_e: any, payload: any) => {
        if (!payload || String(payload.projectId) !== String(this.currentProjectId)) return;
        console.error('[Crawler IPC] error:', payload.message);
        this.running = false;
      });
      
      // Handle stat updates (disallow, html, image, etc.)
      ipc.on('crawler:stat', (_e: any, payload: any) => {
        if (!payload || String(payload.projectId) !== String(this.currentProjectId)) return;
        const stat = payload.stat;
        const value = typeof payload.value === 'number' ? payload.value : 0;
        if (stat && this.data.stats && stat in this.data.stats) {
          updateStat(stat as keyof Stats, value);
        }
      });
      
      ipc.on('crawler:url', (_e: any, payload: any) => {
        // lightweight strategy: refresh page window every N urls
        if (payload && String(payload.projectId) === String(this.currentProjectId)) {
          if (this.tableDataLength < 50) {
            this.getsortedDb({ id: this.data.id as number | string, sort: this.sort, skip: 0, limit: 50, db: this.currentDb });
          }
        }
      });

      // Immediate row injection for real-time UX
      ipc.on('crawler:row', (_e: any, payload: any) => {
        if (!payload || String(payload.projectId) !== String(this.currentProjectId)) return;
        const row = payload.row;
        if (!row || typeof row !== 'object') return;
        // Insert according to current sort; default to id ASC
        const sortObj = this.sort || { id: 1 } as any;
        const sortKey = Object.keys(sortObj)[0] || 'id';
        const orderDesc = sortObj[sortKey] === -1;
        if (sortKey === 'id') {
          if (orderDesc) this.tableData.unshift(row);
          else this.tableData.push(row);
        } else {
          this.tableData.unshift(row);
        }
        // Trim to a reasonable window to avoid unbounded growth (match windowed loads ~300)
        const maxWindow = 300;
        if (this.tableData.length > maxWindow) {
          if (orderDesc) this.tableData.pop(); else this.tableData.shift();
        }
        this.tableDataLength = this.tableData.length;
      });
    },

    async startCrawlerIPC(url?: string) {
      if (url) this.data.url = url;
      if (!this.currentProjectId) {
        console.warn('[Project Store] startCrawlerIPC: no currentProjectId');
        return;
      }
      this.initCrawlerIpcEvents();
      if (!this.data.crawler || typeof this.data.crawler !== 'object') {
        this.data.crawler = (newProjectJson as NewProjectFile).crawler;
      }
      if (!Array.isArray(this.data.parser)) {
        this.data.parser = (newProjectJson as NewProjectFile).parser || [];
      }
      const ipc: any = (ipcClient as any).ipc;
      if (!ipc) {
        console.warn('[Project Store] ipcRenderer unavailable');
        return;
      }
      try {
        // Persist latest settings before starting the worker
        await this.updateProject();
        const payload = {
          id: Number(this.data.id),
          url: this.data.url,
          crawler: JSON.parse(JSON.stringify(this.data.crawler || {})),
          parser: JSON.parse(JSON.stringify(this.data.parser || [])),
        };
        await ipc.invoke('crawler:start', payload);
        this.running = true;
      } catch (e: any) {
        console.error('[Project Store] crawler:start invoke error', e?.message || e);
      }
    },

    stopCrawlerIPC() {
      const ipc: any = (ipcClient as any).ipc;
      if (!ipc) return;
      try {
        ipc.invoke('crawler:stop');
      } catch (e: any) {
        console.error('[Project Store] crawler:stop invoke error', e?.message || e);
      }
      this.running = false;
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
        db: (options.db as string) || this.currentDb,
      } as SortedRequestOptions;

      console.log('📊 [Project Store] getsortedDb called with:', {
        requestedDb: options.db,
        currentDb: this.currentDb,
        finalDb: requestOptions.db,
        projectId: requestOptions.id,
        limit: requestOptions.limit,
        skip: requestOptions.skip,
      });

      try {
        const response = await ipcClient.getUrlsSorted(requestOptions);
        console.log('📊 [Project Store] Response received:', {
          db: requestOptions.db,
          rowCount: Array.isArray(response) ? response.length : 0,
          isArray: Array.isArray(response),
        });
        
        if (Array.isArray(response)) {
          this.tableData = response;
          this.tableDataLength = response.length;
        } else {
          this.tableData = [];
          this.tableDataLength = 0;
        }
      } catch (error) {
        console.error('[Project Store] Error loading sorted URLs:', error);
        this.tableData = [];
        this.tableDataLength = 0;
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
        const res = await ipc.invoke('db:crawler:clear', Number(this.currentProjectId));
        if (res && res.success) {
          // reset local state
          this.tableData = [];
          this.tableDataLength = 0;
          // reset stats
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
        } else {
          console.warn('[Project Store] db:crawler:clear failed', res?.error);
        }
      } catch (e: any) {
        console.error('[Project Store] deleteData error:', e?.message || e);
      }
    },

    async deleteProject() {
      if (!this.currentProjectId) return;
      
      try {
        await ipcClient.deleteProject(Number(this.currentProjectId));
        
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
          localStorage.removeItem("currentProjectId");
          this.newProjectForm = true;
        }
      } catch (error) {
        console.error('[Project Store] Error deleting project:', error);
      }
    },

    async clearEmbeddingsCache() {
      try {
        const ipc: any = (ipcClient as any).ipc;
        if (!ipc) {
          console.warn('[Project Store] ipcRenderer not available');
          return;
        }
        const res = await ipc.invoke('embeddings:clearCache');
        if (res && res.success) {
          // Синтетически отправим события для совместимости с существующими слушателями
          // Use ipcRenderer.emit so local listeners (registered via ipcRenderer.on) fire
          try {
            ipc.emit('embeddings-cache-cleared', null, {});
          } catch (e) {}
          const sizeRes = await ipc.invoke('embeddings:getCacheSize');
          const payload = sizeRes && sizeRes.success ? (sizeRes.data || { size: 0 }) : { size: 0 };
          try {
            ipc.emit('embeddings-cache-size', null, payload);
          } catch (e) {}
        } else {
          console.warn('[Project Store] embeddings:clearCache returned error', res?.error);
        }
      } catch (e: any) {
        console.error('[Project Store] clearEmbeddingsCache error:', e?.message || e);
      }
    },
  },
});
