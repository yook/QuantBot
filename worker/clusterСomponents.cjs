#!/usr/bin/env node
// worker/cluster-components.cjs
// Connected-components clustering variant.
// - Build graph edges between two items if cosineSimilarity >= threshold AND sources differ
// - Find connected components via DFS
// - Compute centroid as mean of normalized vectors for each cluster
// - Support incremental addition: addNewsToExistingClusters(enrichedHeadlines, clusters, opts)
// This file exports two functions for use by workers or other modules.

function generateClusterId() {
  return `cluster_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

/* ---------------- math helpers ---------------- */
function cosineSimilarity(a, b) {
  if (!a || !b || !Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length !== b.length) {
    // allow shorter by iterating up to min length
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  na = Math.sqrt(na) || 1e-12;
  nb = Math.sqrt(nb) || 1e-12;
  return dot / (na * nb);
}

function normalize(v) {
  if (!Array.isArray(v)) return v;
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] || 0) * (v[i] || 0);
  s = Math.sqrt(s) || 1e-12;
  return v.map((x) => (x || 0) / s);
}

function sumVectors(vecArr) {
  if (!vecArr || vecArr.length === 0) return [];
  const L = vecArr[0].length;
  const sum = new Array(L).fill(0);
  for (const v of vecArr) {
    if (!Array.isArray(v)) continue;
    for (let i = 0; i < L; i++) sum[i] += v[i] || 0;
  }
  return sum;
}

function updateCentroid(cluster) {
  if (!cluster || !Array.isArray(cluster.items) || cluster.items.length === 0) {
    cluster.centroid = null;
    return;
  }
  const vectors = cluster.items
    .map((it) => it.vector)
    .filter(Boolean)
    .map(normalize);
  if (!vectors.length) {
    cluster.centroid = null;
    return;
  }
  const sum = sumVectors(vectors);
  const avg = sum.map((x) => x / vectors.length);
  cluster.centroid = normalize(avg);
}

/* ---------------- core: build components ---------------- */
function buildInitialClustersWithVectors(enrichedHeadlines, threshold) {
  // enrichedHeadlines: array of items { title, text, source, vector, category?, subCategory? }
  if (!Array.isArray(enrichedHeadlines) || enrichedHeadlines.length === 0)
    return [];

  // deduplicate exact text+source
  const dedupMap = new Map();
  for (const h of enrichedHeadlines) {
    const source = h.source || h.publisher || "unknown";
    const text = (h.text || h.title || "").trim();
    const key = `${text}|||${source}`;
    if (!dedupMap.has(key)) dedupMap.set(key, { ...h, source, text });
  }
  const dedup = Array.from(dedupMap.values());

  // Build graph: Map index -> Set(neighbor indices)
  const graph = new Map();
  for (let i = 0; i < dedup.length; i++) {
    for (let j = i + 1; j < dedup.length; j++) {
      const ai = dedup[i];
      const aj = dedup[j];
      const si = ai.source || "unknown";
      const sj = aj.source || "unknown";
      if (!ai.vector || !aj.vector) continue;
      const sim = cosineSimilarity(ai.vector, aj.vector);
      if (sim < threshold) continue;
      if (!graph.has(i)) graph.set(i, new Set());
      if (!graph.has(j)) graph.set(j, new Set());
      graph.get(i).add(j);
      graph.get(j).add(i);
    }
  }

  // DFS to find connected components
  const visited = new Set();
  const clusters = [];
  for (let i = 0; i < dedup.length; i++) {
    if (visited.has(i)) continue;
    if (!graph.has(i)) continue; // singletons (no edges) ignored
    const stack = [i];
    const comp = [];
    while (stack.length) {
      const v = stack.pop();
      if (visited.has(v)) continue;
      visited.add(v);
      comp.push(dedup[v]);
      const neigh = graph.get(v) || new Set();
      for (const nb of neigh) if (!visited.has(nb)) stack.push(nb);
    }
    if (comp.length > 1) {
      const cl = {
        id: generateClusterId(),
        items: comp,
        created: new Date().toISOString(),
        published: false,
        category: comp[0].category || null,
        subCategory: comp[0].subCategory || null,
      };
      updateCentroid(cl);
      clusters.push(cl);
    }
  }

  return clusters;
}

/* ---------------- incremental addition ---------------- */
async function addNewsToExistingClusters(
  enrichedHeadlines,
  clusters,
  opts = {}
) {
  const { threshold = 0.7, duplicateThreshold = 0.95 } = opts;
  if (!Array.isArray(enrichedHeadlines) || enrichedHeadlines.length === 0)
    return clusters;
  if (!Array.isArray(clusters)) clusters = [];

  let hasUpdates = false;

  for (let idx = 0; idx < enrichedHeadlines.length; idx++) {
    const item = enrichedHeadlines[idx];
    if (!item || !item.vector) continue;
    // check duplicates: same source + very high similarity to any existing item
    let isDuplicate = false;
    outer: for (const cl of clusters) {
      for (const it of cl.items) {
        if (!it.vector) continue;
        if (
          (it.source || it.publisher || "unknown") ===
          (item.source || item.publisher || "unknown")
        ) {
          const sim = cosineSimilarity(it.vector, item.vector);
          if (sim > duplicateThreshold) {
            item.duplicate = true;
            isDuplicate = true;
            break outer;
          }
        }
      }
    }
    if (isDuplicate) continue;

    // find best matching cluster by centroid
    let bestCl = null;
    let bestSim = -1;
    for (const cl of clusters) {
      if (!cl.centroid) continue;
      const sim = cosineSimilarity(item.vector, cl.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestCl = cl;
      }
    }

    if (bestSim >= threshold && bestCl) {
      bestCl.items.push(item);
      bestCl.updated = true;
      bestCl.lastUpdated = new Date().toISOString();
      updateCentroid(bestCl);
      hasUpdates = true;
      continue;
    }

    // otherwise try to create a new cluster from a pair within enrichedHeadlines
    let partnerIdx = -1;
    for (let j = 0; j < enrichedHeadlines.length; j++) {
      if (j === idx) continue;
      const cand = enrichedHeadlines[j];
      if (!cand || !cand.vector) continue;
      if (
        (cand.source || cand.publisher || "unknown") ===
        (item.source || item.publisher || "unknown")
      )
        continue;
      const sim = cosineSimilarity(item.vector, cand.vector);
      if (sim >= threshold) {
        partnerIdx = j;
        break;
      }
    }

    if (partnerIdx !== -1) {
      const partner = enrichedHeadlines[partnerIdx];
      const newCl = {
        id: generateClusterId(),
        items: [item, partner],
        created: new Date().toISOString(),
        published: false,
        category: item.category || partner.category || null,
        subCategory: item.subCategory || partner.subCategory || null,
      };
      updateCentroid(newCl);
      clusters.push(newCl);
      enrichedHeadlines[partnerIdx] = { ...partner, __used: true };
      hasUpdates = true;
    }
  }

  if (hasUpdates) return clusters;
  return clusters;
}

module.exports = {
  buildInitialClustersWithVectors,
  addNewsToExistingClusters,
  _helpers: { cosineSimilarity, normalize, updateCentroid, generateClusterId },
};

// Keep existing standalone behavior: if invoked directly, run the clustering flow
if (require.main === module) {
  const fs = require("fs");
  const path = require("path");

  // Parse command line arguments
  const args = process.argv.slice(2);
  let inputFile,
    threshold = 0.5;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--inputFile=")) inputFile = args[i].split("=")[1];
    if (args[i].startsWith("--threshold="))
      threshold = parseFloat(args[i].split("=")[1]) || 0.5;
  }

  if (!inputFile) {
    console.error("Missing --inputFile");
    process.exit(1);
  }

  try {
    const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    const keywords = input.keywords || [];
    const enriched = keywords.map((k, idx) => ({
      id: k.id,
      text: k.keyword || "",
      vector: k.embedding,
      source: `kw_${k.id || idx}`,
    }));
    const clusters = buildInitialClustersWithVectors(enriched, threshold);
    for (const c of clusters) process.stdout.write(JSON.stringify(c) + "\n");
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  }
}
