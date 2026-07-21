# ComfyUI image executor

Current Milestone: Arcadia Intelligence can use a loopback ComfyUI server for
durable local image generation and single-reference image editing.

Next Action: exercise the backend with an Arcadia image Artifact and add
companion-app-specific prompt presets as needed.

Work Responsibility: Codex.

Required Artifacts: ComfyUI installation, FLUX.2 Klein 4B model files, API
workflows, Arcadia route configuration, and generated image Artifacts.

## Local stack

Arcadia uses ComfyUI as the local workflow engine and FLUX.2 Klein 4B as the
default unified generation/editing model. The committed source workflows are
the official ComfyUI templates in `config/intelligence/comfyui/`; Arcadia's
API-form workflows are generated into the configured workflow directory.

On this Mac the backend is installed at `/Users/pmark/AI/Arcadia-ComfyUI` and
uses MPS on the Apple M4. Start it with:

```sh
scripts/comfyui/start.sh
```

Regenerate API workflows after changing the source templates:

```sh
node scripts/comfyui/export-api-workflows.mjs
```

## Requests

Generation uses `capability: "image.generate"`. Editing uses
`capability: "image.edit"` and requires `input.referenceImages` with a local
path (or `{ "path": "..." }`). Both resolve to the local quality route and
return the normal durable Artifact manifest; no provider URLs or inline image
bytes enter the job result.

The executor polls ComfyUI history, downloads only the declared output image,
and persists it through Arcadia's existing Artifact store. It preserves the
submitted workflow under `.arcadia/intelligence/jobs/<job-id>/` for debugging.

The 4B distilled workflow is the practical default for interactive graphics,
icons, and decorations. The 4B base edit workflow is also installed and can be
selected by changing the local workflow file; it trades speed for edit
flexibility. The larger 9B family is intentionally not enabled on this 32 GB
unified-memory Mac until a measured benchmark justifies its memory pressure.
