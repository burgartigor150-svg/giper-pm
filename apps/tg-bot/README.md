# @giper/tg-bot — multi-bot runner

There is no shared org-wide Telegram bot. Each PM connects their own
[BotFather](https://t.me/BotFather) bot via the giper-pm web UI
(`/integrations/telegram`). This service polls every active
`UserTelegramBot` row in Postgres, decrypting the token at boot.

## Per-bot surface

Each bot reacts to:

- `/start`, `/help` — greet, list commands.
- `/linkproj TG-XXXXXX` — **inside a group/supergroup** where the bot
  is a member: bind this chat to a giper-pm project. The code is
  generated in the web (Интеграции → Telegram) and proves both
  ownership and which bot may consume it.
- `/harvest [N]` — in a linked group: create tasks from the last `N`
  buffered messages (default 25, max 100). The same action is
  available as a button in the web UI.

Buffered messages are stored in `TelegramProjectMessage` as soon as
they arrive in a linked chat (provided the bot's Group Privacy is
**Disabled** in @BotFather → Bot Settings).

## Architecture

```
+----------------+      pub/sub: tg:bots:reload      +----------------+
|  apps/web      |  ───────────────────────────────▶ |  apps/tg-bot   |
|  (Next.js)     |                                   |  (this image)  |
|                |        DATABASE_URL (read)        |                |
|  user pastes   |  ───────────────────────────────▶ |  loads all     |
|  BotFather     |                                   |  active bots,  |
|  token in UI   |  encryptToken() → DB              |  spawns one    |
|                |  publishes reload                 |  Bot per row   |
+----------------+                                   +----------------+
                                                            │
                                                            ▼
                                                       Telegram
                                                       (long-poll)
```

- **No `TG_BOT_TOKEN`** anywhere. The runner only knows the master
  AES-256-GCM key (`TG_TOKEN_ENC_KEY`) and decrypts each bot's token
  on demand.
- Reconciliation: subscribe to Redis channel `tg:bots:reload` (events:
  `add | update | remove`) plus a 60-second safety sweep.
- Each `Bot` instance is per-PM; the project↔chat unique key is
  `(botId, telegramChatId)` — different PMs' bots can sit in different
  groups without clashing.

## Local dev

```bash
pnpm install
cd apps/tg-bot
cp .env.example .env.local
# fill TG_TOKEN_ENC_KEY (32 bytes, hex), DATABASE_URL, REDIS_URL
pnpm dev
```

Then in giper-pm web → Интеграции → Telegram → paste a BotFather
token. The runner picks it up via Redis pub/sub immediately.

## Production deploy

The image is built by `.github/workflows/deploy.yml` (`giper-tg-bot`)
and runs as the `tg-bot` service in
[infra/docker-compose.prod.yml](../../infra/docker-compose.prod.yml).
Required host env in `/opt/giper-pm/.env`:

```
TG_TOKEN_ENC_KEY=<32-byte hex>   # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The same `TG_TOKEN_ENC_KEY` value must be in the `web` service env so
the UI can encrypt newly-pasted tokens with a key the runner can
decrypt.

## Token security

- Stored in `UserTelegramBot.encryptedToken` as `base64(iv|ciphertext|authTag)`.
- The cipher implementation lives in
  [packages/shared/src/tgTokenCrypto.ts](../../packages/shared/src/tgTokenCrypto.ts)
  and is used by both web (encrypt on connect) and runner (decrypt at boot).
- The plain-text token is never returned to the user after the initial
  paste — only `botUsername` is shown.
- Disconnect (UI button) deletes the row, cascading the chat links and
  message buffer.
