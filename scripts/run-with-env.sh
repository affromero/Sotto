#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${SOTTO_ENV_FILE:-$REPO_ROOT/.env.local}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
elif [ "${SOTTO_ENV_REQUIRED:-0}" = "1" ]; then
  echo "Error: env file not found at $ENV_FILE"
  echo "Run npm run setup or set SOTTO_ENV_FILE to an explicit env file."
  exit 1
fi

exec "$@"
