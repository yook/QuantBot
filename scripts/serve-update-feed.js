#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT || 8080);
const root =
  process.env.UPDATE_FEED_DIR ||
  path.join(__dirname, "..", "release");

function safePath(p) {
  const resolved = path.resolve(p);
  if (!resolved.startsWith(path.resolve(root))) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  try {
    const reqUrl = req.url || "/";
    const pathname = decodeURIComponent(reqUrl.split("?")[0]);
    let filePath = path.join(root, pathname);
    const safe = safePath(filePath);
    if (!safe) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(safe) && fs.statSync(safe).isDirectory()) {
      // list directory
      const entries = fs.readdirSync(safe);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<h3>Update Feed</h3><ul>` +
          entries
            .map((e) => `<li><a href="${path.posix.join(pathname, e)}">${e}</a></li>`)
            .join("") +
          `</ul>`
      );
      return;
    }

    if (!fs.existsSync(safe)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const stream = fs.createReadStream(safe);
    stream.on("error", () => {
      res.writeHead(500);
      res.end("Error");
    });
    res.writeHead(200);
    stream.pipe(res);
  } catch (e) {
    res.writeHead(500);
    res.end("Error");
  }
});

server.listen(port, () => {
  console.log(`[update-feed] Serving ${root} at http://localhost:${port}`);
  console.log(`[update-feed] Set UPDATE_FEED_URL to http://localhost:${port}/<version-dir>/`);
});
