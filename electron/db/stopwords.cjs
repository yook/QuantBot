const { dbAll, dbRun, dbGet } = require("./adapter.cjs");

async function findByProject(projectId, options = {}) {
  try {
    const skip = options.skip || 0;
    const limit = options.limit || 300;
    const rows = await dbAll(
      `SELECT id, project_id, word, created_at FROM stop_words WHERE project_id = ? ORDER BY id LIMIT ? OFFSET ?`,
      [projectId, limit, skip]
    );
    const totalRes = await dbGet(
      `SELECT COUNT(*) as total FROM stop_words WHERE project_id = ?`,
      [projectId]
    );
    return { stopWords: rows, total: totalRes.total, skip, limit };
  } catch (err) {
    console.error("stopwords.findByProject error", err);
    return { stopWords: [], total: 0, skip: 0, limit: 0 };
  }
}

async function insertBatch(projectId, words, createdAt) {
  try {
    if (!Array.isArray(words) || words.length === 0)
      return { success: true, added: [] };
    const added = [];
    const stmtSql =
      "INSERT OR IGNORE INTO stop_words (project_id, word, created_at) VALUES (?, ?, ?)";
    for (const w of words) {
      const raw = typeof w === "string" ? w.trim() : w;
      if (!raw || raw.length === 0) continue;
      const lastSlash = typeof raw === "string" ? raw.lastIndexOf("/") : -1;
      const isRegex =
        typeof raw === "string" && raw.startsWith("/") && lastSlash > 0;
      const normalized = isRegex ? raw : raw.toLowerCase();
      const res = await dbRun(stmtSql, [
        projectId,
        normalized,
        createdAt || new Date().toISOString(),
      ]);
      if (res && res.changes && res.changes > 0) {
        added.push({ id: res.lastID, project_id: projectId, word: normalized });
      }
    }
    return { success: true, added };
  } catch (err) {
    console.error("stopwords.insertBatch error", err);
    return { success: false, error: String(err) };
  }
}

async function remove(projectId, word) {
  try {
    const isRegex =
      typeof word === "string" &&
      word.startsWith("/") &&
      word.lastIndexOf("/") > 0;
    let result;
    if (isRegex) {
      result = await dbRun(
        "DELETE FROM stop_words WHERE project_id = ? AND word = ?",
        [projectId, word]
      );
    } else {
      result = await dbRun(
        "DELETE FROM stop_words WHERE project_id = ? AND lower(word) = lower(?)",
        [projectId, word]
      );
    }
    const changes = result && result.changes ? result.changes : 0;
    return changes > 0;
  } catch (err) {
    console.error("stopwords.remove error", err);
    return false;
  }
}

async function clear(projectId) {
  try {
    await dbRun("DELETE FROM stop_words WHERE project_id = ?", [projectId]);
    return true;
  } catch (err) {
    console.error("stopwords.clear error", err);
    return false;
  }
}

module.exports = {
  findByProject,
  insertBatch,
  remove,
  clear,
};
