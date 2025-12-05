const { dbGet, dbRun } = require("./adapter.cjs");

// Robustly require the worker embeddings fetcher in dev/prod
function requireEmbeddingsFetcher() {
  try {
    const path = require("path");
    const base = process.env.APP_ROOT || path.join(__dirname, "..");
    return require(path.join(base, "..", "worker", "embeddingsClassifier.cjs"));
  } catch (e) {
    try {
      return require("../../worker/embeddingsClassifier.cjs");
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

  const textToIndices = new Map();
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
  }

  const toFetch = [];
  for (const [text, indices] of textToIndices.entries()) {
    try {
      const cached = await embeddingsCacheGet(text, modelUsed);
      if (
        cached &&
        Array.isArray(cached.embedding) &&
        cached.embedding.length
      ) {
        for (const idx of indices) {
          keywords[idx].embedding = cached.embedding;
          keywords[idx].embeddingSource = "cache";
        }
        continue;
      }
    } catch (_) {}
    toFetch.push(text);
  }

  // Debug: report how many unique texts will be fetched from OpenAI
  try {
    console.error(`[embeddings] toFetch unique texts: ${toFetch.length}, total keywords chunk: ${keywords.length}, chunkSize: ${chunkSize}, model: ${modelUsed}`);
  } catch (_) {}

  let fetched = 0;
  const totalToFetch = toFetch.length;
  for (let start = 0; start < totalToFetch; start += chunkSize) {
    if (opts.abortSignal && opts.abortSignal.aborted) {
      throw new Error("Aborted");
    }
    const chunk = toFetch.slice(start, start + chunkSize);
    const fetchOpts = Object.assign({}, fetchOptions, { model: modelUsed });
    if (effectiveProjectId) fetchOpts.projectId = effectiveProjectId;
    console.error(`[embeddings] requesting embeddings for chunk ${start}-${start + chunk.length - 1} (size ${chunk.length})`);
    const vectors = await fetchEmbeddings(chunk, fetchOpts);
    console.error(`[embeddings] received embeddings for chunk ${start}-${start + chunk.length - 1}: vectors.length=${Array.isArray(vectors)?vectors.length:0}`);
    for (let i = 0; i < chunk.length; i++) {
      const vec = vectors[i];
      const text = chunk[i];
      if (Array.isArray(vec) && vec.length) {
        fetched++;
        const idxs = textToIndices.get(text) || [];
        for (const idx of idxs) {
          keywords[idx].embedding = vec;
          keywords[idx].embeddingSource = "openai";
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

  return {
    total: keywords.length,
    embedded,
    fetched,
    missing: keywords.length - embedded,
  };
}

module.exports.attachEmbeddingsToKeywords = attachEmbeddingsToKeywords;
