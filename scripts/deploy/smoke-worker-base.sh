#!/usr/bin/env bash
set -euo pipefail
image="${1:?Usage: smoke-worker-base.sh IMAGE}"
docker run --rm --network none --entrypoint sh "$image" -ec '
  test ! -d /root/.npm/_cacache
  claude --version
  codex --version
  ffmpeg -version >/dev/null
  python3 --version
  yt-dlp --version
  browser=$(find /ms-playwright -type f -name chrome-headless-shell -executable -print -quit)
  test -n "$browser"
  "$browser" --headless --no-sandbox --disable-gpu --dump-dom "data:text/html,<h1>Browser smoke passed</h1>" | grep -q "Browser smoke passed"
'
