import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createIntelligenceServer } from "../../src/intelligence/api/server.js";
import { createSqliteIntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import type { IntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import { ArcadiaIntelligenceClient } from "../../src/intelligence/client/client.js";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import type { IntelligenceV01Config } from "../../src/intelligence/config/types.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import type { IntelligenceJobRepository } from "../../src/intelligence/db/repository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import { DEFAULT_VOICE_MAP } from "../../src/intelligence/speech/voices.js";
import { createOpenAiSpeechClient } from "../../src/intelligence/speech/httpClient.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import type { IntelligenceRequest } from "../../src/intelligence/types.js";
import {
  buildIntelligenceRequest,
  closeServer,
  createTempWorkspace,
  makeWavFixture,
  openWorkspaceDatabase,
  removeWorkspace,
  startFakeOpenAiSpeech,
  testIntelligenceConfig,
  unavailableLiteLlmBaseUrl,
} from "./testSupport.js";

const workspaces: string[] = [];
const databases: Database.Database[] = [];
const servers: Server[] = [];
const stopFns: Array<() => void> = [];

afterEach(async () => {
  for (const stop of stopFns.splice(0)) stop();
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const db of databases.splice(0)) db.close();
  for (const workspace of workspaces.splice(0)) removeWorkspace(workspace);
});

function setup(): {
  workspace: string;
  repository: IntelligenceJobRepository;
  artifactStore: IntelligenceArtifactStore;
} {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  const db = openWorkspaceDatabase(workspace);
  databases.push(db);
  return {
    workspace,
    repository: createSqliteIntelligenceJobRepository(db),
    artifactStore: createSqliteIntelligenceArtifactStore(db, workspace),
  };
}

function speechConfig(
  liteLlmBaseUrl: string,
  localBaseUrl: string,
  overrides: Partial<IntelligenceV01Config["speech"]> = {},
): IntelligenceV01Config {
  return testIntelligenceConfig(liteLlmBaseUrl, {
    routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", localSpeechRoute: "arcadia-speech" }),
    speech: {
      localBaseUrl,
      voiceMap: { ...DEFAULT_VOICE_MAP },
      timeoutMs: 5_000,
      maxRetries: 0,
      ...overrides,
    },
  });
}

function speechRequest(overrides: Partial<IntelligenceRequest> = {}): IntelligenceRequest {
  return buildIntelligenceRequest({
    capability: "audio.speech.generate",
    execution: "local-required",
    profile: "standard",
    operationId: "demo-app.generate-speech",
    input: { text: "Can you solve this rebus?", voiceId: "arcadia.narrator", format: "wav" },
    outputContract: {
      schemaId: "demo-app.speech-manifest.v1",
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
            required: ["id", "kind", "uri", "mimeType", "sha256", "byteSize", "durationSeconds"],
          },
          voiceId: { type: "string" },
          routeId: { type: "string" },
          provider: { type: "string" },
        },
        required: ["artifact", "voiceId", "routeId", "provider"],
      },
    },
    template: { id: "demo-app.speech-template", version: "1" },
    ...overrides,
  });
}

