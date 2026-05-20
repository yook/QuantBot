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
const { extractDynamicFromBuffer } = require("./parserExtractor.cjs");
let JSDOM = null;
let WorkerThreads = null;
try {
  WorkerThreads = require("worker_threads");
} catch (_) {}
let chromiumModule = null;
let chromiumBrowser = null;
let chromiumQueue = Promise.resolve();
let chromiumInFlight = 0;

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

function classifyResourceType(contentType, url) {
  const ct = String(contentType || "").toLowerCase();
  let pathname = "";
  try {
    pathname = new URL(String(url || "")).pathname.toLowerCase();
  } catch (_) {
    pathname = String(url || "").toLowerCase();
  }

  const hasExt = (re) => re.test(pathname);

  if (
    /image\//.test(ct) ||
    hasExt(/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/)
  ) {
    return "image";
  }
  if (
    /(text\/xml|application\/xml|application\/rss\+xml|application\/atom\+xml|application\/sitemap\+xml|\+xml\b)/.test(
      ct,
    ) ||
    hasExt(/\.(xml|rss|atom)$/)
  ) {
    return "xml";
  }
  if (/(javascript|ecmascript)/.test(ct) || hasExt(/\.(mjs|cjs|js)$/)) {
    return "script";
  }
  if (/text\/css/.test(ct) || hasExt(/\.css$/)) {
    return "style";
  }
  if (
    /(font\/|application\/font|application\/vnd\.ms-fontobject)/.test(ct) ||
    hasExt(/\.(woff2?|ttf|otf|eot)$/)
  ) {
    return "font";
  }
  if (
    /(application\/(ld\+)?json|application\/manifest\+json|text\/json)/.test(
      ct,
    ) ||
    hasExt(/\.json$/)
  ) {
    return "json";
  }
  if (
    /audio\//.test(ct) ||
    /video\//.test(ct) ||
    hasExt(/\.(mp3|wav|ogg|m4a|aac|mp4|webm|mov|avi|mkv)$/)
  ) {
    return "media";
  }
  if (
    /(application\/(zip|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed))/.test(
      ct,
    ) ||
    hasExt(/\.(zip|gz|tar|tgz|7z|rar)$/)
  ) {
    return "archive";
  }
  if (/application\/octet-stream/.test(ct)) {
    return "binary";
  }
  if (
    /(text\/html|application\/xhtml\+xml)/.test(ct) ||
    hasExt(/\.(html?|xhtml)$/)
  ) {
    return "html";
  }
  if (
    /(text\/plain|text\/csv|application\/pdf|msword|vnd\.openxmlformats-officedocument)/.test(
      ct,
    ) ||
    hasExt(/\.(txt|csv|pdf|docx?|xlsx?|pptx?)$/)
  ) {
    return "document";
  }
  return "other";
}

const cfg = parseArgs();
const {
  projectId,
  startUrl,
  crawlerConfig = {},
  parserConfig = [],
  dbPath,
} = cfg;

function isFreePlanWorker() {
  const raw = String(process.env.APP_PLAN || process.env.VITE_APP_PLAN || "")
    .trim()
    .toLowerCase();
  return raw !== "pro";
}

const FREE_LIMITS = {
  urlsPerProject: 1000,
  crawlerConcurrency: 1,
  minCrawlerIntervalMs: 1000,
};

if (isFreePlanWorker()) {
  const nConcurrency = Number(crawlerConfig.maxConcurrency);
  crawlerConfig.maxConcurrency =
    Number.isFinite(nConcurrency) && nConcurrency >= 1
      ? Math.min(1, Math.floor(nConcurrency))
      : FREE_LIMITS.crawlerConcurrency;

  const nInterval = Number(crawlerConfig.interval);
  crawlerConfig.interval =
    Number.isFinite(nInterval) && nInterval >= FREE_LIMITS.minCrawlerIntervalMs
      ? Math.floor(nInterval)
      : FREE_LIMITS.minCrawlerIntervalMs;

  const nMaxUrls = Number(crawlerConfig.maxUrls);
  crawlerConfig.maxUrls =
    Number.isFinite(nMaxUrls) &&
    nMaxUrls > 0 &&
    nMaxUrls <= FREE_LIMITS.urlsPerProject
      ? Math.floor(nMaxUrls)
      : FREE_LIMITS.urlsPerProject;

  crawlerConfig.renderEnabled = false;
}

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
  (project_id, source, type, url, referrer, depth, code, contentType, protocol, location, actualDataSize, requestTime, requestLatency, downloadTime, status, date, content)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

// Prepare statements for current snapshot + history
const selectCurrentStmt = db.prepare(
  `SELECT * FROM urls_current WHERE project_id = ? AND url = ? LIMIT 1`,
);
const insertHistoryStmt = db.prepare(
  `INSERT INTO url_param_history (project_id, url, param_key, prev_value, new_value, changed_at, run_id)
   VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)`,
);
const upsertCurrentStmt = db.prepare(
  `INSERT INTO urls_current
    (project_id, url, last_run_id, last_changed_at, changed_any, changed_fields,
     type, referrer, depth, code, contentType, protocol, location, actualDataSize,
     requestTime, requestLatency, downloadTime, status, date, content, created_at, updated_at)
   VALUES
    (?, ?, ?, ?, ?, ?,
     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
   ON CONFLICT(project_id, url) DO UPDATE SET
     last_run_id = excluded.last_run_id,
     last_changed_at = excluded.last_changed_at,
     changed_any = excluded.changed_any,
     changed_fields = excluded.changed_fields,
     type = excluded.type,
     referrer = excluded.referrer,
     depth = excluded.depth,
     code = excluded.code,
     contentType = excluded.contentType,
     protocol = excluded.protocol,
     location = excluded.location,
     actualDataSize = excluded.actualDataSize,
     requestTime = excluded.requestTime,
     requestLatency = excluded.requestLatency,
     downloadTime = excluded.downloadTime,
     status = excluded.status,
     date = excluded.date,
     content = excluded.content,
     updated_at = CURRENT_TIMESTAMP`,
);

