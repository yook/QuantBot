# QuantBot

Инструмент для краулинга и анализа сайтов с использованием Vue 3, TypeScript и Electron.

## Установка

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
