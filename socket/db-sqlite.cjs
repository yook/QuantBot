/**
 * Подключение к SQLite и схема таблицы projects.
 * Поля проекта соответствуют структуре:
 * {
 *   name: string,
 *   url: string,
 *   freezed: boolean,
 *   stats: { fetched, queue, disallow, html, jscss, image, redirect, error, depth3, depth5, depth6 },
 *   crawler: { maxDepth, maxConcurrency, interval, timeout, parseScriptTags, parseImages, stripQuerystring, sortQueryParameters, respectRobotsTxt, scanSubdomains, userAgent },
 *   parser: Array<{ name, prop, selector, find, attrClass, getLength }>,
 *   columns: Array<string>,
 *   created_at, updated_at
 * }
 *
 * Примечание: сложные поля хранятся как JSON-строки (TEXT).
 */
const sqlite3 = require("@vscode/sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// Ensure ./db exists. When running from an ASAR the source files are read-only,
// so prefer a writable location (userData) or allow overriding via env var.
let dbDir = path.join(__dirname, "..", "db");
// Allow explicit override (useful for packaged app main process)
if (process.env.QUANTBOT_DB_DIR) {
  dbDir = process.env.QUANTBOT_DB_DIR;
} else {
  try {
    // If module is inside an asar archive, __dirname will contain '.asar'
    if (typeof __dirname === "string" && __dirname.includes(".asar")) {
      let userData = null;
      try {
        // Try to obtain electron.app.getPath('userData') when available
        const electron = require("electron");
        if (
          electron &&
          electron.app &&
          typeof electron.app.getPath === "function"
        ) {
          userData = electron.app.getPath("userData");
        }
      } catch (e) {
        // electron may not be available when running as a standalone node process
        userData = null;
      }
      if (userData) {
        dbDir = path.join(userData, "quantbot-db");
      } else {
        // Fallback to current working directory
        dbDir = path.join(process.cwd(), "quantbot-db");
      }
    }
  } catch (e) {
    // ignore and keep default
  }
}

fs.mkdirSync(dbDir, { recursive: true });

// Path to SQLite database
const dbPath = path.join(dbDir, "projects.db");

// Open database connection (single, minimal)
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("SQLite open error:", err);
  }
});

