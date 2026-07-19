import { resolveReadyWorkspace } from "../cli/workspace.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { openDatabase } from "../db/connection.js";
import { createIntelligenceServer } from "../intelligence/api/server.js";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { createCodexCliImageExecutor } from "../intelligence/codex/imageExecutor.js";
import { createCodexCliTextExecutor } from "../intelligence/codex/textExecutor.js";
import { buildDefaultRoutes, loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { createOpenAiSpeechClient } from "../intelligence/speech/httpClient.js";
import { submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type {
  IntelligenceImageGenerationResult,
  IntelligenceJob,
  IntelligenceRequest,
  IntelligenceSpeechGenerationResult,
} from "../intelligence/types.js";

const DEFAULT_PORT = 4710;
const DEFAULT_CODEX_IMAGE_ROUTE = "codex-cli";
const DEFAULT_SMOKE_PROMPT = "a simple black square centered on a white background";
const DEFAULT_SPEECH_SMOKE_TEXT = "Can you solve this rebus?";
const DEFAULT_SPEECH_SMOKE_VOICE = "arcadia.narrator";
const DEFAULT_SPEECH_LOCAL_ROUTE = "arcadia-speech";

export interface IntelligenceServeOptions {
  workspace: string;
  port?: number;
}

export interface IntelligenceImageSmokeOptions {
  workspace: string;
  prompt?: string;
  route?: string;
  idempotencyKey?: string;
}

export interface IntelligenceImageSmokeData {
  job: IntelligenceJob;
  jobWorkspace: string;
  artifactCount: number;
  artifactUris: string[];
}

/**
 * Starts the Arcadia Intelligence v0.1 HTTP API together with its in-process
 * worker in a single foreground process. Stop with Ctrl+C / SIGTERM.
 */
export function runIntelligenceServeCommand(options: IntelligenceServeOptions): void {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const liteLlmClient = createLiteLlmHttpClient({
    baseUrl: config.liteLlmBaseUrl,
    apiKey: config.liteLlmApiKey,
  });

  const codexImageExecutor = createCodexCliImageExecutor({
    workspaceRoot: workspacePath,
    artifactStore,
    config,
  });
  const codexTextExecutor = createCodexCliTextExecutor({ workspaceRoot: workspacePath, config });
  const speechClient = createOpenAiSpeechClient({
    apiKey: config.liteLlmApiKey,
    timeoutMs: config.speech?.timeoutMs,
    maxRetries: config.speech?.maxRetries,
  });
  const worker = new IntelligenceWorker(
    repository,
    liteLlmClient,
    config,
    artifactStore,
    codexImageExecutor,
    codexTextExecutor,
    speechClient,
  );
  const stopWorker = worker.start();

  const server = createIntelligenceServer({ repository, config, artifactStore });
  const port = options.port ?? DEFAULT_PORT;

  const shutdown = (): void => {
    stopWorker();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, () => {
    const enabledRouteCount = config.routes.filter((route) => route.enabled).length;
    process.stdout.write(
      `Arcadia Intelligence listening on http://127.0.0.1:${port} ` +
        `(workspace: ${workspacePath}, LiteLLM: ${config.liteLlmBaseUrl}, ${enabledRouteCount} route(s) configured)\n`,
    );
  });
}

export async function runIntelligenceImageSmokeCommand(
  options: IntelligenceImageSmokeOptions,
): Promise<CommandSuccess<IntelligenceImageSmokeData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);

  try {
    const repository = createSqliteIntelligenceJobRepository(db);
    const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
    const loadedConfig = loadIntelligenceConfig(process.env);
    const codexImageRoute = options.route?.trim() || process.env.ARCADIA_CODEX_IMAGE_ROUTE?.trim() || DEFAULT_CODEX_IMAGE_ROUTE;
    const config = {
      ...loadedConfig,
      routes: buildDefaultRoutes({
        localTextRoute: process.env.ARCADIA_LITELLM_LOCAL_TEXT_ROUTE?.trim() || "arcadia-default",
        cloudTextRoute: process.env.ARCADIA_LITELLM_CLOUD_TEXT_ROUTE?.trim() || undefined,
        cloudImageRoute: process.env.ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE?.trim() || undefined,
        codexImageRoute,
      }),
    };
    const liteLlmClient = createLiteLlmHttpClient({
      baseUrl: config.liteLlmBaseUrl,
      apiKey: config.liteLlmApiKey,
    });
    const codexImageExecutor = createCodexCliImageExecutor({
      workspaceRoot: workspacePath,
      artifactStore,
      config,
    });
    const codexTextExecutor = createCodexCliTextExecutor({ workspaceRoot: workspacePath, config });
    const worker = new IntelligenceWorker(
      repository,
      liteLlmClient,
      config,
      artifactStore,
      codexImageExecutor,
      codexTextExecutor,
    );

    const request = buildSmokeRequest({
      prompt: options.prompt ?? DEFAULT_SMOKE_PROMPT,
      idempotencyKey: options.idempotencyKey,
    });
    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    const finished = await worker.runOnce();
    const job = finished?.id === submitted.id ? finished : await repository.findById(submitted.id);
    if (!job) {
      throw new Error(`Arcadia Intelligence smoke job was not found after submission: ${submitted.id}`);
    }

    const artifactUris = job.status === "completed"
      ? ((job.result as unknown as IntelligenceImageGenerationResult).artifacts ?? []).map((artifact) => artifact.uri)
      : [];

    return createSuccess({
      command: "intelligence.smoke-image",
      workspace: workspacePath,
      data: {
        job,
        jobWorkspace: `${workspacePath}/.arcadia/intelligence/jobs/${job.id}`,
        artifactCount: artifactUris.length,
        artifactUris,
      },
      artifacts: artifactUris,
      warnings: job.status === "completed" ? [] : [`Job ended ${job.status}: ${job.error?.code ?? "UNKNOWN"}`],
    });
  } finally {
    db.close();
  }
}

