import { resolveReadyWorkspace } from "../cli/workspace.js";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import {
  observeCodingAgentAvailability,
  type CodingAgentAvailabilitySnapshot,
} from "../codingAgents/availability.js";
import { openDatabase } from "../db/connection.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import { createIntelligenceServer } from "../intelligence/api/server.js";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { createCodexCliImageExecutor } from "../intelligence/codex/imageExecutor.js";
import { createCodexCliTextExecutor } from "../intelligence/codex/textExecutor.js";
import { createComfyUiImageExecutor } from "../intelligence/comfyui/imageExecutor.js";
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
  IntelligenceUsage
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
  const comfyUiImageExecutor = createComfyUiImageExecutor({
    workspaceRoot: workspacePath,
    artifactStore,
    config,
  });
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
    comfyUiImageExecutor,
  );
  const stopWorker = worker.start({
    heartbeatPath: path.join(workspacePath, ".arcadia", "intelligence-worker.heartbeat"),
  });

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
    const comfyUiImageRoute = process.env.ARCADIA_COMFYUI_IMAGE_ROUTE?.trim() || undefined;
    const codexImageRoute = options.route?.trim() || process.env.ARCADIA_CODEX_IMAGE_ROUTE?.trim() || (comfyUiImageRoute ? undefined : DEFAULT_CODEX_IMAGE_ROUTE);
    const config = {
      ...loadedConfig,
      routes: buildDefaultRoutes({
        localTextRoute: process.env.ARCADIA_LITELLM_LOCAL_TEXT_ROUTE?.trim() || "arcadia-default",
        cloudTextRoute: process.env.ARCADIA_LITELLM_CLOUD_TEXT_ROUTE?.trim() || undefined,
        cloudImageRoute: process.env.ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE?.trim() || undefined,
        codexImageRoute,
        comfyUiImageRoute,
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
    const comfyUiImageExecutor = createComfyUiImageExecutor({
      workspaceRoot: workspacePath,
      artifactStore,
      config,
    });
    const worker = new IntelligenceWorker(
      repository,
      liteLlmClient,
      config,
      artifactStore,
      codexImageExecutor,
      codexTextExecutor,
      undefined,
      comfyUiImageExecutor,
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

export interface IntelligenceUsageSummary {
  generatedAt: string;
  periodStart: string;
  periodLabel: "today";
  jobs: {
    total: number;
    completed: number;
    queued: number;
    running: number;
    failed: number;
    blocked: number;
    withReportedUsage: number;
    withoutReportedUsage: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    measuredCostUsd: number;
    durationMs: number;
  };
  providers: Array<{
    provider: string;
    jobs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    measuredCostUsd: number;
  }>;
  codingAgents: CodingAgentAvailabilitySnapshot["agents"];
}

export interface IntelligenceUsageCommandData {
  summary: IntelligenceUsageSummary;
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

/**
 * Returns a read-only usage summary for the current local day. It reports
 * durable usage supplied by completed Intelligence jobs together with the
 * provider-neutral coding-agent availability snapshot used by routing.
 */
export async function runIntelligenceUsageCommand(
  options: { workspace: string; now?: Date },
): Promise<CommandSuccess<IntelligenceUsageCommandData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  const now = options.now ?? new Date();
  const periodStart = startOfLocalDay(now);

  try {
    const repository = createSqliteIntelligenceJobRepository(db);
    const jobs = await repository.listCreatedSince(periodStart);
    const registries = loadPhase3Registries(workspacePath);
    validatePhase3Registries(registries);
    const codingAgentAvailability = observeCodingAgentAvailability(registries.codingAgents.profiles, now);

    return createSuccess({
      command: "intelligence.usage",
      workspace: workspacePath,
      data: {
        summary: buildIntelligenceUsageSummary({
          jobs,
          codingAgentAvailability,
          now,
          periodStart,
        }),
      },
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

export function renderIntelligenceUsageSuccess(
  response: CommandSuccess<IntelligenceUsageCommandData>,
): string[] {
  const { summary } = response.data;
  const lines = [
    "Arcadia Intelligence usage",
    `Period: ${summary.periodLabel} (since ${summary.periodStart})`,
    `Jobs: ${summary.jobs.total} total, ${summary.jobs.withReportedUsage} with reported usage`,
    `Tokens: ${summary.usage.inputTokens} input, ${summary.usage.outputTokens} output`,
    `Cost: $${summary.usage.measuredCostUsd.toFixed(4)} measured, $${summary.usage.estimatedCostUsd.toFixed(4)} estimated`,
  ];
  for (const agent of summary.codingAgents) {
    lines.push(`- ${agent.provider}: ${agent.availability} (${agent.telemetry})`);
  }
  return lines;
}

function buildIntelligenceUsageSummary(input: {
  jobs: IntelligenceJob[];
  codingAgentAvailability: CodingAgentAvailabilitySnapshot;
  now: Date;
  periodStart: string;
}): IntelligenceUsageSummary {
  const usage = emptyUsage();
  const jobCounts = {
    total: input.jobs.length,
    completed: 0,
    queued: 0,
    running: 0,
    failed: 0,
    blocked: 0,
    withReportedUsage: 0,
    withoutReportedUsage: 0,
  };
  const providerTotals = new Map<string, ReturnType<typeof emptyUsage> & { jobs: number }>();

  for (const job of input.jobs) {
    jobCounts[job.status] += 1;
    const reported = hasReportedUsage(job.usage);
    if (reported) {
      jobCounts.withReportedUsage += 1;
    } else {
      jobCounts.withoutReportedUsage += 1;
    }
    addUsage(usage, job.usage);

    const provider = job.usage?.provider ?? job.usage?.modelRoute ?? job.selectedRoute ?? "unreported";
    const current = providerTotals.get(provider) ?? { ...emptyUsage(), jobs: 0 };
    current.jobs += 1;
    addUsage(current, job.usage);
    providerTotals.set(provider, current);
  }

  return {
    generatedAt: input.now.toISOString(),
    periodStart: input.periodStart,
    periodLabel: "today",
    jobs: jobCounts,
    usage,
    providers: [...providerTotals.entries()].map(([provider, total]) => ({ provider, ...total })),
    codingAgents: input.codingAgentAvailability.agents,
  };
}

function emptyUsage(): Required<Pick<IntelligenceUsage, "inputTokens" | "outputTokens" | "estimatedCostUsd" | "measuredCostUsd" | "durationMs">> {
  return { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, measuredCostUsd: 0, durationMs: 0 };
}

function addUsage(
  target: ReturnType<typeof emptyUsage>,
  usage: IntelligenceUsage | undefined,
): void {
  target.inputTokens += usage?.inputTokens ?? 0;
  target.outputTokens += usage?.outputTokens ?? 0;
  target.estimatedCostUsd += usage?.estimatedCostUsd ?? 0;
  target.measuredCostUsd += usage?.measuredCostUsd ?? 0;
  target.durationMs += usage?.durationMs ?? 0;
}

function hasReportedUsage(usage: IntelligenceUsage | undefined): boolean {
  return Boolean(
    usage && (
      usage.inputTokens !== undefined ||
      usage.outputTokens !== undefined ||
      usage.estimatedCostUsd !== undefined ||
      usage.measuredCostUsd !== undefined
    ),
  );
}

function startOfLocalDay(now: Date): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function buildSmokeRequest(input: {
  prompt: string;
  idempotencyKey?: string;
}): IntelligenceRequest {
  return {
    idempotencyKey: input.idempotencyKey ?? `arcadia-image-smoke-${Date.now()}`,
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
