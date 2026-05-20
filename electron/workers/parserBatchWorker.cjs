#!/usr/bin/env node
const fs = require("fs");
const Database = require("better-sqlite3");
let JSDOM = null;
let chromiumModule = null;
let chromiumBrowser = null;
let chromiumQueue = Promise.resolve();
let chromiumInFlight = 0;
const { extractDynamicFromHtml } = require("./parserExtractor.cjs");

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
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
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

function getRenderMaxConcurrency(crawlerConfig) {
  const max =
    crawlerConfig && typeof crawlerConfig.renderMaxConcurrency === "number"
      ? crawlerConfig.renderMaxConcurrency
      : 1;
  return Math.max(1, Math.min(4, max));
}

function normalizeRenderTimeout(timeoutMs) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return 30000;
  return Math.max(500, Math.min(120000, Math.round(n)));
}

function normalizePostLoadWait(waitMs) {
  const n = Number(waitMs);
  if (!Number.isFinite(n) || n < 0) return 3000;
  return Math.max(0, Math.min(15000, Math.round(n)));
}

function withChromiumLock(crawlerConfig, fn) {
  const run = chromiumQueue.then(async () => {
    const max = getRenderMaxConcurrency(crawlerConfig);
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
  if (!mod || !mod.chromium) return null;
  try {
    chromiumBrowser = await mod.chromium.launch({ headless: true });
  } catch (_) {
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

async function renderChromiumHtml(url, timeoutMs, userAgent, crawlerConfig) {
  const safeTimeout = normalizeRenderTimeout(timeoutMs);
  const postLoadWaitMs = normalizePostLoadWait(
    crawlerConfig && crawlerConfig.renderPostLoadWaitMs,
  );
  return withChromiumLock(crawlerConfig, async () => {
    const browser = await ensureChromiumBrowser();
    if (!browser) return null;
    let page;
    try {
      page = await browser.newPage(userAgent ? { userAgent } : undefined);
      await Promise.race([
        page.goto(url, { waitUntil: "domcontentloaded", timeout: safeTimeout }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`render-timeout:${safeTimeout}`)),
            safeTimeout + 500,
          ),
        ),
      ]);

      // Some blocks are injected after hydration; wait a bit before snapshotting DOM.
      if (postLoadWaitMs > 0) {
        try {
          await page.waitForLoadState("networkidle", {
            timeout: Math.min(postLoadWaitMs, safeTimeout),
          });
        } catch (_) {}
        await page.waitForTimeout(postLoadWaitMs);
      }

      const html = await page.content();
      try {
        await page.close();
      } catch (_) {}
      return html;
    } catch (e) {
      logJson({
        type: "render",
        mode: "chromium",
        level: "warn",
        url,
        message: e && e.message ? e.message : "render-failed",
      });
      try {
        if (page) await page.close();
      } catch (_) {}
      return null;
    }
  });
}

async function renderLightweightHtml(html, baseUrl, timeoutMs) {
  const JSDOMImpl = getJsdom();
  if (!JSDOMImpl) return null;
  const safeTimeout = normalizeRenderTimeout(timeoutMs);
  try {
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

async function fetchUrl(url, timeoutMs, userAgent) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      // Keep original URL response code (3xx/4xx/5xx) for parser table semantics.
      // We do not want implicit navigation to final address here.
      redirect: "manual",
      signal: controller.signal,
      headers: userAgent ? { "User-Agent": userAgent } : undefined,
    });
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      location: response.headers.get("location") || null,
      headers: Object.fromEntries(response.headers.entries()),
      buffer,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (e) {
    return {
      ok: false,
      error: e && e.message ? e.message : String(e),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const cfg = parseArgs();
  const {
    projectId,
    crawlerConfig = {},
    parserConfig = [],
    parserUrls = [],
    dbPath,
  } = cfg;

  if (!projectId || !dbPath) {
    logJson({ type: "error", message: "Missing required config fields" });
    process.exit(1);
  }

  const db = new Database(dbPath);
  let rows = [];
  if (Array.isArray(parserUrls) && parserUrls.length > 0) {
    const placeholders = parserUrls.map(() => "?").join(",");
    rows = db
      .prepare(
        `SELECT * FROM urls
         WHERE project_id = ?
           AND source = 'parser'
           AND url IN (${placeholders})
         ORDER BY id ASC`,
      )
      .all(projectId, ...parserUrls);
  } else {
    rows = db
      .prepare(
        "SELECT * FROM urls WHERE project_id = ? AND source = 'parser' ORDER BY id ASC",
      )
      .all(projectId);
  }

  const updateStmt = db.prepare(
    `UPDATE urls
     SET type = ?,
         code = ?,
         contentType = ?,
         protocol = ?,
         location = ?,
         actualDataSize = ?,
         requestTime = ?,
         requestLatency = ?,
         downloadTime = ?,
         status = ?,
         date = ?,
         content = ?
     WHERE project_id = ? AND url = ? AND source = 'parser'`,
  );

  logJson({ type: "started", projectId, startUrl: "batch:uploaded-urls" });

  const total = rows.length;
  let fetched = 0;
  for (const row of rows) {
    const url = row && row.url;
    if (!url) continue;

    const timeoutMs =
      typeof crawlerConfig.timeout === "number" ? crawlerConfig.timeout : 10000;
    const response = await fetchUrl(url, timeoutMs, crawlerConfig.userAgent);

    let contentType = response.ok
      ? response.headers["content-type"] || null
      : null;
    let type = classifyResourceType(contentType, url);
    let status = response.ok ? response.statusText : "fetcherror";
    let code = response.ok ? response.status : null;
    let protocol = null;
    let location = null;
    let actualDataSize = response.ok ? response.buffer.length : null;
    let requestTime = response.elapsedMs || null;
    let requestLatency = null;
    let downloadTime = response.elapsedMs || null;
    let content = JSON.stringify({ error: response.error || "" });

    try {
      protocol = new URL(url).protocol.replace(":", "");
    } catch (_) {}

    const statusCode = Number(response.status || 0);
    const isParsableStatus = statusCode >= 200 && statusCode < 300;
    const isHtmlResponse =
      !!contentType && /text\/html|application\/xhtml\+xml/i.test(contentType);

    if (response.location) {
      location = response.location;
    }

    if (isParsableStatus && isHtmlResponse) {
      let html = response.buffer.toString("utf8");
      const renderEnabled = !!crawlerConfig.renderEnabled;
      const renderMode = crawlerConfig.renderMode || "lightweight";
      const renderTimeoutMs = normalizeRenderTimeout(
        crawlerConfig.renderTimeoutMs,
      );

      if (renderEnabled && renderMode === "lightweight") {
        const rendered = await renderLightweightHtml(
          html,
          url,
          renderTimeoutMs,
        );
        if (rendered) html = rendered;
      } else if (renderEnabled && renderMode === "chromium") {
        const rendered = await renderChromiumHtml(
          url,
          renderTimeoutMs,
          crawlerConfig.userAgent,
          crawlerConfig,
        );
        if (rendered) html = rendered;
      } else if (renderEnabled && renderMode === "hybrid") {
        const rendered = await renderLightweightHtml(
          html,
          url,
          renderTimeoutMs,
        );
        if (rendered) html = rendered;
        const dynamicLight = extractDynamicFromHtml(html, parserConfig);
        const hasData = Object.values(dynamicLight).some((v) => {
          if (Array.isArray(v)) return v.length > 0;
          return String(v || "").trim() !== "";
        });
        if (!hasData) {
          const renderedChromium = await renderChromiumHtml(
            url,
            renderTimeoutMs,
            crawlerConfig.userAgent,
            crawlerConfig,
          );
          if (renderedChromium) html = renderedChromium;
        }
      }

      const dynamic = extractDynamicFromHtml(html, parserConfig);
      content = JSON.stringify(dynamic);

    } else if (statusCode >= 300) {
      content = JSON.stringify({
        note: "skipped-parse-by-status",
        status: statusCode,
        location: response.location || null,
      });
    }

    try {
      updateStmt.run(
        type,
        code,
        contentType,
        protocol,
        location,
        actualDataSize,
        requestTime,
        requestLatency,
        downloadTime,
        status,
        new Date().toISOString(),
        content,
        projectId,
        url,
      );
    } catch (e) {
      logJson({
        type: "error",
        url,
        message: e && e.message ? e.message : "update-failed",
      });
    }

    fetched++;
    logJson({
      type: "row",
      row: {
        ...row,
        url,
        type,
        code,
        contentType,
        protocol,
        location,
        actualDataSize,
        requestTime,
        requestLatency,
        downloadTime,
        status,
        date: new Date().toISOString(),
        content,
      },
    });
    logJson({
      type: "progress",
      fetched,
      queue: Math.max(total - fetched, 0),
    });
  }

  await shutdownChromium();
  logJson({ type: "finished", fetched });
  process.exit(0);
}

main().catch((e) => {
  logJson({
    type: "error",
    message: e && e.message ? e.message : String(e),
  });
  process.exit(1);
});
