# Deployment runbook — giper-pm на myserver

Прод крутится на `myserver` (81.29.141.119, user `igun2`). CI/CD через GitHub Actions:
push в `main` → собираем три образа (web/ws/migrate) и пушим в GHCR → SSH на сервер,
pull + `docker compose up -d` + `prisma migrate deploy`.

Все артефакты (Dockerfile.web, Dockerfile.ws, Dockerfile.migrate, infra/docker-compose.prod.yml,
infra/Caddyfile, .github/workflows/deploy.yml) уже в репо. Этот файл — про *сервер*
и про *секреты*, которые в репо не лежат.

---

## 0. Что должно быть готово до первого деплоя

- [ ] Приватный GitHub-репо создан и запушен
- [ ] DNS A-запись `pm.giper.fm` (или другой `PUBLIC_HOST`) → `81.29.141.119` *(или используем nip.io: `81-29-141-119.nip.io`)*
- [ ] Доступ по SSH `ssh myserver` работает с твоей машины
- [ ] На сервере свободно ≥10 GB и открыты порты 80/443

---

## 1. Bootstrap сервера (один раз)

```bash
ssh myserver
sudo -i   # пароль: см. ~/.ssh/config или 1password

# 1.1. Docker + compose plugin
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
usermod -aG docker igun2

# 1.2. Firewall — оставляем только 22/80/443
ufw default deny incoming
ufw default allow outgoing
ufw allow 22
ufw allow 80
ufw allow 443
ufw --force enable

# 1.3. Папка стека
mkdir -p /opt/giper-pm
chown -R igun2:igun2 /opt/giper-pm
```

Релогинись в `igun2`, чтобы membership в группе `docker` подхватился (`exit`, `ssh myserver`).

---

## 2. Секреты на сервере

Создаём `.env` в `/opt/giper-pm/` — единственное место, где живут секреты прода.

```bash
ssh myserver
cd /opt/giper-pm

# Сгенерим всё, что генерится:
gen() { openssl rand -base64 32 | tr -d '=+/' | head -c 48; }

cat > .env <<EOF
# === Public ===
PUBLIC_HOST=pm.giper.fm
PUBLIC_BASE_URL=https://pm.giper.fm
PUBLIC_WS_URL=wss://pm.giper.fm/ws
ACME_EMAIL=igor@giper.fm

# === GHCR ===
# Перепишется в момент деплоя GitHub Actions, но без значения compose ругается
GHCR_OWNER=<твой-github-username-or-org>
IMAGE_TAG=latest

# === Postgres ===
POSTGRES_DB=giper_pm
POSTGRES_USER=giper
POSTGRES_PASSWORD=$(gen)

# === Auth ===
AUTH_SECRET=$(gen)

# === Bitrix24 ===
BITRIX24_WEBHOOK_URL=https://giper.bitrix24.ru/rest/<USER_ID>/<TOKEN>/
BITRIX24_INBOUND_SECRET=$(gen)

# === Realtime ===
WS_AUTH_SECRET=$(gen)
WS_PUBLISH_SECRET=$(gen)

# === GitHub webhook (для commit→task linking) ===
GITHUB_WEBHOOK_SECRET=$(gen)

# === Storage (MinIO) ===
STORAGE_ACCESS_KEY=$(gen)
STORAGE_SECRET_KEY=$(gen)
STORAGE_BUCKET=attachments

# === Cron ===
CRON_SECRET=$(gen)
EOF

chmod 600 .env
```

**Bitrix24:** `BITRIX24_WEBHOOK_URL` нужно взять из существующего Bitrix-портала
(админка → разработчикам → Другое → Входящий вебхук). Без него синки и пуши работать не будут.

---

## 3. GHCR pull token

CI пушит в GHCR от имени бота, а сервер должен уметь pull. Делаем fine-grained PAT
с одним правом `read:packages`:

1. https://github.com/settings/tokens?type=beta → **Generate new token**
2. Resource owner = твой юзер (или org, если репо в org)
3. Permissions → Account permissions → **Packages: Read-only**
4. Скопируй токен (показывается один раз)

```bash
ssh myserver
echo "ghp_xxxxxxxxxxxxxxxxxxxx" > /opt/giper-pm/.ghcr-token
chmod 600 /opt/giper-pm/.ghcr-token
```

Деплой-скрипт читает этот файл и логинится в `ghcr.io` перед `docker compose pull`.

---

## 4. GitHub repo settings

В **Settings → Secrets and variables → Actions**:

### Secrets (зашифрованы)
| Name | Value |
|---|---|
| `SSH_HOST` | `81.29.141.119` |
| `SSH_USER` | `igun2` |
| `SSH_PRIVATE_KEY` | содержимое `~/.ssh/id_ed25519_igun_server` (вместе с `-----BEGIN…`/`-----END…`) |

### Variables (видны в логах, не секрет)
| Name | Value |
|---|---|
| `PUBLIC_HOST` | `pm.giper.fm` |

В **Settings → Environments → New environment** создай `production`. Опционально включи
*Required reviewers* — тогда каждый деплой будет ждать твоего ручного approval.

В **Settings → Actions → General** убедись что *Workflow permissions = Read and write*
(нужно чтобы `docker/login-action` пушил в GHCR через `GITHUB_TOKEN`).

