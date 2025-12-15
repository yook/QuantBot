#!/usr/bin/env node
/*
  worker/assignCategorization.cjs

  CLI: node worker/assignCategorization.cjs --projectId=1

  - Reads categories and keywords for a project from socket/db-sqlite.cjs
  - Ensures keywords table has columns category_id and category_name
  - Computes embeddings via OpenAI Embeddings API (text-embedding-3-small)
  - Computes cosine similarity between each keyword and each category
  - Updates keywords with the best-matching category

  Requirements:
  - axios is a dependency in the project

*/

// Global error handlers for unhandled exceptions/rejections
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.error("[WORKER] Received SIGTERM, exiting");
  process.exit(143);
});

process.on("SIGINT", () => {
  console.error("[WORKER] Received SIGINT, exiting");
  process.exit(130);
});

// (Proxy support removed)
const axios = require("axios");
const path = require("path");
const fs = require("fs");
// Import DB functions for caching and simple queries
function resolveDbFacade() {
  const candidates = [];
  try {
    candidates.push(path.join(__dirname, "..", "electron", "db", "index.cjs"));
  } catch (_) {}
  try {
    if (process.resourcesPath)
      candidates.push(
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "electron",
          "db",
          "index.cjs"
        )
      );
  } catch (_) {}
  try {
    candidates.push(path.join(process.cwd(), "electron", "db", "index.cjs"));
  } catch (_) {}
  let facadePath = null;
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) {
        facadePath = c;
        break;
      }
    } catch (_) {}
  }
  if (!facadePath) facadePath = candidates[0];
  return require(facadePath);
}

