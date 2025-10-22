#!/usr/bin/env node
// worker/trainAndClassify.js
// End-to-end pipeline:
// 1) Load typing_samples for project
// 2) Check existing model and embeddings coverage
// 3) If missing embeddings -> fetch/save and retrain, else reuse existing model
// 4) Read keywords to process from input file (JSON with {keywords: [...]})
// 5) For each keyword: get embedding (with cache), predict, and print JSONL:
//    { id, bestCategoryId, bestCategoryName, similarity }

const fs = require("fs");
const path = require("path");
const db = require("../socket/db-sqlite");
const cls = require("./embeddingsClassifier");

const VECTOR_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

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

async function fetchWithCache(texts, model) {
  const results = new Array(texts.length).fill(null);
  const missingIdx = [];
  for (let i = 0; i < texts.length; i++) {
    const key = `${model}|${texts[i]}`.toLowerCase();
    const row = await db.embeddingsCacheGet(key);
    if (row && row.embedding && Array.isArray(row.embedding)) {
      results[i] = row.embedding;
    } else {
      missingIdx.push(i);
    }
  }
  if (missingIdx.length > 0) {
    const inputs = missingIdx.map((i) => texts[i]);
    const embs = await cls.fetchEmbeddings(inputs, { model });
    for (let j = 0; j < missingIdx.length; j++) {
      const idx = missingIdx[j];
      const emb = embs[j] || [];
      results[idx] = emb;
      const key = `${model}|${texts[idx]}`.toLowerCase();
      await db.embeddingsCachePut(key, emb);
    }
  }
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

  // 1) Load typing_samples
  const rows = await db.dbAll(
    `SELECT id, label, text, embedding FROM typing_samples WHERE project_id = ? ORDER BY id`,
    [projectId]
  );
  const samples = (rows || [])
    .map((r) => {
      let embedding = null;
      if (r && r.embedding) {
        try {
          embedding = JSON.parse(r.embedding);
        } catch (e) {
          embedding = null;
        }
      }
      return { ...r, embedding };
    })
    .filter((r) => r && r.text && r.label);
  if (samples.length < 2) {
    console.error("Not enough training samples");
    process.exit(3);
    return;
  }

  // Ensure categories exist for labels
  const labels = Array.from(new Set(samples.map((s) => String(s.label))));
  try {
    await db.categoriesInsertBatch(projectId, labels);
  } catch (e) {
    // continue even if insert batch has warnings
  }
  // Build label->id map
  const cats = await db.dbAll(
    `SELECT id, category_name FROM categories WHERE project_id = ?`,
    [projectId]
  );
  const labelToId = new Map();
  for (const c of cats || []) labelToId.set(String(c.category_name), c.id);

  // 2) Check model and embeddings coverage
  const sampleIds = samples.map((s) => s.id);
  let existingModelRow = await db.getTypingModel(projectId);
  const existingModelValid =
    existingModelRow &&
    existingModelRow.vector_model === VECTOR_MODEL &&
    existingModelRow.payload &&
    typeof existingModelRow.payload.D === "number";

  const existingEmbeddings = new Map();
  const missing = [];
  for (const s of samples) {
    const emb = s.embedding;
    let vector = null;
    let modelOk = true;

    if (Array.isArray(emb)) {
      vector = emb;
    } else if (emb && typeof emb === "object") {
      if (Array.isArray(emb.vector)) {
        vector = emb.vector;
      }
      if (emb.model && emb.model !== VECTOR_MODEL) {
        modelOk = false;
      }
    }

    if (vector && modelOk) {
      existingEmbeddings.set(s.id, vector);
    } else {
      missing.push(s);
    }
  }
  console.error(
    `[trainAndClassify] Samples: ${
      samples.length
    }, modelPresent=${!!existingModelRow}, modelValid=${existingModelValid}, embeddingsMissing=${
      missing.length
    }`
  );

  // 3) Decide whether to train or reuse
  let modelObj = null;
  if (missing.length === 0 && existingModelValid) {
    // Reuse stored model; skip training
    console.error(
      "[trainAndClassify] Skipping training: model and all embeddings are present."
    );
    modelObj = existingModelRow.payload;
  } else {
    // Fetch embeddings for missing samples and save to DB
    if (missing.length > 0) {
      console.error(
        `[trainAndClassify] Fetching embeddings for ${missing.length} missing samples...`
      );
      const missingTexts = missing.map((m) => m.text);
      const missingEmbs = await fetchWithCache(missingTexts, VECTOR_MODEL);
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
      const embs = await fetchWithCache(texts, VECTOR_MODEL);
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
    modelObj = await cls.trainClassifier(trainSet, {});
    await cls.saveModelToDb(projectId, modelObj, VECTOR_MODEL);
    console.error("[trainAndClassify] Model saved.");
  }

  // 4) Read input keywords list
  let keywords = [];
  if (inputFile) {
    try {
      const txt = fs.readFileSync(inputFile, "utf8");
      const obj = JSON.parse(txt);
      keywords = (obj && obj.keywords) || [];
    } catch (e) {
      // fallback: query DB for unclassified target keywords
    }
  }
  if (!keywords || keywords.length === 0) {
    // Fallback: target keywords without category
    keywords = await db.dbAll(
      `SELECT id, keyword FROM keywords WHERE project_id = ? AND target_query = 1 AND (category_id IS NULL OR category_id = '') AND (category_name IS NULL OR category_name = '') ORDER BY id LIMIT 100000`,
      [projectId]
    );
  }

  if (!keywords || keywords.length === 0) {
    process.exit(0);
    return;
  }

  // 5) Classify keywords and print JSONL for HandlerKeywords to persist
  const kwTexts = keywords.map((k) => k.keyword || "");
  const kwEmbs = await fetchWithCache(kwTexts, VECTOR_MODEL);
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const emb = kwEmbs[i];
    if (!emb || emb.length !== modelObj.D) continue;
    // Predict
    const pred = await cls.predict(emb, modelObj);
    const bestLabel = pred.label;
    const bestId = labelToId.get(String(bestLabel));
    const out = {
      id: kw.id,
      bestCategoryId: bestId || null,
      bestCategoryName: bestLabel || null,
      similarity: typeof pred.score === "number" ? pred.score : null,
    };
    console.error(
      `trainAndClassify result: ${kw.keyword} -> ${out.bestCategoryName} (sim: ${out.similarity})`
    );
    process.stdout.write(JSON.stringify(out) + "\n");
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
