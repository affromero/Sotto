#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Setting up Sotto..."

# Install all system dependencies (node, docker, uv, pandoc)
bash "$SCRIPT_DIR/install-deps.sh" --all

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

# Install Python dependencies (pitch rebuild pipeline)
echo "Installing Python dependencies..."
uv sync --group pitch

# Start Docker services
echo "Starting PostgreSQL and Redis..."
docker-compose up -d

# Wait for services
echo "Waiting for services to be ready..."
sleep 3

# Generate .env.local if not exists
if [ ! -f .env.local ]; then
  echo "Generating .env.local..."
  AUTH_SECRET=$(openssl rand -base64 32)
  BYOK_ENCRYPTION_KEY=$(openssl rand -hex 32)
  cat > .env.local << EOF
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sotto?schema=public"
DIRECT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sotto?schema=public"
REDIS_URL="redis://localhost:6379"
AUTH_SECRET="${AUTH_SECRET}"
NEXTAUTH_SECRET="${AUTH_SECRET}"
NEXTAUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
BYOK_ENCRYPTION_KEY="${BYOK_ENCRYPTION_KEY}"
STORAGE_PROVIDER="local"
LOCAL_STORAGE_DIR="./.sotto/storage"
PAYMENT_PROVIDER="none"
AI_PROVIDER="anthropic"
TTS_PROVIDER="openai"
STT_PROVIDER="openai"
EOF
  echo "  Created .env.local with auto-generated secrets"
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
