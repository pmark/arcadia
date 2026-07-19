import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { IntelligenceArtifactStore } from "../artifacts/store.js";
import type { IntelligenceV01Config } from "../config/types.js";
import type { IntelligenceJobRepository } from "../db/repository.js";
import {
  InvalidExecutionTargetError,
  IntelligenceJobNotFoundError,
  RequirementsNotSupportedError,
  RetryNotAllowedError,
  retryIntelligenceJob,
  submitIntelligenceRequest,
} from "../service/jobService.js";
import {
  EXECUTION_PREFERENCES,
  INTELLIGENCE_CAPABILITIES,
  INTELLIGENCE_EXECUTION_TARGETS,
  INTELLIGENCE_PROFILES,
} from "../types.js";
import type { IntelligenceRequest } from "../types.js";

/**
 * Plain node:http API for Arcadia Intelligence v0.1.
 *
 * Arcadia has no standalone HTTP server framework dependency today (the
 * dashboard is a separate Next.js app that mostly shells out to the CLI).
 * Rather than add Fastify or Express for four routes, this uses Node's
 * built-in http module directly, consistent with how existing Arcadia tests
 * already spin up plain node:http servers (see tests/rebuster-capability.test.ts).
 *
 * Routes:
 * - POST /api/intelligence/jobs
 * - GET  /api/intelligence/jobs/:jobId
 * - POST /api/intelligence/jobs/:jobId/retry
 * - GET  /api/intelligence/health
 * - GET  /api/intelligence/artifacts/:artifactId (durable bytes for image jobs)
 */
export interface IntelligenceServerOptions {
  repository: IntelligenceJobRepository;
  config: IntelligenceV01Config;
  artifactStore?: IntelligenceArtifactStore;
  fetchImpl?: typeof fetch;
}

const JOB_ID_PATTERN = /^\/api\/intelligence\/jobs\/([^/]+)$/;
const RETRY_PATTERN = /^\/api\/intelligence\/jobs\/([^/]+)\/retry$/;
const ARTIFACT_ID_PATTERN = /^\/api\/intelligence\/artifacts\/([^/]+)$/;

