import type Database from 'better-sqlite3';

type Migration = {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    id: 1,
    name: 'urls_current_and_history',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS urls_current (
            project_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            last_run_id INTEGER,
            last_changed_at DATETIME,
            changed_any INTEGER DEFAULT 0,
            changed_fields TEXT,
            type TEXT,
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
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (project_id, url)
          )`
      ).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_urls_current_project ON urls_current(project_id);').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_urls_current_changed_any ON urls_current(project_id, changed_any);').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_urls_current_changed_at ON urls_current(project_id, last_changed_at);').run();

      db.prepare(
        `CREATE TABLE IF NOT EXISTS url_param_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            param_key TEXT NOT NULL,
            prev_value TEXT,
            new_value TEXT,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            run_id INTEGER
          )`
      ).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_url_param_history_key ON url_param_history(project_id, url, param_key);').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_url_param_history_changed_at ON url_param_history(project_id, param_key, changed_at);').run();
    },
  },
  {
    id: 2,
    name: 'url_source_split',
    up: (db) => {
      const cols: any[] = db.prepare("PRAGMA table_info('urls')").all();
      const colNames = new Set((cols || []).map((c: any) => c && c.name));
      if (!colNames.has('source')) {
        db.prepare("ALTER TABLE urls ADD COLUMN source TEXT NOT NULL DEFAULT 'crawler'").run();
      }

      db.prepare(
        `UPDATE urls
         SET source = CASE
           WHEN status = 'uploaded' THEN 'parser'
           WHEN json_valid(content)
             AND COALESCE(json_extract(content, '$.source'), '') IN ('manual_upload', 'parser')
             THEN 'parser'
           ELSE 'crawler'
         END
         WHERE source IS NULL OR TRIM(source) = '' OR source = 'crawler'`
      ).run();

      try {
        db.prepare('DROP INDEX IF EXISTS idx_urls_project_url').run();
      } catch (_) {}

      db.prepare('CREATE INDEX IF NOT EXISTS idx_urls_project_source ON urls(project_id, source);').run();
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_project_url_source ON urls(project_id, url, source);').run();
    },
  },
];

export function applyMigrations(db: Database.Database): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
  ).run();

  const applied = new Set<number>(
    db.prepare('SELECT id FROM schema_migrations').all().map((r: any) => r.id)
  );

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const txBegin = db.prepare('BEGIN');
    const txCommit = db.prepare('COMMIT');
    const txRollback = db.prepare('ROLLBACK');
    try {
      txBegin.run();
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
      txCommit.run();
    } catch (e) {
      try { txRollback.run(); } catch (_) {}
      throw e;
    }
  }
}
