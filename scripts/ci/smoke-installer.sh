#!/usr/bin/env bash
# Run the actual installer on a fresh release runner without provider keys.
set -euo pipefail
umask 077

revision="${1:?Usage: smoke-installer.sh REVISION}"
image_tag="${2:-${revision:0:8}}"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
install_dir="$(mktemp -d)"
project="sotto-installer-$(date +%s)-$$"
cleanup() {
  status=$?
  if [ -f "$install_dir/docker-compose.yml" ]; then
    if [ "$status" -ne 0 ]; then
      docker compose --project-directory "$install_dir" -p "$project" logs --no-color --tail 100 >&2 || true
    fi
    docker compose --project-directory "$install_dir" -p "$project" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$install_dir"
}
trap cleanup EXIT

# CI's Python is used only to select a free test port. The installer itself
# requires Bash, curl and Docker, and adds no Python requirement for users.
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
SOTTO_DIR="$install_dir" SOTTO_BIN_DIR="$install_dir/bin" \
  SOTTO_YES=1 SOTTO_AGENT_CHOICE=5 SOTTO_IMAGE_TAG="$image_tag" \
  SOTTO_REF="$revision" WEB_PORT="$port" COMPOSE_PROJECT_NAME="$project" \
  bash "$repo_root/scripts/install.sh"

grep -q "^SOTTO_IMAGE_TAG=${revision:0:8}$" "$install_dir/.env"
test -x "$install_dir/bin/sotto-host"
SOTTO_DIR="$install_dir" COMPOSE_PROJECT_NAME="$project" "$install_dir/bin/sotto-host" status

echo 'Published installer completed without a provider key or terminal prompt'
