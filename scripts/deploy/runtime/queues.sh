#!/usr/bin/env bash
# Shared queue control for rolling and fenced deployments. Sourced by deploy.sh.
queue_control() {
  local command="$1" mode="${2:-running}" container="" ids payload raw report service
  if [ "$mode" != candidate ] && [ "$mode" != candidate-direct ]; then
    [ "$mode" = running ] || [ "$mode" = previous ] || return 1
    for service in workers-light workers-pipeline workers-heavy; do
      ids=$(docker ps -q --no-trunc --filter "label=com.docker.compose.project=$SOTTO_STACK" --filter "label=com.docker.compose.service=$service")
      if [ -n "$ids" ]; then
        if [ "$(printf '%s\n' "$ids" | wc -l | tr -d ' ')" != 1 ]; then
          echo "ERROR: ambiguous deployment control worker." >&2
          return 1
        fi
        container="$ids"
        break
      fi
    done
    if [ -z "$container" ]; then echo "ERROR: no running worker can supervise the queue lifecycle." >&2; return 1; fi
    if [ "$mode" = previous ]; then
      local captured
      captured=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["x-captured-containers"][sys.argv[2]])' "$PREVIOUS_WORKER_IMAGES" "$service")
      [ "$container" = "$captured" ] || { echo "ERROR: previous database control worker changed." >&2; return 1; }
    fi
  fi
  payload=$(python3 - "$command" "$QUEUE_MANIFEST" <<'QUEUE_INPUT'
import json, pathlib, sys
command, path = sys.argv[1:]
value = {'command': command}
if command not in ('snapshot', 'established', 'activation-ready', 'database-identity'):
    value['manifest'] = json.loads(pathlib.Path(path).read_text())
print(json.dumps(value))
QUEUE_INPUT
  ) || return 1
  raw=$(mktemp "$DEPLOY_STATE_DIR/queue-$command.log.XXXXXX")
  if [ "$mode" = candidate ] || [ "$mode" = candidate-direct ]; then
    local control_database_url="$DATABASE_URL"
    if [ "$mode" = candidate-direct ]; then control_database_url="${DIRECT_DATABASE_URL:-$DATABASE_URL}"; fi
    printf '%s\n' "$payload" | DATABASE_URL="$control_database_url" docker compose -f "$COMPOSE_WORKERS" -f "$WORKER_IMAGES" -p "$SOTTO_STACK" run --rm --no-deps --pull never -T -e DATABASE_URL workers-heavy node --import tsx -e "$QUEUE_HELPER" > "$raw" || return 1
  else
    printf '%s\n' "$payload" | docker exec -i -w /app/apps/web "$container" node --import tsx -e "$QUEUE_HELPER" > "$raw" || return 1
  fi
  report=$(python3 - "$raw" "$mode" "$container" <<'QUEUE_OUTPUT'
import json, pathlib, sys
lines = [line.removeprefix('SOTTO_DEPLOY_QUEUE=') for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if line.startswith('SOTTO_DEPLOY_QUEUE=')]
assert len(lines) == 1, 'Missing queue lifecycle report'
report = json.loads(lines[0])
if sys.argv[2] == 'previous':
    report['controlContainerId'] = sys.argv[3]
print(json.dumps(report))
QUEUE_OUTPUT
  ) || return 1
  if [ "$command" = snapshot ]; then
    printf '%s\n' "$report" | python3 -c 'import os,sys; path=sys.argv[1]; stream=open(path,"x"); stream.write(sys.stdin.read()); stream.flush(); os.fsync(stream.fileno()); stream.close(); directory=os.open(os.path.dirname(path),os.O_RDONLY); os.fsync(directory); os.close(directory)' "$QUEUE_MANIFEST" || return 1
  fi
  printf '%s\n' "$report"
}

wait_for_worker_drain() {
  local command="${1:-drained}" deadline=$((SECONDS + 1200)) report
  while true; do
    report=$(queue_control "$command") || return 1
    if printf '%s\n' "$report" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["drained"] else 1)'; then return 0; fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "ERROR: worker drain did not settle. No forced termination." >&2
      return 1
    fi
    sleep 2
  done
}
