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
  browser=$(find /ms-playwright -type f \( -name chrome-headless-shell -o -name headless_shell \) -executable -print -quit)
  if [ -z "$browser" ]; then
    echo "Playwright Chromium headless executable is missing from /ms-playwright" >&2
    exit 1
  fi
  "$browser" --headless --no-sandbox --disable-gpu --dump-dom "data:text/html,<h1>Browser smoke passed</h1>" | grep -q "Browser smoke passed"
'
