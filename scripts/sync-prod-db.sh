#!/usr/bin/env bash
set -euo pipefail

# ─── Skip if SKIP_DB_SYNC is set ───
if [[ "${SKIP_DB_SYNC:-}" == "1" ]]; then
  echo "⏭  SKIP_DB_SYNC=1 — skipping prod DB sync"
  exit 0
fi

echo "🔄 Syncing production database to local..."

# ─── Ensure local Postgres is running ───
if ! docker ps --format '{{.Names}}' | grep -q '^sotto-postgres$'; then
  echo "📦 Local Postgres not running — starting docker-compose..."
  docker-compose -f "$(dirname "$0")/../docker-compose.yml" up -d postgres
  echo "⏳ Waiting for Postgres to be ready..."
  for i in {1..30}; do
    if docker exec sotto-postgres pg_isready -U postgres &>/dev/null; then
      break
    fi
    sleep 1
  done
fi

# ─── Dump prod DB via SSH ───
DUMP_FILE="/tmp/sotto-prod.sql.gz"

echo "📡 Dumping production database via SSH..."
if ! ssh sotto-prod "docker exec sotto-prod-postgres pg_dump -U sotto sotto" | gzip > "$DUMP_FILE"; then
  echo "⚠️  SSH dump failed — continuing without sync (prod may be unreachable)"
  exit 0
fi

# ─── Verify dump isn't empty ───
if [[ ! -s "$DUMP_FILE" ]]; then
  echo "⚠️  Dump file is empty — skipping restore"
  exit 0
fi

# ─── Restore locally ───
LOCAL_DB="postgresql://postgres:postgres@localhost:5432/sotto"

echo "🗑  Dropping local schema..."
psql "$LOCAL_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null

echo "📥 Restoring production dump..."
gunzip -c "$DUMP_FILE" | psql "$LOCAL_DB" --quiet 2>/dev/null

echo "🔧 Regenerating Prisma client..."
npx prisma generate --schema=apps/web/prisma/schema.prisma

# ─── Cleanup ───
rm -f "$DUMP_FILE"

echo "✅ Production database synced successfully"