// Apply PRAGMAs and ensure schema
db.serialize(() => {
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA synchronous=NORMAL;");
  db.run("PRAGMA cache_size = -200000;"); // ~200MB
  db.run("PRAGMA mmap_size = 268435456;"); // 256MB
  db.run("PRAGMA auto_vacuum = INCREMENTAL;");
  db.run("PRAGMA temp_store = MEMORY;");

  // Note: do NOT drop embeddings_cache on startup — preserve cache between restarts.
  // Previous migration code dropped the table here which caused the cache to be cleared
  // every time the app restarted. We keep the table if it exists and rely on
  // CREATE TABLE IF NOT EXISTS below to create it when missing.

  // Полная схема projects (без stats - выносим в отдельную таблицу)
  db.run(
    `CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url  TEXT NOT NULL,
      freezed INTEGER DEFAULT 0,
      queue_size INTEGER DEFAULT 0,
      crawler TEXT,
      parser  TEXT,
      ui_columns TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_projects_url ON projects(url);");

  // Добавляем колонку queue_size в существующую таблицу, если она еще не существует
  db.run(
    `
    PRAGMA table_info(projects);
  `,
    [],
    (err, rows) => {
      if (err) {
        console.error("Ошибка при проверке структуры таблицы projects:", err);
        return;
      }

      // Проверяем, существует ли колонка queue_size
      db.all(`PRAGMA table_info(projects)`, [], (err, columns) => {
        if (err) {
          console.error("Ошибка при получении информации о колонках:", err);
          return;
        }

        const hasQueueSizeColumn = columns.some(
          (column) => column.name === "queue_size"
        );

        if (!hasQueueSizeColumn) {
          console.log("Добавляем колонку queue_size в таблицу projects...");
          db.run(
            `ALTER TABLE projects ADD COLUMN queue_size INTEGER DEFAULT 0`,
            (err) => {
              if (err) {
                console.error("Ошибка при добавлении колонки queue_size:", err);
              } else {
                console.log("Колонка queue_size успешно добавлена");
              }
            }
          );
        }
      });
    }
  );

  // Схема таблицы urls (единая коллекция для всех типов с привязкой к проекту)
  db.run(
    `CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      type TEXT,
      url TEXT NOT NULL,
      referrer TEXT,
      depth INTEGER,
      code INTEGER,
      contentType TEXT,
      protocol TEXT,
  location TEXT,
      actualDataSize INTEGER,
      requestTime INTEGER,
      requestLatency INTEGER,
      downloadTime INTEGER,
      status TEXT,
      date TEXT,
      content TEXT, -- JSON с динамическими полями парсера
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_urls_project ON urls(project_id);");
  db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_project_url ON urls(project_id, url);"
  );

  // Схема таблицы errors (для сетевых ошибок и DNS проблем)
  db.run(
    `CREATE TABLE IF NOT EXISTS disallowed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      error_type TEXT NOT NULL, -- 'network_error', 'dns_error', 'invalid_domain', 'fetchdisallowed'
      code INTEGER DEFAULT 0,
      status TEXT,
      referrer TEXT,
      depth INTEGER,
      protocol TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_disallowed_project ON disallowed(project_id);"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_disallowed_type ON disallowed(error_type);"
  );
  // Схема таблицы keywords (ключевые запросы для проектов)
  db.run(
    `CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_keywords_project ON keywords(project_id);"
  );
  db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_project_keyword ON keywords(project_id, keyword);"
  );
  // Add columns for categorization if they don't exist
  db.run("ALTER TABLE keywords ADD COLUMN category_id INTEGER;", (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding category_id column:", err);
    }
  });
  db.run("ALTER TABLE keywords ADD COLUMN category_name TEXT;", (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding category_name column:", err);
    }
  });
  db.run("ALTER TABLE keywords ADD COLUMN category_similarity REAL;", (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding category_similarity column:", err);
    }
  });
  // New class columns for type classification
  db.run("ALTER TABLE keywords ADD COLUMN class_name TEXT;", (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding class_name column:", err);
    }
  });
  db.run("ALTER TABLE keywords ADD COLUMN class_similarity REAL;", (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding class_similarity column:", err);
    }
  });
  // New column for clustering
  db.run("ALTER TABLE keywords ADD COLUMN cluster_label TEXT;", (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding cluster_label column:", err);
    }
  });
  // Add new columns: target_query (boolean stored as INTEGER 0/1) and blocking_rule (text)
  db.run(
    "ALTER TABLE keywords ADD COLUMN target_query INTEGER DEFAULT 1;",
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Error adding target_query column:", err);
      }
    }
  );
  db.run("ALTER TABLE keywords ADD COLUMN blocking_rule TEXT;", (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding blocking_rule column:", err);
    }
  });
  // Indexes for new columns
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_keywords_category_id ON keywords(category_id);"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_keywords_category_similarity ON keywords(category_similarity);"
  );
  // Index to speed up queries filtering by target_query
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_keywords_target_query ON keywords(target_query);"
  );

  // Схема таблицы categories (категории для проектов)
  db.run(
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      category_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`,
    (err) => {
      if (err) {
        console.error("Error creating categories table:", err);
      } else {
        console.error("Categories table created or already exists");
      }
    }
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id);",
    (err) => {
      if (err) {
        console.error("Error creating categories index:", err);
      }
    }
  );
  db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_project_name ON categories(project_id, category_name);",
    (err) => {
      if (err) {
        console.error("Error creating categories unique index:", err);
      }
    }
  );

  // Схема таблицы stop_words (стоп-слова для проектов)
  db.run(
    `CREATE TABLE IF NOT EXISTS stop_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_stopwords_project ON stop_words(project_id);"
  );
  db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_stopwords_project_word ON stop_words(project_id, word);",
    (err) => {
      if (err) {
        console.error("Error creating stop_words unique index:", err);
      }
    }
  );

  // Схема таблицы typing_samples (обучающие примеры для классификации)
  db.run(
    `CREATE TABLE IF NOT EXISTS typing_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_typing_samples_project ON typing_samples(project_id);"
  );
  // Cache for embeddings to avoid repeated OpenAI requests for identical texts
  db.run(
    `CREATE TABLE IF NOT EXISTS embeddings_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      embedding BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_embeddings_cache_key ON embeddings_cache(key);"
  );
  // Ensure embedding column exists (TEXT, JSON encoded) - safe to run even if column exists
  db.run("ALTER TABLE typing_samples ADD COLUMN embedding TEXT;", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      // Some SQLite versions may report different messages; log unexpected errors
      console.warn(
        "Could not add embedding column to typing_samples:",
        err.message
      );
    }
  });

  // typing_embeddings таблица больше не используется: удаляем её, если миграция еще не проведена
  db.run("DROP TABLE IF EXISTS typing_embeddings", (err) => {
    if (err) {
      console.error("Failed to drop legacy typing_embeddings table:", err);
    }
  });

  // Таблица с параметрами обученной модели
  db.run(
    `CREATE TABLE IF NOT EXISTS typing_model (
      id INTEGER PRIMARY KEY,
      project_id INTEGER UNIQUE NOT NULL,
      model_name TEXT NOT NULL,
      vector_model TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  );
  db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_typing_model_project ON typing_model(project_id);"
  );

  // Integrations table removed: API keys are managed via OS keyring (keytar) or external handlers.

  // Лёгкие миграции: добавляем недостающие колонки (игнорируем ошибки про дубликаты)
  const alters = [
    "ALTER TABLE projects ADD COLUMN freezed INTEGER DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN stats TEXT", // Временно оставляем для миграции данных
    "ALTER TABLE projects ADD COLUMN crawler TEXT",
    "ALTER TABLE projects ADD COLUMN parser TEXT",
    "ALTER TABLE projects ADD COLUMN ui_columns TEXT",
    "ALTER TABLE projects ADD COLUMN updated_at DATETIME",
    "ALTER TABLE projects ADD COLUMN clustering_eps REAL DEFAULT 0.5",
    "ALTER TABLE projects ADD COLUMN clustering_min_points INTEGER DEFAULT 5",
    "ALTER TABLE projects ADD COLUMN clustering_method TEXT DEFAULT 'cosine'",
  ];
  alters.forEach((sql) => {
    db.run(sql, (err) => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.warn("Schema alter warning:", err.message);
      }
    });
  });

  // Добавляем недостающие колонки в urls
  const urlAlters = [
    "ALTER TABLE urls ADD COLUMN location TEXT",
    "ALTER TABLE urls ADD COLUMN content TEXT",
  ];
  urlAlters.forEach((sql) => {
    db.run(sql, (err) => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.warn("Schema urls alter warning:", err.message);
      }
    });
  });

  // Миграция данных: если есть старая колонка columns, переносим данные в ui_columns
  db.run(
    "UPDATE projects SET ui_columns = columns WHERE (ui_columns IS NULL OR ui_columns = '') AND columns IS NOT NULL",
    (err) => {
      if (err && !/no such column: columns/i.test(err.message)) {
        console.warn("Schema data migration warning:", err.message);
      }
    }
  );

  // Миграция статистики удалена - статистика теперь вычисляется из основных таблиц
}

// Промисифицированные обёртки для удобства использования
const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row)))
  );

const dbAll = (sql, params = []) => {
  // Log to stderr to avoid breaking worker stdout JSONL
  // console.error("Executing SQL query:", sql);
  // console.error("With parameters:", params);
  return new Promise((resolve, reject) =>
    db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows)))
  );
};

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (e) {
      return e ? reject(e) : resolve(this);
    })
  );

// Функции для работы с проектами
const updateProjectStatus = async (projectId, freezed) => {
  try {
    await dbRun(
      "UPDATE projects SET freezed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [freezed ? 1 : 0, projectId]
    );
    return true;
  } catch (error) {
    console.error("Ошибка при обновлении статуса проекта:", error);
    return false;
  }
};

const getProjectStatus = async (projectId) => {
  try {
    const rows = await dbAll("SELECT freezed FROM projects WHERE id = ?", [
      projectId,
    ]);

    if (rows.length > 0) {
      const freezed = Boolean(rows[0].freezed);
      return { freezed };
    } else {
      return { freezed: false };
    }
  } catch (error) {
    console.error("Ошибка получения статуса проекта:", error);
    return { freezed: false };
  }
};

// Функции для работы с URL
const isUrlDisallowed = async (projectId, url) => {
  try {
    const rows = await dbAll(
      "SELECT COUNT(*) as count FROM disallowed WHERE project_id = ? AND url = ?",
      [projectId, url]
    );

    const isDisallowed = rows[0].count > 0;
    return isDisallowed;
  } catch (error) {
    console.error("Ошибка при проверке disallowed URL:", error);
    return false; // В случае ошибки разрешаем обработку
  }
};

const isUrlProcessed = async (projectId, url) => {
  try {
    const rows = await dbAll(
      "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND url = ?",
      [projectId, url]
    );

    const isProcessed = rows[0].count > 0;
    return isProcessed;
  } catch (error) {
    console.error("Ошибка при проверке processed URL:", error);
    return false; // В случае ошибки разрешаем обработку
  }
};

// Функция для получения статистики проекта
const getProjectStats = async (projectId) => {
  try {
    const stats = {};

    // Получаем общее количество URLs (fetched)
    const fetchedCount = await dbGet(
      "SELECT COUNT(*) as count FROM urls WHERE project_id = ?",
      [projectId]
    );
    stats.fetched = fetchedCount.count;

    // Получаем размер очереди из таблицы projects
    const queueInfo = await dbGet(
      "SELECT queue_size FROM projects WHERE id = ?",
      [projectId]
    );
    stats.queue = queueInfo ? queueInfo.queue_size : 0;

    // Получаем количество disallowed URLs
    const disallowedCount = await dbGet(
      "SELECT COUNT(*) as count FROM disallowed WHERE project_id = ?",
      [projectId]
    );
    stats.disallow = disallowedCount.count;

    // Получаем количество URLs по типам
    const urlTypes = ["html", "jscss", "image", "redirect", "error"];
    for (const type of urlTypes) {
      const typeCount = await dbGet(
        "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = ?",
        [projectId, type]
      );
      stats[type] = typeCount.count;
    }

    // Получаем статистику по глубине для HTML
    const depth3Count = await dbGet(
      "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = 'html' AND depth <= 3",
      [projectId]
    );
    stats.depth3 = depth3Count.count;

    const depth5Count = await dbGet(
      "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = 'html' AND depth > 3 AND depth <= 5",
      [projectId]
    );
    stats.depth5 = depth5Count.count;

    const depth6Count = await dbGet(
      "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = 'html' AND depth >= 6",
      [projectId]
    );
    stats.depth6 = depth6Count.count;

    return stats;
  } catch (error) {
    console.error("Ошибка при получении статистики проекта:", error);
    return null;
  }
};

// -------------------- Stop words helpers --------------------
const stopWordsFindByProject = async (projectId, options = {}) => {
  try {
    const skip = options.skip || 0;
    const limit = options.limit || 300;
    const rows = await dbAll(
      `SELECT id, project_id, word, created_at FROM stop_words WHERE project_id = ? ORDER BY id LIMIT ? OFFSET ?`,
      [projectId, limit, skip]
    );
    const totalRes = await dbGet(
      `SELECT COUNT(*) as total FROM stop_words WHERE project_id = ?`,
      [projectId]
    );
    return { stopWords: rows, total: totalRes.total, skip, limit };
  } catch (error) {
    console.error("Error fetching stop_words:", error);
    return { stopWords: [], total: 0, skip: 0, limit: 0 };
  }
};

const stopWordsInsertBatch = async (projectId, words, createdAt) => {
  try {
    if (!Array.isArray(words) || words.length === 0)
      return { success: true, added: [] };
    const added = [];
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO stop_words (project_id, word, created_at) VALUES (?, ?, ?)"
    );
    for (const w of words) {
      const raw = typeof w === "string" ? w.trim() : w;
      if (!raw || raw.length === 0) continue;

      // Detect regex pattern syntax: starts with '/' and has another '/' later (e.g. /pat/i)
      const lastSlash = typeof raw === "string" ? raw.lastIndexOf("/") : -1;
      const isRegex =
        typeof raw === "string" && raw.startsWith("/") && lastSlash > 0;

      // For regex patterns we keep the raw pattern as-is (do not lowercase),
      // for normal words we normalize to lowercase.
      const normalized = isRegex ? raw : raw.toLowerCase();

      await new Promise((res, rej) => {
        stmt.run(
          [projectId, normalized, createdAt || new Date().toISOString()],
          function (err) {
            if (err) return rej(err);
            if (this.changes && this.changes > 0)
              added.push({
                id: this.lastID,
                project_id: projectId,
                word: normalized,
              });
            res();
          }
        );
      });
    }
    stmt.finalize && stmt.finalize();
    return { success: true, added };
  } catch (error) {
    console.error("Error inserting stop_words batch:", error);
    return { success: false, error: String(error) };
  }
};

const stopWordsRemove = async (projectId, word) => {
  try {
    // If word looks like a regex (starts and ends with '/'), delete exact pattern
    const isRegex =
      typeof word === "string" &&
      word.startsWith("/") &&
      word.lastIndexOf("/") > 0;
    let result;
    if (isRegex) {
      result = await dbRun(
        "DELETE FROM stop_words WHERE project_id = ? AND word = ?",
        [projectId, word]
      );
    } else {
      // Delete using case-insensitive match to handle various casings
      result = await dbRun(
        "DELETE FROM stop_words WHERE project_id = ? AND lower(word) = lower(?)",
        [projectId, word]
      );
    }
    const changes = result && result.changes ? result.changes : 0;
    return changes > 0;
  } catch (error) {
    console.error("Error removing stop_word:", error);
    return false;
  }
};

const stopWordsClear = async (projectId) => {
  try {
    await dbRun("DELETE FROM stop_words WHERE project_id = ?", [projectId]);
    return true;
  } catch (error) {
    console.error("Error clearing stop_words:", error);
    return false;
  }
};

// Функция для обновления статистики очереди проекта
const updateProjectQueueStats = async (projectId, queueSize, socket = null) => {
  try {
    // Сохраняем размер очереди в базе данных для дальнейшего использования
    const sql = `
      UPDATE projects
      SET queue_size = ?
      WHERE id = ?
    `;

    await dbRun(sql, [queueSize, projectId]);

    // Отправляем обновление через сокет, если он предоставлен
    if (socket) {
      try {
        console.log(
          `[queue] ${new Date().toISOString()} updateProjectQueueStats emit projectId=${projectId} queue=${queueSize}`
        );
      } catch (e) {}
      socket.emit("queue", { queue: queueSize, projectId: projectId });
    }

    return true;
  } catch (error) {
    console.error("Ошибка при обновлении статистики очереди:", error);
    return false;
  }
};

// Функция для получения сохраненного размера очереди
const getProjectQueueSize = async (projectId) => {
  try {
    const result = await dbGet("SELECT queue_size FROM projects WHERE id = ?", [
      projectId,
    ]);

    return result ? result.queue_size || 0 : 0;
  } catch (error) {
    console.error("Ошибка при получении размера очереди:", error);
    return 0;
  }
};

// --- Project and URL helper functions moved from HandlerProject.js ---

const toIntBool = (v) => (v ? 1 : 0);
const fromIntBool = (v) => v === 1 || v === true;

const serializeProject = (doc) => {
  const out = { ...doc };
  if (typeof out.freezed !== "undefined") out.freezed = toIntBool(out.freezed);
  ["crawler", "parser", "ui_columns"].forEach((k) => {
    if (out[k] !== undefined && out[k] !== null && typeof out[k] !== "string") {
      out[k] = JSON.stringify(out[k]);
    }
  });
  // clustering params: ensure values are stored as plain scalars
  if (typeof out.clustering_eps !== "undefined")
    out.clustering_eps = Number(out.clustering_eps);
  if (typeof out.clustering_min_points !== "undefined")
    out.clustering_min_points = Number(out.clustering_min_points);
  if (typeof out.clustering_method !== "undefined")
    out.clustering_method = String(out.clustering_method);
  if (typeof out.clustering_suggested_threshold !== "undefined")
    out.clustering_suggested_threshold = Number(
      out.clustering_suggested_threshold
    );
  if (
    typeof out.clustering_diagnostics !== "undefined" &&
    typeof out.clustering_diagnostics !== "string"
  )
    out.clustering_diagnostics = JSON.stringify(out.clustering_diagnostics);
  // remove stats if present
  delete out.stats;
  return out;
};

const deserializeProject = (row) => {
  if (!row) return row;
  const out = { ...row };
  out.freezed = fromIntBool(out.freezed);
  if (
    typeof out.ui_columns === "string" &&
    out.ui_columns !== "[object Object]"
  ) {
    try {
      out.columns = JSON.parse(out.ui_columns);
    } catch (_) {
      out.columns = {};
    }
  }
  ["crawler", "parser"].forEach((k) => {
    if (typeof out[k] === "string" && out[k] !== "[object Object]") {
      try {
        out[k] = JSON.parse(out[k]);
      } catch (_) {
        out[k] = k === "parser" ? [] : {};
      }
    }
  });
  if (!out.crawler || typeof out.crawler !== "object") out.crawler = {};
  if (!out.parser || !Array.isArray(out.parser)) out.parser = [];
  if (!out.columns || typeof out.columns !== "object") out.columns = {};
  // clustering defaults when not present
  if (typeof out.clustering_eps === "undefined" || out.clustering_eps === null)
    out.clustering_eps = 0.5;
  if (
    typeof out.clustering_min_points === "undefined" ||
    out.clustering_min_points === null
  )
    out.clustering_min_points = 5;
  if (
    typeof out.clustering_method === "undefined" ||
    out.clustering_method === null
  )
    out.clustering_method = "cosine";
  delete out.ui_columns;
  return out;
};

// Получить статистику проекта (delegates to existing getProjectStats)
// getProjectStats already present above

async function projectsFindOneById(id) {
  const row = await dbGet("SELECT * FROM projects WHERE id = ? LIMIT 1", [id]);
  if (!row) return null;
  const project = deserializeProject(row);
  project.stats = await getProjectStats(id);
  return project;
}

async function projectsFindAll() {
  const rows = await dbAll("SELECT * FROM projects ORDER BY id ASC");
  const projects = [];
  for (const r of rows) {
    projects.push(deserializeProject(r));
  }
  return projects;
}

async function projectsInsert(doc) {
  const data = {
    name: doc.name || "",
    url: doc.url || "",
    freezed: typeof doc.freezed === "boolean" ? doc.freezed : false,
    crawler: doc.crawler || {},
    parser: doc.parser || [],
    ui_columns: doc.columns || {},
  };
  const s = serializeProject(data);
  const result = await dbRun(
    `INSERT INTO projects (name, url, freezed, crawler, parser, ui_columns) VALUES (?, ?, ?, ?, ?, ?)`,
    [s.name, s.url, s.freezed, s.crawler, s.parser, s.ui_columns]
  );
  const row = await projectsFindOneById(result.lastID);
  return row;
}

async function projectsUpdate(doc) {
  const id = doc.id;
  if (!id) throw new Error("id is required");
  const allowed = [
    "name",
    "url",
    "freezed",
    "crawler",
    "parser",
    "columns",
    "clustering_eps",
    "clustering_min_points",
    "clustering_method",
    "clustering_suggested_threshold",
    "clustering_diagnostics",
  ];
  const toUpdate = {};
  for (const k of allowed) {
    if (k in doc) {
      const dbKey = k === "columns" ? "ui_columns" : k;
      toUpdate[dbKey] = doc[k];
    }
  }
  if (Object.keys(toUpdate).length > 0) {
    const s = serializeProject(toUpdate);
    const setParts = Object.keys(s).map((k) => `${k} = ?`);
    const params = [...Object.values(s), id];
    await dbRun(
      `UPDATE projects SET ${setParts.join(
        ", "
      )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );
  }
  return await projectsFindOneById(id);
}

