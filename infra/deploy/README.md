# Deployment runbook — giper-pm на myserver

Прод крутится на `myserver` (81.29.141.119, user `igun2`, hostname `parser`).

**Важно:** хост общий — на нём уже крутятся `n8n`, `saleor`, `omnisight`, `gparser`,
`pars-giper-ui`, `infrastructure-msgr-*`, `pim*` и другие проекты. Поэтому giper-pm
встаёт *рядом* и **ничего чужого не трогает**:

- Caddy не используем — фронтит хостовой `nginx` (как у соседей)
- Никаких публичных портов в compose — postgres/redis/minio только внутри docker-сети
- `web` и `ws` биндятся на **127.0.0.1:3110 / 127.0.0.1:3111** — наружу торчит только nginx
- Свой Postgres внутри docker-network giper-pm (изолирован от системного `:5432`)

CI/CD: push в `main` → CI собирает три образа (web/ws/migrate) и пушит в GHCR →
SSH на сервер, pull + `docker compose up -d` + `prisma migrate deploy`.

---

## 0. Что должно быть готово до первого деплоя

- [ ] Приватный/публичный GitHub-репо `burgartigor150-svg/giper-pm` (готов)
- [ ] DNS A-запись `pm.since-b24-ru.ru` → `81.29.141.119`
- [ ] Доступ по SSH `ssh myserver` без пароля (готов)
- [ ] На сервере уже есть Docker, nginx, certbot, sudo (проверено)

---

## 1. Подготовка серверной папки и .env (один раз)

```bash
ssh myserver
sudo mkdir -p /opt/giper-pm
sudo chown igun2:igun2 /opt/giper-pm
cd /opt/giper-pm

# .env с секретами. ЕДИНСТВЕННОЕ место где лежат секреты прода.
gen() { openssl rand -base64 32 | tr -d '=+/' | head -c 48; }

cat > .env <<EOF
# === Public ===
PUBLIC_HOST=pm.since-b24-ru.ru
PUBLIC_BASE_URL=https://pm.since-b24-ru.ru
PUBLIC_WS_URL=wss://pm.since-b24-ru.ru/ws

# === GHCR ===
# Перепишется в момент деплоя GitHub Actions, но без значения compose ругается
GHCR_OWNER=burgartigor150-svg
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

# === GitHub webhook ===
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

`BITRIX24_WEBHOOK_URL` нужно взять из существующего Bitrix-портала
(админка → разработчикам → Другое → Входящий вебхук). Без него синки/пуши не работают.

---

## 2. GHCR pull token

CI пушит образы в GHCR от имени бота — серверу нужен fine-grained PAT с одним
правом `read:packages`:

1. https://github.com/settings/tokens?type=beta → **Generate new token**
2. Resource owner: `burgartigor150-svg`
3. Permissions → Account permissions → **Packages: Read-only**
4. Сохрани токен (показывается один раз)

```bash
ssh myserver
echo "ghp_xxxxxxxxxxxxxxxxxxxx" > /opt/giper-pm/.ghcr-token
chmod 600 /opt/giper-pm/.ghcr-token
```

---

## 3. Nginx vhost + TLS

Кладём конфиг (шаблон в репо: `infra/nginx/pm.since-b24-ru.ru.conf`):

```bash
# на твоей машине
scp infra/nginx/pm.since-b24-ru.ru.conf myserver:/tmp/

# на сервере
ssh myserver
sudo mv /tmp/pm.since-b24-ru.ru.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/pm.since-b24-ru.ru.conf \
            /etc/nginx/sites-enabled/pm.since-b24-ru.ru.conf
sudo nginx -t && sudo systemctl reload nginx
```

После того как **DNS прорезался** (`dig +short pm.since-b24-ru.ru` отдаёт
`81.29.141.119`) — выпускаем сертификат:

```bash
sudo certbot --nginx -d pm.since-b24-ru.ru \
  --non-interactive --agree-tos --email igor@giper.fm \
  --redirect
