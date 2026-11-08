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
  local requested=$1 service image image_id candidate revision="" comparison_length capability version speaking_version="" web_id="" workers_id="" workdir
  for service in web workers; do
    local tag="$requested"
    if [ "$requested" = latest ] && [ "$service" = workers ]; then tag="${revision:0:8}"; fi
    image="ghcr.io/affromero/sotto-${service}:${tag}"
    docker pull "$image" >&2 || {
      printf 'Cannot download %s. Check the public release at https://github.com/affromero/Sotto/actions/workflows/oss-image.yml and retry.\n' "$image" >&2
      return 1
    }
    image_id=$(docker image inspect --format '{{.Id}}' "$image") || return 1
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
      printf 'Image %s has no valid immutable image identity.\n' "$image" >&2
      return 1
    }
    workdir=$(docker image inspect --format '{{.Config.WorkingDir}}' "$image_id") || return 1
    if [ "$workdir" != /app/apps/web ]; then
      printf 'Image %s has an unsupported working directory.\n' "$image" >&2
      return 1
    fi
    candidate=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id") || return 1
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
    capability=$(docker image inspect --format '{{index .Config.Labels "fm.sotto.speaking-reference-capability"}}' "$image_id") || return 1
    case "$capability" in
      ''|'<no value>') version=legacy ;;
      "${service}-v1") version=v1 ;;
      *)
        printf 'Image %s has an unknown speaking reference capability.\n' "$image" >&2
        return 1
        ;;
    esac
    if [ -n "$speaking_version" ] && [ "$speaking_version" != "$version" ]; then
      printf 'Web and worker images have incompatible speaking reference capabilities.\n' >&2
      return 1
    fi
    speaking_version="$version"
    if [ "$service" = web ]; then web_id="$image_id"; else workers_id="$image_id"; fi
  done
  if [ "$web_id" = "$workers_id" ]; then
    printf 'Web and worker images must have distinct identities.\n' >&2
    return 1
  fi
  if [ -n "${STAGING_DIR:-}" ]; then
    printf '%s\n%s\n' "$web_id" "$workers_id" > "$STAGING_DIR/resolved-image-ids"
  fi
  printf '%s\n' "$revision"
}

release_healthy() {
  local response=$1 revision=$2 image="${3:-ghcr.io/affromero/sotto-web:${2:0:8}}"
  # The image already contains Node, so JSON validation needs no host dependency.
  printf '%s' "$response" | docker run --rm -i --network none --entrypoint node \
    "$image" -e '
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
