#!/bin/bash
set -e

echo "🎙️  Setting up Sotto..."

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install from https://docker.com"; exit 1; }

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Start Docker services
echo "🐳 Starting PostgreSQL and Redis..."
docker-compose up -d

# Wait for services
echo "⏳ Waiting for services to be ready..."
sleep 3

# Generate .env.local if not exists
if [ ! -f .env.local ]; then
  echo "🔐 Generating .env.local..."
  NEXTAUTH_SECRET=$(openssl rand -base64 32)
  cat > .env.local << EOF
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sotto?schema=public"
REDIS_URL="redis://localhost:6379"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
NEXTAUTH_URL="http://localhost:3000"
EOF
  echo "   Created .env.local with auto-generated secrets"
fi

# Push database schema
echo "🗄️  Pushing database schema..."
npx prisma db push

# Generate Prisma client
npx prisma generate

echo ""
echo "✅ Sotto is ready!"
echo ""
echo "   npm run dev        Start development server"
echo "   npm run dev:web    Start web only"
echo "   npm run dev:workers Start workers only"
echo ""
