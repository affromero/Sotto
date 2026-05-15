#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

status="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health")"
if [[ "${status}" != "200" ]]; then
  echo "Health check failed (status ${status}) for ${BASE_URL}/api/health"
  exit 1
fi

echo "Health check OK: ${BASE_URL}/api/health"

status="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/tags")"
if [[ "${status}" != "200" ]]; then
  echo "Tags check failed (status ${status}) for ${BASE_URL}/api/tags"
  exit 1
fi
echo "Tags check OK: ${BASE_URL}/api/tags"
