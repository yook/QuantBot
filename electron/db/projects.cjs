const { dbRun, dbGet, dbAll } = require("./adapter.cjs");

function serializeProject(doc) {
  const out = {
    name: doc.name || "",
    url: doc.url || "",
    freezed: doc.freezed ? 1 : 0,
    crawler:
      typeof doc.crawler === "object"
        ? JSON.stringify(doc.crawler)
        : doc.crawler || null,
    parser: Array.isArray(doc.parser)
      ? JSON.stringify(doc.parser)
      : doc.parser || null,
    ui_columns: doc.columns
      ? JSON.stringify(doc.columns)
      : doc.ui_columns || null,
  };
  return out;
}

async function findAll() {
  const rows = await dbAll("SELECT * FROM projects ORDER BY id DESC");
  return rows;
}

async function findOneById(id) {
  const row = await dbGet("SELECT * FROM projects WHERE id = ? LIMIT 1", [id]);
  return row || null;
}

async function insert(doc) {
  const s = serializeProject(doc);
  const res = await dbRun(
    `INSERT INTO projects (name, url, freezed, crawler, parser, ui_columns) VALUES (?, ?, ?, ?, ?, ?)`,
    [s.name, s.url, s.freezed, s.crawler, s.parser, s.ui_columns]
  );
  const created = await findOneById(res.lastID);
  return created;
}

async function update(doc) {
  const id = doc.id;
  if (!id) throw new Error("id is required");
  const allowed = [
    "name",
    "url",
    "freezed",
    "crawler",
    "parser",
    "columns",
    "clustering_eps",
    "clustering_min_points",
    "clustering_method",
    "clustering_suggested_threshold",
    "clustering_diagnostics",
  ];
  const toUpdate = {};
  for (const k of allowed) {
    if (k in doc) {
      const dbKey = k === "columns" ? "ui_columns" : k;
      toUpdate[dbKey] = doc[k];
    }
  }
  if (Object.keys(toUpdate).length > 0) {
    const s = serializeProject(toUpdate);
    const setParts = Object.keys(s).map((k) => `${k} = ?`);
    const params = [...Object.values(s), id];
    await dbRun(
      `UPDATE projects SET ${setParts.join(
        ", "
      )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );
  }
  return await findOneById(id);
}

async function remove(id) {
  await dbRun("DELETE FROM projects WHERE id = ?", [id]);
}

module.exports = {
  findAll,
  findOneById,
  insert,
  update,
  remove,
};
