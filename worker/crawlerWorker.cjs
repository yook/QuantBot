#!/usr/bin/env node
/**
 * IPC-based crawler worker replacing previous Socket.IO server logic.
 * Reads config JSON (projectId, startUrl, crawlerConfig, parserConfig, dbPath), runs simplecrawler,
 * writes JSON lines to stdout: {type: progress|queue|finished|error|url, ...}
 */
const fs = require("fs");
const path = require("path");
const Crawler = require("simplecrawler");
const Database = require("better-sqlite3");
const cheerio = require("cheerio");

function logJson(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (_) {}
}

function parseArgs() {
  const args = process.argv.slice(2);
  const cfgArg = args.find((a) => a.startsWith("--config="));
  const cfgPath = cfgArg ? cfgArg.split("=")[1] : null;
  if (!cfgPath || !fs.existsSync(cfgPath)) {
    logJson({ type: "error", message: "Config file not found", cfgPath });
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    logJson({
      type: "error",
      message: "Failed to read config",
      error: e.message,
    });
    process.exit(1);
  }
}

const cfg = parseArgs();
const {
  projectId,
  startUrl,
  crawlerConfig = {},
  parserConfig = [],
  dbPath,
} = cfg;
if (!projectId || !startUrl || !dbPath) {
  logJson({
    type: "error",
    message: "Missing required config fields",
    projectId,
    startUrl,
    dbPath,
  });
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath);
} catch (e) {
  logJson({ type: "error", message: "DB open error", error: e.message });
  process.exit(1);
}

