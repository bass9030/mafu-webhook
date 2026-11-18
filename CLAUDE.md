# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

마훅 (mahook): an Express 5 + EJS service that polls 마후마후's (@uni_mafumafu) X/Twitter timeline, translates new tweets from Japanese to Korean (Gemini first, DeepL as fallback), and posts them as Discord embeds to every webhook users have registered. User-facing strings, comments, and commit messages are in Korean. Commit messages use the `수정: ...` prefix style.

## Commands

There is no build step or linter.

- `npm test`: runs the characterization tests in `test/` (`node:test`, no extra deps, no DB or network needed). `test/helpers/stub.js` swaps external modules (mariadb, discord.js `WebhookClient`, Gemini, DeepL, Sentry, `fetch`) via `require.cache`, so `installStubs()` must run before any app module is required. Tests marked `[현재 동작]` lock in known bugs on purpose; change those expectations only when deliberately fixing the bug. Snapshots live in `test/__snapshots__/`; regenerate with `UPDATE_SNAPSHOTS=1 npm test` (a missing snapshot fails instead of being created).

- `npm start`: runs `nodemon ./bin/www` locally (watches `.js`/`.ejs` per `nodemon.json`). Needs a reachable MariaDB and a populated `.env`.
- `./run.sh`: the usual dev loop. It runs `docker compose -f docker-compose-dev.yaml up --build --watch` (web + MariaDB; `app.js`, `utils/` and `routes/` sync and restart, `views/` and `public/` sync only).
- `docker-compose-db-debug.yaml`: starts only MariaDB on host port 3306, for running the app via `npm start` against it.
- `./build-image.sh`: builds the production `mahook-web` / `mahook-db` images.
- `node data/uploadGlossary.js`: replaces the DeepL glossary from `data/glossary.json`. Afterwards, update `DEEPL_GLOSSARY_ID` in `.env`.

Deployment: pushing to the `production` branch triggers `.github/workflows/deploy.yaml`, which builds both images, copies them to the server over Tailscale, and restarts `docker-compose.yaml` there.

## Architecture

- **Entry**: `bin/www` loads `.env` (via `app-root-path`) and then requires `app.js`. Modules that read `process.env` at load time (for example, the DB pool in `utils/webhookManager.js`) depend on this order.
- **Tweet polling only runs when `NODE_ENV=production`**: `app.js` calls `checkNewTweet()` on startup and then every 5 minutes. In development it is disabled. To exercise the pipeline, use `GET /api/testWebhook`, which calls `sendRecentTweet`.
- **Pipeline** (`utils/getTweet.js`): it calls X's internal GraphQL timeline API directly with cookie auth (`TWITTER_AUTH_TOKEN`, `TWITTER_CT0`), plus `x-client-transaction-id` and the feature flags in `utils/twitterFeatures.js`. New tweets are those with an ID above the one stored in the `lastTweet` table. Each tweet, including quoted tweets up to `MAX_TWEET_DEPTH`, is translated and rendered as an embed, then passed to `WebhookManager.sendWebhook`.
- **Translation** (`utils/translator.js`): `translateText` tries Gemini, using the system prompt at `prompt/translator.md` with the glossary from `data/glossary.json` substituted into its placeholders. On any error it logs to the debug webhook and falls back to DeepL with `DEEPL_GLOSSARY_ID`. The prompt file is read with a cwd-relative path, so the process must start from the repo root.
- **WebhookManager** (`utils/webhookManager.js`): this is the MariaDB layer (one pool per module) and handles Discord fan-out. Callers must `await getConnection()` before any query and `releaseConnection()` afterwards. The connection is held on the instance (`this.db`). The `webhooks.options` TINYINT is a bitfield: bit 0 = mention role, bit 1 = receive notices, bit 2 = receive LINE posts. Use `getOptions` / `setOptions` to read and write it. `WEBHOOK_TYPE` values (`TWITTER=0`, `NOTI=2`, `LINE=4`) are the masks used in `options & type = type` to choose recipients.
- **Other inputs** (`routes/api.js`):
  - `/api/line-webhook` accepts LINE posts from an external relay, gated by user-agent `mahook-line/3.0` and a TOTP header (`utils/otpGenerator.js`, `OTP_SECRET`). It then goes through `utils/sendLINE.js`.
  - `/api/sendNoti` broadcasts notices, authorized against `NOTICE_TOKEN_KEY`. Its admin form is served at an obscured path (`/api/wa-you-know-sans-wa-papyrus`).
  - `/api/register`, `/api/edit` and `/api/unregister` manage subscriptions.
- **Error reporting**: errors go to Sentry/GlitchTip (`SENTRY_ENDPOINT`), and `utils/DebugLogger.js` posts them to a Discord channel (`DEBUG_WEBHOOK_URL`).
- **Schema**: `init.sql` is baked into the `mahook-db` image (`dockerfile.mariadb`) and defines the `webhooks`, `notices` and `lastTweet` tables.
- `tools/` holds standalone one-off scripts, each with its own `package.json`: the open-source license page generator and a v2→v3 DB migration.
