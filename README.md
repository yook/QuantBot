# QuantBot

Инструмент для краулинга и анализа сайтов с использованием Vue 3, TypeScript и Electron.

## Установка

## Структура проекта (кратко)

Ниже — краткое описание ключевых папок и файлов репозитория и их предназначение.

- `electron/` — код основного процесса Electron (TypeScript). Создаёт окно, инициализирует БД, регистрирует IPC-хэндлеры.

  - `electron/main.ts` — точка входа main-процесса. Вызывает инициализацию БД и регистрирует IPC через `electron/ipc`.
  - `electron/preload.ts` — preload-скрипт для безопасной связи renderer ⇄ main.

- `electron/db/` — синхронные CommonJS-модули и фасад для работы с SQLite (better-sqlite3). Основная бизнес-логика доступа к БД вынесена сюда.

  - `electron/db/index.cjs` — центральный фасад: экспортирует `dbGet`, `dbAll`, `dbRun`, `dbPath` и группы по доменам: `keywords`, `stopwords`, `projects`, `embeddings`, `typing`, `categories`.
  - `electron/db/adapter.cjs` — низкоуровневый адаптер работы с SQLite (реализация `dbGet`, `dbAll`, `dbRun`, инициализация/PRAGMA и утилиты). На него зависят остальные модули из `electron/db` (keywords, stopwords, projects и т.д.).
  - `electron/db/keywords.cjs` — функции для CRUD и массовых операций с ключевыми словами.
  - `electron/db/stopwords.cjs` — функции для управления стоп-словами проекта.
  - `electron/db/projects.cjs` — операции над проектами (создание/обновление/удаление/получение).
  - `electron/db/embeddings.cjs` — кэш эмбеддингов, attaching эмбеддингов к ключевым словам и сохранение/чтение кэша.
  - `electron/db/typing.cjs` — хранение и управление typing samples и моделей для классификации по примерам.
  - `electron/db/categories.cjs` — управление категориями.

- `worker/` — отдельные исполняемые Node-скрипты (CommonJS) для тяжёлых задач (кластеризация, классификация, присвоение категорий и т.д.). Они запускаются как child process и используют фасад `electron/db/index.cjs`.

- `src/` — код renderer (Vue 3 + TypeScript + Vite): UI, компоненты, сторы Pinia, i18n.

- `socket/` — устаревший код Socket.IO. Во время миграции содержимое было удалено из источников; логика доступа к БД перенесена в `electron/db` и доступна через фасад. (Если вы видите ссылки в документации — они могут быть историческими.)

## Ключевые модули и основные функции (объяснение на уровне API)

Ниже перечислены важные модули фасада `electron/db` и назначение основных функций, чтобы быстро понять, что делает каждая часть.

Общая контрактная заметка:

- `dbGet(sql, params?)` — выполняет одиночный SELECT, возвращает одну строку или `undefined`.
- `dbAll(sql, params?)` — выполняет SELECT, возвращает массив строк.
- `dbRun(sql, params?)` — выполняет INSERT/UPDATE/DELETE/PRAGMA/BEGIN/COMMIT/ROLLBACK; возвращает объект со свойствами вроде `lastID` и `changes` (совместимо с better-sqlite3 wrapper).

### `electron/db/projects.cjs`

- `projectsFindOneById(id)` — возвращает один проект с десериализацией полей (`crawler`, `parser`, `columns`) и дополняет `stats` (очереди/фетчи и т.д.).
- `projectsFindAll()` — возвращает все проекты (с десериализацией полей).
- `projectsInsert(doc)` — вставляет проект (нормализация полей) и возвращает вставленную запись.
- `projectsUpdate(doc)` — частичное обновление полей проекта; возвращает обновлённый проект.
- `projectsRemove(id)` — удаляет проект по id.

### `electron/db/keywords.cjs`

- `keywordsFindByProject(projectId, options)` — гибкий поиск ключевых слов по проекту с поддержкой фильтров, пагинации и сортировки.
- `keywordsCountByProject(projectId, query)` — считает ключевые слова с учётом фильтра (например `target:1`).
- `keywordsInsert(projectId, keyword, createdAt?)` — нормализует и вставляет одно ключевое слово; при успехе вызывает применение стоп-слов.
- `keywordsInsertBatch(projectId, keywords, createdAt?, onProgress?)` — атомарная пакетная вставка: фильтрация дубликатов, батчи, транзакции, прогресс-коллбеки; в конце вызывает применение стоп-слов.
- `keywordsApplyStopWords(projectId)` — ключевая функция: применяет стоп-слова проекта к ключевым словам.
  - Поведение: читает `stop_words` для проекта, разделяет стоп-слова на plain и regex; сначала сбрасывает все ключевые слова в allowed (target_query=1), затем помечает неподходящие как blocked (target_query=0) и записывает `blocking_rule` — для regex-правил выполняет локальное тестирование RegExp и обновляет найденные id пакетно.
  - Возвращает `{ updated: number }` — количество обновлённых записей.
- `keywordsRemove(projectId, keyword)` — удаляет ключевое слово.
- `keywordsClear(projectId)` — удаляет все ключевые слова проекта.

### `electron/db/stopwords.cjs`