---

## 5. Первый деплой

```bash
# Локально
git push origin main
```

Дальше идёшь в **Actions** на GitHub:
1. Workflow `deploy` стартует автоматически
2. Job `build` собирает три образа (~5-7 минут первый раз, потом 1-2 за счёт cache)
3. Job `deploy` ждёт approval (если включил), потом scp + ssh

После того как GitHub показал зелёное, проверяем:

```bash
ssh myserver
cd /opt/giper-pm
docker compose -f docker-compose.prod.yml ps
# Все сервисы должны быть Up (postgres, redis, minio, web, ws, caddy)
# migrate — Exited (0)
docker compose -f docker-compose.prod.yml logs web --tail=50
```

Smoke-test:

```bash
curl -sI https://pm.giper.fm/api/health
# Ожидаем 200
curl -sI https://pm.giper.fm/healthz
# Caddy-уровень
```

Открываем `https://pm.giper.fm` в браузере → должна быть форма логина.

---

## 6. Создание первого пользователя

Magic-link Email-провайдер не работает без SMTP, поэтому первого админа добавляем
руками через Prisma Studio или SQL:

```bash
ssh myserver
cd /opt/giper-pm
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U giper -d giper_pm <<SQL
INSERT INTO "User" (id, email, name, role, "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'igor@giper.fm', 'Igor', 'ADMIN', true, now(), now())
ON CONFLICT (email) DO UPDATE SET role = 'ADMIN', "isActive" = true;
SQL
```

После этого можно логиниться через Google OAuth (тот же email) или magic-link
(если SMTP настроен).

---

## 7. Откат / rollback

Каждый билд тегается `sha-<12-знаков-коммита>` и `latest`. Откат = поставить старый sha
вручную:

```bash
ssh myserver
cd /opt/giper-pm

# Узнаём, что было до текущего
docker images | grep giper-web

# Подменяем тег и поднимаем
export IMAGE_TAG=sha-abc123def456
export GHCR_OWNER=<твой-github>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

**Важно:** откат образа НЕ откатывает миграцию БД. Если новая версия применила
ломающую миграцию, надо отдельно её откатить (`prisma migrate resolve` или
ручной SQL). На практике: пишем миграции expand-then-contract, чтобы старый код
работал на новой схеме.

---

## 8. Ручной запуск миграции

Бывает что `migrate deploy` упал в CI (например, конфликт), а сервисы уже подняты.
Тогда руками:

```bash
ssh myserver
cd /opt/giper-pm
docker compose -f docker-compose.prod.yml run --rm migrate
```

Или через web-контейнер (он содержит Prisma engine):

```bash
docker compose -f docker-compose.prod.yml exec -T web \
  node node_modules/.pnpm/prisma@*/node_modules/prisma/build/index.js \
  migrate deploy --schema packages/db/prisma/schema.prisma
```

---

## 9. Бэкапы

Минимум — снимок Postgres и MinIO раз в сутки. Кладём в `/opt/giper-pm/backups/`,
ротация 14 дней.

```bash
ssh myserver
sudo tee /usr/local/bin/giper-backup.sh >/dev/null <<'BASH'
#!/usr/bin/env bash
set -euo pipefail
DEST=/opt/giper-pm/backups
DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

# Postgres
docker compose -f /opt/giper-pm/docker-compose.prod.yml exec -T postgres \
  pg_dump -U giper giper_pm | gzip > "$DEST/pg-$DATE.sql.gz"

# MinIO — копируем весь том
docker run --rm \
  -v giper-pm_minio_data:/data \
  -v "$DEST":/backup \
  alpine tar czf "/backup/minio-$DATE.tar.gz" -C /data .

# Чистим старше 14 дней
find "$DEST" -type f -mtime +14 -delete
BASH
sudo chmod +x /usr/local/bin/giper-backup.sh

# Cron каждый день в 03:30
echo "30 3 * * * root /usr/local/bin/giper-backup.sh >> /var/log/giper-backup.log 2>&1" \
  | sudo tee /etc/cron.d/giper-backup
```

Off-site копия (в R2/B2/S3) — в roadmap, пока локально.

---

## 10. Траблшутинг

| Симптом | Где смотреть |
|---|---|
| `docker compose pull` 401 unauthorized | `.ghcr-token` истёк или scope не тот → перевыпустить |
| Caddy не выдаёт сертификат | `docker compose logs caddy` — обычно DNS ещё не пропагировался или порт 80 закрыт |
| Web возвращает 502 | `docker compose logs web` — скорее всего миграция не прошла, контейнер упал на старте |
| WS не коннектится | проверь что `PUBLIC_WS_URL=wss://<host>/ws`, Caddy строчка `handle /ws*` присутствует |
| `migrate deploy` падает на P3009 | ручной фикс: `prisma migrate resolve --applied <name>` внутри web-контейнера |
| Диск забит | `docker system df`; чистка: `docker image prune -af --filter "until=72h"` |

---

## 11. Что *не* делать

- Не редактировать `.env` руками без записи в 1Password — потеряешь секрет, восстановить нельзя
- Не запускать `docker compose down -v` — `-v` снесёт тома (postgres/minio/caddy)
- Не пушить `*.env` в git
- Не использовать `latest` тег для отката — он *по определению* подвижный
