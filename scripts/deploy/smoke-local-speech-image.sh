#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: smoke-local-speech-image.sh IMAGE FULL_SOURCE_SHA}
source_sha=${2:?Supply the full source SHA}
actual_sha=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
if [[ ! "$source_sha" =~ ^[a-f0-9]{40}$ || "$actual_sha" != "$source_sha" ]]; then
  echo 'Local speech image source revision does not match.' >&2
  exit 1
fi
image_id=$(docker image inspect --format '{{.Id}}' "$image")

evidence=$(mktemp -d)
mkdir "$evidence/samples"
# The parent stays private. The container's unprivileged UID writes only these
# generic smoke samples, which are copied back with the invoking user's owner.
chmod 777 "$evidence/samples"
container=''
cleanup() {
  status=$?
  if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null || status=1; fi
  # Remove only this invocation's fixed outputs as their container owner.
  docker run --rm --pull never --network none --read-only --user 1000:1000 \
    --memory 64m --cpus 1 --pids-limit 16 --cap-drop ALL \
    --security-opt no-new-privileges \
    --mount "type=bind,source=$evidence/samples,target=/evidence" \
    --entrypoint python "$image_id" \
    -c 'from pathlib import Path; import shutil; p=Path("/evidence/results"); shutil.rmtree(p) if p.exists() else None' || status=1
  rm -rf "$evidence" || status=1
  exit "$status"
}
trap cleanup EXIT

container=$(docker create --pull never --network none --read-only --user 1000:1000 \
  --memory 512m --cpus 2 --pids-limit 64 --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:size=128m,mode=1777 \
  --mount "type=bind,source=$evidence/samples,target=/evidence" \
  "$image_id" python smoke.py --output-directory /evidence/results)
set +e
docker start --attach "$container" >"$evidence/receipt.json" 2>"$evidence/container.stderr"
attach_exit=$?
set -e
actual_exit=$(docker inspect --format '{{.State.ExitCode}}' "$container")
docker inspect "$container" >"$evidence/container.json"
if [[ "$attach_exit" != 0 || "$actual_exit" != 0 ]]; then
  echo "Piper smoke attach exit $attach_exit, container exit $actual_exit." >&2
  cat "$evidence/container.stderr" >&2
  docker logs "$container" >&2
  exit 1
fi
python3 - "$evidence/container.json" "$image_id" <<'PY'
import json
import sys

container = json.load(open(sys.argv[1]))[0]
assert container['Image'] == sys.argv[2]
assert not container['State']['OOMKilled'] and container['RestartCount'] == 0
PY
docker cp "$container:/evidence/results/." "$evidence"
python3 - "$evidence/receipt.json" <<'PY'
import json
import sys

with open(sys.argv[1]) as handle:
    receipt = json.load(handle)
assert receipt['engine'] == 'piper'
measurements = receipt['measurements']
warm = [sample for sample in measurements if sample['warm']]
native_rates = {'de-thorsten-medium': 22050, 'de-kerstin-low': 16000}
assert {sample['voiceId'] for sample in warm} == set(native_rates)
assert len({sample['voiceId'] for sample in warm}) == len(warm)
assert len({sample['sha256'] for sample in warm}) == len(warm)
assert all(sample['audioSeconds'] > 0 and sample['sampleRate'] == native_rates[sample['voiceId']] for sample in warm)
assert receipt['peakRssBytes'] > 0
print(json.dumps(receipt))
PY
for sample in "$evidence"/voice-*.wav; do
  ffmpeg -nostdin -v error -i "$sample" -f null -
done
