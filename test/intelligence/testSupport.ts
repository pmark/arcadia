import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/connection.js";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import type { IntelligenceRequest } from "../../src/intelligence/types.js";
import type { IntelligenceV01Config } from "../../src/intelligence/config/types.js";

export function createTempWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-intelligence-test-"));
  initWorkspace(root);
  return root;
}

export function removeWorkspace(workspace: string): void {
  rmSync(workspace, { recursive: true, force: true });
}

export function openWorkspaceDatabase(workspace: string): Database.Database {
  return openDatabase(workspace);
}

export function buildIntelligenceRequest(
  overrides: Partial<IntelligenceRequest> = {},
): IntelligenceRequest {
  return {
    idempotencyKey: overrides.idempotencyKey ?? `idem_${randomUUID()}`,
    operationId: overrides.operationId ?? "demo-app.greeting",
    clientApp: overrides.clientApp ?? "demo-app",
    capability: overrides.capability ?? "text.generate",
    execution: overrides.execution ?? "local-preferred",
    profile: overrides.profile ?? "standard",
    input: overrides.input ?? { name: "Ada" },
    requirements: overrides.requirements,
    outputContract: overrides.outputContract ?? {
      schemaId: "demo-app.greeting.v1",
      schemaVersion: 1,
      jsonSchema: {
        type: "object",
        properties: { greeting: { type: "string" } },
        required: ["greeting"],
        additionalProperties: false,
      },
    },
    template: overrides.template ?? {
      id: "demo-app.greeting-template",
      version: "1",
    },
    executionPolicy: overrides.executionPolicy ?? {
      allowPaidUsage: false,
      maxRetries: 1,
    },
  };
}

export function testIntelligenceConfig(
  liteLlmBaseUrl: string,
  overrides: Partial<IntelligenceV01Config> = {},
): IntelligenceV01Config {
  return {
    routes: buildDefaultRoutes({ localTextRoute: "arcadia-default" }),
    liteLlmBaseUrl,
    maxRetries: 1,
    workerPollIntervalMs: 25,
    leaseDurationMs: 30_000,
    ...overrides,
  };
}

/** Fake LiteLLM proxy returning a single chat-completion response. */
export function startFakeLiteLlm(options: {
  content: unknown;
  delayMs?: number;
  model?: string;
}): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const respond = (): void => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: options.model ?? "fake-model",
          choices: [{ message: { content: JSON.stringify(options.content) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    };
    req.on("data", () => {});
    req.on("end", () => {
      if (options.delayMs) {
        setTimeout(respond, options.delayMs);
      } else {
        respond();
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** A minimal valid 1x1 transparent PNG, used as fixture image bytes. */
export const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAarVyFEAAAAASUVORK5CYII=";

/** Fake LiteLLM proxy returning an OpenAI-compatible image-generation response. */
export function startFakeLiteLlmImages(options: {
  b64Json?: string;
  count?: number;
  seed?: number;
  revisedPrompt?: string;
  delayMs?: number;
}): Promise<{ server: Server; baseUrl: string }> {
  const count = options.count ?? 1;
  const server = createServer((req, res) => {
    const respond = (): void => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: Array.from({ length: count }, () => ({
            b64_json: options.b64Json ?? ONE_PIXEL_PNG_BASE64,
            seed: options.seed,
            revised_prompt: options.revisedPrompt,
          })),
        }),
      );
    };
    req.on("data", () => {});
    req.on("end", () => {
      if (options.delayMs) {
        setTimeout(respond, options.delayMs);
      } else {
        respond();
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/**
 * Builds a minimal, valid WAV file Buffer (PCM) with the given parameters and a
 * silent body of the requested duration. Used as deterministic fixture audio in
 * place of a real TTS provider.
 */
export function makeWavFixture(options: {
  sampleRateHz?: number;
  channels?: number;
  seconds?: number;
  bitsPerSample?: number;
} = {}): Buffer {
  const sampleRateHz = options.sampleRateHz ?? 24_000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const seconds = options.seconds ?? 0.5;

  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRateHz * blockAlign;
  const dataBytes = Math.max(blockAlign, Math.round(sampleRateHz * seconds) * blockAlign);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(dataBytes, 40);

  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

/**
 * Fake OpenAI-compatible `/v1/audio/speech` server. Unlike the image server,
 * `/v1/audio/speech` returns raw audio bytes with an audio Content-Type, so
 * this returns `wavBytes` directly. `contentType` and `status` are overridable
 * to exercise the non-audio / error paths.
 */
export function startFakeOpenAiSpeech(options: {
  wavBytes?: Buffer;
  contentType?: string;
  status?: number;
  delayMs?: number;
  onRequest?: (body: unknown) => void;
}): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (options.onRequest) {
        try {
          options.onRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          options.onRequest(undefined);
        }
      }
      const respond = (): void => {
        const status = options.status ?? 200;
        if (status !== 200) {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "fake speech error" } }));
          return;
        }
        const body = options.wavBytes ?? makeWavFixture({});
        res.writeHead(200, {
          "content-type": options.contentType ?? "audio/wav",
          "content-length": body.byteLength,
        });
        res.end(body);
      };
      if (options.delayMs) {
        setTimeout(respond, options.delayMs);
      } else {
        respond();
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** Returns a base URL that nothing is listening on, to simulate LiteLLM being unavailable. */
export async function unavailableLiteLlmBaseUrl(): Promise<string> {
  const server = createServer((_req, res) => res.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
