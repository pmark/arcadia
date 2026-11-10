import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { evaluate, FILE_LIMIT, TREE_LIMIT } from "../scripts/check-large-files.mjs";

describe("large file guard (#2488)", () => {
  it("rejects a new large file, allows a recorded one, rejects growth", () => {
    const big = FILE_LIMIT + 10;
    expect(evaluate([{ path: "a.bin", size: big }], {}).errors).toHaveLength(1);
    expect(evaluate([{ path: "a.bin", size: big }], { "a.bin": big }).errors).toHaveLength(0);
    expect(evaluate([{ path: "a.bin", size: big + 1 }], { "a.bin": big }).errors).toHaveLength(1);
  });
  it("rejects a tree over the cap", () => {
    const files = [{ path: "x", size: TREE_LIMIT + 1 }];
    expect(evaluate(files, { x: TREE_LIMIT + 1 }).errors[0]).toContain("cap");
  });
});
