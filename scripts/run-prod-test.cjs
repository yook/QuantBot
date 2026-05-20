#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(repoRoot, 'release');
const pkg = require(path.join(repoRoot, 'package.json'));

function isSemverDir(name) {
  return /^\d+\.\d+\.\d+$/.test(name);
}

function cmpSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function findLatestReleaseDir() {
  if (!fs.existsSync(releaseRoot)) return null;
  const dirs = fs.readdirSync(releaseRoot).filter(isSemverDir);
  if (!dirs.length) return null;
  dirs.sort(cmpSemver);
  return dirs[dirs.length - 1];
}

function resolveAppPath() {
  const envVersion = process.env.APP_VERSION;
  const preferredVersion = envVersion || pkg.version;
  const candidates = [];
  if (preferredVersion) candidates.push(preferredVersion);
  const latest = findLatestReleaseDir();
  if (latest && !candidates.includes(latest)) candidates.push(latest);

  for (const version of candidates) {
    const appPath = path.join(releaseRoot, version, 'mac-arm64', 'PageViewer.app');
    if (fs.existsSync(appPath)) return { appPath, version };
  }
  return null;
}

const resolved = resolveAppPath();
if (!resolved) {
  console.error('[prod-test] Не найдено .app в release/. Запусти `npm run build`.');
  process.exit(1);
}

const appExec = path.join(resolved.appPath, 'Contents', 'MacOS', 'PageViewer');
if (!fs.existsSync(appExec)) {
  console.error('[prod-test] Не найден исполняемый файл:', appExec);
  process.exit(1);
}

console.log('[prod-test] Запуск:', appExec);
if (process.env.UPDATE_FEED_URL) {
  console.log('[prod-test] UPDATE_FEED_URL:', process.env.UPDATE_FEED_URL);
} else {
  console.log('[prod-test] UPDATE_FEED_URL не задан. Обновление не найдется.');
}

const child = spawn(appExec, {
  env: process.env,
  stdio: 'inherit',
  detached: false,
});

child.on('exit', (code, signal) => {
  console.log(`[prod-test] Приложение завершилось: code=${code} signal=${signal || ''}`);
});