async function projectsRemove(id) {
  await dbRun(`DELETE FROM projects WHERE id = ?`, [id]);
}

// Возвращает { data: [...rows], total }
async function getSortedData(slice) {
  if (!slice.id) {
    return { data: [], total: 0 };
  }
  try {
    const limit = slice.limit || 0; // Убираем ограничение по умолчанию
    const skip = slice.skip || 0;
    const dbTable = slice.db || "urls";
    let query, countQuery, params, countParams;

    if (dbTable === "disallow") {
      query = "SELECT * FROM disallowed WHERE project_id = ?";
      countQuery =
        "SELECT COUNT(*) as total FROM disallowed WHERE project_id = ?";
      params = [slice.id];
      countParams = [slice.id];
    } else if (dbTable === "urls") {
      query = "SELECT * FROM urls WHERE project_id = ?";
      countQuery = "SELECT COUNT(*) as total FROM urls WHERE project_id = ?";
      params = [slice.id];
      countParams = [slice.id];
    } else {
      query = "SELECT * FROM urls WHERE project_id = ? AND type = ?";
      countQuery =
        "SELECT COUNT(*) as total FROM urls WHERE project_id = ? AND type = ?";
      params = [slice.id, dbTable];
      countParams = [slice.id, dbTable];
    }

    const sortObj = slice.sort || { id: 1 };
    const sortField = Object.keys(sortObj)[0];
    const sortOrder = Object.values(sortObj)[0] === 1 ? "ASC" : "DESC";
    let allowedSortFields = [];
    let jsonFields = [];

    if (dbTable === "disallow") {
      allowedSortFields = [
        "id",
        "project_id",
        "url",
        "error_type",
        "code",
        "status",
        "referrer",
        "depth",
        "protocol",
        "error_message",
        "created_at",
      ];
      jsonFields = [];
    } else {
      allowedSortFields = [
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
      ];
      jsonFields = [
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
      ];
    }

    const safeSortField = allowedSortFields.includes(sortField)
      ? sortField
      : "id";
    let orderByClause;
    if (jsonFields.includes(safeSortField)) {
      orderByClause = `JSON_EXTRACT(content, '$.${safeSortField}') ${sortOrder}`;
    } else {
      orderByClause = `${safeSortField} ${sortOrder}`;
    }
    query += ` ORDER BY ${orderByClause}`;
    if (limit > 0) {
      query += " LIMIT ? OFFSET ?";
      params.push(limit, skip);
    }

    const [rows, countResult] = await Promise.all([
      dbAll(query, params),
      dbGet(countQuery, countParams),
    ]);
    const total = countResult.total || 0;
    let processedRows;
    if (dbTable === "disallow") {
      processedRows = rows;
    } else {
      processedRows = rows.map((row) => {
        const processed = { ...row };
        if (row.content) {
          try {
            const content = JSON.parse(row.content);
            // Обработка старого формата (индексы) и нового формата (названия полей)
            if (Object.keys(content).every((key) => /^\d+$/.test(key))) {
              // Старый формат: индексы 0,1,2,... нужно преобразовать в названия полей
              const fieldMapping = [
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
              ];
              Object.keys(content).forEach((index) => {
                const fieldName = fieldMapping[parseInt(index)];
                if (fieldName) {
                  processed[fieldName] = content[index];
                }
              });
            } else {
              // Новый формат: названия полей уже правильные
              Object.assign(processed, content);
            }
          } catch (e) {
            console.warn("Failed to parse content JSON:", e);
          }
        }
        delete processed.content;
        return processed;
      });
    }
    return { data: processedRows, total };
  } catch (err) {
    console.error("Error in getSortedData:", err);
    return { data: [], total: 0 };
  }
}