// Prepare insert statement for disallowed URLs
const insertDisallowedStmt = db.prepare(`INSERT OR IGNORE INTO disallowed
  (project_id, url, error_type, code, status, referrer, depth, protocol, error_message)
  VALUES (?,?,?,?,?,?,?,?,?)`);

// Load visited URLs to support resume (skip already processed)
let visited = new Set();
let initialFetched = 0;
let initialDisallowedCount = 0;
try {
  // Count already processed
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM urls WHERE project_id = ? AND COALESCE(source, 'crawler') = 'crawler'")
    .get(projectId);
  initialFetched = row && typeof row.cnt === "number" ? row.cnt : 0;
  // Count already disallowed
  const disallowedRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM disallowed WHERE project_id = ?")
    .get(projectId);
  initialDisallowedCount =
    disallowedRow && typeof disallowedRow.cnt === "number"
      ? disallowedRow.cnt
      : 0;
  // Fill visited set from urls table
  const iter = db
    .prepare("SELECT url FROM urls WHERE project_id = ? AND COALESCE(source, 'crawler') = 'crawler'")
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
  return extractDynamicFromBuffer(buffer, parserFields);
}

// ===== Optional parser worker (offload cheerio parsing) =====
let parserWorker = null;
let parserWorkerReady = false;
let parserReqId = 0;
const parserPending = new Map();
const PARSER_TIMEOUT_MS = 2000;

function resolveAllParserPending() {
  try {
    for (const [id, resolver] of parserPending.entries()) {
      try {
        resolver({});
      } catch (_) {}
      parserPending.delete(id);
    }
  } catch (_) {}
}

function initParserWorker() {
  if (!WorkerThreads || !WorkerThreads.Worker) return;
  try {
    const workerPath = path.join(__dirname, "parserWorker.cjs");
    parserWorker = new WorkerThreads.Worker(workerPath);
    parserWorkerReady = true;
    parserWorker.on("message", (msg) => {
      const id = msg && msg.id;
      const resolver = parserPending.get(id);
      if (resolver) {
        parserPending.delete(id);
        resolver(msg && msg.ok ? msg.result || {} : {});
      }
    });
    parserWorker.on("error", () => {
      parserWorkerReady = false;
      resolveAllParserPending();
    });
    parserWorker.on("exit", () => {
      parserWorkerReady = false;
      resolveAllParserPending();
    });
  } catch (_) {
    parserWorker = null;
    parserWorkerReady = false;
    resolveAllParserPending();
  }
}

function parseDynamicAsync(buffer, parserFields) {
  if (!buffer || !parserFields || !parserFields.length) {
    return Promise.resolve({});
  }
  if (!parserWorkerReady || !parserWorker) {
    return Promise.resolve(extractDynamic(buffer, parserFields));
  }
  return new Promise((resolve) => {
    const id = ++parserReqId;
    const timeoutId = setTimeout(() => {
      parserPending.delete(id);
      resolve({});
    }, PARSER_TIMEOUT_MS);
    parserPending.set(id, (result) => {
      clearTimeout(timeoutId);
      resolve(result);
    });
    try {
      parserWorker.postMessage({ id, buffer, parserFields });
    } catch (_) {
      parserPending.delete(id);
      resolve(extractDynamic(buffer, parserFields));
    }
  });
}

function getJsdom() {
  if (JSDOM) return JSDOM;
  try {
    ({ JSDOM } = require("jsdom"));
  } catch (_) {
    JSDOM = null;
  }
  return JSDOM;
}

function getChromium() {
  if (chromiumModule) return chromiumModule;
  try {
    chromiumModule = require("playwright-chromium");
  } catch (_) {
    chromiumModule = null;
  }
  return chromiumModule;
}

function getRenderMaxConcurrency() {
  const max =
    crawlerConfig && typeof crawlerConfig.renderMaxConcurrency === "number"
      ? crawlerConfig.renderMaxConcurrency
      : 1;
  return Math.max(1, Math.min(4, max));
}

function withChromiumLock(fn) {
  const run = chromiumQueue.then(async () => {
    const max = getRenderMaxConcurrency();
    if (chromiumInFlight >= max) {
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          if (chromiumInFlight < max) {
            clearInterval(timer);
            resolve();
          }
        }, 25);
      });
    }
    chromiumInFlight++;
    try {
      return await fn();
    } finally {
      chromiumInFlight--;
    }
  }, fn);
  chromiumQueue = run.catch(() => {});
  return run;
}

async function ensureChromiumBrowser() {
  if (chromiumBrowser) return chromiumBrowser;
  const mod = getChromium();
  if (!mod || !mod.chromium) {
    logJson({
      type: "render",
      mode: "chromium",
      level: "warn",
      message: "playwright-chromium module is unavailable",
    });
    return null;
  }
  try {
    chromiumBrowser = await mod.chromium.launch({ headless: true });
  } catch (e) {
    logJson({
      type: "render",
      mode: "chromium",
      level: "error",
      message: e && e.message ? e.message : "chromium-launch-failed",
    });
    chromiumBrowser = null;
  }
  return chromiumBrowser;
}

