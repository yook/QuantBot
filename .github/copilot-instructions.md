# Copilot instructions for QuantBot

These rules help AI agents be productive in this repo. Keep responses concise and code-focused.

## Golden rules

- Do not write or scaffold documentation unless explicitly asked. Prefer code and config changes.
- When starting dev workflows, ensure no previous processes are running. If ports are busy (Vite 5173+ or socket 8090), stop/kill prior processes before retrying. macOS tip: `lsof -ti:8090 | xargs kill -9`.

## Architecture (big picture)

- UI (renderer): Vue 3 + TypeScript + Vite
  - Entry: `src/main.ts`; Element Plus registered globally; Pinia for state; `vue-i18n` in `src/i18n.ts`.
  - Components in `src/components`; stores in `src/stores` (notably `project.ts` and `socket-client.ts`).
- Desktop shell: Electron
  - Main process: `electron/main.ts` (built to `dist-electron/main.js`), spawns the socket server as a child process on app ready.
- Realtime backend: Socket.IO server (Node CJS)
  - Entry: `socket/server.cjs` with handler modules `socket/Handler*.cjs`; SQLite used via `socket/db-sqlite.cjs`.
- Typed contracts: `src/types/schema.ts` and `src/types/socket-events.ts` power the typed client in `src/stores/socket-client.ts`.

## Data flow

- Electron starts → spawns `node socket/server.cjs` (default port 8090).
- Frontend connects via `src/stores/socket-client.ts` to `ws://localhost:8090/` and emits/listens to typed events.

## Dev and build

- Dev (app): `npm run dev` (Vite + Electron; Electron main spawns socket server). Avoid running `npm run socket:dev` in parallel or you’ll hit EADDRINUSE:8090.
- Dev (socket only): `npm run socket:dev` for backend isolation.
- Build: `npm run build` (typecheck via `vue-tsc`, Vite build, electron-builder).

## Conventions

- Use `import.meta.env` in renderer code (not `process.env`).
- Keep `socket/*.cjs` as CommonJS to avoid ESM/CJS conflicts (root has `"type": "module"`).
- Add/modify event payloads in `src/types/socket-events.ts` and models in `src/types/schema.ts`; expose them via `TypedSocketClient` methods.
- Use `useI18n()` for text (keys live in `src/i18n.ts`); don’t add local `t()` stubs.
- Global font face configured in `src/style.css` via `--app-font-sans` (Element Plus uses `--el-font-family`).

## Integration points

- Electron ↔ Socket: lifecycle managed in `electron/main.ts` (start/stop child process, log exit codes).
- Socket handlers: register per-connection logic in `socket/Handler*.cjs`.
- DB access: `socket/db-sqlite.cjs` used by handlers.

## Pitfalls and quick fixes

- EADDRINUSE: 8090 → kill old server: `lsof -ti:8090 | xargs kill -9` (macOS). Don’t start multiple `npm run dev` sessions.
- Multiple Vite instances: CLI auto-increments ports; prefer a single session, note the URL in logs.
- Browser env error (process is not defined): stick to `import.meta.env`.

## Examples

- Typed Socket.IO usage: `src/examples/typed-socket-usage.ts`.
- Element Plus + i18n usage: `src/components/AppHeader.vue`, `src/components/AddNewProject.vue`.
