import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runWorktreeRuntimeProbe } from "../src/sessions/worktreeRuntimeProbe.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("worktree runtime host probe", () => {
  it("runs the TypeScript CLI through Node's loader instead of tsx's IPC-owning CLI", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.arcadia).toContain("node --import tsx src/cli.ts");
    expect(packageJson.scripts.arcadia).not.toContain("mise exec -- tsx");
  });

  it("uses a disposable candidate under the Codex root and checks every required local path", () => {
    const fixture = createFixture();
    const run = vi.fn();

    const result = runWorktreeRuntimeProbe({
      repository: fixture.repository,
      home: fixture.home,
      brokerEntrypoint: fixture.entrypoint,
      now: new Date("2026-09-07T14:40:00.000Z"),
      run
    });

    expect(result.candidatePath).toBe(path.join(fixture.home, ".codex", "worktrees", `.arcadia-host-probe-20260907T144000000Z-${process.pid}`, "arcadia"));
    expect(result.checked).toEqual([
      "candidate-worktree",
      "candidate-root-write",
      "source-write",
      "dependency-preparation",
      "temporary-sqlite",
      "candidate-build",
      "dashboard-build",
      "vitest",
      "compiled-broker"
    ]);
    expect(run.mock.calls).toEqual(expect.arrayContaining([
      ["git", ["worktree", "add", "--detach", result.candidatePath, "HEAD"], fixture.repository],
      ["pnpm", ["bridge:worktree"], result.candidatePath],
      ["pnpm", ["dashboard:build"], result.candidatePath],
      [process.execPath, ["--check", fixture.entrypoint], result.candidatePath],
      ["git", ["worktree", "remove", "--force", result.candidatePath], fixture.repository]
    ]));
  });

  it("removes the timestamped wrapper directory it created for the candidate", () => {
    const fixture = createFixture();
    const run = vi.fn((command: string, args: string[]) => {
      if (command !== "git" || args[0] !== "worktree") return;
      if (args[1] === "add") mkdirSync(args[3]!, { recursive: true });
      if (args[1] === "remove") rmSync(args[3]!, { recursive: true, force: true });
    });

    const result = runWorktreeRuntimeProbe({
      repository: fixture.repository,
      home: fixture.home,
      brokerEntrypoint: fixture.entrypoint,
      run
    });

    const wrapper = path.dirname(result.candidatePath);
    expect(path.basename(wrapper)).toMatch(/^\.arcadia-host-probe-/);
    expect(existsSync(wrapper)).toBe(false);
    expect(existsSync(path.join(fixture.home, ".codex", "worktrees"))).toBe(true);
  });

  it("leaves the wrapper directory in place when the candidate could not be retired", () => {
    const fixture = createFixture();
    const run = vi.fn((command: string, args: string[]) => {
      if (command === "git" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
      if (command === "git" && args[1] === "remove") throw new Error("worktree is locked");
    });

    let candidatePath = "";
    try {
      runWorktreeRuntimeProbe({ repository: fixture.repository, home: fixture.home, brokerEntrypoint: fixture.entrypoint, run });
      throw new Error("expected probe failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      const details = (error as ArcadiaError).details as Record<string, unknown>;
      expect(details.step).toBe("candidate-worktree");
      expect(String(details.remedy)).toContain("git worktree remove --force");
      candidatePath = String(details.candidatePath);
    }

    expect(existsSync(candidatePath)).toBe(true);
    expect(existsSync(path.dirname(candidatePath))).toBe(true);
  });

  it("turns an IPC EPERM into a denial-focused error with one remedy", () => {
    const fixture = createFixture();
    const run = vi.fn((command: string, args: string[]) => {
      if (command === "pnpm" && args[0] === "bridge:worktree") {
        const error = Object.assign(new Error("listen EPERM: operation not permitted"), { code: "EPERM" });
        throw error;
      }
    });

    try {
      runWorktreeRuntimeProbe({ repository: fixture.repository, home: fixture.home, brokerEntrypoint: fixture.entrypoint, run });
      throw new Error("expected probe failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      const details = (error as ArcadiaError).details as Record<string, unknown>;
      expect(details).toMatchObject({ step: "dependency-preparation", code: "EPERM", operation: "local IPC listener", denial: true });
      expect(String(details.remedy)).toContain("workspace-write sandbox roots");
    }
    expect(run).toHaveBeenLastCalledWith("git", expect.arrayContaining(["worktree", "remove", "--force"]), fixture.repository);
  });
});

function createFixture(): { home: string; repository: string; entrypoint: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-worktree-runtime-probe-"));
  roots.push(root);
  const home = path.join(root, "home");
  const repository = path.join(root, "arcadia");
  const entrypoint = path.join(root, "broker.js");
  mkdirSync(path.join(repository, "src"), { recursive: true });
  writeFileSync(entrypoint, "process.exit(0);\n");
  return { home, repository, entrypoint };
}
