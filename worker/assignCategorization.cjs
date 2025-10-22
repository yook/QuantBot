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
  - Set OPENAI_API_KEY environment variable
  - axios is a dependency in the project

*/

const axios = require("axios");
const path = require("path");
// Import DB functions for caching
const {
  embeddingsCacheGet,
  embeddingsCachePut,
} = require("../socket/db-sqlite.cjs");
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
    const cached = await embeddingsCacheGet(text);
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
      // Only read key from OS keyring (keytar). If missing, exit with error.
      let key = null;
      try {
        const keytar = require("keytar");
        key = await keytar.getPassword("site-analyzer", "openai");
      } catch (e) {
        // keytar not available or error
      }
      if (!key) {
        console.error(
          "OPENAI API key not found in system keychain (keytar). Please save the key under service 'site-analyzer' account 'openai'."
        );
        process.exit(1);
      }

      const resp = await axios.post(
        OPENAI_EMBED_URL,
        { model: MODEL, input: toFetch },
        { headers: { Authorization: `Bearer ${key}` } }
      );
      if (resp.data && resp.data.data) {
        const fetchedEmbeddings = resp.data.data.map((d) => d.embedding);
        // Save to cache and assign to results
        for (let j = 0; j < fetchedEmbeddings.length; j++) {
          const embedding = fetchedEmbeddings[j];
          const text = toFetch[j];
          const index = toFetchIndices[j];
          results[index] = embedding;
          // Save to cache
          await embeddingsCachePut(text, embedding);
        }
      }
    } catch (err) {
      // Detect common auth / invalid key errors and print a clearer message
      const respData = err && err.response && err.response.data;
      console.error("OpenAI embeddings error:", respData || err.message || err);
      try {
        const code = respData && respData.error && respData.error.code;
        const status = err && err.response && err.response.status;
        if (code === "invalid_api_key" || status === 401) {
          console.error(
            "\nОшибка: неверный или недействительный OpenAI API ключ (OPENAI_API_KEY).\nПроверьте значение OPENAI_API_KEY в файле 'env' в корне проекта или экспортируйте переменную окружения перед запуском приложения.\nСсылка: https://platform.openai.com/account/api-keys\n"
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

  // Support input via file or stdin. Expected shape: { categories: [{id, category_name}], keywords: [{id, keyword}] }
  let input = null;
  if (args.inputFile) {
    const fs = require("fs");
    try {
      const txt = await fs.promises.readFile(args.inputFile, "utf8");
      input = JSON.parse(txt || "null");
    } catch (e) {
      console.error(
        "Failed to read inputFile:",
        e && e.message ? e.message : e
      );
      process.exit(1);
    }
  } else {
    input = await readStdin();
  }
  if (!input || !input.categories || !input.keywords) {
    console.error("Invalid input. Expected JSON with {categories, keywords}");
    process.exit(1);
  }
  const categories = input.categories;
  const keywords = input.keywords;
  console.error(
    `assignCategorization: loaded ${categories.length} categories, ${keywords.length} keywords`
  );
  const categoryTexts = categories.map((c) => c.category_name || "");
  console.error(
    `Computing embeddings for ${categoryTexts.length} categories...`
  );
  const categoryEmbeddings = await fetchEmbeddings(categoryTexts);

  // simple n^2 compare
  const fs = require("fs");
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
