#!/usr/bin/env bash
# Schema transitions use the same admitted images, lock and lifecycle primitives.
configure_schema_transition() {
  SCHEMA_TRANSITION=false
  SCHEMA_FENCED=false
  if [ "$#" = 0 ]; then return; fi
  if [ "$#" != 3 ] || [ "$1" != --fenced-schema-migration ]; then
    echo "ERROR: use the explicit schema/deploy.sh entry point for schema changes." >&2
    exit 1
  fi
  SCHEMA_TRANSITION=true
  SCHEMA_REVIEW_FILE="$2"
  SCHEMA_EVIDENCE_FILE="$3"
}

backup_database() {
  echo "=== Backing up the application database ==="
  local database_url="${DIRECT_DATABASE_URL:-$DATABASE_URL}" database_bytes
  database_bytes=$(printf '%s\n' "$database_url" | python3 scripts/deploy/database-command.py size)
  if [[ ! "$database_bytes" =~ ^[0-9]+$ ]] || [ "$database_bytes" -gt "$SOTTO_BACKUP_BYTES" ]; then
    echo "ERROR: database size exceeds the measured backup allowance." >&2
    return 1
  fi
  python3 "$PRODUCTION_CAPACITY_CHECKER" before-switch "${backup_capacity[@]}"
  backup_file="$SOTTO_BACKUP_DIR/${SOTTO_RELEASE_SHA}-${RETENTION_ATTEMPT_KEY}.dump"
  umask 077
  printf '%s\n' "$database_url" | python3 scripts/deploy/database-command.py dump > "$backup_file.partial"
  test -s "$backup_file.partial"
  docker exec -i sotto-prod-postgres pg_restore --file=/dev/null < "$backup_file.partial"
  mv "$backup_file.partial" "$backup_file"
  sha256sum "$backup_file" > "$backup_file.sha256"
  python3 - "$backup_file" <<'BACKUP_SYNC'
import os, sys
for path in (sys.argv[1], sys.argv[1] + '.sha256', os.path.dirname(sys.argv[1])):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
BACKUP_SYNC
  python3 "$PRODUCTION_CAPACITY_CHECKER" before-switch
}

apply_migrations() {
  echo "=== Running database migrations ==="
  docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" run --rm --no-deps --pull never \
    -e DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}" \
    workers-heavy npx --no-install prisma migrate deploy --config=/app/prisma.config.ts
}

install_schema_fence() {
  local hosts="$APP_DOMAIN" status
  if [ -n "$WWW_DOMAIN" ]; then hosts+=", $WWW_DOMAIN"; fi
  printf '%s {\n header Cache-Control "no-store"\n respond "Sotto schema maintenance" 503\n}\n' "$hosts" > "$DEPLOY_STATE_DIR/caddy.schema-fence"
  CADDY_CHANGED=true
  sudo install -m 0644 "$DEPLOY_STATE_DIR/caddy.schema-fence" "$CADDY_SITE_PATH"
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo caddy reload --config /etc/caddy/Caddyfile --force
  status=$(curl -sS --max-time 15 -o "$DEPLOY_STATE_DIR/schema-fence-body.txt" -w '%{http_code}' "${NEXT_PUBLIC_APP_URL%/}/api/v1/health")
  [ "$status" = 503 ] && [ "$(cat "$DEPLOY_STATE_DIR/schema-fence-body.txt")" = 'Sotto schema maintenance' ]
}

retain_schema_fence() {
  echo "Schema transition requires recovery. Retaining maintenance, queues, ownership and deployment lock." >&2
  install_schema_fence || echo "ERROR: HTTP fencing is unconfirmed. Preserve all captured services and evidence." >&2
  queue_control pause candidate > "$DEPLOY_STATE_DIR/schema-repause.json" || echo "ERROR: queue fencing is unconfirmed." >&2
  queue_control observe candidate > "$DEPLOY_STATE_DIR/schema-observed.json" || echo "ERROR: queue observation is unconfirmed." >&2
}

prepare_schema_transition() {
  [ "$OLD_SLOT" != none ] && [ "$PRESERVE_EXISTING_PROVIDER" = true ]
  umask 077
  queue_control snapshot
  # Validate candidate database/Redis identity before fencing or pausing anything.
  queue_control observe candidate > "$DEPLOY_STATE_DIR/schema-connection-proof.json"
  python3 scripts/deploy/compatibility-review.py schema-connections "$IMAGE_OVERRIDES/compatibility-review.json" "$OLD_SLOT" > "$DEPLOY_STATE_DIR/schema-previous-connections.json"
  queue_control database-identity previous > "$DEPLOY_STATE_DIR/schema-previous-database.json"
  queue_control database-identity candidate > "$DEPLOY_STATE_DIR/schema-app-database.json"
  queue_control database-identity candidate-direct > "$DEPLOY_STATE_DIR/schema-direct-database.json"
  python3 scripts/deploy/compatibility-review.py schema-preparation "$DEPLOY_STATE_DIR"
  record_unresolved compatibility-preparation
  SCHEMA_FENCED=true
  install_schema_fence
  QUEUES_PAUSED=true
  queue_control pause
  wait_for_worker_drain drained-all
  python3 scripts/deploy/compatibility-review.py continuity-existing "$IMAGE_OVERRIDES/compatibility-review.json" "$OLD_SLOT"
  local previous_web_container previous_container service
  previous_web_container=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["x-captured-container"])' "$PREVIOUS_APP_IMAGES")
  OLD_SLOT_STOPPED=true
  python3 scripts/deploy/stop-workers.py stop-web "$previous_web_container"
  wait_for_worker_drain drained-all
  WORKERS_CHANGED=true
  for service in workers-heavy workers-pipeline workers-light; do
    wait_for_worker_drain drained-all
    previous_container=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["x-captured-containers"][sys.argv[2]])' "$PREVIOUS_WORKER_IMAGES" "$service")
    python3 scripts/deploy/stop-workers.py stop "$previous_container"
  done
  python3 scripts/deploy/compatibility-review.py continuity-stopped "$IMAGE_OVERRIDES/compatibility-review.json" "$OLD_SLOT" "$DEPLOY_STATE_DIR/schema-stopped.json"
  # This backup includes the final writes accepted before the HTTP fence.
  backup_database
  record_unresolved compatibility-cutover
  COMPATIBILITY_CUTOVER=true
  apply_migrations > "$DEPLOY_STATE_DIR/schema-migration.log" 2>&1
  queue_control established candidate > "$DEPLOY_STATE_DIR/schema-established.json"
  local diff_status=0
  docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" run --rm --no-deps --pull never \
    -e DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}" \
    workers-heavy npx --no-install prisma migrate diff --config=/app/prisma.config.ts \
    --from-config-datasource --to-schema /app/apps/web/prisma/schema.prisma --script --exit-code \
    > "$DEPLOY_STATE_DIR/schema-drift.sql" 2> "$DEPLOY_STATE_DIR/schema-drift.log" || diff_status=$?
  queue_control schema-index candidate > "$DEPLOY_STATE_DIR/schema-index.json"
  python3 scripts/deploy/compatibility-review.py schema-drift "$diff_status" "$DEPLOY_STATE_DIR"
}
