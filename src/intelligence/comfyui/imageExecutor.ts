import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWorkspacePaths } from "../../workspace/paths.js";
import type { IntelligenceArtifactStore } from "../artifacts/store.js";
import type { IntelligenceV01Config } from "../config/types.js";
import type { IntelligenceArtifactRecord, IntelligenceJob, IntelligenceUsage, JsonValue } from "../types.js";

export class ComfyUiExecutionBlockedError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ComfyUiExecutionBlockedError";
  }
}

export class ComfyUiExecutionFailedError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ComfyUiExecutionFailedError";
  }
}

export interface ComfyUiImageExecutor {
  execute(job: IntelligenceJob): Promise<{ output: JsonValue; usage?: IntelligenceUsage }>;
}

export function createComfyUiImageExecutor(options: {
  workspaceRoot: string;
  artifactStore: IntelligenceArtifactStore;
  config: IntelligenceV01Config;
}): ComfyUiImageExecutor {
  const comfy = options.config.comfyUi;
  const workspacePaths = getWorkspacePaths(options.workspaceRoot);

  return {
    async execute(job) {
      if (!comfy) {
        throw new ComfyUiExecutionBlockedError(
          "COMFYUI_UNAVAILABLE",
          "ComfyUI is not configured for Arcadia Intelligence.",
        );
      }

      const input = readImageInput(job);
      const jobWorkspace = path.join(workspacePaths.root, ".arcadia", "intelligence", "jobs", job.id);
      mkdirSync(jobWorkspace, { recursive: true });
      writeFileSync(path.join(jobWorkspace, "comfyui.request.json"), `${JSON.stringify(job.request, null, 2)}\n`);

      const workflowName = job.request.capability === "image.edit"
        ? "arcadia-image-edit.json"
        : "arcadia-image-generate.json";
      const workflowPath = path.join(comfy.workflowDir, workflowName);
      let workflow = readWorkflow(workflowPath);
      const prompt = input.prompt;
      const seed = input.seed ?? deterministicSeed(job.id);
      const count = input.n ?? 1;

      if (job.request.capability === "image.edit") {
        if (!input.referenceImage) {
          throw new ComfyUiExecutionBlockedError(
            "COMFYUI_REFERENCE_IMAGE_REQUIRED",
            'Image editing requires input.referenceImages with at least one local image path.',
          );
        }
        const uploaded = await uploadImage(comfy.baseUrl, input.referenceImage);
        workflow = setInput(workflow, "8000", "image", uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name);
      }

      const artifacts: IntelligenceArtifactRecord[] = [];
      for (let index = 0; index < count; index += 1) {
        const runWorkflow = cloneJson(workflow);
        setInput(runWorkflow, "74", "text", prompt);
        setInput(runWorkflow, "67", "text", "");
        setInput(runWorkflow, "73", "noise_seed", seed + index);
        writeFileSync(path.join(jobWorkspace, `workflow-${String(index + 1).padStart(2, "0")}.json`), `${JSON.stringify(runWorkflow, null, 2)}\n`);

        const promptId = await queuePrompt(comfy.baseUrl, runWorkflow);
        const history = await waitForHistory(comfy.baseUrl, promptId, comfy.timeoutMs);
        const images = history?.outputs?.["9000"]?.images ?? collectImages(history?.outputs);
        if (!Array.isArray(images) || images.length === 0) {
          throw new ComfyUiExecutionFailedError(
            "COMFYUI_NO_OUTPUT",
            `ComfyUI completed prompt ${promptId} without a SaveImage output.`,
          );
        }

        for (const image of images) {
          const bytes = await downloadImage(comfy.baseUrl, image);
          artifacts.push(await options.artifactStore.saveImageBytes({
            jobId: job.id,
            bytes,
            metadata: {
              prompt,
              model: "FLUX.2 Klein 4B",
              seed: seed + index,
              comfyPromptId: promptId,
              capability: job.request.capability,
            },
          }));
        }
      }

      return {
        output: {
          artifacts: artifacts as unknown as JsonValue,
          generation: { requestedCount: count, returnedCount: artifacts.length },
        },
        usage: { provider: "comfyui", model: "FLUX.2 Klein 4B", durationMs: 0 },
      };
    },
  };
}

type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type ComfyImageRef = { filename: string; subfolder?: string; type?: string };

