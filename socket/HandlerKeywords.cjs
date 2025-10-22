/**
 * Handler для операций с ключевыми словами через Socket.IO
 * Взаимодействует с таблицей keywords в SQLite и синхронизирует с Pinia store
 */

const {
  keywordsFindByProject,
  keywordsCountByProject,
  keywordsInsert,
  keywordsInsertBatch,
  keywordsRemove,
  keywordsClear,
  keywordsDelete,
} = require("./db-sqlite.cjs");
const { fetchEmbeddings } = require("../worker/embeddingsClassifier.cjs");
const db = require("./db-sqlite.cjs");
const path = require("path");
// Load repo-level env file (created at project root) so OPENAI_API_KEY is available
try {
  const dotenv = require("dotenv");
  dotenv.config({ path: path.join(__dirname, "..", "env") });
} catch (e) {
  // If dotenv isn't installed, try to load the env file manually so OPENAI_API_KEY
  // is still available to spawned workers. This avoids a hard dependency on dotenv.
  try {
    const fs = require("fs");
    const envPath = path.join(__dirname, "..", "env");
    if (fs.existsSync(envPath)) {
      const txt = fs.readFileSync(envPath, "utf8");
      txt.split(/\r?\n/).forEach((line) => {
        line = line.trim();
        if (!line || line.startsWith("#")) return;
        const idx = line.indexOf("=");
        if (idx <= 0) return;
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      });
    }
  } catch (e2) {
    // ignore
  }
}

// Informative log if OPENAI key is missing at this point
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "OPENAI_API_KEY not found in environment; categorization worker will fail unless it's exported or placed in the repo 'env' file."
  );
}

async function attachEmbeddingsToKeywords(keywords, opts = {}) {
  const chunkSize = opts.chunkSize || 50;
  const fetchOptions = opts.fetchOptions || {};

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return { total: 0, embedded: 0, fetched: 0 };
  }

  const textToIndices = new Map();

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const text = typeof kw.keyword === "string" ? kw.keyword.trim() : "";
    keywords[i].embedding = null;
    if (!text) continue;
    if (!textToIndices.has(text)) textToIndices.set(text, []);
    textToIndices.get(text).push(i);
  }

  const toFetch = [];

  for (const [text, indices] of textToIndices.entries()) {
    try {
      const cached = await db.embeddingsCacheGet(text);
      if (
        cached &&
        Array.isArray(cached.embedding) &&
        cached.embedding.length
      ) {
        for (const idx of indices) {
          keywords[idx].embedding = cached.embedding;
        }
        continue;
      }
    } catch (e) {
      // ignore cache read errors and fall back to fetching
    }
    toFetch.push(text);
  }

  let fetched = 0;

  for (let start = 0; start < toFetch.length; start += chunkSize) {
    const chunk = toFetch.slice(start, start + chunkSize);
    const vectors = await fetchEmbeddings(chunk, fetchOptions);
    for (let i = 0; i < chunk.length; i++) {
      const vec = vectors[i];
      const text = chunk[i];
      if (Array.isArray(vec) && vec.length) {
        fetched++;
        const idxs = textToIndices.get(text) || [];
        for (const idx of idxs) {
          keywords[idx].embedding = vec;
        }
        try {
          await db.embeddingsCachePut(text, vec);
        } catch (e) {
          // ignore cache write errors
        }
      }
    }
  }

  let embedded = 0;
  for (const kw of keywords) {
    if (Array.isArray(kw.embedding) && kw.embedding.length) embedded++;
  }

  return {
    total: keywords.length,
    embedded,
    fetched,
    missing: keywords.length - embedded,
  };
}

