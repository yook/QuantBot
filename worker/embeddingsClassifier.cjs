#!/usr/bin/env node
// worker/embeddingsClassifier.cjs
// Utilities to compute OpenAI embeddings and train/predict a multiclass
// logistic regression (softmax) classifier on top of embeddings.
//
// Exports:
// - fetchEmbeddings(texts, opts)
// - trainClassifier(samples, opts) // samples: [{text, label}] or [{embedding, label}]
// - predict(input, model) // input: text or embedding
// - saveModel(path, model) / loadModel(path)
// - saveEmbeddingsToDb(projectId, items, vectorModel)
// - saveModelToDb(projectId, payload)

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const {
  embeddingsCacheGet,
  embeddingsCachePut,
  updateTypingSampleEmbeddings,
  upsertTypingModel,
} = require("../electron/db/index.cjs");

const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";
// bump this when changing training/normalization behavior
const MODEL_VERSION = "logreg_v2";

async function getApiKey() {
  try {
    const keytar = require("keytar");
    const key = await keytar.getPassword("site-analyzer", "openai");
    if (!key)
      throw new Error(
        "OpenAI key not found in keytar (service=site-analyzer, account=openai)"
      );
    return key;
  } catch (err) {
    // rethrow with clearer message
    throw new Error(
      "Failed to read OpenAI key from keytar. Ensure keytar is available and the key is stored under service 'site-analyzer' account 'openai'. " +
        (err && err.message ? err.message : err)
    );
  }
}

async function fetchEmbeddings(texts, opts = {}) {
  // texts: array of strings
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const model = opts.model || DEFAULT_MODEL;
  const batchSize = Math.max(
    1,
    Number(opts.batchSize || opts.chunkSize || 100)
  );

  // Prepare result array and determine which inputs are missing from cache
  const results = new Array(texts.length).fill(null);
  const missingEntries = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    try {
      const row = await embeddingsCacheGet(text, model);
      if (row && Array.isArray(row.embedding) && row.embedding.length) {
        results[i] = row.embedding;
        continue;
      }
    } catch (_) {
      // ignore cache read errors
    }
    missingEntries.push({ idx: i, text });
  }

  // Fetch only the missing ones from OpenAI, if any
  if (missingEntries.length > 0) {
    const key = await getApiKey();
    let processedMissing = 0;
    for (let start = 0; start < missingEntries.length; start += batchSize) {
      const chunkEntries = missingEntries.slice(start, start + batchSize);
      const payload = {
        model,
        input: chunkEntries.map((entry) => entry.text),
      };

      const resp = await axios.post(OPENAI_EMBED_URL, payload, {
        headers: { Authorization: `Bearer ${key}` },
      });

      const data = (resp && resp.data && resp.data.data) || [];
      for (let j = 0; j < data.length; j++) {
        const emb = data[j] && data[j].embedding;
        const entry = chunkEntries[j];
        if (!entry) continue;
        if (Array.isArray(emb) && emb.length) {
          results[entry.idx] = emb;
          try {
            await embeddingsCachePut(entry.text, emb, model);
          } catch (_) {
            // ignore cache write errors
          }
        }
      }
      // update processed count and notify progress
      processedMissing += chunkEntries.length;
      try {
        if (opts && typeof opts.onProgress === "function") {
          try {
            opts.onProgress(processedMissing, missingEntries.length);
          } catch (_e) {}
        }
      } catch (_e) {}
    }
  }

  return results;
}

// Numeric helpers
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function softmax(logits) {
  // stable softmax
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((s, v) => s + v, 0) || 1;
  return exps.map((v) => v / sum);
}

function l2norm(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    s += v * v;
  }
  return Math.sqrt(s);
}

function normalizeVec(arr) {
  const out = new Array(arr.length);
  const n = l2norm(arr);
  const eps = 1e-12;
  if (!isFinite(n) || n < eps) {
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] || 0;
    return out;
  }
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / n;
  return out;
}

