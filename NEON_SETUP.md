# Настройка Neon PostgreSQL

## 1. Создание бесплатной базы

1. Зарегистрируйтесь в [Neon](https://console.neon.tech/).
2. Создайте новый project.
3. Выберите регион, ближайший к региону Netlify Functions.
4. Оставьте основную branch `main`.
5. Создайте или выберите database `neondb` и отдельную application role.

Бесплатного тарифа достаточно для разработки и небольшого количества магазинов. Для публичного production-приложения заранее проверьте актуальные лимиты, backups и требования SLA.

## 2. Получение двух connection strings

В Neon Project Dashboard нажмите **Connect**.

### Pooled URL для приложения

Включите **Connection pooling** и скопируйте URL. В hostname обязательно будет `-pooler`:

```text
postgresql://USER:PASSWORD@ep-example-pooler.REGION.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Это значение используется как `DATABASE_URL` в Netlify Functions.

### Direct URL для миграций

Выключите **Connection pooling** и скопируйте второй URL. В hostname не должно быть `-pooler`:

```text
postgresql://USER:PASSWORD@ep-example.REGION.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Это значение используется как `DIRECT_URL` только во время Prisma migrations.

Не добавляйте connection strings в Git, `netlify.toml`, README, screenshots или Shopify settings.

## 3. Настройка Netlify

Откройте **Netlify → Project configuration → Environment variables** и добавьте:

| Переменная | Значение | Scopes |
| --- | --- | --- |
| `DATABASE_URL` | Pooled Neon URL с `-pooler` | Builds, Functions |
| `DIRECT_URL` | Direct Neon URL без `-pooler` | Builds |
| `SHOPIFY_API_KEY` | Shopify client ID | Builds, Functions |
| `SHOPIFY_API_SECRET` | Shopify client secret | Builds, Functions |
| `SHOPIFY_APP_URL` | `https://YOUR-SITE.netlify.app` | Builds, Functions |
| `SCOPES` | `read_themes,write_themes,read_locales` | Builds, Functions |

Отметьте `DATABASE_URL`, `DIRECT_URL` и `SHOPIFY_API_SECRET` как secret values. `NODE_ENV=production` и Node.js version уже заданы в `netlify.toml`.

Для Deploy Previews используйте отдельную Neon branch и context-specific `DATABASE_URL`/`DIRECT_URL`. Не подключайте preview deploy к production branch.

## 4. Первый deployment

После сохранения переменных запустите **Deploys → Trigger deploy**. Netlify выполнит:

```bash
npm run validate:netlify
prisma generate
prisma migrate deploy
react-router build
```

`validate:netlify` проверяет наличие переменных, HTTPS app URL, pooled/direct Neon hostnames и `sslmode=require`. Миграции используют `DIRECT_URL`, приложение во время запросов использует `DATABASE_URL` через `@prisma/adapter-neon`.

После успешного deploy откройте Neon SQL Editor и убедитесь, что появились таблицы `Session`, `ShopSettings`, `TranslationWorkspace`, `TranslationJob` и `_prisma_migrations`.

## 5. Shopify URL после deployment

Свяжите локальный проект с Shopify app:

```bash
shopify app config link
```

Укажите production URL:

```toml
application_url = "https://YOUR-SITE.netlify.app"
embedded = true

[auth]
redirect_urls = [
  "https://YOUR-SITE.netlify.app/auth/callback"
]
```

Затем примените конфигурацию:

```bash
shopify app deploy
```

Переустановите приложение на development store, если Shopify запросит подтверждение scopes.

## 6. Локальный запуск с Neon

Скопируйте пример переменных:

```bash
cp .env.example .env
```

Заполните pooled и direct URLs, затем выполните:

```bash
npm install
npm run setup
npm run dev
```

Не используйте production branch Neon для локальной разработки. Создайте отдельную branch `development` и получите для неё собственные pooled/direct URLs.

## 7. Проверка подключения

```bash
npm run validate:netlify
npx prisma migrate status
npx prisma studio
```

Если `prisma migrate status` работает, но приложение не подключается, проверьте, что `DATABASE_URL` содержит `-pooler`. Если migrations завершаются ошибкой PgBouncer или prepared statements, проверьте, что `DIRECT_URL` не содержит `-pooler`.

При первом запросе после периода бездействия Neon может запускать compute несколько секунд. Это нормальный cold start бесплатного тарифа.

## 8. Безопасность и эксплуатация

- Используйте отдельную database role с минимально необходимыми правами.
- Не выводите connection strings в логи.
- Настройте alerts и отслеживайте compute, storage и egress.
- Перед изменением schema создавайте migration и проверяйте её на development branch.
- Перед публичным запуском настройте backups и процедуру восстановления.
- При смене `SHOPIFY_API_SECRET` продавцам потребуется повторно сохранить Gemini API keys, потому что этот secret используется для их шифрования.
