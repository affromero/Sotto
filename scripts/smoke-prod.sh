#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

status="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/health")"
if [[ "${status}" != "200" ]]; then
  echo "Health check failed (status ${status}) for ${BASE_URL}/api/v1/health"
  exit 1
fi

echo "Health check OK: ${BASE_URL}/api/v1/health"

status="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/tags")"
if [[ "${status}" != "401" ]]; then
  echo "Tags access check failed (status ${status}, expected 401) for ${BASE_URL}/api/v1/tags"
  exit 1
fi
echo "Tags access check OK (status ${status}): ${BASE_URL}/api/v1/tags"
