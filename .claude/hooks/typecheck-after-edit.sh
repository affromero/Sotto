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

# Run tsc from project root
TSC_OUTPUT=$(cd /home/ubuntu/Code/Sotto && npx tsc --noEmit --pretty 2>&1 | head -20) || true

if echo "$TSC_OUTPUT" | grep -q "error TS"; then
  echo "TypeScript errors detected after editing $FILE_PATH:"
  echo "$TSC_OUTPUT"
fi

exit 0
