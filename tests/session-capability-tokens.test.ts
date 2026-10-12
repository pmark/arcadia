import { describe, expect, it } from "vitest";
import { sessionTokensFromLog } from "../src/production/sessionCapability.js";

describe("sessionTokensFromLog", () => {
  it("treats Codex cached_input_tokens as a subset of input_tokens", () => {
    const log = [
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 50 } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 200, cached_input_tokens: 500, output_tokens: 5 } })
    ].join("\n");
    // Second event's cached subset is clamped to its total, never negative uncached.
    expect(sessionTokensFromLog(log)).toEqual({ inputTokens: 600, cachedInputTokens: 600, outputTokens: 55 });
  });

  it("keeps Claude result cache fields separate and additive", () => {
    const log = JSON.stringify({
      type: "result",
      usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 7 }
    });
    expect(sessionTokensFromLog(log)).toEqual({ inputTokens: 10, cachedInputTokens: 1000, outputTokens: 7 });
  });

  it("returns null when the log reports no usage", () => {
    expect(sessionTokensFromLog("plain text\n")).toBeNull();
  });
});
