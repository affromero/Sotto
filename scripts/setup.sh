#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"
ENV_TEMPLATE="$REPO_ROOT/.env.oss.example"

echo "Setting up Sotto..."

cd "$REPO_ROOT"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Error: Docker Compose is required."
    exit 1
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" {
      print key "=\"" value "\""
      updated = 1
      next
    }
    { print }
    END {
      if (updated == 0) {
        print key "=\"" value "\""
      }
    }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

wait_for_service() {
  local service="$1"
  local check_command="$2"
  local attempts=30

  for _ in $(seq 1 "$attempts"); do
    if compose exec -T "$service" sh -c "$check_command" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Error: $service did not become ready in ${attempts}s."
  exit 1
}

# Install only the dependencies needed for local OSS app development.
bash "$SCRIPT_DIR/install-deps.sh" --node --docker --ffmpeg

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

# Start Docker services
echo "Starting PostgreSQL and Redis..."
compose up -d postgres redis

# Wait for services
echo "Waiting for services to be ready..."
wait_for_service postgres "pg_isready -U postgres"
wait_for_service redis "redis-cli ping | grep -q PONG"

# Generate .env.local if not exists
if [ ! -f "$ENV_FILE" ]; then
  echo "Generating .env.local..."
  AUTH_SECRET=$(openssl rand -base64 32)
  BYOK_ENCRYPTION_KEY=$(openssl rand -hex 32)

  cp "$ENV_TEMPLATE" "$ENV_FILE"
  set_env_value AUTH_SECRET "$AUTH_SECRET"
  set_env_value NEXTAUTH_SECRET "$AUTH_SECRET"
  set_env_value BYOK_ENCRYPTION_KEY "$BYOK_ENCRYPTION_KEY"

  echo "  Created .env.local with auto-generated secrets"
else
  echo "Using existing .env.local"
fi
mkdir -p .sotto/storage

# Push database schema
echo "Pushing database schema..."
npx prisma db push --schema=apps/web/prisma/schema.prisma

# Generate Prisma client
npx prisma generate --schema=apps/web/prisma/schema.prisma

echo ""
echo "Sotto is ready!"
echo ""
echo "  npm run dev         Start development server"
echo "  npm run dev:web     Start web only"
echo "  npm run dev:workers Start workers only"
echo ""
echo "Next required setup:"
echo "  1. Add one provider path to .env.local."
echo "     Fastest path: set OPENAI_API_KEY and keep AI_PROVIDER/TTS_PROVIDER/STT_PROVIDER as openai."
echo "  2. Or set AI_PROVIDER=claude-code and keep an explicit TTS provider key."
echo "  3. Open http://localhost:3000 after npm run dev."
echo ""