async function shutdownChromium() {
  try {
    if (chromiumBrowser) {
      await chromiumBrowser.close();
    }
  } catch (_) {}
  chromiumBrowser = null;
}

function normalizeRenderTimeout(timeoutMs) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return 30000;
  return Math.max(500, Math.min(120000, Math.round(n)));
}

async function renderChromiumHtml(url, timeoutMs, userAgent) {
  if (!url) return null;
  const safeTimeout = normalizeRenderTimeout(timeoutMs);
  return withChromiumLock(async () => {
    const browser = await ensureChromiumBrowser();
    if (!browser) return null;
    let page;
    try {
      page = await browser.newPage(userAgent ? { userAgent } : undefined);
      await Promise.race([
        page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: safeTimeout,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`render-timeout:${safeTimeout}`)),
            safeTimeout + 500,
          ),
        ),
      ]);
      const html = await page.content();
      try {
        await page.close();
      } catch (_) {}
      return html;
    } catch (e) {
      try {
        logJson({
          type: "render",
          mode: "chromium",
          level: "warn",
          url,
          message: e && e.message ? e.message : "render-failed",
        });
      } catch (_) {}
      try {
        if (page) await page.close();
      } catch (_) {}
      return null;
    }
  });
}

async function renderLightweightHtml(htmlBuffer, baseUrl, timeoutMs) {
  const JSDOMImpl = getJsdom();
  if (!JSDOMImpl) return null;
  const safeTimeout = normalizeRenderTimeout(timeoutMs);
  try {
    const html =
      typeof htmlBuffer === "string"
        ? htmlBuffer
        : Buffer.from(htmlBuffer).toString("utf-8");
    const dom = new JSDOMImpl(html, {
      url: baseUrl || undefined,
      runScripts: "dangerously",
    });
    const waitForLoad = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve("timeout"), safeTimeout);
      dom.window.addEventListener("load", () => {
        clearTimeout(timeout);
        resolve("load");
      });
    });
    await waitForLoad;
    const rendered = dom.serialize();
    try {
      dom.window.close();
    } catch (_) {}
    return rendered;
  } catch (_) {
    return null;
  }
}

function hasUsefulDynamic(dynamic) {
  if (!dynamic || typeof dynamic !== "object") return false;
  for (const key of Object.keys(dynamic)) {
    const val = dynamic[key];
    if (val == null) continue;
    if (typeof val === "string" && val.trim() !== "") return true;
    if (typeof val === "number" && !Number.isNaN(val)) return true;
    if (Array.isArray(val) && val.length > 0) return true;
    if (typeof val === "object" && Object.keys(val).length > 0) return true;
  }
  return false;
}

// Start parser worker only when we actually need to parse fields
if (Array.isArray(parserConfig) && parserConfig.length) {
  initParserWorker();
}

function shutdownParserWorker() {
  try {
    if (parserWorker) {
      parserWorker.terminate();
    }
  } catch (_) {}
}

function normalizeValue(v) {
  if (typeof v === "undefined") return null;
  if (v === null) return null;
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch (_) {
      return String(v);
    }
  }
  return String(v);
}

function parseContent(content) {
  if (!content) return {};
  if (typeof content === "object") return content;
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return {};
}

function flattenRowForHistory(row) {
  const base = {
    type: row.type || null,
    referrer: row.referrer || null,
    depth: row.depth || null,
    code: row.code || null,
    contentType: row.contentType || null,
    protocol: row.protocol || null,
    location: row.location || null,
    actualDataSize: row.actualDataSize || null,
    requestTime: row.requestTime || null,
    requestLatency: row.requestLatency || null,
    downloadTime: row.downloadTime || null,
    status: row.status || null,
    date: row.date || null,
    content: row.content || null,
  };
  const contentObj = parseContent(row.content);
  const flat = { ...base };
  if (contentObj && typeof contentObj === "object") {
    for (const k of Object.keys(contentObj)) {
      flat[`content.${k}`] = contentObj[k];
    }
  }
  return flat;
}