function readWorkflow(workflowPath: string): ComfyWorkflow {
  try {
    const workflow = JSON.parse(readFileSync(workflowPath, "utf8")) as ComfyWorkflow;
    if (!workflow["9000"] || !workflow["74"] || !workflow["73"]) {
      throw new Error("workflow is missing Arcadia control nodes 73, 74, or 9000");
    }
    return workflow;
  } catch (error) {
    throw new ComfyUiExecutionBlockedError(
      "COMFYUI_WORKFLOW_UNAVAILABLE",
      `Could not load Arcadia ComfyUI workflow ${workflowPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function setInput(workflow: ComfyWorkflow, nodeId: string, name: string, value: unknown): ComfyWorkflow {
  if (!workflow[nodeId]) throw new ComfyUiExecutionFailedError("COMFYUI_WORKFLOW_INVALID", `Workflow node ${nodeId} is missing.`);
  workflow[nodeId].inputs[name] = value;
  return workflow;
}

async function queuePrompt(baseUrl: string, workflow: ComfyWorkflow): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
    });
  } catch (error) {
    throw new ComfyUiExecutionBlockedError("COMFYUI_UNAVAILABLE", `Could not reach ComfyUI: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.prompt_id !== "string") {
    throw new ComfyUiExecutionFailedError("COMFYUI_PROMPT_REJECTED", `ComfyUI rejected the workflow: ${JSON.stringify(body)}`);
  }
  return body.prompt_id;
}

async function waitForHistory(baseUrl: string, promptId: string, timeoutMs: number): Promise<{ outputs?: Record<string, { images?: ComfyImageRef[] }> } | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/history/${promptId}`);
    } catch (error) {
      throw new ComfyUiExecutionBlockedError(
        "COMFYUI_UNAVAILABLE",
        `Could not poll ComfyUI prompt ${promptId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const body = await response.json().catch(() => ({})) as Record<string, { outputs?: Record<string, { images?: ComfyImageRef[] }>; status?: { status_str?: string; messages?: unknown[] } }>;
    const entry = body[promptId];
    if (entry?.status?.status_str === "error") {
      const message = JSON.stringify(entry.status.messages ?? []);
      if (/incomplete metadata|not fully covered|no such file|file not found|failed to load/i.test(message)) {
        throw new ComfyUiExecutionBlockedError(
          "COMFYUI_MODEL_UNAVAILABLE",
          `ComfyUI could not load a required model file: ${message}`,
        );
      }
      throw new ComfyUiExecutionFailedError("COMFYUI_EXECUTION_FAILED", `ComfyUI reported an execution error: ${message}`);
    }
    if (entry?.outputs) return entry;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new ComfyUiExecutionFailedError("COMFYUI_TIMEOUT", `ComfyUI did not finish prompt ${promptId} within ${timeoutMs}ms.`);
}

async function uploadImage(baseUrl: string, sourcePath: string): Promise<{ name: string; subfolder: string }> {
  const body = new FormData();
  body.append("image", new Blob([readFileSync(sourcePath)]), path.basename(sourcePath));
  body.append("type", "input");
  body.append("overwrite", "true");
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/upload/image`, { method: "POST", body });
  } catch (error) {
    throw new ComfyUiExecutionBlockedError("COMFYUI_UNAVAILABLE", `Could not upload the reference image to ComfyUI: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = await response.json().catch(() => ({})) as { name?: string; subfolder?: string };
  if (!response.ok || !result.name) {
    throw new ComfyUiExecutionFailedError("COMFYUI_UPLOAD_FAILED", `ComfyUI rejected the reference image upload: ${JSON.stringify(result)}`);
  }
  return { name: result.name, subfolder: result.subfolder ?? "" };
}

async function downloadImage(baseUrl: string, image: ComfyImageRef): Promise<Buffer> {
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output" });
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/view?${query}`);
  if (!response.ok) throw new ComfyUiExecutionFailedError("COMFYUI_OUTPUT_DOWNLOAD_FAILED", `Could not download ComfyUI output ${image.filename}.`);
  return Buffer.from(await response.arrayBuffer());
}

function collectImages(outputs: Record<string, { images?: ComfyImageRef[] }> | undefined): ComfyImageRef[] {
  return Object.values(outputs ?? {}).flatMap((output) => output.images ?? []);
}

function readImageInput(job: IntelligenceJob): { prompt: string; n: number; seed?: number; referenceImage?: string } {
  const input = job.request.input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ComfyUiExecutionFailedError("COMFYUI_INVALID_INPUT", "Image input must be an object.");
  }
  const values = input as Record<string, JsonValue>;
  const prompt = typeof values.prompt === "string" ? values.prompt.trim() : "";
  if (!prompt) throw new ComfyUiExecutionFailedError("COMFYUI_INVALID_INPUT", "Image input requires a non-empty prompt.");
  const references = Array.isArray(values.referenceImages) ? values.referenceImages : [];
  const firstReference = references[0];
  const referenceImage = typeof firstReference === "string"
    ? firstReference
    : typeof firstReference === "object" && firstReference !== null && !Array.isArray(firstReference) && typeof firstReference.path === "string"
      ? firstReference.path
      : undefined;
  if (referenceImage && !existsSync(referenceImage)) {
    throw new ComfyUiExecutionBlockedError(
      "COMFYUI_REFERENCE_IMAGE_MISSING",
      `Image editing reference does not exist: ${referenceImage}`,
    );
  }
  return {
    prompt,
    n: typeof values.n === "number" && Number.isInteger(values.n) && values.n > 0 ? Math.min(values.n, 8) : 1,
    seed: typeof values.seed === "number" && Number.isInteger(values.seed) ? values.seed : undefined,
    referenceImage,
  };
}

function deterministicSeed(jobId: string): number {
  return createHash("sha256").update(jobId).digest().readUInt32BE(0);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
