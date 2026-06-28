import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const clientEntry = path.join(repoRoot, "dist/src/intelligence/client/index.js");

describe("@pmark/arcadia public package boundary", () => {
  beforeAll(() => {
    // The exports map points at built output, so this suite needs a build.
    // `pnpm test` may run before `pnpm build`, so build here if needed rather
    // than depending on CI step order.
    if (!existsSync(clientEntry)) {
      execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: repoRoot });
    }
  });


  it("emits the built files the exports map points to", () => {
    expect(existsSync(path.join(repoRoot, "dist/src/intelligence/client/index.js"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "dist/src/intelligence/client/index.d.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "dist/src/intelligence/contracts.js"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "dist/src/intelligence/contracts.d.ts"))).toBe(true);
  });

  it("resolves only the documented subpaths and rejects internal paths", () => {
    // Runs in a plain Node process (not Vite's resolver) so the package's own
    // "exports" map, the same mechanism pnpm link consumers rely on, is what
    // actually gets exercised.
    const output = execFileSync(
      "node",
      [path.join(repoRoot, "scripts/verify-intelligence-package-exports.mjs")],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(output).toContain("OK: @pmark/arcadia public package boundary verified.");
  });
});
