#!/usr/bin/env bash
set -euo pipefail
umask 077

stt_image=${1:?Usage: smoke-local-stt-image.sh STT_IMAGE PIPER_IMAGE FULL_SOURCE_SHA [NEW_EVIDENCE_DIR]}
piper_image=${2:?Supply the paired Piper image}
source_sha=${3:?Supply the full source SHA}
expected_text='Gestern bin ich zu Fuß zum Markt gegangen.'
if [[ ! "$source_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Supply an actual full source revision.' >&2
  exit 1
fi
for image in "$stt_image" "$piper_image"; do
  actual_sha=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
  if [[ "$actual_sha" != "$source_sha" ]]; then
    echo 'A paired speech image source revision does not match.' >&2
    exit 1
  fi
  platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
  if [[ "$platform" != linux/amd64 ]]; then
    echo 'Paired image qualification requires the published Linux amd64 target.' >&2
    exit 1
  fi
done
stt_id=$(docker image inspect --format '{{.Id}}' "$stt_image")
piper_id=$(docker image inspect --format '{{.Id}}' "$piper_image")

retain=false
if [[ -n "${4:-}" ]]; then
  evidence=$4
  mkdir -m 700 "$evidence"
  retain=true
else
  evidence=$(mktemp -d)
fi
mkdir "$evidence/piper" "$evidence/stt"
docker image inspect "$stt_id" >"$evidence/stt-image.json"
docker image inspect "$piper_id" >"$evidence/piper-image.json"
# The private parent contains public synthetic samples only. Container UID 1000
# writes these two child directories; the final retained evidence is made private.
chmod 777 "$evidence/piper" "$evidence/stt"
piper_container=''
stt_container=''
cleanup() {
  status=$?
  if [[ -n "$piper_container" ]]; then docker rm -f "$piper_container" >/dev/null || status=1; fi
  if [[ -n "$stt_container" ]]; then docker rm -f "$stt_container" >/dev/null || status=1; fi
  # Container-owned private outputs may belong to another UID on Linux CI.
  # Host-owned copies are retained; remove only the two fixed public outputs.
  for child in piper stt; do
    docker run --rm --pull never --network none --read-only --user 1000:1000 \
      --memory 64m --cpus 1 --pids-limit 16 --cap-drop ALL \
      --security-opt no-new-privileges \
      --mount "type=bind,source=$evidence/$child,target=/evidence" \
      --entrypoint /home/ubuntu/speaches/.venv/bin/python "$stt_id" \
      -c 'from pathlib import Path; import shutil; p=Path("/evidence/results"); shutil.rmtree(p) if p.exists() else None' || status=1
  done
  chmod 700 "$evidence/piper" "$evidence/stt"
  if [[ -f "$evidence/piper-receipt.json" ]]; then chmod 600 "$evidence/piper-receipt.json"; fi
  if [[ "$retain" == true ]]; then
    echo "Retained public speech evidence: $evidence" >&2
  else
    rm -rf "$evidence"
  fi
  exit "$status"
}
trap cleanup EXIT

piper_container=$(docker create --pull never --network none --read-only --user 1000:1000 \
  --memory 512m --cpus 2 --pids-limit 64 --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:size=128m,mode=1777 \
  --mount "type=bind,source=$evidence/piper,target=/evidence" \
  "$piper_id" python smoke.py --text "$expected_text" --output-directory /evidence/results)
set +e
docker start --attach "$piper_container" >"$evidence/piper-receipt.json" 2>"$evidence/piper.stderr"
piper_attach_exit=$?
set -e
piper_exit=$(docker inspect --format '{{.State.ExitCode}}' "$piper_container")
docker inspect "$piper_container" >"$evidence/piper-container.json"
python3 - "$evidence/piper-container.json" "$evidence/piper-exit.json" "$piper_attach_exit" "$piper_id" <<'PY'
import json
import sys

container = json.load(open(sys.argv[1]))[0]
receipt = {'attachExitCode': int(sys.argv[3]), 'containerExitCode': container['State']['ExitCode'], 'imageId': container['Image'], 'oomKilled': container['State']['OOMKilled'], 'restartCount': container['RestartCount']}
with open(sys.argv[2], 'w') as output:
    json.dump(receipt, output)
assert container['Image'] == sys.argv[4]
assert not container['State']['OOMKilled'] and container['RestartCount'] == 0
PY
if [[ "$piper_exit" != 0 || "$piper_attach_exit" != 0 ]]; then
  cat "$evidence/piper.stderr" >&2
  docker logs "$piper_container" >&2
  exit 1
fi
docker cp "$piper_container:/evidence/results/." "$evidence/piper-copied"
python3 - "$evidence/piper-receipt.json" "$expected_text" <<'PY'
import json
import sys

receipt = json.load(open(sys.argv[1]))
assert receipt['referenceText'] == sys.argv[2]
assert receipt['engine'] == 'piper'
samples = [sample for sample in receipt['measurements'] if sample['warm']]
assert len(samples) >= 2
assert len({sample['voiceId'] for sample in samples}) == len(samples)
assert len({sample['sha256'] for sample in samples}) == len(samples)
assert all(sample['sampleRate'] > 0 and sample['audioSeconds'] > 0 for sample in samples)
PY
for sample in "$evidence/piper-copied"/voice-*.wav; do
  ffmpeg -nostdin -v error -i "$sample" -f null -
done
chmod 644 "$evidence/piper-receipt.json"

stt_container=$(docker create --pull never --network none --read-only --user 1000:1000 \
  --memory 1024m --cpus 2 --pids-limit 128 --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:size=128m,mode=1777 \
  --mount "type=bind,source=$evidence/piper,target=/piper,readonly" \
  --mount "type=bind,source=$evidence/piper-receipt.json,target=/piper-receipt.json,readonly" \
  --mount "type=bind,source=$evidence/stt,target=/evidence" \
  "$stt_id" /home/ubuntu/speaches/.venv/bin/python smoke.py \
  --audio-directory /piper/results --piper-receipt /piper-receipt.json \
  --expected-text "$expected_text" --output-directory /evidence/results)
set +e
docker start --attach "$stt_container" >"$evidence/stt-receipt.json" 2>"$evidence/stt.stderr"
stt_attach_exit=$?
set -e
stt_exit=$(docker inspect --format '{{.State.ExitCode}}' "$stt_container")
docker inspect "$stt_container" >"$evidence/stt-container.json"
python3 - "$evidence/stt-container.json" "$evidence/stt-exit.json" "$stt_attach_exit" "$stt_id" <<'PY'
import json
import sys

container = json.load(open(sys.argv[1]))[0]
receipt = {'attachExitCode': int(sys.argv[3]), 'containerExitCode': container['State']['ExitCode'], 'imageId': container['Image'], 'oomKilled': container['State']['OOMKilled'], 'restartCount': container['RestartCount']}
with open(sys.argv[2], 'w') as output:
    json.dump(receipt, output)
assert container['Image'] == sys.argv[4]
assert not container['State']['OOMKilled'] and container['RestartCount'] == 0
PY
set +e
docker cp "$stt_container:/evidence/results/." "$evidence/stt-copied"
stt_copy_exit=$?
set -e
echo "$stt_copy_exit" >"$evidence/stt-copy-exit.txt"
if [[ "$stt_exit" != 0 || "$stt_attach_exit" != 0 || "$stt_copy_exit" != 0 ]]; then
  cat "$evidence/stt-receipt.json" >&2
  cat "$evidence/stt.stderr" >&2
  docker logs "$stt_container" >&2
  exit 1
fi
cat "$evidence/stt-receipt.json"
