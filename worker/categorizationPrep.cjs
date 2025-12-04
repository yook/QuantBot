#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const os = require("os");
const { once } = require("events");
const Database = require("better-sqlite3");

function parseArgs(argv) {
  const args = {};
  for (const part of argv) {
    if (!part) continue;
    const [key, value] = part.split("=");
    if (key && value !== undefined) {
      const normalizedKey = key.replace(/^--/, "");
      args[normalizedKey] = value;
    }
  }
  return args;
}

function emitProgress(stage, payload) {
  try {
    process.stdout.write(
      JSON.stringify({ type: "progress", stage, ...payload }) + "\n"
    );
  } catch (_) {}
}

function emitResult(payload) {
  process.stdout.write(JSON.stringify({ type: "result", ...payload }) + "\n");
}

function emitError(message) {
  process.stdout.write(JSON.stringify({ type: "error", message }) + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = Number(args.projectId || args.pid);
  const outputFile = args.output || args.outputFile;
  const keywordChunkArg = Number(args.keywordChunk || 0);
  const categoriesColumn = args.categoriesColumn || "name";

  if (!projectId || !Number.isFinite(projectId)) {
    throw new Error("projectId is required");
  }
  if (!outputFile) {
    throw new Error("output path is required");
  }

  const dbPath =
    process.env.DB_PATH || path.join(os.homedir(), ".quantbot", "projects.db");
  const dbDir = path.dirname(dbPath);
  await fs.promises.mkdir(dbDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  const base = process.env.APP_ROOT || path.join(__dirname, "..");
  const embeddings = require(path.join(
    base,
    "electron",
    "db",
    "embeddings.cjs"
  ));
  const attachEmbeddingsToKeywords = embeddings.attachEmbeddingsToKeywords;

  const abortController = new AbortController();
  process.on("SIGTERM", () => abortController.abort());

  try {
    const categories = db
      .prepare(
        `SELECT id, project_id, ${categoriesColumn} AS category_name, created_at FROM categories WHERE project_id = ? ORDER BY id`
      )
      .all(projectId);
    if (!categories || categories.length < 2) {
      throw new Error("Задайте не менее двух категорий для категоризации.");
    }

    const keywordCountRow = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1)"
      )
      .get(projectId);
    const expectedKeywords = Number(keywordCountRow?.cnt || 0);
    if (!expectedKeywords) {
      throw new Error("Не найдены целевые ключевые слова для проекта");
    }

    const keywordChunk =
      keywordChunkArg > 0 ? Math.floor(keywordChunkArg) : 1000;

    emitProgress("embeddings-categories", {
      fetched: 0,
      total: categories.length,
      percent: categories.length ? 0 : 100,
    });

    await attachEmbeddingsToKeywords(categories, {
      chunkSize: 64,
      abortSignal: abortController.signal,
      onProgress: (p) => {
        emitProgress("embeddings-categories", {
          fetched: p.fetched,
          total: typeof p.total !== "undefined" ? p.total : categories.length,
          percent: p.percent,
        });
      },
    });

    emitProgress("embeddings-categories", {
      fetched: categories.length,
      total: categories.length,
      percent: 100,
    });

    await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
    const writeStream = fs.createWriteStream(outputFile, { encoding: "utf8" });
    const writeChunk = async (chunk) => {
      if (!writeStream.write(chunk)) {
        await once(writeStream, "drain");
      }
    };

    await writeChunk('{"categories":');
    await writeChunk(JSON.stringify(categories));
    await writeChunk(',"keywords":[');

    emitProgress("embeddings", {
      fetched: 0,
      total: expectedKeywords,
      percent: expectedKeywords ? 0 : 100,
    });

    const keywordsStmt = db.prepare(
      "SELECT * FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1) AND id > ? ORDER BY id LIMIT ?"
    );

    let processedKeywords = 0;
    let embeddedKeywords = 0;
    let lastId = 0;
    let wroteKeyword = false;

    while (true) {
      if (abortController.signal.aborted) {
        throw new Error("Aborted");
      }

      const chunk = keywordsStmt.all(projectId, lastId, keywordChunk) || [];
      if (!chunk.length) break;

      const chunkBase = processedKeywords;
      const stats = await attachEmbeddingsToKeywords(chunk, {
        chunkSize: 64,
        abortSignal: abortController.signal,
        onProgress: (p) => {
          const segmentFetched = Math.min(p.fetched || 0, chunk.length);
          const globalFetched = Math.min(
            chunkBase + segmentFetched,
            expectedKeywords
          );
          const percent = expectedKeywords
            ? Math.min(
                100,
                Math.round((globalFetched / expectedKeywords) * 100)
              )
            : 100;
          emitProgress("embeddings", {
            fetched: globalFetched,
            total: expectedKeywords,
            percent,
          });
        },
      });

      embeddedKeywords += stats?.embedded || 0;

      for (const keyword of chunk) {
        if (wroteKeyword) await writeChunk(",");
        await writeChunk(JSON.stringify(keyword));
        wroteKeyword = true;
      }

      processedKeywords += chunk.length;
      lastId = chunk[chunk.length - 1].id;

      const percent = expectedKeywords
        ? Math.min(
            100,
            Math.round((processedKeywords / expectedKeywords) * 100)
          )
        : 100;
      emitProgress("embeddings", {
        fetched: processedKeywords,
        total: expectedKeywords,
        percent,
      });

      if (chunk.length < keywordChunk) {
        break;
      }
    }

    await writeChunk("]}");
    writeStream.end();
    await once(writeStream, "finish");

    if (!processedKeywords) {
      throw new Error(
        "Не удалось подготовить ключевые слова для категоризации"
      );
    }

    emitResult({
      outputFile,
      keywordsProcessed: processedKeywords,
      categoriesCount: categories.length,
      embeddedKeywords,
    });
  } finally {
    try {
      db.close();
    } catch (_) {}
  }
}

main().catch((err) => {
  emitError(err?.message || String(err));
  process.exit(1);
});
