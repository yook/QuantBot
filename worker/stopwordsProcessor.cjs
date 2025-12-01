#!/usr/bin/env node
// Worker: import stop words in batches and optionally apply them to keywords
// Usage: node worker/stopwordsProcessor.cjs --config=path/to/config.json
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function log(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (_) {}
}

function parseArgs() {
  const args = process.argv.slice(2);
  const cfgArg = args.find((a) => a.startsWith("--config="));
  const cfgPath = cfgArg ? cfgArg.split("=")[1] : null;
  if (!cfgPath || !fs.existsSync(cfgPath)) {
    log({ type: "error", message: "Config file not found", cfgPath });
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
}

async function main() {
  const cfg = parseArgs();
  const {
    dbPath,
    projectId,
    stopWords = [],
    applyToKeywords = true,
    batchSize = 500,
  } = cfg;
  if (!dbPath || !projectId) {
    log({ type: "error", message: "Missing dbPath or projectId" });
    process.exit(1);
  }

  let db;
  try {
    db = new Database(dbPath);
  } catch (e) {
    log({ type: "error", message: "DB open error", error: e.message });
    process.exit(1);
  }

  // Normalize words
  const normalized = stopWords
    .map((s) => String(s || "").trim())
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());

  const total = normalized.length;
  log({ type: "started", total });

  if (total === 0) {
    log({ type: "finished", inserted: 0 });
    process.exit(0);
  }

  // Use a temp table to import words in batches, then perform a single
  // bulk INSERT OR IGNORE into `stop_words` (reduces locks and speeds up inserts)
  try {
    db.prepare(
      "CREATE TEMP TABLE IF NOT EXISTS _import_stop_words (word TEXT)"
    ).run();
    db.prepare("DELETE FROM _import_stop_words").run();

    const insertTemp = db.prepare(
      "INSERT INTO _import_stop_words (word) VALUES (?)"
    );
    const batchInsertTempTxn = db.transaction((rows) => {
      for (const w of rows) insertTemp.run(w);
    });

    let insertedTemp = 0;
    for (let i = 0; i < total; i += batchSize) {
      const chunk = normalized.slice(i, i + batchSize);
      try {
        batchInsertTempTxn(chunk);
        insertedTemp += chunk.length;
      } catch (e) {
        log({
          type: "warn",
          message: "temp insert batch failed",
          error: e.message,
        });
      }

      const rawPercent = (insertedTemp / Math.max(1, total)) * 100;
      const pct = Math.max(0, Math.min(100, Math.ceil(rawPercent)));
      log({
        type: "progress",
        stage: "import",
        inserted: insertedTemp,
        total,
        percent: pct,
      });
    }

    // Bulk insert from temp into stop_words (project_id, word)
    const before = db
      .prepare("SELECT COUNT(*) AS c FROM stop_words WHERE project_id = ?")
      .get(projectId).c;
    const insertFromTemp = db.prepare(
      "INSERT OR IGNORE INTO stop_words (project_id, word) SELECT ?, word FROM _import_stop_words"
    );
    const info = insertFromTemp.run(projectId);
    const after = db
      .prepare("SELECT COUNT(*) AS c FROM stop_words WHERE project_id = ?")
      .get(projectId).c;
    const actuallyInserted = Math.max(0, after - before);

    // Emit final progress and finished events
    try {
      log({
        type: "progress",
        stage: "inserted",
        inserted: actuallyInserted,
        totalImported: insertedTemp,
      });
    } catch (_) {}

    log({ type: "finished", inserted: actuallyInserted });
  } catch (err) {
    log({ type: "error", message: "bulk import failed", error: err.message });
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  log({ type: "error", message: e.message });
  process.exit(1);
});
