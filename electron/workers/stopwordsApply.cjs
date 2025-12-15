#!/usr/bin/env node
// Worker: run applyStopWords(projectId) in a child process and emit progress JSON lines
// Usage: node worker/stopwordsApply.cjs --config=path/to/config.json
const fs = require("fs");
const path = require("path");

function log(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (_) {}
}

function parseArgs() {
  const args = process.argv.slice(2);
  const cfgArg = args.find((a) => a.startsWith("--config="));
  const cfgPath = cfgArg ? cfgArg.split("=")[1] : null;
  if (!cfgPath || !fs.existsSync(cfgPath)) {
    log({ type: "error", message: "Config file not found", cfgPath });
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
}

async function main() {
  const cfg = parseArgs();
  const { dbPath, projectId } = cfg;
  if (!projectId) {
    log({ type: "error", message: "Missing projectId" });
    process.exit(1);
  }

  // Resolve db facade. When running from packaged app the worker lives in
  // `process.resourcesPath/app.asar.unpacked/worker` while the DB facade is in
  // `.../app.asar.unpacked/electron/db/index.cjs`. Try a few candidates:
  // 1) relative to this worker file (`__dirname`) — works for dev and unpacked
  // 2) packaged resources path (`process.resourcesPath/app.asar.unpacked/...`)
  // 3) fallback to process.cwd() (legacy)
  try {
    const candidates = [];
    // 1) __dirname relative
    candidates.push(path.join(__dirname, "..", "electron", "db", "index.cjs"));
    // 2) resourcesPath when packaged
    if (process.resourcesPath) {
      candidates.push(
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "electron",
          "db",
          "index.cjs"
        )
      );
    }
    // 3) fallback to cwd
    candidates.push(path.join(process.cwd(), "electron", "db", "index.cjs"));

    let facadePath = null;
    for (const c of candidates) {
      try {
        if (c && fs.existsSync(c)) {
          facadePath = c;
          break;
        }
      } catch (_) {}
    }

    if (!facadePath) {
      // If none exist, still attempt the first candidate so require throws a useful error
      facadePath = candidates[0];
    }

    const dbFacade = require(facadePath);
    if (
      !dbFacade ||
      !dbFacade.keywords ||
      typeof dbFacade.keywords.applyStopWords !== "function"
    ) {
      log({ type: "error", message: "applyStopWords not found in db facade" });
      process.exit(1);
    }

    log({ type: "started-apply" });

    await dbFacade.keywords.applyStopWords(projectId, (progress) => {
      try {
        log(Object.assign({ type: "apply-progress" }, progress));
      } catch (_) {}
    });

    log({ type: "finished-apply" });
    process.exit(0);
  } catch (e) {
    log({ type: "error", message: String(e && e.message ? e.message : e) });
    process.exit(1);
  }
}

main().catch((e) => {
  log({ type: "error", message: String(e) });
  process.exit(1);
});