function updateCurrentAndHistory(projectId, url, row) {
  let prev = null;
  try {
    prev = selectCurrentStmt.get(projectId, url);
  } catch (_) {}

  // For first-time insert, avoid writing massive history; just store current snapshot.
  const isFirst = !prev;
  const currFlat = flattenRowForHistory(row);
  const prevFlat = prev ? flattenRowForHistory(prev) : {};

  const changedKeys = [];
  if (!isFirst) {
    const keys = new Set([...Object.keys(currFlat), ...Object.keys(prevFlat)]);
    for (const key of keys) {
      const prevVal = normalizeValue(prevFlat[key]);
      const currVal = normalizeValue(currFlat[key]);
      if (prevVal !== currVal) {
        changedKeys.push(key);
        try {
          insertHistoryStmt.run(projectId, url, key, prevVal, currVal);
        } catch (_) {}
      }
    }
  }

  const changedAny = changedKeys.length > 0 ? 1 : 0;
  const changedFields =
    changedKeys.length > 0 ? JSON.stringify(changedKeys) : null;
  const lastChangedAt = changedAny
    ? new Date().toISOString()
    : (prev && prev.last_changed_at) || null;

  try {
    upsertCurrentStmt.run(
      projectId,
      url,
      null,
      lastChangedAt,
      changedAny,
      changedFields,
      row.type || null,
      row.referrer || null,
      row.depth || null,
      row.code || null,
      row.contentType || null,
      row.protocol || null,
      row.location || null,
      row.actualDataSize || null,
      row.requestTime || null,
      row.requestLatency || null,
      row.downloadTime || null,
      row.status || null,
      row.date || null,
      row.content || null,
    );
  } catch (_) {}
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
const maxUrlsLimit =
  typeof crawlerConfig.maxUrls === "number" && crawlerConfig.maxUrls > 0
    ? Math.floor(crawlerConfig.maxUrls)
    : 0;

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

let lastStatsEmitAt = 0;
function emitDbStatsThrottled(force = false) {
  const now = Date.now();
  if (!force && now - lastStatsEmitAt < 500) return;
  lastStatsEmitAt = now;
  emitDbStats();
}

let lastQueueCount = 0;
let lastQueueCountAt = 0;
let stopping = false;
let pendingFetchHandlers = 0;
let completeRequested = false;
let stopByMaxUrls = false;

function hasReachedMaxUrls() {
  if (!maxUrlsLimit) return false;
  return initialFetched + fetchedSession >= maxUrlsLimit;
}

function stopCrawlerByMaxUrls() {
  if (!hasReachedMaxUrls() || stopByMaxUrls) return;
  stopByMaxUrls = true;
  stopping = true;
  completeRequested = true;
  try {
    logJson({
      type: "limit_reached",
      reason: "maxUrls",
      limit: maxUrlsLimit,
      fetched: initialFetched + fetchedSession,
      message:
        "В бесплатной версии доступно до 1 000 URL на проект. В Pro-версии нет ограничений по количеству URL.",
    });
  } catch (_) {}
  try {
    logJson({
      type: "queue",
      queue: 0,
      fetched: initialFetched + fetchedSession,
      message: "max-urls-reached",
    });
  } catch (_) {}
  try {
    if (crawler && typeof crawler.stop === "function") crawler.stop();
  } catch (_) {}
  maybeFinishCrawler();
}

function maybeFinishCrawler() {
  if (!completeRequested) return;
  if (pendingFetchHandlers > 0) return;
  try {
    const totalFetched = initialFetched + fetchedSession;
    logJson({ type: "progress", fetched: totalFetched, queue: 0 });
    logJson({ type: "finished", fetched: totalFetched });
  } catch (_) {
    logJson({
      type: "finished",
      fetched: initialFetched || fetchedSession || 0,
    });
  }
  shutdownParserWorker();
  shutdownChromium();
  process.exit(0);
}

function withQueueLength(fn) {
  try {
    const now = Date.now();
    if (lastQueueCountAt && now - lastQueueCountAt < 500) {
      return fn(lastQueueCount);
    }
    if (
      crawler &&
      crawler.queue &&
      typeof crawler.queue.countItems === "function"
    ) {
      return crawler.queue.countItems({ fetched: false }, (err, len) => {
        const count = err ? 0 : typeof len === "number" ? len : 0;
        lastQueueCount = count;
        lastQueueCountAt = Date.now();
        return fn(count);
      });
    }
    if (
      crawler &&
      crawler.queue &&
      typeof crawler.queue.getLength === "function"
    ) {
      // Some simplecrawler versions expect a callback arg
      if (crawler.queue.getLength.length >= 1) {
        return crawler.queue.getLength((err, len) => {
          const count = err ? 0 : typeof len === "number" ? len : 0;
          lastQueueCount = count;
          lastQueueCountAt = Date.now();
          return fn(count);
        });
      }
      // Others return a number directly
      const len = crawler.queue.getLength();
      const count = typeof len === "number" ? len : 0;
      lastQueueCount = count;
      lastQueueCountAt = Date.now();
      return fn(count);
    }
    // Fallbacks
    if (crawler && crawler.queue && typeof crawler.queue.length === "number") {
      const count = crawler.queue.length;
      lastQueueCount = count;
      lastQueueCountAt = Date.now();
      return fn(count);
    }
  } catch (_) {}
  fn(0);
}

function reportProgress() {
  if (stopping) return;
  withQueueLength((len) => {
    const qLen = typeof len === "number" ? len : 0;
    const pending = Math.max(qLen, 0);
    logJson({
      type: "progress",
      fetched: initialFetched + fetchedSession,
      queue: pending,
    });
  });
}

crawler.on("fetchcomplete", async (queueItem, responseBuffer, response) => {
  if (stopping) return;
  pendingFetchHandlers++;
  const contentTypeHeader =
    response && response.headers ? response.headers["content-type"] || "" : "";
  const isHtml =
    typeof contentTypeHeader === "string" &&
    (contentTypeHeader.includes("text/html") ||
      contentTypeHeader.includes("application/xhtml+xml"));
  const isNot404 = !(response && Number(response.statusCode) === 404);
  let dynamic = {};
  const shouldParse =
    isHtml && isNot404 && Array.isArray(parserConfig) && parserConfig.length;
  if (shouldParse) {
    const renderEnabled = !!(crawlerConfig && crawlerConfig.renderEnabled);
    const renderMode =
      (crawlerConfig && crawlerConfig.renderMode) || "lightweight";
    const renderTimeoutMs = normalizeRenderTimeout(
      crawlerConfig && crawlerConfig.renderTimeoutMs,
    );
    let bufferForParse = responseBuffer;
    if (renderEnabled && renderMode === "lightweight") {
      const rendered = await renderLightweightHtml(
        responseBuffer,
        queueItem && queueItem.url,
        renderTimeoutMs,
      );
      if (rendered) {
        bufferForParse = Buffer.from(rendered, "utf-8");
      }
      dynamic = await parseDynamicAsync(bufferForParse, parserConfig);
    } else if (renderEnabled && renderMode === "chromium") {
      const rendered = await renderChromiumHtml(
        queueItem && queueItem.url,
        renderTimeoutMs,
        crawlerConfig && crawlerConfig.userAgent,
      );
      if (rendered) {
        bufferForParse = Buffer.from(rendered, "utf-8");
      }
      dynamic = await parseDynamicAsync(bufferForParse, parserConfig);
    } else if (renderEnabled && renderMode === "hybrid") {
      const rendered = await renderLightweightHtml(
        responseBuffer,
        queueItem && queueItem.url,
        renderTimeoutMs,
      );
      if (rendered) {
        bufferForParse = Buffer.from(rendered, "utf-8");
      }
      dynamic = await parseDynamicAsync(bufferForParse, parserConfig);
      if (!hasUsefulDynamic(dynamic)) {
        const renderedChromium = await renderChromiumHtml(
          queueItem && queueItem.url,
          renderTimeoutMs,
          crawlerConfig && crawlerConfig.userAgent,
        );
        if (renderedChromium) {
          bufferForParse = Buffer.from(renderedChromium, "utf-8");
          dynamic = await parseDynamicAsync(bufferForParse, parserConfig);
        }
      }
    } else {
      dynamic = await parseDynamicAsync(bufferForParse, parserConfig);
    }
  }
  if (stopping) {
    pendingFetchHandlers = Math.max(0, pendingFetchHandlers - 1);
    return;
  }
  try {
    const detectedType = classifyResourceType(
      response && response.headers ? response.headers["content-type"] : "",
      queueItem && queueItem.url,
    );
    const info = insertStmt.run(
      projectId,
      "crawler",
      detectedType,
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
      JSON.stringify(dynamic),
    );

    // Only increment counter if row was actually inserted (not duplicate)
    if (info && info.changes && info.changes > 0) {
      fetchedSession++;

      // Update session stats for real-time updates
      const contentType = contentTypeHeader || "";
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

      // Emit stats with throttling to keep UI responsive without overloading
      emitDbStatsThrottled();
      stopCrawlerByMaxUrls();
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
        type: detectedType,
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
        try {
          if (Array.isArray(parserConfig) && parserConfig.length) {
            updateCurrentAndHistory(projectId, row.url, row);
          }
        } catch (_) {}
      }
    } catch (_) {}
  } catch (e) {
    logJson({ type: "error", stage: "insert", message: e.message });
  }
  try {
    reportProgress();
    logJson({ type: "url", url: queueItem.url });
  } finally {
    pendingFetchHandlers = Math.max(0, pendingFetchHandlers - 1);
    maybeFinishCrawler();
  }
});

