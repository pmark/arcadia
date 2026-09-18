import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(repositoryRoot, "scripts", "preservation-self-check.mjs");
const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-self-check-"));
  roots.push(root);
  for (const file of ["CONSTITUTION.md", "AGENTS.md", "PROJECT.md", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    writeFileSync(path.join(root, file), "ok\n");
  }
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  return root;
}

function run(root: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("preservation self-check", () => {
  it("passes on Arcadia's tracked tree without installed dependencies", () => {
    const result = run(repositoryRoot);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("passes on a well-formed fixture and resolves relative imports", () => {
    const root = fixture();
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/good.ts"), "export const ok = true;\n");
    writeFileSync(path.join(root, "src/main.ts"), 'import { ok } from "./good.js";\n');
    expect(run(root).status).toBe(0);
  });

  it("fails on invalid JSON, conflict markers, a missing required file, and an unresolved import", () => {
    const invalidJson = fixture();
    writeFileSync(path.join(invalidJson, "broken.json"), "{ not json");
    expect(run(invalidJson).stderr).toContain("invalid JSON");

    const conflicted = fixture();
    writeFileSync(path.join(conflicted, "src.ts"), "<<<<<<< HEAD\n");
    expect(run(conflicted).stderr).toContain("merge conflict markers");

    const missing = fixture();
    rmSync(path.join(missing, "CONSTITUTION.md"));
    expect(run(missing).stderr).toContain("missing required file: CONSTITUTION.md");

    const unresolved = fixture();
    mkdirSync(path.join(unresolved, "src"));
    writeFileSync(path.join(unresolved, "src/main.ts"), 'import { gone } from "./gone.js";\n');
    expect(run(unresolved).stderr).toContain("unresolved relative import");
  });
});
