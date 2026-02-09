#!/bin/bash
# Sotto — Daily PostgreSQL Backup
#
# Install to crontab:
#   (crontab -l 2>/dev/null; echo "0 3 * * * /home/sotto/sotto/scripts/backup.sh") | crontab -

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
CONTAINER="${CONTAINER:-sotto-prod-postgres}"
DB_USER="${DB_USER:-sotto}"
DB_NAME="${DB_NAME:-sotto}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/sotto_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date)] Backup complete: $BACKUP_FILE ($SIZE)"

# Remove backups older than retention period
DELETED=$(find "$BACKUP_DIR" -name "sotto_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] Cleaned up $DELETED old backup(s)"
fi
