import { readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceWorker } from "../../src/intelligence/jobs/worker.js";
import { createSqliteIntelligenceArtifactStore } from "../../src/intelligence/artifacts/store.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import { submitIntelligenceRequest } from "../../src/intelligence/service/jobService.js";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import { DEFAULT_VOICE_MAP } from "../../src/intelligence/speech/voices.js";
import { SpeechUnavailableError } from "../../src/intelligence/speech/client.js";
import { parseSpeechInput } from "../../src/intelligence/speech/input.js";
import { createFfmpegMp3Encoder } from "../../src/intelligence/speech/mp3Encoder.js";
import { createIntelligenceServer } from "../../src/intelligence/api/server.js";
import { buildIntelligenceRequest, createTempWorkspace, openWorkspaceDatabase, removeWorkspace, makeWavFixture, closeServer, testIntelligenceConfig } from "./testSupport.js";
import type { IntelligenceSpeechGenerationResult } from "../../src/intelligence/types.js";
import type { Server } from "node:http";
const cleanups: Array<() => void> = [];
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(closeServer)); cleanups.splice(0).forEach(fn => fn()); });
function setup() {
  const workspace = createTempWorkspace(); const db = openWorkspaceDatabase(workspace);
  cleanups.push(() => { db.close(); removeWorkspace(workspace); });
  const repository = createSqliteIntelligenceJobRepository(db); const artifactStore = createSqliteIntelligenceArtifactStore(db, workspace);
  const config = { ...testIntelligenceConfig(), routes: buildDefaultRoutes({ localSpeechRoute: "speech" }), speech: { voiceMap: DEFAULT_VOICE_MAP } };
  const speech = { generateSpeech: vi.fn().mockResolvedValue({ bytes: makeWavFixture({ seconds: 0.1 }), contentType: "audio/wav", provider: "fixture", model: "fixture" }) };
  const mp3 = Buffer.concat([Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00"), Buffer.from([0xff, 0xf3, 0x84, 0xc0]), Buffer.alloc(200)]);
  const encoder = { assertAvailable: vi.fn().mockResolvedValue(undefined), encode: vi.fn().mockResolvedValue(mp3) };
  const worker = new IntelligenceWorker(repository, { generateStructured: vi.fn() } as never, config, artifactStore, undefined, undefined, speech, undefined, undefined, "mp3-test", encoder);
  const request = buildIntelligenceRequest({ capability: "audio.speech.generate", input: { text: "First paragraph.\n\nSecond paragraph.", voiceId: "arcadia.narrator", format: "mp3" }, outputContract: { schemaId: "audio", schemaVersion: 1, jsonSchema: { type: "object", required: ["artifact"] } } });
  return { workspace, db, repository, artifactStore, config, speech, encoder, worker, request, mp3 };
}
describe("durable long-form MP3 speech", () => {
  it("assembles all utterances, encodes once, survives store recreation and supports range retrieval", async () => {
    const s = setup();
    const submitted = await submitIntelligenceRequest(s.repository, s.request);
    const job = await s.worker.runJob(submitted.job.id);
    expect(job?.status).toBe("completed");
    const result = job?.result as unknown as IntelligenceSpeechGenerationResult;
    expect(result.chunkCount).toBe(2);
    expect(result.artifact).toMatchObject({ format: "mp3", mimeType: "audio/mpeg", durationSeconds: 0.2 });
    expect(s.speech.generateSpeech.mock.calls.every(([input]) => input.format === "wav")).toBe(true);
    expect(s.encoder.encode).toHaveBeenCalledTimes(1);
    const reopenedStore = createSqliteIntelligenceArtifactStore(s.db, s.workspace);
    expect((await reopenedStore.getArtifactBytes(result.artifact.id))?.bytes).toEqual(s.mp3);
    const replay = await submitIntelligenceRequest(s.repository, s.request);
    expect(replay.job.id).toBe(submitted.job.id);
    expect(replay.job.status).toBe("completed");
    const server = createIntelligenceServer({ repository: s.repository, config: s.config, artifactStore: reopenedStore });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); servers.push(server);
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${result.artifact.uri}`, { headers: { range: "bytes=0-2" } });
    expect(response.status).toBe(206); expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("ID3"));
  });
  it("blocks unavailable MP3 encoding before any provider work or artifact is created", async () => {
    const s = setup(); s.encoder.assertAvailable.mockRejectedValue(new SpeechUnavailableError("Install FFmpeg", "MP3_ENCODER_UNAVAILABLE"));
    const submitted = await submitIntelligenceRequest(s.repository, s.request); const job = await s.worker.runJob(submitted.job.id);
    expect(job?.status).toBe("blocked"); expect(job?.error?.code).toBe("MP3_ENCODER_UNAVAILABLE");
    expect(s.speech.generateSpeech).not.toHaveBeenCalled();
    expect(readdirSync(path.join(s.workspace, "artifacts"))).not.toContain("intelligence");
  });
  it("fails partial synthesis without publishing a partial audio asset", async () => {
    const s = setup(); s.speech.generateSpeech.mockResolvedValueOnce({ bytes: makeWavFixture({ seconds: 0.1 }), contentType: "audio/wav", provider: "fixture", model: "fixture" }).mockRejectedValueOnce(new Error("Provider failed on second chunk"));
    const submitted = await submitIntelligenceRequest(s.repository, s.request); const job = await s.worker.runJob(submitted.job.id);
    expect(job?.status).toBe("failed"); expect(s.speech.generateSpeech).toHaveBeenCalledTimes(2); expect(s.encoder.encode).not.toHaveBeenCalled();
    expect(s.db.prepare("select count(*) as count from intelligence_job_artifacts").get()).toEqual({ count: 0 });
  });
  it("validates formats and text limits, with WAV remaining the default", () => {
    expect(parseSpeechInput({ text: "Hello", voiceId: "arcadia.narrator" }).format).toBe("wav");
    expect(() => parseSpeechInput({ text: "Hello", voiceId: "arcadia.narrator", format: "ogg" })).toThrow();
    expect(() => parseSpeechInput({ text: "x".repeat(100_001), voiceId: "arcadia.narrator" })).toThrow();
  });
  it("reports a missing host encoder as a typed environmental blocker", async () => {
    await expect(createFfmpegMp3Encoder("/does-not-exist/ffmpeg").assertAvailable()).rejects.toMatchObject({ code: "MP3_ENCODER_UNAVAILABLE" });
  });
});
