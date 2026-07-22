#!/usr/bin/env bash
set -euo pipefail

COMFY_ROOT="${ARCADIA_COMFYUI_ROOT:-/Users/pmark/AI/Arcadia-ComfyUI}"
MODEL_ROOT="${COMFY_ROOT}/models"

brew install python@3.13
brew install aria2
mkdir -p "$(dirname "${COMFY_ROOT}")"
if [[ ! -d "${COMFY_ROOT}/.git" ]]; then
  git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git "${COMFY_ROOT}"
fi
if [[ ! -x "${COMFY_ROOT}/.venv/bin/python" ]]; then
  /opt/homebrew/bin/python3.13 -m venv "${COMFY_ROOT}/.venv"
fi
"${COMFY_ROOT}/.venv/bin/python" -m pip install --upgrade pip
"${COMFY_ROOT}/.venv/bin/pip" install torch torchvision torchaudio
"${COMFY_ROOT}/.venv/bin/pip" install -r "${COMFY_ROOT}/requirements.txt"

mkdir -p "${MODEL_ROOT}/text_encoders" "${MODEL_ROOT}/diffusion_models" "${MODEL_ROOT}/vae"
download() {
  local url="$1"
  local target="$2"
  local partial="${target}.part"
  if command -v aria2c >/dev/null 2>&1; then
    aria2c -c -x8 -s8 -k4M --file-allocation=none --allow-overwrite=true \
      --auto-file-renaming=false --summary-interval=15 \
      -d "$(dirname "${partial}")" -o "$(basename "${partial}")" "${url}"
  else
    curl -LfsS --retry 20 --retry-all-errors --retry-delay 3 -C - -o "${partial}" "${url}"
  fi
  validate_safetensors "${partial}"
  mv "${partial}" "${target}"
}

validate_safetensors() {
  local target="$1"
  "${COMFY_ROOT}/.venv/bin/python" - "${target}" <<'PY'
from safetensors import safe_open
import sys

target = sys.argv[1]
with safe_open(target, framework="pt", device="cpu") as tensors:
    if not tensors.keys():
        raise RuntimeError(f"No tensors found in {target}")
PY
}

download https://huggingface.co/Comfy-Org/flux2-klein-4B/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors \
  "${MODEL_ROOT}/text_encoders/qwen_3_4b.safetensors"
download https://huggingface.co/Comfy-Org/flux2-klein/resolve/main/split_files/diffusion_models/flux-2-klein-4b.safetensors \
  "${MODEL_ROOT}/diffusion_models/flux-2-klein-4b.safetensors"
download https://huggingface.co/Comfy-Org/flux2-klein/resolve/main/split_files/diffusion_models/flux-2-klein-base-4b.safetensors \
  "${MODEL_ROOT}/diffusion_models/flux-2-klein-base-4b.safetensors"
download https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors \
  "${MODEL_ROOT}/vae/flux2-vae.safetensors"

echo "ComfyUI installed at ${COMFY_ROOT}"
