#!/usr/bin/env bash
# Небольшой helper-скрипт для локальной разработки.
# Что делает:
# - безопасно определяет платформу
# - пытается пересобрать нативный биндинг для @vscode/sqlite3
# - использует electron-rebuild, если в окружении доступен electron
# Контракт:
# - вход: запущенный в корне проекта (там, где package.json)
# - выход: 0 при успехе, !=0 при ошибке

set -euo pipefail
IFS=$'\n\t'

die(){
  echo "ERROR: $*" >&2
  exit 1
}

echo "== Rebuild @vscode/sqlite3 helper =="

# Быстрая проверка: есть ли node и npm
command -v node >/dev/null 2>&1 || die "node is required"
command -v npm >/dev/null 2>&1 || die "npm is required"

UNAME=$(uname -s || echo "unknown")
echo "Platform detected: $UNAME"

# Попробуем быстро проверить наличие модуля в node_modules
if node -e "try{require.resolve('@vscode/sqlite3'); console.log('present');}catch(e){process.exit(2)}" 2>/dev/null; then
  echo "@vscode/sqlite3 found in node_modules"
else
  echo "@vscode/sqlite3 not found (will still attempt rebuild/install)"
fi

# Если есть electron в PATH, предпочитаем electron-rebuild
if command -v npx >/dev/null 2>&1 && command -v electron >/dev/null 2>&1; then
  echo "Detected electron binary. Running electron-rebuild for @vscode/sqlite3 (recommended for Electron dev)"
  npx electron-rebuild -f -w @vscode/sqlite3 || die "electron-rebuild failed"
  echo "electron-rebuild finished"
  exit 0
fi

# Иначе выполнить платформо-специфичную команду npm rebuild
case "$UNAME" in
  Darwin)
    echo "macOS detected. Проверяем Xcode Command Line Tools..."
    if ! xcode-select -p >/dev/null 2>&1; then
      echo "Xcode Command Line Tools не установлены. Выполните: xcode-select --install и повторите." >&2
      exit 1
    fi
    echo "Запуск: npm rebuild @vscode/sqlite3 --build-from-source"
    npm rebuild @vscode/sqlite3 --build-from-source || die "npm rebuild failed"
    ;;
  Linux)
    echo "Linux detected. Запуск: npm rebuild @vscode/sqlite3 --build-from-source"
    npm rebuild @vscode/sqlite3 --build-from-source || die "npm rebuild failed"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    echo "Windows-подобная среда обнаружена. Попытка: npm rebuild @vscode/sqlite3 --build-from-source"
    echo "Если команда завершится ошибкой, запустите её в Visual Studio Developer Command Prompt (MSVC) с установленными Build Tools."
    npm rebuild @vscode/sqlite3 --build-from-source || die "npm rebuild failed — попробуйте выполнить из Developer Command Prompt"
    ;;
  *)
    echo "Неизвестная платформа: $UNAME — пробуем npm rebuild как fallback"
    npm rebuild @vscode/sqlite3 --build-from-source || die "npm rebuild failed"
    ;;
esac

echo "Готово. Если всё ещё видите ошибку 'Cannot find module ...vscode-sqlite3.node', попробуйте удалить node_modules и выполнить 'npm ci', затем запустить этот скрипт снова."
exit 0
