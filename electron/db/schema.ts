import Database from 'better-sqlite3';

export function initSchema(db: Database.Database): void {
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
        stats TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
  ).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_projects_url ON projects(url);').run();

  // Add stats column if missing (defensive)
  try {
    const cols: any[] = db.prepare("PRAGMA table_info('projects')").all();
    const colNames = (cols || []).map((c: any) => c && c.name);
    if (!colNames.includes('stats')) {
      db.prepare('ALTER TABLE projects ADD COLUMN stats TEXT;').run();
    }
  } catch (_e) {}

  // URLs table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'crawler',
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
  try {
    const cols: any[] = db.prepare("PRAGMA table_info('urls')").all();
    const colNames = (cols || []).map((c: any) => c && c.name);
    if (!colNames.includes('source')) {
      db.prepare("ALTER TABLE urls ADD COLUMN source TEXT NOT NULL DEFAULT 'crawler';").run();
    }
  } catch (_e) {}
  db.prepare('CREATE INDEX IF NOT EXISTS idx_urls_project ON urls(project_id);').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_urls_project_source ON urls(project_id, source);').run();
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_project_url_source ON urls(project_id, url, source);').run();

  // Disallowed URLs table (crawler rejects/blocked/errors)
  db.prepare(
    `CREATE TABLE IF NOT EXISTS disallowed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        error_type TEXT,
        code INTEGER,
        status TEXT,
        referrer TEXT,
        depth INTEGER,
        protocol TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
  ).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_disallowed_project ON disallowed(project_id);').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_disallowed_type ON disallowed(error_type);').run();
}