- `stopWordsFindByProject(projectId, options)` — возвращает список стоп-слов проекта с общей метрикой `total` и пагинацией.
- `stopWordsInsertBatch(projectId, words, createdAt?)` — вставляет список стоп-слов (поддерживает regex-паттерны `/pat/flags`), нормализует обычные слова в lower-case и игнорирует пустые/дубликаты.
- `stopWordsRemove(projectId, word)` — удаляет стоп-слово; если слово похоже на regex, удаляет точную запись, иначе делает case-insensitive удаление.
- `stopWordsClear(projectId)` — очищает все стоп-слова проекта.

### `electron/db/embeddings.cjs`

- `embeddingsCacheGet(key, vectorModel)` — возвращает кэшированную в БД эмбеддингу запись по ключу (ключ — обычно текст) и модели.
- `embeddingsCachePut(key, embedding, vectorModel)` — сохраняет эмбеддинг в кэш (обычно как BLOB/JSON) с привязкой к `vectorModel`.
- `attachEmbeddingsToKeywords(keywords, opts)` — для массива ключевых слов собирает/получает эмбеддинги (из кэша или через провайдера), возвращает структуру keywords с полями `embedding` и/или `embeddingKey` для последующей работы (кластеризация, cosine-similarity и т.д.).
  - Опции позволяют указать модель эмбеддингов и стратегию кэширования.

### `electron/db/typing.cjs`

- `typingSamplesFindByProject(projectId, options)` — возвращает примеры typing (text/label/embedding) с пагинацией.
- `typingSamplesInsertBatch(projectId, samples)` — пакетная вставка фраз для обучения (разбиение на фразы, удаление дублей, JSON-сериализация embedding).
- `typingSamplesUpdate(id, fields)` / `typingSamplesDelete(id)` / `typingSamplesClear(projectId)` — операции обновления/удаления/очистки. При изменении меток модель может инвалидироваться (удаляется persisted model).
- `updateTypingSampleEmbeddings(projectId, items, vectorModel)` — записывает эмбеддинги для существующих typing_samples в `embeddings_cache`.
- `upsertTypingModel(projectId, payload)` / `getTypingModel(projectId)` / `deleteTypingModel(projectId)` — управление сериализованными моделями/метаданными, используемыми для классификации.

### `electron/db/categories.cjs`

- `categoriesInsert(projectId, categoryName, createdAt?)` — вставляет категорию.
- `categoriesInsertBatch(...)` — пакетная вставка с транзакциями и прогрессом.
- `categoriesFindByProject(projectId, options)` — чтение категорий с пагинацией и сортировкой.
- `categoriesClear(projectId)` / `categoriesDelete(id)` — удаление.

### Общие утилиты и статистика

- `saveData(tableName, projectId, data, socket?)` — универсальная функция записи строки (urls / fetched) с сериализацией динамических полей в `content` JSON; эмитит события в `socket` если он передан.
- `saveError(projectId, data, socket?)` — сохраняет disallowed/error запись и отдаёт обновлённую статистику.
- `getProjectStats(projectId)` / `syncProjectStats(projectId)` — собирают статистику проекта (counts, depth buckets, queue size).
- `getUrlsStats(projectId)` — статистика по типам и по дням.
- `updateProjectQueueStats(projectId, queueSize, socket?)` — сохраняет размер очереди и эмитит через `socket` если передан.
- `getProjectQueueSize(projectId)` — читает сохранённый persisted queue_size из таблицы `projects`.

## Что поменялось по сравнению с legacy `socket/`

- Ранее код сервера находился в `socket/` и использовал `socket/db-sqlite.cjs` как точку доступа к БД. Логика доступа к БД и большинство helper-функций были мигрированы в `electron/db` и экспортированы через фасад `electron/db/index.cjs`.
- Папка `socket/` удалена из источников (она больше не поставляется). Worker-скрипты теперь импортируют `../electron/db/index.cjs` напрямую и не зависят от socket-обёртки.

## Быстрая проверка (smoke test сборки)

1. Установите зависимости: `npm install`
2. Соберите приложение: `npm run build`
3. Если хотите локально запустить dev: `npm run dev` (Vite + Electron). Помните: не запускайте параллельно `npm run socket:dev` — порт по-умолчанию может конфликтовать.

## Дальше — рекомендации

- Если вы хотите окончательно удалить все упоминания о `socket/`, можно пройтись по документации и `examples/` и поправить старые README/комментарии.
- Запустить `npm run build` на CI и проверить, что упакованные worker-файлы лежат в `app.asar.unpacked/worker/` и что native-модули были пересобраны для целевой версии Electron.

Если нужно, могу дополнить этот README подробной документацией по API каждого модуля в виде таблицы или с примерами вызовов (RPC / IPC) — скажите, какой формат вам удобен.

### Скачивание

Скачайте последнюю версию с [GitHub Releases](https://github.com/yook/QuantBot/releases).

### macOS Gatekeeper

При первом запуске macOS может заблокировать приложение с сообщением "Приложение повреждено". Чтобы обойти это:

1. Откройте Терминал
2. Выполните команду:
   ```bash
   xattr -rd com.apple.quarantine /Applications/QuantBot.app
   ```
3. Или альтернативно:
   ```bash
   codesign --force --deep --sign - /Applications/QuantBot.app
   ```

После этого приложение можно будет открыть нормально.

## Разработка

### Рекомендуемая IDE

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

### Скрипты

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки
npm run dev

# Сборка для продакшена
npm run build

# Публикация релиза
./publish-release.sh [версия] [описание]
```

## Автообновление

Приложение автоматически проверяет обновления при запуске и скачивает их в фоне.
