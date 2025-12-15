const { dbGet, dbRun, dbAll } = require("./adapter.cjs");
const fs = require('fs');

// Robustly require the worker embeddings fetcher in dev/prod
function requireEmbeddingsFetcher() {
  try {
    const path = require("path");
    const base = process.env.APP_ROOT || path.join(__dirname, "..");
    // Prefer dev worker under electron/workers for repository layout
    const devCandidate1 = path.join(process.cwd(), 'electron', 'workers', 'embeddingsClassifier.cjs');
    const devCandidate2 = path.join(base, '..', 'electron', 'workers', 'embeddingsClassifier.cjs');
    const legacyCandidate = path.join(base, '..', 'worker', 'embeddingsClassifier.cjs');
    if (fs && fs.existsSync && fs.existsSync(devCandidate1)) return require(devCandidate1);
    if (fs && fs.existsSync && fs.existsSync(devCandidate2)) return require(devCandidate2);
    if (fs && fs.existsSync && fs.existsSync(legacyCandidate)) return require(legacyCandidate);
    return require(path.join(base, "..", "worker", "embeddingsClassifier.cjs"));
  } catch (e) {
    try {
      return require("../../electron/workers/embeddingsClassifier.cjs");
    } catch (_) {
      throw e;
    }
  }
}

function decodeEmbedding(row) {
  if (!row) return null;
  const emb = row.embedding;
  try {
    if (Buffer.isBuffer(emb)) {
      // Try to decode as raw Float32 binary first
      try {
        const buf = emb;
        // Create Float32Array view over the buffer
        const floatArray = new Float32Array(
          buf.buffer,
          buf.byteOffset,
          Math.floor(buf.byteLength / 4)
        );
        // Return plain JS array for backward compatibility with callers
        return Array.from(floatArray);
      } catch (e) {
        // Fallback to UTF-8 JSON parsing for legacy string blobs
        const txt = emb.toString("utf8");
        return JSON.parse(txt);
      }
    }
    if (typeof emb === "string") return JSON.parse(emb);
    if (Array.isArray(emb)) return emb;
  } catch (_) {}
  return null;
}

async function embeddingsCacheGet(key, vectorModel) {
  const row = await dbGet(
    "SELECT embedding FROM embeddings_cache WHERE key = ? AND (vector_model = ? OR ? IS NULL) LIMIT 1",
    [key, vectorModel || null, vectorModel || null]
  );
  const embedding = decodeEmbedding(row || {});
  return embedding ? { embedding } : null;
}

