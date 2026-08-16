import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("checked-in toolchain", () => {
  it("keeps mise, package metadata, and the native ABI on one Node and pnpm pair", () => {
    const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
      engines?: { node?: string };
      packageManager?: string;
      volta?: unknown;
    };
    const miseConfig = readFileSync(path.join(repositoryRoot, "mise.toml"), "utf8");

    expect(miseConfig).toMatch(/^node = "22\.23\.1"$/m);
    expect(miseConfig).toMatch(/^node\.corepack = true$/m);
    expect(miseConfig).toMatch(/^activate_aggressive = true$/m);
    expect(packageJson.engines?.node).toBe("22.x");
    expect(packageJson.packageManager).toBe("pnpm@11.7.0");
    expect(packageJson.volta).toBeUndefined();
    expect(existsSync(path.join(repositoryRoot, ".nvmrc"))).toBe(false);
  });
});
