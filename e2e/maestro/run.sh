#!/usr/bin/env bash
set -euo pipefail

# Maestro mobile E2E runner — macOS only (iOS simulator)
# Usage: ./e2e/maestro/run.sh [flow-file]
#   No args = run all flows
#   With arg = run specific flow, e.g. ./e2e/maestro/run.sh flows/01-auth-login.yaml

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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FLOW_ARG="${1:-flows/}"

echo "Running Maestro E2E tests..."
"$MAESTRO_BIN" test "$SCRIPT_DIR/$FLOW_ARG"
