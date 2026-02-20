#!/usr/bin/env bash
# Downloads the wespeaker CAM++ speaker recognition model for sherpa-onnx
set -euo pipefail

MODEL_DIR="apps/web/models"
MODEL_FILE="$MODEL_DIR/wespeaker_en_voxceleb_CAM++_LM.onnx"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM%2B%2B_LM.onnx"

if [ -f "$MODEL_FILE" ]; then
  echo "Model already exists at $MODEL_FILE"
  exit 0
fi

mkdir -p "$MODEL_DIR"
echo "Downloading speaker recognition model..."
curl -L -o "$MODEL_FILE" "$MODEL_URL"
echo "Model downloaded to $MODEL_FILE"
