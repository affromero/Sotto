#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

status="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/health")"
if [[ "${status}" != "200" ]]; then
  echo "Health check failed (status ${status}) for ${BASE_URL}/api/v1/health"
  exit 1
fi

echo "Health check OK: ${BASE_URL}/api/v1/health"

# On gated instances (SOTTO_ACCESS_PASSWORD set) anonymous API calls must be
# rejected — a 401 here proves the gate is standing. Ungated instances serve 200.
expected="200"
[[ -n "${SOTTO_ACCESS_PASSWORD:-}" ]] && expected="401"

status="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/tags")"
if [[ "${status}" != "${expected}" ]]; then
  echo "Tags check failed (status ${status}, expected ${expected}) for ${BASE_URL}/api/v1/tags"
  exit 1
fi
echo "Tags check OK (status ${status}): ${BASE_URL}/api/v1/tags"
