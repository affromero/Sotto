#!/usr/bin/env bash
set -u

LINES=200
OUTPUT_DIR=""

usage() {
  cat <<'USAGE'
Usage: scripts/support-bundle.sh [--output DIR] [--lines N]

Collects a redacted Sotto support bundle with Docker status, recent logs,
health/version responses, system info, and env key names.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      if [ "$#" -lt 2 ]; then
        echo "--output requires a directory" >&2
        exit 2
      fi
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --lines)
      if [ "$#" -lt 2 ]; then
        echo "--lines requires a number" >&2
        exit 2
      fi
      LINES="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$LINES" in
  '' | *[!0-9]*)
    echo "--lines must be a positive integer" >&2
    exit 2
    ;;
esac

if [ "$LINES" -lt 1 ]; then
  echo "--lines must be a positive integer" >&2
  exit 2
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_DIR="${OUTPUT_DIR:-sotto-support-$TIMESTAMP}"
mkdir -p "$OUTPUT_DIR"

OUTPUT_PARENT="$(cd "$(dirname "$OUTPUT_DIR")" && pwd)"
OUTPUT_BASE="$(basename "$OUTPUT_DIR")"
OUTPUT_PATH="$OUTPUT_PARENT/$OUTPUT_BASE"

if [ -f "./docker-compose.yml" ] || [ -f "./docker-compose.app.yml" ]; then
  PROJECT_DIR="$PWD"
elif [ -d "$HOME/.sotto" ]; then
  PROJECT_DIR="$HOME/.sotto"
else
  PROJECT_DIR="$PWD"
fi

redact_stream() {
  sed -E \
    -e 's/(sk-[A-Za-z0-9_-]+)/[REDACTED]/g' \
    -e 's/(xox[baprs]-[A-Za-z0-9-]+)/[REDACTED]/g' \
    -e 's/([A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)[A-Za-z0-9_]*[[:space:]]*=[[:space:]]*)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/(Authorization:[[:space:]]*Bearer[[:space:]]+)[A-Za-z0-9._~+\/=-]+/\1[REDACTED]/g'
}

run_cmd() {
  local name="$1"
  shift
  local path="$OUTPUT_PATH/$name.txt"
  mkdir -p "$(dirname "$path")"
  {
    printf '$'
    printf ' %q' "$@"
    printf '\n\n'
    "$@"
  } 2>&1 | redact_stream >"$path" || true
}

run_cmd_in_dir() {
  local name="$1"
  local dir="$2"
  shift 2
  local path="$OUTPUT_PATH/$name.txt"
  mkdir -p "$(dirname "$path")"
  {
    printf '$ (cd %q &&' "$dir"
    printf ' %q' "$@"
    printf ')\n\n'
    (cd "$dir" && "$@")
  } 2>&1 | redact_stream >"$path" || true
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

collect_env_keys() {
  local env_file="$1"
  local name="$2"
  local path="$OUTPUT_PATH/env/$name.txt"
  mkdir -p "$(dirname "$path")"
  awk -F= '
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ {
      key = $1
      gsub(/[[:space:]]/, "", key)
      print key "=set"
    }
  ' "$env_file" | sort >"$path" || true
}

{
  echo "generated_at=$TIMESTAMP"
  echo "project_dir=$PROJECT_DIR"
  echo "log_lines=$LINES"
  echo "bundle_version=1"
} >"$OUTPUT_PATH/metadata.txt"

run_cmd system/date date -u
run_cmd system/uname uname -a
run_cmd system/disk df -h "$PROJECT_DIR"

if command_exists free; then
  run_cmd system/memory free -h
elif command_exists vm_stat; then
  run_cmd system/memory vm_stat
fi

if command_exists git; then
  run_cmd_in_dir git/status "$PROJECT_DIR" git status --short --branch
  run_cmd_in_dir git/commit "$PROJECT_DIR" git rev-parse --short=12 HEAD
fi

if command_exists docker; then
  run_cmd docker/version docker --version
  run_cmd docker/compose-version docker compose version
  run_cmd_in_dir docker/ps "$PROJECT_DIR" docker compose ps

  if [ -f "$PROJECT_DIR/docker-compose.yml" ] || [ -f "$PROJECT_DIR/docker-compose.yaml" ] || [ -f "$PROJECT_DIR/compose.yaml" ]; then
    run_cmd_in_dir logs/self-host-compose "$PROJECT_DIR" docker compose logs --tail "$LINES" --timestamps
  fi

  if [ -f "$PROJECT_DIR/docker-compose.app.yml" ]; then
    run_cmd_in_dir docker/prod-blue-ps "$PROJECT_DIR" docker compose -f docker-compose.app.yml -p sotto-blue ps
    run_cmd_in_dir docker/prod-green-ps "$PROJECT_DIR" docker compose -f docker-compose.app.yml -p sotto-green ps
    run_cmd_in_dir logs/prod-blue-web "$PROJECT_DIR" docker compose -f docker-compose.app.yml -p sotto-blue logs --tail "$LINES" --timestamps web
    run_cmd_in_dir logs/prod-green-web "$PROJECT_DIR" docker compose -f docker-compose.app.yml -p sotto-green logs --tail "$LINES" --timestamps web
  fi

  if [ -f "$PROJECT_DIR/docker-compose.workers.yml" ]; then
    run_cmd_in_dir logs/workers "$PROJECT_DIR" docker compose -f docker-compose.workers.yml logs --tail "$LINES" --timestamps
  fi

  if [ -f "$PROJECT_DIR/docker-compose.infra.yml" ]; then
    run_cmd_in_dir logs/infra "$PROJECT_DIR" docker compose -f docker-compose.infra.yml logs --tail "$LINES" --timestamps
  fi
fi

if command_exists curl; then
  run_cmd health/version-localhost-3000 curl -fsS --max-time 10 http://localhost:3000/api/version
  run_cmd health/health-localhost-3000 curl -fsS --max-time 10 http://localhost:3000/api/health
  run_cmd health/health-localhost-3010 curl -fsS --max-time 10 http://localhost:3010/api/health
fi

for env_file in "$PROJECT_DIR/.env" "$PROJECT_DIR/.env.local" "$PROJECT_DIR/.env.production"; do
  if [ -f "$env_file" ]; then
    collect_env_keys "$env_file" "$(basename "$env_file")"
  fi
done

ARCHIVE="$OUTPUT_PARENT/$OUTPUT_BASE.tar.gz"
tar -czf "$ARCHIVE" -C "$OUTPUT_PARENT" "$OUTPUT_BASE"

echo "Support bundle written to: $OUTPUT_PATH"
echo "Archive written to: $ARCHIVE"
