import { describe, expect, it } from "vitest";
import {
  concatWavBuffers,
  formatIssueCommentary,
  parseIssueRef,
  splitNarrationText,
  stripMarkdownForSpeech,
} from "../../src/intelligence/speech/narration.js";
import { makeWavFixture } from "./testSupport.js";

describe("splitNarrationText", () => {
  it("returns no chunks for empty or whitespace-only text", () => {
    expect(splitNarrationText("")).toEqual([]);
    expect(splitNarrationText("   \n\n  ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    expect(splitNarrationText("One short sentence.")).toEqual(["One short sentence."]);
  });

  it("never exceeds the maximum chunk size", () => {
    const text = [
      "Alpha beta gamma delta epsilon zeta eta theta iota kappa.",
      "Lambda mu nu xi omicron pi rho sigma tau upsilon phi.",
      "Chi psi omega and a few more words to push across the limit.",
    ].join("\n\n");
    const chunks = splitNarrationText(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(60);
    }
    // No words are lost.
    expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it("hard-wraps a single token longer than the limit", () => {
    const chunks = splitNarrationText("abcdefghij", 4);
    expect(chunks).toEqual(["abcd", "efgh", "ij"]);
  });

  it("is deterministic for identical input", () => {
    const text = "First sentence here. Second sentence here.\n\nThird paragraph here.";
    expect(splitNarrationText(text, 25)).toEqual(splitNarrationText(text, 25));
  });

  it("refuses a non-positive chunk size", () => {
    expect(() => splitNarrationText("hello", 0)).toThrow();
  });
});

describe("concatWavBuffers", () => {
  it("concatenates clips of one format and sums their duration", () => {
    const a = makeWavFixture({ sampleRateHz: 24_000, channels: 1, seconds: 0.5 });
    const b = makeWavFixture({ sampleRateHz: 24_000, channels: 1, seconds: 0.25 });
    const combined = concatWavBuffers([a, b]);
    const header = combined.subarray(0, 4).toString("latin1");
    expect(header).toBe("RIFF");
    // 0.75s of 24kHz mono 16-bit PCM.
    expect(combined.byteLength).toBe(44 + Math.round(24_000 * 0.75) * 2);
  });

  it("returns a single clip unchanged in payload for a one-element list", () => {
    const only = makeWavFixture({ seconds: 0.5 });
    const combined = concatWavBuffers([only]);
    expect(combined.equals(only)).toBe(true);
  });

  it("refuses an empty list and non-WAV buffers", () => {
    expect(() => concatWavBuffers([])).toThrow();
    expect(() => concatWavBuffers([Buffer.from("not a wav")])).toThrow();
  });

  it("refuses clips that do not share one audio format", () => {
    const a = makeWavFixture({ sampleRateHz: 24_000, channels: 1 });
    const b = makeWavFixture({ sampleRateHz: 48_000, channels: 1 });
    expect(() => concatWavBuffers([a, b])).toThrow();
  });
});

describe("stripMarkdownForSpeech", () => {
  it("removes emphasis, headings, and link syntax but keeps the words", () => {
    const speech = stripMarkdownForSpeech(
      "# Title\n\n**Bold** and _italic_ with [a link](https://example.com) and `code`.",
    );
    expect(speech.replaceAll(/\s+/g, " ").trim()).toBe(
      "Title Bold and italic with a link and code.",
    );
  });

  it("drops fenced code blocks and quote/list markers", () => {
    const speech = stripMarkdownForSpeech(
      "Intro.\n\n```\nsecret command\n```\n\n> quoted\n\n- item one\n- item two",
    );
    expect(speech).not.toContain("secret command");
    expect(speech).toContain("quoted");
    expect(speech).toContain("item one");
  });
});

describe("formatIssueCommentary", () => {
  it("attributes each comment by its signature name, falling back to the login", () => {
    const text = formatIssueCommentary({
      number: 42,
      title: "Design chat",
      body: "Opening context.",
      comments: [
        { author: { login: "pmark" }, body: "First idea.\n\n— Claudia Mason <claudia.mason@agents.arcadia.local>" },
        { author: { login: "pmark" }, body: "Second idea." },
      ],
    });
    expect(text).toContain("Design chat. Issue 42 commentary.");
    expect(text).toContain("Message 1, from Claudia Mason. First idea.");
    expect(text).not.toContain("claudia.mason@agents.arcadia.local");
    expect(text).toContain("Message 2, from pmark. Second idea.");
  });
});

describe("parseIssueRef", () => {
  it("parses a full URL, a short ref, and a bare number with repo", () => {
    expect(parseIssueRef("https://github.com/pmark/arcadia/issues/944")).toEqual({
      repository: "pmark/arcadia",
      number: 944,
    });
    expect(parseIssueRef("pmark/arcadia#944")).toEqual({ repository: "pmark/arcadia", number: 944 });
    expect(parseIssueRef("944", "pmark/arcadia")).toEqual({ repository: "pmark/arcadia", number: 944 });
  });

  it("refuses ambiguous or malformed references", () => {
    expect(() => parseIssueRef("944")).toThrow();
    expect(() => parseIssueRef("not-an-issue")).toThrow();
  });
});
