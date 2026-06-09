#!/usr/bin/env bash
# Sotto — expose your local instance on a secure public URL.
#
# Uses a Cloudflare "quick tunnel": no account, no config, no open ports — just a
# temporary https://<random>.trycloudflare.com address you can open from your
# phone or share with family. Stop it with Ctrl-C (the URL disappears).
#
# For a STABLE URL, use a named Cloudflare tunnel or Tailscale Funnel (both need
# a free account), or point a domain at the server and let Caddy handle TLS.
#
# Usage:  scripts/expose.sh [PORT]     (default 3000)
set -euo pipefail

PORT="${1:-3000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  cat <<EOF
cloudflared is not installed. Install it, then re-run this script:

  macOS:        brew install cloudflared
  Debian/Ubuntu: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
  Other:        https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Alternatives that give a STABLE URL (free account):
  • Tailscale Funnel:  tailscale funnel ${PORT}
  • Named CF tunnel:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
EOF
  exit 1
fi

echo "Starting a secure public tunnel to http://localhost:${PORT} …"
echo "Look for the https://<name>.trycloudflare.com URL below. Ctrl-C to stop."
echo
exec cloudflared tunnel --url "http://localhost:${PORT}"
