#!/usr/bin/env bash
# Verify bundled media and a rendered native status title.
set -euo pipefail

image=$(realpath "${1:?Usage: test-desktop-appimage.sh path/to/Sotto.AppImage}")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
chmod +x "$image"
"$image" --appimage-extract >/dev/null
if ! find squashfs-root -name libgstapp.so -print -quit | grep -q .; then
  echo 'AppImage is missing the GStreamer appsink plugin (libgstapp.so)' >&2
  exit 1
fi

# A build passing does not establish that the WebKit renderer can start.
set +e
timeout 30s xvfb-run -a dbus-run-session -- bash -c '
  set -euo pipefail
  ./squashfs-root/AppRun &
  launcher_pid=$!
  trap "kill $launcher_pid 2>/dev/null || true; wait $launcher_pid 2>/dev/null || true" EXIT
  for attempt in $(seq 1 25); do
    if ! kill -0 "$launcher_pid" 2>/dev/null; then
      echo "AppImage exited before the frontend became ready" >&2
      exit 1
    fi
    if xdotool search --onlyvisible --name "^Sotto Host: " >/dev/null 2>&1; then
      echo "AppImage frontend rendered status and updated its native window through IPC"
      exit 0
    fi
    sleep 1
  done
  echo "AppImage frontend did not render a status within 25 seconds" >&2
  exit 1
' >startup.log 2>&1
status=$?
set -e
cat startup.log
if [ "$status" -ne 0 ]; then
  echo "AppImage startup verification failed (status $status)" >&2
  exit 1
fi
if grep -Ei 'appsink.*not found|GStreamer element.*not found|symbol lookup error|error while loading shared libraries|segmentation fault|failed to load.*(webkit|gtk)|GLib-GObject-CRITICAL' startup.log; then
  echo 'AppImage renderer reported a runtime dependency failure' >&2
  exit 1
fi
