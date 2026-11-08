import { describe, expect, it } from "vitest";
import { parseIssueRef } from "../src/intelligence/speech/narration.js";

describe("parseIssueRef", () => {
  it("parses a GitHub issue URL with a fragment", () => {
    expect(parseIssueRef("https://github.com/pmark/arcadia/issues/2143#issuecomment-1")).toEqual({
      repository: "pmark/arcadia",
      number: 2143,
    });
  });

  it("parses an owner/repo#number reference", () => {
    expect(parseIssueRef("pmark/arcadia#2144")).toEqual({ repository: "pmark/arcadia", number: 2144 });
  });

  it("parses a bare number with a trimmed repo", () => {
    expect(parseIssueRef(" 42 ", " pmark/arcadia ")).toEqual({ repository: "pmark/arcadia", number: 42 });
  });

  it("rejects blank input", () => {
    expect(() => parseIssueRef("  ")).toThrow("An issue reference is required.");
  });

  it("requires --repo for a bare number", () => {
    expect(() => parseIssueRef("42")).toThrow("--repo");
    expect(() => parseIssueRef("42", "bad")).toThrow("--repo");
  });

  it("rejects unrecognised references", () => {
    expect(() => parseIssueRef("foo")).toThrow("Issue reference must be");
  });
});
