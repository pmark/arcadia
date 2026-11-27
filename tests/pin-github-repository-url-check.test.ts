import { describe, expect, it } from "vitest";
import { decodeStringArray, validateGitHubRepositoryUrl } from "../src/projects/setup.js";

const message = "Repository URL must identify a GitHub repository using HTTPS or SSH.";

describe("GitHub repository URL check", () => {
  it.each([
    ["https://github.com/pmark/arcadia", "https://github.com/pmark/arcadia"],
    ["  https://github.com/pmark/arcadia.git  ", "https://github.com/pmark/arcadia.git"],
    ["git@github.com:pmark/arcadia.git", "git@github.com:pmark/arcadia.git"],
  ])("accepts %j as %j", (value, expected) => {
    expect(validateGitHubRepositoryUrl(value)).toBe(expected);
  });

  it.each(["", "   ", null, undefined])("returns null for %j", (value) => {
    expect(validateGitHubRepositoryUrl(value)).toBeNull();
  });

  it.each([
    "http://github.com/pmark/arcadia",
    "https://gitlab.com/pmark/arcadia",
    "https://github.com/pmark",
    "https://github.com/pmark/arcadia/",
    "https://github.com/pmark/arcadia/tree/main",
  ])("rejects %j", (value) => {
    expect(() => validateGitHubRepositoryUrl(value)).toThrow(message);
  });
});

describe("stored string array decoding", () => {
  it("keeps trimmed, non-empty, unique strings in order", () => {
    expect(decodeStringArray('["a"," b ","a",1,null,""]')).toEqual(["a", "b"]);
  });

  it.each(['{"a":1}', '"x"', "not json", "", null, undefined])("returns [] for %j", (raw) => {
    expect(decodeStringArray(raw)).toEqual([]);
  });
});
