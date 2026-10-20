#!/usr/bin/env bash
set -euo pipefail
if [ "$#" != 2 ]; then
  echo "Usage: schema/deploy.sh PRIVATE_REVIEW_JSON PRIVATE_EVIDENCE_FILE" >&2
  exit 1
fi
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec bash "$root/scripts/deploy.sh" --fenced-schema-migration "$1" "$2"