const registerKeywords = (io, socket) => {
  // Получить ключевые запросы для проекта
  socket.on("keywords:get", async (data) => {
    try {
      const projectId = data.projectId;
      const skip = data.skip ?? 0;
      const limit = data.limit ?? 100;
      const sort = data.sort ?? null;
      // Support optional search query passed as 'searchQuery' or 'query'
      const query = data.searchQuery ?? data.query ?? null;
      const timeoutId = data.timeoutId;
      if (!projectId) {
        socket.emit("keywords:error", { message: "projectId is required" });
        return;
      }

      console.log(
        `🔍 Getting keywords for project ${projectId}, skip: ${skip}, limit: ${limit}`
      );

      console.log("Calling keywordsFindByProject with:", {
        projectId,
        skip,
        limit,
        sort,
        query,
      });
      const keywords = await keywordsFindByProject(projectId, {
        skip,
        limit,
        sort,
        query,
      });
      const totalCount = await keywordsCountByProject(projectId, query);

      console.log(`📊 Found ${keywords.length} keywords, total: ${totalCount}`);

      socket.emit("keywords:list", {
        projectId,
        keywords,
        totalCount,
        skip,
        limit,
        hasMore: skip + limit < totalCount,
        timeoutId, // Передаем timeoutId обратно для отмены
        searchQuery: query || undefined,
      });
    } catch (error) {
      console.error("Error getting keywords:", error);
      socket.emit("keywords:error", { message: "Failed to get keywords" });
    }
  });

  // Загрузить дополнительные ключевые запросы (пагинация)
  socket.on("keywords:load-more", async (data) => {
    try {
      const { projectId, skip = 0, limit = 100 } = data;
      if (!projectId) {
        socket.emit("keywords:error", { message: "projectId is required" });
        return;
      }

      // Support optional search query for load-more as well
      const query = data.searchQuery ?? data.query ?? null;
      const keywords = await keywordsFindByProject(projectId, {
        skip,
        limit,
        query,
      });
      const totalCount = await keywordsCountByProject(projectId, query);

      socket.emit("keywords:loaded-more", {
        projectId,
        keywords,
        totalCount,
        skip,
        limit,
        hasMore: skip + limit < totalCount,
        searchQuery: query || undefined,
      });
    } catch (error) {
      console.error("Error loading more keywords:", error);
      socket.emit("keywords:error", {
        message: "Failed to load more keywords",
      });
    }
  });

  // Добавить ключевые запросы
  socket.on("keywords:add", async (data) => {
    try {
      const { projectId, keywords, createdAt } = data;
      if (!projectId || !keywords) {
        socket.emit("keywords:error", {
          message: "projectId and keywords are required",
        });
        return;
      }

      // Разделяем по запятым или новой строке
      const parsedKeywords = keywords
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      const totalKeywords = parsedKeywords.length;
      const showProgress = totalKeywords > 20000;

      console.log(
        `🔄 Начинаем добавление ${totalKeywords} ключевых слов для проекта ${projectId}`
      );

      // Атомарная вставка всех ключевых слов с прогрессом
      const batchResult = await keywordsInsertBatch(
        projectId,
        parsedKeywords,
        createdAt,
        // Коллбек для отправки прогресса
        (progressData) => {
          socket.emit("keywords:progress", {
            projectId,
            progress: progressData.progress,
            processed: progressData.processed,
            total: progressData.total,
          });
        }
      );

      if (!batchResult.success) {
        console.error("❌ Ошибка при атомарной вставке:", batchResult.error);
        socket.emit("keywords:error", {
          message: `Ошибка при добавлении ключевых слов: ${batchResult.error}`,
        });
        return;
      }

      const addedKeywords = batchResult.added;
      console.log(
        `✅ Успешно добавлено ${addedKeywords.length}/${totalKeywords} ключевых слов`
      );

      // Прогресс уже отправлен в реальном времени через коллбек

      // Отправляем финальный прогресс 100% для больших объемов
      if (showProgress) {
        socket.emit("keywords:progress", {
          projectId,
          progress: 100,
          processed: totalKeywords,
          total: totalKeywords,
        });
      }

      // Apply stop-words rules to keywords so newly added keywords get blocked if necessary
      try {
        const db = require("./db-sqlite.cjs");
        const applyRes = await db.keywordsApplyStopWords(projectId);
        console.log(
          `Applied stop-words to keywords after add for ${projectId}:`,
          applyRes
        );
      } catch (e) {
        console.error("Error applying stop-words after keywords:add:", e);
      }

      // Получаем обновленный список (текущее окно данных)
      const currentWindowStart = data.windowStart || 0;
      const allKeywords = await keywordsFindByProject(projectId, {
        skip: currentWindowStart,
        limit: data.windowSize || 300,
      });
      const totalCount = await keywordsCountByProject(projectId);

      // Эмитим обновление только для текущего клиента
      socket.emit("keywords:added", { projectId, added: addedKeywords });

      // Эмитим для всех подключенных клиентов в комнате проекта (кроме текущего)
      socket.to(`project_${projectId}`).emit("keywords:list", {
        projectId,
        keywords: allKeywords,
        totalCount,
        skip: 0,
        limit: 100,
        hasMore: 100 < totalCount,
      });
    } catch (error) {
      console.error("Error adding keywords:", error);
      socket.emit("keywords:error", { message: "Failed to add keywords" });
    }
  });

  // Удалить ключевое слово
  socket.on("keywords:remove", async (data) => {
    try {
      const { projectId, keyword } = data;
      if (!projectId || !keyword) {
        socket.emit("keywords:error", {
          message: "projectId and keyword are required",
        });
        return;
      }

      const success = await keywordsRemove(projectId, keyword);
      if (success) {
        // Получаем обновленный список (текущее окно данных)
        const currentWindowStart = data.windowStart || 0;
        const allKeywords = await keywordsFindByProject(projectId, {
          skip: currentWindowStart,
          limit: data.windowSize || 300,
        });
        const totalCount = await keywordsCountByProject(projectId);

        socket.emit("keywords:removed", { projectId, keyword });
        console.log("Emitting keywords:list", {
          projectId,
          keywords: allKeywords.length,
          totalCount,
          skip: currentWindowStart,
          limit: data.windowSize || 300,
          hasMore: currentWindowStart + (data.windowSize || 300) < totalCount,
        });
        socket.emit("keywords:list", {
          projectId,
          keywords: allKeywords,
          totalCount,
          skip: currentWindowStart,
          limit: data.windowSize || 300,
          hasMore: currentWindowStart + (data.windowSize || 300) < totalCount,
        });

        // Эмитим для всех подключенных клиентов
        socket.to(`project_${projectId}`).emit("keywords:list", {
          projectId,
          keywords: allKeywords,
          totalCount,
          skip: 0,
          limit: 100,
          hasMore: 100 < totalCount,
        });
      } else {
        socket.emit("keywords:error", {
          message: "Keyword not found or failed to remove",
        });
      }
    } catch (error) {
      console.error("Error removing keyword:", error);
      socket.emit("keywords:error", { message: "Failed to remove keyword" });
    }
  });

  // Удалить ключевое слово по id
  socket.on("keywords:delete", async (data) => {
    try {
      const { id, projectId } = data;
      if (!id || !projectId) {
        socket.emit("keywords:error", {
          message: "id and projectId are required",
        });
        return;
      }

      console.log(`🗑️ Deleting keyword ${id} for project ${projectId}`);
      const success = await keywordsDelete(id);

      if (!success) {
        socket.emit("keywords:error", {
          message: "Failed to delete keyword",
        });
        return;
      }

      // Получаем обновленный список (текущее окно данных)
      const allKeywords = await keywordsFindByProject(projectId, {
        skip: 0,
        limit: 300,
      });
      const totalCount = await keywordsCountByProject(projectId);
      console.log(
        "After delete - allKeywords length:",
        allKeywords.length,
        "totalCount:",
        totalCount
      );

      console.log("Emitting keywords:list after delete", {
        projectId,
        keywords: allKeywords.length,
        totalCount,
        skip: 0,
        limit: 300,
        hasMore: 300 < totalCount,
      });
      console.log("allKeywords sample:", allKeywords.slice(0, 3));
      socket.emit("keywords:list", {
        projectId,
        keywords: allKeywords,
        totalCount,
        skip: 0,
        limit: 300,
        hasMore: 300 < totalCount,
      });

      // Эмитим для всех подключенных клиентов
      socket.to(`project_${projectId}`).emit("keywords:list", {
        projectId,
        keywords: allKeywords,
        totalCount,
        skip: 0,
        limit: 300,
        hasMore: 300 < totalCount,
      });
    } catch (error) {
      console.error("Error deleting keyword:", error);
      socket.emit("keywords:error", { message: "Failed to delete keyword" });
    }
  });

  // Поиск ключевых слов
  socket.on("keywords:search", async (data) => {
    try {
      const { projectId, query, skip = 0, limit = 300 } = data;
      if (!projectId || !query) {
        socket.emit("keywords:error", {
          message: "projectId and query are required",
        });
        return;
      }

      console.log(
        `🔍 Searching keywords for project ${projectId} with query: "${query}"`
      );
      const keywords = await keywordsFindByProject(projectId, {
        query,
        skip,
        limit,
      });
      const totalCount = await keywordsCountByProject(projectId, query); // Количество найденных

      socket.emit("keywords:list", {
        projectId,
        keywords,
        totalCount,
        skip,
        limit,
        hasMore: skip + limit < totalCount,
        searchQuery: query, // Добавляем для индикации поиска
      });
    } catch (error) {
      console.error("Error searching keywords:", error);
      socket.emit("keywords:error", { message: "Failed to search keywords" });
    }
  });

  // Очистить все ключевые запросы
  socket.on("keywords:clear", async (data) => {
    try {
      const { projectId } = data;
      if (!projectId) {
        socket.emit("keywords:error", { message: "projectId is required" });
        return;
      }

      const success = await keywordsClear(projectId);
      if (success) {
        socket.emit("keywords:cleared", { projectId });
        socket.emit("keywords:list", { projectId, keywords: [] });

        // Эмитим для всех подключенных клиентов
        socket
          .to(`project_${projectId}`)
          .emit("keywords:list", { projectId, keywords: [] });
      } else {
        socket.emit("keywords:error", { message: "Failed to clear keywords" });
      }
    } catch (error) {
      console.error("Error clearing keywords:", error);
      socket.emit("keywords:error", { message: "Failed to clear keywords" });
    }
  });

  // Экспорт ключевых слов для Excel
  socket.on("keywords:export", async (data) => {
    try {
      const { projectId } = data;
      if (!projectId) {
        socket.emit("keywords:error", { message: "projectId is required" });
        return;
      }

      const keywords = await keywordsFindByProject(projectId);
      socket.emit("keywords:export-data", { projectId, keywords });
    } catch (error) {
      console.error("Error exporting keywords:", error);
      socket.emit("keywords:error", { message: "Failed to export keywords" });
    }
  });

  // --- Stop words handlers ---
  socket.on("stopwords:get", async (data) => {
    try {
      const { projectId, skip = 0, limit = 300 } = data;
      if (!projectId) {
        socket.emit("stopwords:error", { message: "projectId is required" });
        return;
      }
      const db = require("./db-sqlite.cjs");
      const res = await db.stopWordsFindByProject(projectId, { skip, limit });
      socket.emit("stopwords:list", {
        projectId,
        stopWords: res.stopWords,
        totalCount: res.total,
        skip: res.skip,
        limit: res.limit,
        hasMore: res.skip + res.limit < res.total,
      });
    } catch (err) {
      console.error("stopwords:get error:", err);
      socket.emit("stopwords:error", { message: "Failed to get stopwords" });
    }
  });

  socket.on("stopwords:add", async (data) => {
    try {
      const { projectId, words } = data; // words: string with lines or array
      if (!projectId || !words) {
        socket.emit("stopwords:error", {
          message: "projectId and words are required",
        });
        return;
      }
      const db = require("./db-sqlite.cjs");
      const arr = Array.isArray(words)
        ? words
        : String(words)
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
      const res = await db.stopWordsInsertBatch(
        projectId,
        arr,
        new Date().toISOString()
      );
      if (!res.success) {
        socket.emit("stopwords:error", {
          message: res.error || "Insert failed",
        });
        return;
      }
      // Emit only to caller the added items and to room the refreshed list
      socket.emit("stopwords:added", { projectId, added: res.added });
      const list = await db.stopWordsFindByProject(projectId, {
        skip: 0,
        limit: 300,
      });
      // Recalculate keywords target flags based on new stop-words
      try {
        const applyRes = await db.keywordsApplyStopWords(projectId);
        console.log(
          `Applied stop-words to keywords for ${projectId}:`,
          applyRes
        );
        // Emit updated keywords list for current window to room
        const keywordsWindow = await db.keywordsFindByProject(projectId, {
          skip: 0,
          limit: 300,
        });
        const totalCount = await db.keywordsCountByProject(projectId);
        socket.emit("keywords:list", {
          projectId,
          keywords: keywordsWindow,
          totalCount,
          skip: 0,
          limit: 300,
          hasMore: 300 < totalCount,
        });
        socket.to(`project_${projectId}`).emit("keywords:list", {
          projectId,
          keywords: keywordsWindow,
          totalCount,
          skip: 0,
          limit: 300,
          hasMore: 300 < totalCount,
        });
      } catch (e) {
        console.error("Error applying stop-words after add:", e);
      }
      socket.to(`project_${projectId}`).emit("stopwords:list", {
        projectId,
        stopWords: list.stopWords,
        totalCount: list.total,
        skip: list.skip,
        limit: list.limit,
        hasMore: list.skip + list.limit < list.total,
      });
    } catch (err) {
      console.error("stopwords:add error:", err);
      socket.emit("stopwords:error", { message: "Failed to add stopwords" });
    }
  });

  socket.on("stopwords:remove", async (data) => {
    try {
      const { projectId, word } = data;
      if (!projectId || !word) {
        socket.emit("stopwords:error", {
          message: "projectId and word are required",
        });
        return;
      }
      const db = require("./db-sqlite.cjs");
      const ok = await db.stopWordsRemove(projectId, word);
      if (ok) {
        socket.emit("stopwords:removed", { projectId, word });
        const list = await db.stopWordsFindByProject(projectId, {
          skip: 0,
          limit: 300,
        });
        // Recalculate keywords target flags after removal
        try {
          const applyRes = await db.keywordsApplyStopWords(projectId);
          console.log(
            `Applied stop-words to keywords for ${projectId}:`,
            applyRes
          );
          const keywordsWindow = await db.keywordsFindByProject(projectId, {
            skip: 0,
            limit: 300,
          });
          const totalCount = await db.keywordsCountByProject(projectId);
          socket.emit("keywords:list", {
            projectId,
            keywords: keywordsWindow,
            totalCount,
            skip: 0,
            limit: 300,
            hasMore: 300 < totalCount,
          });
          socket.to(`project_${projectId}`).emit("keywords:list", {
            projectId,
            keywords: keywordsWindow,
            totalCount,
            skip: 0,
            limit: 300,
            hasMore: 300 < totalCount,
          });
        } catch (e) {
          console.error("Error applying stop-words after remove:", e);
        }
        socket.to(`project_${projectId}`).emit("stopwords:list", {
          projectId,
          stopWords: list.stopWords,
          totalCount: list.total,
          skip: list.skip,
          limit: list.limit,
          hasMore: list.skip + list.limit < list.total,
        });
      } else {
        socket.emit("stopwords:error", {
          message: "Failed to remove stopword",
        });
      }
    } catch (err) {
      console.error("stopwords:remove error:", err);
      socket.emit("stopwords:error", { message: "Failed to remove stopword" });
    }
  });

  socket.on("stopwords:clear", async (data) => {
    try {
      const { projectId } = data;
      if (!projectId) {
        socket.emit("stopwords:error", { message: "projectId is required" });
        return;
      }
      const db = require("./db-sqlite.cjs");
      const ok = await db.stopWordsClear(projectId);
      if (ok) {
        socket.emit("stopwords:cleared", { projectId });
        // After clearing stop-words, ensure keywords are marked target_query = 1
        try {
          const applyRes = await db.keywordsApplyStopWords(projectId);
          console.log(
            `Applied stop-words to keywords for ${projectId}:`,
            applyRes
          );
          const keywordsWindow = await db.keywordsFindByProject(projectId, {
            skip: 0,
            limit: 300,
          });
          const totalCount = await db.keywordsCountByProject(projectId);
          socket.emit("keywords:list", {
            projectId,
            keywords: keywordsWindow,
            totalCount,
            skip: 0,
            limit: 300,
            hasMore: 300 < totalCount,
          });
          socket.to(`project_${projectId}`).emit("keywords:list", {
            projectId,
            keywords: keywordsWindow,
            totalCount,
            skip: 0,
            limit: 300,
            hasMore: 300 < totalCount,
          });
        } catch (e) {
          console.error("Error applying stop-words after clear:", e);
        }
        socket
          .to(`project_${projectId}`)
          .emit("stopwords:list", { projectId, stopWords: [] });
      } else {
        socket.emit("stopwords:error", {
          message: "Failed to clear stopwords",
        });
      }
    } catch (err) {
      console.error("stopwords:clear error:", err);
      socket.emit("stopwords:error", { message: "Failed to clear stopwords" });
    }
  });

  // Запустить процесс категоризации (worker)
  socket.on("keywords:start-categorization", async (data) => {
    try {
      const { projectId } = data;
      if (!projectId) {
        socket.emit("keywords:categorization-error", {
          message: "projectId is required",
        });
        return;
      }

      // Notify clients in the project room that categorization started
      socket.emit("keywords:categorization-started", { projectId });
      socket
        .to(`project_${projectId}`)
        .emit("keywords:categorization-started", { projectId });

      const { spawn } = require("child_process");
      const workerPath = require("path").join(
        __dirname,
        "..",
        "worker",
        "assignCategorization.cjs"
      );

      // Load categories and keywords from DB
      const categoriesResult =
        await require("./db-sqlite.cjs").categoriesFindByProject(projectId, {
          limit: 10000,
        });
      const categories = categoriesResult.categories || categoriesResult || [];
      // Load only keywords marked as target_query = 1 (allowed for processing)
      const keywordsAll =
        await require("./db-sqlite.cjs").keywordsFindByProject(projectId, {
          limit: 100000,
          targetOnly: true,
        });

      // Build sets of existing category ids and names to detect stale assignments
      const existingCategoryIds = new Set(
        (categories || []).map((c) => Number(c.id))
      );
      const existingCategoryNames = new Set(
        (categories || [])
          .map((c) => (c.category_name || "").toString().toLowerCase())
          .filter(Boolean)
      );

      // Prepare keywords to send to worker: all target keywords for re-categorization
      const db = require("./db-sqlite.cjs");
      const keywords = (keywordsAll || []).map((kw) => ({
        ...kw,
        category_id: null,
        category_name: null,
        category_similarity: null,
        class_name: null,
        class_similarity: null,
      }));

      // If there are no keywords for this project, emit an error and skip spawning.
      if (
        !keywordsAll ||
        !Array.isArray(keywordsAll) ||
        keywordsAll.length === 0
      ) {
        console.warn(
          `Clustering: no keywords found for project ${projectId}; aborting clustering run.`
        );
        socket.emit("keywords:clustering-error", {
          projectId,
          message: "No keywords found for project; clustering aborted.",
        });
        socket.to(`project_${projectId}`).emit("keywords:clustering-error", {
          projectId,
          message: "No keywords found for project; clustering aborted.",
        });
        return;
      }

      // Write input JSON to a temporary file and spawn worker with --inputFile to avoid stdin/EPIPE issues
      const fs = require("fs");
      const os = require("os");
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "sa-worker-")
      );
      const inputPath = path.join(tmpDir, `input-${Date.now()}.json`);
      const input = JSON.stringify({ categories, keywords });
      try {
        await fs.promises.writeFile(inputPath, input, "utf8");
      } catch (e) {
        console.error("Failed to write worker input file:", e.message || e);
        socket.emit("keywords:categorization-error", {
          projectId,
          message: String(e),
        });
        return;
      }

      const child = spawn(
        "node",
        [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`],
        {
          env: Object.assign({}, process.env),
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      let processed = 0;
      // Read JSONL results from worker stdout line by line
      const readline = require("readline");
      const rl = readline.createInterface({ input: child.stdout });
      rl.on("line", async (line) => {
        console.log("[categorization stdout line]", line);
        if (!line) return;
        try {
          const obj = JSON.parse(line);
          // Persist result to DB: always write class_*; fill category_* only if empty
          try {
            const db = require("./db-sqlite.cjs");
            const cid = obj.bestCategoryId ?? null;
            const cname = obj.bestCategoryName ?? null;
            const csim = obj.similarity ?? null;

            // Write category_* always for categorization worker
            await db.dbRun(
              `UPDATE keywords
               SET
                 category_name = ?,
                 category_similarity = ?
               WHERE id = ?`,
              [cname, csim, obj.id]
            );

            // Fetch the updated row and emit an update event so UI can refresh this row immediately
            try {
              const updated = await db.dbGet(
                `SELECT * FROM keywords WHERE id = ?`,
                [obj.id]
              );
              if (updated) {
                socket.emit("keywords:updated", {
                  projectId,
                  keyword: updated,
                });
                socket.to(`project_${projectId}`).emit("keywords:updated", {
                  projectId,
                  keyword: updated,
                });
              }
            } catch (e2) {
              // If fetching updated row fails, still continue
              console.error(
                "Failed to fetch updated keyword:",
                e2.message || e2
              );
            }
          } catch (e) {
            console.error(
              "Failed to update keyword from worker result:",
              e.message || e
            );
          }

          // Emit progress per result
          processed += 1;
          const perc = Math.round(
            (processed / Math.max(1, keywords.length)) * 100
          );
          socket.emit("keywords:categorization-progress", {
            projectId,
            percentage: perc,
          });
          socket
            .to(`project_${projectId}`)
            .emit("keywords:categorization-progress", {
              projectId,
              percentage: perc,
            });
        } catch (err) {
          console.error(
            "Invalid JSON from worker stdout:",
            err.message || err,
            line
          );
        }
      });

      let apiKeyErrorSent = false;

      child.stderr.on("data", (chunk) => {
        const text = String(chunk).trim();
        try {
          const lower = text.toLowerCase();
          if (
            !apiKeyErrorSent &&
            (lower.includes("invalid_api_key") ||
              lower.includes("incorrect api key") ||
              lower.includes("неверный") ||
              lower.includes("недействительный") ||
              lower.includes("401"))
          ) {
            // Не отправляем ошибку API ключа сразу, а только если worker завершится с ошибкой
            apiKeyErrorSent = true;
          }
        } catch (e) {
          // ignore parsing errors
        }
      });

      child.on("close", (code) => {
        // cleanup temp file/dir
        try {
          fs.promises.unlink(inputPath).catch(() => {});
          fs.promises.rmdir(tmpDir).catch(() => {});
        } catch (e) {}
        if (code === 0) {
          socket.emit("keywords:categorization-finished", { projectId, code });
          socket
            .to(`project_${projectId}`)
            .emit("keywords:categorization-finished", { projectId, code });
        } else {
          let msg = `Categorization worker failed with exit code ${code}`;
          if (apiKeyErrorSent) {
            msg =
              "Ошибка: неверный или недействительный OpenAI API ключ (OPENAI_API_KEY).";
          }
          socket.emit("keywords:categorization-error", {
            projectId,
            message: msg,
          });
          socket
            .to(`project_${projectId}`)
            .emit("keywords:categorization-error", { projectId, message: msg });
        }
      });

      child.on("error", (err) => {
        socket.emit("keywords:categorization-error", {
          projectId,
          message: String(err),
        });
        socket
          .to(`project_${projectId}`)
          .emit("keywords:categorization-error", {
            projectId,
            message: String(err),
          });
      });
    } catch (error) {
      socket.emit("keywords:categorization-error", {
        message: "Failed to start categorization",
      });
    }
  });

  // Запуск классификации по типам (typing)
  socket.on("keywords:start-typing", async (data) => {
    try {
      const { projectId } = data;
      if (!projectId) {
        socket.emit("keywords:typing-error", {
          message: "projectId is required",
        });
        return;
      }

      console.log(`🔨 Starting typing worker for project ${projectId}`);

      // Notify clients in the project room that typing started
      socket.emit("keywords:typing-started", { projectId });
      socket
        .to(`project_${projectId}`)
        .emit("keywords:typing-started", { projectId });

      const { spawn } = require("child_process");
      const workerPath = require("path").join(
        __dirname,
        "..",
        "worker",
        "trainAndClassify.cjs"
      );

      // Load keywords to process
      const keywordsAll =
        await require("./db-sqlite.cjs").keywordsFindByProject(projectId, {
          limit: 100000,
          targetOnly: true,
        });

      // Write input JSON to a temporary file
      const fs = require("fs");
      const os = require("os");
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "sa-worker-")
      );
      const inputPath = path.join(tmpDir, `input-typing-${Date.now()}.json`);
      const workerPayload = {
        keywords: keywordsAll.map((kw) => ({
          id: kw.id,
          keyword: kw.keyword,
          embedding: kw.embedding,
        })),
      };
      const input = JSON.stringify(workerPayload);
      try {
        await fs.promises.writeFile(inputPath, input, "utf8");
      } catch (e) {
        console.error(
          "Failed to write typing worker input file:",
          e.message || e
        );
        socket.emit("keywords:typing-error", {
          projectId,
          message: String(e),
        });
        return;
      }

      const child = spawn(
        "node",
        [workerPath, `--projectId=${projectId}`, `--inputFile=${inputPath}`],
        {
          env: Object.assign({}, process.env),
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      let processed = 0;
      // Read JSONL results from worker stdout line by line
      const readline = require("readline");
      const rl = readline.createInterface({ input: child.stdout });
      rl.on("line", async (line) => {
        if (!line) return;
        try {
          const obj = JSON.parse(line);
          // Persist result to DB: write class_* always
          try {
            const db = require("./db-sqlite");
            const cname = obj.bestCategoryName ?? null;
            const csim = obj.similarity ?? null;

            // Write class_* always
            await db.dbRun(
              `UPDATE keywords
               SET
                 class_name = ?,
                 class_similarity = ?
               WHERE id = ?`,
              [cname, csim, obj.id]
            );

            // Fetch the updated row and emit an update event so UI can refresh this row immediately
            try {
              const updated = await db.dbGet(
                `SELECT * FROM keywords WHERE id = ?`,
                [obj.id]
              );
              if (updated) {
                socket.emit("keywords:updated", {
                  projectId,
                  keyword: updated,
                });
                socket.to(`project_${projectId}`).emit("keywords:updated", {
                  projectId,
                  keyword: updated,
                });
              }
            } catch (e2) {
              // If fetching updated row fails, still continue
              console.error(
                "Failed to fetch updated keyword:",
                e2.message || e2
              );
            }
          } catch (e) {
            console.error(
              "Failed to update keyword from worker result:",
              e.message || e
            );
          }
        } catch (e) {
          console.error("Failed to parse worker output:", e.message || e);
        }
      });

      let typingApiKeyErrorSent = false;

      // Handle worker stderr
      child.stderr.on("data", (data) => {
        const text = data.toString();
        console.error("[typing stderr]", text);
        // Try to extract progress info
        const progressMatch = text.match(/(\d+)%/);
        if (progressMatch) {
          const percentage = parseInt(progressMatch[1]);
          socket.emit("keywords:typing-progress", {
            projectId,
            percentage,
            processed: processed,
            total: "unknown",
          });
          socket.to(`project_${projectId}`).emit("keywords:typing-progress", {
            projectId,
            percentage,
            processed: processed,
            total: "unknown",
          });
        } else {
          // Check for API key errors
          const lower = text.toLowerCase();
          if (
            !typingApiKeyErrorSent &&
            (lower.includes("invalid_api_key") ||
              lower.includes("incorrect api key") ||
              lower.includes("неверный") ||
              lower.includes("недействительный") ||
              lower.includes("401"))
          ) {
            typingApiKeyErrorSent = true;
          }
        }
      });

      // Handle worker exit
      child.on("exit", (code) => {
        console.log(`Typing worker exited with code ${code}`);
        if (code === 0) {
          socket.emit("keywords:typing-finished", { projectId, code });
          socket
            .to(`project_${projectId}`)
            .emit("keywords:typing-finished", { projectId, code });
        } else {
          let msg = `Typing worker failed with exit code ${code}`;
          if (typingApiKeyErrorSent) {
            msg =
              "Ошибка: неверный или недействительный OpenAI API ключ (OPENAI_API_KEY).";
          }
          console.error(msg);
          socket.emit("keywords:typing-error", {
            projectId,
            message: msg,
          });
          socket.to(`project_${projectId}`).emit("keywords:typing-error", {
            projectId,
            message: msg,
          });
        }
      });

      // Handle spawn errors
      child.on("error", (err) => {
        console.error("Error spawning typing worker:", err);
        socket.emit("keywords:typing-error", {
          projectId,
          message: String(err),
        });
        socket.to(`project_${projectId}`).emit("keywords:typing-error", {
          projectId,
          message: String(err),
        });
      });
    } catch (error) {
      console.error("Error starting typing:", error);
      socket.emit("keywords:typing-error", {
        message: "Failed to start typing",
      });
    }
  });

  // Start clustering process (spawn external worker to avoid blocking main thread)
  socket.on("keywords:start-clustering", async (data) => {
    try {
      // Debug: log incoming clustering start request
      try {
        console.log(
          `Received keywords:start-clustering from socket ${socket.id}:`,
          JSON.stringify(data)
        );
        // Also append to a tmp debug file for external verification
        try {
          const _fs = require("fs");
          _fs.appendFileSync(
            "/tmp/sa-socket-debug.log",
            `received-start-clustering ${new Date().toISOString()} socket=${
              socket.id
            } data=${JSON.stringify(data)}\n`
          );
        } catch (e) {
          // ignore
        }
      } catch (e) {}
      const projectId = data.projectId;
      if (!projectId) {
        socket.emit("keywords:clustering-error", {
          message: "projectId is required",
        });
        return;
      }

      console.log(`🚀 Spawning clustering worker for project ${projectId}`);

      // Ensure previous clustering labels are cleared so each run is fresh
      try {
        const result = await db.dbRun(
          `UPDATE keywords SET cluster_label = NULL WHERE project_id = ?`,
          [projectId]
        );
        console.log(
          `Cleared previous cluster_label values for project ${projectId}: ${result.changes} rows affected`
        );
      } catch (e) {
        console.warn(
          `Failed to clear previous cluster_label for project ${projectId}: ${
            e && e.message ? e.message : e
          }`
        );
      }

      socket.emit("keywords:clustering-started", { projectId });
      socket
        .to(`project_${projectId}`)
        .emit("keywords:clustering-started", { projectId });

      // Load keywords to process
      const keywordsAll = await require("./db-sqlite").keywordsFindByProject(
        projectId,
        {
          limit: 100000,
        }
      );

      if (!Array.isArray(keywordsAll) || keywordsAll.length === 0) {
        console.warn(
          `Clustering: no keywords found for project ${projectId}; aborting clustering run.`
        );
        socket.emit("keywords:clustering-error", {
          projectId,
          message: "No keywords found for project; clustering aborted.",
        });
        socket.to(`project_${projectId}`).emit("keywords:clustering-error", {
          projectId,
          message: "No keywords found for project; clustering aborted.",
        });
        return;
      }

      let embeddingStats;
      try {
        embeddingStats = await attachEmbeddingsToKeywords(keywordsAll, {
          chunkSize: 40,
        });
      } catch (embErr) {
        console.error(
          "[clustering] Failed to prepare embeddings:",
          embErr && embErr.message ? embErr.message : embErr
        );
        const message =
          "Не удалось получить эмбеддинги для кластеризации. Проверьте OpenAI ключ.";
        socket.emit("keywords:clustering-error", { projectId, message });
        socket
          .to(`project_${projectId}`)
          .emit("keywords:clustering-error", { projectId, message });
        return;
      }

      if (!embeddingStats.embedded) {
        const message =
          "Не удалось подготовить эмбеддинги для кластеризации. Проверьте OpenAI ключ и доступность embeddings.";
        socket.emit("keywords:clustering-error", { projectId, message });
        socket
          .to(`project_${projectId}`)
          .emit("keywords:clustering-error", { projectId, message });
        return;
      }

      console.log(
        `[clustering] Prepared embeddings ${embeddingStats.embedded}/${embeddingStats.total}, fetched ${embeddingStats.fetched}`
      );

      // Write input JSON to a temporary file and spawn worker with --inputFile to avoid stdin/EPIPE issues
      const fs = require("fs");
      const os = require("os");
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "sa-cluster-")
      );
      const inputPath = path.join(tmpDir, `input-cluster-${Date.now()}.json`);
      const input = JSON.stringify({ keywords: keywordsAll });
      try {
        await fs.promises.writeFile(inputPath, input, "utf8");
      } catch (e) {
        console.error(
          "Failed to write clustering worker input file:",
          e.message || e
        );
        socket.emit("keywords:clustering-error", {
          projectId,
          message: String(e),
        });
        return;
      }

      const { spawn } = require("child_process");
      const workerPath = require("path").join(
        __dirname,
        "..",
        "worker",
        "clusterСomponents.js"
      );

      const args = [`--projectId=${projectId}`, `--inputFile=${inputPath}`];
      if (typeof data.eps !== "undefined") args.push(`--threshold=${data.eps}`);

      console.log(
        `[clustering] Threshold argument: ${
          typeof data.eps !== "undefined" ? data.eps : "default (0.5)"
        }`
      );

      const child = spawn("node", [workerPath, ...args], {
        env: Object.assign({}, process.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        console.log(
          "Clustering worker pid=",
          child.pid,
          "stdio=",
          child.stdout ? "stdout-ok" : "no-stdout"
        );
        child.stdout.on("data", (d) => {
          try {
            console.log("[clustering raw stdout chunk]", d.toString());
          } catch (e) {}
        });
      } catch (e) {}

      // Buffer stdout chunks and process JSONL lines after the child exits.
      let processed = 0;
      let stdoutBuf = [];
      child.stdout.on("data", (chunk) => {
        try {
          stdoutBuf.push(String(chunk));
        } catch (e) {}
      });

      let apiKeyErrorSent = false;
      child.stderr.on("data", (chunk) => {
        const text = String(chunk).trim();
        console.error("[clustering stderr]", text);
        // parse progress lines like '42%'
        const m = text.match(/(\d+)%/);
        if (m) {
          const percentage = parseInt(m[1]);
          socket.emit("keywords:clustering-progress", {
            projectId,
            percentage,
          });
          socket
            .to(`project_${projectId}`)
            .emit("keywords:clustering-progress", { projectId, percentage });
        }
      });

      child.on("close", async (code) => {
        // cleanup temp files
        try {
          fs.promises.unlink(inputPath).catch(() => {});
          fs.promises.rmdir(tmpDir).catch(() => {});
        } catch (e) {}
        if (code === 0) {
          // Process the buffered stdout
          try {
            const fullOutput = stdoutBuf.join("");
            const lines = fullOutput.trim().split("\n");
            for (const line of lines) {
              if (!line.trim()) continue;
              const obj = JSON.parse(line);
              if (obj.id && obj.cluster_label) {
                await db.dbRun(
                  `UPDATE keywords SET cluster_label = ? WHERE id = ?`,
                  [obj.cluster_label, obj.id]
                );
                processed++;
              }
            }
            console.log(`Updated ${processed} keywords with cluster labels`);
          } catch (e) {
            console.error("Error processing clustering output:", e);
          }
          socket.emit("keywords:clustering-finished", { projectId, code });
          socket
            .to(`project_${projectId}`)
            .emit("keywords:clustering-finished", { projectId, code });
        } else {
          let msg = `Clustering worker failed with exit code ${code}`;
          socket.emit("keywords:clustering-error", { projectId, message: msg });
          socket
            .to(`project_${projectId}`)
            .emit("keywords:clustering-error", { projectId, message: msg });
        }
      });

      child.on("error", (err) => {
        console.error("Failed to start clustering worker:", err);
        socket.emit("keywords:clustering-error", {
          projectId,
          message: String(err),
        });
        socket.to(`project_${projectId}`).emit("keywords:clustering-error", {
          projectId,
          message: String(err),
        });
      });
    } catch (error) {
      console.error("Error starting clustering:", error);
      socket.emit("keywords:clustering-error", {
        message: "Failed to start clustering",
      });
    }
  });
};

module.exports = registerKeywords;
