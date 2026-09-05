import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTINUATION_PROTOCOL_FILE,
  adoptContinuationProtocol,
  thinClaudeWrapper,
  updateAgentsMarkdown
} from "../src/projects/contextSetup.js";
import { computeWayPropagationPlan, declinesAutomaticUpgrades, readUpgradePolicy } from "../src/projects/wayPropagation.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { runWayPropagation, type CommandResult, type CommandRunner } from "../src/projects/wayPropagate.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalConstitution = readFileSync(path.join(repoRoot, "CONSTITUTION.md"), "utf8");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-way-propagation-repo-"));
  roots.push(repo);
  return repo;
}

/** Writes a repository whose adopted files exactly match Arcadia's own canonical text. */
function writeCurrentAdoption(repo: string): void {
  writeFileSync(path.join(repo, "CONSTITUTION.md"), canonicalConstitution, "utf8");
  writeFileSync(path.join(repo, "AGENTS.md"), updateAgentsMarkdown(null), "utf8");
  writeFileSync(path.join(repo, "CLAUDE.md"), thinClaudeWrapper(null)!, "utf8");
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  const protocolSource = readFileSync(path.join(repoRoot, CONTINUATION_PROTOCOL_FILE), "utf8");
  writeFileSync(path.join(repo, CONTINUATION_PROTOCOL_FILE), adoptContinuationProtocol(protocolSource, null, null), "utf8");
}

describe("computeWayPropagationPlan", () => {
  it("reports no changes for a repository that is already current", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);

    const plan = computeWayPropagationPlan(repo);

    expect(plan.changes).toEqual([]);
    expect(plan.hasMechanicalChanges).toBe(false);
    expect(plan.hasGoverningChanges).toBe(false);
  });

  it("classifies a drifted AGENTS.md region and CLAUDE.md as mechanical", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    writeFileSync(path.join(repo, "CLAUDE.md"), "stale\n", "utf8");

    const plan = computeWayPropagationPlan(repo);

    expect(plan.hasMechanicalChanges).toBe(true);
    expect(plan.hasGoverningChanges).toBe(false);
    expect(plan.changes.map((change) => change.path).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(plan.changes.every((change) => change.tier === "mechanical")).toBe(true);
  });

  it("classifies a drifted CONSTITUTION.md as governing", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "stale constitution\n", "utf8");

    const plan = computeWayPropagationPlan(repo);

    expect(plan.hasGoverningChanges).toBe(true);
    expect(plan.hasMechanicalChanges).toBe(false);
    expect(plan.changes).toEqual([{ path: "CONSTITUTION.md", tier: "governing", action: "write", content: canonicalConstitution }]);
  });

  it("reports both tiers when a run would touch mechanical and governing files together", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "stale constitution\n", "utf8");

    const plan = computeWayPropagationPlan(repo);

    expect(plan.hasMechanicalChanges).toBe(true);
    expect(plan.hasGoverningChanges).toBe(true);
  });

  it("reports a CLAUDE.md holding project-authored content as unmanageable rather than overwriting it", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "CLAUDE.md"), "# Our own instructions\n\nDo not touch.\n", "utf8");

    const plan = computeWayPropagationPlan(repo);

    expect(plan.unmanageable).toEqual([
      {
        path: "CLAUDE.md",
        tier: "mechanical",
        action: "unmanageable",
        content: null,
        reason: expect.any(String)
      }
    ]);
    expect(plan.changes.some((change) => change.path === "CLAUDE.md" && change.action === "write")).toBe(false);
  });
});

