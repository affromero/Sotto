#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: smoke-worker-image.sh IMAGE}"
suffix="sotto-image-smoke-$$"
cleanup() {
  docker rm -f "${suffix}-redis" "${suffix}-postgres" >/dev/null 2>&1 || true
  docker network rm "$suffix" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create --internal "$suffix" >/dev/null
docker run -d --name "${suffix}-redis" --network "$suffix" --network-alias redis redis:7-alpine >/dev/null
docker run -d --name "${suffix}-postgres" --network "$suffix" --network-alias postgres \
  -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=sotto pgvector/pgvector:pg17 >/dev/null
ready=false
for attempt in $(seq 1 60); do
  if docker exec "${suffix}-postgres" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then echo "Smoke PostgreSQL did not become ready" >&2; exit 1; fi

docker run --rm --network "$suffix" \
  -e DATABASE_URL=postgresql://postgres:smoke@postgres:5432/sotto \
  -e REDIS_URL=redis://redis:6379 \
  -e NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  -e BYOK_ENCRYPTION_KEY=00000000000000000000000000000000 \
  --entrypoint sh "$image" -ec '
    npx --no-install prisma migrate deploy --config=/app/prisma.config.ts
    claude --version
    codex --version
    ffmpeg -version >/dev/null
    node --import tsx --input-type=module -e '\''
      import { createRequire } from "node:module";
      import { readdir } from "node:fs/promises";
      import assert from "node:assert/strict";
      import { chromium } from "playwright";
      const require = createRequire(import.meta.url);
      for (const name of ["vitest", "eslint"]) {
        assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });
      }
      await import("./src/generated/prisma/client.ts");
      for (const file of await readdir("src/workers")) {
        if (file.endsWith(".worker.ts")) await import(`./src/workers/${file}`);
      }
      const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      const page = await browser.newPage();
      await page.setContent("<h1>Worker image smoke</h1>");
      const pdf = await page.pdf();
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      await browser.close();
      console.log("Worker imports, migrations, CLIs and Chromium PDF passed");
      process.exit(0);
    '\''
  '
