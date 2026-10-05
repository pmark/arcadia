import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ArcadiaError, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { buildDefaultRoutes, loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { createOpenAiSpeechClient } from "../intelligence/speech/httpClient.js";
import {
  DEFAULT_NARRATION_CHUNK_CHARS,
  concatWavBuffers,
  formatIssueCommentary,
  parseIssueRef,
  splitNarrationText,
  type NarrationIssueInput,
} from "../intelligence/speech/narration.js";
import { parseWavMetadata } from "../intelligence/speech/wavMeta.js";
import { submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type {
  IntelligenceJob,
  IntelligenceRequest,
  IntelligenceSpeechGenerationResult,
} from "../intelligence/types.js";

const DEFAULT_SPEECH_VOICE = "arcadia.narrator";
const DEFAULT_SPEECH_LOCAL_ROUTE = "arcadia-speech";

export interface IntelligenceNarrateOptions {
  workspace: string;
  text?: string;
  file?: string;
  issue?: string;
  repo?: string;
  voiceId?: string;
  route?: string;
  out?: string;
  maxChunkChars?: number;
  idempotencyKey?: string;
}

export interface IntelligenceNarrateData {
  outputPath: string;
  source: string;
  voiceId: string;
  routeId?: string;
  provider?: string;
  chunkCount: number;
  durationSeconds?: number;
  byteSize: number;
  jobIds: string[];
}

/**
 * Narrates text — a literal string, a local file, or a GitHub issue's full
 * commentary — into one WAV file using the configured local speech route.
 *
 * It reuses the ordinary Arcadia Intelligence `audio.speech.generate` path:
 * each chunk is submitted and run through the normal worker loop, persisted as
 * a durable artifact, then the WAV clips are concatenated into a single file.
 * Speech is LiteLLM-routed like text/image: requires
 * `ARCADIA_SPEECH_LOCAL_ROUTE` (a LiteLLM TTS alias) and a reachable LiteLLM.
 */
export async function runIntelligenceNarrateCommand(
  options: IntelligenceNarrateOptions,
): Promise<CommandSuccess<IntelligenceNarrateData>> {
  const sources = [options.text, options.file, options.issue].filter(
    (value) => value !== undefined && value !== "",
  );
  if (sources.length === 0) {
    throw validationError("Provide exactly one of --text, --file, or --issue.", {});
  }
  if (sources.length > 1) {
    throw validationError("Provide only one of --text, --file, or --issue.", {});
  }

  const { sourceText, sourceLabel } = resolveSource(options);
  const chunks = splitNarrationText(sourceText, options.maxChunkChars ?? DEFAULT_NARRATION_CHUNK_CHARS);
  if (chunks.length === 0) {
    throw validationError("Nothing to narrate: the source text is empty.", { source: sourceLabel });
  }

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
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl, apiKey: config.liteLlmApiKey }),
      config,
      artifactStore,
      undefined,
      undefined,
      createOpenAiSpeechClient({
        apiKey: config.liteLlmApiKey,
        timeoutMs: config.speech?.timeoutMs,
        maxRetries: config.speech?.maxRetries,
      }),
    );

    const voiceId = options.voiceId?.trim() || DEFAULT_SPEECH_VOICE;
    const baseKey = options.idempotencyKey ?? `arcadia-narrate-${Date.now()}`;

    const wavClips: Buffer[] = [];
    const jobIds: string[] = [];
    let routeId: string | undefined;
    let provider: string | undefined;

    for (let index = 0; index < chunks.length; index++) {
      const request = buildNarrationRequest({
        text: chunks[index],
        voiceId,
        idempotencyKey: `${baseKey}-${String(index + 1).padStart(3, "0")}`,
      });
      const { job: submitted } = await submitIntelligenceRequest(repository, request);
      const finished = await worker.runOnce();
      const job = finished?.id === submitted.id ? finished : await repository.findById(submitted.id);
      if (!job) {
        throw new ArcadiaError(
          "UNEXPECTED_ERROR",
          `Narration chunk ${index + 1}/${chunks.length} was not found after submission (${submitted.id}).`,
          1,
          { jobId: submitted.id },
        );
      }
      if (job.status !== "completed") {
        throw new ArcadiaError(
          "UNEXPECTED_ERROR",
          `Narration chunk ${index + 1}/${chunks.length} ended ${job.status}` +
            `${job.error ? ` (${job.error.code}: ${job.error.message})` : ""}. ` +
            "Check that ARCADIA_SPEECH_LOCAL_ROUTE and LiteLLM are configured and reachable.",
          1,
          { jobId: job.id, status: job.status, error: job.error },
        );
      }

      const result = job.result as unknown as IntelligenceSpeechGenerationResult;
      const stored = await artifactStore.getArtifactBytes(result.artifact.id);
      if (!stored) {
        throw new ArcadiaError(
          "ARTIFACT_NOT_FOUND",
          `Narration chunk ${index + 1}/${chunks.length} produced artifact ${result.artifact.id} but its bytes were not found.`,
          3,
          { artifactId: result.artifact.id },
        );
      }
      wavClips.push(stored.bytes);
      jobIds.push(job.id);
      routeId = job.usage?.routeId ?? result.routeId;
      provider = result.provider;
    }

    const combined = concatWavBuffers(wavClips);
    const metadata = parseWavMetadata(combined);
    const outputPath = path.resolve(
      options.out ?? path.join(workspacePath, "artifacts", "narration", `narration-${timestamp()}.wav`),
    );
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, combined);

    return createSuccess({
      command: "intelligence.narrate",
      workspace: workspacePath,
      data: {
        outputPath,
        source: sourceLabel,
        voiceId,
        routeId,
        provider,
        chunkCount: chunks.length,
        durationSeconds: metadata?.durationSeconds,
        byteSize: combined.byteLength,
        jobIds,
      },
      artifacts: [outputPath],
    });
  } finally {
    db.close();
  }
}

