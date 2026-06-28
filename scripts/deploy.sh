#!/usr/bin/env bash
# Blue-green deploy script for Sotto.
# Runs on the server. Alternates between blue (port 3000) and green (port 3010) slots.
# Caddy health-checks both and routes to whichever is alive.
#
# Usage: bash ~/sotto/scripts/deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SLOT_FILE="$HOME/.sotto-deploy-slot"
COMPOSE_INFRA="docker-compose.infra.yml"
COMPOSE_APP="docker-compose.app.yml"
COMPOSE_WORKERS="docker-compose.workers.yml"
HEALTH_TIMEOUT=120  # seconds to wait for new slot to become healthy
ENV_FILE="${SOTTO_ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_ENV_FILE="$REPO_ROOT/.env"
CADDY_TEMPLATE="$REPO_ROOT/Caddyfile"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name is required in $ENV_FILE"
    exit 1
  fi
}

app_host_from_url() {
  local url="$1"
  case "$url" in
    https://*) ;;
    *)
      echo "ERROR: NEXT_PUBLIC_APP_URL must be an https:// URL for server deploy"
      exit 1
      ;;
  esac

  local host="${url#https://}"
  host="${host%%/*}"

  if [ -z "$host" ] || [ "$host" != "${host// /}" ]; then
    echo "ERROR: NEXT_PUBLIC_APP_URL does not contain a valid host: $url"
    exit 1
  fi

  printf '%s\n' "$host"
}

validate_caddy_host() {
  local name="$1"
  local host="$2"
  if [ -z "$host" ]; then
    return
  fi

  case "$host" in
    http://*|https://*|*/*|*" "*)
      echo "ERROR: $name must be a bare host, not a URL or path: $host"
      exit 1
      ;;
  esac
}

remove_optional_block() {
  local start="$1"
  local end="$2"
  awk -v start="$start" -v end="$end" '
    $0 == start { skip = 1; next }
    $0 == end { skip = 0; next }
    skip != 1 { print }
  '
}

remove_optional_markers() {
  awk '
    $0 == "# BEGIN_OPTIONAL_WWW" { next }
    $0 == "# END_OPTIONAL_WWW" { next }
    { print }
  '
}

render_caddy_config() {
  local app_host="$1"
  local www_host="$2"

  local rendered
  rendered="$(<"$CADDY_TEMPLATE")"
  rendered="${rendered//__SOTTO_APP_DOMAIN__/$app_host}"

  rendered="$(printf '%s\n' "$rendered" | remove_optional_block "# BEGIN_OPTIONAL_MAPS" "# END_OPTIONAL_MAPS")"

  if [ -n "$www_host" ]; then
    rendered="${rendered//__SOTTO_WWW_DOMAIN__/$www_host}"
  else
    rendered="$(printf '%s\n' "$rendered" | remove_optional_block "# BEGIN_OPTIONAL_WWW" "# END_OPTIONAL_WWW")"
  fi

  printf '%s\n' "$rendered" | remove_optional_markers
}

cleanup_stale_caddy_configs() {
  local target_path="$1"
  local target_dir target_base legacy_site_name
  target_dir="$(dirname "$target_path")"
  target_base="$(basename "$target_path")"
  legacy_site_name="sotto"".fm"

  if [ "$target_dir" != "/etc/caddy/conf.d" ]; then
    return
  fi

  sudo find "$target_dir" -maxdepth 1 -type f \
    \( -name "sotto.conf" -o -name "$legacy_site_name" -o -name "sotto.conf.disabled.*" -o -name "$legacy_site_name.disabled.*" \) \
    ! -name "$target_base" \
    -exec rm -f {} +
}

# --- Slot resolution ---

if [ -f "$SLOT_FILE" ]; then
  ACTIVE_SLOT=$(cat "$SLOT_FILE")
else
  ACTIVE_SLOT="none"
fi

if [ "$ACTIVE_SLOT" = "blue" ]; then
  NEW_SLOT="green"
  NEW_WEB_PORT=3010
  OLD_SLOT="blue"
elif [ "$ACTIVE_SLOT" = "green" ]; then
  NEW_SLOT="blue"
  NEW_WEB_PORT=3000
  OLD_SLOT="green"
