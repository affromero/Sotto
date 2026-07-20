#!/usr/bin/env bash
# PostToolUse hook: Run TypeScript type-check after editing .ts/.tsx files
# Sotto project-specific. Reads tool_input JSON from stdin.

set -euo pipefail

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check TypeScript files
case "$FILE_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Run tsc from the repository containing this hook.
REPO_ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null) || exit 0
TSC_OUTPUT=$(cd "$REPO_ROOT" && npm run type-check --silent 2>&1 | head -20) || true

if echo "$TSC_OUTPUT" | grep -q "error TS"; then
  echo "TypeScript errors detected after editing $FILE_PATH:"
  echo "$TSC_OUTPUT"
fi

exit 0