async function syncProjectStats(projectId) {
  try {
    const stats = {};
    const disallowedCount = await dbGet(
      "SELECT COUNT(*) as count FROM disallowed WHERE project_id = ?",
      [projectId]
    );
    stats.disallow = disallowedCount.count;
    const urlTypes = ["html", "jscss", "image", "redirect", "error"];
    for (const type of urlTypes) {
      const typeCount = await dbGet(
        "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = ?",
        [projectId, type]
      );
      stats[type] = typeCount.count;
    }
    stats.depth3 = 0;
    stats.depth5 = 0;
    stats.depth6 = 0;
    const depthCounts = await dbAll(
      `SELECT SUM(CASE WHEN depth <= 3 THEN 1 ELSE 0 END) as depth3, SUM(CASE WHEN depth > 3 AND depth <= 5 THEN 1 ELSE 0 END) as depth5, SUM(CASE WHEN depth >= 6 THEN 1 ELSE 0 END) as depth6 FROM urls WHERE project_id = ? AND type = 'html'`,
      [projectId]
    );
    if (depthCounts && depthCounts.length > 0) {
      stats.depth3 = depthCounts[0].depth3 || 0;
      stats.depth5 = depthCounts[0].depth5 || 0;
      stats.depth6 = depthCounts[0].depth6 || 0;
    }
    const fetchedCount = await dbGet(
      "SELECT COUNT(*) as count FROM urls WHERE project_id = ?",
      [projectId]
    );
    stats.fetched = fetchedCount.count;
    try {
      const queueCount = await getProjectQueueSize(projectId);
      stats.queue = Number(queueCount) || 0;
    } catch (queueErr) {
      console.error(
        `Failed to read persisted queue size for project ${projectId}:`,
        queueErr.message || queueErr
      );
      stats.queue = 0;
    }
    return stats;
  } catch (err) {
    console.error(
      `❌ Ошибка при синхронизации статистики для проекта ${projectId}:`,
      err
    );
    throw err;
  }
}

async function getUrlsStats(projectId) {
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
    const dailyRows = await dbAll(
      `SELECT DATE(created_at) as day, COUNT(*) as count FROM urls WHERE project_id = ? GROUP BY DATE(created_at)`,
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
}

// Функция для сохранения ошибок
const saveError = async (projectId, data, socket) => {
  try {
    const result = await dbRun(
      `INSERT OR IGNORE INTO disallowed 
      (project_id, url, error_type, code, status, referrer, depth, protocol, error_message) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        data.url,
        data.error_type,
        data.code || 0,
        data.status || null,
        data.referrer || null,
        data.depth || null,
        data.protocol || null,
        data.error_message || null,
      ]
    );

    // Эмитим событие disallow для обновления статистики
    const errorCount = await dbAll(
      "SELECT COUNT(*) as count FROM disallowed WHERE project_id = ?",
      [projectId]
    );

    // Эмитим событие disallow с общим количеством записей в disallowed
    if (socket) {
      socket.emit("disallow", errorCount[0].count);

      // Эмитим статистику по типам ошибок
      if (data.error_type) {
        const typeCount = await dbAll(
          "SELECT COUNT(*) as count FROM disallowed WHERE project_id = ? AND error_type = ?",
          [projectId, data.error_type]
        );
      }
    }

    return errorCount[0].count;
  } catch (err) {
    console.error("********** SQLite saveError error", err);
    return 0;
  }
};

// Функция для сохранения данных
const saveData = async (tableName, projectId, data, socket) => {
  try {
    // Извлекаем статические поля
    const {
      type,
      url,
      referrer,
      depth,
      code,
      contentType,
      protocol,
      actualDataSize,
      requestTime,
      requestLatency,
      downloadTime,
      status,
      date,
      ...dynamicFields
    } = data;

    // Сохраняем динамические поля как JSON
    const contentJson = JSON.stringify(dynamicFields);

    const result = await dbRun(
      `INSERT OR REPLACE INTO ${tableName} 
      (project_id, type, url, referrer, depth, code, contentType, protocol, actualDataSize, requestTime, requestLatency, downloadTime, status, date, content) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        type,
        url,
        referrer,
        depth,
        code,
        contentType,
        protocol,
        actualDataSize,
        requestTime,
        requestLatency,
        downloadTime,
        status,
        date,
        contentJson,
      ]
    );

    if (socket) {
      // Эмитим событие fetched для обновления статистики
      const totalCount = await dbAll(
        "SELECT COUNT(*) as count FROM urls WHERE project_id = ?",
        [projectId]
      );

      // Эмитим событие fetched для обновления статистики
      socket.emit("fetched", {
        fetched: totalCount[0].count,
        projectId: projectId,
      });

      // Эмитим событие для обновления таблицы данных в реальном времени
      socket.emit("data-updated", {
        projectId: projectId,
        tableName: tableName,
        action: "insert",
      });

      if (type) {
        const typeCount = await dbAll(
          "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = ?",
          [projectId, type]
        );

        // Отправляем обновления статистики по типам с projectId
        socket.emit(`stat-${type}`, {
          count: typeCount[0].count,
          projectId: projectId,
        });
      }

      // Статистика по глубине для HTML
      if (type === "html" && depth !== undefined) {
        if (depth < 4) {
          const depth3Count = await dbAll(
            "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = 'html' AND depth <= 3",
            [projectId]
          );
          socket.emit("stat-depth3", {
            count: depth3Count[0].count,
            projectId: projectId,
          });
        } else if (depth > 3 && depth < 6) {
          const depth5Count = await dbAll(
            "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = 'html' AND depth <= 5",
            [projectId]
          );
          socket.emit("stat-depth5", {
            count: depth5Count[0].count,
            projectId: projectId,
          });
        } else {
          const depth6Count = await dbAll(
            "SELECT COUNT(*) as count FROM urls WHERE project_id = ? AND type = 'html' AND depth >= 6",
            [projectId]
          );
          socket.emit("stat-depth6", {
            count: depth6Count[0].count,
            projectId: projectId,
          });
        }
      }
    }

    return result;
  } catch (err) {
    console.error("********** SQLite saveData error", err);
    return null;
  }
};

