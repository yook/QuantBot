#!/usr/bin/env node
// worker/cluster-components.js
// Connected-components clustering variant.
// - Build graph edges between two items if cosineSimilarity >= threshold AND sources differ
// - Find connected components via DFS
// - Compute centroid as mean of normalized vectors for each cluster
// - Support incremental addition: addNewsToExistingClusters(enrichedHeadlines, clusters, opts)
// This file exports two functions for use by workers or other modules.

// const crypto = require("crypto");

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
  // enrichedHeadlines: array of items with .vector
  // clusters: array of cluster objects created by buildInitialClustersWithVectors or earlier
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
            // mark and skip
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
      // mark used partner to avoid reuse
      enrichedHeadlines[partnerIdx] = { ...partner, __used: true };
      hasUpdates = true;
    }
  }

  if (hasUpdates) {
    return clusters;
  }
  return clusters;
}

module.exports = {
  buildInitialClustersWithVectors,
  addNewsToExistingClusters,
  // helpers exported for testing
  _helpers: { cosineSimilarity, normalize, updateCentroid, generateClusterId },
};

// Standalone worker execution
if (require.main === module) {
  const fs = require("fs");
  const path = require("path");

  // Parse command line arguments
  const args = process.argv.slice(2);
  let inputFile,
    projectId,
    threshold = 0.5;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--inputFile=")) inputFile = args[i].split("=")[1];
    if (args[i].startsWith("--projectId=")) projectId = args[i].split("=")[1];
    if (args[i].startsWith("--threshold="))
      threshold = parseFloat(args[i].split("=")[1]) || 0.5;
  }

  if (!inputFile) {
    console.error("Missing --inputFile");
    process.exit(1);
  }

  try {
    console.error("0%");
    const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    const keywords = input.keywords || [];

    if (!Array.isArray(keywords) || keywords.length === 0) {
      console.error("No keywords provided");
      process.exit(0);
    }

    // Enrich keywords for clustering
    const enriched = keywords.map((k, idx) => ({
      id: k.id,
      text: k.keyword || "",
      vector: k.embedding,
      source: `kw_${k.id || idx}`, // unique source for each keyword
    }));

    console.error(
      `Keywords with embeddings: ${
        keywords.filter((k) => k.embedding).length
      }/${keywords.length}`
    );

    console.error("50%");
    const clusters = buildInitialClustersWithVectors(enriched, threshold);

    console.error(
      `Graph built, clusters found: ${
        clusters.length
      }, total items in clusters: ${clusters.reduce(
        (sum, c) => sum + c.items.length,
        0
      )}`
    );

    // Detailed debug logs for cluster assignment logic
    try {
      const assignedIds = new Set();
      const formatText = (txt) =>
        (txt || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const formatNumber = (value) =>
        Number.isFinite(value) ? value.toFixed(4) : String(value);

      console.error(
        `[cluster-debug] Threshold used for similarity comparisons: ${formatNumber(
          threshold
        )}`
      );

      clusters.forEach((cl, idx) => {
        const label = `cluster_${idx + 1}`;
        const memberSummaries = cl.items
          .map(
            (item) =>
              `${item.id || "(no-id)"}:"${formatText(item.text || item.title)}"`
          )
          .join(", ");
        console.error(
          `[cluster-debug] ${label} size=${cl.items.length} members=[${memberSummaries}]`
        );

        cl.items.forEach((item) => {
          assignedIds.add(item.id);

          if (!Array.isArray(item.vector) || item.vector.length === 0) {
            console.error(
              `[cluster-debug] keyword=${
                item.id || "(no-id)"
              } text="${formatText(
                item.text
              )}" -> ${label} (no embedding vector present)`
            );
            return;
          }

          let bestMatch = null;
          let bestSim = -1;
          for (const other of cl.items) {
            if (!other || other.id === item.id) continue;
            if (!Array.isArray(other.vector) || other.vector.length === 0)
              continue;
            const sim = cosineSimilarity(item.vector, other.vector);
            if (sim > bestSim) {
              bestSim = sim;
              bestMatch = other;
            }
          }

          if (bestMatch) {
            console.error(
              `[cluster-debug] keyword=${
                item.id || "(no-id)"
              } text="${formatText(item.text)}" -> ${label} (best match ${
                bestMatch.id || "(no-id)"
              }, sim=${formatNumber(bestSim)}, threshold=${formatNumber(
                threshold
              )})`
            );
          } else {
            console.error(
              `[cluster-debug] keyword=${
                item.id || "(no-id)"
              } text="${formatText(
                item.text
              )}" -> ${label} (no secondary matches inside cluster)`
            );
          }
        });
      });

      enriched.forEach((item) => {
        if (!item) return;
        if (assignedIds.has(item.id)) return;

        const baseInfo = `[cluster-debug] keyword=${
          item.id || "(no-id)"
        } text="${formatText(item.text)}"`;

        if (!Array.isArray(item.vector) || item.vector.length === 0) {
          console.error(`${baseInfo} -> noise (no embedding vector)`);
          return;
        }

        let bestMatch = null;
        let bestSim = -1;
        for (const other of enriched) {
          if (!other || other.id === item.id) continue;
          if (!Array.isArray(other.vector) || other.vector.length === 0)
            continue;
          const sim = cosineSimilarity(item.vector, other.vector);
          if (sim > bestSim) {
            bestSim = sim;
            bestMatch = other;
          }
        }

        if (bestMatch) {
          console.error(
            `${baseInfo} -> noise (closest ${
              bestMatch.id || "(no-id)"
            } sim=${formatNumber(bestSim)} < threshold=${formatNumber(
              threshold
            )})`
          );
        } else {
          console.error(
            `${baseInfo} -> noise (no other keywords with embeddings found)`
          );
        }
      });
    } catch (debugLogError) {
      console.error(
        "[cluster-debug] Failed to emit detailed cluster logs:",
        debugLogError
      );
    }

    // Assign cluster labels
    const clusterMap = new Map();
    clusters.forEach((cl, idx) => {
      const label = `cluster_${idx + 1}`;
      cl.items.forEach((item) => {
        clusterMap.set(item.id, label);
      });
    });

    // Output JSONL
    for (const k of keywords) {
      const label = clusterMap.get(k.id) || "noise";
      console.log(JSON.stringify({ id: k.id, cluster_label: label }));
    }
  } catch (error) {
    console.error("Error in clustering worker:", error.message);
    process.exit(1);
  }
}
