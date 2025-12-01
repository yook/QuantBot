const { dbAll, dbRun, dbGet } = require("./adapter.cjs");

async function findByProject(projectId, options = {}) {
  const skip = options.skip || 0;
  const limit = options.limit || 300;
  const rows = await dbAll(
    `SELECT * FROM keywords WHERE project_id = ? ORDER BY id LIMIT ? OFFSET ?`,
    [projectId, limit, skip]
  );
  const totalRes = await dbGet(
    `SELECT COUNT(*) as total FROM keywords WHERE project_id = ?`,
    [projectId]
  );
  return { data: rows, total: totalRes.total || 0, skip, limit };
}

async function insert(projectId, keyword) {
  const res = await dbRun(
    `INSERT OR IGNORE INTO keywords (project_id, keyword, created_at) VALUES (?, ?, ?)`,
    [projectId, keyword, new Date().toISOString()]
  );
  if (res && res.lastID)
    return await dbGet(`SELECT * FROM keywords WHERE id = ?`, [res.lastID]);
  return null;
}

async function remove(projectId, idOrKeyword) {
  if (typeof idOrKeyword === "number") {
    await dbRun(`DELETE FROM keywords WHERE id = ? AND project_id = ?`, [
      idOrKeyword,
      projectId,
    ]);
  } else {
    await dbRun(`DELETE FROM keywords WHERE keyword = ? AND project_id = ?`, [
      idOrKeyword,
      projectId,
    ]);
  }
}

/**
 * Apply stop-words for a project.
 * Optional second argument `onProgress` is a function called with { processed, total, percent }
 */
async function applyStopWords(projectId, onProgress) {
  // Read stop-words
  const stopRows = await dbAll(
    "SELECT word FROM stop_words WHERE project_id = ?",
    [projectId]
  );
  const words = stopRows.map((r) => r.word).filter(Boolean);
  if (words.length === 0) {
    // Reset all to target_query=1 and clear blocking_rule
    await dbRun(
      "UPDATE keywords SET target_query = 1, blocking_rule = NULL WHERE project_id = ?",
      [projectId]
    );
    if (typeof onProgress === "function")
      onProgress({ processed: 0, total: 0, percent: 100 });
    return { updated: 0, total: 0 };
  }

  // Build matchers
  const regexes = [];
  const plains = [];
  for (const w of words) {
    if (typeof w === "string" && w.startsWith("/") && w.lastIndexOf("/") > 0) {
      const lastSlash = w.lastIndexOf("/");
      const pattern = w.slice(1, lastSlash);
      const flags = w.slice(lastSlash + 1);
      try {
        regexes.push({ raw: w, re: new RegExp(pattern, flags) });
      } catch (_) {
        // ignore invalid regex
      }
    } else if (typeof w === "string") {
      plains.push(w.toLowerCase());
    }
  }

  // Load keywords
  const rows = await dbAll(
    "SELECT id, keyword FROM keywords WHERE project_id = ?",
    [projectId]
  );
  let updated = 0;
  const sqlBlock =
    "UPDATE keywords SET target_query = 0, blocking_rule = ? WHERE id = ?";
  const sqlAllow =
    "UPDATE keywords SET target_query = 1, blocking_rule = NULL WHERE id = ?";
  const total = rows.length;
  const progressInterval = Math.max(50, Math.floor(total / 100));
  let processed = 0;
  for (const k of rows) {
    const kw = (k.keyword || "").toString();
    let matchedRule = null;
    // regex first
    for (const r of regexes) {
      try {
        if (r.re.test(kw)) {
          matchedRule = r.raw;
          break;
        }
      } catch (_) {}
    }
    if (!matchedRule) {
      const lower = kw.toLowerCase();
      for (const p of plains) {
        if (p && lower.includes(p)) {
          matchedRule = p;
          break;
        }
      }
    }
    if (matchedRule) {
      await dbRun(sqlBlock, [matchedRule, k.id]);
      updated += 1;
    } else {
      await dbRun(sqlAllow, [k.id]);
    }
    processed += 1;
    if (
      typeof onProgress === "function" &&
      (processed % progressInterval === 0 || processed === total)
    ) {
      const percent = Math.round((processed / Math.max(1, total)) * 100);
      try {
        onProgress({ processed, total, percent });
      } catch (_) {}
    }
  }
  if (typeof onProgress === "function")
    try {
      onProgress({ processed: total, total, percent: 100 });
    } catch (_) {}
  return { updated, total };
}

module.exports = {
  findByProject,
  insert,
  remove,
  applyStopWords,
};