```

Certbot сам допишет `listen 443 ssl;` + `ssl_certificate*` + редирект `80→443`
прямо в наш файл. Renew работает автоматом через системный certbot timer.

---

## 4. GitHub repo settings

В **Settings → Secrets and variables → Actions**:

### Secrets
| Name | Value |
|---|---|
| `SSH_HOST` | `81.29.141.119` |
| `SSH_USER` | `igun2` |
| `SSH_PRIVATE_KEY` | содержимое `~/.ssh/id_ed25519_igun_server` (вместе с `-----BEGIN…`/`-----END…`) |

### Variables
| Name | Value |
|---|---|
| `PUBLIC_HOST` | `pm.since-b24-ru.ru` |

**Settings → Environments → New environment** → `production`. Опционально
включи *Required reviewers* — каждый деплой будет ждать твоего approval.

**Settings → Actions → General** → *Workflow permissions = Read and write*
(нужно чтобы `docker/login-action` пушил в GHCR через `GITHUB_TOKEN`).

---

## 5. Первый деплой

```bash
git push origin main
```

Идём в **Actions** на GitHub:
1. Workflow `deploy` стартует автоматически
2. Job `build` собирает три образа (~5-7 минут первый раз, потом 1-2 за счёт cache)
3. Job `deploy` ждёт approval (если включил), потом scp + ssh

После зелёной галки:

```bash
ssh myserver
cd /opt/giper-pm
docker compose -f docker-compose.prod.yml ps
# postgres/redis/minio/web/ws — Up. migrate — Exited (0).
docker compose -f docker-compose.prod.yml logs web --tail=50
```

Smoke-test:

```bash
# с твоей машины
curl -sI https://pm.since-b24-ru.ru
# ожидаем 200 / 307

# изнутри сервера, без TLS, через loopback
ssh myserver 'curl -sI http://127.0.0.1:3110'
# тоже 200
```

Открываем `https://pm.since-b24-ru.ru` в браузере → форма логина.

---

## 6. Создание первого пользователя

Magic-link Email-провайдер не работает без SMTP — первого админа добавляем
руками через psql:

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

После этого логин через Google OAuth (тот же email) или magic-link если SMTP настроен.

---

## 7. Откат / rollback

Каждый билд тегается `sha-<12-знаков-коммита>` и `latest`. Откат = поставить старый sha:

```bash
ssh myserver
cd /opt/giper-pm
docker images | grep giper-web   # узнаём предыдущий sha
export IMAGE_TAG=sha-abc123def456
export GHCR_OWNER=burgartigor150-svg
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

**Важно:** откат образа НЕ откатывает миграцию БД. Если новая версия применила
ломающую миграцию, надо отдельно её откатить (`prisma migrate resolve` или ручной SQL).
Пишем миграции expand-then-contract, чтобы старый код работал на новой схеме.

---

## 8. Ручной запуск миграции

```bash
ssh myserver
cd /opt/giper-pm
docker compose -f docker-compose.prod.yml run --rm migrate
```

---

## 9. Бэкапы

Минимум — снимок Postgres + MinIO раз в сутки. Кладём в `/opt/giper-pm/backups/`,
ротация 14 дней.

```bash
ssh myserver
sudo tee /usr/local/bin/giper-backup.sh >/dev/null <<'BASH'
#!/usr/bin/env bash
set -euo pipefail
DEST=/opt/giper-pm/backups
DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

docker compose -f /opt/giper-pm/docker-compose.prod.yml exec -T postgres \
  pg_dump -U giper giper_pm | gzip > "$DEST/pg-$DATE.sql.gz"

docker run --rm \
  -v giper-pm_minio_data:/data \
  -v "$DEST":/backup \
  alpine tar czf "/backup/minio-$DATE.tar.gz" -C /data .

find "$DEST" -type f -mtime +14 -delete
BASH
sudo chmod +x /usr/local/bin/giper-backup.sh

echo "30 3 * * * root /usr/local/bin/giper-backup.sh >> /var/log/giper-backup.log 2>&1" \
  | sudo tee /etc/cron.d/giper-backup
```

---

## 10. Траблшутинг

| Симптом | Где смотреть |
|---|---|
| `docker compose pull` 401 unauthorized | `.ghcr-token` истёк или scope не тот → перевыпустить |
| 502 Bad Gateway от nginx | `docker compose ps` — web лёг; `docker compose logs web` |
| Сертификат не выдаётся | DNS ещё не прорезался или порт 80 не доходит до сервера → `dig`, `curl http://pm.since-b24-ru.ru` |
| WS не коннектится | проверь `PUBLIC_WS_URL=wss://pm.since-b24-ru.ru/ws`, в nginx есть `location /ws` с `Upgrade` headers |
| `migrate deploy` падает на P3009 | внутри web-контейнера: `prisma migrate resolve --applied <name>` |
| Диск забит | `docker system df`; `docker image prune -af --filter "until=72h"` |
| Конфликт порта 3110/3111 | другой проект занял; поменять в `docker-compose.prod.yml` *и* в nginx-vhost синхронно |

---

## 11. Что *не* делать

- Не редактировать `.env` без записи в 1Password — потеряешь секрет
- Не запускать `docker compose down -v` — `-v` снесёт тома (postgres/minio)
- Не пушить `*.env` в git
- Не использовать `latest` тег для отката — он подвижный
- Не трогать **другие** docker-compose проекты на этом сервере (`docker compose ls` → 9 чужих стеков)
- Не редактировать чужие nginx vhost'ы в `/etc/nginx/sites-enabled/`
