import { defineStore } from "pinia";
import socket from "./socket-client";
import settingsJson from "./schema/table-name-prop.json";
// import activeColumns from "./schema/table-active-colums.json";
import reportsJson from "./schema/table-reports.json";
import newProjectJson from "./schema/new-project.json";

import * as xlsx from "xlsx/xlsx.mjs";
import moment from "moment";
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
    currentDb: "urls", // Без фильтрации показываем все данные
    type: "all",
    currentProjectId: null as string | null,
    newProjectForm: false,
    crawlerConfigDialog: false,
    running: false,
    defaultColumns: (settingsJson as SettingsFile).settings,
    tableReports: (reportsJson as ReportsFile).reports,
    currentPage: 1,
    activePage: "1", // Добавляем состояние для активной страницы
    tableData: [] as UrlData[],
    tableDataLength: 0,
    sort: { id: 1 } as SortOption, // Изменили на id для оптимизации
    tableLoading: true,
    start: false,
    currentUrl: "",
    fetched: 0,
    queue: 0,
    // Ensure we register socket listeners only once
    socketReady: false,
  }),
  getters: {
    // Реактивное получение имени текущего проекта
    currentProjectName: (state) => {
      if (state.currentProjectId && state.projects.length > 0) {
        const project = state.projects.find(p => String(p.id) === String(state.currentProjectId));
        const result = project ? project.name : "";
        console.log(`🔍 currentProjectName: id="${state.currentProjectId}" -> name="${result}"`);
        return result;
      }
      console.log("🔍 currentProjectName: no id or empty projects");
      return "";
    },
    percentage: (state) => {
      if (!state.data.stats) return 0;
      const fetched = state.data.stats.fetched ?? 0;
      const queue = state.data.stats.queue ?? 0;
      const total = fetched + queue;
      const percent = total > 0 ? Math.round((fetched / total) * 100) : 0;
      // ipcRenderer.send('send-to-main', percent);
      return percent;
    },
    tableColumns: (state) => {
      const parserCols = state.data.parser ?? [];
      const defaults = state.defaultColumns ?? [];
      if (parserCols && defaults) {
        const all: ColumnDef[] = [...defaults, ...parserCols];

        // Получаем список включенных колонок для текущей таблицы
        let enabledColumns: string[] = state.data.columns[state.currentDb] || [];

        // Если список пустой, инициализируем всеми доступными колонками
        if (enabledColumns.length === 0) {
          enabledColumns = all.map((column) => column.prop);
          // Сохраняем в state для будущих использований
          if (!state.data.columns) {
            state.data.columns = {};
          }
          state.data.columns[state.currentDb] = enabledColumns;
        }

        // Фильтруем все колонки по включенным
        const filteredColumns: ColumnDef[] = all.filter((column) =>
          enabledColumns.includes(column.prop)
        );

        // Добавляем столбец с номерами строк первым
        const rowNumberColumn: ColumnDef = {
          name: "#",
          prop: "_rowNumber",
          width: 60,
          minWidth: 60,
        };

        // URL всегда должен быть вторым после номеров строк, если он включен
        const urlColumn = filteredColumns.find(
          (column) => column.prop === "url"
        );
        const otherColumns = filteredColumns.filter(
          (column) => column.prop !== "url"
        );

        return urlColumn
          ? [rowNumberColumn, urlColumn, ...otherColumns]
          : [rowNumberColumn, ...otherColumns];
      }
      return [];
    },
    allColumns: (state) => {
      const parserCols = state.data.parser ?? [];
      const columns: ColumnDef[] = [...(state.defaultColumns ?? []), ...parserCols];
      // Помечаем URL колонку как disabled (неактивную для изменений)
      return columns.map((column) => ({
        ...column,
        disabled: column.prop === "url",
      }));
    },
    success: (state) => {
      if (!state.data.stats) return 0;
      return (
        (state.data.stats.html ?? 0) +
        (state.data.stats.jscss ?? 0) +
        (state.data.stats.image ?? 0)
      );
    },
    totalRecords: (state) => {
      // Общее количество записей для пагинации без фильтрации
      if (!state.data.stats) return 0;
      let total = 0;
      for (const key of Object.keys(state.data.stats) as (keyof Stats)[]) {
        const val = state.data.stats[key];
        if (typeof val === "number" && key !== "fetched" && key !== "queue") {
          total += val;
        }
      }
      return total;
    },
    projectsList: (state) => {
      if (state.projects.length) {
        return state.projects.map((el) => ({
          label: el.name,
          value: String(el.id), // keep value as string to match v-model type
        }));
      }
      return [] as { label: string; value: string }[];
    },
  },
  actions: {
    getProjects() {
      console.log("📋 getProjects() called");
      socket.emit("get-all-projects");
  socket.once("all-projects-data", (data) => {
        console.log("📋 all-projects-data received, count:", data ? data.length : 0);
        console.log("📋 Projects data structure:", data && data[0] ? data[0] : "no data");
        // Безопасное обновление через временную переменную
        const newProjects = data || [];

        // Прямое присвоение с проверкой
        if (Array.isArray(newProjects)) {
          // Прямое присвоение нового массива
          this.projects = newProjects;
          console.log("✅ Projects updated, new count:", this.projects.length);
        }

        // mark as loaded after first response
        this.projectsLoaded = true;

        if (this.projects.length > 0) {
          const storageId = localStorage.getItem("currentProjectId");
          console.log("=== Setting currentProjectId ===");
          console.log("Projects:", this.projects);
          console.log("Storage ID:", storageId);

          const idExists = this.projects.findIndex(
            (project) => String(project.id) === String(storageId)
          );
          console.log("ID exists in projects:", idExists);

          this.currentProjectId = idExists < 0 ? null : String(storageId);
          console.log("Set currentProjectId to:", this.currentProjectId);

          if (!this.currentProjectId) {
            this.currentProjectId = String((data as ProjectSummary[])[0].id);
            localStorage.setItem("currentProjectId", String((data as ProjectSummary[])[0].id));
            console.log(
              "No currentProjectId, set to first project:",
              this.currentProjectId
            );
          }

          console.log("Emitting get-project for:", this.currentProjectId);
          socket.emit("get-project", this.currentProjectId);
        } else {
          console.log("No projects found, opening new project form");
          this.newProjectForm = true;
        }
      });
    },
    refreshProjectsList() {
      socket.emit("get-all-projects");
  socket.once("all-projects-data", (data) => {
        console.log("Refreshing projects list:", data);

        // Безопасное обновление через прямое присвоение
        const newProjects = data || [];
        if (Array.isArray(newProjects)) {
          this.projects = newProjects;
        }
        this.projectsLoaded = true;
        // НЕ изменяем currentProjectId - он уже установлен правильно
      });
    },
    socketOn() {
      // Use window flag instead of state to persist across HMR
      if ((window as any).__socketListenersRegistered) {
        console.log("socketOn: listeners already registered (via window flag), skipping");
        return;
      }
      (window as any).__socketListenersRegistered = true;
      this.socketReady = true;
      console.log("Setting up socket listeners (socketReady = true, window flag set)");
      // Инициализируем загрузку проектов при подключении
      this.getProjects();

  socket.on("project-data", (data) => {
        console.log("project-data received:", data ? data.id : "null");
        if (!data) {
          // Только если у нас есть проекты и нет текущего проекта
          if (this.projects.length > 0 && !this.currentProjectId) {
            this.currentProjectId = String(this.projects[0].id);
            localStorage.setItem("currentProjectId", String(this.projects[0].id));
            socket.emit("get-project", this.projects[0].id);
          }
        } else {
          // Обновляем данные реактивно
          Object.assign(this.data, data);
          // Ensure stats is fully populated with required numeric fields
          if (!this.data.stats) {
            this.data.stats = (newProjectJson as NewProjectFile).stats;
          } else {
            this.data.stats = { ...(newProjectJson as NewProjectFile).stats, ...this.data.stats };
          }

          // Убеждаемся, что columns существует
          if (!this.data.columns) {
            this.data.columns = {};
          }

          // Убеждаемся, что URL всегда включен в список выбранных колонок для всех таблиц
          if (this.data.columns) {
            // Проходим по всем таблицам и добавляем URL если его нет
            Object.keys(this.data.columns).forEach((tableName) => {
              if (Array.isArray(this.data.columns[tableName])) {
                if (!this.data.columns[tableName].includes("url")) {
                  this.data.columns[tableName].unshift("url"); // Добавляем URL в начало списка
                }
              }
            });
          }

          // Убираем автоматический вызов getQeue при обновлении project-data
          // if (this.data.freezed) {
          //   socket.emit("getQeue", data);
          // }

          // Загружаем данные для таблицы
          this.getsortedDb({
            id: this.data.id as number | string,
            sort: this.sort,
            skip: 0,
            limit: 50, // Ограничиваем до 50 строк для производительности
            db: this.currentDb,
          });

          // Запросим синхронизацию статистики на сервере при загрузке проекта
          try {
            if (this.data && this.data.id != null) {
              console.log(
                `[sync-project-stats] ${new Date().toISOString()} emit projectId=${
                  this.data.id
                }`
              );
              socket.emit("sync-project-stats", Number(this.data.id));
            }
          } catch (e) {
            console.warn("Failed to emit sync-project-stats:", e);
          }
        }
      });

      socket.on("stopping", (data) => {
        console.log("Процесс остановки:", data.message);
        // Можно показать прогресс остановки в UI
      });

  socket.on("stopped", (data) => {
        console.log("Краулер остановлен:", data.message);
        this.running = false;
        this.data.freezed = data.freezed || true;
        console.log("getsortedDb socketon stopped");
        this.getsortedDb({
          id: this.data.id as number | string,
          sort: this.sort,
          skip: 0,
          limit: 0, // Убираем ограничение на количество записей
          db: this.currentDb,
        });
        socket.emit("update-project", this.data);
      });
      socket.on("complete", () => {
        this.running = false;
        this.data.freezed = false;

        // Не обнуляем queue принудительно!
        // Статистика будет обновлена через socket события
        // if (this.data.stats) {
        //   this.data.stats.queue = 0;
        // }

        console.log("getsortedDb socketon complete");

        this.getsortedDb({
          id: this.data.id as number | string,
          sort: this.sort,
          skip: 0,
          limit: 0, // Убираем ограничение на количество записей
          db: this.currentDb,
        });
        socket.emit("update-project", this.data);
      });

      // socket.on("disconnectFreeze", () => {
      //     console.log('disconnectFreeze client');
      //     this.running = false;
      //     this.data.freezed = true;
      //     localStorage.setItem('disconnected', true);
      //     socket.emit("get-urls", { skip: 0, limit: 10, db: this.currentDb });
      //     socket.emit("getProject");
      // });

      socket.on("fetched", (data) => {
        if (this.data.stats) {
          this.data.stats.fetched = data.fetched || 0;
        }
      });
      socket.on("queue", (data) => {
        try {
          console.log(
            `[queue] ${new Date().toISOString()} client received projectId=${
              data.projectId
            } queue=${data.queue}`
          );
        } catch (e) {}
        if (this.data.stats && data && typeof data.queue === "number") {
          this.data.stats.queue = data.queue;
        }
      });

      // Обработчик для обновления статистики от socket событий
  socket.on("statsUpdate", (stats) => {
        console.log("statsUpdate received:", stats);
        if (this.data.stats) {
          // Обновляем все статистики, включая disallow
          Object.assign(this.data.stats, stats);
        }
      });

      // Обработчик для обновления таблицы при изменении данных в БД
  socket.on("data-updated", (data) => {
        console.log("data-updated received:", data);
        if (
          data.projectId === this.data.id &&
          data.tableName === this.currentDb
        ) {
          // Обновляем данные таблицы
          this.getsortedDb({
            id: this.data.id as number | string,
            sort: this.sort,
            skip: 0,
            limit: 50, // Максимум 50 строк при обновлении в реальном времени
            db: this.currentDb,
          });
        }
      });

      // Обработчик ответа на ручную синхронизацию статистики проекта
  socket.on("project-stats-synced", (payload) => {
        try {
          console.log(
            `[project-stats-synced] ${new Date().toISOString()}`,
            payload
          );
        } catch (e) {}

        if (!payload) return;

        if (payload.success) {
          // Обновляем только если event относится к текущему открытому проекту
          if (
            payload.projectId &&
            this.data &&
            Number(this.data.id) === Number(payload.projectId)
          ) {
            if (payload.stats) {
              if (!this.data.stats) this.data.stats = (newProjectJson as NewProjectFile).stats;
              Object.assign(this.data.stats, payload.stats);
            }
          }
        } else {
          console.warn("project-stats-synced failed:", payload.error);
        }
      });

      // Socket обработчики для каждого типа статистики

      socket.on("disallow", (count) => {
        if (this.data.stats) {
          this.data.stats.disallow = count;
        }
      });

      socket.on("stat-html", (count) => {
        if (this.data.stats) {
          this.data.stats.html = count;
        }
      });

      socket.on("stat-jscss", (count) => {
        if (this.data.stats) {
          this.data.stats.jscss = count;
        }
      });

      socket.on("stat-image", (count) => {
        if (this.data.stats) {
          this.data.stats.image = count;
        }
      });

      socket.on("stat-redirect", (count) => {
        if (this.data.stats) {
          this.data.stats.redirect = count;
        }
      });

      socket.on("stat-error", (count) => {
        if (this.data.stats) {
          this.data.stats.error = count;
        }
      });

      socket.on("stat-depth3", (count) => {
        if (this.data.stats) {
          this.data.stats.depth3 = count;
        }
      });

      socket.on("stat-depth5", (count) => {
        if (this.data.stats) {
          this.data.stats.depth5 = count;
        }
      });

      socket.on("stat-depth6", (count) => {
        if (this.data.stats) {
          this.data.stats.depth6 = count;
        }
      });

      socket.on("stat-other", (count) => {
        if (this.data.stats) {
          this.data.stats.other = count;
        }
      });

    socket.on("deleted", (_count: number) => {
        console.log("deleted");
        // this.data.stats = {
        //     "fetched": 0,
        //     "queue": 0,
        //     "disallow": 0,
        //     "html": 0,
        //     "jscss": 0,
        //     "image": 0,
        //     "redirect": 0,
        //     "error": 0,
        //     "depth3": 0,
        //     "depth5": 0,
        //     "depth6": 0
        // }
    this.data.stats = { ...(newProjectJson as NewProjectFile).stats };
        this.data.freezed = false;
        this.tableData = [];

        socket.emit("update-project", this.data);
      });

      socket.on("delete-error", (errorMessage) => {
        console.error("Error deleting project data:", errorMessage);
        alert(`Ошибка при удалении данных проекта: ${errorMessage}`);
      });

    socket.on("projectDeleted", (deletedId?: number) => {
        console.log("✅ projectDeleted event received!", deletedId);
        console.log("Current projects before delete:", this.projects.length);
        if (deletedId != null) {
          // Optimistically remove deleted project from list
          this.projects = this.projects.filter(p => Number(p.id) !== Number(deletedId));
        }
        // Сбрасываем текущие данные проекта
        this.data = {
          ...(newProjectJson as NewProjectFile),
          columnWidths: {},
        } as unknown as ProjectData;
        this.tableData = [];
        this.currentProjectId = null;
        localStorage.removeItem("currentProjectId");
        this.tableLoading = false;
        
        // Напрямую обновляем список проектов
        console.log("Directly fetching updated projects list...");
        socket.emit("get-all-projects");
        
        // Используем setTimeout для асинхронного обновления
        const handleProjectsUpdate = (data: ProjectSummary[]) => {
          console.log("📋 Projects after delete received:", data ? data.length : 0);
          console.log("📋 First project data:", data && data[0] ? { id: data[0].id, name: data[0].name, url: data[0].url } : "no data");
          const newProjects = data || [];
          if (Array.isArray(newProjects)) {
            this.projects = newProjects;
            console.log("✅ Projects list updated, new count:", this.projects.length);
            console.log("✅ First project in store:", this.projects[0] ? { id: this.projects[0].id, name: this.projects[0].name } : "no project");
            
            // Если есть проекты, выбираем первый
            if (newProjects.length > 0) {
              this.currentProjectId = String(newProjects[0].id);
              console.log("Setting currentProjectId to:", this.currentProjectId);
              console.log("Getter will return name:", this.currentProjectName);
              localStorage.setItem("currentProjectId", String(newProjects[0].id));
              socket.emit("get-project", newProjects[0].id);
            } else {
              // Если проектов нет, показываем форму создания
              this.newProjectForm = true;
            }
          }
          this.projectsLoaded = true;
          // Удаляем обработчик после использования
          socket.off("all-projects-data", handleProjectsUpdate);
        };
        
        socket.once("all-projects-data", handleProjectsUpdate);
      });

      socket.on("projectDeleteError", (errorMessage) => {
        console.error("Error deleting project:", errorMessage);
        // Можно добавить уведомление пользователю об ошибке
        alert(`Ошибка при удалении проекта: ${errorMessage}`);
      });

      socket.on("project-save-error", (errorMessage) => {
        console.error("Error saving project:", errorMessage);
        alert(`Ошибка при сохранении проекта: ${errorMessage}`);
      });
    },
    updateProject() {
      socket.emit("update-project", this.data);
    },
  saveNewProject(form: { name: string; url: string }) {
      console.log("Creating new project:", form);
    let data: ProjectData = { ...(newProjectJson as NewProjectFile) };
      data.name = form.name;
      data.url = form.url;

      socket.emit("save-new-project", data);
  socket.once("new-project-data", (newDoc: { id: string | number }) => {
        console.log("new project saved with id", newDoc.id);
  this.currentProjectId = String(newDoc.id); // Устанавливаем текущий проект
  localStorage.setItem("currentProjectId", String(newDoc.id));
        this.newProjectForm = false; // Закрываем форму после успешного создания
        this.refreshProjectsList(); // Обновляем только список, не меняя текущий проект
        // Загружаем данные нового проекта
        socket.emit("get-project", newDoc.id);
      });
    },
    changeProject(id: string) {
      // Очищаем таблицу при смене проекта
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
      console.log("freezeQueue");
      socket.emit("freezeQueue");
    },
    downloadData() {
      console.log("Start written File.");
      const header = this.data.columns[this.currentDb];
      console.log("Header columns:", header);
      console.log("Current table data info:", {
        tableDataLength: this.tableData.length,
        tableDataLengthProp: this.tableDataLength,
        hasDataInTable: this.tableData.length > 0,
      });

    const fields: Record<string, number> = {}; // Поля для экспорта - id будет добавлен автоматически на сервере
  header.forEach((element: string) => {
        if (element !== "_rowNumber") {
          // Исключаем служебное поле
          fields[element] = 1;
        }
      });
      console.log("Fields to export (id will be added automatically):", fields);

      const requestData = {
        id: this.data.id,
        db: this.currentDb,
        fields: fields,
      };
      console.log("Request data being sent:", requestData);

      socket.emit("get-all-data", requestData);

      socket.once("urls-all-data", (data) => {
        console.log("Raw data received:", data);
        console.log("Data type:", typeof data);
        console.log("Is array:", Array.isArray(data));
        console.log("Data length:", data ? data.length : "undefined");

        if (!data || !Array.isArray(data) || data.length === 0) {
          console.error("No data received for export!");
          console.error("Request was:", requestData);
          alert(
            "Нет данных для экспорта. Проверьте, есть ли данные в проекте."
          );
          return;
        }

        // Продолжаем обработку данных...
        let headerData: Record<string, string> = {};
        const filterCol = this.allColumns.filter((item: ColumnDef) => {
          return header.includes(item.prop);
        });
        console.log("Filtered columns:", filterCol);

        filterCol.forEach((item: ColumnDef) => {
          headerData[item.prop] = item.name;
        });
        console.log("Header data:", headerData);

        const book = xlsx.utils.book_new();

        const arr = data.slice();
        console.log("Data array length:", arr.length);

        const newArr = arr
          .map((el: Record<string, any>) => {
            if (el.date) {
              el.date = moment(el.date).format("YYYY-MM-DD HH:mm:ss");
            }
            return el;
          })
          .map((el: Record<string, any>) => {
            let obj: Record<string, any> = {};
            header.forEach((item: string) => {
              obj[item] = el[item];
            });
            return obj;
          });

        console.log("Processed data length:", newArr.length);
        console.log("First processed item:", newArr[0]);

        newArr.unshift(headerData);
        console.log("Final array with headers length:", newArr.length);

        var wd = xlsx.utils.json_to_sheet(newArr, {
          header: header,
          skipHeader: true,
        });
        xlsx.utils.book_append_sheet(book, wd, this.currentDb);

        const fileName = this.currentDb + "-report.xlsx";
        console.log("Saving file:", fileName);

        xlsx.writeFile(book, fileName);
        console.log("File saved successfully");
      });
    },
    getsortedDb(options: Partial<SortedRequestOptions>) {
      // Prefer explicit id from caller (options.id) over this.data.id to avoid using stale project data
  const projectId = options && options.id ? options.id : (this.data.id as number | string | undefined);
      console.log(
        `getsortedDb called with options.id=${
          options && options.id
        } this.data.id=${
          this.data && this.data.id
        } -> using projectId=${projectId}`
      );
      if (!projectId) {
        console.log("No project ID available, skipping data load");
        this.tableLoading = false;
        return;
      }

      if (!this.tableData.length) {
        this.tableLoading = true;
      }

      const requestOptions: SortedRequestOptions = {
        id: projectId,
        sort: options.sort || this.sort,
        limit: options.limit || 0, // Убираем ограничение на количество записей
        skip: options.skip || 0,
        db: (options.db as string) || this.currentDb,
      };

      // Создаем уникальный идентификатор для этого запроса
      const requestId = `store-${Date.now()}-${Math.floor(
        Math.random() * 10000
      )}`;
      requestOptions.requestId = requestId;

      // Устанавливаем обработчик для получения данных на уникальном событии
      const responseEvent = `sorted-urls-data-${requestId}` as const;
      socket.once(
        responseEvent,
        (response: any[] | { data?: any[]; total?: number }) => {
          if (Array.isArray(response)) {
            // Старый формат: просто массив записей
            this.tableData = response;
            this.tableDataLength = response.length;
          } else if (response && Array.isArray(response.data)) {
            // Новый формат: объект с data/total
            this.tableData = response.data;
            this.tableDataLength = response.total ?? response.data.length;
            console.log(
              `Загружено ${response.data.length} записей for projectId=${requestOptions.id}`
            );
          } else {
            this.tableData = [];
            this.tableDataLength = 0;
          }

          this.tableLoading = false;
        }
      );

      // Emit request with requestId so server can respond on the unique channel
      socket.emit("get-sorted-urls", requestOptions);
    },
    deleteData() {
      console.log("delete-all");
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
