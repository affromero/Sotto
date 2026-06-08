#!/usr/bin/env bash
# Install host dependencies for Sotto — idempotent, safe to re-run.
#
# Usage:
#   bash install-deps.sh          # Install all (default)
#   bash install-deps.sh --all    # Install all
#   bash install-deps.sh --pitch  # Only uv + pandoc (for pitch rebuild)
#   bash install-deps.sh --node   # Only Node.js check
#   bash install-deps.sh --docker # Only Docker check
#   bash install-deps.sh --ffmpeg # Only FFmpeg check
#   bash install-deps.sh --uv     # Only uv
#   bash install-deps.sh --pandoc # Only pandoc
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

install_node() {
  if command -v node &> /dev/null; then
    echo "node: $(node --version)"
  else
    echo "Installing Node.js 20 LTS..."
    if command -v apt-get &> /dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v brew &> /dev/null; then
      brew install node@20
    else
      echo "Error: please install Node.js manually: https://nodejs.org"
      return 1
    fi
    echo "node: $(node --version)"
  fi
}

install_docker() {
  if command -v docker &> /dev/null; then
    echo "docker: $(docker --version 2>/dev/null | head -1)"
  else
    echo "Installing Docker..."
    if command -v apt-get &> /dev/null; then
      curl -fsSL https://get.docker.com | sh
      sudo usermod -aG docker "$USER"
    elif command -v brew &> /dev/null; then
      brew install --cask docker
    else
      echo "Error: please install Docker manually: https://docker.com"
      return 1
    fi
    echo "docker: $(docker --version 2>/dev/null | head -1)"
  fi
}

install_ffmpeg() {
  if command -v ffmpeg &> /dev/null; then
    echo "ffmpeg: $(ffmpeg -version | head -1)"
  else
    echo "Installing FFmpeg..."
    if command -v apt-get &> /dev/null; then
      sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg
    elif command -v brew &> /dev/null; then
      brew install ffmpeg
    else
      echo "Error: please install FFmpeg manually: https://ffmpeg.org/download.html"
      return 1
    fi
    echo "ffmpeg: $(ffmpeg -version | head -1)"
  fi
}

install_uv() {
  if command -v uv &> /dev/null; then
    echo "uv: $(uv --version)"
  else
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    echo "uv: $(uv --version)"
  fi
}

install_pandoc() {
  if command -v pandoc &> /dev/null; then
    echo "pandoc: $(pandoc --version | head -1)"
  else
    echo "Installing pandoc..."
    if command -v apt-get &> /dev/null; then
      sudo apt-get update -qq && sudo apt-get install -y -qq pandoc
    elif command -v brew &> /dev/null; then
      brew install pandoc
    else
      echo "Error: please install pandoc manually: https://pandoc.org/installing.html"
      return 1
    fi
    echo "pandoc: $(pandoc --version | head -1)"
  fi
}

# Parse args — default to --all
ARGS="${*:---all}"

for arg in $ARGS; do
  case "$arg" in
    --all)
      install_node
      install_docker
      install_ffmpeg
      install_uv
      install_pandoc
      ;;
    --pitch)
      install_uv
      install_pandoc
      ;;
    --node)   install_node ;;
    --docker) install_docker ;;
    --ffmpeg) install_ffmpeg ;;
    --uv)     install_uv ;;
    --pandoc) install_pandoc ;;
    *)
      echo "Unknown flag: $arg"
      echo "Usage: install-deps.sh [--all|--pitch|--node|--docker|--ffmpeg|--uv|--pandoc]"
      exit 1
      ;;
  esac
done

echo "Dependencies ready."
