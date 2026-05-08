#!/usr/bin/env bash
# Daily backups for giper-pm. Postgres dump + MinIO volume tarball.
# Local retention: 14 days in /opt/giper-pm/backups.
# Remote copy: same MinIO instance, separate `backups` bucket with a
# 90-day lifecycle (configured once via `mc ilm rule add`). The remote
# copy survives accidental rm -rf on /opt/giper-pm/backups and rolls
# the recovery target out to ~3 months. NOTE: if the underlying disk
# dies, both copies are lost — for true off-host durability, mirror
# the bucket to R2/S3 with a `mc mirror` cron and external creds.
set -euo pipefail
DEST=/opt/giper-pm/backups
DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

ENV_FILE=/opt/giper-pm/.env
STORAGE_ACCESS_KEY="$(grep '^STORAGE_ACCESS_KEY=' "$ENV_FILE" | cut -d= -f2-)"
STORAGE_SECRET_KEY="$(grep '^STORAGE_SECRET_KEY=' "$ENV_FILE" | cut -d= -f2-)"
REMOTE_BUCKET=backups
NETWORK=giper-pm_default

# --- Postgres logical dump (custom format, compressed). Restore with
# `pg_restore --clean --if-exists -d giper_pm <file>`.
PG_FILE="$DEST/pg-$DATE.dump"
docker exec -i giper-pm-postgres-1 \
  pg_dump -U giper -Fc giper_pm \
  > "$PG_FILE"

# --- MinIO volume tarball — bucket data + bookkeeping. Restore by
# stopping minio, replacing /data, restarting.
MINIO_FILE="$DEST/minio-$DATE.tar.gz"
docker run --rm \
  -v giper-pm_minio_data:/data:ro \
  -v "$DEST":/backup \
  alpine tar czf "/backup/minio-$DATE.tar.gz" -C /data .

# --- Push both copies to MinIO `backups` bucket (separate from
# `attachments`). Idempotent — same DATE never repeats within a second.
docker run --rm --network "$NETWORK" \
  -v "$DEST":/backup:ro \
  --entrypoint sh \
  minio/mc:latest -c "
    mc alias set local http://minio:9000 '$STORAGE_ACCESS_KEY' '$STORAGE_SECRET_KEY' >/dev/null
    mc cp /backup/$(basename "$PG_FILE") local/$REMOTE_BUCKET/postgres/
    mc cp /backup/$(basename "$MINIO_FILE") local/$REMOTE_BUCKET/minio/
  " >> /var/log/giper-pm-backup.log

# --- Trim local copies older than 14 days. Remote bucket prunes itself
# via the 90-day lifecycle policy.
find "$DEST" -type f -mtime +14 -delete
