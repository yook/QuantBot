#!/usr/bin/env node
// worker/cluster-components.cjs
// Connected-components clustering variant.
// - Build graph edges between two items if cosineSimilarity >= threshold AND sources differ
// - Find connected components via DFS
// - Compute centroid as mean of normalized vectors for each cluster
// - Support incremental addition: addNewsToExistingClusters(enrichedHeadlines, clusters, opts)
// This file exports two functions for use by workers or other modules.

let __clusterCounter = 0;
function generateClusterId() {
  __clusterCounter += 1;
  return `cluster-${__clusterCounter}`;
}

// DB helper for filtering input keywords by target_query
const { dbAll } = require("../electron/db/index.cjs");

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

function cosineDistance(a, b) {
  return 1 - cosineSimilarity(a, b);
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

/* ---------------- DBSCAN algorithm ---------------- */
/**
 * DBSCAN clustering for embeddings
 * @param {Array} enrichedHeadlines - array of items with .vector
 * @param {number} eps - neighborhood radius (cosine distance, e.g., 0.3 = 0.7 similarity)
 * @param {number} minPts - minimum points to form a dense region (default: 2)
 * @returns {Array} clusters in same format as buildInitialClustersWithVectors
 */
function buildClustersWithDBSCAN(enrichedHeadlines, eps = 0.3, minPts = 2) {
  if (!Array.isArray(enrichedHeadlines) || enrichedHeadlines.length === 0)
    return [];

  // Deduplicate exact text+source
  const dedupMap = new Map();
  for (const h of enrichedHeadlines) {
    const source = h.source || h.publisher || "unknown";
    const text = (h.text || h.title || "").trim();
    const key = `${text}|||${source}`;
    if (!dedupMap.has(key)) dedupMap.set(key, { ...h, source, text });
  }
  const items = Array.from(dedupMap.values());
  const vectors = items.map((it) => it.vector).filter(Boolean);

  if (vectors.length === 0) return [];

  const n = vectors.length;
  const visited = new Array(n).fill(false);
  const clusterId = new Array(n).fill(-1); // -1 = noise
  let currentCluster = 0;

  function rangeQuery(pointIdx) {
    const neighbors = [];
    for (let i = 0; i < n; i++) {
      if (cosineDistance(vectors[pointIdx], vectors[i]) <= eps) {
        neighbors.push(i);
      }
    }
    return neighbors;
  }

  function expandCluster(pointIdx, neighbors) {
    clusterId[pointIdx] = currentCluster;
    const queue = [...neighbors];

    while (queue.length > 0) {
      const q = queue.shift();
      if (!visited[q]) {
        visited[q] = true;
        const qNeighbors = rangeQuery(q);
        if (qNeighbors.length >= minPts) {
          queue.push(...qNeighbors);
        }
      }
      if (clusterId[q] === -1) {
        clusterId[q] = currentCluster;
      }
    }
  }

  // Main DBSCAN loop
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const neighbors = rangeQuery(i);

    if (neighbors.length < minPts) {
      clusterId[i] = -1; // noise
    } else {
      expandCluster(i, neighbors);
      currentCluster++;
    }
  }

  // Group points by cluster
  const clusterMap = new Map();
  for (let i = 0; i < n; i++) {
    const cid = clusterId[i];
    if (cid === -1) continue; // ignore noise
    if (!clusterMap.has(cid)) clusterMap.set(cid, []);
    clusterMap.get(cid).push(items[i]);
  }

  // Convert to standard cluster format
  const clusters = [];
  for (const [cid, clusterItems] of clusterMap.entries()) {
    const cl = {
      id: generateClusterId(),
      items: clusterItems,
      created: new Date().toISOString(),
      published: false,
      category: clusterItems[0]?.category || null,
      subCategory: clusterItems[0]?.subCategory || null,
    };
    updateCentroid(cl);
    clusters.push(cl);
  }

  return clusters;
}

module.exports = {
  buildInitialClustersWithVectors,
  buildClustersWithDBSCAN,
  addNewsToExistingClusters,
  _helpers: {
    cosineSimilarity,
    cosineDistance,
    normalize,
    updateCentroid,
    generateClusterId,
  },
};

