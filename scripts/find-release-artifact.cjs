#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, 'true');
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  return args;
}

function getVersion(args) {
  const provided = args.get('version');
  if (provided) {
    return provided.replace(/^v/, '');
  }

  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return String(pkg.version || '').trim();
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Release directory not found: ${dir}`);
  }

  return fs
    .readdirSync(dir)
    .map((entry) => path.join(dir, entry))
    .filter((entry) => fs.statSync(entry).isFile());
}

function pickArtifact(platform, files) {
  if (platform === 'windows') {
    const preferred =
      files.find((file) => /setup\.exe$/i.test(file) && !/portable/i.test(path.basename(file))) ||
      files.find((file) => /\.exe$/i.test(file) && !/portable/i.test(path.basename(file))) ||
      files.find((file) => /\.exe$/i.test(file));

    if (!preferred) {
      throw new Error('Windows artifact (.exe) not found');
    }

    return preferred;
  }

  if (platform === 'macos') {
    const preferred = files.find((file) => /\.dmg$/i.test(file));
    if (!preferred) {
      throw new Error('macOS artifact (.dmg) not found');
    }

    return preferred;
  }

  throw new Error('Unsupported platform');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = args.get('platform');
  const asJson = args.get('json') === 'true';

  if (platform !== 'windows' && platform !== 'macos') {
    throw new Error('Usage: node scripts/find-release-artifact.cjs --platform windows|macos [--version 1.2.3] [--json]');
  }

  const version = getVersion(args);
  if (!version) {
    throw new Error('Unable to determine version');
  }

  const releaseDir = path.join(process.cwd(), 'release', version);
  const files = listFiles(releaseDir);
  const artifactPath = pickArtifact(platform, files);
  const stats = fs.statSync(artifactPath);

  const payload = {
    version,
    platform,
    releaseDir,
    artifactPath,
    fileName: path.basename(artifactPath),
    fileSizeBytes: stats.size,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(payload, null, 2));
    return;
  }

  process.stdout.write(`${artifactPath}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
