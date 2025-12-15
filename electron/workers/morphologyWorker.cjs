const readline = require("readline");
const Morphy = require("phpmorphy");
const Database = require("better-sqlite3");

let projectId = null;
let dbPath = null;

// Инициализируем Morphy один раз
const morphy = new Morphy("ru", {
  storage: Morphy.STORAGE_MEM,
  predict_by_suffix: true,
  predict_by_db: true,
  graminfo_as_text: true,
  use_ancodes_cache: false,
  resolve_ancodes: Morphy.RESOLVE_ANCODES_AS_TEXT,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", async (line) => {
  try {
    const config = JSON.parse(line);
    projectId = config.projectId;
    dbPath = config.dbPath;
    rl.close();
    await processKeywords();
  } catch (err) {
    console.error("Config parse error:", err);
    process.exit(1);
  }
});

async function processKeywords() {
  try {
    const db = new Database(dbPath);
    try {
      db.pragma("journal_mode = WAL");
    } catch (_) {}

    // Кэш лемм для ускорения повторов по проекту
    const lemmaCache = new Map();

    // Получаем общее количество ключевых слов для прогресса
    const totalRow = db
      .prepare("SELECT COUNT(*) as count FROM keywords WHERE project_id = ?")
      .get(projectId);
    const totalCount = totalRow ? totalRow.count : 0;

    // Получаем количество уже обработанных (чтобы продолжить прогресс)
    const processedRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM keywords WHERE project_id = ? AND morphology_processed = 1"
      )
      .get(projectId);
    let globalProcessed = processedRow ? processedRow.count : 0;

    if (totalCount === 0) {
      process.stdout.write(JSON.stringify({ type: "complete" }) + "\n");
      db.close();
      process.exit(0);
      return;
    }

    while (true) {
      // Получаем пакет необработанных слов
      const keywords = db
        .prepare(
          "SELECT id, keyword FROM keywords WHERE project_id = ? AND morphology_processed = 0 ORDER BY id LIMIT 500"
        )
        .all(projectId);

      if (keywords.length === 0) {
        break;
      }

      const updateStmt = db.prepare(
        "UPDATE keywords SET lemma = ?, tags = ?, morphology_processed = 1 WHERE id = ?"
      );

      const transaction = db.transaction((batch) => {
        for (const row of batch) {
          try {
            const original = (row.keyword || "").trim();
            const keyword = original.toUpperCase();

            if (!keyword) {
              // Пустые слова помечаем как обработанные
              updateStmt.run("", "", row.id);
              globalProcessed++;
              continue;
            }

            // Формируем основную лемму фразы как последовательность основных лемм слов
            // Например: "куртку мужскую" -> ["куртка","мужской"] -> "куртка мужской"
            const rawWords = original
              .split(/\s+/)
              .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
              .filter((w) => w && w.length > 0);
            const lemmaParts = [];
            for (const w of rawWords) {
              const key = w.toLowerCase();
              let mainLemma = lemmaCache.get(key);
              if (!mainLemma) {
                try {
                  const form = morphy.lemmatize(
                    w.toUpperCase(),
                    Morphy.NORMAL
                  )?.[0];
                  mainLemma = form ? String(form).toLowerCase() : key;
                } catch (e) {
                  mainLemma = key;
                }
                if (lemmaCache) lemmaCache.set(key, mainLemma);
              }
              lemmaParts.push(mainLemma);
            }
            const lemma = lemmaParts.join(" ");

            // Извлекаем все уникальные леммы из фразы для тэгов (алфавитно)
            const tags = extractLemmas(original, lemmaCache);

            updateStmt.run(lemma, tags, row.id);
            globalProcessed++;
          } catch (err) {
            console.error(`Error processing keyword ${row.id}:`, err);
            // В случае ошибки всё равно помечаем как обработанное, чтобы не зацикливаться?
            // Или лучше пропускать? Если пропустить, оно снова выберется.
            // Лучше пометить как обработанное но с пустыми данными или флагом ошибки.
            // Пока просто помечаем processed=1
            updateStmt.run(keyword, "ERROR", row.id);
            globalProcessed++;
          }
        }
      });

      transaction(keywords);

      // Отправляем прогресс после каждого батча
      process.stdout.write(
        JSON.stringify({
          type: "progress",
          processed: globalProcessed,
          total: totalCount,
        }) + "\n"
      );
    }

    // Финальное сообщение
    process.stdout.write(
      JSON.stringify({
        type: "complete",
      }) + "\n"
    );

    db.close();
    process.exit(0);
  } catch (err) {
    console.error("Morphology processing error:", err);
    process.exit(1);
  }
}

function extractLemmas(keyword, cache) {
  // Разбиваем фразу на слова, нормализуем и фильтруем мусор
  const words = keyword
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((w) => w && w.length > 1);

  const lemmas = new Set();

  for (const word of words) {
    try {
      // Кэшируем основную лемму для слова
      const cached = cache && cache.get(word);
      if (cached) {
        lemmas.add(cached);
        continue;
      }
      const startForm = morphy.lemmatize(
        word.toUpperCase(),
        Morphy.NORMAL
      )?.[0];
      const mainLemma = startForm ? String(startForm).toLowerCase() : word;
      if (cache) cache.set(word, mainLemma);
      lemmas.add(mainLemma);
    } catch (err) {
      // В случае ошибки добавляем слово как есть
      lemmas.add(word);
    }
  }

  // Преобразуем в массив, сортируем по алфавиту и соединяем запятой
  return Array.from(lemmas).sort().join(", ");
}
