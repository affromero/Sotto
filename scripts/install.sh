#!/usr/bin/env bash
# Sotto — one-command self-host installer.
# Usage: curl -fsSL https://raw.githubusercontent.com/SottoFM/sotto/main/scripts/install.sh | bash
#
# Pulls the pre-built public images, asks how you want to connect your AI agent,
# writes ~/.sotto/.env, and starts everything with Docker. No clone, no build.
# Inspect before running:  curl -fsSL <url>/scripts/install.sh | less
set -euo pipefail

BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RESET=$(printf '\033[0m')
CYAN=$(printf '\033[36m'); GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m'); RED=$(printf '\033[31m')
info() { printf "${CYAN}${BOLD}>${RESET} %b\n" "$1"; }
ok()   { printf "${GREEN}${BOLD}✓${RESET} %b\n" "$1"; }
warn() { printf "${YELLOW}${BOLD}!${RESET} %b\n" "$1"; }
fail() { printf "${RED}${BOLD}✗${RESET} %b\n" "$1"; exit 1; }

SOTTO_DIR="${SOTTO_DIR:-$HOME/.sotto}"
SOTTO_REF="${SOTTO_REF:-main}"
RAW_BASE="${SOTTO_RAW_BASE:-https://raw.githubusercontent.com/SottoFM/sotto/${SOTTO_REF}}"
WEB_PORT="${WEB_PORT:-3000}"

# Read a prompt from the real terminal so it works through `curl | bash`.
ask() { local __var=$1 __prompt=$2 __default=${3:-} __reply; printf "%b" "$__prompt" > /dev/tty; read -r __reply < /dev/tty || true; printf -v "$__var" '%s' "${__reply:-$__default}"; }

gen_secret() { openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# ---------------------------------------------------------------------------
# 0. Transparency + consent
# ---------------------------------------------------------------------------
printf "\n${BOLD}Sotto${RESET} — learn a language with the agent that already knows you.\n\n"
printf "This installer will:\n"
printf "  ${DIM}1.${RESET} Pull the Sotto images + Postgres/Redis (Docker only, no build)\n"
printf "  ${DIM}2.${RESET} Ask how to connect your AI agent\n"
printf "  ${DIM}3.${RESET} Write config to ${BOLD}%s${RESET} and start everything\n\n" "$SOTTO_DIR"
if [ "${SOTTO_YES:-}" != "1" ]; then
  ask CONSENT "  Continue? [Y/n] " "Y"
  case "$CONSENT" in [nN]*) fail "Aborted.";; esac
fi

# ---------------------------------------------------------------------------
# 1. Docker + compose
# ---------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "Docker is required.\n  Install: ${BOLD}https://docs.docker.com/get-docker/${RESET}\n  Then re-run this installer."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker and re-run."
if docker compose version >/dev/null 2>&1; then DC="docker compose";
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose";
else fail "Docker Compose v2 is required.\n  Install: ${BOLD}https://docs.docker.com/compose/install/${RESET}"; fi
ok "Docker is ready ($DC)."

# ---------------------------------------------------------------------------
# 2. Install dir + compose file
# ---------------------------------------------------------------------------
mkdir -p "$SOTTO_DIR"
info "Downloading the self-host compose file..."
curl -fsSL "$RAW_BASE/docker-compose.selfhost.yml" -o "$SOTTO_DIR/docker-compose.yml" \
  || fail "Could not download docker-compose.selfhost.yml from $RAW_BASE"
rm -f "$SOTTO_DIR/docker-compose.override.yml"

# Port (offer a different one if 3000 is taken)
if (command -v lsof >/dev/null 2>&1 && lsof -i ":$WEB_PORT" >/dev/null 2>&1); then
  warn "Port $WEB_PORT is in use."
  ask WEB_PORT "  Use a different port [default: 3001]: " "3001"
fi

# ---------------------------------------------------------------------------
# 3. Choose how to connect your AI agent
# ---------------------------------------------------------------------------
printf "\n${BOLD}How should Sotto reach your AI agent?${RESET}\n"
printf "  ${DIM}1)${RESET} An API key (OpenAI or Anthropic) — simplest\n"
printf "  ${DIM}2)${RESET} Your local Claude Code / Codex CLI (bring your own agent)\n"
printf "  ${DIM}3)${RESET} Your agent on a VPS, over SSH\n"
ask AGENT_CHOICE "  Choose [1/2/3, default 1]: " "1"

AI_BLOCK=""
TUNNEL_NOTE=""
case "$AGENT_CHOICE" in
  2)
    if command -v claude >/dev/null 2>&1; then AGENT_CLI="claude-code"; ok "Found the 'claude' CLI.";
    elif command -v codex >/dev/null 2>&1; then AGENT_CLI="codex"; ok "Found the 'codex' CLI.";
    else AGENT_CLI="claude-code"; warn "No claude/codex CLI found on PATH; defaulting to claude-code (install it later)."; fi
    AI_BLOCK="AI_PROVIDER=\"$AGENT_CLI\""
    CREDS="$HOME/.claude/.credentials.json"
    if [ -f "$CREDS" ]; then
      AI_BLOCK="$AI_BLOCK"$'\n'"CLAUDE_CODE_CREDENTIALS_JSON='$(tr -d '\n' < "$CREDS")'"
      ok "Passed your local Claude credentials to the container."
    else
      warn "No ~/.claude/.credentials.json found — sign in with the claude CLI, then re-run, or use option 1/3."
    fi
    ;;
  3)
    ask SSH_HOST "  SSH host for your agent (e.g. you@your-vps): " ""
    [ -n "$SSH_HOST" ] || fail "An SSH host is required for option 3."
    AI_BLOCK=$'AI_PROVIDER="claude-code"\n'"CLAUDE_CODE_SSH_HOST=\"$SSH_HOST\""
    # Mount the host SSH keys so the containers can reach the VPS (key-based auth).
    cat > "$SOTTO_DIR/docker-compose.override.yml" <<YAML
