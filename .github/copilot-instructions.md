# Copilot instructions for QuantBot

These rules help AI agents be productive in this repo. Keep responses concise and code-focused.
Отвечай по русски.

## Golden rules

- Do not write or scaffold documentation unless explicitly asked. Prefer code and config changes.
- When starting dev workflows, ensure no previous processes are running. If ports are busy (Vite 5173+ or socket 8090), stop/kill prior processes before retrying. macOS tip: `lsof -ti:8090 | xargs kill -9`.
- When starting dev workflows, ensure no previous processes are running. If ports are busy (e.g. Vite dev server), stop/kill prior processes before retrying. macOS tip: `lsof -ti:<port> | xargs kill -9`.

## Architecture (big picture)

- UI (renderer): Vue 3 + TypeScript + Vite
  - Entry: `src/main.ts`; Element Plus registered globally; Pinia for state; `vue-i18n` in `src/i18n.ts`.
  - Components in `src/components`; stores in `src/stores` (notably `project.ts` and `socket-client.ts`).

# Desktop shell: Electron

# - Main process: `electron/main.ts` (built to `dist-electron/main.js`).

# Realtime backend: legacy Socket.IO server was removed during migration — realtime communication is now handled via Electron IPC.

- Typed contracts: `src/types/schema.ts` and `src/types/socket-events.ts` power the typed client in `src/stores/socket-client.ts`.

## Используемые технологии

- Electron (main process на TypeScript)
- Vue 3 + TypeScript + Vite (renderer)
- Element Plus (UI-компоненты)
- Pinia (state management)
- vue-i18n (локализация)
- SQLite через `better-sqlite3` (локальная синхронная БД) и опционально `@vscode/sqlite3`
- Electron IPC (ipcMain / ipcRenderer) для realtime между main и renderer
- Node child_process для запуска worker-скриптов (CommonJS)
- HTTP / API: `express`, `body-parser`, `cors`
- HTTP-клиент: `axios`
- HTML-парсинг: `cheerio`
- Краулинг: `simplecrawler`
- Экспорт Excel: `xlsx`
- Утилиты/валидация: `validator`, `moment`, `keytar`
- Сборка и упаковка: `vite`, `@vitejs/plugin-vue`, `vite-plugin-electron`, `vite-plugin-electron-renderer`, `vue-tsc`, `typescript`, `electron-builder`, `electron-rebuild`, `@electron/asar`
- Стили: `tailwindcss`, `postcss`, `autoprefixer`
- Прочее: `icon-gen`, `bindings`, `electron-updater`

## Data flow

- Electron starts → initializes main process and registers IPC handlers; worker scripts are spawned as child processes when needed.

## Dev and build

- Dev (app): `npm run dev` (Vite + Electron).
- Note: legacy `socket:dev` script and Socket.IO backend were removed; do not run `npm run socket:dev`.
- Build: `npm run build` (typecheck via `vue-tsc`, Vite build, electron-builder).

## Conventions

- Use `import.meta.env` in renderer code (not `process.env`).
- Keep `socket/*.cjs` as CommonJS to avoid ESM/CJS conflicts (root has `"type": "module"`).
- Add/modify event payloads in `src/types/socket-events.ts` and models in `src/types/schema.ts`; expose them via `TypedSocketClient` methods.
- Use `useI18n()` for text (keys live in `src/i18n.ts`); don’t add local `t()` stubs.
- Global font face configured in `src/style.css` via `--app-font-sans` (Element Plus uses `--el-font-family`).

# Integration points

- Electron ↔ IPC: lifecycle and worker orchestration managed in `electron/main.ts` and `electron/ipc`.

## Pitfalls and quick fixes

- EADDRINUSE: kill the process holding the port (macOS example: `lsof -ti:<port> | xargs kill -9`). Don’t start multiple `npm run dev` sessions.
- Multiple Vite instances: CLI auto-increments ports; prefer a single session, note the URL in logs.
- Browser env error (process is not defined): stick to `import.meta.env`.

## Examples

- Examples: `src/examples/` contains small usage snippets and migration notes.
- Element Plus + i18n usage: `src/components/AppHeader.vue`, `src/components/AddNewProject.vue`.

## Release

Пошаговая последовательность патч-релиза (без отдельных скриптов):

1. Определить следующую версию и тег
2. Увеличить версию в `package.json`
3. Стадировать и при необходимости закоммитить изменения:
4. Создать аннотированный тег о описанием изменений на русском
5. Запушить ветку и тег
6. Создать GitHub Release
