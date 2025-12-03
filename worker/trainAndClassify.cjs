#!/usr/bin/env node
// worker/trainAndClassify.cjs
// End-to-end pipeline:
// 1) Load typing_samples for project
// 2) Check existing model and embeddings coverage
// 3) If missing embeddings -> fetch/save and retrain, else reuse existing model
// 4) Read keywords to process from input file (JSON with {keywords: [...]})
// 5) For each keyword: get embedding (with cache), predict, and print JSONL:
//    { id, bestCategoryId, bestCategoryName, similarity }

const fs = require("fs");
const path = require("path");
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
const {
  dbAll,
  dbGet,
  dbRun,
  embeddingsCacheGet,
  embeddingsCachePut,
  getTypingModel,
  upsertTypingModel,
  updateTypingSampleEmbeddings,
} = dbFacade;
const cls = require("./embeddingsClassifier.cjs");

const VECTOR_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
// must match embeddingsClassifier.cjs MODEL_VERSION
const MODEL_VERSION = "logreg_v2";

// Ensure stdout remains clean JSONL for parent process: redirect incidental logs to stderr
const __origConsoleLog = console.log;
console.log = function (...args) {
  try {
    // send all regular logs to stderr
    console.error.apply(console, args);
  } catch (e) {
    // fallback just in case
    __origConsoleLog.apply(console, args);
  }
};

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function fetchWithCache(texts, model, opts = {}) {
  const results = new Array(texts.length).fill(null);
  const missingIdx = [];
  const sources = new Array(texts.length).fill("unknown");
  for (let i = 0; i < texts.length; i++) {
    const key = texts[i];
    const row = await embeddingsCacheGet(key, model);
    if (row && row.embedding && Array.isArray(row.embedding)) {
      results[i] = row.embedding;
      sources[i] = "cache";
    } else {
      missingIdx.push(i);
    }
  }
  if (missingIdx.length > 0) {
    const inputs = missingIdx.map((i) => texts[i]);
    // Provide progress updates while fetching many embeddings so the parent process
    // can display progress to users.
    const cachedCount = results.filter(
      (r) => Array.isArray(r) && r.length
    ).length;
    let lastPct = -1;
    const embs = await cls.fetchEmbeddings(inputs, {
      model,
      batchSize: 64,
      projectId: opts.projectId,
      onProgress: (processedMissingCount, totalMissing) => {
        try {
          // If caller provided a mapping onProgress, call it. Caller can compute overall progress
          if (opts && typeof opts.onProgress === "function") {
            try {
              opts.onProgress({
                processedMissingCount,
                totalMissing,
                cachedCount,
                textsLength: texts.length,
              });
            } catch (_e) {}
            return;
          }

          const processedTotal = cachedCount + processedMissingCount;
          const pct = Math.round((processedTotal / texts.length) * 100);
          if (pct !== lastPct) {
            try {
              process.stdout.write(`progress: ${pct}\n`);
            } catch (e) {}
            lastPct = pct;
          }
        } catch (e) {}
      },
    });
    for (let j = 0; j < missingIdx.length; j++) {
      const idx = missingIdx[j];
      const emb = embs[j] || [];
      results[idx] = emb;
      const key = texts[idx];
      await embeddingsCachePut(key, emb, model);
      sources[idx] = "openai";
    }
  }
  // Attach sources metadata to the returned array for callers that want it
  try {
    Object.defineProperty(results, "_sources", {
      value: sources,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  } catch (e) {}

  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = Number(args.projectId || args.project_id);
  const inputFile = args.inputFile;
  if (!projectId) {
    console.error("projectId is required");
    process.exit(2);
    return;
  }

  // 1) Load typing_samples (we don't store embeddings in typing_samples anymore)
  const rows = await dbAll(
    `SELECT id, label, text FROM typing_samples WHERE project_id = ? ORDER BY id`,
    [projectId]
  );
  const samples = (rows || []).filter((r) => r && r.text && r.label);
  if (samples.length < 2) {
    console.error("Not enough training samples");
    process.exit(3);
    return;
  }

  // Classifier should use labels from `typing_samples`, not the `categories` table.
  // Build label set from typing_samples and keep a label->id map empty (we won't map to categories here).
  const labels = Array.from(new Set(samples.map((s) => String(s.label))));
  console.error(
    `[trainAndClassify] Detected labels from typing_samples: ${labels.length}`
  );
  const labelToId = new Map(); // no mapping to categories table; classifier will output label names

  // 2) Check model and embeddings coverage
  const sampleIds = samples.map((s) => s.id);
  let existingModelRow = await getTypingModel(projectId);
  let existingModelValid =
    existingModelRow &&
    existingModelRow.vector_model === VECTOR_MODEL &&
    existingModelRow.payload &&
    typeof existingModelRow.payload.D === "number";

  // If model version missing or mismatched, mark as invalid so we retrain
  if (existingModelValid) {
    const mv = existingModelRow.payload.model_version || null;
    if (mv !== MODEL_VERSION) {
      console.error(
        `[trainAndClassify] Existing model version ${mv} != ${MODEL_VERSION}, will retrain.`
      );
      existingModelValid = false;
    }
  }

  const existingEmbeddings = new Map();
  const missing = [];
  // Check embeddings_cache for each sample
  for (const s of samples) {
    try {
      const cacheRow = await embeddingsCacheGet(s.text, VECTOR_MODEL);
      if (
        cacheRow &&
        Array.isArray(cacheRow.embedding) &&
        cacheRow.embedding.length
      ) {
        existingEmbeddings.set(s.id, cacheRow.embedding);
        continue;
      }
    } catch (e) {
      // ignore cache read errors and treat as missing
    }
    missing.push(s);
  }

  // If we have an existing model, ensure embeddings match expected dimension.
  // If dimensions mismatch, treat those samples as missing so we re-fetch embeddings
  try {
    const expectedDim =
      existingModelRow &&
      existingModelRow.payload &&
      typeof existingModelRow.payload.D === "number"
        ? existingModelRow.payload.D
        : null;
    if (expectedDim) {
      const toRem = [];
      for (const [sid, emb] of existingEmbeddings.entries()) {
        if (!Array.isArray(emb) || emb.length !== expectedDim) {
          // find sample by id and mark missing so we re-fetch a fresh embedding
          const sample = samples.find((x) => x.id === sid);
          if (sample) {
            missing.push(sample);
            try {
              await dbRun(
                "DELETE FROM embeddings_cache WHERE key = ? AND (vector_model = ? OR vector_model IS NULL)",
                [sample.text, VECTOR_MODEL]
              );
            } catch (err) {}
          }
          toRem.push(sid);
        }
      }
      for (const sid of toRem) existingEmbeddings.delete(sid);
    }
  } catch (e) {}
  console.error(
    `[trainAndClassify] Samples: ${
      samples.length
    }, modelPresent=${!!existingModelRow}, modelValid=${existingModelValid}, embeddingsMissing=${
      missing.length
    }`
  );

  // 3) Decide whether to train or reuse
  // Pipeline stage ranges (overall percentages)
  const STAGE = {
    fetchTrainEmb: [5, 45],
    training: [45, 80],
    fetchKeywordsEmb: [80, 90],
    classification: [90, 100],
  };
  let modelObj = null;
  if (missing.length === 0 && existingModelValid) {
    // Reuse stored model; skip training
    console.error(
      "[trainAndClassify] Skipping training: model and all embeddings are present."
    );
    modelObj = existingModelRow.payload;
    // mark training stage as completed (we're reusing model)
    try {
      process.stdout.write(`progress: ${STAGE.training[1]}\n`);
    } catch (e) {}
  } else {
    // Fetch embeddings for missing samples and save to DB
    if (missing.length > 0) {
      console.error(
        `[trainAndClassify] Fetching embeddings for ${missing.length} missing samples...`
      );
      const missingTexts = missing.map((m) => m.text);
      // compute cached count from existingEmbeddings (present embeddings we will reuse)
      const cachedCountForSamples = existingEmbeddings.size || 0;
      const samplesTotal = samples.length;
      const missingEmbs = await fetchWithCache(missingTexts, VECTOR_MODEL, {
        projectId,
        onProgress: ({ processedMissingCount = 0, totalMissing = 0 } = {}) => {
          try {
            const processedTotal =
              cachedCountForSamples + processedMissingCount;
            const stagePct = Math.round((processedTotal / samplesTotal) * 100);
            const start = STAGE.fetchTrainEmb[0];
            const end = STAGE.fetchTrainEmb[1];
            const overallPct = Math.min(
              100,
              Math.max(0, Math.round(start + (end - start) * (stagePct / 100)))
            );
            try {
              process.stdout.write(`progress: ${overallPct}\n`);
            } catch (e) {}
          } catch (e) {}
        },
      });
      const itemsMissing = [];
      const dimMissing = (missingEmbs[0] && missingEmbs[0].length) || 0;
      for (let i = 0; i < missing.length; i++) {
        const sample = missing[i];
        const vector = missingEmbs[i];
        if (Array.isArray(vector) && vector.length > 0) {
          existingEmbeddings.set(sample.id, vector);
          itemsMissing.push({
            sample_id: sample.id,
            label: sample.label,
            vector,
            dim: vector.length || dimMissing,
          });
        }
      }
      if (itemsMissing.length > 0) {
        await cls.saveEmbeddingsToDb(projectId, itemsMissing, VECTOR_MODEL);
      }
    }

    // Double-check that every sample has an embedding; fetch as fallback if needed
    const unresolved = samples.filter((s) => !existingEmbeddings.has(s.id));
    if (unresolved.length > 0) {
      console.error(
        `[trainAndClassify] Warning: ${unresolved.length} samples still missing embeddings after sync, fetching now...`
      );
      const texts = unresolved.map((s) => s.text);
      const embs = await fetchWithCache(texts, VECTOR_MODEL, {
        projectId,
        onProgress: ({ processedMissingCount = 0, totalMissing = 0 } = {}) => {
          try {
            // For this secondary fetch, unresolved refers to the subset 'texts' only.
            const cachedForThis = texts.length - totalMissing;
            const processedTotal = cachedForThis + processedMissingCount;
            const stagePct = Math.round((processedTotal / texts.length) * 100);
            const start = STAGE.fetchTrainEmb[0];
            const end = STAGE.fetchTrainEmb[1];
            const overallPct = Math.min(
              100,
              Math.max(0, Math.round(start + (end - start) * (stagePct / 100)))
            );
            try {
              process.stdout.write(`progress: ${overallPct}\n`);
            } catch (e) {}
          } catch (e) {}
        },
      });
      const items = [];
      for (let i = 0; i < unresolved.length; i++) {
        const sample = unresolved[i];
        const vector = embs[i];
        if (Array.isArray(vector) && vector.length > 0) {
          existingEmbeddings.set(sample.id, vector);
          items.push({
            sample_id: sample.id,
            label: sample.label,
            vector,
            dim: vector.length,
          });
        }
      }
      if (items.length > 0) {
        await cls.saveEmbeddingsToDb(projectId, items, VECTOR_MODEL);
      }
    }

    const trainSet = samples
      .map((s) => ({
        embedding: existingEmbeddings.get(s.id),
        label: s.label,
      }))
      .filter(
        (entry) => Array.isArray(entry.embedding) && entry.embedding.length
      );

    if (trainSet.length !== samples.length) {
      console.error(
        `[trainAndClassify] Warning: training set size ${trainSet.length} differs from samples ${samples.length}`
      );
    }

    if (trainSet.length < 2) {
      console.error(
        "[trainAndClassify] Cannot train model: insufficient embeddings after sync"
      );
      process.exit(4);
      return;
    }

    // Train/retrain model using stored embeddings
    console.error("[trainAndClassify] Training/retraining model...");
    let lastTrainPct = -1;
    modelObj = await cls.trainClassifier(trainSet, {
      onTrainProgress: (epochIdx, epochs, epochPct) => {
        try {
          const start = STAGE.training[0];
          const end = STAGE.training[1];
          const overallPct = Math.min(
            100,
            Math.max(0, Math.round(start + (end - start) * (epochPct / 100)))
          );
          if (overallPct !== lastTrainPct) {
            lastTrainPct = overallPct;
            try {
              process.stdout.write(`progress: ${overallPct}\n`);
            } catch (e) {}
          }
        } catch (e) {}
      },
    });
    await cls.saveModelToDb(projectId, modelObj, VECTOR_MODEL);
    console.error("[trainAndClassify] Model saved.");
    // ensure training stage fully reported
    try {
      process.stdout.write(`progress: ${STAGE.training[1]}\n`);
    } catch (e) {}
  }

  // 4) Read input keywords list. Stream-parse to avoid huge JSON.parse
  let keywords = [];
  if (inputFile) {
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

    try {
      keywords = await streamReadArray(inputFile, "keywords");
    } catch (e) {
      // fallback: query DB for unclassified target keywords
      console.error(
        "Failed to stream-parse input file:",
        e && e.message ? e.message : e
      );
    }
  }
  // If input contains keywords array, prefer filtering via DB: select those ids that are marked target_query=1.
  try {
    if (Array.isArray(keywords) && keywords.length > 0) {
      const before = keywords.length;
      const ids = keywords
        .map((k) => (k && k.id ? Number(k.id) : null))
        .filter((v) => Number.isFinite(v));
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        const params = [projectId, ...ids];
        console.error(
          `[trainAndClassify DEBUG] Input keyword ids (${ids.length}):`,
          ids.slice(0, 200)
        );
        const dbKeywords = await dbAll(
          `SELECT id, keyword, target_query FROM keywords WHERE project_id = ? AND id IN (${placeholders}) ORDER BY id`,
          params
        );
        console.error(
          `[trainAndClassify DEBUG] DB returned ${
            Array.isArray(dbKeywords) ? dbKeywords.length : 0
          } matching ids (pre-filter).`
        );
        const filtered = (dbKeywords || []).filter(
          (d) =>
            d &&
            (d.target_query === undefined ||
              d.target_query === null ||
              d.target_query === 1 ||
              d.target_query === "1" ||
              d.target_query === true)
        );
        console.error(
          `[trainAndClassify DEBUG] DB filtered target_query===1 count: ${filtered.length}`
        );
        if (filtered.length > 0) {
          keywords = filtered.map((d) => ({ id: d.id, keyword: d.keyword }));
        } else {
          console.error(
            "[trainAndClassify DEBUG] No DB ids matched target_query=1, falling back to input-flag filtering"
          );
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
        // No numeric ids present — fall back to input flags
        console.error(
          "[trainAndClassify DEBUG] No numeric ids found in input; using input flags for filtering"
        );
        keywords = keywords.filter(
          (k) =>
            k &&
            (k.target_query === undefined ||
              k.target_query === null ||
              k.target_query === 1 ||
              k.target_query === true)
        );
      }
      console.error(
        `[trainAndClassify] Filtered keywords by target_query: ${before} -> ${keywords.length}`
      );
    }
  } catch (e) {
    // ignore filtering errors
  }

  if (!keywords || keywords.length === 0) {
    // Fallback: target keywords without category
    keywords = await dbAll(
      `SELECT id, keyword FROM keywords WHERE project_id = ? AND (target_query IS NULL OR target_query = 1) AND (category_id IS NULL OR category_id = '') AND (category_name IS NULL OR category_name = '') ORDER BY id LIMIT 100000`,
      [projectId]
    );
  }

  if (!keywords || keywords.length === 0) {
    process.exit(0);
    return;
  }

  // 5) Classify keywords and print JSONL for HandlerKeywords to persist
  const kwTexts = keywords.map((k) => k.keyword || "");
  // Fetch embeddings for keywords (classification stage fetch). Map to fetchKeywordsEmb stage.
  let lastKwFetchPct = -1;
  const kwEmbs = await fetchWithCache(kwTexts, VECTOR_MODEL, {
    projectId,
    onProgress: ({
      processedMissingCount = 0,
      totalMissing = 0,
      cachedCount = 0,
      textsLength = 0,
    } = {}) => {
      try {
        // processedMissingCount & cachedCount are relative to kwTexts
        const processedTotal = cachedCount + processedMissingCount;
        const stagePct = textsLength
          ? Math.round((processedTotal / textsLength) * 100)
          : 0;
        const start = STAGE.fetchKeywordsEmb[0];
        const end = STAGE.fetchKeywordsEmb[1];
        const overallPct = Math.min(
          100,
          Math.max(0, Math.round(start + (end - start) * (stagePct / 100)))
        );
        if (overallPct !== lastKwFetchPct) {
          lastKwFetchPct = overallPct;
          try {
            process.stdout.write(`progress: ${overallPct}\n`);
          } catch (e) {}
        }
      } catch (e) {}
    },
  });
  // ensure keyword-embeddings fetch stage reached end
  try {
    process.stdout.write(`progress: ${STAGE.fetchKeywordsEmb[1]}\n`);
  } catch (e) {}
  let processedCount = 0;
  let skippedEmbCount = 0;
  let lastClassPct = -1;
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const emb = kwEmbs[i];
    if (!emb || emb.length !== modelObj.D) {
      skippedEmbCount++;
      console.error(
        `[trainAndClassify DEBUG] Skipping id=${
          kw && kw.id ? kw.id : "(no id)"
        } keyword='${kw && kw.keyword ? kw.keyword : ""}' emb_len=${
          emb && Array.isArray(emb) ? emb.length : 0
        } expected=${modelObj.D}`
      );
      continue;
    }
    // Predict
    const pred = await cls.predict(emb, modelObj);
    const bestLabel = pred.label;
    const bestId = labelToId.get(String(bestLabel));
    const out = {
      id: kw.id,
      bestCategoryId: bestId || null,
      bestCategoryName: bestLabel || null,
      similarity: typeof pred.score === "number" ? pred.score : null,
      embeddingSource:
        kwEmbs && kwEmbs._sources && kwEmbs._sources[i]
          ? kwEmbs._sources[i]
          : "unknown",
    };
    console.error(
      `trainAndClassify result: ${kw.keyword} -> ${out.bestCategoryName} (sim: ${out.similarity})`
    );
    process.stdout.write(JSON.stringify(out) + "\n");
    processedCount++;
    // report classification progress mapped to classification stage
    try {
      const classPct = Math.round((processedCount / keywords.length) * 100);
      const start = STAGE.classification[0];
      const end = STAGE.classification[1];
      const overallPct = Math.min(
        100,
        Math.max(0, Math.round(start + (end - start) * (classPct / 100)))
      );
      if (overallPct !== lastClassPct) {
        lastClassPct = overallPct;
        try {
          process.stdout.write(`progress: ${overallPct}\n`);
        } catch (e) {}
      }
    } catch (e) {}
  }
  console.error(
    `[trainAndClassify DEBUG] processed=${processedCount} skipped_embeddings=${skippedEmbCount} total_input=${keywords.length}`
  );
  // classification done -> 100%
  try {
    process.stdout.write(`progress: 100\n`);
  } catch (e) {}
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