services:
  web:
    volumes:
      - $HOME/.ssh:/home/sotto/.ssh:ro
  workers:
    volumes:
      - $HOME/.ssh:/home/sotto/.ssh:ro
YAML
    ok "Sotto will run 'ssh $SSH_HOST claude ...' for every LLM call."
    ;;
  *)
    ask AI_KEY_PROVIDER "  Provider [openai/anthropic, default openai]: " "openai"
    ask AI_KEY "  API key: " ""
    [ -n "$AI_KEY" ] || fail "An API key is required for option 1."
    if [ "$AI_KEY_PROVIDER" = "anthropic" ]; then
      AI_BLOCK=$'AI_PROVIDER="anthropic"\nTTS_PROVIDER="openai"\nSTT_PROVIDER="openai"\n'"ANTHROPIC_API_KEY=\"$AI_KEY\""
      warn "Anthropic covers the LLM; set OPENAI_API_KEY in $SOTTO_DIR/.env for audio (listening/speaking)."
    else
      AI_BLOCK=$'AI_PROVIDER="openai"\nTTS_PROVIDER="openai"\nSTT_PROVIDER="openai"\n'"OPENAI_API_KEY=\"$AI_KEY\""
    fi
    ;;
esac

# ---------------------------------------------------------------------------
# 4. Write .env
# ---------------------------------------------------------------------------
DB_URL="postgresql://sotto:sotto@postgres:5432/sotto?schema=public"
cat > "$SOTTO_DIR/.env" <<ENV
# Generated by the Sotto installer. Edit and re-run \`$DC up -d\` to apply.
WEB_PORT=$WEB_PORT
SOTTO_IMAGE_TAG=latest

DATABASE_URL=$DB_URL
DIRECT_DATABASE_URL=$DB_URL
REDIS_URL=redis://redis:6379

AUTH_SECRET=$(gen_secret)
BYOK_ENCRYPTION_KEY=$(gen_secret)
NEXTAUTH_URL=http://localhost:$WEB_PORT
NEXT_PUBLIC_APP_URL=http://localhost:$WEB_PORT

STORAGE_PROVIDER=local
LOCAL_STORAGE_DIR=./.sotto/storage
PAYMENT_PROVIDER=none

$AI_BLOCK
ENV
ok "Wrote $SOTTO_DIR/.env"

# ---------------------------------------------------------------------------
# 5. Pull, start, initialize the database, seed the curriculum
# ---------------------------------------------------------------------------
cd "$SOTTO_DIR"
info "Pulling images (first run can take a few minutes)..."
$DC pull
info "Starting Postgres and Redis..."
$DC up -d postgres redis
info "Waiting for the database..."
for _ in $(seq 1 30); do $DC exec -T postgres pg_isready -U sotto -d sotto >/dev/null 2>&1 && break; sleep 2; done

info "Creating the schema and seeding the language curriculum..."
$DC run --rm workers sh -c "cd /app/apps/web && npx prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss && npx tsx prisma/seed-curriculum.ts" \
  || fail "Database initialization failed. Check '$DC logs' and re-run."

info "Starting Sotto..."
$DC up -d

info "Waiting for Sotto to come up..."
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$WEB_PORT/api/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done

printf "\n"
if [ "${READY:-}" = "1" ]; then ok "Sotto is running."; else warn "Sotto is starting; give it a moment."; fi
printf "\n  ${BOLD}Open:${RESET}    http://localhost:%s\n" "$WEB_PORT"
printf "  ${BOLD}Manage:${RESET}  cd %s  (then \`%s logs -f\`, \`%s down\`)\n" "$SOTTO_DIR" "$DC" "$DC"

# ---------------------------------------------------------------------------
# Reachability — open it on your phone / share with family (opt-in)
# ---------------------------------------------------------------------------
printf "\n  ${BOLD}Reach it from your phone or share with family?${RESET}\n"
ask EXPOSE "  Open a secure public URL now with a Cloudflare quick tunnel (no account)? [y/N]: " "N"
case "$EXPOSE" in
  [yY]*)
    if command -v cloudflared >/dev/null 2>&1; then
      info "Starting a secure tunnel — copy the https://<name>.trycloudflare.com URL, Ctrl-C to stop."
      cloudflared tunnel --url "http://localhost:$WEB_PORT" || warn "Tunnel exited."
    else
      warn "cloudflared isn't installed. Install it (macOS: \`brew install cloudflared\`), then run:"
      printf "    cloudflared tunnel --url http://localhost:%s\n" "$WEB_PORT"
    fi
    ;;
  *)
    printf "\n  ${DIM}Later, to reach it from anywhere:${RESET}\n"
    printf "    Quick public URL (no account):  cloudflared tunnel --url http://localhost:%s\n" "$WEB_PORT"
    printf "    Stable URL (free account):      tailscale funnel %s\n" "$WEB_PORT"
    printf "    Same VPS as your agent:         ssh -L %s:localhost:%s your-vps  ${DIM}# then localhost:%s${RESET}\n" "$WEB_PORT" "$WEB_PORT" "$WEB_PORT"
    printf "    Own domain:                     point DNS at this server; Caddy handles TLS\n"
    printf "\n  ${DIM}Then on a phone/tablet: open the URL, or Settings -> Devices for a scan-to-connect code.${RESET}\n"
    ;;
esac
printf "\n"
