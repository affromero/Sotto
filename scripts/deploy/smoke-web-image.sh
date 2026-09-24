#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: smoke-web-image.sh IMAGE}"
docker run --rm --network none --entrypoint node "$image" -e '
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const path = require("node:path");
  const native = require("thesidedoor-flock");
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "sotto-native-smoke-"));
  const file = path.join(directory, "state.lock");
  const descriptors = new Set();
  try {
    const first = fs.openSync(file, "a", 0o600);
    const second = fs.openSync(file, "a", 0o600);
    descriptors.add(first);
    descriptors.add(second);
    const flags = native.constants.LOCK_EX | native.constants.LOCK_NB;
    native.flock(first, flags);
    assert.throws(() => native.flock(second, flags), error =>
      ["EAGAIN", "EWOULDBLOCK"].includes(error.code));
    fs.closeSync(first);
    descriptors.delete(first);
    native.flock(second, flags);
    console.log("Standalone native file locking acquires, rejects contention and releases.");
  } finally {
    for (const descriptor of descriptors) fs.closeSync(descriptor);
    fs.rmSync(directory, { recursive: true });
  }
'
suffix="sotto-web-smoke-$$"
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker logs "${suffix}-web" >&2 || true; fi
  docker rm -f "${suffix}-web" "${suffix}-redis" "${suffix}-postgres" >/dev/null 2>&1 || true
  docker network rm "$suffix" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create --internal "$suffix" >/dev/null
docker run -d --name "${suffix}-redis" --network "$suffix" --network-alias redis redis:7-alpine >/dev/null
docker run -d --name "${suffix}-postgres" --network "$suffix" --network-alias postgres \
  -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=sotto pgvector/pgvector:pg17 >/dev/null
ready=false
for attempt in $(seq 1 60); do
  if docker exec "${suffix}-postgres" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then echo "Smoke PostgreSQL did not become ready" >&2; exit 1; fi
# Load the image's committed schema into the disposable database before auth runs.
docker run --rm --network none --entrypoint node "$image" -e '
  const fs = require("node:fs");
  for (const migration of fs.readdirSync("prisma/migrations").sort()) {
    const path = "prisma/migrations/" + migration + "/migration.sql";
    if (fs.existsSync(path)) process.stdout.write(fs.readFileSync(path, "utf8") + "\n");
  }
' | docker exec -i "${suffix}-postgres" psql -U postgres -d sotto -v ON_ERROR_STOP=1 >/dev/null
docker run -d --name "${suffix}-web" --network "$suffix" \
  -e DATABASE_URL=postgresql://postgres:smoke@postgres:5432/sotto \
  -e REDIS_URL=redis://redis:6379 \
  -e NEXTAUTH_SECRET=smoke-secret-used-only-in-isolated-tests \
  -e AUTH_TRUST_HOST=true \
  -e NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  -e BYOK_ENCRYPTION_KEY=00000000000000000000000000000000 \
  "$image" >/dev/null
expected=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
for attempt in $(seq 1 60); do
  if docker exec "${suffix}-web" node -e '
    fetch("http://127.0.0.1:3000/api/v1/health").then(async response => {
      const body = await response.json();
      if (!response.ok || body.status !== "healthy" || body.version !== process.argv[1]) process.exit(1);
      console.log("Standalone web, Prisma database query and Redis health passed: " + body.version);
    }).catch(() => process.exit(1));
  ' "$expected"; then exit 0; fi
  sleep 2
done
echo "Web image did not pass its database, Redis and release health checks" >&2
exit 1