// Функции для работы с keywords
const keywordsFindByProject = async (projectId, options = {}) => {
  try {
    const skip = options.skip ?? 0;
    const limit = options.limit ?? null;
    const sort = options.sort ?? null;
    const query = options.query ?? null;
    let sqlQuery = "SELECT * FROM keywords WHERE project_id = ?";
    let params = [projectId];

    // Optionally filter by target_query (1 = allowed, 0 = blocked)
    if (options.targetOnly || typeof options.target_query !== "undefined") {
      const val = options.targetOnly ? 1 : Number(options.target_query);
      // If filtering for allowed (1), treat NULL as allowed as well
      if (val === 1) {
        sqlQuery += " AND (target_query IS NULL OR target_query = ?)";
        params.push(1);
      } else {
        sqlQuery += " AND target_query = ?";
        params.push(val);
      }
    }

    // Добавляем поиск по keyword, если указан
    if (query) {
      sqlQuery += " AND keyword LIKE ?";
      params.push(`%${query}%`);
    }

    // Добавляем сортировку, если указана
    if (sort) {
      // Поддерживаем два формата: { field: 'col', direction: 'descending'|'ascending' }
      // и числовой формат { col: 1 } (1 = ASC, -1 = DESC)
      let sortField = null;
      let direction = "ASC";

      if (sort.field) {
        sortField = sort.field;
        direction = sort.direction === "descending" ? "DESC" : "ASC";
      } else {
        const keys = Object.keys(sort);
        if (keys.length > 0) {
          sortField = keys[0];
          const val = sort[sortField];
          direction = val === -1 ? "DESC" : "ASC";
        }
      }

      if (sortField) {
        sqlQuery += ` ORDER BY ${sortField} ${direction}`;
      } else {
        sqlQuery += " ORDER BY created_at ASC";
      }
    } else {
      // По умолчанию сортируем по created_at ASC
      sqlQuery += " ORDER BY created_at ASC";
    }

    if (limit !== null) {
      sqlQuery += " LIMIT ?";
      params.push(limit);
    }

    if (skip > 0) {
      sqlQuery += " OFFSET ?";
      params.push(skip);
    }

    const rows = await dbAll(sqlQuery, params);
    return rows;
  } catch (error) {
    console.error("Ошибка при получении ключевых слов:", error);
    return [];
  }
};

const keywordsCountByProject = async (projectId, query = null) => {
  try {
    let sql = "SELECT COUNT(*) as count FROM keywords WHERE project_id = ?";
    let params = [projectId];

    if (query) {
      sql += " AND keyword LIKE ?";
      params.push(`%${query}%`);
    }

    const result = await dbGet(sql, params);
    return result ? result.count : 0;
  } catch (error) {
    console.error("Ошибка при подсчете ключевых слов:", error);
    return 0;
  }
};

const keywordsInsert = async (projectId, keyword, createdAt = null) => {
  try {
    // Normalize keyword to lowercase and trim to ensure consistent storage
    const normalized =
      typeof keyword === "string" ? keyword.trim().toLowerCase() : keyword;
    if (!normalized || normalized.length === 0) return null;

    let query, params;
    if (createdAt) {
      // Если передано время создания, используем его
      query =
        "INSERT OR IGNORE INTO keywords (project_id, keyword, created_at) VALUES (?, ?, ?)";
      params = [projectId, normalized, createdAt];
    } else {
      // Иначе используем CURRENT_TIMESTAMP
      query =
        "INSERT OR IGNORE INTO keywords (project_id, keyword) VALUES (?, ?)";
      params = [projectId, normalized];
    }

    const result = await dbRun(query, params);
    return result.lastID;
  } catch (error) {
    console.error("Ошибка при добавлении ключевого слова:", error);
    return null;
  }
};

// Атомарная вставка массива ключевых слов с прогрессом
const keywordsInsertBatch = async (
  projectId,
  keywords,
  createdAt = null,
  onProgress = null
) => {
  try {
    console.log(
      `🔄 Начинаем атомарную вставку ${keywords.length} ключевых слов`
    );

    // Фильтруем пустые и дублированные ключевые запросы
    const filteredKeywords = [];
    const seen = new Set();
    let duplicates = 0;
    let emptySkipped = 0;

    for (const keyword of keywords) {
      const trimmed = (keyword || "").trim();
      const normalized = trimmed.toLowerCase();
      if (!normalized) {
        emptySkipped++;
        continue;
      }
      if (seen.has(normalized)) {
        duplicates++;
        continue;
      }
      seen.add(normalized);
      filteredKeywords.push(normalized);
    }

    console.log(
      `📊 Фильтрация завершена: ${filteredKeywords.length} уникальных из ${keywords.length} (дубликатов: ${duplicates}, пустых: ${emptySkipped})`
    );

    if (filteredKeywords.length === 0) {
      return {
        success: true,
        added: [],
        duplicates: duplicates,
        emptySkipped: emptySkipped,
        totalAttempted: keywords.length,
        totalAdded: 0,
      };
    }

    const addedKeywords = [];
    let successCount = 0;
    const batchSize = 1000; // Размер батча для отправки прогресса

    // Обрабатываем ключевые запросы батчами
    for (
      let batchStart = 0;
      batchStart < filteredKeywords.length;
      batchStart += batchSize
    ) {
      const batchEnd = Math.min(
        batchStart + batchSize,
        filteredKeywords.length
      );
      const batch = filteredKeywords.slice(batchStart, batchEnd);

      console.log(
        `� Обрабатываем батч ${Math.floor(batchStart / batchSize) + 1}: ${
          batch.length
        } ключевых слов`
      );

      // Начинаем транзакцию для батча
      await dbRun("BEGIN TRANSACTION");

      try {
        const batchAdded = [];

        for (let i = 0; i < batch.length; i++) {
          const keyword = batch[i];
          let query, params;

          if (createdAt) {
            query =
              "INSERT OR IGNORE INTO keywords (project_id, keyword, created_at) VALUES (?, ?, ?)";
            params = [projectId, keyword, createdAt];
          } else {
            query =
              "INSERT OR IGNORE INTO keywords (project_id, keyword) VALUES (?, ?)";
            params = [projectId, keyword];
          }

          const result = await dbRun(query, params);

          if (result.lastID) {
            batchAdded.push({
              id: result.lastID,
              keyword: keyword,
              created_at: createdAt || new Date().toISOString(),
            });
            successCount++;
          }
        }

        // Фиксируем транзакцию батча
        await dbRun("COMMIT");

        // Добавляем результаты батча к общему массиву
        addedKeywords.push(...batchAdded);

        // Отправляем прогресс
        const processed = batchStart + batch.length;
        const progress = Math.round(
          (processed / filteredKeywords.length) * 100
        );

        if (onProgress) {
          console.log(
            `📊 Прогресс: ${processed}/${filteredKeywords.length} (${progress}%)`
          );
          onProgress({
            processed,
            total: filteredKeywords.length,
            progress,
            batchAdded: batchAdded.length,
          });
        }
      } catch (batchError) {
        // Откатываем транзакцию батча при ошибке
        console.error(
          `❌ Ошибка в батче ${
            Math.floor(batchStart / batchSize) + 1
          }, выполняем откат:`,
          batchError
        );
        await dbRun("ROLLBACK");
        throw batchError;
      }
    }

    console.log(
      `✅ Атомарная вставка завершена: ${successCount}/${filteredKeywords.length} ключевых слов добавлено`
    );

    return {
      success: true,
      added: addedKeywords,
      duplicates: duplicates,
      emptySkipped: emptySkipped,
      totalAttempted: keywords.length,
      totalAdded: successCount,
    };
  } catch (error) {
    console.error(
      "❌ Критическая ошибка при атомарной вставке ключевых слов:",
      error
    );
    return {
      success: false,
      error: error.message,
      added: [],
      duplicates: 0,
      emptySkipped: 0,
      totalAttempted: keywords.length,
      totalAdded: 0,
    };
  }
};

