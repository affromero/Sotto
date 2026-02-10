#!/usr/bin/env bash
# Install all host dependencies for Sotto (Node.js, uv, pandoc).
# Called by setup.sh and rebuild-pitch.sh — idempotent, safe to re-run.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

# Node.js (required for app)
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

# Docker (required for services)
if ! command -v docker &> /dev/null; then
  echo "Error: Docker is required. Install from https://docker.com"
  exit 1
fi

# uv (Python package manager)
if ! command -v uv &> /dev/null; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
else
  echo "uv: $(uv --version)"
fi

# pandoc (markdown to HTML)
if ! command -v pandoc &> /dev/null; then
  echo "Installing pandoc..."
  if command -v apt-get &> /dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq pandoc
  elif command -v brew &> /dev/null; then
    brew install pandoc
  else
    echo "Error: please install pandoc manually: https://pandoc.org/installing.html"
    exit 1
  fi
else
  echo "pandoc: $(pandoc --version | head -1)"
fi

echo "All dependencies installed."
