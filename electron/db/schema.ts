import Database from 'better-sqlite3';

export function initSchema(db: Database.Database): {
  typingLabelColumn: string;
  typingTextColumn: string;
  typingDateColumn: string | null;
} {
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
  db.prepare('CREATE INDEX IF NOT EXISTS idx_urls_project ON urls(project_id);').run();
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_project_url ON urls(project_id, url);').run();

  // Keywords table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        category_id INTEGER,
        color TEXT,
        disabled INTEGER DEFAULT 0,
        is_category INTEGER DEFAULT 0,
        is_keyword INTEGER DEFAULT 0,
        has_embedding INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
  ).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_keywords_project ON keywords(project_id);').run();
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_project_keyword ON keywords(project_id, keyword);').run();

  // Ensure extended columns exist on keywords (idempotent migrations)
  try {
    const kcols: any[] = db.prepare("PRAGMA table_info('keywords')").all();
    const knames = (kcols || []).map((c: any) => c && c.name);
    const addIfMissing = (name: string, type: string, extraSql?: string) => {
      if (!knames.includes(name)) {
        try {
          db.prepare(`ALTER TABLE keywords ADD COLUMN ${name} ${type};`).run();
        } catch (_e) {}
        if (extraSql) {
          try { db.prepare(extraSql).run(); } catch (_e) {}
        }
      }
    };
    addIfMissing('category_name', 'TEXT');
    addIfMissing('category_similarity', 'REAL');
    addIfMissing('class_name', 'TEXT');
    addIfMissing('class_similarity', 'REAL');
    addIfMissing('cluster', 'TEXT');
    addIfMissing('cluster_label', 'TEXT');
    addIfMissing('blocking_rule', 'TEXT');
    addIfMissing('target_query', 'INTEGER DEFAULT 1', 'CREATE INDEX IF NOT EXISTS idx_keywords_target_query ON keywords(target_query);');
    addIfMissing('color', 'TEXT');
    addIfMissing('is_category', 'INTEGER DEFAULT 0');
    addIfMissing('is_keyword', 'INTEGER DEFAULT 0');
    addIfMissing('has_embedding', 'INTEGER DEFAULT 0');
    addIfMissing('lemma', 'TEXT');
    addIfMissing('tags', 'TEXT');
    addIfMissing('morphology_processed', 'INTEGER DEFAULT 0', 'CREATE INDEX IF NOT EXISTS idx_keywords_morphology_processed ON keywords(morphology_processed);');
    addIfMissing('is_valid_headline', 'INTEGER');
    addIfMissing('validation_reason', 'TEXT');
  } catch (_e) {}

  // Typing samples table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS typing_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        label TEXT,
        text  TEXT,
        url   TEXT,
        sample TEXT,
        date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
  ).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_typing_samples_project ON typing_samples(project_id);').run();

  // Detect which columns store typing label/text
  let typingLabelColumn = 'label';
  let typingTextColumn = 'text';
  let typingDateColumn: string | null = 'date';
  try {
    const tcols: any[] = db.prepare("PRAGMA table_info('typing_samples')").all();
    const tnames = (tcols || []).map((c: any) => c && c.name);
    const hasLabel = tnames.includes('label');
    const hasText = tnames.includes('text');
    const hasUrl = tnames.includes('url');
    const hasSample = tnames.includes('sample');
    const hasDate = tnames.includes('date');
    if (hasLabel && hasText) {
      typingLabelColumn = 'label';
      typingTextColumn = 'text';
    } else if (hasUrl && hasSample) {
      typingLabelColumn = 'url';
      typingTextColumn = 'sample';
    }
    typingDateColumn = hasDate ? 'date' : null;
  } catch (_e) {}

  // Stopwords
  db.prepare(
    `CREATE TABLE IF NOT EXISTS stop_words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        word TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`
  ).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_stop_words_project ON stop_words(project_id);').run();
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_stop_words_project_word ON stop_words(project_id, word);').run();

  // Embeddings cache
  try {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS embeddings_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          vector_model TEXT,
          embedding BLOB,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    ).run();
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_cache_key ON embeddings_cache(key, vector_model);').run();
  } catch (_e) {}

  return {
    typingLabelColumn,
    typingTextColumn,
    typingDateColumn,
  };
}
