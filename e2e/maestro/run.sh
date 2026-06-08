#!/usr/bin/env bash
set -euo pipefail

# Maestro mobile E2E runner — macOS only (iOS simulator)
#
# Usage:
#   ./e2e/maestro/run.sh                       Run all flows
#   ./e2e/maestro/run.sh flows/01-auth.yaml    Run specific flow
#   ./e2e/maestro/run.sh --tags critical       Run flows tagged "critical"
#   ./e2e/maestro/run.sh --skip-backend        Reuse already-running backend
#
# Starts LLMock (port 4100), Next.js backend (port 3000), seeds DB,
# then runs Maestro flows against the iOS simulator.

SKIP_BACKEND=false
TAGS=""
FLOW_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-backend) SKIP_BACKEND=true; shift ;;
    --tags) TAGS="$2"; shift 2 ;;
    *) FLOW_ARG="$1"; shift ;;
  esac
done

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Skipping mobile E2E — requires macOS (detected: $(uname))"
  exit 0
fi

# Check Java
if ! java -version &>/dev/null; then
  echo "Error: Java not found. Install with: brew install openjdk@17"
  exit 1
fi

# Check Maestro
MAESTRO_BIN="$HOME/.maestro/bin/maestro"
if [[ ! -x "$MAESTRO_BIN" ]]; then
  echo "Error: Maestro not found. Install with: curl -Ls https://get.maestro.mobile.dev | bash"
  exit 1
fi

# Check for a booted simulator
if ! xcrun simctl list devices booted 2>/dev/null | grep -q "Booted"; then
  echo "No booted iOS simulator found. Booting iPhone 16..."
  xcrun simctl boot "iPhone 16" 2>/dev/null || xcrun simctl boot "iPhone 15" 2>/dev/null || {
    echo "Error: Could not boot a simulator. Open Xcode → Window → Devices and Simulators."
    exit 1
  }
fi

# Verify Sotto app is installed on the simulator
if ! xcrun simctl get_app_container booted fm.sotto.app &>/dev/null; then
  echo "Error: Sotto app (fm.sotto.app) not installed on simulator."
  echo "Build and install it first:"
  echo "  npm run mobile:ios:build"
  echo "  # or: npx expo run:ios --device"
  echo ""
  echo "Make sure EXPO_PUBLIC_API_URL points to http://localhost:3000/api"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PIDS_TO_KILL=()

cleanup() {
  echo ""
  echo "Cleaning up background processes..."
  for pid in "${PIDS_TO_KILL[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

wait_for_port() {
  local port="$1"
  local name="$2"
  local timeout="${3:-60}"
  local elapsed=0
  echo "Waiting for $name on port $port..."
  while ! lsof -i ":$port" -sTCP:LISTEN &>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge $timeout ]]; then
      echo "Error: $name did not start within ${timeout}s"
      exit 1
    fi
  done
  echo "$name is ready (port $port)"
}

if [[ "$SKIP_BACKEND" == "false" ]]; then
  # Start LLMock AI mock server
  echo "Starting LLMock server..."
  cd "$ROOT_DIR"
  npx tsx e2e/llmock/setup.ts &
  PIDS_TO_KILL+=($!)
  wait_for_port 4100 "LLMock" 30

  # Start Next.js backend with AI base URLs pointing to LLMock
  echo "Starting Next.js backend..."
  "$ROOT_DIR/scripts/run-with-env.sh" env \
    SKIP_DB_SYNC=1 \
    ANTHROPIC_BASE_URL=http://localhost:4100 \
    OPENAI_BASE_URL=http://localhost:4100 \
    GOOGLE_AI_BASE_URL=http://localhost:4100 \
    npm run dev:web &
  PIDS_TO_KILL+=($!)
  wait_for_port 3000 "Next.js" 120

  # Seed the database
  echo "Seeding test data..."
  cd "$ROOT_DIR"
  "$ROOT_DIR/scripts/run-with-env.sh" npx tsx e2e/playwright/helpers/seed.ts
fi

# Build Maestro command
MAESTRO_CMD=("$MAESTRO_BIN" "test")

if [[ -n "$TAGS" ]]; then
  MAESTRO_CMD+=("--include-tags=$TAGS")
fi

if [[ -n "$FLOW_ARG" ]]; then
  MAESTRO_CMD+=("$SCRIPT_DIR/$FLOW_ARG")
else
  MAESTRO_CMD+=("$SCRIPT_DIR/flows/")
fi

echo "Running Maestro E2E tests..."
"${MAESTRO_CMD[@]}"
