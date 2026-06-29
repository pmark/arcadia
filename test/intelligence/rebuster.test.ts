import type Database from "better-sqlite3";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createIntelligenceServer } from "../../src/intelligence/api/server.js";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import type { IntelligenceJobRepository } from "../../src/intelligence/db/repository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import { resolveIntelligenceRoute } from "../../src/intelligence/routing/resolveRoute.js";
import {
  RequirementsNotSupportedError,
  submitIntelligenceRequest,
} from "../../src/intelligence/service/jobService.js";
// The client and types below are the same modules the public
// "@pmark/arcadia/intelligence/client" / "/contracts" subpaths re-export
// (see src/intelligence/client/index.ts and src/intelligence/contracts.ts).
// Everything in this describe block that builds/submits/reads a request
// uses only these two imports — never repository/worker/config/litellm —
// mirroring what a companion app can actually reach through the package
// boundary (see packageBoundary.test.ts for the exports-map-level check).
import { ArcadiaIntelligenceClient } from "../../src/intelligence/client/client.js";
import type { IntelligenceRequest } from "../../src/intelligence/contracts.js";
import {
  buildIntelligenceRequest,
  closeServer,
  createTempWorkspace,
  openWorkspaceDatabase,
  removeWorkspace,
  startFakeLiteLlm,
  startFakeLiteLlmImages,
  testIntelligenceConfig,
} from "./testSupport.js";

const workspaces: string[] = [];
const databases: Database.Database[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const workspace of workspaces.splice(0)) {
    removeWorkspace(workspace);
  }
});

function setupRepository(): IntelligenceJobRepository {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  const db = openWorkspaceDatabase(workspace);
  databases.push(db);
  return createSqliteIntelligenceJobRepository(db);
}

describe("default route registry", () => {
  it("produces exactly the intentional five-route matrix when fully configured", () => {
    const routes = buildDefaultRoutes({
      localTextRoute: "arcadia-default",
      cloudTextRoute: "arcadia-cloud",
      cloudImageRoute: "arcadia-image",
    });

    expect(routes.map((route) => route.id).sort()).toEqual(
      [
        "arcadia.text.generate.local.fast",
        "arcadia.text.generate.local.standard",
        "arcadia.text.generate.cloud.standard",
        "arcadia.text.generate.cloud.quality",
        "arcadia.image.generate.cloud.quality",
      ].sort(),
    );
  });

  it("never produces a route for an unsupported capability/profile/location combination", () => {
    const routes = buildDefaultRoutes({
      localTextRoute: "arcadia-default",
      cloudTextRoute: "arcadia-cloud",
      cloudImageRoute: "arcadia-image",
    });

    expect(routes.some((route) => route.profile === "economy")).toBe(false);
    expect(routes.some((route) => route.capability === "text.classify")).toBe(false);
    expect(routes.some((route) => route.capability === "text.extract")).toBe(false);
    expect(routes.some((route) => route.capability === "text.reason")).toBe(false);
    expect(
      routes.some((route) => route.capability === "image.generate" && route.profile !== "quality"),
    ).toBe(false);
  });

  it("omits an alias's entries entirely when its environment variable is unset", () => {
    const routes = buildDefaultRoutes({ localTextRoute: "arcadia-default" });
    expect(routes.every((route) => route.location === "local")).toBe(true);
    expect(routes).toHaveLength(2);
  });
});

describe("health endpoint", () => {
  it("reports only enabled, configured routes", async () => {
    const repository = setupRepository();
    const config = testIntelligenceConfig("http://127.0.0.1:1", {
      routes: buildDefaultRoutes({
        localTextRoute: "arcadia-default",
        cloudImageRoute: "arcadia-image",
      }),
    });
    const apiServer = createIntelligenceServer({ repository, config });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    servers.push(apiServer);
    const { port } = apiServer.address() as { port: number };

    const response = await fetch(`http://127.0.0.1:${port}/api/intelligence/health`);
    const body = (await response.json()) as {
      liteLlm: { routes: Array<{ id: string; requiresPaidUsage: boolean }> };
    };

    expect(body.liteLlm.routes.map((route) => route.id).sort()).toEqual(
      ["arcadia.text.generate.local.fast", "arcadia.text.generate.local.standard", "arcadia.image.generate.cloud.quality"].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/arcadia-default|arcadia-image/);
  });
});

