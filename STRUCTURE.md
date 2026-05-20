# STRUCTURE.md

## Общая структура проекта PageViewer

- **electron/** — основной процесс Electron (TypeScript)
  - main.ts — точка входа, инициализация БД, IPC
  - preload.ts — preload-скрипт для безопасной связи renderer ⇄ main
  - db/ — синхронные модули для работы с SQLite (better-sqlite3)
    - index.cjs — фасад: dbGet, dbAll, dbRun, keywords, stopwords, projects, embeddings, typing, categories
    - adapter.cjs — низкоуровневый адаптер SQLite
    - keywords.cjs — CRUD ключевых слов
    - stopwords.cjs — CRUD стоп-слов
    - projects.cjs — CRUD проектов
    - embeddings.cjs — кэш эмбеддингов
    - typing.cjs — CRUD typing samples и моделей
    - categories.cjs — CRUD категорий
  - ipc/ — IPC-хэндлеры
  - managers/ — утилиты и воркеры
  - workers/ — отдельные Node-скрипты (краулер, парсер)

- **src/** — renderer (Vue 3 + TypeScript + Vite)
  - main.ts — точка входа UI
  - i18n.ts — локализация
  - style.css — глобальные стили
  - assets/, components/, config/, crawler/, examples/, stores/, types/, utils/ — логические модули UI

- **build/** — ассеты для сборки (иконки и др.)
- **dist-electron/** — собранные файлы Electron (main.js, preload.mjs и др.)
- **public/** — публичные ассеты
- **release/** — артефакты релизов
- **scripts/** — вспомогательные скрипты (чекеры, тесты, dev-tools)
- **test/** — тесты и отладочные дампы
- **db/** — файлы SQLite и очереди проектов

## Основные технологии

- Electron, Vue 3, TypeScript, Vite, Element Plus, Pinia, vue-i18n, better-sqlite3
- IPC между main и renderer
- Краулинг и парсинг через отдельные Node-воркеры

## Краткая архитектура

- Main process (electron/) управляет жизненным циклом, БД, IPC, воркерами
- Renderer (src/) — UI, состояние, взаимодействие с main через IPC
- БД (electron/db/) — синхронный фасад, все операции через index.cjs
- Воркеры (electron/workers/) — тяжёлые задачи, запускаются как child_process

## Быстрый старт

- npm install
- npm run dev (Vite + Electron)
- npm run build — сборка

## Подробнее см. README.md
