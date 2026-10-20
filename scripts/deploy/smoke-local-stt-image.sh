#!/usr/bin/env bash
set -euo pipefail
umask 077

stt_image=${1:?Usage: smoke-local-stt-image.sh STT_IMAGE FULL_SOURCE_SHA [NEW_EVIDENCE_DIR]}
source_sha=${2:?Supply the full source SHA}
if [[ ! "$source_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Supply an actual full source revision.' >&2
  exit 1
fi
stt_id=$(docker image inspect --format '{{.Id}}' "$stt_image")
actual_sha=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$stt_id")
if [[ "$actual_sha" != "$source_sha" ]]; then
  echo 'The transcription image source revision does not match.' >&2
  exit 1
fi
platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$stt_id")
if [[ "$platform" != linux/amd64 ]]; then
  echo 'Image qualification requires the published Linux amd64 target.' >&2
  exit 1
fi
retain=false
if [[ -n "${3:-}" ]]; then
  evidence=$3
  mkdir -m 700 "$evidence"
  retain=true
else
  evidence=$(mktemp -d)
fi
evidence=$(cd "$evidence" && pwd)
mkdir -m 777 "$evidence/stt"
docker image inspect "$stt_id" >"$evidence/stt-image.json"
stt_container=''
cleanup() {
  status=$?
  if [[ -n "$stt_container" ]]; then
    if ! docker rm -f "$stt_container" >/dev/null; then
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
  fi
  # Delete only the fixed container-owned child after retaining its host copy.
  if ! docker run --rm --pull never --network none --read-only --user 1000:1000 \
    --memory 64m --cpus 1 --pids-limit 16 --cap-drop ALL \
    --security-opt no-new-privileges \
    --mount "type=bind,source=$evidence/stt,target=/evidence" \
    --entrypoint /home/ubuntu/speaches/.venv/bin/python "$stt_id" \
    -c 'from pathlib import Path; import shutil; p=Path("/evidence/results"); shutil.rmtree(p) if p.exists() else None'; then
    if [[ "$status" == 0 ]]; then status=1; fi
  fi
  chmod 700 "$evidence/stt"
  if [[ "$retain" == true ]]; then
    echo "Retained public speech evidence: $evidence" >&2
  else
    rm -rf "$evidence"
  fi
  exit "$status"
}
trap cleanup EXIT

stt_container=$(docker create --pull never --network none --read-only --user 1000:1000 \
  --memory 2048m --cpus 2 --pids-limit 128 --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:size=128m,mode=1777 \
  --mount "type=bind,source=$evidence/stt,target=/evidence" \
  "$stt_id" /home/ubuntu/speaches/.venv/bin/python smoke.py \
  --audio-directory /home/ubuntu/speaches/fixtures --output-directory /evidence/results)
set +e
docker start --attach "$stt_container" >"$evidence/stt-receipt.json" 2>"$evidence/stt.stderr"
stt_attach_exit=$?
set -e
docker inspect "$stt_container" >"$evidence/stt-container.json"
# Preserve partial outcomes and server logs before evaluating the exit result.
set +e
docker cp "$stt_container:/evidence/results/." "$evidence/stt-copied"
stt_copy_exit=$?
docker cp "$stt_container:/home/ubuntu/speaches/fixtures/." "$evidence/fixtures"
fixture_copy_exit=$?
set -e
python3 - "$evidence" "$stt_attach_exit" "$stt_copy_exit" "$fixture_copy_exit" "$stt_id" <<'PY'
import json
import sys
from pathlib import Path

evidence = Path(sys.argv[1])
container = json.loads((evidence / "stt-container.json").read_bytes())[0]
receipt = {
    "attachExitCode": int(sys.argv[2]),
    "copyExitCode": int(sys.argv[3]),
    "fixtureCopyExitCode": int(sys.argv[4]),
    "containerExitCode": container["State"]["ExitCode"],
    "imageId": container["Image"],
    "oomKilled": container["State"]["OOMKilled"],
    "restartCount": container["RestartCount"],
}
(evidence / "stt-exit.json").write_text(json.dumps(receipt) + "\n")
if (
    container["Image"] != sys.argv[5]
    or container["State"]["OOMKilled"]
    or container["RestartCount"] != 0
    or any(receipt[field] != 0 for field in (
        "attachExitCode", "copyExitCode", "fixtureCopyExitCode", "containerExitCode"
    ))
):
    for name in ("stt-receipt.json", "stt.stderr"):
        print((evidence / name).read_text(), file=sys.stderr)
    raise SystemExit("Offline transcription qualification failed.")
qualification = json.loads((evidence / "stt-receipt.json").read_bytes())
if qualification.get("version") != 2 or qualification.get("qualificationPassed") is not True:
    raise SystemExit("Missing successful version 2 qualification receipt.")
PY
for sample in "$evidence/fixtures"/*.wav; do
  ffmpeg -nostdin -v error -i "$sample" -f null -
done
cat "$evidence/stt-receipt.json"
