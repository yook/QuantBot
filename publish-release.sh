#!/bin/bash

# Скрипт для публикации нового релиза QuantBot
# Использование: ./publish-release.sh [версия] [описание]

set -e  # Остановить скрипт при ошибке

# Параметры по умолчанию
VERSION=${1:-"v1.0.1"}
NOTES=${2:-"Автоматический релиз"}

echo "🚀 Публикация релиза $VERSION"

# 1. Проверить, что билд собран
if [ ! -d "release/1.0.0" ]; then
    echo "❌ Папка release/1.0.0 не найдена. Сначала выполните: npm run build"
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
    echo "gh release create $VERSION release/1.0.0/ --title \"Release $VERSION\" --notes \"$NOTES\""
    exit 0
fi

# 6. Создать релиз на GitHub
echo "📦 Создание релиза на GitHub..."
gh release create "$VERSION" \
    --title "Release $VERSION" \
    --notes "$NOTES" \
    release/1.0.0/*

echo "✅ Релиз $VERSION опубликован!"
echo "🔄 Пользователи получат обновление автоматически при следующем запуске приложения."