describe("Arcadia Intelligence text-to-speech end-to-end", () => {
  it("completes a local speech job with a durable audio artifact (no base64, valid metadata)", async () => {
    const { workspace, repository, artifactStore } = setup();
    const wav = makeWavFixture({ sampleRateHz: 24_000, channels: 1, seconds: 0.75 });
    const { server, baseUrl: speechBaseUrl } = await startFakeOpenAiSpeech({ wavBytes: wav });
    servers.push(server);

    await submitIntelligenceRequest(repository, speechRequest());
    const config = speechConfig("http://127.0.0.1:9", speechBaseUrl);
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl }),
      config,
      artifactStore,
      undefined,
      undefined,
      createOpenAiSpeechClient({ maxRetries: 0 }),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.selectedRoute).toBe("arcadia-speech");
    expect(finished?.usage?.routeId).toBe("arcadia.audio.speech.generate.local.standard");

    const result = finished?.result as {
      artifact: {
        id: string;
        kind: string;
        uri: string;
        mimeType: string;
        format: string;
        sha256: string;
        byteSize: number;
        durationSeconds: number;
        sampleRateHz?: number;
        channels?: number;
      };
      voiceId: string;
      routeId: string;
      provider: string;
    };

    expect(result.artifact.kind).toBe("audio");
    expect(result.artifact.mimeType).toBe("audio/wav");
    expect(result.artifact.format).toBe("wav");
    expect(result.artifact.byteSize).toBe(wav.byteLength);
    expect(result.artifact.durationSeconds).toBeCloseTo(0.75, 2);
    expect(result.artifact.sampleRateHz).toBe(24_000);
    expect(result.artifact.channels).toBe(1);
    expect(result.artifact.uri).toBe(`/api/intelligence/artifacts/${result.artifact.id}`);
    expect(result.voiceId).toBe("arcadia.narrator");
    expect(result.provider).toBeTruthy();

    // The result carries a durable reference, never inline base64 audio.
    expect(JSON.stringify(result)).not.toContain(wav.toString("base64"));

    // Persisted bytes match the reported checksum + size.
    const stored = await artifactStore.getArtifactBytes(result.artifact.id);
    expect(stored?.mimeType).toBe("audio/wav");
    expect(stored?.bytes.byteLength).toBe(result.artifact.byteSize);
    expect(existsSync(path.join(workspace, "artifacts", "intelligence", finished!.id))).toBe(true);
  });

  it("retrieves the audio artifact bytes over HTTP via the client", async () => {
    const { repository, artifactStore } = setup();
    const wav = makeWavFixture({});
    const { server, baseUrl: speechBaseUrl } = await startFakeOpenAiSpeech({ wavBytes: wav });
    servers.push(server);

    const config = speechConfig("http://127.0.0.1:9", speechBaseUrl);
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl }),
      config,
      artifactStore,
      undefined,
      undefined,
      createOpenAiSpeechClient({ maxRetries: 0 }),
    );
    stopFns.push(worker.start());

    const apiServer = createIntelligenceServer({ repository, config, artifactStore });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    servers.push(apiServer);
    const { port } = apiServer.address() as { port: number };

    const client = new ArcadiaIntelligenceClient({ baseUrl: `http://127.0.0.1:${port}` });
    const { job } = await client.submit(speechRequest());
    const completed = await client.waitForCompletion(job.id, { pollIntervalMs: 20, timeoutMs: 5_000 });
    expect(completed.status).toBe("completed");
    const { artifact } = completed.result as { artifact: { uri: string } };

    const fetched = await client.getArtifact(artifact.uri);
    expect(fetched.contentType).toBe("audio/wav");
    expect(Buffer.from(fetched.bytes).equals(wav)).toBe(true);
  });

  it("fails safely on a non-audio provider response and leaves no artifact file behind", async () => {
    const { workspace, repository, artifactStore } = setup();
    const { server, baseUrl: speechBaseUrl } = await startFakeOpenAiSpeech({
      wavBytes: Buffer.from(JSON.stringify({ error: "not audio" })),
      contentType: "application/json",
    });
    servers.push(server);

    const { job } = await submitIntelligenceRequest(repository, speechRequest());
    const config = speechConfig("http://127.0.0.1:9", speechBaseUrl);
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl }),
      config,
      artifactStore,
      undefined,
      undefined,
      createOpenAiSpeechClient({ maxRetries: 0 }),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("failed");
    expect(finished?.error?.code).toBe("SPEECH_INVALID_CONTENT_TYPE");

    // No partial artifact file was written for this job.
    const jobArtifactsDir = path.join(workspace, "artifacts", "intelligence", job.id);
    const leftBehind = existsSync(jobArtifactsDir) ? readdirSync(jobArtifactsDir) : [];
    expect(leftBehind).toEqual([]);
  });

  it("blocks the job clearly when the local speech endpoint is unreachable", async () => {
    const { repository, artifactStore } = setup();
    const speechBaseUrl = await unavailableLiteLlmBaseUrl();

    await submitIntelligenceRequest(repository, speechRequest());
    const config = speechConfig("http://127.0.0.1:9", speechBaseUrl);
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl }),
      config,
      artifactStore,
      undefined,
      undefined,
      createOpenAiSpeechClient({ timeoutMs: 1_000, maxRetries: 0 }),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("blocked");
    expect(finished?.error?.code).toBe("SPEECH_UNAVAILABLE");
  });

  it("fails a request with an unknown semantic voiceId without contacting the provider", async () => {
    const { repository, artifactStore } = setup();
    let hit = false;
    const { server, baseUrl: speechBaseUrl } = await startFakeOpenAiSpeech({
      onRequest: () => {
        hit = true;
      },
    });
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      speechRequest({ input: { text: "hello", voiceId: "arcadia.nonexistent", format: "wav" } }),
    );
    const config = speechConfig("http://127.0.0.1:9", speechBaseUrl);
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl }),
      config,
      artifactStore,
      undefined,
      undefined,
      createOpenAiSpeechClient({ maxRetries: 0 }),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("failed");
    expect(finished?.error?.code).toBe("SPEECH_UNKNOWN_VOICE");
    expect(hit).toBe(false);
  });
});
