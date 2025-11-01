// DB Worker Process for better-sqlite3
// Runs in separate Node process to avoid Electron ABI mismatch
// Communicates with parent via IPC (stdin/stdout JSON-RPC)

const path = require("path");
const os = require("os");
const fs = require("fs");

// Determine DB path - use DB_PATH env var or fallback
let dbPath = process.env.DB_PATH;

if (!dbPath) {
  // Fallback to default location
  const userDataPath = path.join(os.homedir(), ".quantbot");
  dbPath = path.join(userDataPath, "quantbot.db");
}

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.error("[DB Worker] Starting with DB path:", dbPath);

// Load better-sqlite3 (should work in Node process)
let db = null;
try {
  const Database = require("better-sqlite3");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -200000");
  db.pragma("mmap_size = 268435456");
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("temp_store = MEMORY");

  // Initialize database schema
  initializeSchema();

  console.error("[DB Worker] Database initialized successfully");
} catch (err) {
  console.error("[DB Worker] Failed to initialize database:", err);
  process.exit(1);
}

function initializeSchema() {
  // Projects table
  db.prepare(
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
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_projects_url ON projects(url);"
  ).run();

  // URLs table
  db.prepare(
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
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_urls_project ON urls(project_id);"
  ).run();
  db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_project_url ON urls(project_id, url);"
  ).run();

  // Keywords table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      category_id INTEGER,
      color TEXT,
      disabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_keywords_project ON keywords(project_id);"
  ).run();
  db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_project_keyword ON keywords(project_id, keyword);"
  ).run();

  // Categories table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id);"
  ).run();
  db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_project_name ON categories(project_id, name);"
  ).run();

  // Typing samples table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS typing_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      sample TEXT NOT NULL,
      date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_typing_samples_project ON typing_samples(project_id);"
  ).run();

  // Stopwords table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS stop_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_stop_words_project ON stop_words(project_id);"
  ).run();
  db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_stop_words_project_word ON stop_words(project_id, word);"
  ).run();

  console.error("[DB Worker] Schema initialized");
}

// JSON-RPC handler
process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const request = JSON.parse(line);
      handleRequest(request);
    } catch (err) {
      console.error("[DB Worker] Parse error:", err);
    }
  }
});

function send(response) {
  process.stdout.write(JSON.stringify(response) + "\n");
}