export function renderIntelligenceImageSmokeSuccess(
  response: CommandSuccess<IntelligenceImageSmokeData>,
): string[] {
  const { job } = response.data;
  const lines = [
    "Arcadia Intelligence image smoke",
    `Workspace: ${response.workspace ?? ""}`,
    `Job: ${job.id}`,
    `Status: ${job.status}`,
    `Route: ${job.usage?.routeId ?? job.selectedRoute ?? "None"}`,
    `Job workspace: ${response.data.jobWorkspace}`,
  ];

  if (job.status === "completed") {
    lines.push(`Artifacts: ${response.data.artifactCount}`);
    for (const uri of response.data.artifactUris) {
      lines.push(`- ${uri}`);
    }
  } else {
    lines.push(`Error: ${job.error?.code ?? "UNKNOWN"} - ${job.error?.message ?? "No error message"}`);
  }

  return lines;
}

export interface IntelligenceSpeechSmokeOptions {
  workspace: string;
  text?: string;
  voiceId?: string;
  route?: string;
  idempotencyKey?: string;
}

export interface IntelligenceSpeechSmokeData {
  job: IntelligenceJob;
  artifactUri?: string;
  durationSeconds?: number;
}

/**
 * Runs one local text-to-speech generation through the normal worker loop
 * (submit -> resolve route -> speech adapter -> durable artifact) and reports
 * the result. Speech is LiteLLM-routed like text/image: requires
 * ARCADIA_LITELLM_BASE_URL reachable and ARCADIA_SPEECH_LOCAL_ROUTE set to a
 * LiteLLM model alias that resolves to a TTS backend; does not start or
 * manage that backend.
 */
export async function runIntelligenceSpeechSmokeCommand(
  options: IntelligenceSpeechSmokeOptions,
): Promise<CommandSuccess<IntelligenceSpeechSmokeData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);

  try {
    const repository = createSqliteIntelligenceJobRepository(db);
    const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
    const loadedConfig = loadIntelligenceConfig(process.env);
    const localSpeechRoute =
      options.route?.trim() || process.env.ARCADIA_SPEECH_LOCAL_ROUTE?.trim() || DEFAULT_SPEECH_LOCAL_ROUTE;
    const config = {
      ...loadedConfig,
      routes: buildDefaultRoutes({
        localTextRoute: process.env.ARCADIA_LITELLM_LOCAL_TEXT_ROUTE?.trim() || "arcadia-default",
        localSpeechRoute,
        cloudSpeechRoute: process.env.ARCADIA_SPEECH_CLOUD_ROUTE?.trim() || undefined,
      }),
    };
    const speechClient = createOpenAiSpeechClient({
      apiKey: config.liteLlmApiKey,
      timeoutMs: config.speech?.timeoutMs,
      maxRetries: config.speech?.maxRetries,
    });
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl, apiKey: config.liteLlmApiKey }),
      config,
      artifactStore,
      undefined,
      undefined,
      speechClient,
    );

    const request = buildSpeechSmokeRequest({
      text: options.text ?? DEFAULT_SPEECH_SMOKE_TEXT,
      voiceId: options.voiceId ?? DEFAULT_SPEECH_SMOKE_VOICE,
      idempotencyKey: options.idempotencyKey,
    });
    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    const finished = await worker.runOnce();
    const job = finished?.id === submitted.id ? finished : await repository.findById(submitted.id);
    if (!job) {
      throw new Error(`Arcadia Intelligence speech smoke job was not found after submission: ${submitted.id}`);
    }

    const result =
      job.status === "completed"
        ? (job.result as unknown as IntelligenceSpeechGenerationResult)
        : undefined;

    return createSuccess({
      command: "intelligence.smoke-speech",
      workspace: workspacePath,
      data: {
        job,
        artifactUri: result?.artifact.uri,
        durationSeconds: result?.artifact.durationSeconds,
      },
      artifacts: result?.artifact.uri ? [result.artifact.uri] : [],
      warnings: job.status === "completed" ? [] : [`Job ended ${job.status}: ${job.error?.code ?? "UNKNOWN"}`],
    });
  } finally {
    db.close();
  }
}

