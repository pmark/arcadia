# Arcadia local image backend

This setup uses ComfyUI as the local image engine and FLUX.2 Klein 4B as the
unified generation/editing model. Arcadia talks to ComfyUI's loopback API and
persists the returned bytes through the normal Intelligence Artifact store.

Install/update the backend and model files with:

```sh
scripts/comfyui/install.sh
```

The installer uses resumable downloads and validates each safetensors file
before placing it in ComfyUI's model directories. The FLUX.2 Klein 4B files
are large; rerunning the installer safely resumes an interrupted transfer. It
uses the standard non-FP8 weights because Apple MPS cannot execute the FP8
dequantization path reliably.

Then
regenerate the API workflows whenever the committed source workflow templates
change:

```sh
node scripts/comfyui/export-api-workflows.mjs
```

Start the backend:

```sh
scripts/comfyui/start.sh
```

The backend is intentionally bound to `127.0.0.1`. Arcadia's route is enabled
by the local `.env` entries for `ARCADIA_COMFYUI_*`; no cloud fallback occurs.
