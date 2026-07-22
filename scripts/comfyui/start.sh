#!/usr/bin/env bash
set -euo pipefail

COMFY_ROOT="${ARCADIA_COMFYUI_ROOT:-/Users/pmark/AI/Arcadia-ComfyUI}"
exec "${COMFY_ROOT}/.venv/bin/python" "${COMFY_ROOT}/main.py" \
  --listen 127.0.0.1 \
  --port "${ARCADIA_COMFYUI_PORT:-8188}" \
  --fp16-unet \
  --fp16-vae \
  --disable-auto-launch
