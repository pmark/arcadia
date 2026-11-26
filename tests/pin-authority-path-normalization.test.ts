import { describe, expect, it } from "vitest";
import { normalizeAuthorityPath } from "../src/decisions/batchMerge.js";

describe("normalizeAuthorityPath", () => {
  it("reduces separators, empty and dot segments, and keeps case", () => {
    expect(normalizeAuthorityPath("src/a.ts")).toBe("src/a.ts");
    expect(normalizeAuthorityPath("./src//a.ts")).toBe("src/a.ts");
    expect(normalizeAuthorityPath("src\\a.ts")).toBe("src/a.ts");
    expect(normalizeAuthorityPath("docs/./x.md")).toBe("docs/x.md");
    expect(normalizeAuthorityPath("src/A.TS")).toBe("src/A.TS");
  });

  it("refuses non-strings, empty, dot, absolute, drive and parent paths", () => {
    for (const input of [42, null, "", ".", "/etc/x", "C:/x", "../x", "a/../b"]) {
      expect(normalizeAuthorityPath(input)).toBeNull();
    }
  });

  it("refuses padded or dot-terminated segments, control and non-ASCII characters", () => {
    for (const input of [" a/b", "a /b", "a/b.", "a/b\tc", "a/b\u00e9"]) {
      expect(normalizeAuthorityPath(input)).toBeNull();
    }
  });
});