// Keep existing standalone behavior: if invoked directly, run the clustering flow
if (require.main === module) {
  (async () => {
    const fs = require("fs");
    const path = require("path");

    // Parse command line arguments
    const args = process.argv.slice(2);
    let inputFile,
      threshold = 0.5,
      algorithm = "components", // 'components' or 'dbscan'
      eps = 0.3,
      minPts = 2;

    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith("--inputFile=")) inputFile = args[i].split("=")[1];
      if (args[i].startsWith("--threshold="))
        threshold = parseFloat(args[i].split("=")[1]) || 0.5;
      if (args[i].startsWith("--algorithm=")) algorithm = args[i].split("=")[1];
      if (args[i].startsWith("--eps="))
        eps = parseFloat(args[i].split("=")[1]) || 0.3;
      if (args[i].startsWith("--minPts="))
        minPts = parseInt(args[i].split("=")[1], 10) || 2;
    }

    if (!inputFile) {
      console.error("Missing --inputFile");
      process.exit(1);
    }

    try {
      const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
      let keywords = input.keywords || [];
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
            const params = [
              /* projectId to be injected by caller or runtime */ null,
              ...ids,
            ];
            // Attempt to resolve projectId from args (simple heuristic)
            const args = process.argv.slice(2);
            let projectId = null;
            for (const a of args) {
              if (a.startsWith("--projectId="))
                projectId = Number(a.split("=")[1]);
            }
            if (projectId) {
              params[0] = projectId;
              const dbKeywords = await dbAll(
                `SELECT id, keyword FROM keywords WHERE project_id = ? AND id IN (${placeholders}) AND target_query = 1 ORDER BY id`,
                params
              );
              if (Array.isArray(dbKeywords) && dbKeywords.length > 0) {
                keywords = dbKeywords.map((k) => {
                  const orig = inputMap.get(Number(k.id)) || {};
                  return {
                    id: k.id,
                    keyword: k.keyword,
                    embedding: orig.embedding || orig.vector || null,
                    embeddingSource:
                      orig.embeddingSource || orig.source || null,
                  };
                });
              } else {
                keywords = keywords.filter(
                  (k) => k && (k.target_query === 1 || k.target_query === true)
                );
              }
            } else {
              // no projectId provided in args — fallback to input flag filtering
              keywords = keywords.filter(
                (k) => k && (k.target_query === 1 || k.target_query === true)
              );
            }
          } else {
            keywords = keywords.filter(
              (k) => k && (k.target_query === 1 || k.target_query === true)
            );
          }
          console.log(
            `[clustering worker] Filtered keywords by target_query: ${before} -> ${keywords.length}`
          );
        }
      } catch (e) {
        // ignore
      }
      const enriched = keywords.map((k, idx) => ({
        id: k.id,
        text: k.keyword || "",
        vector: k.embedding,
        source: `kw_${k.id || idx}`,
      }));

      console.log(`[clustering worker] Algorithm: ${algorithm}`);
      console.log(`[clustering worker] Total keywords: ${enriched.length}`);

      let clusters;
      if (algorithm === "dbscan") {
        console.log(
          `[clustering worker] Running DBSCAN with eps=${eps}, minPts=${minPts}`
        );
        clusters = buildClustersWithDBSCAN(enriched, eps, minPts);
      } else {
        console.log(
          `[clustering worker] Running connected components with threshold=${threshold}`
        );
        clusters = buildInitialClustersWithVectors(enriched, threshold);
      }

      console.log(`[clustering worker] Generated ${clusters.length} clusters`);
      // Emit compact per-item assignments only (no vectors in stdout)
      let clusterIdx = 1;
      for (const c of clusters) {
        const items = Array.isArray(c.items) ? c.items : [];
        for (const it of items) {
          if (!it || typeof it.id === "undefined" || it.id === null) continue;
          const line = { id: it.id, cluster: clusterIdx };
          process.stdout.write(JSON.stringify(line) + "\n");
        }
        clusterIdx++;
      }
    } catch (e) {
      console.error(e && e.message ? e.message : String(e));
      process.exit(1);
    }
  })().catch((e) => {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  });
}