else
  # First deploy — start with blue
  NEW_SLOT="blue"
  NEW_WEB_PORT=3000
  OLD_SLOT="none"
fi

echo "=== Blue-green deploy ==="
echo "Active slot: $ACTIVE_SLOT"
echo "New slot:    $NEW_SLOT (web=$NEW_WEB_PORT)"

# --- Pull code ---

echo ""
echo "=== Pulling latest code ==="
PREV_SHA=$(git rev-parse --short HEAD)
git pull origin main
git submodule update --init --recursive

# --- Environment ---

echo ""
echo "=== Loading deployment environment ==="
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: deployment env file not found: $ENV_FILE"
  echo "Create it from .env.example, fill every required value, or set SOTTO_ENV_FILE=/path/to/env."
  exit 1
fi

cp "$ENV_FILE" "$COMPOSE_ENV_FILE"
chmod 600 "$COMPOSE_ENV_FILE"
set -a
source "$COMPOSE_ENV_FILE"
set +a
require_env NEXT_PUBLIC_APP_URL

APP_DOMAIN="$(app_host_from_url "$NEXT_PUBLIC_APP_URL")"
WWW_DOMAIN="${SOTTO_WWW_DOMAIN:-}"
CADDY_SITE_PATH="${CADDY_SITE_PATH:-/etc/caddy/conf.d/sotto.conf}"

validate_caddy_host SOTTO_WWW_DOMAIN "$WWW_DOMAIN"

echo "Loaded env file: $ENV_FILE"
echo "App domain:      $APP_DOMAIN"
if [ -n "$WWW_DOMAIN" ]; then
  echo "WWW domain:      $WWW_DOMAIN"
else
  echo "WWW domain:      disabled"
fi

# --- Caddy config ---

echo ""
echo "=== Syncing Caddy config ==="
TMP_CADDY="$(mktemp)"
render_caddy_config "$APP_DOMAIN" "$WWW_DOMAIN" > "$TMP_CADDY"
if grep -q "__SOTTO_\|__sotto_" "$TMP_CADDY"; then
  echo "ERROR: rendered Caddy config still contains Sotto placeholders."
  rm -f "$TMP_CADDY"
  exit 1
fi
cleanup_stale_caddy_configs "$CADDY_SITE_PATH"
sudo install -m 0644 "$TMP_CADDY" "$CADDY_SITE_PATH"
rm -f "$TMP_CADDY"
sudo caddy validate --config /etc/caddy/Caddyfile
sudo caddy reload --config /etc/caddy/Caddyfile --force

# --- Infrastructure ---

echo ""
echo "=== Ensuring infrastructure is running ==="
docker compose -f "$COMPOSE_INFRA" up -d

echo "Waiting for postgres..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_INFRA" exec -T postgres pg_isready -U "${POSTGRES_USER:-sotto}" >/dev/null 2>&1; then
    echo "Postgres ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Postgres not ready after 30s"
    exit 1
  fi
  sleep 1
done

echo "Waiting for redis..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_INFRA" exec -T redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
    echo "Redis ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Redis not ready after 30s"
    exit 1
  fi
  sleep 1
done

echo "Waiting for pgbouncer..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_INFRA" exec -T pgbouncer pg_isready -h 127.0.0.1 -p 5432 -U "${POSTGRES_USER:-sotto}" >/dev/null 2>&1; then
    echo "PgBouncer ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: PgBouncer not ready after 30s"
    exit 1
  fi
  sleep 1
done

# --- Pre-build cleanup (prevent disk exhaustion) ---

echo ""
echo "=== Pre-build cleanup ==="
docker image prune -af --filter "until=24h" 2>/dev/null || true
docker builder prune -af 2>/dev/null || true

# --- Build new slot ---

echo ""
echo "=== Building $NEW_SLOT slot ==="
export COMMIT_SHA
COMMIT_SHA=$(git rev-parse --short HEAD)
export WEB_PORT=$NEW_WEB_PORT
docker compose -f "$COMPOSE_APP" -p "sotto-${NEW_SLOT}" build

