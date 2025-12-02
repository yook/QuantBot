#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const Module = require("module");

function walk(dir, exts = [".cjs", ".js", ".ts", ".mjs"]) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, exts));
    else if (entry.isFile() && exts.includes(path.extname(entry.name)))
      out.push(p);
  }
  return out;
}

function findRequires(file) {
  const txt = fs.readFileSync(file, "utf8");
  const reqs = new Set();
  const re1 = /require\(['\"]([^'\"]+)['\"]\)/g;
  const re2 = /from\s+['\"]([^'\"]+)['\"]/g;
  let m;
  while ((m = re1.exec(txt))) reqs.add(m[1]);
  while ((m = re2.exec(txt))) reqs.add(m[1]);
  return [...reqs];
}

function isExternal(name) {
  if (!name) return false;
  if (name.startsWith(".") || name.startsWith("/")) return false;
  // scoped package or package with slash is allowed
  const builtins = new Set(
    Module.builtinModules ||
      Object.keys(process.binding ? process.binding("natives") : {})
  );
  if (builtins.has(name)) return false;
  return true;
}

function addRecursive(pkg, set) {
  if (!pkg) return;
  if (set.has(pkg)) return;
  set.add(pkg);
  try {
    const pj = require(path.join(
      process.cwd(),
      "node_modules",
      pkg,
      "package.json"
    ));
    const deps = Object.assign(
      {},
      pj.dependencies || {},
      pj.peerDependencies || {}
    );
    for (const d of Object.keys(deps)) addRecursive(d, set);
  } catch (e) {
    // ignore
  }
}

// collect files
const roots = ["worker", path.join("electron", "workers")];
let files = [];
for (const r of roots) files.push(...walk(r));
files = Array.from(new Set(files));

// collect external modules
const external = new Set();
for (const f of files) {
  const reqs = findRequires(f);
  for (const r of reqs) {
    if (isExternal(r)) {
      // take package root (e.g. lodash/map -> lodash)
      const pkg = r
        .split("/")
        .slice(0, r.startsWith("@") ? 2 : 1)
        .join("/");
      external.add(pkg);
    }
  }
}

// expand transitive deps by reading node_modules
const fullSet = new Set();
for (const pkg of external) addRecursive(pkg, fullSet);
for (const pkg of external) fullSet.add(pkg);

const packages = Array.from(fullSet).sort();
console.log("Detected worker external packages:", packages);

// read electron-builder.json5 and inject entries into asarUnpack
const ebPath = path.join(process.cwd(), "electron-builder.json5");
if (!fs.existsSync(ebPath)) {
  console.error("electron-builder.json5 not found");
  process.exit(1);
}
let content = fs.readFileSync(ebPath, "utf8");
// find asarUnpack array start
const marker = "asarUnpack:";
const idx = content.indexOf(marker);
if (idx === -1) {
  console.error("asarUnpack not found in electron-builder.json5");
  process.exit(1);
}
// find array start and end (rough parsing)
const start = content.indexOf("[", idx);
let end = start;
let level = 0;
for (let i = start; i < content.length; i++) {
  const ch = content[i];
  if (ch === "[") level++;
  else if (ch === "]") {
    level--;
    if (level === 0) {
      end = i;
      break;
    }
  }
}
const arrayText = content.slice(start + 1, end);
// extract existing entries
const existing = new Set();
const entryRe = /\"([^\"]+)\"/g;
let m;
while ((m = entryRe.exec(arrayText))) existing.add(m[1]);

const toAdd = [];
for (const pkg of packages) {
  const entry = `node_modules/${pkg}/**`;
  if (!existing.has(entry)) {
    toAdd.push(entry);
  }
}
if (toAdd.length === 0) {
  console.log("No new asarUnpack entries needed");
  process.exit(0);
}

// build injected text: keep indentation from original
const lines = arrayText.split("\n");
let indent = "  ";
for (const l of lines) {
  const m = l.match(/^(\s*)\"/);
  if (m) {
    indent = m[1];
    break;
  }
}
const inject = toAdd.map((e) => `${indent}"${e}",`).join("\n") + "\n";
// insert before end
const newContent =
  content.slice(0, start + 1) + "\n" + inject + content.slice(start + 1);
fs.writeFileSync(ebPath, newContent, "utf8");
console.log("Updated electron-builder.json5, added entries:", toAdd);

process.exit(0);
