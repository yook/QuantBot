# Electron Dependency Audit

Date: 2026-05-19

## Goal

Find safe ways to reduce Electron build weight and build time without losing product quality or core functionality.

## What was checked

- Runtime dependency usage from `/Users/yook/Documents/PW/app/package.json`
- Actual imports and `require()` usage across:
  - `/Users/yook/Documents/PW/app/src`
  - `/Users/yook/Documents/PW/app/electron`
  - `/Users/yook/Documents/PW/app/scripts`
  - `/Users/yook/Documents/PW/app/build-scripts`
  - `/Users/yook/Documents/PW/app/test`
- Packaging rules in `/Users/yook/Documents/PW/app/electron-builder.json5`
- Effective packaged output in `/Users/yook/Documents/PW/app/release/1.3.2`

## Current size facts

- Whole app workspace earlier measured at about `3.9G`
- `node_modules` earlier measured at about `1.0G`
- Largest local packages in `node_modules`:
  - `electron` - `274M`
  - `app-builder-bin` - `207M`
  - `element-plus` - `63M`
  - `phpmorphy` - `50M`
  - `electron-winstaller` - `31M`
  - `@vscode/sqlite3` - `24M`
  - `typescript` - `23M`
  - `lzma-native` - `23M`
  - `better-sqlite3` - `21M`
  - `playwright-core` - `11M`
  - `xlsx` - `7.2M`
  - `moment` - `5.2M`
  - `jsdom` - `4.3M`

- Current macOS build output for `1.3.2`:
  - app bundle dir: `518M`
  - DMG: `186M`
  - ZIP: `169M`

- Packaged app resources:
  - `app.asar` - `194M`
  - `app.asar.unpacked` - `68M`

## Main findings

### 1. The biggest packaging issue is not one library, but `node_modules/**/*`

File: `/Users/yook/Documents/PW/app/electron-builder.json5`

The builder currently ships:

```json5
files: [
  "dist",
  "dist-electron",
  "electron/workers/crawlerWorker.cjs",
  "electron/workers/parserBatchWorker.cjs",
  "electron/workers/parserExtractor.cjs",
  "electron/workers/parserWorker.cjs",
  "node_modules/**/*",
]
```

This is the main reason the package is bloated. It makes the app ship the full production dependency tree instead of only the modules actually needed at runtime.

Impact:

- larger `app.asar`
- larger `app.asar.unpacked`
- longer packaging
- more accidental shipping of dead dependencies

### 2. Several declared runtime dependencies are unused

These packages are in `dependencies`, but current code usage search found no runtime imports for the app itself:

- `axios`
- `express`
- `cors`
- `body-parser`
- `http`
- `@electron/asar`
- `@vscode/sqlite3`

Notes:

- `http` is especially suspicious because the code uses built-in `node:http`, not the `http` npm package.
- `@vscode/sqlite3` is not used anywhere in the app code, while the app uses `better-sqlite3`.
- `@electron/asar` is not referenced in the app code.

Safe recommendation:

- remove all of the above from `dependencies`

### 3. `sharp` should not be a runtime dependency

Usage found only in:

- `/Users/yook/Documents/PW/app/build-scripts/generate-icons.js`

It is not used by the packaged app at runtime.

Safe recommendation:

- move `sharp` from `dependencies` to `devDependencies`

### 4. `phpmorphy` is not used by the shipped app

Usage found only in test files:

- `/Users/yook/Documents/PW/app/test/test-morph-simple.cjs`
- `/Users/yook/Documents/PW/app/test/tmp-inspect-kozhanyy.cjs`

Package weight:

- local `node_modules/phpmorphy` is about `50M`

Safe recommendation:

- remove `phpmorphy` from runtime dependencies
- either remove it fully, or move it to `devDependencies` only if those test scripts are still needed

### 5. `moment` is only used in one component

Usage found in:

- `/Users/yook/Documents/PW/app/src/components/DataTableFixed.vue`

Current usage appears limited to date parsing/formatting, which can be replaced without quality loss by:

- native `Intl.DateTimeFormat`
- or `dayjs` if a small helper library is preferred

Safe recommendation:

- replace `moment` with a local formatter helper

This is not the biggest win, but it is low risk and easy.

### 6. Some heavy packages are genuinely used and should stay for now

These are real runtime dependencies based on current code:

- `better-sqlite3`
- `element-plus`
- `pinia`
- `vue`
- `vue-i18n`
- `validator`
- `xlsx`
- `electron-updater`
- `simplecrawler`
- `cheerio`
- `jsdom`
- `playwright-chromium`

Important note on `playwright-chromium`:

It is used in:

