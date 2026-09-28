import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertClean, untrackedDraftAskPaths } from "../src/git/worktrees.js";

describe("assertClean with pending draft Agent Asks", () => {
  let repo: string;
  const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), "assert-clean-asks-"));
    run("init", "-q");
    run("config", "user.email", "t@example.com");
    run("config", "user.name", "t");
    writeFileSync(path.join(repo, "README.md"), "x\n");
    run("add", ".");
    run("commit", "-q", "-m", "init");
    mkdirSync(path.join(repo, ".arcadia", "asks"), { recursive: true });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("ignores an untracked draft Ask from another session", () => {
    writeFileSync(path.join(repo, ".arcadia/asks/agent-ask-other-session.yaml"), "agent_ask: v1\n");
    expect(() => assertClean(repo, "source worktree", untrackedDraftAskPaths(repo))).not.toThrow();
    expect(() => assertClean(repo, "source worktree")).toThrow(/not clean/);
  });

  it("still refuses a tracked draft Ask that was modified, and other untracked files", () => {
    const ask = path.join(repo, ".arcadia/asks/agent-ask-tracked.yaml");
    writeFileSync(ask, "a\n");
    run("add", ".");
    run("commit", "-q", "-m", "ask");
    writeFileSync(ask, "b\n");
    expect(() => assertClean(repo, "w", untrackedDraftAskPaths(repo))).toThrow(/not clean/);
    run("checkout", "--", ".");
    writeFileSync(path.join(repo, "stray.txt"), "x");
    expect(() => assertClean(repo, "w", untrackedDraftAskPaths(repo))).toThrow(/not clean/);
  });
});
