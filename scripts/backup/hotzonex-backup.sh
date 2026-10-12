#!/usr/bin/env bash
# Daily copy of the Hotzonex Cloud database (Supabase) into DigitalOcean Spaces.
# Runs on the Droplet from cron; settings come from /etc/hotzonex-backup.env (see README).
#
# Each run makes one file, hotzonex-YYYY-MM-DD_HHMM.tar, holding:
#   public.dump     every Hotzonex table (businesses, routers, plans, vouchers, sales, ...), schema + data
#   auth.dump       the staff logins (auth.users, auth.identities), data only
# Files older than KEEP_DAYS are deleted from the bucket.
set -euo pipefail

ENV_FILE="${HOTZONEX_BACKUP_ENV:-/etc/hotzonex-backup.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${DATABASE_URL:?DATABASE_URL is missing in $ENV_FILE}"
: "${SPACES_BUCKET:?SPACES_BUCKET is missing in $ENV_FILE}"
: "${SPACES_REGION:?SPACES_REGION is missing in $ENV_FILE}"
: "${SPACES_KEY:?SPACES_KEY is missing in $ENV_FILE}"
: "${SPACES_SECRET:?SPACES_SECRET is missing in $ENV_FILE}"
KEEP_DAYS="${KEEP_DAYS:-30}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"

stamp="$(date -u +%Y-%m-%d_%H%M)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077

"$PG_BIN/pg_dump" "$DATABASE_URL" --format=custom --no-owner --no-privileges --schema=public --file="$work/public.dump"
"$PG_BIN/pg_dump" "$DATABASE_URL" --format=custom --no-owner --no-privileges --data-only \
  --table=auth.users --table=auth.identities --file="$work/auth.dump"

# A dump that cannot be read back is not a backup.
"$PG_BIN/pg_restore" --list "$work/public.dump" | grep -q 'TABLE DATA public vouchers'
"$PG_BIN/pg_restore" --list "$work/auth.dump" >/dev/null

file="hotzonex-$stamp.tar"
tar -C "$work" -cf "$work/$file" public.dump auth.dump

s3() {
  s3cmd --access_key="$SPACES_KEY" --secret_key="$SPACES_SECRET" \
    --host="$SPACES_REGION.digitaloceanspaces.com" \
    --host-bucket="%(bucket)s.$SPACES_REGION.digitaloceanspaces.com" "$@"
}

s3 put --acl-private "$work/$file" "s3://$SPACES_BUCKET/db/$file" >/dev/null

# Keep KEEP_DAYS days; the newest file is never deleted.
cutoff="$(date -u -d "-$KEEP_DAYS days" +%Y-%m-%d)"
s3 ls "s3://$SPACES_BUCKET/db/" | awk '{print $4}' | grep -E '/hotzonex-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}\.tar$' | sort | head -n -1 |
  while read -r old; do
    day="$(basename "$old" | cut -c10-19)"
    if [[ "$day" < "$cutoff" ]]; then s3 del "$old" >/dev/null; fi
  done

echo "$(date -u +%FT%TZ) backup ok: $file ($(du -h "$work/$file" | cut -f1))"