const dbFacade = resolveDbFacade();
const { embeddingsCacheGet, embeddingsCachePut, dbAll, dbRun } = dbFacade;
const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  args.forEach((a) => {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out[k] = v || true;
    }
  });
  return out;
}
// Read all data from stdin and parse JSON
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data || "null");
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    process.stdin.on("error", reject);
  });
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function fetchEmbeddings(texts, stageLabel = "embeddings") {
  // texts: array of strings
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const results = [];
  const toFetch = [];
  const toFetchIndices = [];

  // Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const cached = await embeddingsCacheGet(text, MODEL);
    if (cached && cached.embedding) {
      results[i] = cached.embedding;
    } else {
      toFetch.push(text);
      toFetchIndices.push(i);
    }
  }

  // Fetch missing embeddings from OpenAI
  if (toFetch.length > 0) {
    try {
      // Resolve API key dynamically per project from DB via secret-store
      const args = parseArgs();
      const projectId = args.projectId ? Number(args.projectId) : null;
      let key = null;
      try {
        const path = require("path");
        const fs = require("fs");
        const candidates = [];
        try {
          candidates.push(
            path.join(__dirname, "..", "electron", "db", "secret-store.cjs")
          );
        } catch (_) {}
        try {
          if (process.resourcesPath)
            candidates.push(
              path.join(
                process.resourcesPath,
                "app.asar.unpacked",
                "electron",
                "db",
                "secret-store.cjs"
              )
            );
        } catch (_) {}
        try {
          candidates.push(
            path.join(process.cwd(), "electron", "db", "secret-store.cjs")
          );
        } catch (_) {}
        for (const c of candidates) {
          try {
            if (c && fs.existsSync(c)) {
              const ss = require(c);
              if (ss && typeof ss.getSecret === "function") {
                try {
                  key = await ss.getSecret("openai");
                  if (key) break;
                } catch (e) {
                  // ignore
                }
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
      if (!key) {
        console.error(
          "OpenAI API key not found in secret-store. Please save the key via Integrations UI."
        );
        process.exit(1);
      }

      // Use a simple axios options object with Authorization header
      let axiosOpts = { headers: { Authorization: `Bearer ${key}` } };

      // Chunk requests to avoid exceeding token / input limits. Allow override via
      // environment variable `EMBEDDING_BATCH_SIZE` (number of texts per request).
      // Use same default as other workers (trainAndClassify) to avoid too-large requests
      const defaultBatchSize = Number(process.env.EMBEDDING_BATCH_SIZE) || 64;
      const chunks = await chunkArray(toFetch, defaultBatchSize);
      const indexChunks = await chunkArray(toFetchIndices, defaultBatchSize);
      // helper to emit progress JSON lines on stdout so parent process can forward to UI
      function emitProgress(obj) {
        try {
          process.stdout.write(JSON.stringify(obj) + "\n");
        } catch (_) {}
      }

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const idxChunk = indexChunks[ci] || [];
        try {
          const resp = await axios.post(
            OPENAI_EMBED_URL,
            { model: MODEL, input: chunk },
            axiosOpts
          );
          if (resp.data && resp.data.data) {
            const fetchedEmbeddings = resp.data.data.map((d) => d.embedding);
            for (let j = 0; j < fetchedEmbeddings.length; j++) {
              const embedding = fetchedEmbeddings[j];
              const text = chunk[j];
              const index = idxChunk[j];
              if (typeof index === "number") results[index] = embedding;
              try {
                await embeddingsCachePut(text, embedding, MODEL);
              } catch (_) {}
            }
          }
        } catch (errChunk) {
          const respData =
            errChunk && errChunk.response && errChunk.response.data;
          console.error(
            "OpenAI embeddings chunk error:",
            respData || (errChunk && errChunk.message) || errChunk
          );
          // Re-throw to be handled by outer catch so caller sees overall failure
          throw errChunk;
        }
        // Emit progress after this chunk
        try {
          const fetchedSoFar = Math.min(
            (ci + 1) * defaultBatchSize,
            toFetch.length
          );
          emitProgress({
            type: "progress",
            stage: stageLabel,
            fetched: fetchedSoFar,
            total: toFetch.length,
          });
        } catch (_) {}
        // Small delay between chunk requests to reduce burstiness
        if (ci < chunks.length - 1)
          await new Promise((r) =>
            setTimeout(r, Number(process.env.EMBEDDING_CHUNK_DELAY_MS) || 50)
          );
      }
      // Final progress emit
      try {
        emitProgress({
          type: "progress",
          stage: stageLabel,
          fetched: toFetch.length,
          total: toFetch.length,
        });
      } catch (_) {}
    } catch (err) {
      // Detect common auth / invalid key errors and print a clearer message
      const respData = err && err.response && err.response.data;
      console.error("OpenAI embeddings error:", respData || err.message || err);
      try {
        const code = respData && respData.error && respData.error.code;
        const status = err && err.response && err.response.status;
        if (code === "invalid_api_key" || status === 401) {
          console.error(
            "\nОшибка: неверный или недействительный OpenAI API ключ.\nСохраните ключ через UI Интеграций или задайте переменную окружения OPENAI_API_KEY.\nСсылка: https://platform.openai.com/account/api-keys\n"
          );
        }
      } catch (e) {
        // ignore any parsing errors
      }
      throw err;
    }
  }

  return results;
}

async function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function emitWorkerProgress(obj) {
  if (!obj || typeof obj !== "object") return;
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (_) {}
}

async function markEmbeddingsReady(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const batchSize = 500;
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = [];
    for (let j = i; j < Math.min(ids.length, i + batchSize); j++) {
      const num = Number(ids[j]);
      if (Number.isFinite(num)) slice.push(num);
    }
    if (!slice.length) continue;
    const placeholders = slice.map(() => "?").join(",");
    try {
      await dbRun(
        `UPDATE keywords SET has_embedding = 1 WHERE id IN (${placeholders})`,
        slice
      );
    } catch (err) {
      console.error(
        "Failed to update has_embedding flags",
        err?.message || err
      );
    }
  }
}

// Курсорная категоризация напрямую из БД без промежуточных файлов
async function runDbStreamingCategorization(projectId) {
  const CATEGORY_BATCH_SIZE = Number(process.env.CATEGORY_BATCH_SIZE || 500);
  const KEYWORD_BATCH_SIZE = Number(
    process.env.CATEGORIZATION_KEYWORD_CHUNK || 5000
  );

  const countRows = await dbAll(
    "SELECT (SELECT COUNT(*) FROM keywords WHERE project_id = ? AND is_keyword = 1 AND (target_query IS NULL OR target_query = 1)) as kw_cnt, (SELECT COUNT(*) FROM keywords WHERE project_id = ? AND is_category = 1) as cat_cnt",
    [projectId, projectId]
  );
  const kwTotal = Number(countRows?.[0]?.kw_cnt || 0);
  const catTotal = Number(countRows?.[0]?.cat_cnt || 0);

  console.log(
    `[assignCategorization] DB streaming mode: project=${projectId}, keywords=${kwTotal}, categories=${catTotal}, keyBatch=${KEYWORD_BATCH_SIZE}, catBatch=${CATEGORY_BATCH_SIZE}`
  );

  if (!kwTotal || catTotal < 1) {
    console.error("Nothing to categorize (missing keywords or categories)");
    return;
  }

  const fetchKeywordBatch = async (lastId) =>
    dbAll(
      "SELECT id, keyword FROM keywords WHERE project_id = ? AND is_keyword = 1 AND (target_query IS NULL OR target_query = 1) AND id > ? ORDER BY id LIMIT ?",
      [projectId, lastId, KEYWORD_BATCH_SIZE]
    );

  const forEachCategoryBatch = async (fn) => {
    let lastId = 0;
    while (true) {
      const batch = await dbAll(
        "SELECT id, keyword AS category_name FROM keywords WHERE project_id = ? AND is_category = 1 AND id > ? ORDER BY id LIMIT ?",
        [projectId, lastId, CATEGORY_BATCH_SIZE]
      );
      if (!batch || !batch.length) break;
      lastId = batch[batch.length - 1].id;
      await fn(batch);
    }
  };

  let processed = 0;
  let lastKeyId = 0;
  while (true) {
    const keywordBatch = await fetchKeywordBatch(lastKeyId);
    if (!keywordBatch || !keywordBatch.length) break;
    lastKeyId = keywordBatch[keywordBatch.length - 1].id;

    const kwTexts = keywordBatch.map((k) => k.keyword || "");
    const kwEmbeddings = await fetchEmbeddings(kwTexts, "keyword_embeddings");
    const kwIdsToMark = [];
    for (let i = 0; i < keywordBatch.length; i++) {
      const vec = kwEmbeddings[i];
      if (Array.isArray(vec) && vec.length) {
        keywordBatch[i].embedding = vec;
        kwIdsToMark.push(keywordBatch[i].id);
      } else {
        keywordBatch[i].embedding = null;
      }
    }
    if (kwIdsToMark.length) await markEmbeddingsReady(kwIdsToMark);

    const best = keywordBatch.map(() => ({ sim: -1, cat: null }));

    await forEachCategoryBatch(async (catBatch) => {
      const catTexts = catBatch.map((c) => c.category_name || "");
      const catEmbeddings = await fetchEmbeddings(
        catTexts,
        "category_embeddings"
      );
      const catIdsToMark = [];
      for (let ci = 0; ci < catBatch.length; ci++) {
        const catEmb = catEmbeddings[ci];
        if (!Array.isArray(catEmb) || !catEmb.length) continue;
        const cat = catBatch[ci];
        catIdsToMark.push(cat.id);
        for (let ki = 0; ki < keywordBatch.length; ki++) {
          const kw = keywordBatch[ki];
          const kwEmb = kw.embedding;
          if (!Array.isArray(kwEmb)) continue;
          const sim = cosineSimilarity(kwEmb, catEmb);
          if (sim > best[ki].sim) {
            best[ki] = { sim, cat };
          }
        }
      }
      if (catIdsToMark.length) await markEmbeddingsReady(catIdsToMark);
    });

    for (let i = 0; i < keywordBatch.length; i++) {
      const kw = keywordBatch[i];
      const b = best[i];
      process.stdout.write(
        JSON.stringify({
          id: kw.id,
          bestCategoryId: b.cat ? b.cat.id : null,
          bestCategoryName: b.cat ? b.cat.category_name : null,
          similarity: b.sim,
          embeddingSource: kw.embeddingSource || "unknown",
        }) + "\n"
      );
    }

    processed += keywordBatch.length;
    emitWorkerProgress({
      type: "progress",
      stage: "categorization",
      fetched: processed,
      total: kwTotal || null,
    });
  }
}

async function main() {
  const args = parseArgs();
  const projectId = args.projectId ? Number(args.projectId) : null;
  if (!projectId) {
    console.error("Please provide --projectId=<id>");
    process.exit(1);
  }
  // Если не передан inputFile — читаем напрямую из БД курсорно, без промежуточного файла
  if (!args.inputFile) {
    await runDbStreamingCategorization(projectId);
    return;
  }

  console.log(
    `Assigning keywords for project ${projectId} using model ${MODEL}`
  );

  // Поддержка старого пути через inputFile/stdin: { categories: [...], keywords: [...] }
  let categories = [];
  let keywords = [];
  let keywordStreamIteratorFactory = null;
  if (args.inputFile) {
    // Stream-parse categories fully (они обычно малы) и keywords лениво, чтобы избежать OOM
    async function streamReadArray(filePath, key) {
      return new Promise((resolve, reject) => {
        const rs = fs.createReadStream(filePath, { encoding: "utf8" });
        let buf = "";
        let state = "searching";
        const out = [];
        let depth = 0;
        let objBuf = "";

        rs.on("data", (chunk) => {
          buf += chunk;
          if (state === "searching") {
            const idx = buf.indexOf('"' + key + '"');
            if (idx === -1) {
              if (buf.length > 1024 * 10) buf = buf.slice(-1024);
              return;
            }
            const rest = buf.slice(idx + key.length + 2);
            const arrIdx = rest.indexOf("[");
            if (arrIdx === -1) return;
            buf = rest.slice(arrIdx + 1);
            state = "inarray";
          }

          if (state === "inarray") {
            for (let i = 0; i < buf.length; i++) {
              const ch = buf[i];
              if (depth === 0) {
                if (ch === "{") {
                  depth = 1;
                  objBuf = "{";
                } else if (ch === "]") {
                  rs.close();
                  resolve(out);
                  return;
                } else {
                  continue;
                }
              } else {
                objBuf += ch;
                if (ch === "{") depth++;
                else if (ch === "}") {
                  depth--;
                  if (depth === 0) {
                    try {
                      out.push(JSON.parse(objBuf));
                    } catch (err) {}
                    objBuf = "";
                  }
                }
              }
            }
            buf = "";
          }
        });
        rs.on("end", () => resolve(out));
        rs.on("error", (e) => reject(e));
      });
    }

    async function* streamReadArrayIterator(filePath, key) {
      const rs = fs.createReadStream(filePath, { encoding: "utf8" });
      let buf = "";
      let state = "searching";
      let depth = 0;
      let objBuf = "";
      for await (const chunk of rs) {
        buf += chunk;
        if (state === "searching") {
          const idx = buf.indexOf('"' + key + '"');
          if (idx === -1) {
            if (buf.length > 1024 * 10) buf = buf.slice(-1024);
            continue;
          }
          const rest = buf.slice(idx + key.length + 2);
          const arrIdx = rest.indexOf("[");
          if (arrIdx === -1) continue;
          buf = rest.slice(arrIdx + 1);
          state = "inarray";
        }

        if (state === "inarray") {
          for (let i = 0; i < buf.length; i++) {
            const ch = buf[i];
            if (depth === 0) {
              if (ch === "{") {
                depth = 1;
                objBuf = "{";
              } else if (ch === "]") {
                return;
              } else {
                continue;
              }
            } else {
              objBuf += ch;
              if (ch === "{") depth++;
              else if (ch === "}") {
                depth--;
                if (depth === 0) {
                  try {
                    yield JSON.parse(objBuf);
                  } catch (_) {}
                  objBuf = "";
                }
              }
            }
          }
          buf = "";
        }
      }
    }

    try {
      categories = await streamReadArray(args.inputFile, "categories");
      keywordStreamIteratorFactory = () =>
        streamReadArrayIterator(args.inputFile, "keywords");
    } catch (e) {
      console.error(
        "Failed to stream-parse input file:",
        e && e.message ? e.message : e
      );
      process.exit(1);
    }
  } else {
    const input = await readStdin();
    if (input) {
      categories = input.categories || [];
      keywords = input.keywords || [];
    }
  }
  if (!Array.isArray(categories) || !Array.isArray(keywords)) {
    console.error("Invalid input. Expected JSON with {categories, keywords}");
    process.exit(1);
  }

  // Flag that keywords are provided as a stream to avoid eager materialization
  const keywordStreamIterator = Boolean(keywordStreamIteratorFactory);
  const estimatedKeywords = keywordStreamIterator
    ? "stream"
    : String(keywords.length);
  console.log(
    `assignCategorization: loaded ${categories.length} categories, ${estimatedKeywords} keywords`
  );

  // Deduplicate categories by name to avoid exploding memory on huge category sets
  const dedupMap = new Map();
  const dedupedCategories = [];
  for (const c of categories) {
    const key = (c && c.category_name ? String(c.category_name) : "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    if (dedupMap.has(key)) continue;
    dedupMap.set(key, true);
    dedupedCategories.push(c);
  }
  if (dedupedCategories.length !== categories.length) {
    console.log(
      `[assignCategorization] Deduped categories: ${categories.length} -> ${dedupedCategories.length}`
    );
  }

  categories = dedupedCategories;

  // Log memory usage to track potential leaks
  const formatMemMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);
  const logMemory = (label) => {
    const mem = process.memoryUsage();
    console.log(
      `[MEMORY ${label}] RSS: ${formatMemMB(mem.rss)} MB, Heap: ${formatMemMB(
        mem.heapUsed
      )}/${formatMemMB(mem.heapTotal)} MB`
    );
  };
  logMemory("after input load");

  // If input provides keywords list, prefer filtering via DB: select ids present in input that are marked target_query=1.
  try {
    if (Array.isArray(keywords) && keywords.length > 0) {
      const before = keywords.length;
      const inputMap = new Map();
      const ids = [];
      for (const k of keywords) {
        if (k && k.id) {
          const idn = Number(k.id);
          if (Number.isFinite(idn)) {
            ids.push(idn);
            inputMap.set(idn, k);
          }
        }
      }
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        const params = [projectId, ...ids];
        const dbKeywords = await dbAll(
          `SELECT id, keyword FROM keywords WHERE project_id = ? AND id IN (${placeholders}) AND (target_query IS NULL OR target_query = 1) ORDER BY id`,
          params
        );
        if (Array.isArray(dbKeywords) && dbKeywords.length > 0) {
          // Merge embeddings and metadata from original input when present
          keywords = dbKeywords.map((k) => {
            const orig = inputMap.get(Number(k.id)) || {};
            return Object.assign({}, k, {
              embedding: orig.embedding || orig.vector || null,
              embeddingSource: orig.embeddingSource || orig.source || null,
            });
          });
        } else {
          // Fallback to input-flag filtering if DB returned nothing
          keywords = keywords.filter(
            (k) =>
              k &&
              (k.target_query === undefined ||
                k.target_query === null ||
                k.target_query === 1 ||
                k.target_query === true)
          );
        }
      } else {
        // No ids in input: fall back to input flag filtering
        keywords = keywords.filter(
          (k) =>
            k &&
            (k.target_query === undefined ||
              k.target_query === null ||
              k.target_query === 1 ||
              k.target_query === true)
        );
      }
      console.log(
        `[assignCategorization] Filtered keywords by target_query: ${before} -> ${keywords.length}`
      );
    }
  } catch (e) {
    // ignore
  }
  const CATEGORY_BATCH_SIZE = Number(process.env.CATEGORY_BATCH_SIZE || 500);
  const KEYWORD_BATCH_SIZE = Number(
    process.env.CATEGORIZATION_KEYWORD_CHUNK || 2000
  );
  const totalKeywords = keywordStreamIterator ? null : keywords.length;
  console.log(
    `Computing similarity for ${
      keywordStreamIterator ? "streamed" : totalKeywords
    } keywords (keyword batch ${KEYWORD_BATCH_SIZE}) in category batches of ${CATEGORY_BATCH_SIZE}...`
  );

  async function* keywordBatchIterator() {
    if (keywordStreamIterator) {
      const iterator = keywordStreamIteratorFactory();
      let batch = [];
      for await (const kw of iterator) {
        if (kw) batch.push(kw);
        if (batch.length >= KEYWORD_BATCH_SIZE) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length) yield batch;
      return;
    }
    while (keywords.length) {
      yield keywords.splice(0, KEYWORD_BATCH_SIZE);
    }
  }

  async function hydrateKeywordBatchEmbeddings(keywordBatch) {
    const missingTexts = [];
    const missingIndices = [];
    const idsToMark = [];
    for (let i = 0; i < keywordBatch.length; i++) {
      const kw = keywordBatch[i];
      if (!kw) continue;
      const existing = Array.isArray(kw.embedding)
        ? kw.embedding
        : Array.isArray(kw.vector)
        ? kw.vector
        : null;
      if (Array.isArray(existing) && existing.length) {
        kw.embedding = existing;
        kw.embeddingSource = kw.embeddingSource || "input";
        if (kw.id !== undefined && kw.id !== null)
          idsToMark.push(Number(kw.id));
        continue;
      }
      const text =
        (typeof kw.keyword === "string" && kw.keyword.trim()) ||
        (typeof kw.text === "string" && kw.text.trim()) ||
        "";
      if (!text) continue;
      missingTexts.push(text);
      missingIndices.push(i);
    }
    if (!missingTexts.length) {
      if (idsToMark.length) await markEmbeddingsReady(idsToMark);
      return;
    }
    const vectors = await fetchEmbeddings(missingTexts, "keyword_embeddings");
    for (let j = 0; j < missingIndices.length; j++) {
      const idx = missingIndices[j];
      const vec = vectors[j];
      if (!Array.isArray(vec) || !vec.length) continue;
      const kw = keywordBatch[idx];
      if (!kw) continue;
      kw.embedding = vec;
      kw.embeddingSource = kw.embeddingSource || "worker";
      if (kw.id !== undefined && kw.id !== null) idsToMark.push(Number(kw.id));
    }
    if (idsToMark.length) await markEmbeddingsReady(idsToMark);
  }

  async function processCategoriesForBatch(keywordBatch, best, batchIndex) {
    for (
      let start = 0;
      start < categories.length;
      start += CATEGORY_BATCH_SIZE
    ) {
      const catBatch = categories.slice(start, start + CATEGORY_BATCH_SIZE);
      if (!catBatch.length) continue;
      const catTexts = catBatch.map((c) => c.category_name || "");
      console.log(
        `Batch ${batchIndex}: embeddings for ${catBatch.length} categories (offset ${start})...`
      );
      logMemory(`before category slice ${batchIndex}:${start}`);
      const catEmbeddings = await fetchEmbeddings(
        catTexts,
        "category_embeddings"
      );
      const catIdsToMark = [];
      logMemory(`after category slice ${batchIndex}:${start}`);
      for (let ci = 0; ci < catBatch.length; ci++) {
        const catEmb = catEmbeddings[ci];
        if (!Array.isArray(catEmb) || !catEmb.length) continue;
        const cat = catBatch[ci];
        if (cat && cat.id !== undefined && cat.id !== null) {
          catIdsToMark.push(Number(cat.id));
        }
        for (let ki = 0; ki < keywordBatch.length; ki++) {
          const kw = keywordBatch[ki];
          if (!kw || !Array.isArray(kw.embedding)) continue;
          const sim = cosineSimilarity(kw.embedding, catEmb);
          if (sim > best[ki].sim) {
            best[ki].sim = sim;
            best[ki].cat = cat;
          }
        }
      }
      if (catIdsToMark.length) await markEmbeddingsReady(catIdsToMark);
    }
  }

  function emitBatchResults(keywordBatch, best) {
    for (let i = 0; i < keywordBatch.length; i++) {
      const kw = keywordBatch[i];
      if (!kw || kw.id === undefined || kw.id === null) continue;
      const state = best[i];
      const result = {
        id: kw.id,
        bestCategoryId: state && state.cat ? state.cat.id : null,
        bestCategoryName: state && state.cat ? state.cat.category_name : null,
        similarity: state ? state.sim : null,
        embeddingSource: kw.embeddingSource || "unknown",
      };
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  }

  let processed = 0;
  let batchIndex = 0;
  for await (const keywordBatch of keywordBatchIterator()) {
    if (!keywordBatch.length) continue;
    batchIndex += 1;
    console.log(
      `[assignCategorization] processing keyword batch ${batchIndex} (${keywordBatch.length} items)`
    );
    await hydrateKeywordBatchEmbeddings(keywordBatch);
    const best = keywordBatch.map(() => ({ sim: -1, cat: null }));
    await processCategoriesForBatch(keywordBatch, best, batchIndex);
    emitBatchResults(keywordBatch, best);
    processed += keywordBatch.length;
    logMemory(
      `after keyword batch ${batchIndex}: ${processed}${
        totalKeywords ? "/" + totalKeywords : ""
      } processed`
    );
    for (let i = 0; i < keywordBatch.length; i++) keywordBatch[i] = null;
  }

  logMemory("categorization completed for input file mode");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  });
}
