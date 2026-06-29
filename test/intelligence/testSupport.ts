import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/connection.js";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";
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
    capability: overrides.capability ?? "demo-app.greeting.v1",
    clientApp: overrides.clientApp ?? "demo-app",
    modality: overrides.modality,
    input: overrides.input ?? { name: "Ada" },
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
    defaultLiteLlmRoute: "arcadia-default",
    liteLlmBaseUrl,
    allowPaidUsage: false,
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