// Prepare insert statement (content truncated to avoid huge IPC payloads)
const insertStmt = db.prepare(`INSERT OR IGNORE INTO urls
  (project_id, type, url, referrer, depth, code, contentType, protocol, location, actualDataSize, requestTime, requestLatency, downloadTime, status, date, content)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

// Prepare insert statement for disallowed URLs
const insertDisallowedStmt = db.prepare(`INSERT OR IGNORE INTO disallowed
  (project_id, url, error_type, code, status, referrer, depth, protocol, error_message)
  VALUES (?,?,?,?,?,?,?,?,?)`);

// Load visited URLs to support resume (skip already processed)
let visited = new Set();
let initialFetched = 0;
try {
  // Count already processed
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM urls WHERE project_id = ?")
    .get(projectId);
  initialFetched = row && typeof row.cnt === "number" ? row.cnt : 0;
  // Fill visited set from urls table
  const iter = db
    .prepare("SELECT url FROM urls WHERE project_id = ?")
    .iterate(projectId);
  for (const r of iter) {
    if (r && r.url) visited.add(r.url);
  }
  // Also add disallowed URLs to visited set
  const disallowedIter = db
    .prepare("SELECT url FROM disallowed WHERE project_id = ?")
    .iterate(projectId);
  for (const r of disallowedIter) {
    if (r && r.url) visited.add(r.url);
  }
} catch (e) {
  logJson({ type: "error", stage: "loadVisited", message: e.message });
}

function extractDynamic(buffer, parserFields) {
  const out = {};
  if (!buffer || !parserFields || !parserFields.length) return out;
  try {
    const $ = cheerio.load(buffer.toString("utf8"));
    for (const f of parserFields) {
      if (!f || !f.selector || !f.find || !f.prop) continue;
      let val = "";
      try {
        switch (f.find) {
          case "text":
            val = $(f.selector)
              .map((i, el) => $(el).text().trim())
              .get()
              .join("; ");
            break;
          case "attr":
            val = $(f.selector)
              .map((i, el) => $(el).attr(f.attrClass))
              .get()
              .join("; ");
            break;
          case "hasClass":
            val = $(f.selector).hasClass(f.attrClass) + "";
            break;
          case "quantity":
            val = $(f.selector).length + "";
            break;
          default:
            val = "";
            break;
        }
        if (f.getLength) {
          val = String(val ? val.length : 0);
        }
      } catch (_) {}
      out[f.prop] = val;
    }
  } catch (_) {}
  return out;
}

const crawler = new Crawler(startUrl);
// Apply basic config
crawler.interval = crawlerConfig.interval || 250;
crawler.maxConcurrency = crawlerConfig.maxConcurrency || 4;
if (typeof crawlerConfig.maxDepth === "number")
  crawler.maxDepth = crawlerConfig.maxDepth;
crawler.timeout = crawlerConfig.timeout || 60000;
if (crawlerConfig.userAgent) crawler.userAgent = crawlerConfig.userAgent;
if (crawlerConfig.stripQuerystring) crawler.stripQuerystring = true;
if (crawlerConfig.sortQueryParameters) crawler.sortQueryParameters = true;
if (crawlerConfig.scanSubdomains) crawler.scanSubdomains = true;
if (crawlerConfig.respectRobotsTxt === false) crawler.respectRobotsTxt = false;

// fetchedSession counts only this run; total fetched = initialFetched + fetchedSession
let fetchedSession = 0;

// Real-time stats counters (session only, will add to DB stats on emit)
let statsSession = {
  html: 0,
  image: 0,
  jscss: 0,
  redirect: 0,
  error: 0,
  depth3: 0,
  depth5: 0,
  depth6: 0,
};

function withQueueLength(fn) {
  try {
    if (
      crawler &&
      crawler.queue &&
      typeof crawler.queue.getLength === "function"
    ) {
      // Some simplecrawler versions expect a callback arg
      if (crawler.queue.getLength.length >= 1) {
        return crawler.queue.getLength((err, len) => {
          if (err) return fn(0);
          fn(typeof len === "number" ? len : 0);
        });
      }
      // Others return a number directly
      const len = crawler.queue.getLength();
      return fn(typeof len === "number" ? len : 0);
    }
    // Fallbacks
    if (crawler && crawler.queue && typeof crawler.queue.length === "number") {
      return fn(crawler.queue.length);
    }
  } catch (_) {}
  fn(0);
}

function reportProgress() {
  withQueueLength((len) => {
    const qLen = typeof len === "number" ? len : 0;
    const pending = Math.max(qLen - fetchedSession, 0);
    logJson({
      type: "progress",
      fetched: initialFetched + fetchedSession,
      queue: pending,
    });
  });
}

crawler.on("fetchcomplete", (queueItem, responseBuffer, response) => {
  const dynamic = extractDynamic(responseBuffer, parserConfig);
  try {
    const info = insertStmt.run(
      projectId,
      response && /image/i.test(response.headers["content-type"] || "")
        ? "image"
        : "html",
      queueItem.url,
      queueItem.referrer || null,
      queueItem.depth || null,
      response ? response.statusCode : null,
      response ? response.headers["content-type"] : null,
      queueItem.protocol || null,
      (queueItem.stateData && queueItem.stateData.location) || null,
      (queueItem.stateData && queueItem.stateData.actualDataSize) || null,
      (queueItem.stateData && queueItem.stateData.requestTime) || null,
      (queueItem.stateData && queueItem.stateData.requestLatency) || null,
      (queueItem.stateData && queueItem.stateData.downloadTime) || null,
      response ? response.statusMessage : null,
      new Date().toISOString(),
      JSON.stringify(dynamic)
    );

    // Only increment counter if row was actually inserted (not duplicate)
    if (info && info.changes && info.changes > 0) {
      fetchedSession++;

      // Update session stats for real-time updates
      const contentType =
        response && response.headers ? response.headers["content-type"] : "";
      const code = response ? response.statusCode : 0;
      const depth = queueItem.depth || 0;

      // Type stats
      if (/image/i.test(contentType)) {
        statsSession.image++;
      } else if (/javascript|css/i.test(contentType)) {
        statsSession.jscss++;
      } else {
        statsSession.html++;
      }

      // Code stats
      if (code >= 300 && code < 400) {
        statsSession.redirect++;
      } else if (code >= 400) {
        statsSession.error++;
      }

      // Depth stats
      if (depth <= 3) {
        statsSession.depth3++;
      } else if (depth === 4 || depth === 5) {
        statsSession.depth5++;
      } else if (depth >= 6) {
        statsSession.depth6++;
      }

      // Emit updated stats every 10 fetches or immediately for first few
      if (fetchedSession <= 5 || fetchedSession % 10 === 0) {
        emitDbStats();
      }
    }

    // Mark URL as visited (for same-session skips)
    try {
      if (queueItem && queueItem.url) visited.add(queueItem.url);
    } catch (_) {}
    // Emit full inserted row so UI can update immediately
    try {
      const row = {
        id: info && info.lastInsertRowid ? info.lastInsertRowid : undefined,
        project_id: projectId,
        type:
          response && /image/i.test(response.headers["content-type"] || "")
            ? "image"
            : "html",
        url: queueItem.url,
        referrer: queueItem.referrer || null,
        depth: queueItem.depth || null,
        code: response ? response.statusCode : null,
        contentType: response ? response.headers["content-type"] : null,
        protocol: queueItem.protocol || null,
        location: (queueItem.stateData && queueItem.stateData.location) || null,
        actualDataSize:
          (queueItem.stateData && queueItem.stateData.actualDataSize) || null,
        requestTime:
          (queueItem.stateData && queueItem.stateData.requestTime) || null,
        requestLatency:
          (queueItem.stateData && queueItem.stateData.requestLatency) || null,
        downloadTime:
          (queueItem.stateData && queueItem.stateData.downloadTime) || null,
        status: response ? response.statusMessage : null,
        date: new Date().toISOString(),
        content: JSON.stringify(dynamic),
      };
      // Only emit row event if it was actually inserted
      if (info && info.changes && info.changes > 0) {
        logJson({ type: "row", row });
      }
    } catch (_) {}
  } catch (e) {
    logJson({ type: "error", stage: "insert", message: e.message });
  }
  reportProgress();
  logJson({ type: "url", url: queueItem.url });
});

crawler.on("queueadd", () => {
  withQueueLength((len) => {
    const qLen = typeof len === "number" ? len : 0;
    const pending = Math.max(qLen - fetchedSession, 0);
    logJson({
      type: "queue",
      queue: pending,
      fetched: initialFetched + fetchedSession,
    });
  });
});

crawler.on("fetcherror", (queueItem, resp) => {
  fetchedSession++;
  logJson({
    type: "error",
    message: "fetcherror",
    url: queueItem.url,
    status: resp && resp.statusCode,
  });
  reportProgress();
});

crawler.on("complete", () => {
  // total fetched should include previously stored rows + this session
  try {
    const totalFetched = initialFetched + fetchedSession;
    logJson({ type: "finished", fetched: totalFetched });
  } catch (_) {
    logJson({
      type: "finished",
      fetched: initialFetched || fetchedSession || 0,
    });
  }
  process.exit(0);
});

crawler.on("fetchtimeout", (queueItem, timeout) => {
  fetchedSession++;
  logJson({
    type: "error",
    message: "fetchtimeout",
    url: queueItem.url,
    timeout,
  });
  reportProgress();
});

crawler.on("fetch404", (queueItem, resp) => {
  fetchedSession++;
  logJson({
    type: "error",
    message: "404",
    url: queueItem.url,
    status: resp && resp.statusCode,
  });
  reportProgress();
});

// Some versions emit fetchclienterror for client-side issues
try {
  crawler.on("fetchclienterror", (queueItem, errorData) => {
    fetchedSession++;
    logJson({
      type: "error",
      message: "fetchclienterror",
      url: queueItem && queueItem.url,
      error: (errorData && errorData.message) || "",
    });
    reportProgress();
  });
} catch (_) {}

// Handle disallowed URLs (robots.txt)
let disallowedCount = 0;
try {
  crawler.on("fetchdisallowed", (queueItem) => {
    disallowedCount++;

    // Save to disallowed table
    try {
      const info = insertDisallowedStmt.run(
        projectId,
        queueItem.url || "",
        "fetchdisallowed",
        0, // code
        "disallowed", // status
        queueItem.referrer || null,
        queueItem.depth || 0,
        queueItem.protocol || null,
        "Blocked by robots.txt"
      );

      // Add to visited set to avoid re-crawling
      if (queueItem.url) {
        visited.add(queueItem.url);
      }

      // Emit row event if actual insertion occurred
      if (info.changes > 0) {
        logJson({
          type: "row",
          data: {
            url: queueItem.url,
            error_type: "fetchdisallowed",
            status: "disallowed",
            depth: queueItem.depth || 0,
            created_at: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      logJson({
        type: "error",
        message: "Failed to save disallowed URL",
        url: queueItem.url,
        error: err.message,
      });
    }

    logJson({
      type: "stat",
      stat: "disallow",
      value: disallowedCount,
      url: queueItem && queueItem.url,
    });
  });
} catch (_) {}

// Skip URLs that are already visited (resume behavior)
try {
  crawler.addFetchCondition(function (queueItem, referrer, cb) {
    const url = queueItem && queueItem.url;
    const allowed = url ? url === startUrl || !visited.has(url) : true;
    if (typeof cb === "function") return cb(null, allowed);
    return allowed;
  });
} catch (_) {}

// Prepare queue file path (db/<projectId>/queue)
const dbDir = path.dirname(dbPath);
const queueDir = path.join(dbDir, String(projectId));
const queueFile = path.join(queueDir, "queue");
try {
  fs.mkdirSync(queueDir, { recursive: true });
} catch (_) {}

// Calculate and emit statistics from DB
function emitDbStats() {
  try {
    // Count by content type
    const typeStats = db
      .prepare(
        `
      SELECT 
        SUM(CASE WHEN type = 'html' THEN 1 ELSE 0 END) as html,
        SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END) as image,
        SUM(CASE WHEN contentType LIKE '%javascript%' OR contentType LIKE '%css%' THEN 1 ELSE 0 END) as jscss
      FROM urls WHERE project_id = ?
    `
      )
      .get(projectId);

    // Count by status code ranges
    const codeStats = db
      .prepare(
        `
      SELECT
        SUM(CASE WHEN code >= 300 AND code < 400 THEN 1 ELSE 0 END) as redirect,
        SUM(CASE WHEN code >= 400 THEN 1 ELSE 0 END) as error
      FROM urls WHERE project_id = ?
    `
      )
      .get(projectId);

    // Count by depth
    const depthStats = db
      .prepare(
        `
      SELECT
        SUM(CASE WHEN depth <= 3 THEN 1 ELSE 0 END) as depth3,
        SUM(CASE WHEN depth = 4 OR depth = 5 THEN 1 ELSE 0 END) as depth5,
        SUM(CASE WHEN depth >= 6 THEN 1 ELSE 0 END) as depth6
      FROM urls WHERE project_id = ?
    `
      )
      .get(projectId);

    // Count disallowed URLs
    const disallowedStats = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM disallowed WHERE project_id = ?
    `
      )
      .get(projectId);

    // Emit all stats (DB + session counters)
    if (typeStats) {
      const html = (typeStats.html || 0) + statsSession.html;
      const image = (typeStats.image || 0) + statsSession.image;
      const jscss = (typeStats.jscss || 0) + statsSession.jscss;
      if (html) logJson({ type: "stat", stat: "html", value: html });
      if (image) logJson({ type: "stat", stat: "image", value: image });
      if (jscss) logJson({ type: "stat", stat: "jscss", value: jscss });
    }
    if (codeStats) {
      const redirect = (codeStats.redirect || 0) + statsSession.redirect;
      const error = (codeStats.error || 0) + statsSession.error;
      if (redirect)
        logJson({ type: "stat", stat: "redirect", value: redirect });
      if (error) logJson({ type: "stat", stat: "error", value: error });
    }
    if (depthStats) {
      const depth3 = (depthStats.depth3 || 0) + statsSession.depth3;
      const depth5 = (depthStats.depth5 || 0) + statsSession.depth5;
      const depth6 = (depthStats.depth6 || 0) + statsSession.depth6;
      if (depth3) logJson({ type: "stat", stat: "depth3", value: depth3 });
      if (depth5) logJson({ type: "stat", stat: "depth5", value: depth5 });
      if (depth6) logJson({ type: "stat", stat: "depth6", value: depth6 });
    }
    // Emit disallowed count from DB (no session counter needed as we count in real-time)
    if (disallowedStats && disallowedStats.count) {
      logJson({ type: "stat", stat: "disallow", value: disallowedStats.count });
    }
  } catch (e) {
    logJson({
      type: "error",
      stage: "emitDbStats",
      message: e && e.message ? e.message : String(e),
    });
  }
}

