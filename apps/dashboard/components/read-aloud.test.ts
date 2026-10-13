import { describe, expect, it } from "vitest";
import { isAudioRetryExhausted } from "./read-aloud";

describe("ReadAloud retry state", () => {
  it("disables another Play attempt after a terminal job uses its retry", () => {
    expect(isAudioRetryExhausted({ status: "failed", retryCount: 1, request: { executionPolicy: { maxRetries: 1 } } } as never)).toBe(true);
    expect(isAudioRetryExhausted({ status: "failed", retryCount: 0, request: { executionPolicy: { maxRetries: 1 } } } as never)).toBe(false);
  });
});