- `/Users/yook/Documents/PW/app/electron/workers/crawlerWorker.cjs`
- `/Users/yook/Documents/PW/app/electron/workers/parserBatchWorker.cjs`

So it is not dead weight. Removing it would change crawler/rendering behavior.

### 7. `asarUnpack` is oversized and contains packaging/build junk

File: `/Users/yook/Documents/PW/app/electron-builder.json5`

The current `asarUnpack` list is very large and includes things that should not be shipped as unpacked runtime assets.

From the built app we can see unpacked content such as:

- `@vscode/sqlite3` build sources and artifacts
- `prebuild-install`
- `node-addon-api`
- `@img`
- a long chain of transitive packages

This is a strong signal that unpack rules are too broad.

The repo already contains:

- `/Users/yook/Documents/PW/app/scripts/scan-worker-deps.cjs`

That script is a good basis for replacing the hand-maintained giant allowlist with a smaller generated list.

### 8. Windows targets are generating extra build cost

File: `/Users/yook/Documents/PW/app/electron-builder.json5`

Current Windows targets:

- `nsis` for `x64`
- `nsis` for `ia32`
- `portable` for `x64`

If there is no real business need for:

- 32-bit Windows
- portable distribution

then both are pure cost multipliers:

- more CI time
- more artifacts
- more S3 storage
- more QA surface

This is a product decision, not a technical cleanup only.

## Safe changes to make first

These are the changes with the best risk/reward ratio.

### Priority 1: remove dead runtime dependencies

From `dependencies`, remove:

- `axios`
- `express`
- `cors`
- `body-parser`
- `http`
- `@electron/asar`
- `@vscode/sqlite3`

Expected result:

- smaller install
- smaller package
- fewer accidental transitive modules in `app.asar`

### Priority 2: move non-runtime packages out of `dependencies`

- move `sharp` to `devDependencies`
- move `phpmorphy` to `devDependencies` only if those test scripts still matter; otherwise remove it completely

Expected result:

- immediate reduction in packaged dependency set
- easier runtime dependency reasoning

### Priority 3: tighten `electron-builder.files`

Replace the broad `node_modules/**/*` approach with a curated runtime include list.

Recommended direction:

1. keep `dist`
2. keep `dist-electron`
3. keep explicit worker files
4. include only required runtime packages
5. generate part of that list from `scan-worker-deps.cjs`

This is the single highest-impact structural improvement.

### Priority 4: shrink `asarUnpack`

Keep unpacking only:

- worker files that must be spawnable outside ASAR
- native `.node` binaries that truly require unpacking
- a minimal set of modules that break inside ASAR

Remove broad unpack entries that are only build/install helpers.

### Priority 5: replace `moment`

Replace with:

- native formatter helper, or
- `dayjs`

This is low-risk cleanup and saves some weight.

## Recommended target state

### Runtime dependencies that likely remain

- `better-sqlite3`
- `bindings`
- `cheerio`
- `electron-updater`
- `element-plus`
- `file-uri-to-path`
- `jsdom`
- `pinia`
- `playwright-chromium`
- `simplecrawler`
- `validator`
- `vue`
- `vue-i18n`
- `xlsx`

### Dependencies to remove or move

- remove:
  - `axios`
  - `express`
  - `cors`
  - `body-parser`
  - `http`
  - `@electron/asar`
  - `@vscode/sqlite3`
- move to dev:
  - `sharp`
  - `phpmorphy` if test-only
- replace:
  - `moment`

## Expected impact

Conservative expected gains without changing product behavior:

1. Dependency cleanup only:
   - notable reduction in local install size
   - cleaner production dependency graph

2. Packaging cleanup (`files` + `asarUnpack`):
   - likely the largest win
   - should reduce both final app size and build time materially

3. Target cleanup:
   - if `ia32` and `portable` are dropped, Windows build cost falls significantly

## Suggested implementation order

### Iteration 1

- remove dead runtime dependencies
- move `sharp`
- move or remove `phpmorphy`
- verify app still builds and starts

### Iteration 2

- replace `node_modules/**/*` with a curated runtime module list
- reduce `asarUnpack`
- inspect the new packaged app size

### Iteration 3

- replace `moment`
- decide on Windows `ia32` and `portable`

## Do not change yet without a deliberate product decision

- `playwright-chromium`
- `simplecrawler`
- `cheerio`
- `jsdom`
- `xlsx`
- macOS ZIP artifact if auto-update still needs it

These can be optimized later, but they currently map to real features.

## Bottom line

The safest high-value wins are:

1. clean dead runtime dependencies
2. move build-only packages out of runtime deps
3. stop packaging all of `node_modules`
4. shrink `asarUnpack`

If we do only those steps carefully, we should get a noticeably lighter build without losing app quality.
