#!/usr/bin/env bash
# Exercise the shipped Compose configuration using disposable data and no keys.
set -euo pipefail
umask 077

web_image="${1:?Usage: smoke-selfhost.sh WEB_IMAGE WORKER_IMAGE REVISION}"
worker_image="${2:?Missing worker image}"
revision="${3:?Missing expected revision}"
mode="${4:---published}"
case "$mode" in --published|--local) ;; *) echo 'Use --published or --local' >&2; exit 1 ;; esac
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
smoke_dir="$(mktemp -d)"
project="sotto-onboarding-$(date +%s)-$$"

compose() {
  docker compose --project-directory "$smoke_dir" -p "$project" \
    -f "$smoke_dir/docker-compose.yml" -f "$smoke_dir/smoke.yml" "$@"
}
cleanup() {
  status=$?
  if [ -f "$smoke_dir/smoke.yml" ]; then
    if [ "$status" -ne 0 ]; then compose logs --no-color --tail 150 >&2 || true; fi
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$smoke_dir"
}
trap cleanup EXIT

# Pulling without a preceding login is intentional in release CI. Do not use
# cached local builds as evidence that a first-time user can install a release.
if [ "$mode" = --published ]; then
  docker pull "$web_image"
  docker pull "$worker_image"
fi
for image in "$web_image" "$worker_image"; do
  actual="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
  [ "${actual:0:8}" = "${revision:0:8}" ] || {
    echo "Image revision mismatch: expected $revision, received $actual" >&2
    exit 1
  }
done

cp "$repo_root/docker-compose.selfhost.yml" "$smoke_dir/docker-compose.yml"
cp "$repo_root/scripts/agent/sync-cli-credentials.sh" "$smoke_dir/sync-cli-credentials.sh"
mkdir -p "$smoke_dir/empty-claude" "$smoke_dir/empty-codex"
password="$(openssl rand -hex 32)"
owner_password="$(openssl rand -hex 32)"
cat > "$smoke_dir/.env" <<EOF
POSTGRES_PASSWORD=$password
DATABASE_URL=postgresql://sotto:$password@postgres:5432/sotto?schema=public
DIRECT_DATABASE_URL=postgresql://sotto:$password@postgres:5432/sotto?schema=public
REDIS_URL=redis://redis:6379
BYOK_ENCRYPTION_KEY=$(openssl rand -hex 32)
WEB_PORT=0
NEXT_PUBLIC_APP_URL=http://localhost:3000
SELF_HOSTED=true
SIDEDOOR_EXECUTION_DIR=./.sotto/executions
EOF
cat > "$smoke_dir/smoke.yml" <<EOF
services:
  web:
    image: $web_image
  workers:
    image: $worker_image
  credential-sync:
    volumes:
      - $smoke_dir/empty-claude:/host-claude:ro
      - $smoke_dir/empty-codex:/host-codex:ro
EOF

compose config --quiet
if [ "$mode" = --published ]; then compose pull; fi
compose up -d --wait --wait-timeout 120 postgres redis credential-sync
compose run --rm workers sh -ec \
  'cd /app && npx --no-install prisma migrate deploy --config=/app/prisma.config.ts && npx --no-install tsx apps/web/prisma/seed-curriculum.ts'
compose run --rm workers sh -ec \
  'cd /app && npx --no-install tsx apps/web/prisma/seed-curriculum.ts'
compose run --rm web node dist/access.cjs initialize
compose run --rm web node dist/access.cjs finalize
SIDEDOOR_SMOKE_OWNER_PASSWORD="$owner_password" python3 - "$smoke_dir" "$project" <<'PY'
import os
import pty
import select
import subprocess
import sys
import time

