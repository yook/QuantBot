import { defineStore } from "pinia";
import { ipcClient } from "./socket-client";
import settingsJson from "./schema/table-name-prop.json";
import reportsJson from "./schema/table-reports.json";
import newProjectJson from "./schema/new-project.json";
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
      const parserCols = state.data.parser ?? [];
      const defaults = state.defaultColumns ?? [];
      const all: ColumnDef[] = [...defaults, ...parserCols];
      let enabledColumns: string[] = (state.data.columns && state.data.columns[state.currentDb]) || [];
      if (!enabledColumns || enabledColumns.length === 0) {
        enabledColumns = all.map((c) => c.prop);
      }
      const filtered = all.filter((c) => enabledColumns.includes(c.prop));
      const rowNumberColumn: ColumnDef = { name: "#", prop: "_rowNumber", width: 60, minWidth: 60 };
      const urlCol = filtered.find((c) => c.prop === "url");
      const others = filtered.filter((c) => c.prop !== "url");
      return urlCol ? [rowNumberColumn, urlCol, ...others] : [rowNumberColumn, ...others];
    },
    allColumns: (state) => {
      const parserCols = state.data.parser ?? [];
      const columns: ColumnDef[] = [...(state.defaultColumns ?? []), ...parserCols];
      return columns.map((c) => ({ ...c, disabled: c.prop === "url" }));
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
      // TODO: Implement via IPC
      console.warn('[Project Store] updateProject not implemented yet');
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
        if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
        if (!this.data.columns) this.data.columns = {};
        this.getsortedDb({ id: this.data.id as number | string, sort: this.sort, skip: 0, limit: 50, db: this.currentDb });
      }
      this.tableLoading = false;
    },

    start(url: string) {
      this.data.url = url;
      // TODO: Implement crawler via IPC
      console.warn('[Project Store] Crawler not implemented yet');
      this.running = true;
    },

    freeze() {
      // TODO: Implement crawler freeze via IPC
      console.warn('[Project Store] Crawler freeze not implemented yet');
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

      try {
        const response = await ipcClient.getUrlsSorted(requestOptions);
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
      // TODO: Implement delete all crawler data via IPC
      console.warn('[Project Store] Delete all data not implemented yet');
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

    clearEmbeddingsCache() {
      // TODO: Implement clear embeddings cache via IPC
      console.warn('[Project Store] Clear embeddings cache not implemented yet');
    },
  },
});