// Note: don't emit initial progress before defrost/seed to avoid flashing queue=0 in UI

// Start helper to ensure single start
let started = false;
function startCrawlerNow() {
  if (started) return;
  started = true;
  try {
    // Emit initial stats from DB
    emitDbStats();
    crawler.start();
    logJson({ type: "started", projectId, startUrl });
  } catch (e) {
    logJson({
      type: "error",
      message: "startFailed",
      error: e && e.message ? e.message : String(e),
    });
    process.exit(1);
  }
}

// ===== Restore queue from frozen file (defrost) or seed from a newline/JSON list =====
try {
  if (fs.existsSync(queueFile)) {
    crawler.queue.defrost(queueFile, (err) => {
      if (!err) {
        // After defrost, recalc progress and start
        reportProgress();
        logJson({ type: "queue", message: "defrosted-from-file" });
        startCrawlerNow();
        return;
      }
      // Fallback: read list of URLs and seed
      try {
        let raw = fs.readFileSync(queueFile, "utf8");
        let urls = [];
        raw = (raw || "").trim();
        if (raw) {
          // Try JSON first
          if (raw.startsWith("[") || raw.startsWith("{")) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                urls = parsed.filter((x) => typeof x === "string");
              } else if (parsed && Array.isArray(parsed.urls)) {
                urls = parsed.urls.filter((x) => typeof x === "string");
              }
            } catch (_) {
              // Fallback to newline-separated
            }
          }
          if (urls.length === 0) {
            urls = raw
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter((s) => !!s);
          }
        }

        const seeded = new Set();
        const startHost = (() => {
          try {
            return new URL(startUrl).host;
          } catch (_) {
            return null;
          }
        })();
        const sameHost = (u) => {
          if (!startHost) return true;
          try {
            return new URL(u).host === startHost;
          } catch (_) {
            return false;
          }
        };

        let added = 0;
        const MAX_SEED = 10000; // safety cap
        for (const u of urls) {
          if (!u || seeded.has(u)) continue;
          if (!sameHost(u)) continue;
          if (visited.has(u)) continue;
          try {
            crawler.queueURL(u);
            seeded.add(u);
            added++;
            if (added >= MAX_SEED) break;
          } catch (_) {}
        }
        if (added > 0) {
          logJson({
            type: "queue",
            message: "seeded-from-file",
            seeded: added,
          });
          reportProgress();
        }
      } catch (_e) {
        // ignore fallback failure
      }
      startCrawlerNow();
    });
  } else {
    startCrawlerNow();
  }
} catch (e) {
  logJson({
    type: "error",
    stage: "seedQueueFromFile",
    message: e && e.message ? e.message : String(e),
  });
}

