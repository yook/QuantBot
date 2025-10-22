#!/usr/bin/env node
/*
  worker/assignCategorization.js

  CLI: node worker/assignCategorization.js --projectId=1

  - Reads categories and keywords for a project from socket/db-sqlite.js
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

  if (!Array.isArray(keywords) || keywords.length === 0) {
    console.error("No keywords to process");
    process.exit(0);
  }
  console.error(`Loaded ${keywords.length} keywords`);

  // Print header for results
  console.error(
    "Запрос | Самый релевантный заголовок | Коэффициент совпадения самого релевантного заголовка"
  );

  // Process all keywords (re-categorize even if already assigned)
  const toProcess = keywords;

  // Process all keywords
  if (toProcess.length > 0) {
    const batchSize = 100; // reasonable batch for embeddings
    const keywordBatches = await chunkArray(toProcess, batchSize);

    for (let bi = 0; bi < keywordBatches.length; bi++) {
      const batch = keywordBatches[bi];
      const texts = batch.map((k) => k.keyword || "");
      console.error(
        `Computing embeddings for keywords batch ${bi + 1}/${
          keywordBatches.length
        } (size=${texts.length})`
      );
      let embeddings;
      try {
        embeddings = await fetchEmbeddings(texts);
      } catch (e) {
        console.error(
          "Failed to fetch embeddings for batch, retrying after delay...",
          e.message || e
        );
        await new Promise((r) => setTimeout(r, 1500));
        embeddings = await fetchEmbeddings(texts);
      }

      for (let i = 0; i < batch.length; i++) {
        const kw = batch[i];
        const emb = embeddings[i];
        if (!emb) continue;
        // compute similarity to each category
        let bestIdx = -1;
        let bestScore = -Infinity;
        for (let j = 0; j < categoryEmbeddings.length; j++) {
          const catEmb = categoryEmbeddings[j];
          const sim = cosineSimilarity(emb, catEmb);
          if (sim > bestScore) {
            bestScore = sim;
            bestIdx = j;
          }
        }
        const bestCategory = categories[bestIdx];
        // Emit result as JSONL to stdout for the parent process to persist
        const result = {
          id: kw.id,
          keyword: kw.keyword || "",
          bestCategoryId: bestCategory?.id || null,
          bestCategoryName: bestCategory?.category_name || null,
          similarity: isFinite(bestScore) ? bestScore : null,
        };
        console.error(
          `assignCategorization result: ${kw.keyword} -> ${result.bestCategoryName} (sim: ${result.similarity})`
        );
        // Write JSON result line
        try {
          process.stdout.write(JSON.stringify(result) + "\n");
        } catch (e) {
          // ignore write errors
        }
      }
      // small delay to be polite
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.error("Assignment complete");
}

main().catch((err) => {
  console.error("Fatal error in assignCategorization:", err);
  process.exit(1);
});
