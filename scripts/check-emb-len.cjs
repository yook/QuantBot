#!/usr/bin/env node
const { dbAll, embeddingsCacheGet } = require("../electron/db/index.cjs");

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

(async function () {
  const args = parseArgs(process.argv);
  const projectId = Number(args.projectId || args.project_id);
  if (!projectId) {
    console.error("Usage: node scripts/check-emb-len.cjs --projectId=ID");
    process.exit(2);
  }
  const rows = await dbAll(
    "SELECT id,label,text FROM typing_samples WHERE project_id = ? ORDER BY id",
    [projectId]
  );
  for (const r of rows) {
    const e = await embeddingsCacheGet(
      r.text,
      process.env.EMBEDDING_MODEL || null
    );
    const len = e && Array.isArray(e.embedding) ? e.embedding.length : null;
    console.log(`${r.id}\t${r.label}\t${len}`);
  }
})();
