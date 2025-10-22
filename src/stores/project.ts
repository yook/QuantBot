import { defineStore } from "pinia";
import socket from "./socket-client";
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
  QueueUpdate,
  CrawlerStatus,
  TableUpdate,
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
    getProjects() {
      socket.emit("get-all-projects");
      socket.once("all-projects-data", (data: ProjectSummary[] = []) => {
        if (Array.isArray(data)) this.projects = data;
        this.projectsLoaded = true;
        const storageId = localStorage.getItem("currentProjectId");
        if (this.projects.length > 0) {
          const idx = this.projects.findIndex((p) => String(p.id) === String(storageId));
          this.currentProjectId = idx >= 0 ? String(storageId) : String(this.projects[0].id);
          localStorage.setItem("currentProjectId", String(this.currentProjectId));
          socket.emit("get-project", this.currentProjectId);
        } else {
          this.newProjectForm = true;
        }
      });
    },

    refreshProjectsList() {
      socket.emit("get-all-projects");
      socket.once("all-projects-data", (data: ProjectSummary[] = []) => {
        if (Array.isArray(data)) this.projects = data;
        this.projectsLoaded = true;
      });
    },

    socketOn() {
      if ((window as any).__socketListenersRegistered) return;
      (window as any).__socketListenersRegistered = true;
      this.socketReady = true;
      this.getProjects();

      socket.on("project-data", (data) => {
        if (!data) return;
        Object.assign(this.data, data);
        if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
        if (!this.data.columns) this.data.columns = {};
        this.getsortedDb({ id: this.data.id as number | string, sort: this.sort, skip: 0, limit: 50, db: this.currentDb });
      });

      // Обработчик очистки данных краулера
      socket.on("crawler-data-cleared", (data: { projectId: string | number }) => {
        // Обновляем данные только для текущего проекта
        if (String(data.projectId) === String(this.currentProjectId)) {
          // Очищаем только данные краулера, сохраняя проект
          this.tableData = [];
          this.tableLoading = false;
          
          // Сбрасываем статистику краулера
          if (this.data.stats) {
            this.data.stats.html = 0;
            this.data.stats.redirect = 0;
            this.data.stats.image = 0;
            this.data.stats.jscss = 0;
            this.data.stats.error = 0;
            this.data.stats.other = 0;
            this.data.stats.queue = 0;
            this.data.stats.depth3 = 0;
            this.data.stats.depth5 = 0;
            this.data.stats.depth6 = 0;
          }
          
          // Останавливаем краулер если он был запущен
          if (this.running) {
            this.running = false;
          }
        }
      });

            // Обработчик обновлений очереди краулера
      socket.on("queue", (data: QueueUpdate) => {
        // Обновляем статистику очереди только для текущего проекта
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) {
            this.data.stats = (newProjectJson as NewProjectFile).stats;
          }
          if (data.queue !== undefined) {
            this.data.stats.queue = data.queue;
          }
          
          // Останавливаем краулер если очередь пуста и он был запущен
          if (data.queue === 0 && this.running) {
            console.log("Queue is empty, stopping crawler");
            this.running = false;
          }
        }
      });

      // Обработчик обновлений fetched
      socket.on("fetched", (data: QueueUpdate) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) {
            this.data.stats = (newProjectJson as NewProjectFile).stats;
          }
          if (data.fetched !== undefined) {
            this.data.stats.fetched = data.fetched;
          }
        }
      });

      // Обработчик общих событий остановки краулера
      socket.on("stopped", (data: CrawlerStatus) => {
        console.log("Crawler stopped:", data);
        // Останавливаем для текущего проекта независимо от ID
        // поскольку событие stopped приходит для активного краулера
        this.running = false;
      });

      // Обработчик обновлений данных в таблице
      socket.on("data-updated", (data: TableUpdate) => {
        // Обновляем таблицу только для текущего проекта
        if (String(data.projectId) === String(this.currentProjectId) && this.currentProjectId) {
          // Перезагружаем данные таблицы для отображения новых записей
          this.getsortedDb({ 
            id: this.currentProjectId, 
            sort: this.sort, 
            skip: 0, 
            limit: 50, 
            db: this.currentDb 
          });
        }
      });

      // Обработчики статистики по типам контента
      socket.on("stat-html", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.html = data.count;
        }
      });

      socket.on("stat-jscss", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.jscss = data.count;
        }
      });

      socket.on("stat-image", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.image = data.count;
        }
      });

      socket.on("stat-redirect", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.redirect = data.count;
        }
      });

      socket.on("stat-error", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.error = data.count;
        }
      });

      // Обработчики статистики по глубине
      socket.on("stat-depth3", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.depth3 = data.count;
        }
      });

      socket.on("stat-depth5", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.depth5 = data.count;
        }
      });

      socket.on("stat-depth6", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.depth6 = data.count;
        }
      });

      socket.on("stat-other", (data: { count: number; projectId: string | number }) => {
        if (String(data.projectId) === String(this.currentProjectId)) {
          if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
          this.data.stats.other = data.count;
        }
      });

      // Обработчик обновлений запрещенных URL
      socket.on("disallow", (count: number) => {
        if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
        this.data.stats.disallow = count;
      });
    },

    updateProject() {
      socket.emit("update-project", this.data);
    },

    saveNewProject(form: { name: string; url: string }) {
      const data: ProjectData = { ...(newProjectJson as NewProjectFile) } as ProjectData;
      data.name = form.name;
      data.url = form.url;
      socket.emit("save-new-project", data);
      socket.once("new-project-data", (newDoc: { id: string | number }) => {
        this.currentProjectId = String(newDoc.id);
        localStorage.setItem("currentProjectId", String(newDoc.id));
        this.newProjectForm = false;
        this.refreshProjectsList();
        socket.emit("get-project", newDoc.id);
      });
    },

    changeProject(id: string) {
      this.tableData = [];
      this.tableLoading = true;
      localStorage.setItem("currentProjectId", id);
      this.currentProjectId = id;
      socket.emit("change-project", id);
    },

    start(url: string) {
      this.data.url = url;
      socket.emit("startCrauler", this.data);
      this.running = true;
      socket.emit("update-project", this.data);
    },

    freeze() {
      socket.emit("freezeQueue");
      this.running = false;
    },

    // downloadData removed — use exportCrawlerData from `src/stores/export` directly

    getsortedDb(options: Partial<SortedRequestOptions>) {
      const projectId = options && options.id ? options.id : (this.data.id as number | string | undefined);
      if (!projectId) {
        this.tableLoading = false;
        return;
      }
      if (!this.tableData.length) this.tableLoading = true;

      const requestOptions: SortedRequestOptions = {
        id: projectId,
        sort: (options.sort as SortOption) || this.sort,
        limit: options.limit || 0,
        skip: options.skip || 0,
        db: (options.db as string) || this.currentDb,
      } as SortedRequestOptions;

      const requestId = `store-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      requestOptions.requestId = requestId;
      const responseEvent = `sorted-urls-data-${requestId}` as const;
      socket.once(responseEvent, (response: any[] | { data?: any[]; total?: number }) => {
        if (Array.isArray(response)) {
          this.tableData = response;
          this.tableDataLength = response.length;
        } else if (response && Array.isArray(response.data)) {
          this.tableData = response.data;
          this.tableDataLength = response.total ?? response.data.length;
        } else {
          this.tableData = [];
          this.tableDataLength = 0;
        }
        this.tableLoading = false;
      });
      socket.emit("get-sorted-urls", requestOptions);
    },

    deleteData() {
      socket.emit("delete-all", this.currentProjectId);
    },

    deleteProject() {
      socket.emit("delete-project", this.currentProjectId);
    },

    clearEmbeddingsCache() {
      socket.emit("clear-embeddings-cache");
    },
  },
});
