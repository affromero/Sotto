#!/usr/bin/env bash

# Shared by the standalone installer and updater. Requires Docker and Bash.
acquire_install_lock() {
  local directory=$1
  mkdir -p "$directory" || return 1
  if ! mkdir "$directory/.operation-lock" 2>/dev/null; then
    printf 'Another Sotto operation holds %s/.operation-lock. Wait for it to finish. If it was interrupted, remove that empty directory before retrying.\n' "$directory" >&2
    return 1
  fi
  INSTALL_LOCK_DIR="$directory/.operation-lock"
}

resolve_images() {
  local requested=$1 service image candidate revision="" comparison_length
  for service in web workers; do
    local tag="$requested"
    if [ "$requested" = latest ] && [ "$service" = workers ]; then tag="${revision:0:8}"; fi
    image="ghcr.io/affromero/sotto-${service}:${tag}"
    docker pull "$image" >&2 || {
      printf 'Cannot download %s. Check the public release at https://github.com/affromero/Sotto/actions/workflows/oss-image.yml and retry.\n' "$image" >&2
      return 1
    }
    candidate=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") || return 1
    [[ "$candidate" =~ ^[0-9a-f]{8}([0-9a-f]{32})?$ ]] || {
      printf 'Image %s has no valid release revision.\n' "$image" >&2
      return 1
    }
    comparison_length=8
    if [ "${#candidate}" = 40 ] && [ "${#revision}" = 40 ]; then comparison_length=40; fi
    if [ -n "$revision" ] && [ "${candidate:0:comparison_length}" != "${revision:0:comparison_length}" ]; then
      printf 'Web and worker images belong to different releases. Retry after publication completes.\n' >&2
      return 1
    fi
    if [ "${#candidate}" -gt "${#revision}" ]; then revision="$candidate"; fi
  done
  printf '%s\n' "$revision"
}

release_healthy() {
  local response=$1 revision=$2
  # The image already contains Node, so JSON validation needs no host dependency.
  printf '%s' "$response" | docker run --rm -i --network none --entrypoint node \
    "ghcr.io/affromero/sotto-web:${revision:0:8}" -e '
      let data="";
      process.stdin.on("data", chunk => data += chunk);
      process.stdin.on("end", () => {
        try {
          const health = JSON.parse(data);
          process.exit(health.status === "healthy" &&
            typeof health.version === "string" &&
            health.version.slice(0, 8) === process.argv[1].slice(0, 8) ? 0 : 1);
        } catch { process.exit(1); }
      });
    ' "$revision"
}
