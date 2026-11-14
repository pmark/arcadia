import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Issue #2632: services.sh derives REPO from its own location and the restart implementation hashes that path
 * into the com.arcadia.local.<cksum>.* launchd labels, so restart/stop from a linked worktree would replace
 * the live label set. The guard sits in the adapter (scripts/restart-services-impl.sh is hash-pinned).
 * Everything external is a stub: no real launchctl, pnpm or restart implementation runs.
 */
const realScript = path.resolve(__dirname, "..", "scripts", "services.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.test" }
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function install(checkout: string): string {
  const dir = path.join(checkout, "scripts");
  mkdirSync(dir, { recursive: true });
  cpSync(path.resolve(__dirname, "..", "scripts", "lib"), path.join(dir, "lib"), { recursive: true });
  const copy = path.join(dir, "services.sh");
  copyFileSync(realScript, copy);
  chmodSync(copy, 0o755);
  return copy;
}

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-main-guard-")));
  roots.push(root);
  const main = path.join(root, "main");
  mkdirSync(main);
  git(main, ["init", "-q", "-b", "main"]);
  install(main);
  git(main, ["add", "."]);
  git(main, ["commit", "-q", "-m", "init"]);
  const worktree = path.join(root, "linked-wt");
  git(main, ["worktree", "add", "-q", "-b", "feature", worktree]);
  const worktreeScript = path.join(worktree, "scripts", "services.sh");

  const calls = path.join(root, "calls");
  writeFileSync(calls, "");
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  for (const name of ["launchctl", "pnpm"]) {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\nexit 0\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  const impl = path.join(root, "impl.sh");
  writeFileSync(impl, `#!/usr/bin/env bash\necho "impl $1" >> "${calls}"\nexit 0\n`);
  chmodSync(impl, 0o755);

  const run = (script: string, action: string, extraEnv: Record<string, string> = {}) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      ARCADIA_RESTART_SCRIPT: impl,
      ARCADIA_DASHBOARD_WARM: "0",
      HOME: path.join(root, "home"),
      ...extraEnv
    };
    delete env.ARCADIA_WORKSPACE;
    if (!("ARCADIA_ALLOW_NONMAIN_CHECKOUT" in extraEnv)) delete env.ARCADIA_ALLOW_NONMAIN_CHECKOUT;
    return spawnSync("bash", [script, action], { encoding: "utf8", cwd: path.dirname(path.dirname(script)), env });
  };
  const called = () => readFileSync(calls, "utf8").trim().split("\n").filter(Boolean);
  return { root, main, worktree, mainScript: path.join(main, "scripts", "services.sh"), worktreeScript, run, called };
}

describe("services.sh main-checkout guard (Issue #2632)", () => {
  for (const action of ["restart", "stop"]) {
    it(`refuses ${action} from a linked worktree, naming both checkouts, without reaching the implementation or launchctl`, () => {
      const f = fixture();
      const result = f.run(f.worktreeScript, action);
      expect(result.status, result.stderr).toBe(3);
      expect(result.stderr).toContain(f.worktree);
      expect(result.stderr).toContain(f.main);
      expect(f.called()).toEqual([]);
    });

    it(`still reaches the implementation for ${action} from the main checkout`, () => {
      const f = fixture();
      const result = f.run(f.mainScript, action);
      expect(result.status, result.stderr).toBe(0);
      expect(f.called()).toContain(`impl ${action}`);
      expect(f.called().filter((line) => line.startsWith("launchctl"))).toEqual([]);
    });
  }

  it("never refuses status from a linked worktree", () => {
    const f = fixture();
    const result = f.run(f.worktreeScript, "status");
    expect(result.status, result.stderr).toBe(0);
    expect(f.called()).toContain("impl status");
  });

  it("accepts ARCADIA_ALLOW_NONMAIN_CHECKOUT=<reason>, prints the reason, and proceeds", () => {
    const f = fixture();
    const result = f.run(f.worktreeScript, "restart", { ARCADIA_ALLOW_NONMAIN_CHECKOUT: "rehearsal fixture" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("rehearsal fixture");
    expect(f.called()).toContain("impl restart");
  });

  it("proceeds with a warning when git cannot decide", () => {
    const f = fixture();
    // A copy outside any git repository: rev-parse fails, so the guard cannot tell.
    const loose = path.join(f.root, "loose");
    mkdirSync(loose);
    const script = install(loose);
    const result = f.run(script, "restart", { GIT_CEILING_DIRECTORIES: f.root });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/cannot tell/i);
    expect(f.called()).toContain("impl restart");
    expect(existsSync(path.join(loose, ".git"))).toBe(false);
  });
});
