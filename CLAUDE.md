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

- **Entry**: `bin/www` loads `.env` (via `app-root-path`) and then requires `app.js`. Modules that read `process.env` at load time (for example, the DB pool in `utils/db.js`) depend on this order. `bin/www` also owns the SIGTERM/SIGINT handler that closes the pool and exits with code 0.
- **Tweet polling only runs when `NODE_ENV=production`**: `app.js` calls `checkNewTweet()` on startup and then every 5 minutes. In development it is disabled. To exercise the pipeline, use `GET /api/testWebhook`, which calls `sendRecentTweet`.
- **Pipeline**: `utils/getTweet.js` holds `checkNewTweet` / `sendRecentTweet` and re-exports the pieces in `utils/twitter/`:
  - `client.js` calls X's internal GraphQL timeline API directly with cookie auth (`TWITTER_AUTH_TOKEN`, `TWITTER_CT0`), plus `x-client-transaction-id` and the feature flags in `utils/twitterFeatures.js`. `parseTimeline.js` turns the response into 마후마후's tweets, newest first.
  - `markdown.js` builds the translated Discord markdown (RT/quote nesting up to `MAX_TWEET_DEPTH`, reply prefix). `embed.js` turns a tweet into embeds and updates the avatar cache in `profile.js` (`getProfileURL`, used for the subscribe message).
  - New tweets are those with an ID above the one stored in the `lastTweet` table. Each one is rendered and passed to `WebhookManager.sendWebhook`.
- **Translation** (`utils/translator.js`): `translateText` tries Gemini, using the system prompt at `prompt/translator.md` with the glossary from `data/glossary.json` substituted into its placeholders. On any error it reports to Sentry and falls back to DeepL with `DEEPL_GLOSSARY_ID`. If both fail it returns `null`. The prompt path is resolved from the file location. The Gemini client is created on first use, and the DeepL `Translator` is reused once created.
- **WebhookManager** (`utils/webhookManager.js`): this is the MariaDB layer and handles Discord fan-out. The connection is held on the instance (`this.db`), so never share an instance between requests. Use `WebhookManager.withConnection(async (m) => ...)`, which creates an instance, gets a connection and always releases it. (`checkNewTweet` still does `getConnection` / `releaseConnection` by hand.) The `webhooks.options` TINYINT is a bitfield: bit 0 = mention role, bit 1 = receive notices, bit 2 = receive LINE posts. Use `getOptions` / `setOptions` to read and write it. `WEBHOOK_TYPE` values (`TWITTER=0`, `NOTI=2`, `LINE=4`, defined in `utils/constants.js`) are the masks used in `options & type = type` to choose recipients.
- **Discord messages** (`utils/discordSender.js`): webhook client creation, mention strings, the subscribe and notice embeds, and the per-recipient payload that `sendWebhook` sends.
- **Shared values**: `utils/constants.js` holds the account ID and handle, logo, bot name, footer, embed colors and LINE values. `routes/messages.js` holds the API response messages, which the frontend shows verbatim. `utils/webhookInput.js` parses and validates the subscription API input.
- **Other inputs** (`routes/api.js`):
  - `/api/line-webhook` accepts LINE posts from an external relay (the Go client in `tools/line-webhook-client`). Requests are Ed25519-signed and checked by `utils/lineSignature.js`. The signature covers the method, the path, `X-Timestamp` (must be within 5 minutes), `X-Nonce` (single use, stored in process memory) and `Content-Digest` (the SHA-256 of the raw body, which `app.js` captures as `req.rawBody` for this path only). Only the public key is kept on the server, in `LINE_SIGNING_PUBLIC_KEY` (SPKI DER as base64, or PEM). If `LINE_SIGNING_KEY_ID` is set, `X-Key-Id` must match it. A missing header or bad signature returns 401, and a missing public key returns 500. Valid requests go through `utils/sendLINE.js`.
  - `/api/sendNoti` broadcasts notices, authorized against `NOTICE_TOKEN_KEY`. Its admin form is served at an obscured path (`/api/wa-you-know-sans-wa-papyrus`).
  - `/api/register`, `/api/edit` and `/api/unregister` manage subscriptions.
- **Error reporting**: `utils/DebugLogger.js` sends errors and info/debug logs to Sentry/GlitchTip (`SENTRY_ENDPOINT`, initialized in `utils/instrument.js`). `DEBUG_WEBHOOK_URL` in `.env` is no longer read by the code.
- **Schema**: `init.sql` is baked into the `mahook-db` image (`dockerfile.mariadb`) and defines the `webhooks`, `notices` and `lastTweet` tables.
- `tools/` holds standalone programs that are not part of the web app: the open-source license page generator and a v2→v3 DB migration (Node, each with its own `package.json`), plus `line-webhook-client`, the Go LINE relay that watches the LINE desktop SQLite DB and sends signed requests to `/api/line-webhook` (`go test ./...`; building it needs cgo for `go-sqlite3`; see its README for key generation).