describe("Rebuster scenario: idea candidate generation", () => {
  const rebusterIdeaRequest = (): Partial<IntelligenceRequest> => ({
    operationId: "rebuster.generate-idea-candidates",
    capability: "text.generate" as const,
    execution: "local-preferred" as const,
    profile: "fast" as const,
    requirements: { structuredOutput: true },
  });

  it("resolves to local fast when a local route is configured", () => {
    const routes = buildDefaultRoutes({ localTextRoute: "arcadia-default" });
    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "local-preferred", profile: "fast" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.route.routeId).toBe("arcadia.text.generate.local.fast");
      expect(resolution.route.location).toBe("local");
    }
  });

  it("never escalates to cloud when local is unavailable, even with paid usage allowed", () => {
    const routes = buildDefaultRoutes({ cloudTextRoute: "arcadia-cloud" }); // no local route
    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "local-preferred", profile: "fast" },
      routes,
      { allowPaidUsage: true },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("local_route_unavailable");
      expect(resolution.message).not.toMatch(/arcadia-cloud/);
    }
  });

  it("end-to-end: completes locally without contacting a cloud route", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({ content: { candidates: ["a", "b"] } });
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({
        ...rebusterIdeaRequest(),
        input: { topic: "kitchen tools" },
        outputContract: {
          schemaId: "rebuster.idea-candidates.v1",
          schemaVersion: 1,
          jsonSchema: {
            type: "object",
            properties: { candidates: { type: "array" } },
            required: ["candidates"],
          },
        },
      }),
    );

    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      testIntelligenceConfig(baseUrl),
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.selectedRoute).toBe("arcadia-default");
    expect(finished?.usage?.routeId).toBe("arcadia.text.generate.local.fast");
  });
});

describe("Rebuster scenario: strict spec generation", () => {
  const rebusterSpecOverrides = {
    operationId: "rebuster.generate-strict-spec",
    capability: "text.generate" as const,
    execution: "cloud-required" as const,
    profile: "quality" as const,
    requirements: { structuredOutput: true },
  };

  it("resolves to cloud quality when paid usage is allowed", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({ content: { spec: "ICE + CREAM" } });
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({
        ...rebusterSpecOverrides,
        executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
        input: { brief: "ICE + CREAM" },
        outputContract: {
          schemaId: "rebuster.strict-spec.v1",
          schemaVersion: 1,
          jsonSchema: {
            type: "object",
            properties: { spec: { type: "string" } },
            required: ["spec"],
          },
        },
      }),
    );

    const config = testIntelligenceConfig(baseUrl, {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", cloudTextRoute: "arcadia-cloud" }),
    });
    const worker = new IntelligenceWorker(repository, createLiteLlmHttpClient({ baseUrl }), config);
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.usage?.routeId).toBe("arcadia.text.generate.cloud.quality");
  });

  it("fails with PAID_USAGE_NOT_ALLOWED, never falling back to local, when paid usage is disallowed", async () => {
    const repository = setupRepository();
    const { server, baseUrl } = await startFakeLiteLlm({ content: { spec: "ICE + CREAM" } });
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({
        ...rebusterSpecOverrides,
        executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
        input: { brief: "ICE + CREAM" },
      }),
    );

    const config = testIntelligenceConfig(baseUrl, {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", cloudTextRoute: "arcadia-cloud" }),
    });
    const worker = new IntelligenceWorker(repository, createLiteLlmHttpClient({ baseUrl }), config);
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("blocked");
    expect(finished?.error?.code).toBe("PAID_USAGE_NOT_ALLOWED");
    expect(finished?.error?.message).not.toMatch(/arcadia-cloud|gpt|openai/i);
  });
});

describe("Rebuster scenario: image candidate generation", () => {
  it("resolves to cloud quality and reaches the image transport", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const db = openWorkspaceDatabase(workspace);
    databases.push(db);
    const repository = createSqliteIntelligenceJobRepository(db);
    const { createSqliteIntelligenceArtifactStore } = await import("../../src/intelligence/artifacts/store.js");
    const artifactStore = createSqliteIntelligenceArtifactStore(db, workspace);

    const { server, baseUrl } = await startFakeLiteLlmImages({ seed: 7 });
    servers.push(server);

    await submitIntelligenceRequest(
      repository,
      buildIntelligenceRequest({
        operationId: "rebuster.generate-image-candidates",
        capability: "image.generate",
        execution: "cloud-required",
        profile: "quality",
        requirements: { imageSize: "1024x1024", transparency: false },
        executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
        input: { prompt: "a rebus tile for ICE + CREAM" },
        outputContract: {
          schemaId: "rebuster.generated-image.v1",
          schemaVersion: 1,
          jsonSchema: {
            type: "object",
            properties: { artifacts: { type: "array", minItems: 1 } },
            required: ["artifacts"],
          },
        },
      }),
    );

    const config = testIntelligenceConfig(baseUrl, {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", cloudImageRoute: "arcadia-image" }),
    });
    const worker = new IntelligenceWorker(
      repository,
      createLiteLlmHttpClient({ baseUrl }),
      config,
      artifactStore,
    );
    const finished = await worker.runOnce();

    expect(finished?.status).toBe("completed");
    expect(finished?.selectedRoute).toBe("arcadia-image");
    const result = finished?.result as { artifacts: Array<{ kind: string }> };
    expect(result.artifacts[0]?.kind).toBe("image");
  });

  it("rejects an unsupported imageSize before the job runs", async () => {
    const repository = setupRepository();

    await expect(
      submitIntelligenceRequest(
        repository,
        buildIntelligenceRequest({
          capability: "image.generate",
          execution: "cloud-required",
          profile: "quality",
          requirements: { imageSize: "2048x2048" },
          executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
          input: { prompt: "anything" },
        }),
      ),
    ).rejects.toThrow(RequirementsNotSupportedError);
  });

  it("rejects transparency: true as unsupported before the job runs", async () => {
    const repository = setupRepository();

    await expect(
      submitIntelligenceRequest(
        repository,
        buildIntelligenceRequest({
          capability: "image.generate",
          execution: "cloud-required",
          profile: "quality",
          requirements: { transparency: true },
          executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
          input: { prompt: "anything" },
        }),
      ),
    ).rejects.toThrow(RequirementsNotSupportedError);
  });

  it("rejects structuredOutput on an image capability before the job runs", async () => {
    const repository = setupRepository();

    await expect(
      submitIntelligenceRequest(
        repository,
        buildIntelligenceRequest({
          capability: "image.generate",
          execution: "cloud-required",
          profile: "quality",
          requirements: { structuredOutput: true },
          executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
          input: { prompt: "anything" },
        }),
      ),
    ).rejects.toThrow(RequirementsNotSupportedError);
  });
});