// ===== Persist queue on shutdown (freeze) =====
let shuttingDown = false;
function saveQueueAndExit(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    crawler.queue.freeze(queueFile, (err) => {
      if (err) {
        logJson({
          type: "error",
          stage: "freezeQueue",
          message: err.message,
          signal,
        });
      } else {
        logJson({ type: "queue", message: "frozen-to-file", signal });
      }
      // give a brief moment for stdout flush
      setTimeout(() => process.exit(0), 50);
    });
  } catch (e) {
    logJson({
      type: "error",
      stage: "freezeQueue",
      message: e && e.message ? e.message : String(e),
      signal,
    });
    setTimeout(() => process.exit(0), 50);
  }
}

process.on("SIGTERM", () => saveQueueAndExit("SIGTERM"));
process.on("SIGINT", () => saveQueueAndExit("SIGINT"));
process.on("uncaughtException", (err) => {
  logJson({
    type: "error",
    stage: "uncaught",
    message: err && err.message ? err.message : String(err),
  });
  saveQueueAndExit("uncaughtException");
});

crawler.on("error", (err) => {
  logJson({ type: "error", message: (err && err.message) || String(err) });
});

try {
  crawler.start();
  logJson({ type: "started", projectId, startUrl });
} catch (e) {
  logJson({ type: "error", message: "startFailed", error: e.message });
  process.exit(1);
}
