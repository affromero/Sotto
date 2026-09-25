#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: cli-home.sh IMAGE}"
owner="${2:-1001}"
case "$owner" in 1000|1001) ;; *) echo 'Expected UID 1000 or 1001' >&2; exit 1 ;; esac
directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
volume="sotto-cli-home-smoke-$$-$RANDOM"
cleanup() {
  docker rm -f "$volume-seed" "$volume-cli" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker volume create "$volume" >/dev/null
# Seed the expected private owner independently of the image USER.
docker run --rm --name "$volume-seed" --network none --user 0 --entrypoint sh \
  -e EXPECTED_UID="$owner" -v "$volume:/cli-home" "$image" -ec \
  'mkdir -p /cli-home/tmp/arg0; chown -R "$EXPECTED_UID:$EXPECTED_UID" /cli-home; chmod 700 /cli-home /cli-home/tmp /cli-home/tmp/arg0'
docker run --rm -i --name "$volume-cli" --network none --entrypoint node \
  -e EXPECTED_UID="$owner" -e CODEX_HOME=/cli-home -v "$volume:/cli-home" "$image" < "$directory/cli-home.cjs"
