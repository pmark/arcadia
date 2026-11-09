import { describe, expect, it } from "vitest";
import { firstRepositoryFrame } from "../src/soak/rehearsalSoak.js";

describe("firstRepositoryFrame", () => {
  it("returns the first tests, src or scripts frame, skipping node_modules", () => {
    const stack = [
      "Error: boom",
      "    at node_modules/x/index.js:5:1",
      "    at src/foo/bar.ts:12:3",
      "    at tests/foo.test.ts:7:1",
    ].join("\n");
    expect(firstRepositoryFrame(stack)).toBe("src/foo/bar.ts:12");
  });

  it("drops the column and supports scripts and tests frames", () => {
    expect(firstRepositoryFrame("at scripts/run.mjs:9:2")).toBe("scripts/run.mjs:9");
    expect(firstRepositoryFrame("Error: x\n    at tests/foo.test.ts:3:1")).toBe("tests/foo.test.ts:3");
  });

  it("returns null when there is no repository frame", () => {
    expect(firstRepositoryFrame("Error: no frames here")).toBeNull();
    expect(firstRepositoryFrame("at node_modules/x/index.js:5:1")).toBeNull();
    expect(firstRepositoryFrame("")).toBeNull();
  });
});
