const { dbRun, dbAll, dbGet } = require("./adapter.cjs");

async function resolveCategoryNameColumn() {
  try {
    const rows = await dbAll("PRAGMA table_info('categories')");
    const names = (rows || []).map((r) => r && r.name);
    if (names.includes("name")) return "name";
    if (names.includes("category_name")) return "category_name";
  } catch (_) {}
  return "category_name";
}

async function categoriesInsertBatch(projectId, names) {
  const col = await resolveCategoryNameColumn();
  let inserted = 0;
  for (const n of names || []) {
    if (!n) continue;
    try {
      const res = await dbRun(
        `INSERT OR IGNORE INTO categories (${col}, project_id) VALUES (?, ?)`,
        [String(n), projectId]
      );
      if (res && res.changes > 0) inserted += 1;
    } catch (_) {}
  }
  return { inserted };
}

module.exports = {
  categoriesInsertBatch,
};