describe("public client/contracts surface: all three Rebuster request shapes", () => {
  it("submits each shape via the client and surfaces a typed failure without leaking provider details", async () => {
    const repository = setupRepository();
    const config = testIntelligenceConfig("http://127.0.0.1:1", {
      // Only local text is configured — strict-spec (cloud-required) and
      // image-candidates (cloud-required) requests must fail typed, not run.
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default" }),
    });
    const apiServer = createIntelligenceServer({ repository, config });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    servers.push(apiServer);
    const { port } = apiServer.address() as { port: number };

    const client = new ArcadiaIntelligenceClient({ baseUrl: `http://127.0.0.1:${port}` });

    const ideaRequest: IntelligenceRequest = {
      idempotencyKey: "rebuster-idea-1",
      operationId: "rebuster.generate-idea-candidates",
      clientApp: "rebuster",
      capability: "text.generate",
      execution: "local-preferred",
      profile: "fast",
      requirements: { structuredOutput: true },
      input: { topic: "kitchen tools" },
      outputContract: {
        schemaId: "rebuster.idea-candidates.v1",
        schemaVersion: 1,
        jsonSchema: { type: "object", properties: { candidates: { type: "array" } }, required: ["candidates"] },
      },
      template: { id: "rebuster.idea-candidates-prompt", version: "1" },
      executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
    };

    const specRequest: IntelligenceRequest = {
      ...ideaRequest,
      idempotencyKey: "rebuster-spec-1",
      operationId: "rebuster.generate-strict-spec",
      execution: "cloud-required",
      profile: "quality",
      input: { brief: "ICE + CREAM" },
      outputContract: {
        schemaId: "rebuster.strict-spec.v1",
        schemaVersion: 1,
        jsonSchema: { type: "object", properties: { spec: { type: "string" } }, required: ["spec"] },
      },
      executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
    };

    const imageRequest: IntelligenceRequest = {
      ...ideaRequest,
      idempotencyKey: "rebuster-image-1",
      operationId: "rebuster.generate-image-candidates",
      capability: "image.generate",
      execution: "cloud-required",
      profile: "quality",
      requirements: { imageSize: "1024x1024", transparency: false },
      input: { prompt: "a rebus tile" },
      outputContract: {
        schemaId: "rebuster.generated-image.v1",
        schemaVersion: 1,
        jsonSchema: { type: "object", properties: { artifacts: { type: "array" } }, required: ["artifacts"] },
      },
      executionPolicy: { allowPaidUsage: true, maxRetries: 1 },
    };

    const { job: ideaJob } = await client.submit(ideaRequest);
    expect(ideaJob.status).toBe("queued");

    const { job: specJob } = await client.submit(specRequest);
    expect(specJob.status).toBe("queued");

    const { job: imageJob } = await client.submit(imageRequest);
    expect(imageJob.status).toBe("queued");

    // No worker is running, but resolution itself is synchronous and
    // deterministic — drive it directly to prove the typed failure shape
    // a companion app would see once a worker picks these jobs up.
    const specResolution = resolveIntelligenceRoute(
      { capability: specRequest.capability, execution: specRequest.execution, profile: specRequest.profile },
      config.routes,
      { allowPaidUsage: specRequest.executionPolicy.allowPaidUsage },
    );
    expect(specResolution.ok).toBe(false);
    if (!specResolution.ok) {
      expect(specResolution.code).toBe("cloud_route_unavailable");
      expect(specResolution.message).not.toMatch(/arcadia-default|gpt|openai/i);
    }
  });
});
