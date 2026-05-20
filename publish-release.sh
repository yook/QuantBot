#!/bin/bash

# Скрипт для публикации нового релиза PageViewer
# Использование: ./publish-release.sh [версия] [описание]

set -e  # Остановить скрипт при ошибке

# Параметры по умолчанию
VERSION=${1:-"v1.0.1"}
NOTES=${2:-"Автоматический релиз"}

# Убрать 'v' из версии для папки релиза
RELEASE_VERSION=${VERSION#v}
RELEASE_DIR="release/$RELEASE_VERSION"

echo "🚀 Публикация релиза $VERSION (папка: $RELEASE_DIR)"

# 1. Проверить, что билд собран
if [ ! -d "$RELEASE_DIR" ]; then
    echo "❌ Папка $RELEASE_DIR не найдена. Сначала выполните: npm run build"
    exit 1
fi

# 2. Добавить изменения в git
echo "📝 Добавление изменений в git..."
git add .
git commit -m "Release $VERSION" || echo "⚠️  Нет изменений для коммита"

# 3. Создать тег
echo "🏷️  Создание тега $VERSION..."
git tag -f "$VERSION"

# 4. Отправить изменения и тег на GitHub
echo "📤 Отправка на GitHub..."
git push
git push origin "$VERSION"

# 5. Проверить наличие GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI не установлен. Установите его: https://cli.github.com/"
    echo "📋 После установки выполните вручную:"
    echo "gh release create $VERSION --title \"Release $VERSION\" --notes \"$NOTES\" \$(find $RELEASE_DIR -type f \( -name \"*.dmg\" -o -name \"*.yml\" -o -name \"*.blockmap\" \))"
    exit 0
fi

# 6. Найти файлы для загрузки (только файлы, не папки)
RELEASE_FILES=$(find "$RELEASE_DIR" -type f \( -name "*.dmg" -o -name "*.yml" -o -name "*.blockmap" \))

if [ -z "$RELEASE_FILES" ]; then
    echo "❌ Не найдены файлы для загрузки в $RELEASE_DIR"
    exit 1
fi

# 7. Создать релиз на GitHub
echo "📦 Создание релиза на GitHub..."
gh release create "$VERSION" \
    --title "Release $VERSION" \
    --notes "$NOTES" \
    $RELEASE_FILES

echo "✅ Релиз $VERSION опубликован!"
echo "🔄 Пользователи получат обновление автоматически при следующем запуске приложения."#!/bin/bash

# Скрипт для публикации нового релиза PageViewer
# Использование: ./publish-release.sh [версия] [описание]

set -e  # Остановить скрипт при ошибке

# Параметры по умолчанию
VERSION=${1:-"v1.0.1"}
NOTES=${2:-"Автоматический релиз"}

# Убрать 'v' из версии для папки релиза
RELEASE_VERSION=${VERSION#v}
RELEASE_DIR="release/$RELEASE_VERSION"

echo "🚀 Публикация релиза $VERSION (папка: $RELEASE_DIR)"

# 1. Проверить, что билд собран
if [ ! -d "$RELEASE_DIR" ]; then
    echo "❌ Папка $RELEASE_DIR не найдена. Сначала выполните: npm run build"
    exit 1
fi

# 2. Добавить изменения в git
echo "📝 Добавление изменений в git..."
git add .
git commit -m "Release $VERSION" || echo "⚠️  Нет изменений для коммита"

# 3. Создать тег
echo "🏷️  Создание тега $VERSION..."
git tag -f "$VERSION"

# 4. Отправить изменения и тег на GitHub
echo "📤 Отправка на GitHub..."
git push
git push origin "$VERSION"

# 5. Проверить наличие GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI не установлен. Установите его: https://cli.github.com/"
    echo "📋 После установки выполните вручную:"
    echo "gh release create $VERSION --title \"Release $VERSION\" --notes \"$NOTES\" \$(find $RELEASE_DIR -type f \( -name \"*.dmg\" -o -name \"*.yml\" -o -name \"*.blockmap\" \))"
    exit 0
fi

# 6. Найти файлы для загрузки (только файлы, не папки)
RELEASE_FILES=$(find "$RELEASE_DIR" -type f \( -name "*.dmg" -o -name "*.yml" -o -name "*.blockmap" \))

if [ -z "$RELEASE_FILES" ]; then
    echo "❌ Не найдены файлы для загрузки в $RELEASE_DIR"
    exit 1
fi

# 7. Создать релиз на GitHub
echo "📦 Создание релиза на GitHub..."
gh release create "$VERSION" \
    --title "Release $VERSION" \
    --notes "$NOTES" \
    $RELEASE_FILES

echo "✅ Релиз $VERSION опубликован!"
echo "🔄 Пользователи получат обновление автоматически при следующем запуске приложения."