async function embeddingsCacheGetBulk(keys, vectorModel) {
  const result = new Map();
  if (!Array.isArray(keys) || !keys.length) return result;

  const unique = [];
  const seen = new Set();
  for (const rawKey of keys) {
    if (typeof rawKey !== "string") continue;
    const key = rawKey.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  if (!unique.length) return result;

  const modelParam = vectorModel || null;
  const PARAM_LIMIT = 997; // 999 - 2 slots for model params
  for (let i = 0; i < unique.length; i += PARAM_LIMIT) {
    const slice = unique.slice(i, i + PARAM_LIMIT);
    const placeholders = slice.map(() => "?").join(",");
    const sql = `SELECT key, embedding FROM embeddings_cache WHERE key IN (${placeholders}) AND (vector_model = ? OR (? IS NULL AND vector_model IS NULL))`;
    const rows = await dbAll(sql, [...slice, modelParam, modelParam]);
    for (const row of rows || []) {
      const embedding = decodeEmbedding(row);
      if (embedding && Array.isArray(embedding)) {
        result.set(row.key, embedding);
      }
    }
  }
  return result;
}

async function embeddingsCachePut(key, embedding, vectorModel) {
  // Store as raw Float32 binary for compactness and speed
  try {
    const floatArray = Float32Array.from(embedding || []);
    const payload = Buffer.from(floatArray.buffer);
    await dbRun(
      "INSERT OR REPLACE INTO embeddings_cache (key, vector_model, embedding, created_at) VALUES (?, ?, ?, ?)",
      [key, vectorModel || null, payload, new Date().toISOString()]
    );
  } catch (e) {
    // Fallback to JSON text if something goes wrong
    const payload = Buffer.from(JSON.stringify(embedding));
    await dbRun(
      "INSERT OR REPLACE INTO embeddings_cache (key, vector_model, embedding, created_at) VALUES (?, ?, ?, ?)",
      [key, vectorModel || null, payload, new Date().toISOString()]
    );
  }
  return true;
}

async function updateTypingSampleEmbeddings(projectId, items, vectorModel) {
  // items: [{ sample_id, label, vector }]
  if (!Array.isArray(items) || items.length === 0) return { updated: 0 };
  let updated = 0;
  for (const it of items) {
    const row = await dbGet(
      "SELECT text FROM typing_samples WHERE id = ? AND project_id = ? LIMIT 1",
      [it.sample_id, projectId]
    );
    const key = row && row.text ? row.text : null;
    if (!key) continue;
    try {
      const floatArray = Float32Array.from(it.vector || []);
      const payload = Buffer.from(floatArray.buffer);
      await dbRun(
        "INSERT OR REPLACE INTO embeddings_cache (key, vector_model, embedding, created_at) VALUES (?, ?, ?, ?)",
        [key, vectorModel || null, payload, new Date().toISOString()]
      );
    } catch (e) {
      const payload = Buffer.from(JSON.stringify(it.vector));
      await dbRun(
        "INSERT OR REPLACE INTO embeddings_cache (key, vector_model, embedding, created_at) VALUES (?, ?, ?, ?)",
        [key, vectorModel || null, payload, new Date().toISOString()]
      );
    }
    updated += 1;
  }
  return { updated };
}

async function getTypingModel(projectId) {
  const row = await dbGet(
    "SELECT model_name, vector_model, payload_json FROM typing_model WHERE project_id = ? LIMIT 1",
    [projectId]
  );
  if (!row) return null;
  let payload = null;
  try {
    payload =
      row.payload_json && typeof row.payload_json === "string"
        ? JSON.parse(row.payload_json)
        : null;
  } catch (_) {}
  return {
    model_name: row.model_name,
    vector_model: row.vector_model,
    payload,
  };
}

async function upsertTypingModel(projectId, payload) {
  // payload: { model_name, vector_model, payload_json }
  if (!projectId || !payload) return false;
  const now = Date.now();
  await dbRun(
    "INSERT INTO typing_model (project_id, model_name, vector_model, payload_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET model_name = excluded.model_name, vector_model = excluded.vector_model, payload_json = excluded.payload_json, created_at = excluded.created_at",
    [
      projectId,
      payload.model_name || "logreg",
      payload.vector_model || null,
      payload.payload_json || "{}",
      now,
    ]
  );
  return true;
}

module.exports = {
  embeddingsCacheGet,
  embeddingsCacheGetBulk,
  embeddingsCachePut,
  updateTypingSampleEmbeddings,
  getTypingModel,
  upsertTypingModel,
};

// Attach OpenAI embeddings to provided keywords in-place, using cache when possible
async function attachEmbeddingsToKeywords(keywords, opts = {}) {
  const { fetchEmbeddings } = requireEmbeddingsFetcher();
  const requestedChunkSize = Number(opts.chunkSize);
  const chunkSize =
    Number.isFinite(requestedChunkSize) && requestedChunkSize > 0
      ? Math.floor(requestedChunkSize)
      : 64;
  const fetchOptions = opts.fetchOptions || {};
  const cacheOnly = Boolean(opts.cacheOnly);
  // Determine projectId for proxy resolution: prefer explicit opt, fallback to keywords array
  const projectIdFromOpts = opts.projectId ? Number(opts.projectId) : null;
  const projectIdFromKeywords =
    keywords && keywords.length && keywords[0].project_id
      ? Number(keywords[0].project_id)
      : null;
  const effectiveProjectId = projectIdFromOpts || projectIdFromKeywords || null;
  const modelUsed =
    fetchOptions.model ||
    process.env.EMBEDDING_MODEL ||
    "text-embedding-3-small";

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return { total: 0, embedded: 0, fetched: 0 };
  }

  const collectKeywordId = (targetSet, kw) => {
    if (!kw) return;
    const rawId = kw.id;
    if (typeof rawId === "number" && Number.isFinite(rawId)) {
      targetSet.add(rawId);
      return;
    }
    if (typeof rawId === "string" && rawId.trim()) {
      const parsed = Number(rawId);
      if (Number.isFinite(parsed)) targetSet.add(parsed);
    }
  };

  const textToIndices = new Map();
  const textCacheHints = new Map();
  const idsToMark = new Set();
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    let text = "";
    if (typeof kw.keyword === "string") text = kw.keyword.trim();
    else if (typeof kw.text === "string") text = kw.text.trim();
    else if (typeof kw.category_name === "string")
      text = kw.category_name.trim();

    keywords[i].embedding = null;
    keywords[i].embeddingSource = "unknown";
    if (!text) continue;
    if (!textToIndices.has(text)) textToIndices.set(text, []);
    textToIndices.get(text).push(i);

    const hasEmbeddingFlag = Boolean(
      kw &&
        (kw.has_embedding === 1 ||
          kw.has_embedding === true ||
          kw.has_embedding === "1")
    );
    if (!textCacheHints.has(text)) {
      textCacheHints.set(text, hasEmbeddingFlag);
    } else if (hasEmbeddingFlag) {
      textCacheHints.set(text, true);
    }
  }

  const cacheCandidates = [];
  for (const [text] of textToIndices.entries()) {
    if (textCacheHints.get(text)) cacheCandidates.push(text);
  }

  let cachedEmbeddings = new Map();
  if (cacheCandidates.length) {
    try {
      cachedEmbeddings = await embeddingsCacheGetBulk(
        cacheCandidates,
        modelUsed
      );
    } catch (_) {
      cachedEmbeddings = new Map();
    }
  }

  const toFetch = [];
  for (const [text, indices] of textToIndices.entries()) {
    const cachedVector = cachedEmbeddings.get(text);
    if (Array.isArray(cachedVector) && cachedVector.length) {
      for (const idx of indices) {
        const kw = keywords[idx];
        kw.embedding = cachedVector;
        kw.embeddingSource = "cache";
        kw.has_embedding = 1;
        collectKeywordId(idsToMark, kw);
      }
      continue;
    }
    toFetch.push(text);
  }

  if (cacheOnly && toFetch.length) {
    const err = new Error(
      `Missing cached embeddings for ${toFetch.length} texts`
    );
    err.code = "EMBEDDING_CACHE_MISS";
    err.missing = toFetch;
    throw err;
  }

  if (toFetch.length) {
    // Debug: report how many unique texts будут запрошены у модели
    try {
      console.error(
        `[embeddings] toFetch unique texts: ${toFetch.length}, total keywords chunk: ${keywords.length}, chunkSize: ${chunkSize}, model: ${modelUsed}`
      );
    } catch (_) {}
  }

  let fetched = 0;
  const totalToFetch = toFetch.length;
  for (let start = 0; start < totalToFetch; start += chunkSize) {
    if (opts.abortSignal && opts.abortSignal.aborted) {
      throw new Error("Aborted");
    }
    const chunk = toFetch.slice(start, start + chunkSize);
    const fetchOpts = Object.assign({}, fetchOptions, { model: modelUsed });
    if (effectiveProjectId) fetchOpts.projectId = effectiveProjectId;
    console.error(
      `[embeddings] requesting embeddings for chunk ${start}-${
        start + chunk.length - 1
      } (size ${chunk.length})`
    );
    const vectors = await fetchEmbeddings(chunk, fetchOpts);
    console.error(
      `[embeddings] received embeddings for chunk ${start}-${
        start + chunk.length - 1
      }: vectors.length=${Array.isArray(vectors) ? vectors.length : 0}`
    );
    for (let i = 0; i < chunk.length; i++) {
      const vec = vectors[i];
      const text = chunk[i];
      if (Array.isArray(vec) && vec.length) {
        fetched++;
        const idxs = textToIndices.get(text) || [];
        for (const idx of idxs) {
          const kw = keywords[idx];
          kw.embedding = vec;
          kw.embeddingSource = "openai";
          kw.has_embedding = 1;
          collectKeywordId(idsToMark, kw);
        }
        try {
          await embeddingsCachePut(text, vec, modelUsed);
        } catch (_) {}
      }
    }
    if (opts.onProgress && typeof opts.onProgress === "function") {
      const currentFetched = Math.min(start + chunkSize, totalToFetch);
      const percent = Math.round((currentFetched / totalToFetch) * 100);
      opts.onProgress({
        fetched: currentFetched,
        total: totalToFetch,
        percent,
      });
    }
  }

  let embedded = 0;
  for (const kw of keywords) {
    if (Array.isArray(kw.embedding) && kw.embedding.length) embedded++;
  }

  if (idsToMark.size) {
    const idsArray = Array.from(idsToMark);
    const placeholders = idsArray.map(() => "?").join(",");
    if (placeholders) {
      try {
        await dbRun(
          `UPDATE keywords SET has_embedding = 1 WHERE id IN (${placeholders})`,
          idsArray
        );
      } catch (err) {
        console.error(
          "[embeddings] failed to update keyword embedding flags",
          err
        );
      }
    }
  }

  return {
    total: keywords.length,
    embedded,
    fetched,
    missing: keywords.length - embedded,
  };
}

module.exports.attachEmbeddingsToKeywords = attachEmbeddingsToKeywords;