crawler.on("queueadd", () => {
  if (stopping) return;
  withQueueLength((len) => {
    const qLen = typeof len === "number" ? len : 0;
    const pending = Math.max(qLen, 0);
    logJson({
      type: "queue",
      queue: pending,
      fetched: initialFetched + fetchedSession,
    });
  });
});

crawler.on("fetcherror", (queueItem, resp) => {
  if (stopping) return;
  fetchedSession++;
  try {
    // Try to persist error as a URL row so UI can show failed pages
    const info = insertStmt.run(
      projectId,
      "crawler",
      "html", // treat as html/error row
      queueItem.url,
      queueItem.referrer || null,
      queueItem.depth || null,
      resp && resp.statusCode ? resp.statusCode : null,
      resp && resp.headers ? resp.headers["content-type"] : null,
      queueItem.protocol || null,
      (queueItem.stateData && queueItem.stateData.location) || null,
      (queueItem.stateData && queueItem.stateData.actualDataSize) || null,
      (queueItem.stateData && queueItem.stateData.requestTime) || null,
      (queueItem.stateData && queueItem.stateData.requestLatency) || null,
      (queueItem.stateData && queueItem.stateData.downloadTime) || null,
      resp && resp.statusMessage ? resp.statusMessage : "fetcherror",
      new Date().toISOString(),
      JSON.stringify({ error: (resp && resp.statusMessage) || "fetcherror" }),
    );
    if (info && info.changes && info.changes > 0) {
      const row = {
        id: info.lastInsertRowid,
        project_id: projectId,
        type: "html",
        url: queueItem.url,
        referrer: queueItem.referrer || null,
        depth: queueItem.depth || null,
        code: resp && resp.statusCode ? resp.statusCode : null,
        contentType: resp && resp.headers ? resp.headers["content-type"] : null,
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
        status: resp && resp.statusMessage ? resp.statusMessage : "fetcherror",
        date: new Date().toISOString(),
        content: JSON.stringify({
          error: (resp && resp.statusMessage) || "fetcherror",
        }),
      };
      try {
        logJson({ type: "row", row });
      } catch (_) {}
      try {
        if (Array.isArray(parserConfig) && parserConfig.length) {
          updateCurrentAndHistory(projectId, row.url, row);
        }
      } catch (_) {}
      emitDbStatsThrottled();
      stopCrawlerByMaxUrls();
    }
    try {
      if (queueItem && queueItem.url) visited.add(queueItem.url);
    } catch (_) {}
  } catch (e) {
    // fallback to sending an error event if DB insert fails
    logJson({
      type: "error",
      message: "fetcherror",
      url: queueItem.url,
      status: resp && resp.statusCode,
    });
  }
  stopCrawlerByMaxUrls();
  reportProgress();
});