directory, project = sys.argv[1:]
master, slave = pty.openpty()
command = [
    'docker', 'compose', '--project-directory', directory, '-p', project,
    '-f', f'{directory}/docker-compose.yml', '-f', f'{directory}/smoke.yml',
    'run', '--rm', 'web', 'node', 'dist/access.cjs', 'setup',
]
process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
prompts = [
    (b'First Admin profile name: ', b'Owner\n'),
    (b'Shared password: ', os.environ['SIDEDOOR_SMOKE_OWNER_PASSWORD'].encode() + b'\n'),
    (b'Confirm shared password: ', os.environ['SIDEDOOR_SMOKE_OWNER_PASSWORD'].encode() + b'\n'),
]
seen = bytearray()
deadline = time.monotonic() + 90
try:
    for prompt, answer in prompts:
        while prompt not in seen:
            if time.monotonic() >= deadline:
                raise RuntimeError('Local household setup timed out')
            if select.select([master], [], [], 1)[0]:
                seen.extend(os.read(master, 4096))
        os.write(master, answer)
        seen.clear()
    if process.wait(timeout=30) != 0:
        raise RuntimeError('Local household setup failed')
finally:
    os.close(master)
PY
owner_id="$(compose run --rm web node dist/access.cjs list | python3 -c 'import json,sys; text=sys.stdin.read(); state=json.loads(text[text.index("{"):]); print(next(p["id"] for p in state["principals"] if p["role"]=="owner"))')"
[ -n "$owner_id" ]
compose up -d --wait --wait-timeout 180

compose exec -T workers node --import tsx --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Queue } from 'bullmq';
import { prisma } from './src/lib/prisma.ts';
assert.ok(await prisma.curriculum.count() > 0, 'Fresh database has no curriculum');
await prisma.$disconnect();
await writeFile('.sotto/storage/onboarding-smoke.txt', 'shared storage works');
const queues = ['content-extraction', 'audio-generation', 'speaking-grading'].map(
  name => new Queue(name, { connection: { host: 'redis', port: 6379 } })
);
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    const workers = await Promise.all(queues.map(queue => queue.getWorkers()));
    if (workers.every(entries => entries.length > 0)) break;
    assert.ok(attempt < 29, 'Learning workers did not register with Redis');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally {
  await Promise.all(queues.map(queue => queue.close()));
}
NODE

compose exec -T -e SIDEDOOR_SMOKE_OWNER_ID="$owner_id" -e SIDEDOOR_SMOKE_OWNER_PASSWORD="$owner_password" web node --input-type=module - "$revision" <<'NODE'
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
const base = 'http://localhost:3000';
const request = (path, options = {}) => fetch(base + path, {
  ...options,
  headers: { origin: base, ...options.headers },
  signal: AbortSignal.timeout(30000),
  redirect: 'manual',
});
const response = await request('/api/v1/health');
assert.equal(response.status, 200);
const health = await response.json();
assert.equal(health.status, 'healthy');
assert.equal(health.version.slice(0, 8), process.argv[2].slice(0, 8));
const locked = await request('/api/v1/onboarding/config');
assert.equal(locked.status, 401, 'Onboarding must require the instance password');
const admission = await request('/api/v1/access/household', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.SIDEDOOR_SMOKE_OWNER_PASSWORD }),
});
assert.equal(admission.status, 200, 'Fresh instance household admission failed');
const cookie = admission.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'Household admission did not issue a cookie');
const selected = await request('/api/v1/access/select-profile', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ id: process.env.SIDEDOOR_SMOKE_OWNER_ID }),
});
assert.equal(selected.status, 200, 'First Admin profile could not be selected');
const config = await request('/api/v1/onboarding/config', { headers: { cookie } });
assert.equal(config.status, 200);
const onboarding = await config.json();
assert.equal(onboarding.selfHosted, true);
assert.equal(onboarding.isOwner, true, 'Fresh learner cannot configure their instance');
const welcome = await request('/welcome', { headers: { cookie } });
assert.equal(welcome.status, 200, 'Welcome wizard cannot load');
assert.equal(await readFile('.sotto/storage/onboarding-smoke.txt', 'utf8'), 'shared storage works');
await unlink('.sotto/storage/onboarding-smoke.txt');
console.log('Clean self-host install: migrations, curriculum, workers, storage, password and welcome passed');
NODE