// Apply stop-words rules to keywords for a project.
// - For any keyword that contains a stop word (case-insensitive, whole-word or substring per requirement),
//   set target_query = 0 and blocking_rule = that stop word (first match).
// - For other keywords set target_query = 1 and blocking_rule = NULL.
// Returns { updated: number }
const keywordsApplyStopWords = async (projectId) => {
  try {
    // Get stop words for project
    const stopRows = await dbAll(
      "SELECT word FROM stop_words WHERE project_id = ?",
      [projectId]
    );
    const stopWords = (stopRows || []).map((r) => r.word).filter(Boolean);

    if (stopWords.length === 0) {
      // No stopwords: clear blocking_rule and set all to target_query=1
      const res = await dbRun(
        "UPDATE keywords SET target_query = 1, blocking_rule = NULL WHERE project_id = ?",
        [projectId]
      );
      const changes = res && res.changes ? res.changes : 0;
      return { updated: changes };
    }

    // For performance, we'll process in SQL where possible.
    // We'll iterate stop words and mark matching keywords with the first matching stop word.
    // To avoid complex SQL, perform this in a transaction in JS.
    await dbRun("BEGIN TRANSACTION");
    // First, reset all to allowed
    await dbRun(
      "UPDATE keywords SET target_query = 1, blocking_rule = NULL WHERE project_id = ?",
      [projectId]
    );

    let totalUpdated = 0;

    // Separate regex stop-words (stored as /pattern/flags) from plain words
    const regexWords = [];
    const plainWords = [];
    for (const w of stopWords) {
      if (typeof w === "string" && w.startsWith("/") && w.lastIndexOf("/") > 0)
        regexWords.push(w);
      else plainWords.push(w);
    }

    // Process plain words using SQL LIKE (fast)
    for (const word of plainWords) {
      const likePattern = `%${(word || "").toLowerCase()}%`;
      const stmt = await dbRun(
        "UPDATE keywords SET target_query = 0, blocking_rule = ? WHERE project_id = ? AND target_query = 1 AND lower(keyword) LIKE lower(?)",
        [word, projectId, likePattern]
      );
      totalUpdated += stmt && stmt.changes ? stmt.changes : 0;
    }

    // Process regex stop-words by fetching candidate keywords and testing JS RegExp
    if (regexWords.length > 0) {
      // Fetch currently allowed keywords for the project (could be large)
      const candidates = await dbAll(
        "SELECT id, keyword FROM keywords WHERE project_id = ? AND target_query = 1",
        [projectId]
      );

      for (const pattern of regexWords) {
        try {
          // pattern format: /.../flags
          const lastSlash = pattern.lastIndexOf("/");
          const body = pattern.substring(1, lastSlash);
          const flags = pattern.substring(lastSlash + 1) || "";
          const re = new RegExp(body, flags);

          const matchedIds = [];
          for (const row of candidates) {
            try {
              if (re.test(row.keyword)) matchedIds.push(row.id);
            } catch (e) {
              // ignore bad regex test for specific keyword
            }
          }

          // Update matched ids in batches
          const batchSize = 500;
          for (let i = 0; i < matchedIds.length; i += batchSize) {
            const batchIds = matchedIds.slice(i, i + batchSize);
            const placeholders = batchIds.map(() => "?").join(",");
            const params = [pattern, projectId, ...batchIds];
            const sql = `UPDATE keywords SET target_query = 0, blocking_rule = ? WHERE project_id = ? AND id IN (${placeholders})`;
            const res = await dbRun(sql, params);
            totalUpdated += res && res.changes ? res.changes : 0;
          }
        } catch (e) {
          console.warn(
            "Invalid regex stop-word, skipping:",
            pattern,
            e.message || e
          );
        }
      }
    }

    await dbRun("COMMIT");
    return { updated: totalUpdated };
  } catch (err) {
    console.error("Error applying stop-words to keywords:", err);
    try {
      await dbRun("ROLLBACK");
    } catch (e) {}
    return { updated: 0, error: String(err) };
  }
};

const keywordsRemove = async (projectId, keyword) => {
  try {
    await dbRun("DELETE FROM keywords WHERE project_id = ? AND keyword = ?", [
      projectId,
      keyword,
    ]);
    return true;
  } catch (error) {
    console.error("Ошибка при удалении ключевого слова:", error);
    return false;
  }
};

const keywordsClear = async (projectId) => {
  try {
    console.log(`Удаляем ключевые запросы для проекта ${projectId}`);
    const result = await dbRun("DELETE FROM keywords WHERE project_id = ?", [
      projectId,
    ]);
    console.log(
      `Удалено ${result.changes || 0} ключевых слов для проекта ${projectId}`
    );
    return true;
  } catch (error) {
    console.error("Ошибка при очистке ключевых слов:", error);
    return false;
  }
};

// Функции для работы с категориями
const categoriesInsert = async (projectId, categoryName, createdAt = null) => {
  try {
    let query, params;
    if (createdAt) {
      query =
        "INSERT OR IGNORE INTO categories (project_id, category_name, created_at) VALUES (?, ?, ?)";
      params = [projectId, categoryName, createdAt];
    } else {
      query =
        "INSERT OR IGNORE INTO categories (project_id, category_name) VALUES (?, ?)";
      params = [projectId, categoryName];
    }

    const result = await dbRun(query, params);
    return result.lastID;
  } catch (error) {
    console.error("Ошибка при добавлении категории:", error);
    return null;
  }
};

const categoriesInsertBatch = async (
  projectId,
  categories,
  createdAt = null,
  onProgress = null
) => {
  console.log("categoriesInsertBatch called with:", {
    projectId,
    categoriesCount: categories.length,
    createdAt,
  });
  try {
    console.log(`🔄 Начинаем атомарную вставку ${categories.length} категорий`);

    // Фильтруем пустые и дублированные категории
    const filteredCategories = [];
    const seen = new Set();
    let duplicates = 0;
    let emptySkipped = 0;

    for (const category of categories) {
      const trimmed = category.trim();
      if (!trimmed) {
        emptySkipped++;
        continue;
      }
      if (seen.has(trimmed)) {
        duplicates++;
        continue;
      }
      seen.add(trimmed);
      filteredCategories.push(trimmed);
    }

    console.log(
      `📊 Фильтрация завершена: ${filteredCategories.length} уникальных из ${categories.length} (дубликатов: ${duplicates}, пустых: ${emptySkipped})`
    );

    if (filteredCategories.length === 0) {
      return {
        success: true,
        added: [],
        duplicates: duplicates,
        emptySkipped: emptySkipped,
        totalAttempted: categories.length,
        totalAdded: 0,
      };
    }

    const addedCategories = [];
    let successCount = 0;
    const batchSize = 1000;

    for (
      let batchStart = 0;
      batchStart < filteredCategories.length;
      batchStart += batchSize
    ) {
      const batchEnd = Math.min(
        batchStart + batchSize,
        filteredCategories.length
      );
      const batch = filteredCategories.slice(batchStart, batchEnd);

      console.log(
        `� Обрабатываем батч ${Math.floor(batchStart / batchSize) + 1}: ${
          batch.length
        } категорий`
      );

      await dbRun("BEGIN TRANSACTION");

      try {
        const batchAdded = [];

        for (let i = 0; i < batch.length; i++) {
          const category = batch[i];
          let query, params;
          if (createdAt) {
            query =
              "INSERT OR IGNORE INTO categories (project_id, category_name, created_at) VALUES (?, ?, ?)";
            params = [projectId, category, createdAt];
          } else {
            query =
              "INSERT OR IGNORE INTO categories (project_id, category_name) VALUES (?, ?)";
            params = [projectId, category];
          }

          const result = await dbRun(query, params);
          if (result.lastID) {
            batchAdded.push(category);
            successCount++;
          }
        }

        await dbRun("COMMIT");
        addedCategories.push(...batchAdded);

        if (onProgress) {
          onProgress({
            processed: Math.min(
              batchStart + batchSize,
              filteredCategories.length
            ),
            total: filteredCategories.length,
            added: addedCategories.length,
          });
        }

        console.log(
          `✅ Батч завершен: добавлено ${batchAdded.length} из ${batch.length}`
        );
      } catch (batchError) {
        await dbRun("ROLLBACK");
        console.error("Ошибка в батче:", batchError);
        throw batchError;
      }
    }

    console.log(
      `🎉 Вставка завершена: добавлено ${successCount} категорий из ${filteredCategories.length}`
    );

    return {
      success: true,
      added: addedCategories,
      duplicates: duplicates,
      emptySkipped: emptySkipped,
      totalAttempted: categories.length,
      totalAdded: successCount,
    };
  } catch (error) {
    console.error("Ошибка при пакетной вставке категорий:", error);
    return {
      success: false,
      error: error.message,
      added: [],
      duplicates: 0,
      emptySkipped: 0,
      totalAttempted: categories.length,
      totalAdded: 0,
    };
  }
};