crawler.on("complete", () => {
  completeRequested = true;
  maybeFinishCrawler();
});

crawler.on("fetchtimeout", (queueItem, timeout) => {
  if (stopping) return;
  fetchedSession++;
  try {
    const info = insertStmt.run(
      projectId,
      "crawler",
      "html",
      queueItem.url,
      queueItem.referrer || null,
      queueItem.depth || null,
      null,
      null,
      queueItem.protocol || null,
      (queueItem.stateData && queueItem.stateData.location) || null,
      (queueItem.stateData && queueItem.stateData.actualDataSize) || null,
      (queueItem.stateData && queueItem.stateData.requestTime) || null,
      (queueItem.stateData && queueItem.stateData.requestLatency) || null,
      (queueItem.stateData && queueItem.stateData.downloadTime) || null,
      "fetchtimeout",
      new Date().toISOString(),
      JSON.stringify({ timeout }),
    );
    if (info && info.changes && info.changes > 0) {
      const row = {
        id: info.lastInsertRowid,
        project_id: projectId,
        type: "html",
        url: queueItem.url,
        status: "fetchtimeout",
        date: new Date().toISOString(),
        content: JSON.stringify({ timeout }),
      };
      try {
        logJson({ type: "row", row });
      } catch (_) {}
      try {
        if (Array.isArray(parserConfig) && parserConfig.length) {
          updateCurrentAndHistory(projectId, row.url, row);
        }
      } catch (_) {}
      emitDbStatsThrottled();
      stopCrawlerByMaxUrls();
    }
    try {
      if (queueItem && queueItem.url) visited.add(queueItem.url);
    } catch (_) {}
  } catch (e) {
    logJson({
      type: "error",
      message: "fetchtimeout",
      url: queueItem.url,
      timeout,
    });
  }
  stopCrawlerByMaxUrls();
  reportProgress();
});

crawler.on("fetch404", (queueItem, resp) => {
  if (stopping) return;
  fetchedSession++;
  try {
    const info = insertStmt.run(
      projectId,
      "crawler",
      "html",
      queueItem.url,
      queueItem.referrer || null,
      queueItem.depth || null,
      resp && resp.statusCode ? resp.statusCode : 404,
      resp && resp.headers ? resp.headers["content-type"] : null,
      queueItem.protocol || null,
      (queueItem.stateData && queueItem.stateData.location) || null,
      (queueItem.stateData && queueItem.stateData.actualDataSize) || null,
      (queueItem.stateData && queueItem.stateData.requestTime) || null,
      (queueItem.stateData && queueItem.stateData.requestLatency) || null,
      (queueItem.stateData && queueItem.stateData.downloadTime) || null,
      resp && resp.statusMessage ? resp.statusMessage : "404",
      new Date().toISOString(),
      JSON.stringify({
        status: resp && resp.statusCode ? resp.statusCode : 404,
      }),
    );
    if (info && info.changes && info.changes > 0) {
      const row = {
        id: info.lastInsertRowid,
        project_id: projectId,
        type: "html",
        url: queueItem.url,
        referrer: queueItem.referrer || null,
        depth: queueItem.depth || null,
        code: resp && resp.statusCode ? resp.statusCode : 404,
        contentType: resp && resp.headers ? resp.headers["content-type"] : null,
        protocol: queueItem.protocol || null,
        status: resp && resp.statusMessage ? resp.statusMessage : "404",
        date: new Date().toISOString(),
        content: JSON.stringify({
          status: resp && resp.statusCode ? resp.statusCode : 404,
        }),
      };
      try {
        logJson({ type: "row", row });
      } catch (_) {}
      try {
        if (Array.isArray(parserConfig) && parserConfig.length) {
          updateCurrentAndHistory(projectId, row.url, row);
        }
      } catch (_) {}
      emitDbStatsThrottled();
    }
    try {
      if (queueItem && queueItem.url) visited.add(queueItem.url);
    } catch (_) {}
  } catch (e) {
    logJson({
      type: "error",
      message: "404",
      url: queueItem.url,
      status: resp && resp.statusCode,
    });
  }
  stopCrawlerByMaxUrls();
  reportProgress();
});

