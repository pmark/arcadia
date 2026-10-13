import { describe, expect, it } from "vitest";
import { isAudioRetryExhausted, readAloudPlayerKey } from "./read-aloud";

describe("ReadAloud retry state", () => {
  it("disables another Play attempt after a terminal job uses its retry", () => {
    expect(isAudioRetryExhausted({ status: "failed", retryCount: 1, request: { executionPolicy: { maxRetries: 1 } } } as never)).toBe(true);
    expect(isAudioRetryExhausted({ status: "failed", retryCount: 0, request: { executionPolicy: { maxRetries: 1 } } } as never)).toBe(false);
  });

  it("resets the player identity when the PR, source revision, or summary job changes", () => {
    const a = readAloudPlayerKey("/api/pull-requests/audio", { repository: "owner/repo", number: 2, sourceRevision: "rev-a", summaryJobId: "job-a" });
    expect(readAloudPlayerKey("/api/pull-requests/audio", { repository: "owner/repo", number: 2, sourceRevision: "rev-b", summaryJobId: "job-a" })).not.toBe(a);
    expect(readAloudPlayerKey("/api/pull-requests/audio", { repository: "owner/repo", number: 2, sourceRevision: "rev-a", summaryJobId: "job-b" })).not.toBe(a);
    expect(readAloudPlayerKey("/api/pull-requests/audio", { repository: "other/repo", number: 3, sourceRevision: "rev-a", summaryJobId: "job-a" })).not.toBe(a);
  });
});
