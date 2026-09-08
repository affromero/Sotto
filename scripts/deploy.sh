#!/usr/bin/env bash
# Blue-green deploy script for Sotto.
# Runs on the server. Alternates between blue and green slots (ports
# SOTTO_WEB_PORT_BLUE/SOTTO_WEB_PORT_GREEN, default 3000/3010).
# Caddy routes only to the verified active slot.
#
# Multiple stacks can share one server: SOTTO_STACK (default "sotto") names the
# stack and scopes the slot state file, compose project names, image names,
# ports, and Caddy site file. Only the primary "sotto" stack manages the shared
# infrastructure (postgres/redis/pgbouncer); secondary stacks require it to
# already be running.
#
# Usage: bash ~/sotto/scripts/deploy.sh

set -euo pipefail

# One lock covers admission, image imports, service changes and health checks.
exec 9>"${PRODUCTION_DEPLOY_LOCK:-/var/lock/production-build.lock}"
flock -n 9 || { echo "Another production deployment or maintenance operation is active." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

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

require_env_min_length() {
  local name="$1"
  local minimum="$2"
  local value
  require_env "$name"
  value="${!name}"
  if [ "${#value}" -lt "$minimum" ]; then
    echo "ERROR: $name must be at least $minimum characters"
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
    /^# (BEGIN|END)_OPTIONAL_[A-Z]+$/ { next }
    { print }
  '
}

render_caddy_config() {
  local app_host="$1"
  local www_host="$2"

  local rendered
  rendered="$(<"$CADDY_TEMPLATE")"
  rendered="${rendered//__SOTTO_APP_DOMAIN__/$app_host}"
  rendered="${rendered//__SOTTO_STACK__/$SOTTO_STACK}"
  rendered="${rendered//localhost:__SOTTO_WEB_PORT_BLUE__ localhost:__SOTTO_WEB_PORT_GREEN__/localhost:$NEW_WEB_PORT}"
  rendered="${rendered//__SOTTO_WEB_PORT_BLUE__/$WEB_PORT_BLUE}"
  rendered="${rendered//__SOTTO_WEB_PORT_GREEN__/$WEB_PORT_GREEN}"

  rendered="$(printf '%s\n' "$rendered" | remove_optional_block "# BEGIN_OPTIONAL_MAPS" "# END_OPTIONAL_MAPS")"

  if [ -n "$www_host" ]; then
    rendered="${rendered//__SOTTO_WWW_DOMAIN__/$www_host}"
  else
    rendered="$(printf '%s\n' "$rendered" | remove_optional_block "# BEGIN_OPTIONAL_WWW" "# END_OPTIONAL_WWW")"
  fi

  printf '%s\n' "$rendered" | remove_optional_markers
}

registry_login_if_configured() {
  if [ -z "${GHCR_TOKEN:-}" ]; then
    return
  fi

  echo "Logging in to ghcr.io with GHCR_TOKEN"
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-$USER}" --password-stdin
}

pull_with_retry() {
  local description="$1"
  shift

  local start=$SECONDS
  local attempt=1
  until "$@"; do
    if [ $((SECONDS - start)) -ge "$IMAGE_PULL_TIMEOUT" ]; then
      echo "ERROR: failed to pull $description after ${IMAGE_PULL_TIMEOUT}s"
      return 1
    fi

    echo "Pull failed for $description (attempt $attempt); retrying in 15s"
    attempt=$((attempt + 1))
    sleep 15
  done
}

# --- Verify code ---

echo ""
echo "=== Verifying committed release checkout ==="
PREV_COMMIT_SHA=$(git rev-parse HEAD)
GIT_COMMIT_SHA=$(git rev-parse HEAD)

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
# The managed showcase (SELF_HOSTED=false) runs ungated on purpose; the access
# gate activates whenever SOTTO_ACCESS_PASSWORD is set, so requiring it there
# would password-wall the public demo.
if [ "${SELF_HOSTED:-true}" != "false" ]; then
  require_env_min_length SOTTO_ACCESS_PASSWORD 16