// Persist redirects as rows so 3XX runs are visible in table/stats
try {
  crawler.on("fetchredirect", (queueItem, parsedURL, response) => {
    if (stopping) return;
    fetchedSession++;
    try {
      const statusCode =
        response && response.statusCode ? Number(response.statusCode) : 302;
      const contentType =
        response && response.headers ? response.headers["content-type"] : null;
      const locationHeader =
        response && response.headers ? response.headers.location || null : null;
      const info = insertStmt.run(
        projectId,
        "crawler",
        "html",
        (queueItem && queueItem.url) || "",
        (queueItem && queueItem.referrer) || null,
        (queueItem && queueItem.depth) || null,
        statusCode,
        contentType,
        (queueItem && queueItem.protocol) || null,
        locationHeader,
        (queueItem && queueItem.stateData && queueItem.stateData.actualDataSize) ||
          null,
        (queueItem && queueItem.stateData && queueItem.stateData.requestTime) ||
          null,
        (queueItem &&
          queueItem.stateData &&
          queueItem.stateData.requestLatency) ||
          null,
        (queueItem && queueItem.stateData && queueItem.stateData.downloadTime) ||
          null,
        (response && response.statusMessage) || "redirect",
        new Date().toISOString(),
        JSON.stringify({
          status: statusCode,
          location: locationHeader,
          redirectedTo: parsedURL ? String(parsedURL.href || parsedURL) : null,
        }),
      );
      if (info && info.changes && info.changes > 0) {
        logJson({
          type: "row",
          row: {
            id: info.lastInsertRowid,
            project_id: projectId,
            source: "crawler",
            type: "html",
            url: (queueItem && queueItem.url) || "",
            referrer: (queueItem && queueItem.referrer) || null,
            depth: (queueItem && queueItem.depth) || null,
            code: statusCode,
            contentType: contentType,
            protocol: (queueItem && queueItem.protocol) || null,
            location: locationHeader,
            status: (response && response.statusMessage) || "redirect",
            date: new Date().toISOString(),
            content: JSON.stringify({
              status: statusCode,
              location: locationHeader,
            }),
          },
        });
        emitDbStatsThrottled();
      }
      try {
        if (queueItem && queueItem.url) visited.add(queueItem.url);
      } catch (_) {}
    } catch (e) {
      logJson({
        type: "error",
        message: "fetchredirect",
        url: queueItem && queueItem.url,
        error: e && e.message ? e.message : String(e),
      });
    }
    stopCrawlerByMaxUrls();
    reportProgress();
  });
} catch (_) {}

// Some versions emit fetchclienterror for client-side issues
try {
  crawler.on("fetchclienterror", (queueItem, errorData) => {
    if (stopping) return;
    fetchedSession++;
    try {
      const info = insertStmt.run(
        projectId,
        "crawler",
        "html",
        (queueItem && queueItem.url) || "",
        (queueItem && queueItem.referrer) || null,
        (queueItem && queueItem.depth) || null,
        null,
        null,
        (queueItem && queueItem.protocol) || null,
        null,
        null,
        null,
        null,
        null,
        "fetchclienterror",
        new Date().toISOString(),
        JSON.stringify({
          error: (errorData && errorData.message) || "fetchclienterror",
        }),
      );
      if (info && info.changes && info.changes > 0) {
        logJson({
          type: "row",
          row: {
            id: info.lastInsertRowid,
            project_id: projectId,
            type: "html",
            url: (queueItem && queueItem.url) || "",
            referrer: (queueItem && queueItem.referrer) || null,
            depth: (queueItem && queueItem.depth) || null,
            code: null,
            contentType: null,
            protocol: (queueItem && queueItem.protocol) || null,
            status: "fetchclienterror",
            date: new Date().toISOString(),
            content: JSON.stringify({
              error: (errorData && errorData.message) || "fetchclienterror",
            }),
          },
        });
        emitDbStatsThrottled();
      }
      try {
        if (queueItem && queueItem.url) visited.add(queueItem.url);
      } catch (_) {}
    } catch (_) {
      // keep legacy error event for visibility when db insert fails
      logJson({
        type: "error",
        message: "fetchclienterror",
        url: queueItem && queueItem.url,
        error: (errorData && errorData.message) || "",
      });
    }
    stopCrawlerByMaxUrls();
    reportProgress();
  });
} catch (_) {}

