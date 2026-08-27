# Shopify Locale Translator

Production-oriented Shopify app for translating theme locale JSON inside an authenticated embedded app. It uses the Admin GraphQL theme files API, Prisma-owned snapshots and durable jobs, Gemini structured output, and Polaris web components.

## Features

- Lists store themes and enabled `shopLocales`.
- Reads and publishes storefront and schema files under `locales/*.json`.
- Flattens nested string leaves into editable keys.
- Saves manual translations, translates one key, or runs a resumable bulk translation job.
- Validates Liquid, `{{ }}`, `%{ }`, and HTML tokens before accepting output.
- Persists snapshots, progress, errors, and Gemini usage metadata in Prisma.
- Stores a separate encrypted Gemini API key, allowed model, and bounded batch size per shop.
- Handles mandatory privacy webhooks and removes shop-owned settings, jobs, and workspaces.

## Local setup

Requirements: Node.js matching `package.json`, Shopify CLI, a Shopify Partner account, and a development store.

```bash
cp .env.example .env
npm install
npm run setup
npm run dev
```

Shopify CLI supplies Shopify credentials and the tunnel URL during local development. The requested scopes are `read_themes`, `write_themes`, and `read_locales`; reinstall after changing scopes. After opening the app, go to **Settings**, enter the shop's Gemini API key, choose an allowed text-capable model and batch size, test it, then save it. Gemini credentials are not read from environment variables.

## Scripts

```bash
npm run setup
npm run test
npm run lint
npm run typecheck
npm run build
```

## Data and security model

`TranslationWorkspace` is uniquely scoped by shop, theme, source file, and target locale. `ShopSettings` is keyed by shop. Gemini API keys are encrypted server-side with AES-256-GCM using a domain-separated SHA-256 key derived from `SHOPIFY_API_SECRET`; plaintext keys are never returned to the browser after submission or written to logs. Rotating `SHOPIFY_API_SECRET` makes existing ciphertext undecryptable, so every shop must re-enter its Gemini key after rotation.

`TranslationJob` belongs to a workspace with cascade deletion. It stores pending keys, status, item totals, model, error, timestamps, a short-lived processing claim, and cumulative `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, and `totalTokenCount`. One unfinished job is allowed per workspace.

Publishing constructs plain locale JSON and writes only the correct target path. A storefront source such as `en.default.json` produces `fr.json`; a schema source such as `en.default.schema.json` produces `fr.schema.json`. Application metadata is never written into Shopify locale JSON.

## Durable Gemini processing

Starting bulk translation only creates a database job. The authenticated client then requests one bounded batch at a time and automatically requests the next while the job is active. Every successful batch atomically persists workspace translations and job progress. No unsafe in-process background task is spawned. If Gemini returns 429 or 5xx, the job pauses without discarding completed work and can be continued. Validation and other failures can be retried after correction.

The app uses Gemini `models.countTokens` when testing configuration and records generation usage from `response.usageMetadata`. Google quotas vary by project, model, billing tier, and may change; review the current Gemini documentation for requests per minute (RPM), tokens per minute (TPM), and requests per day (RPD). Set batch sizes and retry timing below the applicable limits and monitor quota and billing dashboards.

## Operational notes

- Back up the database and theme before bulk publishing.
- Theme writes require merchant approval for `write_themes` and can be subject to Shopify review.
- Gemini validation fails closed if protected tokens change or output keys are omitted.
- SQLite is suitable for local development and one persistent instance. Use managed PostgreSQL or MySQL, and adapt/test migrations, before horizontal scaling.
- Uninstall and shop-redact cleanup delete settings and workspaces; workspace cascade deletion removes jobs.

Detailed setup, deployment, and distribution guidance is in [NEXT_STEPS.md](./NEXT_STEPS.md).
