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
const { embeddingsCacheGet, embeddingsCachePut, dbAll } = dbFacade;
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

async function fetchEmbeddings(texts) {
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
      // Resolve API key dynamically per project from DB
      const args = parseArgs();
      const projectId = args.projectId ? Number(args.projectId) : null;
      // Resolve API key: try machine-bound secret-store, then keytar, then exit with error.
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
        try {
          const keytar = require("keytar");
          key = await keytar.getPassword("site-analyzer", "openai");
        } catch (e) {}
      }
      if (!key) {
        console.error(
          "OpenAI API key not found in secret-store or system keychain (keytar). Please save the key under service 'site-analyzer' account 'openai'."
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
            stage: "embeddings",
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
          stage: "embeddings",
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
            "\nОшибка: неверный или недействительный OpenAI API ключ.\nКлюч должен храниться в системном хранилище (keytar) под service 'site-analyzer', account 'openai'.\nСсылка: https://platform.openai.com/account/api-keys\n"
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

async function main() {
  const args = parseArgs();
  const projectId = args.projectId ? Number(args.projectId) : null;
  if (!projectId) {
    console.error("Please provide --projectId=<id>");
    process.exit(1);
  }

  console.error(
    `Assigning keywords for project ${projectId} using model ${MODEL}`
  );

  // Support input via file or stdin. Expected shape: { categories: [...], keywords: [...] }
  let categories = [];
  let keywords = [];
  if (args.inputFile) {
    // stream-parse categories and keywords arrays separately to avoid large JSON.parse
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
      categories = await streamReadArray(args.inputFile, "categories");
      keywords = await streamReadArray(args.inputFile, "keywords");
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
  console.error(
    `assignCategorization: loaded ${categories.length} categories, ${keywords.length} keywords`
  );
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
      console.error(
        `[assignCategorization] Filtered keywords by target_query: ${before} -> ${keywords.length}`
      );
    }
  } catch (e) {
    // ignore
  }
  const categoryTexts = categories.map((c) => c.category_name || "");
  console.error(
    `Computing embeddings for ${categoryTexts.length} categories...`
  );
  const categoryEmbeddings = await fetchEmbeddings(categoryTexts);

  // simple n^2 compare
  const out = [];
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const kwText = kw.keyword || "";
    const kwEmb = kw.embedding || null;
    let bestSim = -1;
    let bestCat = null;
    for (let j = 0; j < categories.length; j++) {
      const cat = categories[j];
      const catEmb = categoryEmbeddings[j];
      if (!Array.isArray(kwEmb) || !Array.isArray(catEmb)) continue;
      const sim = cosineSimilarity(kwEmb, catEmb);
      if (sim > bestSim) {
        bestSim = sim;
        bestCat = cat;
      }
    }
    out.push({
      id: kw.id,
      bestCategoryId: bestCat ? bestCat.id : null,
      bestCategoryName: bestCat ? bestCat.category_name : null,
      similarity: bestSim,
      embeddingSource: kw.embeddingSource || "unknown",
    });
  }

  // Print JSONL results to stdout (one result per line)
  for (const r of out) process.stdout.write(JSON.stringify(r) + "\n");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  });
}
