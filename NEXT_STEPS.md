# Следующие шаги

## 1. Shopify Partner и dev store

1. Создайте организацию Shopify Partner и development store с темой Online Store 2.0.
2. Добавьте исходный файл, например `locales/en.default.json`, и при необходимости schema-файл `locales/en.default.schema.json`.
3. Свяжите приложение: `npm run config:link`.
4. Проверьте `client_id` и URL в конфигурации Shopify CLI.
5. Scopes `read_themes,write_themes,read_locales` уже заданы. После изменения scopes выполните deploy и переустановите приложение.
6. Запустите `npm run dev` и откройте embedded app.

Для записи theme files Shopify может потребовать дополнительное одобрение. Перед публичным запуском проверьте актуальные требования к `themeFilesUpsert`.

## 2. Gemini для каждого shop

1. Создайте API key в Google AI Studio в отдельном production-проекте.
2. Откройте страницу **Settings** установленного приложения. Введите ключ, выберите разрешённую text-capable модель и размер batch, выполните **Test configuration**, затем **Save**.
3. Ключ хранится в `ShopSettings` отдельно для каждого shop и шифруется на сервере AES-256-GCM. Ключ шифрования получен из `SHOPIFY_API_SECRET`; отдельная env-переменная не нужна. Plaintext не возвращается в браузер после отправки и не логируется.
4. При rotation `SHOPIFY_API_SECRET` ранее сохранённые ключи расшифровать невозможно. После rotation каждый shop должен повторно ввести Gemini API key.
5. Разрешены `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-flash-lite-latest`, `gemini-flash-latest`.
6. Тест настроек использует `models.countTokens`. Переводы сохраняют `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount` и `totalTokenCount` из `response.usageMetadata`.
7. Лимиты Gemini зависят от модели, проекта и billing tier. Проверьте текущие RPM (requests/minute), TPM (tokens/minute) и RPD (requests/day), настройте quota/billing alerts и выберите безопасный batch size.
8. Проверьте политику обработки данных Google. Не отправляйте персональные данные в prompt.

Gemini key и model больше не являются runtime env-переменными приложения.

## 3. База данных и durable jobs

Локально используется SQLite:

```bash
npm install
npm run setup
```

`TranslationWorkspace` хранит snapshots/statuses по shop/theme/source/target. `ShopSettings` хранит конфигурацию shop. `TranslationJob` связан с workspace через cascade delete и хранит pending keys, progress, status/error, модель и token counters.

Start создаёт job и сразу завершает HTTP request. Embedded client обрабатывает по одному ограниченному batch и автоматически запрашивает следующий. После каждого batch переводы и прогресс сохраняются транзакционно. In-process background work не запускается. Ошибки 429/5xx переводят job в paused; Continue повторяет только незавершённый batch. Остальные ошибки имеют failed status и Retry. Уникальный active key предотвращает два незавершённых job для одного workspace, а shop-scoped запросы предотвращают cross-shop access.

Для production рекомендуется managed PostgreSQL/MySQL:

1. Создайте БД с TLS, backup и point-in-time recovery.
2. Измените Prisma datasource и задайте `DATABASE_URL`.
3. Адаптируйте и протестируйте migration SQL для выбранной СУБД.
4. Запускайте `prisma generate && prisma migrate deploy` один раз до старта новой версии.
5. Настройте retention, monitoring и восстановление из backup.

Не используйте ephemeral SQLite при нескольких репликах или без persistent volume.

## 4. Проверка перед deployment

```bash
npm run setup
npm run test
npm run lint
npm run typecheck
npm run build
```

На копии темы проверьте nested keys, пустые строки, Liquid, placeholders, HTML, Unicode, большие файлы, storefront/schema filenames и sync после изменения source. Проверьте Start/Continue/Retry, восстановление после перезапуска, 429/5xx, uninstall/reinstall, shop redact и невозможность доступа другого shop.

## 5. Deployment

1. Выберите HTTPS-хостинг с постоянным URL и persistent database.
2. Задайте `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`, `NODE_ENV=production`. Gemini secrets задаются продавцами только через Settings.
3. Не встраивайте secrets в image. Ограничьте IAM и подготовьте процесс повторного ввода Gemini keys при rotation Shopify secret.
4. Выполните build и migration deploy до старта сервера.
5. Обновите app/redirect URLs и выполните Shopify deploy.
6. Добавьте health checks, логи без credentials и текстов переводов, error tracking, uptime alerts и метрики Gemini latency/rate limits.
7. Используйте отдельные приложения, БД и ключи для staging/production.

## 6. Distribution и дальнейшая работа

Для App Store подготовьте listing, pricing, support URL, privacy policy, terms и data-retention policy. Проверьте privacy webhooks `customers/data_request`, `customers/redact`, `shop/redact` и uninstall cleanup. Shop settings и workspaces удаляются явно, jobs удаляются cascade.

Перед масштабированием добавьте tenant isolation/integration/E2E tests, audit trail публикаций, RBAC, spend controls, diff preview, theme backup/rollback, pagination, glossary, review workflow и PostgreSQL. Для нескольких реплик замените временную database claim-схему на проверенную distributed queue/worker architecture без потери идемпотентности.
