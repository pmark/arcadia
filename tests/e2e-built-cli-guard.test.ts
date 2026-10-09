import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { staleBuiltCliMessage } from "./e2e/fixtures/builtCliGuard.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-e2e-guard-"));
  roots.push(root);
  mkdirSync(path.join(root, "src", "nested"), { recursive: true });
  mkdirSync(path.join(root, "dist", "src"), { recursive: true });
  return root;
}

function touch(file: string, seconds: number): void {
  writeFileSync(file, "");
  utimesSync(file, seconds, seconds);
}

describe("e2e built CLI guard (#1106)", () => {
  it("refuses when dist has not been built", () => {
    const root = repo();
    touch(path.join(root, "src", "cli.ts"), 1000);
    expect(staleBuiltCliMessage(root)).toMatch(/does not exist.*pnpm build/);
  });

  it("refuses when any source file, however nested, is newer than the built CLI", () => {
    const root = repo();
    touch(path.join(root, "dist", "src", "cli.js"), 1000);
    touch(path.join(root, "src", "cli.ts"), 900);
    touch(path.join(root, "src", "nested", "changed.ts"), 2000);
    expect(staleBuiltCliMessage(root)).toMatch(/older than src.*nested\/changed\.ts.*pnpm build/);
  });

  it("passes when the built CLI is newer than every source file", () => {
    const root = repo();
    touch(path.join(root, "src", "cli.ts"), 900);
    touch(path.join(root, "src", "nested", "a.ts"), 950);
    touch(path.join(root, "dist", "src", "cli.js"), 1000);
    expect(staleBuiltCliMessage(root)).toBeNull();
  });
});
