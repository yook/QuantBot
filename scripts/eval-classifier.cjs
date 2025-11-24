#!/usr/bin/env node
const {
  dbAll,
  embeddingsCacheGet,
  getTypingModel,
} = require("../electron/db/index.cjs");
const cls = require("../worker/embeddingsClassifier.cjs");

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

(async function main() {
  const args = parseArgs(process.argv);
  const projectId = Number(args.projectId || args.project_id);
  if (!projectId) {
    console.error("Usage: node scripts/eval-classifier.cjs --projectId=ID");
    process.exit(2);
  }

  const rows = await dbAll(
    "SELECT id, label, text FROM typing_samples WHERE project_id = ? ORDER BY id",
    [projectId]
  );
  const samples = (rows || []).filter((r) => r && r.text && r.label);
  if (!samples.length) {
    console.error("No typing_samples found for project", projectId);
    process.exit(3);
  }

  const modelRow = await getTypingModel(projectId);
  if (!modelRow || !modelRow.payload) {
    console.error("No model found for project", projectId);
    process.exit(4);
  }
  const model = modelRow.payload;

  const labels = model.labels || [];
  const labelIdx = new Map(labels.map((l, i) => [String(l), i]));

  const counts = {};
  const predCounts = {};
  const cm = {};
  let total = 0;
  let correct = 0;

  for (const s of samples) {
    const embRow = await embeddingsCacheGet(
      s.text,
      modelRow.vector_model || process.env.EMBEDDING_MODEL
    );
    if (!embRow || !Array.isArray(embRow.embedding)) continue;
    const emb = embRow.embedding;
    try {
      const pred = await cls.predict(emb, model);
      const trueLabel = String(s.label);
      const predLabel = String(pred.label);
      counts[trueLabel] = (counts[trueLabel] || 0) + 1;
      predCounts[predLabel] = (predCounts[predLabel] || 0) + 1;
      cm[trueLabel] = cm[trueLabel] || {};
      cm[trueLabel][predLabel] = (cm[trueLabel][predLabel] || 0) + 1;
      total++;
      if (trueLabel === predLabel) correct++;
    } catch (e) {
      console.error(
        "Predict error for sample",
        s.id,
        e && e.message ? e.message : e
      );
    }
  }

  console.error("Evaluated", total, "samples");
  console.error("Per-true-label counts:", counts);
  console.error("Per-predicted-label counts:", predCounts);
  console.error("Confusion matrix:");
  console.error(JSON.stringify(cm, null, 2));
  console.error("Accuracy:", total ? (correct / total).toFixed(4) : "N/A");

  // Show example logits/probs for first 10 samples
  console.error("Sample predictions (first 10):");
  let shown = 0;
  for (const s of samples) {
    if (shown >= 10) break;
    const embRow = await embeddingsCacheGet(
      s.text,
      modelRow.vector_model || process.env.EMBEDDING_MODEL
    );
    if (!embRow || !Array.isArray(embRow.embedding)) continue;
    const pred = await cls.predict(embRow.embedding, model);
    console.error(
      `- id=${s.id} true=${s.label} pred=${
        pred.label
      } score=${pred.score.toFixed(4)} probs=${pred.probs
        .map((p) => p.toFixed(4))
        .join(", ")}`
    );
    shown++;
  }
})();
