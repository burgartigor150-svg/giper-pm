# @giper/tg-bot

Telegram bot for giper-pm. Long-polling, no public webhook needed.
Phase 2 of `ROADMAP.md` — minimal viable surface:

- `/start` / `/help` — greet and list commands
- `/pair TG-XXXXXX` — link this chat to a giper-pm User (code from web)
- `/me` — current paired user + active timer
- `/today`, `/week` — sum of hours
- `/stop` — stop the active live timer
- `/log 1.5 GFM-42 fixed bug` — append manual `TimeEntry` (source `TELEGRAM`)
- `/linkproj TG-XXXXXX` — **in a group/supergroup** where the bot is admin/member: bind this chat to a giper-pm **project** (one-time code from web → **Проект → Telegram**). Requires **Group Privacy disabled** for the bot (@BotFather → Bot Settings) so it sees normal chat text.
- `/harvest [N]` — in that linked group: create tasks from the last **N** buffered messages (default 25, max 100). Only messages **after** the bot joined / chat was linked are stored — Telegram does not expose older history to bots.

## Local dev

```bash
pnpm install
cd apps/tg-bot
cp .env.example .env.local
# fill TG_BOT_TOKEN from @BotFather, DATABASE_URL, REDIS_URL
pnpm dev
```

## Mini App (веб внутри Telegram)

Чтобы открывать giper-pm без отдельного логина паролем:

1. На сервере у контейнера **web** должен быть тот же **`TG_BOT_TOKEN`**, что у бота (уже нужен для проверки подписи `initData`).
2. В @BotFather → ваш бот → **Bot Settings → Menu Button** (или **Configure Mini App**): укажите URL  
   `https://<ваш-хост>/telegram/webapp`  
   (ровно HTTPS, домен совпадает с `AUTH_URL` / публичным адресом).
3. Пользователь должен один раз выполнить **`/pair`** и иметь в БД `User.tgChatId` = его Telegram user id (как при обычной привязке).

Открытие Mini App → страница проверяет `Telegram.WebApp.initData` → sessия NextAuth → редирект на `/calendar`.

## Activation in production (3 steps)

The image is intentionally **not built or deployed yet**. To turn it on:

### 1. Get a token

Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the
token. Optional: set commands and description with `/setcommands`,
`/setdescription`.

### 2. Add the env on the host

```bash
ssh myserver
sudo tee -a /opt/giper-pm/.env >/dev/null <<EOF
TG_BOT_TOKEN=<token-from-botfather>
PUBLIC_TG_BOT_USERNAME=<bot-username-without-@>
EOF
```

### 3. Wire CI + compose

In a single PR add:

**a) `.github/workflows/deploy.yml` build matrix entry**:

```yaml
- name: Build & push tg-bot
  uses: docker/build-push-action@v6
  with:
    context: .
    file: Dockerfile.tg-bot
    push: true
    tags: |
      ${{ env.REGISTRY }}/${{ env.IMAGE_OWNER }}/giper-tg-bot:${{ steps.tag.outputs.tag }}
      ${{ env.REGISTRY }}/${{ env.IMAGE_OWNER }}/giper-tg-bot:latest
    cache-from: type=gha,scope=tg-bot
    cache-to: type=gha,scope=tg-bot,mode=max
```

**b) `infra/docker-compose.prod.yml` service**:

```yaml
tg-bot:
  image: ghcr.io/${GHCR_OWNER}/giper-tg-bot:${IMAGE_TAG:-latest}
  restart: unless-stopped
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_started
  environment:
    NODE_ENV: production
    DATABASE_URL: postgresql://${POSTGRES_USER:-giper}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-giper_pm}
    REDIS_URL: redis://redis:6379
    TG_BOT_TOKEN: ${TG_BOT_TOKEN}
    PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}
```

**c) Push to main** — CI builds & deploys; `docker compose up -d`
brings the bot online. From then on the web settings page
(`/settings/integrations/telegram`) shows the pairing button and the
bot picks up `/pair TG-XXXXXX` codes from Redis.

## Pairing flow (already wired in web)

1. User opens `/settings/integrations/telegram`.
2. Clicks "Сгенерировать код" → server action stores
   `tg:pair:<CODE>` → `userId` in Redis with 5-min TTL.
3. User opens `t.me/<bot>?start=TG-<CODE>` → bot reads the Redis key,
   sets `User.tgChatId` + `User.tgUsername`, deletes the key.