export function renderIntelligenceSpeechSmokeSuccess(
  response: CommandSuccess<IntelligenceSpeechSmokeData>,
): string[] {
  const { job } = response.data;
  const lines = [
    "Arcadia Intelligence speech smoke",
    `Workspace: ${response.workspace ?? ""}`,
    `Job: ${job.id}`,
    `Status: ${job.status}`,
    `Route: ${job.usage?.routeId ?? job.selectedRoute ?? "None"}`,
    `Provider: ${job.usage?.provider ?? "None"}`,
  ];

  if (job.status === "completed") {
    lines.push(`Artifact: ${response.data.artifactUri ?? "None"}`);
    lines.push(`Duration: ${response.data.durationSeconds?.toFixed(2) ?? "?"}s`);
  } else {
    lines.push(`Error: ${job.error?.code ?? "UNKNOWN"} - ${job.error?.message ?? "No error message"}`);
  }

  return lines;
}

export interface IntelligenceListJobsOptions {
  workspace: string;
  clientApp: string;
  limit?: number;
}

export interface IntelligenceListJobsData {
  jobs: IntelligenceJob[];
}

/**
 * Read-only history lookup for jobs submitted by a given clientApp, newest
 * first. Used by the Arcadia dashboard's admin Intelligence test bench to
 * show recent test runs; not part of the companion-app HTTP API.
 */
export async function runIntelligenceListJobsCommand(
  options: IntelligenceListJobsOptions,
): Promise<CommandSuccess<IntelligenceListJobsData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);

  try {
    const repository = createSqliteIntelligenceJobRepository(db);
    const jobs = await repository.listRecentByClientApp(options.clientApp, options.limit ?? 20);

    return createSuccess({
      command: "intelligence.list-jobs",
      workspace: workspacePath,
      data: { jobs },
    });
  } finally {
    db.close();
  }
}

export function renderIntelligenceListJobsSuccess(
  response: CommandSuccess<IntelligenceListJobsData>,
): string[] {
  const { jobs } = response.data;
  if (jobs.length === 0) {
    return ["Arcadia Intelligence jobs", "No jobs found."];
  }
  const lines = ["Arcadia Intelligence jobs"];
  for (const job of jobs) {
    lines.push(
      `${job.createdAt}  ${job.status}  ${job.id}  ${job.request.capability}  ${job.selectedRoute ?? job.request.profile}`,
    );
  }
  return lines;
}

function buildSmokeRequest(input: {
  prompt: string;
  idempotencyKey?: string;
}): IntelligenceRequest {
  return {
    idempotencyKey: input.idempotencyKey ?? `arcadia-codex-image-smoke-${Date.now()}`,
    operationId: "arcadia.smoke-image",
    clientApp: "arcadia",
    capability: "image.generate",
    execution: "local-required",
    profile: "quality",
    requirements: { imageSize: "1024x1024", transparency: false },
    input: { prompt: input.prompt, n: 1 },
    outputContract: {
      schemaId: "arcadia.image-smoke.v1",
      schemaVersion: 1,
      jsonSchema: {
        type: "object",
        properties: {
          artifacts: { type: "array", minItems: 1 },
          generation: { type: "object" },
        },
        required: ["artifacts"],
      },
    },
    template: { id: "arcadia.image-smoke", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
  };
}

function buildSpeechSmokeRequest(input: {
  text: string;
  voiceId: string;
  idempotencyKey?: string;
}): IntelligenceRequest {
  return {
    idempotencyKey: input.idempotencyKey ?? `arcadia-speech-smoke-${Date.now()}`,
    operationId: "arcadia.smoke-speech",
    clientApp: "arcadia",
    capability: "audio.speech.generate",
    execution: "local-required",
    profile: "standard",
    input: { text: input.text, voiceId: input.voiceId, format: "wav" },
    outputContract: {
      schemaId: "arcadia.speech-smoke.v1",
      schemaVersion: 1,
      jsonSchema: {
        type: "object",
        properties: {
          artifact: {
            type: "object",
            properties: {
              id: { type: "string" },
              kind: { type: "string", const: "audio" },
              uri: { type: "string" },
              mimeType: { type: "string" },
              format: { type: "string" },
              sha256: { type: "string" },
              byteSize: { type: "number" },
              durationSeconds: { type: "number" },
            },
            required: ["id", "kind", "uri", "mimeType", "sha256", "byteSize"],
          },
          voiceId: { type: "string" },
          routeId: { type: "string" },
          provider: { type: "string" },
        },
        required: ["artifact", "voiceId", "routeId", "provider"],
      },
    },
    template: { id: "arcadia.speech-smoke", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
  };
}
