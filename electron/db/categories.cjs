const { dbRun } = require("./adapter.cjs");

async function categoriesInsertBatch(projectId, names) {
  if (!projectId) return { inserted: 0 };
  if (!Array.isArray(names) || names.length === 0) return { inserted: 0 };
  const insert = dbRun.bind(
    null,
    "INSERT OR IGNORE INTO keywords (keyword, project_id, is_category, is_keyword, has_embedding) VALUES (?, ?, 1, 0, 0)"
  );
  let inserted = 0;
  for (const name of names) {
    if (!name) continue;
    const trimmed = typeof name === "string" ? name.trim() : String(name);
    const normalized = trimmed.toLowerCase();
    if (!normalized) continue;
    try {
      const result = await insert(normalized, projectId);
      if (result && result.changes > 0) inserted += 1;
    } catch (_) {}
  }
  return { inserted };
}

module.exports = {
  categoriesInsertBatch,
};