export function createIntelligenceServer(options: IntelligenceServerOptions): Server {
  const { repository, config, artifactStore } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  return createServer((req, res) => {
    void handleRequest(req, res, repository, config, artifactStore, fetchImpl);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repository: IntelligenceJobRepository,
  config: IntelligenceV01Config,
  artifactStore: IntelligenceArtifactStore | undefined,
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  try {
    if (method === "POST" && url.pathname === "/api/intelligence/jobs") {
      await handleSubmitJob(req, res, repository);
      return;
    }

    if (method === "GET" && url.pathname === "/api/intelligence/health") {
      await handleHealth(res, config, fetchImpl);
      return;
    }

    const retryMatch = method === "POST" ? RETRY_PATTERN.exec(url.pathname) : null;
    if (retryMatch) {
      await handleRetryJob(res, repository, config, decodeURIComponent(retryMatch[1]!));
      return;
    }

    const jobMatch = method === "GET" ? JOB_ID_PATTERN.exec(url.pathname) : null;
    if (jobMatch) {
      await handleGetJob(res, repository, decodeURIComponent(jobMatch[1]!));
      return;
    }

    const artifactMatch = method === "GET" ? ARTIFACT_ID_PATTERN.exec(url.pathname) : null;
    if (artifactMatch) {
      await handleGetArtifact(req, res, artifactStore, decodeURIComponent(artifactMatch[1]!));
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}

async function handleSubmitJob(
  req: IncomingMessage,
  res: ServerResponse,
  repository: IntelligenceJobRepository,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const validationError = validateIntelligenceRequestShape(body);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  try {
    const response = await submitIntelligenceRequest(repository, body as IntelligenceRequest);
    sendJson(res, response.created ? 201 : 200, response);
  } catch (error) {
    if (
      error instanceof RequirementsNotSupportedError ||
      error instanceof InvalidExecutionTargetError
    ) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleGetJob(
  res: ServerResponse,
  repository: IntelligenceJobRepository,
  jobId: string,
): Promise<void> {
  const job = await repository.findById(jobId);
  if (!job) {
    sendJson(res, 404, { error: `Job not found: ${jobId}` });
    return;
  }

  sendJson(res, 200, job);
}

/**
 * Mobile Safari's <audio>/<video> elements require the server to support
 * HTTP Range requests (a 206 response to a `Range:` header) — without it,
 * playback fails outright even though a plain download of the same URL
 * works fine. Parses a single "bytes=start-end" / "bytes=start-" /
 * "bytes=-suffixLength" range against a known total length. Returns
 * undefined for a missing/unparseable header (caller falls back to a full
 * 200 response) and null for a range outside the file (caller sends 416).
 */
function parseRange(rangeHeader: string | undefined, totalLength: number): { start: number; end: number } | null | undefined {
  if (!rangeHeader) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return undefined;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return undefined;

  let start: number;
  let end: number;
  if (startStr === "") {
    const suffixLength = Number(endStr);
    start = Math.max(0, totalLength - suffixLength);
    end = totalLength - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? totalLength - 1 : Math.min(Number(endStr), totalLength - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || start >= totalLength) {
    return null;
  }
  return { start, end };
}

async function handleGetArtifact(
  req: IncomingMessage,
  res: ServerResponse,
  artifactStore: IntelligenceArtifactStore | undefined,
  artifactId: string,
): Promise<void> {
  if (!artifactStore) {
    sendJson(res, 404, { error: "Artifact storage is not configured." });
    return;
  }

  const artifact = await artifactStore.getArtifactBytes(artifactId);
  if (!artifact) {
    sendJson(res, 404, { error: `Artifact not found: ${artifactId}` });
    return;
  }

  const totalLength = artifact.bytes.byteLength;
  const range = parseRange(req.headers.range, totalLength);

  if (range === null) {
    res.writeHead(416, { "content-range": `bytes */${totalLength}`, "accept-ranges": "bytes" });
    res.end();
    return;
  }

  if (range === undefined) {
    res.writeHead(200, {
      "content-type": artifact.mimeType,
      "content-length": totalLength,
      "accept-ranges": "bytes",
    });
    res.end(artifact.bytes);
    return;
  }

  const { start, end } = range;
  res.writeHead(206, {
    "content-type": artifact.mimeType,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${totalLength}`,
    "accept-ranges": "bytes",
  });
  res.end(artifact.bytes.subarray(start, end + 1));
}

async function handleRetryJob(
  res: ServerResponse,
  repository: IntelligenceJobRepository,
  config: IntelligenceV01Config,
  jobId: string,
): Promise<void> {
  try {
    const job = await retryIntelligenceJob(repository, jobId, config.maxRetries);
    sendJson(res, 200, { job });
  } catch (error) {
    if (error instanceof IntelligenceJobNotFoundError) {
      sendJson(res, 404, { error: error.message });
      return;
    }
    if (error instanceof RetryNotAllowedError) {
      sendJson(res, 409, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleHealth(
  res: ServerResponse,
  config: IntelligenceV01Config,
  fetchImpl: typeof fetch,
): Promise<void> {
  const liteLlmReachable = await pingLiteLlm(config.liteLlmBaseUrl, fetchImpl);
  const routes = config.routes
    .filter((route) => route.enabled)
    .map((route) => ({
      id: route.id,
      capability: route.capability,
      location: route.location,
      profile: route.profile,
      executor: route.executor ?? "litellm",
      requiresPaidUsage: route.requiresPaidUsage,
    }));
  sendJson(res, 200, {
    ok: true,
    liteLlm: {
      baseUrl: config.liteLlmBaseUrl,
      reachable: liteLlmReachable,
      routes,
    },
  });
}

async function pingLiteLlm(baseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    // LiteLLM's plain /health actively probes every configured model and can
    // take several seconds; /health/liveliness just confirms the proxy
    // process itself is up, which is what we want for a quick reachability
    // check here.
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/health/liveliness`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function validateIntelligenceRequestShape(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return "Request body must be a JSON object.";
  }

  const request = body as Partial<IntelligenceRequest>;
  if (!isNonEmptyString(request.idempotencyKey)) {
    return "idempotencyKey is required.";
  }
  if (!isNonEmptyString(request.operationId)) {
    return "operationId is required.";
  }
  if (!isNonEmptyString(request.clientApp)) {
    return "clientApp is required.";
  }
  if (
    !isNonEmptyString(request.capability) ||
    !(INTELLIGENCE_CAPABILITIES as readonly string[]).includes(request.capability)
  ) {
    return `capability must be one of: ${INTELLIGENCE_CAPABILITIES.join(", ")}.`;
  }
  if (
    !isNonEmptyString(request.execution) ||
    !(EXECUTION_PREFERENCES as readonly string[]).includes(request.execution)
  ) {
    return `execution must be one of: ${EXECUTION_PREFERENCES.join(", ")}.`;
  }
  if (
    request.executionTarget !== undefined &&
    (!(isNonEmptyString(request.executionTarget)) ||
      !(INTELLIGENCE_EXECUTION_TARGETS as readonly string[]).includes(request.executionTarget))
  ) {
    return `executionTarget must be one of: ${INTELLIGENCE_EXECUTION_TARGETS.join(", ")}.`;
  }
  if (
    !isNonEmptyString(request.profile) ||
    !(INTELLIGENCE_PROFILES as readonly string[]).includes(request.profile)
  ) {
    return `profile must be one of: ${INTELLIGENCE_PROFILES.join(", ")}.`;
  }
  if (request.input === undefined) {
    return "input is required.";
  }
  if (request.capability === "image.generate" || request.capability === "image.edit") {
    const input = request.input as Record<string, unknown> | null;
    if (!input || typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
      return `capability "${request.capability}" requires a non-empty string input.prompt.`;
    }
  }
  if (request.capability === "audio.speech.generate") {
    const input = request.input as Record<string, unknown> | null;
    if (!input || typeof input.text !== "string" || input.text.trim().length === 0) {
      return 'capability "audio.speech.generate" requires a non-empty string input.text.';
    }
    if (typeof input.voiceId !== "string" || input.voiceId.trim().length === 0) {
      return 'capability "audio.speech.generate" requires a non-empty string input.voiceId.';
    }
    if (input.format !== undefined && input.format !== "wav") {
      return 'capability "audio.speech.generate" only supports input.format "wav".';
    }
  }
  if (!request.outputContract || typeof request.outputContract.jsonSchema !== "object") {
    return "outputContract.jsonSchema is required.";
  }
  if (!request.template || !isNonEmptyString(request.template.id)) {
    return "template.id is required.";
  }
  if (!request.executionPolicy || typeof request.executionPolicy.maxRetries !== "number") {
    return "executionPolicy.maxRetries is required.";
  }

  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
