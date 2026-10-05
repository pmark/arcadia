import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseIssueCommentary, runIntelligenceNarrateCommand } from "../../src/commands/narrate.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import {
  buildIntelligenceRequest,
  closeServer,
  createTempWorkspace,
  makeWavFixture,
  openWorkspaceDatabase,
  removeWorkspace,
  startFakeOpenAiSpeech,
} from "./testSupport.js";

const workspaces: string[] = [];
const servers: Server[] = [];

beforeEach(() => {
  vi.stubEnv("ARCADIA_SPEECH_LOCAL_ROUTE", "arcadia-speech");
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const workspace of workspaces.splice(0)) removeWorkspace(workspace);
  vi.unstubAllEnvs();
});

function newWorkspace(): string {
  const workspace = createTempWorkspace();
  workspaces.push(workspace);
  return workspace;
}

describe("intelligence narrate command", () => {
  it("narrates inline text into one durable WAV artifact", async () => {
    const workspace = newWorkspace();
    const wav = makeWavFixture({ sampleRateHz: 24_000, channels: 1, seconds: 0.4 });
    const { server, baseUrl } = await startFakeOpenAiSpeech({ wavBytes: wav });
    servers.push(server);
    vi.stubEnv("ARCADIA_LITELLM_BASE_URL", baseUrl);

    const out = path.join(workspace, "narration.wav");
    const response = await runIntelligenceNarrateCommand({
      workspace,
      text: "A single short sentence.",
      out,
    });

    expect(response.data.chunkCount).toBe(1);
    expect(response.data.jobIds).toHaveLength(1);
    expect(response.data.durationSeconds).toBeCloseTo(0.4, 2);
    expect(response.data.source).toBe("inline text");
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).subarray(0, 4).toString("latin1")).toBe("RIFF");
  });

  it("splits long text into several provider calls and concatenates their duration", async () => {
    const workspace = newWorkspace();
    let requests = 0;
    const { server, baseUrl } = await startFakeOpenAiSpeech({
      wavBytes: makeWavFixture({ sampleRateHz: 24_000, channels: 1, seconds: 0.25 }),
      onRequest: () => {
        requests += 1;
      },
    });
    servers.push(server);
    vi.stubEnv("ARCADIA_LITELLM_BASE_URL", baseUrl);

    const paragraphs = Array.from(
      { length: 4 },
      (_, index) => `Paragraph number ${index + 1} has several words in it.`,
    ).join("\n\n");

    const out = path.join(workspace, "long.wav");
    const response = await runIntelligenceNarrateCommand({
      workspace,
      text: paragraphs,
      out,
      maxChunkChars: 40,
    });

    expect(response.data.chunkCount).toBeGreaterThan(1);
    expect(requests).toBe(response.data.chunkCount);
    expect(response.data.durationSeconds).toBeCloseTo(0.25 * response.data.chunkCount, 2);
  });

  it("narrates a local file", async () => {
    const workspace = newWorkspace();
    const { server, baseUrl } = await startFakeOpenAiSpeech({ wavBytes: makeWavFixture({ seconds: 0.2 }) });
    servers.push(server);
    vi.stubEnv("ARCADIA_LITELLM_BASE_URL", baseUrl);

    const sourceFile = path.join(workspace, "source.txt");
    writeFileSync(sourceFile, "File sourced narration.");

    const out = path.join(workspace, "from-file.wav");
    const response = await runIntelligenceNarrateCommand({ workspace, file: sourceFile, out });
    expect(response.data.source).toBe(sourceFile);
    expect(existsSync(out)).toBe(true);
  });

  it("refuses zero or multiple sources before touching the workspace", async () => {
    const workspace = newWorkspace();
    await expect(runIntelligenceNarrateCommand({ workspace })).rejects.toThrow();
    await expect(
      runIntelligenceNarrateCommand({ workspace, text: "one", file: "two" }),
    ).rejects.toThrow();
  });

  it("fails a chunk with an unknown voice and writes no output file", async () => {
    const workspace = newWorkspace();
    const { server, baseUrl } = await startFakeOpenAiSpeech({ wavBytes: makeWavFixture({}) });
    servers.push(server);
    vi.stubEnv("ARCADIA_LITELLM_BASE_URL", baseUrl);

    const out = path.join(workspace, "never.wav");
    await expect(
      runIntelligenceNarrateCommand({ workspace, text: "hello", voiceId: "arcadia.nonexistent", out }),
    ).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it("executes only its own submitted job, leaving an unrelated queued job untouched", async () => {
    const workspace = newWorkspace();
    const { server, baseUrl } = await startFakeOpenAiSpeech({ wavBytes: makeWavFixture({ seconds: 0.2 }) });
    servers.push(server);
    vi.stubEnv("ARCADIA_LITELLM_BASE_URL", baseUrl);

    // Seed an unrelated queued job, as a live workspace's Intelligence queue
    // legitimately may hold. The narration must not claim and run it.
    const seedDb = openWorkspaceDatabase(workspace);
    const seedRepo = createSqliteIntelligenceJobRepository(seedDb);
    const unrelated = await submitIntelligenceRequest(
      seedRepo,
      buildIntelligenceRequest({ operationId: "other-app.queued" }),
    );
    seedDb.close();

    const response = await runIntelligenceNarrateCommand({
      workspace,
      text: "hello",
      out: path.join(workspace, "own.wav"),
    });
    expect(response.data.chunkCount).toBe(1);
    expect(response.data.jobIds).not.toContain(unrelated.job.id);

    const checkDb = openWorkspaceDatabase(workspace);
    const checkRepo = createSqliteIntelligenceJobRepository(checkDb);
    const after = await checkRepo.findById(unrelated.job.id);
    checkDb.close();
    expect(after?.status).toBe("queued");
  });
});

describe("parseIssueCommentary", () => {
  it("maps the gh JSON payload and falls back for missing fields", () => {
    const issue = parseIssueCommentary(
      JSON.stringify({
        number: 12,
        title: "Hello",
        body: null,
        comments: [
          { body: "First", author: { login: "alice" } },
          { body: null, author: null },
        ],
      }),
      999,
    );
    expect(issue.number).toBe(12);
    expect(issue.title).toBe("Hello");
    expect(issue.body).toBeNull();
    expect(issue.comments).toEqual([
      { body: "First", author: { login: "alice" } },
      { body: "", author: null },
    ]);
  });

  it("throws on unreadable JSON", () => {
    expect(() => parseIssueCommentary("not json", 1)).toThrow();
  });
});