# Build the worker image before migrations so the Prisma CLI comes from the
# pinned workspace install, not an npx network fallback.
echo ""
echo "=== Building migration runner ==="
docker compose -f "$COMPOSE_WORKERS" build workers-heavy

# --- Database migrations ---

echo ""
echo "=== Running database migrations ==="
docker compose -f "$COMPOSE_WORKERS" run --rm --no-deps \
  -e DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}" \
  workers-heavy npx --no-install prisma db push --schema=prisma/schema.prisma --accept-data-loss

# --- Start new slot ---

echo ""
echo "=== Starting $NEW_SLOT slot ==="
docker compose -f "$COMPOSE_APP" -p "sotto-${NEW_SLOT}" up -d

# --- Health check new slot ---

echo ""
echo "=== Health checking $NEW_SLOT slot (timeout: ${HEALTH_TIMEOUT}s) ==="
HEALTH_OK=false
for i in $(seq 1 $((HEALTH_TIMEOUT / 5))); do
  HEALTH=$(curl -sf "http://127.0.0.1:${NEW_WEB_PORT}/api/v1/health" 2>/dev/null || echo "")
  if [ -n "$HEALTH" ]; then
    LIVE_VERSION=$(echo "$HEALTH" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
    [ -z "$LIVE_VERSION" ] && LIVE_VERSION="unknown"
    if [ "$LIVE_VERSION" = "$COMMIT_SHA" ]; then
      echo "Web health check passed — version $LIVE_VERSION (attempt $i)"
      HEALTH_OK=true
      break
    else
      echo "Attempt $i — healthy but serving $LIVE_VERSION, expected $COMMIT_SHA"
    fi
  else
    echo "Attempt $i — not ready yet"
  fi
  sleep 5
done

if [ "$HEALTH_OK" = false ]; then
  echo ""
  echo "ERROR: $NEW_SLOT slot failed health check after ${HEALTH_TIMEOUT}s"
  echo "Expected version: $COMMIT_SHA"
  echo ""
  echo "=== Web logs ==="
  docker compose -f "$COMPOSE_APP" -p "sotto-${NEW_SLOT}" logs --tail=50 web
  echo ""
  echo "=== Tearing down failed $NEW_SLOT slot ==="
  docker compose -f "$COMPOSE_APP" -p "sotto-${NEW_SLOT}" down --timeout 10
  echo "Old slot ($OLD_SLOT) still serving traffic"
  exit 1
fi

# --- Post-deploy smoke check ---

echo ""
echo "=== Post-deploy smoke check ==="
BASE_URL="http://127.0.0.1:${NEW_WEB_PORT}" bash scripts/smoke-prod.sh

# --- Build and restart workers ---
# Workers are stateless BullMQ consumers; jobs are durable in Redis.
# No drain needed — restart immediately with new code.

echo ""
echo "=== Building and restarting workers ==="
echo "Worker presets: heavy=${WORKER_PRESET_HEAVY:-full} pipeline=${WORKER_PRESET_PIPELINE:-full} light=${WORKER_PRESET_LIGHT:-full}"
docker compose -f "$COMPOSE_WORKERS" build
docker compose -f "$COMPOSE_WORKERS" up -d --force-recreate

# --- Stop old slot ---
# Workers are already out of app compose — no job drain needed here.

if [ "$OLD_SLOT" != "none" ]; then
  echo ""
  echo "=== Stopping old $OLD_SLOT slot ==="

  # Determine old slot ports for env
  if [ "$OLD_SLOT" = "blue" ]; then
    export WEB_PORT=3000
  else
    export WEB_PORT=3010
  fi

  docker compose -f "$COMPOSE_APP" -p "sotto-${OLD_SLOT}" down --timeout 10
fi

# --- Save state ---

echo "$NEW_SLOT" > "$SLOT_FILE"
echo ""
echo "=== Saved active slot: $NEW_SLOT ==="

# --- Cleanup ---

echo ""
echo "=== Cleaning up old images ==="
docker image prune -f

echo ""
echo "=== Deploy complete ==="
echo "Slot: $NEW_SLOT"
echo "Version: $COMMIT_SHA"
echo "Web: http://127.0.0.1:${NEW_WEB_PORT}"