function zeros(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = 0;
  return out;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

async function trainClassifier(samples, opts = {}) {
  // samples: [{text, label}] or [{embedding, label}]
  // opts: { epochs, lr, batchSize, reg }
  const epochs = typeof opts.epochs === "number" ? opts.epochs : 500;
  const lr = typeof opts.lr === "number" ? opts.lr : 0.1;
  const batchSize = typeof opts.batchSize === "number" ? opts.batchSize : 32;
  const reg = typeof opts.reg === "number" ? opts.reg : 1e-4;

  // Compute embeddings if needed
  const needEmbeddings = samples.length > 0 && !samples[0].embedding;
  let embeddings = [];
  if (needEmbeddings) {
    const texts = samples.map((s) => s.text || "");
    embeddings = await fetchEmbeddings(texts, opts);
  } else {
    embeddings = samples.map((s) => s.embedding);
  }

  // Normalize embeddings to unit length to improve numeric stability
  embeddings = embeddings.map((e) => normalizeVec(e));

  // Validate embeddings: no missing entries and all numbers must be finite
  for (let i = 0; i < embeddings.length; i++) {
    const e = embeddings[i];
    if (!Array.isArray(e) || e.length === 0) {
      throw new Error(
        `Missing embedding for sample index ${i} (label=${
          samples[i] && samples[i].label
        })`
      );
    }
    for (let j = 0; j < e.length; j++) {
      const v = e[j];
      if (typeof v !== "number" || !isFinite(v)) {
        throw new Error(
          `Invalid embedding value at sample ${i} dim ${j}: ${String(v)}`
        );
      }
    }
  }

  // Build label mapping
  const labels = [];
  const labelToIdx = {};
  for (const s of samples) {
    const label = s.label;
    if (!(label in labelToIdx)) {
      labelToIdx[label] = labels.length;
      labels.push(label);
    }
  }
  const K = labels.length;
  const N = embeddings.length;
  if (N === 0 || K === 0) throw new Error("Empty training data");

  const D = embeddings[0].length;

  // Initialize weights W (K x D) and biases b (K)
  // W as array of Float64Array for each class
  const W = new Array(K);
  for (let k = 0; k < K; k++) W[k] = new Float64Array(D).fill(0);
  const b = new Float64Array(K).fill(0);

  // Prepare dataset indices
  const idxs = new Array(N);
  for (let i = 0; i < N; i++) idxs[i] = i;

  // Convert labels to indices array y
  const y = samples.map((s) => labelToIdx[s.label]);

  for (let ep = 0; ep < epochs; ep++) {
    // Notify training progress (epoch-level)
    try {
      if (opts && typeof opts.onTrainProgress === "function") {
        const epochPct = Math.round(((ep + 1) / epochs) * 100);
        try {
          opts.onTrainProgress(ep + 1, epochs, epochPct);
        } catch (_e) {}
      }
    } catch (_e) {}
    shuffleArray(idxs);
    for (let s = 0; s < N; s += batchSize) {
      const end = Math.min(s + batchSize, N);
      const bsize = end - s;
      // gradients accumulators
      const gradW = new Array(K);
      for (let k = 0; k < K; k++) gradW[k] = new Float64Array(D).fill(0);
      const gradB = new Float64Array(K).fill(0);

      for (let ii = s; ii < end; ii++) {
        const i = idxs[ii];
        const x = embeddings[i];
        // logits
        const logits = new Array(K);
        for (let k = 0; k < K; k++) logits[k] = dot(W[k], x) + b[k];
        const probs = softmax(logits);
        const yi = y[i];
        for (let k = 0; k < K; k++) {
          const diff = probs[k] - (k === yi ? 1 : 0);
          gradB[k] += diff;
          const gk = gradW[k];
          for (let d = 0; d < D; d++) gk[d] += diff * x[d];
        }
      }

      // Update parameters
      for (let k = 0; k < K; k++) {
        const gk = gradW[k];
        const Wk = W[k];
        for (let d = 0; d < D; d++) {
          // average gradient + L2 reg
          const grad = gk[d] / bsize + reg * Wk[d];
          Wk[d] -= lr * grad;
        }
        b[k] -= lr * (gradB[k] / bsize);
      }
    }
  }

  // Return model object (plain arrays for JSON-serializable)
  const model = {
    W: W.map((fa) => Array.from(fa)),
    b: Array.from(b),
    labels: labels,
    D,
  };
  // version the model so callers can decide to retrain if incompatible
  model.model_version = MODEL_VERSION;
  return model;
}

async function predict(input, model, opts = {}) {
  // input: string (text) or embedding array
  let emb = null;
  if (typeof input === "string") {
    const arr = await fetchEmbeddings([input], opts);
    emb = arr[0];
  } else if (Array.isArray(input)) emb = input;
  else if (input && input.embedding) emb = input.embedding;
  else throw new Error("Invalid input for predict");

  const K = model.labels.length;
  const D = model.D;
  if (!emb || emb.length !== D) throw new Error("Embedding length mismatch");

  // normalize embedding before computing logits
  emb = normalizeVec(emb);

  // compute logits
  const logits = new Array(K);
  for (let k = 0; k < K; k++) {
    const Wk = model.W[k];
    logits[k] = dot(Wk, emb) + model.b[k];
  }
  const probs = softmax(logits);
  // pick best
  let bestIdx = 0;
  for (let k = 1; k < K; k++) if (probs[k] > probs[bestIdx]) bestIdx = k;

  return { label: model.labels[bestIdx], score: probs[bestIdx], probs, logits };
}

function saveModel(path, model) {
  const txt = JSON.stringify(model);
  fs.writeFileSync(path, txt, "utf8");
}

function loadModel(path) {
  const txt = fs.readFileSync(path, "utf8");
  const model = JSON.parse(txt);
  return model;
}

module.exports = {
  fetchEmbeddings,
  trainClassifier,
  predict,
  saveModel,
  loadModel,
  // DB helpers
  saveEmbeddingsToDb: async (projectId, items, vectorModel) => {
    // items: [{ sample_id, label, vector: number[]|Float32Array, dim? }]
    return updateTypingSampleEmbeddings(
      projectId,
      items,
      vectorModel || DEFAULT_MODEL
    );
  },
  saveModelToDb: async (projectId, modelObj, vectorModel) => {
    // modelObj — объект логрегрессии из trainClassifier
    const payload = {
      model_name: "logreg",
      vector_model: vectorModel || DEFAULT_MODEL,
      payload_json: JSON.stringify(modelObj),
    };
    return upsertTypingModel(projectId, payload);
  },
};