// Handle disallowed URLs (robots.txt)
let disallowedCount = initialDisallowedCount;
try {
  crawler.on("fetchdisallowed", (queueItem) => {
    if (stopping) return;
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
        "Blocked by robots.txt",
      );

      // Add to visited set to avoid re-crawling
      if (queueItem.url) {
        visited.add(queueItem.url);
      }

      // Emit row event if actual insertion occurred
      if (info.changes > 0) {
        logJson({
          type: "row",
          row: {
            url: queueItem.url,
            error_type: "fetchdisallowed",
            status: "disallowed",
            depth: queueItem.depth || 0,
            created_at: new Date().toISOString(),
          },
        });
        emitDbStatsThrottled();
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
function normalizeComparableUrl(value) {
  try {
    const u = new URL(String(value || ""));
    const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
    let pathname = u.pathname || "/";
    pathname = pathname.replace(/\/+$/, "");
    if (!pathname) pathname = "/";
    const search = u.search || "";
    return `${u.protocol}//${host}${pathname}${search}`;
  } catch (_) {
    return String(value || "").replace(/\/+$/, "");
  }
}
const startUrlComparable = normalizeComparableUrl(startUrl);
function isSameStartUrl(url) {
  return normalizeComparableUrl(url) === startUrlComparable;
}

try {
  crawler.addFetchCondition(function (queueItem, referrer, cb) {
    if (stopping) {
      if (typeof cb === "function") return cb(null, false);
      return false;
    }
    const url = queueItem && queueItem.url;
    const allowed = url ? isSameStartUrl(url) || !visited.has(url) : true;
    if (typeof cb === "function") return cb(null, allowed);
    return allowed;
  });
} catch (_) {}

// Restrict crawling to the start URL path (if enabled)
try {
  if (crawlerConfig && crawlerConfig.restrictToStartPath) {
    const startMeta = (() => {
      try {
        const u = new URL(startUrl);
        const p = u.pathname || "/";
        const startPath = p.endsWith("/") ? p : p + "/";
        const startPathNoSlash =
          startPath.length > 1 && startPath.endsWith("/")
            ? startPath.slice(0, -1)
            : startPath;
        const origin = u.origin;
        const host = (u.hostname || "").toLowerCase();
        const hostNorm = host.startsWith("www.") ? host.slice(4) : host;
        return { startPath, startPathNoSlash, origin, hostNorm };
      } catch (_) {
        return {
          startPath: "/",
          startPathNoSlash: "/",
          origin: null,
          hostNorm: null,
        };
      }
    })();
    crawler.addFetchCondition(function (queueItem, referrer, cb) {
      if (stopping) {
        if (typeof cb === "function") return cb(null, false);
        return false;
      }
      try {
        const urlStr = queueItem && queueItem.url;
        if (!urlStr) return typeof cb === "function" ? cb(null, true) : true;
        const u = new URL(urlStr);
        const path = u.pathname || "/";
        const normalized = path.endsWith("/") ? path : path + "/";
        const host = (u.hostname || "").toLowerCase();
        const hostNorm = host.startsWith("www.") ? host.slice(4) : host;
        const originOk = startMeta.hostNorm
          ? hostNorm === startMeta.hostNorm
          : startMeta.origin
            ? u.origin === startMeta.origin
            : true;
        const allowed =
          originOk &&
          (isSameStartUrl(urlStr) ||
            normalized.startsWith(startMeta.startPath) ||
            path === startMeta.startPathNoSlash);
        if (!allowed) {
          try {
            const info = insertDisallowedStmt.run(
              projectId,
              urlStr,
              "path_restricted",
              0,
              "disallowed",
              queueItem.referrer || null,
              queueItem.depth || 0,
              queueItem.protocol || null,
              `Outside start URL: ${startMeta.startPath}`,
            );
            if (info && info.changes > 0) {
              disallowedCount++;
              logJson({
                type: "row",
                row: {
                  url: urlStr,
                  error_type: "path_restricted",
                  status: "disallowed",
                  referrer: queueItem.referrer || null,
                  depth: queueItem.depth || 0,
                  protocol: queueItem.protocol || null,
                  error_message: `Outside start URL: ${startMeta.startPath}`,
                  created_at: new Date().toISOString(),
                },
              });
              logJson({
                type: "stat",
                stat: "disallow",
                value: disallowedCount,
                url: urlStr,
              });
            }
          } catch (_) {}
        }
        if (typeof cb === "function") return cb(null, allowed);
        return allowed;
      } catch (_) {
        if (typeof cb === "function") return cb(null, true);
        return true;
      }
    });
  }
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
      FROM urls WHERE project_id = ? AND COALESCE(source, 'crawler') = 'crawler'
    `,
      )
      .get(projectId);

    // Count by status code ranges
    const codeStats = db
      .prepare(
        `
      SELECT
        SUM(CASE WHEN code >= 300 AND code < 400 THEN 1 ELSE 0 END) as redirect,
        SUM(CASE WHEN code >= 400 THEN 1 ELSE 0 END) as error
      FROM urls WHERE project_id = ? AND COALESCE(source, 'crawler') = 'crawler'
    `,
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
      FROM urls WHERE project_id = ? AND COALESCE(source, 'crawler') = 'crawler'
    `,
      )
      .get(projectId);

    // Count disallowed URLs
    const disallowedStats = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM disallowed WHERE project_id = ?
    `,
      )
      .get(projectId);

    // Emit all stats from DB only (avoid double-counting session stats)
    if (typeStats) {
      const html = typeStats.html || 0;
      const image = typeStats.image || 0;
      const jscss = typeStats.jscss || 0;
      if (html) logJson({ type: "stat", stat: "html", value: html });
      if (image) logJson({ type: "stat", stat: "image", value: image });
      if (jscss) logJson({ type: "stat", stat: "jscss", value: jscss });
    }
    if (codeStats) {
      const redirect = codeStats.redirect || 0;
      const error = codeStats.error || 0;
      if (redirect)
        logJson({ type: "stat", stat: "redirect", value: redirect });
      if (error) logJson({ type: "stat", stat: "error", value: error });
    }
    if (depthStats) {
      const depth3 = depthStats.depth3 || 0;
      const depth5 = depthStats.depth5 || 0;
      const depth6 = depthStats.depth6 || 0;
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
        withQueueLength((len) => {
          try {
            // Always re-seed start URL after defrost.
            // In some cases defrosted queue can miss the original start URL
            // (e.g. only robots/sitemap leftovers), causing immediate finish.
            crawler.queueURL(startUrl);
            const qLen = typeof len === "number" ? len : 0;
            if (qLen <= 0) {
              logJson({
                type: "queue",
                message: "defrost-empty-seeded-start-url",
              });
            } else {
              logJson({
                type: "queue",
                message: "defrost-ensured-start-url",
              });
            }
          } catch (_) {}
          // After defrost, recalc progress and start
          reportProgress();
          logJson({ type: "queue", message: "defrosted-from-file" });
          startCrawlerNow();
        });
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
  stopping = true;
  try {
    if (crawler && typeof crawler.stop === "function") crawler.stop();
  } catch (_) {}
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
      shutdownParserWorker();
      shutdownChromium().finally(() => {
        setTimeout(() => process.exit(0), 50);
      });
    });
  } catch (e) {
    logJson({
      type: "error",
      stage: "freezeQueue",
      message: e && e.message ? e.message : String(e),
      signal,
    });
    shutdownParserWorker();
    shutdownChromium().finally(() => {
      setTimeout(() => process.exit(0), 50);
    });
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

// start handled in startCrawlerNow() to avoid duplicate "started" events
