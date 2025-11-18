const { dbAll, dbRun, dbGet } = require("./adapter.cjs");

async function findByProject(projectId, options = {}) {
  const skip = options.skip || 0;
  const limit = options.limit || 300;
  const rows = await dbAll(
    `SELECT * FROM typing_samples WHERE project_id = ? ORDER BY id LIMIT ? OFFSET ?`,
    [projectId, limit, skip]
  );
  const totalRes = await dbGet(
    `SELECT COUNT(*) as total FROM typing_samples WHERE project_id = ?`,
    [projectId]
  );
  return { data: rows, total: totalRes.total || 0, skip, limit };
}

async function insert(projectId, sample) {
  // sample: { label, text } or { url, sample }
  const createdAt = new Date().toISOString();
  const fields = [];
  const params = [];
  if (sample.label !== undefined) {
    fields.push("label");
    params.push(sample.label);
  }
  if (sample.text !== undefined) {
    fields.push("text");
    params.push(sample.text);
  }
  if (sample.url !== undefined) {
    fields.push("url");
    params.push(sample.url);
  }
  if (sample.sample !== undefined) {
    fields.push("sample");
    params.push(sample.sample);
  }
  fields.push("created_at");
  params.push(createdAt);
  const sql = `INSERT INTO typing_samples (project_id, ${fields.join(
    ","
  )}) VALUES (${["?"]
    .concat(fields.map(() => "?"))
    .join(",")
    .slice(2)})`;
  // Build params: projectId + fields params
  const execParams = [projectId].concat(params);
  const res = await dbRun(sql, execParams);
  if (res && res.lastID)
    return await dbGet("SELECT * FROM typing_samples WHERE id = ?", [
      res.lastID,
    ]);
  return null;
}

module.exports = {
  findByProject,
  insert,
};