const categoriesFindByProject = async (projectId, options = {}) => {
  try {
    const skip = options.skip ?? 0;
    const limit = options.limit ?? 300;
    const sort = options.sort ?? null;
    let query = "SELECT * FROM categories WHERE project_id = ?";
    let params = [projectId];

    // Добавляем сортировку, если указана
    if (sort) {
      // Поддерживаем числовой формат { col: 1/-1 } и legacy { field, direction }
      let sortField = null;
      let direction = "ASC";
      if (sort.field) {
        sortField = sort.field;
        direction = sort.direction === "descending" ? "DESC" : "ASC";
      } else {
        const keys = Object.keys(sort);
        if (keys.length > 0) {
          sortField = keys[0];
          direction = sort[sortField] === -1 ? "DESC" : "ASC";
        }
      }

      if (sortField) {
        query += ` ORDER BY ${sortField} ${direction}`;
      } else {
        query += " ORDER BY created_at DESC";
      }
    } else {
      // По умолчанию сортируем по created_at DESC
      query += " ORDER BY created_at DESC";
    }

    query += " LIMIT ? OFFSET ?";
    params.push(limit, skip);

    const rows = await dbAll(query, params);
    const totalQuery =
      "SELECT COUNT(*) as total FROM categories WHERE project_id = ?";
    const totalResult = await dbGet(totalQuery, [projectId]);
    return {
      categories: rows,
      total: totalResult.total,
      skip,
      limit,
    };
  } catch (error) {
    console.error("Ошибка при получении категорий:", error);
    return { categories: [], total: 0, skip: 0, limit: 0 };
  }
};

const categoriesClear = async (projectId) => {
  try {
    console.log(`Удаляем категории для проекта ${projectId}`);
    const result = await dbRun("DELETE FROM categories WHERE project_id = ?", [
      projectId,
    ]);
    console.log(
      `Удалено ${result.changes || 0} категорий для проекта ${projectId}`
    );
    return true;
  } catch (error) {
    console.error("Ошибка при очистке категорий:", error);
    return false;
  }
};

// Удалить одну категорию по id
const categoriesDelete = async (id) => {
  try {
    if (!id) return false;
    const result = await dbRun("DELETE FROM categories WHERE id = ?", [id]);
    // result is the Statement 'this' from sqlite3; it contains 'changes'
    const changes = result && result.changes ? result.changes : 0;
    console.log(`categoriesDelete: id=${id} changes=${changes}`);
    return changes > 0;
  } catch (error) {
    console.error("Error deleting category:", error);
    return false;
  }
};

// Typing samples helpers
const typingSamplesFindByProject = async (projectId, options = {}) => {
  try {
    const skip = options.skip || 0;
    const limit = options.limit || 200;
    const rows = await dbAll(
      `SELECT id, project_id, text, label, embedding, created_at FROM typing_samples WHERE project_id = ? ORDER BY id LIMIT ? OFFSET ?`,
      [projectId, limit, skip]
    );
    const countRow = await dbGet(
      `SELECT COUNT(*) as total FROM typing_samples WHERE project_id = ?`,
      [projectId]
    );
    const total = (countRow && countRow.total) || 0;
    // Parse embedding JSON into arrays if present
    const samples = (rows || []).map((r) => {
      try {
        return {
          ...r,
          embedding: r.embedding ? JSON.parse(r.embedding) : null,
        };
      } catch (e) {
        return { ...r, embedding: null };
      }
    });
    return { samples, total, skip, limit };
  } catch (error) {
    console.error("Error fetching typing_samples:", error);
    return { samples: [], total: 0, skip: 0, limit: 0 };
  }
};

const typingSamplesInsertBatch = async (projectId, samples) => {
  // samples: [{text, label, embedding?}, ...]
  if (!Array.isArray(samples) || samples.length === 0) return { added: 0 };
  try {
    let added = 0;
    const insertStmt = `INSERT INTO typing_samples (project_id, text, label, embedding, created_at) VALUES (?, ?, ?, ?, ?)`;
    const now = new Date().toISOString();

    // 1) Сбор уникальных меток из батча
    const labels = Array.from(
      new Set(
        samples
          .map((s) => (s && s.label ? String(s.label).trim() : ""))
          .filter(Boolean)
      )
    );

    // 2) Подгружаем существующие фразы для каждой метки, чтобы не вставлять дубликаты
    const existingByLabel = new Map();
    for (const lbl of labels) {
      try {
        const rows = await dbAll(
          `SELECT text FROM typing_samples WHERE project_id = ? AND label = ?`,
          [projectId, lbl]
        );
        const set = new Set(
          (rows || []).map((r) =>
            String(r.text || "")
              .trim()
              .toLowerCase()
          )
        );
        existingByLabel.set(lbl, set);
      } catch (e) {
        existingByLabel.set(lbl, new Set());
      }
    }

    // 3) Вставляем по одной строке на каждую фразу
    for (const s of samples) {
      if (!s || !s.text || !s.label) continue;
      const label = String(s.label).trim();
      if (!label) continue;
      const embJson = s.embedding ? JSON.stringify(s.embedding) : null;

      // Нормализация: разбиваем на фразы, приводим к нижнему регистру, удаляем пустые
      const parts = String(s.text)
        .split(/[\n,]+/)
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      // Удаляем дубликаты внутри образца, сохраняя порядок
      const unique = Array.from(new Set(parts));
      if (unique.length === 0) continue;

      const existing = existingByLabel.get(label) || new Set();
      for (const phrase of unique) {
        if (existing.has(phrase)) continue; // пропускаем уже существующие
        // Вставляем ОДНУ фразу как ОТДЕЛЬНУЮ строку
        await dbRun(insertStmt, [projectId, phrase, label, embJson, now]);
        added++;
        existing.add(phrase); // обновим кэш, чтобы не вставить дубль в этом же батче
      }
      existingByLabel.set(label, existing);
    }
    return { added };
  } catch (error) {
    console.error("Error inserting typing_samples batch:", error);
    return { added: 0, error: error && error.message ? error.message : error };
  }
};

const typingSamplesClear = async (projectId) => {
  try {
    // Очистить class_name и class_similarity в keywords для всех типов проекта
    await dbRun(
      "UPDATE keywords SET class_name = NULL, class_similarity = NULL WHERE project_id = ?",
      [projectId]
    );
    // Удалить модель, так как она больше не актуальна
    await deleteTypingModel(projectId);
    const res = await dbRun("DELETE FROM typing_samples WHERE project_id = ?", [
      projectId,
    ]);
    return true;
  } catch (error) {
    console.error("Error clearing typing_samples:", error);
    return false;
  }
};

const typingSamplesDelete = async (id) => {
  try {
    if (!id) return false;
    // Получить label и project_id перед удалением
    const sample = await dbGet(
      "SELECT label, project_id FROM typing_samples WHERE id = ?",
      [id]
    );
    if (!sample) return false;
    const { label, project_id } = sample;
    // Очистить class_name и class_similarity в keywords для этого типа
    await dbRun(
      "UPDATE keywords SET class_name = NULL, class_similarity = NULL WHERE class_name = ? AND project_id = ?",
      [label, project_id]
    );
    // Удалить модель, так как она больше не актуальна
    await deleteTypingModel(project_id);
    // Теперь удалить саму запись
    const res = await dbRun("DELETE FROM typing_samples WHERE id = ?", [id]);
    const changes = res && res.changes ? res.changes : 0;
    return changes > 0;
  } catch (error) {
    console.error("Error deleting typing sample:", error);
    return false;
  }
};

