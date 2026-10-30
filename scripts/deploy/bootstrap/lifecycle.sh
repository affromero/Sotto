#!/usr/bin/env bash
# Clean-primary setup uses the existing runner, lock and unresolved marker.
bootstrap_validate_mode() {
  if [ "$BOOTSTRAP_CLEAN_PRIMARY" = true ] && [ "$SCHEMA_TRANSITION" = true ]; then
    echo "ERROR: clean bootstrap cannot include a schema transition." >&2
    return 1
  fi
}

bootstrap_assert_caddy_absent() {
  if [ -e "$CADDY_SITE_PATH" ] || [ -L "$CADDY_SITE_PATH" ]; then
    echo "ERROR: Caddy destination appeared during clean bootstrap." >&2
    return 1
  fi
}

require_review_inputs() {
  if { [ -n "${SOTTO_COMPATIBILITY_REVIEW_FILE:-}" ] && [ -z "${SOTTO_COMPATIBILITY_EVIDENCE_FILE:-}" ]; } || \
     { [ -z "${SOTTO_COMPATIBILITY_REVIEW_FILE:-}" ] && [ -n "${SOTTO_COMPATIBILITY_EVIDENCE_FILE:-}" ]; }; then
    echo "ERROR: compatibility review and evidence must be supplied together." >&2
    return 1
  fi
  if [ -z "${SOTTO_COMPATIBILITY_REVIEW_FILE:-}" ] || [ -z "${SOTTO_COMPATIBILITY_EVIDENCE_FILE:-}" ]; then
    echo "ERROR: established deployments require a separately reviewed provider continuity procedure." >&2
    return 1
  fi
  local review_file
  for review_file in "$SOTTO_COMPATIBILITY_REVIEW_FILE" "$SOTTO_COMPATIBILITY_EVIDENCE_FILE"; do
    if [ ! -f "$review_file" ] || [ ! -r "$review_file" ] || [ -L "$review_file" ]; then
      echo "ERROR: compatibility review and evidence must be readable regular files." >&2
      return 1
    fi
  done
}

bootstrap_prepare() {
  mv "$IMAGE_OVERRIDES" "$DEPLOY_STATE_DIR/overrides"
  IMAGE_OVERRIDES="$DEPLOY_STATE_DIR/overrides"
  APP_IMAGES="$IMAGE_OVERRIDES/app.json"
  WORKER_IMAGES="$IMAGE_OVERRIDES/workers.json"
  export IMAGE_OVERRIDES APP_IMAGES WORKER_IMAGES
  trap - EXIT
  printf '%s\n' "$BOOTSTRAP_ADMISSION" > "$DEPLOY_STATE_DIR/admission.json"
  chmod 600 "$DEPLOY_STATE_DIR/admission.json"
  python3 - "$DEPLOY_STATE_DIR" "$IMAGE_OVERRIDES" "$DEPLOY_STATE_ROOT" <<'BOOTSTRAP_SYNC'
import os, sys
state, overrides, root = sys.argv[1:]
for path in (os.path.join(overrides, 'app.json'), os.path.join(overrides, 'workers.json'),
             overrides, os.path.join(state, 'admission.json'), state, root):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
BOOTSTRAP_SYNC
  python3 scripts/deploy/compatibility-review.py marker "$UNRESOLVED_DEPLOYMENT" "$DEPLOY_STATE_DIR" "$IMAGE_OVERRIDES" "$SOTTO_STACK" unresolved
  BOOTSTRAP_DAEMON=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["daemon"])' "$DEPLOY_STATE_DIR/admission.json")
  python3 scripts/deploy/bootstrap/admission.py create-volumes "$RETENTION_ATTEMPT_KEY" "$BOOTSTRAP_DAEMON"
}

bootstrap_verify_infrastructure() {
  local current_env_hash
  current_env_hash=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$COMPOSE_ENV_FILE")
  [ "$current_env_hash" = "$BOOTSTRAP_ENV_HASH" ] || { echo "ERROR: bootstrap Compose configuration changed." >&2; return 1; }
  python3 scripts/deploy/bootstrap/admission.py verify-infrastructure "$RETENTION_ATTEMPT_KEY" "$DEPLOY_STATE_DIR/admission.json" > "$DEPLOY_STATE_DIR/infrastructure.json"
  queue_control database-identity candidate > "$DEPLOY_STATE_DIR/bootstrap-app-database.json"
  queue_control database-identity candidate-direct > "$DEPLOY_STATE_DIR/bootstrap-direct-database.json"
  python3 - "$DEPLOY_STATE_DIR" <<'BOOTSTRAP_DATABASE'
import ipaddress, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
app = json.loads((root / 'bootstrap-app-database.json').read_text())['databaseIdentity']
direct = json.loads((root / 'bootstrap-direct-database.json').read_text())['databaseIdentity']
infra = json.loads((root / 'infrastructure.json').read_text())
if (app != direct or ipaddress.ip_interface(app['serverAddress']).ip
        != ipaddress.ip_address(infra['postgresAddress'])):
    raise SystemExit('Bootstrap database endpoints do not identify the new PostgreSQL service')
BOOTSTRAP_DATABASE
  local database_objects redis_keys
  database_objects=$(printf '%s\n' "$DIRECT_DATABASE_URL" | python3 scripts/deploy/database-command.py empty)
  [ "$database_objects" = 0 ] || { echo "ERROR: bootstrap database is not empty." >&2; return 1; }
  redis_keys=$(printf '%s\n' "$REDIS_PASSWORD" | docker exec -i sotto-prod-redis sh -ec 'IFS= read -r REDISCLI_AUTH; export REDISCLI_AUTH; exec redis-cli --raw DBSIZE')
  [ "$redis_keys" = 0 ] || { echo "ERROR: bootstrap Redis database is not empty." >&2; return 1; }
}

bootstrap_save_slot() {
  python3 - "$SLOT_FILE" "$NEW_SLOT" <<'BOOTSTRAP_SLOT'
import os, sys, tempfile
path, slot = sys.argv[1:]
descriptor, temporary = tempfile.mkstemp(dir=os.path.dirname(path))
try:
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(slot + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.link(temporary, path, follow_symlinks=False)
    directory = os.open(os.path.dirname(path), os.O_RDONLY | os.O_NOFOLLOW)
    try: os.fsync(directory)
    finally: os.close(directory)
finally:
    os.unlink(temporary)
BOOTSTRAP_SLOT
}

bootstrap_clear_marker() {
  python3 - "$UNRESOLVED_DEPLOYMENT" "$DEPLOY_STATE_DIR" "$IMAGE_OVERRIDES" "$SOTTO_STACK" <<'BOOTSTRAP_MARKER'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('compatibility_review', 'scripts/deploy/compatibility-review.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
path, state, overrides, stack = sys.argv[1:]
record = helper.mapping(helper.read_bytes(pathlib.Path(path), private=True))
if record != {'stack': stack, 'stateDirectory': state,
              'imageOverrides': overrides, 'phase': 'unresolved'}:
    raise SystemExit('Bootstrap recovery marker changed')
helper.clear_marker(pathlib.Path(path), state, 'unresolved')
BOOTSTRAP_MARKER
}