function handleRequest(req) {
  const { id, method, params = [] } = req;

  try {
    let result;

    // Log incoming request for debugging
    if (method.includes("insertBulk")) {
      console.error(`[DB Worker] ${method} called with params:`, {
        paramsLength: params.length,
        keywordsCount: Array.isArray(params[0])
          ? params[0].length
          : "not array",
        projectId: params[1],
      });
    }

    switch (method) {
      // Generic DB methods
      case "get":
        result = db.prepare(params[0]).get(...params.slice(1));
        break;
      case "all":
        result = db.prepare(params[0]).all(...params.slice(1));
        break;
      case "run":
        result = db.prepare(params[0]).run(...params.slice(1));
        break;

      // Projects
      case "projects:getAll":
        result = db.prepare("SELECT * FROM projects").all();
        break;
      case "projects:get":
        result = db
          .prepare("SELECT * FROM projects WHERE id = ?")
          .get(params[0]);
        break;
      case "projects:insert":
        result = db
          .prepare("INSERT INTO projects (name, url) VALUES (?, ?)")
          .run(params[0], params[1]);
        break;
      case "projects:update":
        result = db
          .prepare("UPDATE projects SET name = ?, url = ? WHERE id = ?")
          .run(params[0], params[1], params[2]);
        break;
      case "projects:delete":
        result = db.prepare("DELETE FROM projects WHERE id = ?").run(params[0]);
        break;

      // Keywords
      case "keywords:getAll":
        result = db
          .prepare("SELECT * FROM keywords WHERE project_id = ?")
          .all(params[0]);
        break;
      case "keywords:getWindow": {
        // params: [projectId, skip, limit, sort, searchQuery]
        const projectId = params[0];
        const skip = params[1] || 0;
        const limit = params[2] || 100;
        const sort = params[3] || {}; // {field: 1 or -1}
        const searchQuery = params[4] || "";

        let sql = "SELECT * FROM keywords WHERE project_id = ?";
        const queryParams = [projectId];

        // Add search filter
        if (searchQuery) {
          sql += " AND keyword LIKE ?";
          queryParams.push(`%${searchQuery}%`);
        }

        // Add sorting
        const sortKeys = Object.keys(sort);
        if (sortKeys.length > 0) {
          const sortField = sortKeys[0];
          const sortDir = sort[sortField] === 1 ? "ASC" : "DESC";
          sql += ` ORDER BY ${sortField} ${sortDir}`;
        } else {
          sql += " ORDER BY id ASC"; // Default sort
        }

        // Add pagination
        sql += " LIMIT ? OFFSET ?";
        queryParams.push(limit, skip);

        const rows = db.prepare(sql).all(...queryParams);

        // Get total count for this query
        let countSql =
          "SELECT COUNT(*) as total FROM keywords WHERE project_id = ?";
        const countParams = [projectId];
        if (searchQuery) {
          countSql += " AND keyword LIKE ?";
          countParams.push(`%${searchQuery}%`);
        }
        const countResult = db.prepare(countSql).get(...countParams);

        result = {
          keywords: rows,
          total: countResult.total,
          skip,
          limit,
        };
        break;
      }
      case "keywords:insert":
        result = db
          .prepare(
            "INSERT INTO keywords (keyword, project_id, category_id, color, disabled) VALUES (?, ?, ?, ?, ?)"
          )
          .run(params[0], params[1], params[2], params[3], params[4]);
        break;
      case "keywords:update":
        result = db
          .prepare(
            "UPDATE keywords SET keyword = ?, category_id = ?, color = ?, disabled = ? WHERE id = ?"
          )
          .run(params[0], params[1], params[2], params[3], params[4]);
        break;
      case "keywords:delete":
        result = db.prepare("DELETE FROM keywords WHERE id = ?").run(params[0]);
        break;
      case "keywords:insertBulk": {
        const keywords = params[0]; // array of strings
        const projectId = params[1];

        console.error(
          `[DB Worker] insertBulk: ${keywords?.length} keywords for project ${projectId}`
        );

        if (!Array.isArray(keywords)) {
          throw new Error(
            `Expected keywords to be an array, got ${typeof keywords}`
          );
        }

        if (!projectId) {
          throw new Error("Project ID is required");
        }

        // Use INSERT OR IGNORE to skip duplicates (unique index on project_id, keyword)
        // Only insert keyword and project_id - other fields have defaults or are optional
        const insertStmt = db.prepare(
          "INSERT OR IGNORE INTO keywords (keyword, project_id) VALUES (?, ?)"
        );
        let inserted = 0;
        const insertMany = db.transaction((kws) => {
          for (const kw of kws) {
            try {
              const info = insertStmt.run(kw, projectId);
              if (info.changes > 0) inserted++;
            } catch (err) {
              console.error(
                `[DB Worker] Failed to insert keyword "${kw}":`,
                err.message
              );
              throw err;
            }
          }
        });
        insertMany(keywords);
        console.error(
          `[DB Worker] Successfully inserted ${inserted} new keywords (${
            keywords.length - inserted
          } duplicates skipped)`
        );
        result = {
          inserted,
          total: keywords.length,
          skipped: keywords.length - inserted,
        };
        break;
      }
      case "keywords:deleteByProject":
        result = db
          .prepare("DELETE FROM keywords WHERE project_id = ?")
          .run(params[0]);
        break;
      case "keywords:updateCategory":
        // params: [id, categoryName, categorySimilarity]
        result = db
          .prepare(
            "UPDATE keywords SET category_name = ?, category_similarity = ? WHERE id = ?"
          )
          .run(params[1], params[2], params[0]);
        break;
      case "keywords:updateClass":
        // params: [id, className, classSimilarity]
        result = db
          .prepare(
            "UPDATE keywords SET class_name = ?, class_similarity = ? WHERE id = ?"
          )
          .run(params[1], params[2], params[0]);
        break;
      case "keywords:updateCluster":
        // params: [id, cluster]
        result = db
          .prepare("UPDATE keywords SET cluster = ? WHERE id = ?")
          .run(params[1], params[0]);
        break;

      // Categories
      case "categories:getAll":
        result = db
          .prepare("SELECT * FROM categories WHERE project_id = ?")
          .all(params[0]);
        break;
      case "categories:insert":
        result = db
          .prepare(
            "INSERT INTO categories (name, project_id, color) VALUES (?, ?, ?)"
          )
          .run(params[0], params[1], params[2]);
        break;
      case "categories:update":
        result = db
          .prepare("UPDATE categories SET name = ?, color = ? WHERE id = ?")
          .run(params[0], params[1], params[2]);
        break;
      case "categories:delete":
        result = db
          .prepare("DELETE FROM categories WHERE id = ?")
          .run(params[0]);
        break;

      // Typing samples
      case "typing:getAll":
        result = db
          .prepare("SELECT * FROM typing_samples WHERE project_id = ?")
          .all(params[0]);
        break;
      case "typing:insert":
        result = db
          .prepare(
            "INSERT INTO typing_samples (project_id, url, sample, date) VALUES (?, ?, ?, ?)"
          )
          .run(params[0], params[1], params[2], params[3]);
        break;
      case "typing:update":
        result = db
          .prepare(
            "UPDATE typing_samples SET url = ?, sample = ?, date = ? WHERE id = ?"
          )
          .run(params[0], params[1], params[2], params[3]);
        break;
      case "typing:delete":
        result = db
          .prepare("DELETE FROM typing_samples WHERE id = ?")
          .run(params[0]);
        break;
      case "typing:deleteByProject":
        result = db
          .prepare("DELETE FROM typing_samples WHERE project_id = ?")
          .run(params[0]);
        break;

      // Stopwords
      case "stopwords:getAll":
        result = db
          .prepare("SELECT * FROM stop_words WHERE project_id = ?")
          .all(params[0]);
        break;
      case "stopwords:insert":
        result = db
          .prepare(
            "INSERT OR IGNORE INTO stop_words (project_id, word) VALUES (?, ?)"
          )
          .run(params[0], params[1]);
        break;
      case "stopwords:delete":
        result = db
          .prepare("DELETE FROM stop_words WHERE id = ?")
          .run(params[0]);
        break;
      case "stopwords:deleteByProject":
        result = db
          .prepare("DELETE FROM stop_words WHERE project_id = ?")
          .run(params[0]);
        break;

      // URLs
      case "urls:getAll":
        result = db
          .prepare("SELECT * FROM urls WHERE project_id = ?")
          .all(params[0]);
        break;
      case "urls:getSorted": {
        // params[0] is SortedRequestOptions: {id, sort, limit, skip, db}
        // sort is SortOption: {fieldName: 1} or {fieldName: -1}
        const options = params[0];
        const project_id = options.id;
        const limit = options.limit || 50;
        const offset = options.skip || 0;

        // Extract sort field and direction from sort object
        let sortBy = "id"; // default
        let order = "ASC"; // default

        if (options.sort && typeof options.sort === "object") {
          const sortKeys = Object.keys(options.sort);
          if (sortKeys.length > 0) {
            sortBy = sortKeys[0];
            order = options.sort[sortBy] === -1 ? "DESC" : "ASC";
          }
        }

        const sql = `SELECT * FROM urls WHERE project_id = ? ORDER BY ${sortBy} ${order} LIMIT ? OFFSET ?`;
        result = db.prepare(sql).all(project_id, limit, offset);
        break;
      }
      case "urls:count":
        result = db
          .prepare("SELECT COUNT(*) as count FROM urls WHERE project_id = ?")
          .get(params[0]);
        break;
      case "urls:insert":
        result = db
          .prepare(
            "INSERT INTO urls (project_id, url, status, cluster) VALUES (?, ?, ?, ?)"
          )
          .run(params[0], params[1], params[2], params[3]);
        break;
      case "urls:update":
        result = db
          .prepare(
            "UPDATE urls SET url = ?, status = ?, cluster = ? WHERE id = ?"
          )
          .run(params[0], params[1], params[2], params[3]);
        break;
      case "urls:delete":
        result = db.prepare("DELETE FROM urls WHERE id = ?").run(params[0]);
        break;
      case "urls:deleteByProject":
        result = db
          .prepare("DELETE FROM urls WHERE project_id = ?")
          .run(params[0]);
        break;

      default:
        throw new Error(`Unknown method: ${method}`);
    }

    send({ id, result });
  } catch (error) {
    console.error(`[DB Worker] Error handling ${req.method}:`, {
      error: error.message,
      stack: error.stack,
      method: req.method,
      paramsCount: req.params?.length,
    });
    send({ id, error: error.message, stack: error.stack });
  }
}

process.on("uncaughtException", (err) => {
  console.error("[DB Worker] Uncaught exception:", err);
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.error("[DB Worker] SIGTERM received, closing database");
  if (db) db.close();
  process.exit(0);
});

console.error("[DB Worker] Ready");
