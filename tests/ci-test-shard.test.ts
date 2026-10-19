import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { partition } from "../scripts/ci-test-shard.mjs";

describe("ci test sharding", () => {
  const files = Array.from({ length: 23 }, (_, i) => `tests/f${i}.test.ts`);
  const weights: Record<string, number> = { "tests/f0.test.ts": 100, "tests/f1.test.ts": 60, "tests/f2.test.ts": 5 };

  it("assigns every file to exactly one shard, including files without a weight", () => {
    const shards = partition(files, weights, 4) as { files: string[]; load: number }[];
    const all = shards.flatMap((s) => s.files);
    expect(all.length).toBe(files.length);
    expect(new Set(all)).toEqual(new Set(files));
  });

  it("is deterministic regardless of discovery order", () => {
    expect(partition([...files].reverse(), weights, 4)).toEqual(partition(files, weights, 4));
  });

  it("keeps the heaviest files on different shards", () => {
    const shards = partition(files, weights, 4) as { files: string[] }[];
    const home = (f: string) => shards.findIndex((s) => s.files.includes(f));
    expect(home("tests/f0.test.ts")).not.toBe(home("tests/f1.test.ts"));
  });
});
