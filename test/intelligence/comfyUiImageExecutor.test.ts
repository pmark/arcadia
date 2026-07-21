import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteIntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import { createComfyUiImageExecutor } from "../../src/intelligence/comfyui/imageExecutor.js";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import type { IntelligenceV01Config } from "../../src/intelligence/config/types.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../../src/intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import { ONE_PIXEL_PNG_BASE64, buildIntelligenceRequest, createTempWorkspace, openWorkspaceDatabase, removeWorkspace, unavailableLiteLlmBaseUrl } from "./testSupport.js";

const workspaces: string[] = [];
const tempDirs: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const workspace of workspaces.splice(0)) removeWorkspace(workspace);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ComfyUI image executor", () => {
  it("queues a local workflow and persists the returned image as an Artifact", async () => {
    const workspace = createTempWorkspace();
    workspaces.push(workspace);
    const db = openWorkspaceDatabase(workspace);
    const workflowDir = mkdtempSync(path.join(tmpdir(), "arcadia-comfy-workflows-"));
    tempDirs.push(workflowDir);
    writeFileSync(path.join(workflowDir, "arcadia-image-generate.json"), JSON.stringify({
      "67": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["71", 0] } },
      "73": { class_type: "RandomNoise", inputs: { noise_seed: 0 } },
      "74": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["71", 0] } },
      "9000": { class_type: "SaveImage", inputs: { images: ["65", 0], filename_prefix: "Arcadia" } },
    }));

    let historyReads = 0;
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/prompt") {
        req.resume();
        req.on("end", () => sendJson(res, 200, { prompt_id: "comfy-test-prompt" }));
        return;
      }
      if (req.method === "GET" && req.url === "/history/comfy-test-prompt") {
        historyReads += 1;
        sendJson(res, 200, historyReads > 1 ? { "comfy-test-prompt": { outputs: { "9000": { images: [{ filename: "arcadia.png", subfolder: "", type: "output" }] } } } } : {});
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/view?")) {
        const bytes = Buffer.from(ONE_PIXEL_PNG_BASE64, "base64");
        res.writeHead(200, { "content-type": "image/png", "content-length": bytes.length });
        res.end(bytes);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test server address.");

    const repository = createSqliteIntelligenceJobRepository(db);
    const artifactStore = createSqliteIntelligenceArtifactStore(db, workspace);
    const config: IntelligenceV01Config = {
      routes: buildDefaultRoutes({ localTextRoute: "arcadia-default", comfyUiImageRoute: "comfyui" }),
      liteLlmBaseUrl: await unavailableLiteLlmBaseUrl(),
      maxRetries: 1,
      workerPollIntervalMs: 10,
      leaseDurationMs: 30_000,
      comfyUi: { baseUrl: `http://127.0.0.1:${address.port}`, workflowDir, timeoutMs: 5_000 },
    };
    const { job: submitted } = await submitIntelligenceRequest(repository, buildIntelligenceRequest({
      capability: "image.generate",
      execution: "local-required",
      profile: "quality",
      input: { prompt: "a tiny blue icon", n: 1 },
      requirements: { imageSize: "1024x1024", transparency: false },
      outputContract: {
        schemaId: "arcadia.comfy-test.v1",
        schemaVersion: 1,
        jsonSchema: { type: "object", properties: { artifacts: { type: "array", minItems: 1 } }, required: ["artifacts"] },
      },
    }));
    const executor = createComfyUiImageExecutor({ workspaceRoot: workspace, artifactStore, config });
    const worker = new IntelligenceWorker(repository, createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl }), config, artifactStore, undefined, undefined, undefined, executor);
    const finished = await worker.runOnce();

    expect(finished?.status, JSON.stringify(finished?.error)).toBe("completed");
    expect(finished?.usage?.provider).toBe("comfyui");
    const artifactId = ((finished?.result as { artifacts: Array<{ id: string }> }).artifacts[0]).id;
    expect((await artifactStore.getArtifactBytes(artifactId))?.mimeType).toBe("image/png");
    db.close();
  });
});

function sendJson(res: Parameters<Parameters<typeof createServer>[0]>[1], status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}
