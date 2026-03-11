#!/usr/bin/env bash
# Blue-green deploy script for Sotto.
# Runs on the server. Alternates between blue (port 3000) and green (port 3010) slots.
# Caddy health-checks both and routes to whichever is alive.
#
# Usage: bash ~/sotto/scripts/deploy.sh

set -euo pipefail

SLOT_FILE="$HOME/.sotto-deploy-slot"
COMPOSE_INFRA="docker-compose.infra.yml"
COMPOSE_APP="docker-compose.app.yml"
HEALTH_TIMEOUT=120  # seconds to wait for new slot to become healthy
DRAIN_TIMEOUT=60    # seconds for old slot to drain BullMQ jobs

# --- Slot resolution ---

if [ -f "$SLOT_FILE" ]; then
  ACTIVE_SLOT=$(cat "$SLOT_FILE")
else
  ACTIVE_SLOT="none"
fi

if [ "$ACTIVE_SLOT" = "blue" ]; then
  NEW_SLOT="green"
  NEW_WEB_PORT=3010
  NEW_MAPS_PORT=3012
  OLD_SLOT="blue"
elif [ "$ACTIVE_SLOT" = "green" ]; then
  NEW_SLOT="blue"
  NEW_WEB_PORT=3000
  NEW_MAPS_PORT=3002
  OLD_SLOT="green"
else
  # First deploy — start with blue
  NEW_SLOT="blue"
  NEW_WEB_PORT=3000
  NEW_MAPS_PORT=3002
  OLD_SLOT="none"
fi

echo "=== Blue-green deploy ==="
echo "Active slot: $ACTIVE_SLOT"
echo "New slot:    $NEW_SLOT (web=$NEW_WEB_PORT, maps=$NEW_MAPS_PORT)"

# --- Pull code ---

echo ""
echo "=== Pulling latest code ==="
git pull origin main
git submodule update --init --recursive

# --- Secrets ---

echo ""
echo "=== Downloading secrets from Doppler ==="
doppler secrets download --no-file --format env > .env
chmod 600 .env
source .env

# --- Caddy config ---

echo ""
echo "=== Syncing Caddy config ==="
sudo cp ~/sotto/Caddyfile /etc/caddy/conf.d/sotto.fm
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

# --- Pull remotion from GHCR ---

echo ""
echo "=== Pulling remotion from GHCR ==="
GHCR_TOKEN=$(doppler secrets get GHCR_READ_TOKEN --plain)
echo "${GHCR_TOKEN}" | docker login ghcr.io -u affromero --password-stdin
docker compose -f "$COMPOSE_INFRA" pull remotion
docker compose -f "$COMPOSE_INFRA" up -d --no-deps remotion

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
export MAPS_PORT=$NEW_MAPS_PORT
docker compose -f "$COMPOSE_APP" -p "sotto-${NEW_SLOT}" build

# --- Database migrations ---

echo ""
echo "=== Running database migrations ==="
docker compose -f "$COMPOSE_APP" -p "sotto-${NEW_SLOT}" run --rm --no-deps \
  -e DATABASE_URL="postgresql://${POSTGRES_USER:-sotto}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-sotto}?schema=public" \
  web npx prisma@6 db push --skip-generate --schema=prisma/schema.prisma

# --- Start new slot ---

echo ""
echo "=== Starting $NEW_SLOT slot ==="
docker compose -f "$COMPOSE_APP" -p "sotto-${NEW_SLOT}" up -d

# --- Health check new slot ---

echo ""
echo "=== Health checking $NEW_SLOT slot (timeout: ${HEALTH_TIMEOUT}s) ==="
HEALTH_OK=false
for i in $(seq 1 $((HEALTH_TIMEOUT / 5))); do
  HEALTH=$(curl -sf "http://127.0.0.1:${NEW_WEB_PORT}/api/health" 2>/dev/null || echo "")
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

# Also check maps if it has a health endpoint
MAPS_HEALTH=$(curl -sf "http://127.0.0.1:${NEW_MAPS_PORT}/api/health" 2>/dev/null || echo "")
if [ -n "$MAPS_HEALTH" ]; then
  echo "Maps health check passed"
else
  echo "Maps health check skipped (no response — may not have /api/health)"
fi

# --- Stop old slot ---

if [ "$OLD_SLOT" != "none" ]; then
  echo ""
  echo "=== Stopping old $OLD_SLOT slot (${DRAIN_TIMEOUT}s drain) ==="

  # Determine old slot ports for env
  if [ "$OLD_SLOT" = "blue" ]; then
    export WEB_PORT=3000
    export MAPS_PORT=3002
  else
    export WEB_PORT=3010
    export MAPS_PORT=3012
  fi

  docker compose -f "$COMPOSE_APP" -p "sotto-${OLD_SLOT}" down --timeout "$DRAIN_TIMEOUT"
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
echo "Maps: http://127.0.0.1:${NEW_MAPS_PORT}"