fi
require_env_min_length BYOK_ENCRYPTION_KEY 32

# --- Stack identity (may come from the env file or the caller's environment) ---

SOTTO_STACK="${SOTTO_STACK:-sotto}"
if [[ ! "$SOTTO_STACK" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "ERROR: SOTTO_STACK contains invalid characters." >&2
  exit 1
fi
export SOTTO_STACK
SLOT_FILE="$HOME/.${SOTTO_STACK}-deploy-slot"
WEB_PORT_BLUE="${SOTTO_WEB_PORT_BLUE:-3000}"
WEB_PORT_GREEN="${SOTTO_WEB_PORT_GREEN:-3010}"

# --- Slot resolution ---

if [ -f "$SLOT_FILE" ]; then
  ACTIVE_SLOT=$(cat "$SLOT_FILE")
else
  ACTIVE_SLOT="none"
fi

if [ "$ACTIVE_SLOT" = "blue" ]; then
  NEW_SLOT="green"
  NEW_WEB_PORT=$WEB_PORT_GREEN
  OLD_SLOT="blue"
elif [ "$ACTIVE_SLOT" = "green" ]; then
  NEW_SLOT="blue"
  NEW_WEB_PORT=$WEB_PORT_BLUE
  OLD_SLOT="green"
else
  # First deploy starts with blue.
  NEW_SLOT="blue"
  NEW_WEB_PORT=$WEB_PORT_BLUE
  OLD_SLOT="none"
fi

echo ""
echo "=== Blue-green deploy ==="
echo "Stack:       $SOTTO_STACK"
echo "Active slot: $ACTIVE_SLOT"
echo "New slot:    $NEW_SLOT (web=$NEW_WEB_PORT)"

COMMIT_SHA="$GIT_COMMIT_SHA"
export COMMIT_SHA
SOTTO_IMAGE_SOURCE="${SOTTO_IMAGE_SOURCE:-registry}"
if [ "$SOTTO_IMAGE_SOURCE" != registry ]; then
  echo "ERROR: production deployment accepts verified registry images only. Build on a separate machine." >&2
  exit 1
fi
require_env SOTTO_RELEASE_SHA
if [[ ! "$SOTTO_RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]] || [ "$SOTTO_RELEASE_SHA" != "$COMMIT_SHA" ]; then
  echo "ERROR: checkout HEAD must equal the full SOTTO_RELEASE_SHA." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ] || git submodule status --recursive | grep -q '^[+U-]'; then
  echo "ERROR: deploy a clean checkout with its committed submodule revisions." >&2
  exit 1
fi
for variable in SOTTO_WEB_IMAGE_REF SOTTO_WORKERS_IMAGE_REF; do
  require_env "$variable"
  if [[ ! "${!variable}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR: $variable must be a complete sha256 image reference." >&2
    exit 1
  fi
done
for variable in SOTTO_WEB_IMAGE_BYTES SOTTO_WEB_TRANSFER_BYTES SOTTO_WORKERS_IMAGE_BYTES SOTTO_WORKERS_TRANSFER_BYTES SOTTO_BACKUP_BYTES; do
  require_env "$variable"
  if [[ ! "${!variable}" =~ ^[1-9][0-9]{0,14}$ ]]; then
    echo "ERROR: $variable must contain measured positive bytes from the builder." >&2
    exit 1
  fi
done
PRODUCTION_CAPACITY_CHECKER="${PRODUCTION_CAPACITY_CHECKER:-/usr/local/lib/production/production_capacity.py}"
if [ ! -f "$PRODUCTION_CAPACITY_CHECKER" ]; then
  echo "ERROR: install the reviewed production capacity checker before deployment." >&2
  exit 1
fi
IMAGE_PULL_TIMEOUT="${SOTTO_IMAGE_PULL_TIMEOUT:-600}"
SOTTO_BACKUP_DIR="${SOTTO_BACKUP_DIR:-$HOME/.local/state/sotto-backups/$SOTTO_STACK}"
export SOTTO_BACKUP_DIR
mkdir -p "$SOTTO_BACKUP_DIR"
chmod 700 "$SOTTO_BACKUP_DIR"
backup_capacity=(--backup-path "$SOTTO_BACKUP_DIR" --backup-bytes "$SOTTO_BACKUP_BYTES")
SOTTO_IMAGE_TAG="$COMMIT_SHA"
export SOTTO_IMAGE_TAG
IMAGE_OVERRIDES=$(mktemp -d)
trap 'rm -rf "$IMAGE_OVERRIDES"' EXIT
APP_IMAGES="$IMAGE_OVERRIDES/app.json"
WORKER_IMAGES="$IMAGE_OVERRIDES/workers.json"
export APP_IMAGES WORKER_IMAGES
python3 - <<'OVERRIDES'
import json, os
with open(os.environ["APP_IMAGES"], "w") as stream:
    json.dump({"services": {"web": {"image": os.environ["SOTTO_WEB_IMAGE_REF"]}}}, stream)
with open(os.environ["WORKER_IMAGES"], "w") as stream:
    json.dump({"services": {name: {"image": os.environ["SOTTO_WORKERS_IMAGE_REF"]} for name in ("workers-heavy", "workers-pipeline", "workers-light")}}, stream)
OVERRIDES

# Already imported exact digests need no transfer or unpack allocation.
incoming_images=0
incoming_transfer=0
missing_images=()
for kind in WEB WORKERS; do
  reference="SOTTO_${kind}_IMAGE_REF"
  if ! docker image inspect "${!reference}" >/dev/null 2>&1; then
    image_bytes="SOTTO_${kind}_IMAGE_BYTES"
    transfer_bytes="SOTTO_${kind}_TRANSFER_BYTES"
    incoming_images=$((incoming_images + ${!image_bytes}))
    incoming_transfer=$((incoming_transfer + ${!transfer_bytes}))
    missing_images+=("${!reference}")
  fi
done
if [ "$incoming_images" -gt 0 ]; then
  python3 "$PRODUCTION_CAPACITY_CHECKER" before-import \
    --image-bytes "$incoming_images" --transfer-bytes "$incoming_transfer" "${backup_capacity[@]}"
  registry_login_if_configured
  for image in "${missing_images[@]}"; do
    pull_with_retry "$image" docker pull "$image"
  done
else
  python3 "$PRODUCTION_CAPACITY_CHECKER" before-switch "${backup_capacity[@]}"
fi
python3 "$PRODUCTION_CAPACITY_CHECKER" before-switch "${backup_capacity[@]}"
host_platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
for image in "$SOTTO_WEB_IMAGE_REF" "$SOTTO_WORKERS_IMAGE_REF"; do
  revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
  if [ "$revision" != "$SOTTO_RELEASE_SHA" ]; then
    echo "ERROR: imported image revision does not match the committed release." >&2
    exit 1
  fi
  if [ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" != "$host_platform" ]; then
    echo "ERROR: imported image platform does not match the serving host." >&2
    exit 1
  fi
done

export PRODUCTION_IMAGE_RETENTION_DIR="${PRODUCTION_IMAGE_RETENTION_DIR:-$HOME/.local/state/production-image-retention}"
export RETENTION_ATTEMPT_KEY="$(date +%s)-$$"
python3 scripts/deploy/production-retention.py begin

APP_DOMAIN="$(app_host_from_url "$NEXT_PUBLIC_APP_URL")"
WWW_DOMAIN="${SOTTO_WWW_DOMAIN:-}"
CADDY_SITE_PATH="${CADDY_SITE_PATH:-/etc/caddy/conf.d/${SOTTO_STACK}.conf}"

validate_caddy_host SOTTO_WWW_DOMAIN "$WWW_DOMAIN"

export PREVIOUS_WORKER_IMAGES="$IMAGE_OVERRIDES/previous-workers.json"
export PREVIOUS_APP_IMAGES="$IMAGE_OVERRIDES/previous-app.json"
export OLD_SLOT
python3 - <<'PREVIOUS_IMAGES'
import json, os, subprocess
stack = os.environ["SOTTO_STACK"]
def previous(project, service):
    ids = subprocess.check_output(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + project, "--filter", "label=com.docker.compose.service=" + service], text=True).split()
    if len(ids) > 1:
        raise SystemExit("Ambiguous previous service containers")
    return subprocess.check_output(["docker", "inspect", "--format", "{{.Image}}", ids[0]], text=True).strip() if ids else None
workers = {name: {"image": image} for name in ("workers-heavy", "workers-pipeline", "workers-light") if (image := previous(stack, name))}
with open(os.environ["PREVIOUS_WORKER_IMAGES"], "w") as stream:
    json.dump({"services": workers}, stream)
web = previous(stack + "-" + os.environ["OLD_SLOT"], "web")
with open(os.environ["PREVIOUS_APP_IMAGES"], "w") as stream:
    json.dump({"services": {"web": {"image": web}} if web else {}}, stream)
PREVIOUS_IMAGES
previous_worker_id=$(python3 -c 'import json,sys; images={item["image"] for item in json.load(open(sys.argv[1]))["services"].values()}; print(next(iter(images)) if len(images)==1 else "")' "$PREVIOUS_WORKER_IMAGES")
previous_web_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["services"].get("web",{}).get("image",""))' "$PREVIOUS_APP_IMAGES")
for kind in WEB WORKERS; do
  tag_variable="SOTTO_${kind}_ROLLBACK_TAG"
  tag="${!tag_variable:-}"
  if [ -n "$tag" ]; then
    if [[ ! "$tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9._:/-]*:[a-zA-Z0-9._-]*rollback[a-zA-Z0-9._-]*$ ]] || ! docker image inspect "$tag" >/dev/null 2>&1; then
      echo "ERROR: $tag_variable must name an existing rollback tag." >&2
      exit 1
    fi
    if { [ "$kind" = WEB ] && [ -z "$previous_web_id" ]; } || { [ "$kind" = WORKERS ] && [ -z "$previous_worker_id" ]; }; then
      echo "ERROR: no unique previous image is available for $tag_variable." >&2
      exit 1
    fi
  fi
done
schema_hash_script='const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");const root="/app/apps/web/prisma",hash=crypto.createHash("sha256");function add(file){const full=path.join(root,file);if(fs.statSync(full).isDirectory()){for(const name of fs.readdirSync(full).sort())add(path.join(file,name));}else{hash.update(file);hash.update(fs.readFileSync(full));}}add("schema.prisma");if(fs.existsSync(path.join(root,"migrations")))add("migrations");console.log(hash.digest("hex"));'
candidate_schema=$(docker run --rm --pull never --network none --entrypoint node "$SOTTO_WORKERS_IMAGE_REF" -e "$schema_hash_script")
while IFS= read -r previous_image; do
  [ -z "$previous_image" ] && continue
  previous_schema=$(docker run --rm --pull never --network none --entrypoint node "$previous_image" -e "$schema_hash_script")
  if [ "$previous_schema" != "$candidate_schema" ]; then
    echo "ERROR: schema or migration assets differ. Review and deploy the database migration separately." >&2
    exit 1
  fi
done < <(python3 -c 'import json,sys; print("\n".join(sorted({item["image"] for item in json.load(open(sys.argv[1]))["services"].values()})))' "$PREVIOUS_WORKER_IMAGES")

WORKERS_CHANGED=false
CADDY_CHANGED=false
WEB_STARTED=false
DEPLOYMENT_COMPLETE=false
if [ -f "$CADDY_SITE_PATH" ]; then cp "$CADDY_SITE_PATH" "$IMAGE_OVERRIDES/caddy.previous"; fi
if [ -f "$SLOT_FILE" ]; then cp "$SLOT_FILE" "$IMAGE_OVERRIDES/slot.previous"; fi
finish_deployment() {
  local status=$?
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ] && [ "$DEPLOYMENT_COMPLETE" != true ]; then
    echo "Deployment failed. Restoring the previous services and routing." >&2
    if [ "$WORKERS_CHANGED" = true ]; then
      previous_services=$(python3 -c 'import json,sys; print(" ".join(json.load(open(sys.argv[1]))["services"]))' "$PREVIOUS_WORKER_IMAGES")
      if [ -n "$previous_services" ]; then
        # Service names come from the fixed allowlist above.
        docker compose -f "$COMPOSE_WORKERS" -f "$PREVIOUS_WORKER_IMAGES" -p "$SOTTO_STACK" up -d --no-build --pull never $previous_services || echo "ERROR: worker rollback failed" >&2
        sleep 10
        for service in $previous_services; do
          container=$(docker compose -f "$COMPOSE_WORKERS" -f "$PREVIOUS_WORKER_IMAGES" -p "$SOTTO_STACK" ps -q "$service")
          expected_image=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["services"][sys.argv[2]]["image"])' "$PREVIOUS_WORKER_IMAGES" "$service")
          if [ -z "$container" ] || [ "$(docker inspect --format '{{.State.Running}} {{.State.OOMKilled}} {{.RestartCount}} {{.Image}}' "$container")" != "true false 0 $expected_image" ]; then
            echo "ERROR: restored worker $service failed runtime or image verification" >&2
          fi
        done
      else
        docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" stop workers-heavy workers-pipeline workers-light
      fi
    fi
    if [ "$CADDY_CHANGED" = true ]; then
      if [ -f "$IMAGE_OVERRIDES/caddy.previous" ]; then
        sudo install -m 0644 "$IMAGE_OVERRIDES/caddy.previous" "$CADDY_SITE_PATH"
      else
        sudo rm -f "$CADDY_SITE_PATH"
      fi
      sudo caddy validate --config /etc/caddy/Caddyfile && sudo caddy reload --config /etc/caddy/Caddyfile --force || echo "ERROR: routing rollback failed" >&2
    fi
    if [ "$OLD_SLOT" != none ]; then
      if [ "$OLD_SLOT" = blue ]; then export WEB_PORT=$WEB_PORT_BLUE; else export WEB_PORT=$WEB_PORT_GREEN; fi
      docker compose -f "$COMPOSE_APP" -f "$PREVIOUS_APP_IMAGES" -p "${SOTTO_STACK}-${OLD_SLOT}" up -d --no-build --pull never web || echo "ERROR: web rollback failed" >&2
    fi
    if [ "$WEB_STARTED" = true ]; then
      docker compose -f "$COMPOSE_APP" -f "$APP_IMAGES" -p "${SOTTO_STACK}-${NEW_SLOT}" down --timeout 10 || echo "ERROR: candidate teardown failed" >&2
    fi
    if [ -f "$IMAGE_OVERRIDES/slot.previous" ]; then
      cp "$IMAGE_OVERRIDES/slot.previous" "$SLOT_FILE.next-$$" && mv "$SLOT_FILE.next-$$" "$SLOT_FILE"
    else
      rm -f "$SLOT_FILE"
    fi
    if [ "$OLD_SLOT" != none ]; then
      curl --retry 10 --retry-delay 2 --retry-all-errors -fsS --max-time 10 "${NEXT_PUBLIC_APP_URL%/}/api/v1/health" >/dev/null || echo "ERROR: restored public service failed health verification" >&2
    fi
  fi
  rm -rf "$IMAGE_OVERRIDES"
  exit "$status"
}
trap finish_deployment EXIT

echo "Loaded env file: $ENV_FILE"
echo "Deploy source:   $SOTTO_IMAGE_SOURCE"
echo "Commit:          $COMMIT_SHA"
echo "Previous commit: $PREV_COMMIT_SHA"
echo "Image tag:       $SOTTO_IMAGE_TAG"
echo "App domain:      $APP_DOMAIN"
if [ -n "$WWW_DOMAIN" ]; then
  echo "WWW domain:      $WWW_DOMAIN"
else
  echo "WWW domain:      disabled"
fi

# --- Caddy config ---

echo ""
echo "=== Syncing Caddy config ==="
TMP_CADDY="$IMAGE_OVERRIDES/caddy.next"
render_caddy_config "$APP_DOMAIN" "$WWW_DOMAIN" > "$TMP_CADDY"
if grep -q "__SOTTO_\|__sotto_" "$TMP_CADDY"; then
  echo "ERROR: rendered Caddy config still contains Sotto placeholders."
  rm -f "$TMP_CADDY"
  exit 1
fi

# --- Infrastructure ---
# Shared across all stacks; only the primary stack manages it. A secondary
# stack bringing it up would collide on the fixed sotto-prod-* container names.

if [ "$SOTTO_STACK" != "sotto" ]; then
  echo ""
  echo "=== Secondary stack ($SOTTO_STACK): verifying shared infrastructure ==="
  for c in sotto-prod-postgres sotto-prod-redis; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" != "true" ]; then
      echo "ERROR: shared infra container $c is not running. Deploy the primary stack first."
      exit 1
    fi
  done
  echo "Shared infrastructure is up"
else

echo ""
echo "=== Ensuring infrastructure is running ==="
docker compose -f "$COMPOSE_INFRA" up -d --no-build --pull never

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

fi

# The agent CLIs rotate their OAuth refresh token in place and the previous one
# is retired server-side, so a second copy of the same login goes permanently
# dead the moment either side refreshes. These volumes are therefore host-wide,
# NOT stack-scoped: every stack mounts the same file and shares one lineage.
# The app compose file consumes them as external state; create them here so a
# web-only deploy does not fail on a missing volume.
docker volume create agent-claude-home >/dev/null
docker volume create agent-codex-home >/dev/null
# The apps sharing these volumes run as different uids (this image is 1001,
# papernook and flight-finder are 1000). Setgid to their common group so files
# created here inherit it, and 0770 so both can create the temp file that the
# atomic writeback renames into place. Idempotent; runs as root in a throwaway
# container because the host does not need docker volume internals poked at.
docker run --rm --pull never -v agent-claude-home:/x -v agent-codex-home:/y alpine:3.22 sh -c '
  chgrp -R 1000 /x /y 2>/dev/null || true
  chmod 2770 /x /y
  find /x /y -type f -exec chmod 660 {} + 2>/dev/null || true
' >/dev/null 2>&1 || echo "WARNING: could not normalise agent credential volume permissions"

# Refresh host CLI authentication before any migration, web, or worker process
# starts. The networkless sidecar copies only the two supported auth JSON files
# into the stack-scoped volume shared by those containers.
echo ""
echo "=== Syncing host CLI credentials ==="
docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" up -d --no-build --pull never credential-sync
for i in $(seq 1 15); do
  if docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" exec -T credential-sync \
    test -f /credential-sync/ready >/dev/null 2>&1; then
    echo "CLI credential sync ready"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "ERROR: CLI credential sync did not become ready"
    exit 1
  fi
  sleep 1
done

export WEB_PORT=$NEW_WEB_PORT

# --- Database migrations ---

echo "=== Backing up the application database ==="
database_url="${DIRECT_DATABASE_URL:-$DATABASE_URL}"
database_bytes=$(printf '%s\n' "$database_url" | docker exec -i sotto-prod-postgres sh -ec 'IFS= read -r PGDATABASE; export PGDATABASE; exec psql -Atc "SELECT pg_database_size(current_database())"')
if [[ ! "$database_bytes" =~ ^[0-9]+$ ]] || [ "$database_bytes" -gt "$SOTTO_BACKUP_BYTES" ]; then
  echo "ERROR: database size exceeds the measured backup allowance." >&2
  exit 1
fi
python3 "$PRODUCTION_CAPACITY_CHECKER" before-switch "${backup_capacity[@]}"
backup_file="$SOTTO_BACKUP_DIR/${SOTTO_RELEASE_SHA}-${RETENTION_ATTEMPT_KEY}.dump"
umask 077
printf '%s\n' "$database_url" | docker exec -i sotto-prod-postgres sh -ec 'IFS= read -r PGDATABASE; export PGDATABASE; exec pg_dump --format=custom' > "$backup_file.partial"
test -s "$backup_file.partial"
docker exec -i sotto-prod-postgres pg_restore --file=/dev/null < "$backup_file.partial"
mv "$backup_file.partial" "$backup_file"
sha256sum "$backup_file" > "$backup_file.sha256"
python3 "$PRODUCTION_CAPACITY_CHECKER" before-switch

echo ""
echo "=== Running database migrations ==="
docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" run --rm --no-deps --pull never \
  -e DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}" \
  workers-heavy npx --no-install prisma migrate deploy --config=/app/prisma.config.ts

# --- Start new slot ---

# Pin legacy dual-slot routing to the current service before starting a candidate.
if [ "$OLD_SLOT" != none ]; then
  if [ "$OLD_SLOT" = blue ]; then old_web_port=$WEB_PORT_BLUE; else old_web_port=$WEB_PORT_GREEN; fi
  ( NEW_WEB_PORT=$old_web_port; render_caddy_config "$APP_DOMAIN" "$WWW_DOMAIN" ) > "$IMAGE_OVERRIDES/caddy.current"
  CADDY_CHANGED=true
  sudo install -m 0644 "$IMAGE_OVERRIDES/caddy.current" "$CADDY_SITE_PATH"
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo caddy reload --config /etc/caddy/Caddyfile --force
  curl -fsS --max-time 15 "${NEXT_PUBLIC_APP_URL%/}/api/v1/health" >/dev/null
fi

echo ""
echo "=== Starting $NEW_SLOT slot ==="
WEB_STARTED=true
docker compose -f "$COMPOSE_APP" -f "$APP_IMAGES" -p "${SOTTO_STACK}-${NEW_SLOT}" up -d --no-build --pull never web

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
      echo "Web health check passed: version $LIVE_VERSION (attempt $i)"
      HEALTH_OK=true
      break
    else
      echo "Attempt $i: healthy but serving $LIVE_VERSION, expected $COMMIT_SHA"
    fi
  else
    echo "Attempt $i: not ready yet"
  fi
  sleep 5
done

if [ "$HEALTH_OK" = false ]; then
  echo ""
  echo "ERROR: $NEW_SLOT slot failed health check after ${HEALTH_TIMEOUT}s"
  echo "Expected version: $COMMIT_SHA"
  echo ""
  echo "=== Web logs ==="
  docker compose -f "$COMPOSE_APP" -f "$APP_IMAGES" -p "${SOTTO_STACK}-${NEW_SLOT}" logs --tail=50 web
  echo ""
  echo "=== Tearing down failed $NEW_SLOT slot ==="
  docker compose -f "$COMPOSE_APP" -f "$APP_IMAGES" -p "${SOTTO_STACK}-${NEW_SLOT}" down --timeout 10
  echo "Old slot ($OLD_SLOT) still serving traffic"
  exit 1
fi

# --- Post-deploy smoke check ---

echo ""
echo "=== Post-deploy smoke check ==="
BASE_URL="http://127.0.0.1:${NEW_WEB_PORT}" bash scripts/smoke-prod.sh

# --- Restart workers ---
# Workers are stateless BullMQ consumers; jobs are durable in Redis.
# No drain needed. Restart immediately with new code.

echo ""
echo "=== Restarting workers ==="
echo "Worker presets: heavy=${WORKER_PRESET_HEAVY:-full} pipeline=${WORKER_PRESET_PIPELINE:-full} light=${WORKER_PRESET_LIGHT:-full}"
WORKERS_CHANGED=true
docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" up -d --force-recreate --no-build --pull never
sleep 10
for service in workers-heavy workers-pipeline workers-light; do
  container=$(docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" ps -q "$service")
  if [ -z "$container" ] || [ "$(docker inspect --format '{{.State.Running}} {{.State.OOMKilled}} {{.RestartCount}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$container")" != "true false 0 $SOTTO_RELEASE_SHA" ]; then
    echo "ERROR: $service did not remain healthy on the expected release." >&2
    exit 1
  fi
done

CADDY_CHANGED=true
sudo install -m 0644 "$TMP_CADDY" "$CADDY_SITE_PATH"
sudo caddy validate --config /etc/caddy/Caddyfile
sudo caddy reload --config /etc/caddy/Caddyfile --force
public_health=$(curl -fsS --max-time 15 "${NEXT_PUBLIC_APP_URL%/}/api/v1/health")
if [ "$(printf '%s' "$public_health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version", ""))')" != "$SOTTO_RELEASE_SHA" ]; then
  echo "ERROR: public routing did not select the healthy candidate." >&2
  exit 1
fi

# --- Stop old slot ---
# Workers are already out of app compose. No job drain needed here.

if [ "$OLD_SLOT" != "none" ]; then
  echo ""
  echo "=== Stopping old $OLD_SLOT slot ==="

  # Determine old slot ports for env
  if [ "$OLD_SLOT" = "blue" ]; then
    export WEB_PORT=$WEB_PORT_BLUE
  else
    export WEB_PORT=$WEB_PORT_GREEN
  fi

  docker compose -f "$COMPOSE_APP" -f "$APP_IMAGES" -p "${SOTTO_STACK}-${OLD_SLOT}" down --timeout 10
fi

# --- Save state ---

public_health=$(curl -fsS --max-time 15 "${NEXT_PUBLIC_APP_URL%/}/api/v1/health")
if [ "$(printf '%s' "$public_health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version", ""))')" != "$SOTTO_RELEASE_SHA" ]; then
  echo "ERROR: public health did not report the deployed release." >&2
  exit 1
fi
echo "$NEW_SLOT" > "$SLOT_FILE.next-$$"
mv "$SLOT_FILE.next-$$" "$SLOT_FILE"
echo ""
echo "=== Saved active slot: $NEW_SLOT ==="

# --- Cleanup ---

echo ""
python3 "$PRODUCTION_CAPACITY_CHECKER" before-switch
python3 scripts/deploy/production-retention.py success
DEPLOYMENT_COMPLETE=true
python3 scripts/deploy/production-retention.py backups-success
if [ -n "${SOTTO_WORKERS_ROLLBACK_TAG:-}" ]; then docker tag "$previous_worker_id" "$SOTTO_WORKERS_ROLLBACK_TAG"; fi
if [ -n "${SOTTO_WEB_ROLLBACK_TAG:-}" ]; then docker tag "$previous_web_id" "$SOTTO_WEB_ROLLBACK_TAG"; fi
echo "Images and build cache retained. Run host maintenance separately with rollback protection."

echo ""
echo "=== Deploy complete ==="
echo "Slot: $NEW_SLOT"
echo "Version: $COMMIT_SHA"
echo "Web: http://127.0.0.1:${NEW_WEB_PORT}"
