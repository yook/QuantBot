// Пример интеграции SQLite коннектора в HandlerProject.js
// Этот файл показывает как можно переключиться с NeDB на SQLite

// const { log } = require("util");

// Подключение к SQLite (проекты в таблице projects)
const {
  db,
  dbGet,
  dbAll,
  dbRun,
  getProjectQueueSize,
  getProjectStats,
  projectsFindOneById,
  projectsFindAll,
  projectsInsert,
  projectsUpdate,
  projectsRemove,
  getSortedData,
  syncProjectStats,
  getUrlsStats,
  keywordsClear,
} = require("./db-sqlite.cjs");

// const xlsx = require("xlsx");

// Project serialization/deserialization and helpers are implemented in `db-sqlite.js`.

// Project stats helper is provided by db-sqlite.js (imported above)

// CRUD по таблице projects
// Project CRUD and helpers are implemented in db-sqlite.js and imported above.

// Импортируем функцию для получения пути к файлу очереди
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

// Определяем путь к файлу очереди (та же функция, что и в HandlerCrawler.js)
const queuePath = (id) => {
  return app
    ? path.join(app.getPath("userData"), "/db/" + id + "/queue")
    : "./db/" + id + "/queue";
};

module.exports = (io, socket) => {
  // Delegate getSortedData to db-sqlite implementation and emit results
  socket.on("get-sorted-urls", async (slice) => {
    try {
      const res = await getSortedData(slice);
      // Используем requestId для уникального ответа, если он есть
      const eventName = slice.requestId
        ? `sorted-urls-data-${slice.requestId}`
        : "sorted-urls-data";
      socket.emit(eventName, { data: res.data, total: res.total });
    } catch (err) {
      console.error("get-sorted-urls error:", err);
      // Используем requestId для уникального ответа, если он есть
      const eventName = slice.requestId
        ? `sorted-urls-data-${slice.requestId}`
        : "sorted-urls-data";
      socket.emit(eventName, { data: [], total: 0 });
    }
  });

  // syncProjectStats is provided by db-sqlite.js and imported above; use that implementation.

  socket.on("get-project", async (id) => {
    try {
      const row = await projectsFindOneById(Number(id));

      // Синхронизируем статистику проекта при загрузке
      try {
        await syncProjectStats(Number(id));
      } catch (statsSyncErr) {
        console.warn(
          `⚠️ Не удалось синхронизировать статистику проекта ${id}:`,
          statsSyncErr.message
        );
      }

      socket.emit("project-data", row);
    } catch (e) {
      console.error("get-project error:", e.message);
      socket.emit("project-data", null);
    }
  });

  socket.on("get-all-projects", async () => {
    try {
      const rows = await projectsFindAll();
      socket.emit("all-projects-data", rows);
    } catch (e) {
      console.error("get-all-projects error:", e.message);
      socket.emit("all-projects-data", []);
    }
  });

  socket.on("change-project", async (id) => {
    try {
      const row = await projectsFindOneById(Number(id));
      socket.emit("project-data", row);
    } catch (e) {
      socket.emit("project-data", null);
    }
  });

  socket.on("update-project", async (data) => {
    try {
      const updated = await projectsUpdate(data);
      socket.emit("project-data", updated);
    } catch (e) {
      console.error("update-project error:", e.message);
      socket.emit("project-save-error", e.message);
    }
  });

  socket.on("save-new-project", async (data) => {
    try {
      console.log("[save-new-project] received data:", data && data.name);
    } catch (e) {}
    try {
      const row = await projectsInsert(data || {});
      socket.emit("new-project-data", row);
    } catch (err) {
      console.error("Error saving new project:", err);
      socket.emit("project-save-error", err.message);
    }
  });

  // Функция для получения статистики URLs с SQLite
  const getUrlsStats = async (projectId) => {
    try {
      const rows = await dbAll(
        "SELECT type, COUNT(*) as count FROM urls WHERE project_id = ? GROUP BY type",
        [projectId]
      );

      const statusCounts = {};
      const dailyStats = {};
      let totalUrls = 0;

      for (const row of rows) {
        statusCounts[row.type || "unknown"] = row.count;
        totalUrls += row.count;
      }

      // Получаем дневную статистику
      const dailyRows = await dbAll(
        `SELECT DATE(created_at) as day, COUNT(*) as count 
         FROM urls WHERE project_id = ? 
         GROUP BY DATE(created_at)`,
        [projectId]
      );

      for (const row of dailyRows) {
        dailyStats[row.day] = row.count;
      }

      return {
        totalUrls,
        statusCounts,
        dailyStats,
        lastUpdated: new Date().toISOString(),
      };
    } catch (err) {
      console.error(`Error getting stats for project ${projectId}:`, err);
      return {
        totalUrls: 0,
        statusCounts: {},
        dailyStats: {},
        lastUpdated: new Date().toISOString(),
      };
    }
  };

  socket.on("get-project-stats", async (projectId) => {
    try {
      // Сначала синхронизируем статистику
      await syncProjectStats(projectId);

      // Затем получаем актуальную статистику
      const stats = await getUrlsStats(projectId);
      socket.emit("project-stats-data", stats);
    } catch (err) {
      socket.emit("project-stats-error", err.message);
    }
  });

  socket.on("get-all-data", async (data) => {
    try {
      console.log("get-all-data received:", data);
      const dbTable = data.db || "urls";
      console.log("dbTable:", dbTable);

      let query, params;

      // Define which fields are stored in JSON content vs database columns
      const jsonFields = [
        "title",
        "titleLength",
        "h1",
        "h1quantity",
        "description",
        "descriptionLength",
        "linksLength",
        "content_length",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "canonical",
        "robots",
        "viewport",
        "charset",
        "lang",
        "keywords",
        "author",
        "publisher",
        "article_author",
        "article_published_time",
        "article_modified_time",
        "og_title",
        "og_description",
        "og_image",
        "twitter_title",
        "twitter_description",
        "twitter_image",
        "schema_type",
        "schema_name",
        "breadcrumbs",
        "images_count",
        "links_internal",
        "links_external",
        "forms_count",
        "scripts_count",
        "styles_count",
        "text_length",
        "word_count",
        "paragraph_count",
        "meta_description",
        "meta_keywords",
        "links_count",
        "words_count",
        "error_type",
        "error_message",
      ];

      // Database columns that actually exist
      const dbColumns = [
        "id",
        "project_id",
        "type",
        "url",
        "referrer",
        "depth",
        "code",
        "contentType",
        "protocol",
        "location",
        "actualDataSize",
        "requestTime",
        "requestLatency",
        "downloadTime",
        "status",
        "date",
        "created_at",
      ];

      if (dbTable === "disallow") {
        // For disallow table, all fields are database columns
        query = "SELECT * FROM disallowed WHERE project_id = ?";
        params = [data.id];
      } else {
        // For urls table, we need to handle both DB columns and JSON fields
        query = "SELECT * FROM urls WHERE project_id = ?";
        params = [data.id];

        // For other types besides urls, add type filter
        if (dbTable !== "urls") {
          query += " AND type = ?";
          params.push(dbTable);
        }
      }

      console.log("Final query:", query);
      console.log("Query params:", params);

      const rows = await dbAll(query, params);
      console.log("Query result rows:", rows ? rows.length : "null");

      // Process the results to extract JSON fields
      let processedRows = rows || [];

      if (
        dbTable !== "disallow" &&
        data.fields &&
        Object.keys(data.fields).length > 0
      ) {
        const requestedFields = Object.keys(data.fields).filter(
          (f) => data.fields[f] === 1
        );

        processedRows = rows.map((row) => {
          let processedRow = { ...row };

          // Parse content JSON if it exists
          if (row.content) {
            try {
              const contentData = JSON.parse(row.content);

              // Extract requested JSON fields
              requestedFields.forEach((field) => {
                if (
                  jsonFields.includes(field) &&
                  contentData[field] !== undefined
                ) {
                  processedRow[field] = contentData[field];
                }
              });
            } catch (e) {
              console.warn("Failed to parse content JSON:", e);
            }
          }

          // Filter to only include requested fields
          const filteredRow = {};
          requestedFields.forEach((field) => {
            if (processedRow[field] !== undefined) {
              filteredRow[field] = processedRow[field];
            }
          });

          // Always include id
          filteredRow.id = row.id;

          return filteredRow;
        });
      }

      console.log("Processed rows count:", processedRows.length);
      socket.emit("urls-all-data", processedRows);
    } catch (err) {
      console.error("get-all-data error:", err);
      socket.emit("urls-all-data", []);
    }
  });

  // Новый метод для ручной синхронизации статистики
  socket.on("sync-project-stats", async (projectId) => {
    try {
      const stats = await syncProjectStats(projectId);
      socket.emit("project-stats-synced", {
        success: true,
        projectId,
        stats,
      });
    } catch (err) {
      console.error("Error syncing project stats:", err);
      socket.emit("project-stats-synced", {
        success: false,
        projectId,
        error: err.message,
      });
    }
  });

  socket.on("delete-all", async (id) => {
    if (!id) return;
    try {
      console.log(`Начинаем очистку данных проекта ${id} (crawler data only)`);
      // НЕ удаляем ключевые запросы - они очищаются отдельно через keywords:clear

      // 1. Удаляем все URL из базы данных
      const urlsDeleted = await dbRun("DELETE FROM urls WHERE project_id = ?", [
        id,
      ]);

      // 2. Удаляем все disallowed URL
      const disallowedDeleted = await dbRun(
        "DELETE FROM disallowed WHERE project_id = ?",
        [id]
      );
      console.log(
        `✅ Удалено ${disallowedDeleted.changes || 0} URL из таблицы disallowed`
      );

      // 3. Обнуляем статистику проекта - отправляем обновленную статистику
      const { getProjectStats } = require("./db-sqlite.cjs");
      const updatedStats = await getProjectStats(Number(id));

      // Отправляем обновленную статистику
      if (updatedStats) {
        socket.emit("stat-html", {
          count: updatedStats.html || 0,
          projectId: Number(id),
        });
        socket.emit("stat-jscss", {
          count: updatedStats.jscss || 0,
          projectId: Number(id),
        });
        socket.emit("stat-image", {
          count: updatedStats.image || 0,
          projectId: Number(id),
        });
        socket.emit("stat-redirect", {
          count: updatedStats.redirect || 0,
          projectId: Number(id),
        });
        socket.emit("stat-error", {
          count: updatedStats.error || 0,
          projectId: Number(id),
        });
        socket.emit("stat-other", {
          count: updatedStats.other || 0,
          projectId: Number(id),
        });
        socket.emit("stat-depth3", {
          count: updatedStats.depth3 || 0,
          projectId: Number(id),
        });
        socket.emit("stat-depth5", {
          count: updatedStats.depth5 || 0,
          projectId: Number(id),
        });
        socket.emit("stat-depth6", {
          count: updatedStats.depth6 || 0,
          projectId: Number(id),
        });
        socket.emit("fetched", {
          projectId: Number(id),
          fetched: updatedStats.fetched || 0,
        });
        socket.emit("disallow", updatedStats.disallow || 0);
        console.log(`📊 Статистика обновлена для проекта ${id}:`, updatedStats);
      }

      // 4. Размораживаем проект (устанавливаем freezed = false)
      await dbRun(
        "UPDATE projects SET freezed = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [id]
      );

      // 5. Удаляем файл очереди
      const queueFilePath = queuePath(id);

      if (fs.existsSync(queueFilePath)) {
        try {
          fs.unlinkSync(queueFilePath);
          console.log(`✅ Файл очереди удален: ${queueFilePath}`);
        } catch (fileError) {
          console.log(
            `⚠️ Ошибка при удалении файла очереди: ${fileError.message}`
          );
        }
      } else {
        console.log(`ℹ️ Файл очереди не найден: ${queueFilePath}`);
      }

      // 6. Очищаем счетчик очереди в интерфейсе
      socket.emit("queue", { projectId: Number(id), queue: 0 });
      console.log(`📊 Счетчик очереди очищен для проекта ${id}`);

      // 7. Обновляем размер очереди в базе данных
      const { updateProjectQueueStats } = require("./db-sqlite.cjs");
      await updateProjectQueueStats(Number(id), 0, socket);
      console.log(`💾 Размер очереди в БД обновлен до 0 для проекта ${id}`);

      // 7. Также удаляем папку проекта, если она пуста
      const userDataPath = app ? app.getPath("userData") : "./";
      const projectDir = path.join(userDataPath, "db", id.toString());
      if (fs.existsSync(projectDir)) {
        try {
          const files = fs.readdirSync(projectDir);
          if (files.length === 0) {
            fs.rmdirSync(projectDir);
          } else {
            console.log(
              `📂 Папка проекта содержит файлы, не удаляем: ${projectDir}`
            );
          }
        } catch (dirError) {
          console.log(
            `⚠️ Ошибка при удалении папки проекта: ${dirError.message}`
          );
        }
      }

      // Отправляем событие очистки данных краулера вместо deleted
      socket.emit("crawler-data-cleared", { projectId: id });
    } catch (err) {
      console.error("delete-all error:", err);
      socket.emit("delete-error", err.message);
    }
  });

  socket.on("delete-project", async (id) => {
    if (!id) return;
    try {
      console.log(`Начинаем удаление проекта ${id}`);
      // Удаляем все ключевые запросы проекта перед удалением самого проекта
      await keywordsClear(Number(id));
      console.log(`Ключевые запросы проекта ${id} удалены`);
      await projectsRemove(Number(id));
      console.log(`Проект ${id} удален`);
      // Notify client with deleted project id for UI update
      socket.emit("projectDeleted", Number(id));
    } catch (err) {
      console.error(`Error deleting SQLite project ${id}:`, err);
      socket.emit("projectDeleteError", err.message);
    }
  });
};