// Update a typing sample (text, label, embedding)
const typingSamplesUpdate = async (id, fields = {}) => {
  try {
    if (!id) return false;
    // Получить текущий label перед обновлением
    const current = await dbGet(
      "SELECT label, project_id FROM typing_samples WHERE id = ?",
      [id]
    );
    if (!current) return false;
    const oldLabel = current.label;
    const projectId = current.project_id;
    const params = [];
    const setParts = [];
    if (typeof fields.text !== "undefined") {
      // Теперь каждая запись хранит одну фразу. Возьмем первую нормализованную фразу.
      const parts = String(fields.text || "")
        .split(/[\n,]+/)
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      const first = parts[0] || null;
      setParts.push("text = ?");
      params.push(first);
    }
    let newLabel = oldLabel;
    if (typeof fields.label !== "undefined") {
      newLabel = String(fields.label).trim();
      setParts.push("label = ?");
      params.push(newLabel);
    }
    if (typeof fields.embedding !== "undefined") {
      setParts.push("embedding = ?");
      params.push(fields.embedding ? JSON.stringify(fields.embedding) : null);
    }
    if (setParts.length === 0) return false;
    params.push(id);
    const sql = `UPDATE typing_samples SET ${setParts.join(", ")} WHERE id = ?`;
    const res = await dbRun(sql, params);
    const changes = res && res.changes ? res.changes : 0;
    if (changes > 0 && newLabel !== oldLabel) {
      // Обновить class_name в keywords с oldLabel на newLabel
      await dbRun(
        "UPDATE keywords SET class_name = ? WHERE class_name = ? AND project_id = ?",
        [newLabel, oldLabel, projectId]
      );
      // Удалить модель, так как labels изменились
      await deleteTypingModel(projectId);
    }
    return changes > 0;
  } catch (error) {
    console.error("Error updating typing sample:", error);
    return false;
  }
};

// ================= Embeddings & Model Helpers =================
const updateTypingSampleEmbeddings = async (projectId, items, vectorModel) => {
  // items: [{ sample_id, label, vector: Float32Array|number[], dim }]
  if (!Array.isArray(items) || items.length === 0) return { updated: 0 };
  let updated = 0;
  const savedAt = Date.now();
  for (const it of items) {
    if (!it || !it.sample_id || !it.vector) continue;
    const vecArray = Array.isArray(it.vector)
      ? Array.from(it.vector)
      : it.vector instanceof Float32Array
      ? Array.from(it.vector)
      : Array.from(new Float32Array(it.vector));
    if (!vecArray || vecArray.length === 0) continue;

    const payload = {
      model: vectorModel || null,
      dim: it.dim || vecArray.length,
      vector: vecArray,
      savedAt,
    };

    try {
      const res = await dbRun(
        `UPDATE typing_samples SET embedding = ? WHERE id = ? AND project_id = ?`,
        [JSON.stringify(payload), it.sample_id, projectId]
      );
      if (res && res.changes) updated += res.changes;
    } catch (error) {
      console.error(
        "Failed to update typing sample embedding:",
        it.sample_id,
        error
      );
    }
  }
  return { updated };
};

const upsertTypingModel = async (projectId, payload) => {
  // payload: { model_name, vector_model, payload_json }
  if (!projectId || !payload) return false;
  const now = Date.now();
  const sql = `INSERT INTO typing_model (project_id, model_name, vector_model, payload_json, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(project_id) DO UPDATE SET
                 model_name = excluded.model_name,
                 vector_model = excluded.vector_model,
                 payload_json = excluded.payload_json,
                 created_at = excluded.created_at`;
  await dbRun(sql, [
    projectId,
    payload.model_name,
    payload.vector_model,
    typeof payload.payload_json === "string"
      ? payload.payload_json
      : JSON.stringify(payload.payload_json || {}),
    now,
  ]);
  return true;
};

const deleteTypingModel = async (projectId) => {
  try {
    if (!projectId) return false;
    await dbRun("DELETE FROM typing_model WHERE project_id = ?", [projectId]);
    return true;
  } catch (error) {
    console.error("Error deleting typing model:", error);
    return false;
  }
};

const getTypingModel = async (projectId) => {
  const row = await dbGet(
    `SELECT project_id, model_name, vector_model, payload_json, created_at FROM typing_model WHERE project_id = ?`,
    [projectId]
  );
  if (!row) return null;
  try {
    return { ...row, payload: JSON.parse(row.payload_json) };
  } catch (e) {
    return { ...row, payload: null };
  }
};

// Embeddings cache helpers
const embeddingsCacheGet = async (key) => {
  try {
    const row = await dbGet(
      `SELECT id, key, embedding, created_at FROM embeddings_cache WHERE key = ? LIMIT 1`,
      [key]
    );
    if (!row) return null;
    try {
      return {
        id: row.id,
        key: row.key,
        embedding: row.embedding ? JSON.parse(row.embedding.toString()) : null,
        created_at: row.created_at,
      };
    } catch (e) {
      return {
        id: row.id,
        key: row.key,
        embedding: null,
        created_at: row.created_at,
      };
    }
  } catch (error) {
    console.error("Error reading embeddings_cache:", error);
    return null;
  }
};

const embeddingsCachePut = async (key, embedding) => {
  try {
    const embJson = embedding ? Buffer.from(JSON.stringify(embedding)) : null;
    await dbRun(
      `INSERT OR REPLACE INTO embeddings_cache (key, embedding, created_at) VALUES (?, ?, ?)`,
      [key, embJson, new Date().toISOString()]
    );
    return true;
  } catch (error) {
    console.error("Error writing embeddings_cache:", error);
    return false;
  }
};

const clearEmbeddingsCache = async () => {
  try {
    await dbRun("DELETE FROM embeddings_cache");
    return true;
  } catch (error) {
    console.error("Error clearing embeddings_cache:", error);
    return false;
  }
};

const getEmbeddingsCacheSize = async () => {
  try {
    const row = await dbGet("SELECT COUNT(*) as count FROM embeddings_cache");
    return row ? row.count : 0;
  } catch (error) {
    console.error("Error getting embeddings_cache size:", error);
    return 0;
  }
};

// Удалить одно ключевое слово по id
const keywordsDelete = async (id) => {
  try {
    console.log(`keywordsDelete called with id: ${id}`);
    if (!id) {
      console.log("keywordsDelete: id is falsy, returning false");
      return false;
    }
    const result = await dbRun("DELETE FROM keywords WHERE id = ?", [id]);
    // result is the Statement 'this' from sqlite3; it contains 'changes'
    const changes = result && result.changes ? result.changes : 0;
    console.log(`keywordsDelete: id=${id} changes=${changes}`);
    return changes > 0;
  } catch (error) {
    console.error("Error deleting keyword:", error);
    return false;
  }
};

// Integrations support removed from DB layer; external key management (keytar) used instead.

module.exports = {
  db,
  dbPath,
  dbGet,
  dbAll,
  dbRun,
  updateProjectStatus,
  getProjectStatus,
  isUrlDisallowed,
  isUrlProcessed,
  getProjectStats,
  updateProjectQueueStats,
  getProjectQueueSize,
  // Project/URL helpers
  projectsFindOneById,
  projectsFindAll,
  projectsInsert,
  projectsUpdate,
  projectsRemove,
  getSortedData,
  syncProjectStats,
  getUrlsStats,
  saveError,
  saveData,
  // Keywords helpers
  keywordsFindByProject,
  keywordsCountByProject,
  keywordsInsert,
  keywordsInsertBatch,
  keywordsRemove,
  keywordsClear,
  keywordsDelete,
  keywordsApplyStopWords,
  // Stop words helpers
  stopWordsFindByProject,
  stopWordsInsertBatch,
  stopWordsRemove,
  stopWordsClear,
  // Categories helpers
  categoriesFindByProject,
  categoriesInsert,
  categoriesInsertBatch,
  categoriesClear,
  categoriesDelete,
  // Typing samples helpers
  typingSamplesFindByProject,
  typingSamplesInsertBatch,
  typingSamplesClear,
  typingSamplesDelete,
  typingSamplesUpdate,
  keywordsDelete,
  // Integrations support removed (use OS keyring / keytar)
  // Typing samples helpers
  typingSamplesFindByProject,
  typingSamplesInsertBatch,
  typingSamplesClear,
  typingSamplesDelete,
  // Embeddings cache helpers
  embeddingsCacheGet,
  embeddingsCachePut,
  clearEmbeddingsCache,
  getEmbeddingsCacheSize,
  // Embeddings & model
  updateTypingSampleEmbeddings,
  upsertTypingModel,
  getTypingModel,
  deleteTypingModel,
};
