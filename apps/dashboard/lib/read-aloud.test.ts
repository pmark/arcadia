import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), retry: vi.fn() }));
vi.mock("./intelligence", () => ({ getIntelligenceClient: () => mocks }));
import { buildReadAloudRequest, submitReadAloud } from "./read-aloud";
describe("generic read-aloud requests", () => {
  it("requests a durable MP3 locally and keys reuse to actual narration content", () => {
    const first = buildReadAloudRequest("A decision needs approval.");
    expect(first).toMatchObject({ capability: "audio.speech.generate", execution: "local-required", input: { format: "mp3", voiceId: "arcadia.narrator" }, executionPolicy: { allowPaidUsage: false } });
    expect(buildReadAloudRequest("  A decision needs approval.  ").idempotencyKey).toBe(first.idempotencyKey);
    expect(buildReadAloudRequest("Approval was granted.").idempotencyKey).not.toBe(first.idempotencyKey);
  });
  it("rejects empty and excessively large submissions", () => {
    expect(() => buildReadAloudRequest(" ")).toThrow();
    expect(() => buildReadAloudRequest("x".repeat(100_001))).toThrow();
  });
});

it("reuses completed assets and respects the existing retry ceiling", async () => {
  mocks.submit.mockResolvedValue({ job: { id: "same-job", status: "completed", retryCount: 0 } });
  expect((await submitReadAloud("hello")).id).toBe("same-job");
  expect(mocks.retry).not.toHaveBeenCalled();
  mocks.submit.mockResolvedValue({ job: { id: "same-job", status: "blocked", retryCount: 0 } });
  mocks.retry.mockResolvedValue({ job: { id: "same-job", status: "queued", retryCount: 1 } });
  expect((await submitReadAloud("hello")).retryCount).toBe(1);
  mocks.submit.mockResolvedValue({ job: { id: "same-job", status: "blocked", retryCount: 1 } });
  await submitReadAloud("hello");
  expect(mocks.retry).toHaveBeenCalledTimes(1);
});