describe("upgrade policy", () => {
  it("reads a declared upgrade_policy from adoption.json", () => {
    const repo = tempRepo();
    mkdirSync(path.join(repo, ".arcadia", "arcadia-way"), { recursive: true });
    writeFileSync(
      path.join(repo, ".arcadia", "arcadia-way", "adoption.json"),
      JSON.stringify({ upgrade_policy: "explicit-only" }),
      "utf8"
    );

    expect(readUpgradePolicy(repo)).toBe("explicit-only");
    expect(declinesAutomaticUpgrades(repo)).toBe(true);
  });

  it("treats a missing or undeclared policy as not declining", () => {
    const repo = tempRepo();
    expect(readUpgradePolicy(repo)).toBeNull();
    expect(declinesAutomaticUpgrades(repo)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orchestration: real local Git (a temp repo plus a temp bare "origin"), with
// `gh` faked out through the injectable command runner so no test ever
// touches a network or a real GitHub repository.

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function initGitRepo(): { repo: string; remote: string } {
  const remote = mkdtempSync(path.join(tmpdir(), "arcadia-way-origin-"));
  roots.push(remote);
  execFileSync("git", ["init", "--bare", "-b", "main"], { cwd: remote });

  const repo = tempRepo();
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  // The remote's fetch URL is declared as a github.com address, so
  // `git remote get-url origin` (and `parseGithubSlug`) sees exactly what a
  // real adopting repository would report. Its separate push URL points at
  // the local bare repository above, so every push in this file is local disk
  // I/O, never a network call, while the code under test never learns the
  // difference.
  git(repo, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
  git(repo, ["remote", "set-url", "--push", "origin", remote]);
  writeCurrentAdoption(repo);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "initial adoption"]);
  git(repo, ["push", "-u", "origin", "main"]);
  return { repo, remote };
}

function fakeGhRunner(calls: Array<{ command: string; args: string[] }>): CommandRunner {
  return (cwd, command, args): CommandResult => {
    calls.push({ command, args });
    if (command === "gh") {
      if (args[0] === "pr" && args[1] === "create") {
        return { ok: true, stdout: "https://github.com/example/repo/pull/1\n", stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { ok: true, stdout: "merged\n", stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    }
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

function seedProject(workspace: string, repoPath: string): void {
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Acme", mission: "Ship it.", status: "active" });
    upsertProjectMetadata(db, {
      projectId: project.id,
      aliases: [],
      repoPath,
      statusSummary: null,
      validationCommands: []
    });
  });
}

function tempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-way-propagation-workspace-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

describe("runWayPropagation", () => {
  it("opens nothing for a repository that would produce byte-identical files", () => {
    const { repo } = initGitRepo();
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const summary = withDatabase(workspace, (db) =>
      runWayPropagation({ db, runCommand: fakeGhRunner(calls) })
    );

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.status).toBe("current");
    expect(calls.some((call) => call.command === "gh")).toBe(false);
  });

  it("merges a mechanical-only change without leaving it for review", () => {
    const { repo, remote } = initGitRepo();
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "drift AGENTS.md"]);
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const summary = withDatabase(workspace, (db) =>
      runWayPropagation({ db, runCommand: fakeGhRunner(calls), now: () => "20260101000000" })
    );

    expect(summary.results[0]!.status).toBe("merged");
    expect(summary.results[0]!.pullRequestUrl).toBe("https://github.com/example/repo/pull/1");
    expect(summary.results[0]!.filesChanged).toEqual(["AGENTS.md"]);
    expect(calls.some((call) => call.command === "gh" && call.args[1] === "merge")).toBe(true);

    // The branch reached the remote with the regenerated content, and the
    // repository was left back on its base branch rather than the propagation branch.
    // The remote is itself the bare repository, so its own branch list (not
    // `-r`, which lists remote-tracking refs of a *non-bare* clone) is what a push landed.
    const remoteBranches = execFileSync("git", ["branch"], { cwd: remote, encoding: "utf8" });
    expect(remoteBranches).toContain("arcadia-way/propagate-20260101000000");
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("main");
  });

  it("opens a governing-tier change and never merges it, even alongside a mechanical change", () => {
    const { repo } = initGitRepo();
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "stale constitution\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "drift both tiers"]);
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const summary = withDatabase(workspace, (db) =>
      runWayPropagation({ db, runCommand: fakeGhRunner(calls), now: () => "20260101000000" })
    );

    expect(summary.results[0]!.status).toBe("opened-governing");
    expect(summary.results[0]!.filesChanged.sort()).toEqual(["AGENTS.md", "CONSTITUTION.md"]);
    expect(calls.some((call) => call.command === "gh" && call.args[1] === "merge")).toBe(false);
  });

  it("skips a repository whose adoption.json declines automatic upgrades", () => {
    const { repo } = initGitRepo();
    mkdirSync(path.join(repo, ".arcadia", "arcadia-way"), { recursive: true });
    writeFileSync(
      path.join(repo, ".arcadia", "arcadia-way", "adoption.json"),
      JSON.stringify({ upgrade_policy: "explicit-only" }),
      "utf8"
    );
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "drift plus decline"]);
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const summary = withDatabase(workspace, (db) =>
      runWayPropagation({ db, runCommand: fakeGhRunner(calls) })
    );

    expect(summary.results[0]!.status).toBe("declined");
    expect(calls.some((call) => call.command === "gh")).toBe(false);
    expect(calls.some((call) => call.args.includes("push"))).toBe(false);
  });

  it("never writes outside the marker region or a managed file, and never pushes on a dry run", () => {
    const { repo } = initGitRepo();
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "drift"]);
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const summary = withDatabase(workspace, (db) =>
      runWayPropagation({ db, dryRun: true, runCommand: fakeGhRunner(calls) })
    );

    expect(summary.results[0]!.status).toBe("dry-run");
    expect(calls.some((call) => call.command === "gh")).toBe(false);
    expect(calls.some((call) => call.args.includes("push"))).toBe(false);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
    expect(existsSync(path.join(repo, "AGENTS.md"))).toBe(true);
  });
});