export function renderIntelligenceNarrateSuccess(
  response: CommandSuccess<IntelligenceNarrateData>,
): string[] {
  const {
    outputPath,
    source,
    voiceId,
    routeId,
    provider,
    chunkCount,
    durationSeconds,
    byteSize,
  } = response.data;

  return [
    "Arcadia Intelligence narration",
    `Workspace: ${response.workspace ?? ""}`,
    `Source: ${source}`,
    `Voice: ${voiceId}`,
    `Route: ${routeId ?? "None"}`,
    `Provider: ${provider ?? "None"}`,
    `Chunks: ${chunkCount}`,
    `Duration: ${durationSeconds?.toFixed(2) ?? "?"}s`,
    `Size: ${byteSize} bytes`,
    `Artifact: ${outputPath}`,
  ];
}

function resolveSource(options: IntelligenceNarrateOptions): { sourceText: string; sourceLabel: string } {
  if (options.text !== undefined && options.text !== "") {
    return { sourceText: options.text, sourceLabel: "inline text" };
  }
  if (options.file) {
    const filePath = path.resolve(options.file);
    try {
      return { sourceText: readFileSync(filePath, "utf8"), sourceLabel: filePath };
    } catch (error) {
      throw new ArcadiaError(
        "VALIDATION_ERROR",
        `Could not read narration source file: ${error instanceof Error ? error.message : String(error)}`,
        2,
        { file: filePath },
      );
    }
  }
  if (options.issue) {
    const issue = fetchIssueCommentary(options.issue, options.repo);
    return { sourceText: formatIssueCommentary(issue), sourceLabel: `issue #${issue.number}` };
  }
  throw validationError("Provide exactly one of --text, --file, or --issue.", {});
}

/**
 * Reads a GitHub issue and its comments as untyped JSON. This is a read-only
 * `gh` call: it creates nothing and needs no Arcadia workspace.
 */
export function fetchIssueCommentary(issueRef: string, repo?: string): NarrationIssueInput {
  const { repository, number } = parseIssueRef(issueRef, repo);
  const result = spawnSync(
    "gh",
    ["issue", "view", String(number), "--repo", repository, "--json", "number,title,body,comments"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.error) {
    throw new ArcadiaError(
      "UNEXPECTED_ERROR",
      `Could not run gh to read issue ${repository}#${number}: ${result.error.message}`,
      1,
      { repository, number },
    );
  }
  if (result.status !== 0) {
    throw new ArcadiaError(
      "UNEXPECTED_ERROR",
      `gh could not read issue ${repository}#${number}: ${(result.stderr ?? "").trim() || "unknown error"}`,
      1,
      { repository, number, status: result.status },
    );
  }

  let parsed: {
    number?: number;
    title?: string;
    body?: string | null;
    comments?: Array<{ body?: string | null; author?: { login?: string } | null }>;
  };
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed;
  } catch (error) {
    throw new ArcadiaError(
      "UNEXPECTED_ERROR",
      `gh returned unreadable JSON for issue ${repository}#${number}: ${error instanceof Error ? error.message : String(error)}`,
      1,
      { repository, number },
    );
  }

  return {
    number: parsed.number ?? number,
    title: parsed.title ?? `Issue ${number}`,
    body: parsed.body ?? null,
    comments: (parsed.comments ?? []).map((comment) => ({
      author: comment.author?.login ? { login: comment.author.login } : null,
      body: comment.body ?? "",
    })),
  };
}

function buildNarrationRequest(input: {
  text: string;
  voiceId: string;
  idempotencyKey: string;
}): IntelligenceRequest {
  return {
    idempotencyKey: input.idempotencyKey,
    operationId: "arcadia.narrate",
    clientApp: "arcadia",
    capability: "audio.speech.generate",
    execution: "local-required",
    profile: "standard",
    input: { text: input.text, voiceId: input.voiceId, format: "wav" },
    outputContract: {
      schemaId: "arcadia.narration.v1",
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
    template: { id: "arcadia.narrate", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
  };
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(/[-:.]/g, "").replace(/Z$/, "Z");
}

export type { IntelligenceJob };
