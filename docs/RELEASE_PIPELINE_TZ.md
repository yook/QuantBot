# ТЗ: release pipeline desktop builds -> Timeweb S3 -> beta channel

## Цель

Автоматизировать сборку desktop-приложения в GitHub Actions с публикацией артефакта в Timeweb S3 и автоматической регистрацией релиза в `beta`, без автоматического перевода в `stable`.

## Целевая схема

```text
git tag / workflow_dispatch
  -> GitHub Actions build
  -> smoke-checks артефакта
  -> upload в приватный бакет Timeweb S3
  -> регистрация metadata в backend app_releases как channel=beta
  -> ручная проверка
  -> promote to stable через admin/ui
```

## Основные правила

- сборка публикуется в S3 только после успешного build;
- релиз автоматически создается только в канале `beta`;
- `stable` не переключается из CI автоматически;
- перевод из `beta` в `stable` выполняется вручную через `admin/ui`;
- бакет с дистрибутивами остается приватным;
- скачивание выполняется через backend и presigned URL.

## Функциональные требования

### GitHub Actions

- собирать desktop app по `workflow_dispatch` и/или git tag;
- прогонять минимум:
  - install;
  - typecheck;
  - build/package;
  - проверку наличия артефакта;
  - вычисление `sha256`;
  - вычисление размера файла;
- публиковать только успешный build;
- загружать артефакт в Timeweb S3;
- после upload регистрировать release metadata в backend.

### S3

- использовать приватный бакет Timeweb S3;
- хранить релизы отдельно от backup bucket;
- использовать бакет `b9b6a5eb-48ad-4961-8fbf-6580993d369e`;
- использовать S3 endpoint `https://s3.twcstorage.ru`;
- использовать region `ru-1`;
- при возможности включить versioning бакета.

### Backend metadata

Для каждого релиза должны фиксироваться:

- `version`
- `platform`
- `channel=beta`
- `status`
- `s3Key`
- `fileName`
- `checksumSha256`
- `fileSizeBytes`
- `releaseNotes`
- `isMandatory`
- `minSupportedVersion`

### Admin/UI

- администратор должен видеть beta-релизы;
- администратор должен уметь перевести выбранный релиз в `stable`;
- при promote предыдущий `stable` для этой платформы/канала должен деактивироваться.

## Нефункциональные требования

- не использовать публичный доступ к бакету;
- не хранить long-lived download URL в БД;
- использовать короткоживущий presigned URL для скачивания;
- не переключать `stable` автоматически;
- не делать production release на каждый push в `main`.

## Первая итерация

1. Реализовать рабочие CLI для release metadata в `api`:
   - `release:create`
   - `release:activate`
   - `release:disable`
2. Подготовить GitHub Actions workflow под beta build/upload.
3. Подготовить секреты для Timeweb S3.
4. Подготовить backend flow регистрации beta release.
5. Отдельно реализовать admin/ui promote `beta -> stable`.

## Ожидаемый результат первой итерации

- релиз можно собрать в GitHub Actions;
- артефакт можно положить в Timeweb S3;
- metadata можно зарегистрировать в `app_releases` как `beta`;
- `stable` остается под ручным контролем.

## GitHub Secrets для первой итерации

- `S3_DOWNLOADS_ACCESS_KEY_ID`
- `S3_DOWNLOADS_SECRET_ACCESS_KEY`
- `RELEASE_SSH_HOST`
- `RELEASE_SSH_USER`
- `RELEASE_SSH_PRIVATE_KEY`
- `RELEASE_API_CONTAINER` optional, default `pageviewer-api`

Фиксированные значения для первой итерации:

- `S3 bucket`: `b9b6a5eb-48ad-4961-8fbf-6580993d369e`
- `S3 endpoint`: `https://s3.twcstorage.ru`
- `region`: `ru-1`

Значения, которые должны попасть только в GitHub Secrets и не должны храниться в репозитории:

- `S3_DOWNLOADS_ACCESS_KEY_ID`
- `S3_DOWNLOADS_SECRET_ACCESS_KEY`

Swift credentials в первой итерации не используются.

## Ограничение первой итерации

- `releaseNotes` уже есть в модели backend, но в первой рабочей версии workflow пока не передаются в backend автоматически;
- задача первой итерации — собрать надежный контур `build -> S3 -> beta metadata`;
- передачу release notes можно довязать отдельным коротким шагом после того, как базовый pipeline пройдет end-to-end.
