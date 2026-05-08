# infra/scripts

Operational scripts that live on the deploy host (`myserver`) under
`/usr/local/bin/`. Tracked here so the source of truth is git, not the
filesystem of one box.

## giper-pm-backup.sh

Daily backup runner — postgres dump + MinIO volume tarball, also
mirrored into the MinIO `backups` bucket (separate from `attachments`,
90-day lifecycle).

Install on the host (one-time / on update):

```bash
ssh myserver
sudo install -m 755 /opt/giper-pm/repo/infra/scripts/giper-pm-backup.sh \
  /usr/local/bin/giper-pm-backup.sh
```

Cron entry (already present in `/etc/cron.d/giper-pm-backup`):

```
30 3 * * * root /usr/local/bin/giper-pm-backup.sh >> /var/log/giper-pm-backup.log 2>&1
```

Bucket bootstrap (one-time):

```bash
ACCESS=$(grep '^STORAGE_ACCESS_KEY=' /opt/giper-pm/.env | cut -d= -f2-)
SECRET=$(grep '^STORAGE_SECRET_KEY=' /opt/giper-pm/.env | cut -d= -f2-)
docker run --rm --network giper-pm_default --entrypoint sh minio/mc:latest -c "
  mc alias set g http://minio:9000 '$ACCESS' '$SECRET' >/dev/null
  mc mb -p g/backups
  mc ilm rule add --expire-days 90 g/backups
"
```

Restore:

```bash
# Postgres
docker exec -i giper-pm-postgres-1 \
  pg_restore --clean --if-exists -d giper_pm < /opt/giper-pm/backups/pg-<DATE>.dump

# MinIO (stop minio first!)
docker compose -f /opt/giper-pm/docker-compose.prod.yml stop minio
docker run --rm \
  -v giper-pm_minio_data:/data \
  -v /opt/giper-pm/backups:/backup:ro \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/minio-<DATE>.tar.gz -C /data'
docker compose -f /opt/giper-pm/docker-compose.prod.yml start minio
```

## Off-host durability — TODO

Same disk failure still loses both copies. To get true off-host:

```bash
# add to a separate cron, e.g. 04:30 daily
docker run --rm --network giper-pm_default --entrypoint sh minio/mc:latest -c "
  mc alias set local  http://minio:9000 \"$SRC_AK\" \"$SRC_SK\" >/dev/null
  mc alias set remote https://<r2-account>.r2.cloudflarestorage.com \"$DST_AK\" \"$DST_SK\" >/dev/null
  mc mirror --remove --overwrite local/backups remote/giper-pm-backups
"
```

Requires R2/S3 creds in `.env` (`R2_ACCESS_KEY`, `R2_SECRET_KEY`,
`R2_BUCKET_URL`) — not configured yet.
