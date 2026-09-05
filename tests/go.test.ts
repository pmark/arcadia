import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runGoCommand } from "../src/commands/go.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("arcadia go", () => {
  it("previews without changing Git state", () => {
    const fixture = createFixture("codex/copy-contract");
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature });

    expect(result.data.applied).toBe(false);
    expect(result.data.integration).toBe("fast-forward");
    expect(result.data.commitsToIntegrate).toBe(1);
    expect(result.data.dispatchable).toBe(true);
    expect(result.data.dispatch.context?.action.id).toBe("define-contract");
    expect(existsSync(fixture.feature)).toBe(true);
    expect(git(fixture.main, ["branch", "--show-current"]).trim()).toBe("main");
    expect(git(fixture.main, ["rev-list", "--count", "main..codex/copy-contract"]).trim()).toBe("1");
  });

  it("fast-forwards main and retires only a clean merged agent worktree", () => {
    const fixture = createFixture("claude/copy-contract");
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.applied).toBe(true);
    expect(result.data.sourceWorktreeRemoved).toBe(true);
    expect(result.data.sourceBranchDeleted).toBe(true);
    expect(result.data.dispatchable).toBe(true);
    expect(existsSync(fixture.feature)).toBe(false);
    expect(existsSync(path.join(fixture.main, "proof.txt"))).toBe(true);
    expect(() => git(fixture.main, ["show-ref", "--verify", "refs/heads/claude/copy-contract"])).toThrow();
  });

  it("returns a primary task checkout to main when main is not checked out elsewhere", () => {
    const fixture = createFixture("codex/unused-linked-copy");
    git(fixture.main, ["worktree", "remove", fixture.feature]);
    git(fixture.main, ["branch", "-d", "codex/unused-linked-copy"]);
    git(fixture.main, ["switch", "-c", "codex/primary-copy"]);
    commitFeature(fixture.main, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.main, apply: true });

    expect(result.data.baseWorktree).toBeNull();
    expect(result.data.sourceWorktreeRemoved).toBe(false);
    expect(result.data.sourceBranchDeleted).toBe(true);
    expect(git(fixture.main, ["branch", "--show-current"]).trim()).toBe("main");
    expect(existsSync(path.join(fixture.main, "proof.txt"))).toBe(true);
  });

  it("prepares a unique local-main worktree for either supported agent", () => {
    const fixture = createFixture("codex/prepare-next");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const agentRoot = path.join(fixture.root, "agent-worktrees");

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      model: "claude-sonnet-5",
      agentWorktreeRoot: agentRoot,
      now: new Date("2026-08-05T12:34:56.000Z")
    });

    expect(result.data.nextWorktree?.agent).toBe("claude");
    expect(result.data.nextWorktree?.branch).toBe("claude/define-contract-20260805T123456000Z");
    expect(result.data.nextWorktree?.model).toBe("claude-sonnet-5");
    expect(result.data.nextWorktree?.effort).toBeNull();
    expect(result.data.nextWorktree?.command).toContain('claude --model "claude-sonnet-5" "arcadia advance"');
    expect(existsSync(result.data.nextWorktree!.path)).toBe(true);
    expect(git(result.data.nextWorktree!.path, ["branch", "--show-current"]).trim()).toBe(result.data.nextWorktree!.branch);
    expect(git(result.data.nextWorktree!.path, ["merge-base", "--is-ancestor", "main", "HEAD"])).toBe("");
  });

  it("fails closed when the source worktree is dirty", () => {
    const fixture = createFixture("codex/dirty-copy");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    writeFileSync(path.join(fixture.feature, "unsaved.txt"), "not committed\n");

    expectValidation(() => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }), "not clean");
    expect(existsSync(fixture.feature)).toBe(true);
    expect(git(fixture.main, ["rev-parse", "main"]).trim()).not.toBe(git(fixture.feature, ["rev-parse", "HEAD"]).trim());
  });

  it("fails closed on divergent history", () => {
    const fixture = createFixture("agent/diverged-copy");
    commitFeature(fixture.feature, "feature.txt", "feature\n");
    writeFileSync(path.join(fixture.main, "main.txt"), "main\n");
    git(fixture.main, ["add", "main.txt"]);
    git(fixture.main, ["commit", "-m", "main divergence"]);

    expectValidation(() => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }), "cannot fast-forward");
    expect(existsSync(fixture.feature)).toBe(true);
    expect(existsSync(path.join(fixture.main, "feature.txt"))).toBe(false);
  });

  it("refuses to delete a branch without an agent-owned prefix", () => {
    const fixture = createFixture("feature/copy-contract");
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    expectValidation(() => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }), "agent-owned");
    expect(existsSync(fixture.feature)).toBe(true);
  });
});

describe("arcadia go — base branch remote sync", () => {
  it("skips cleanly when the base branch has no tracked remote", () => {
    const fixture = createFixture("claude/no-tracked-remote");
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.baseRemoteSync).toEqual({
      attempted: false,
      remote: null,
      fastForwarded: false,
      reason: "The base branch has no tracked remote configured."
    });
  });

  it("does not fetch or modify the base branch during preview", () => {
    const fixture = createFixtureWithRemote("claude/preview-copy");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature });

    expect(result.data.baseRemoteSync.attempted).toBe(false);
    expect(git(fixture.main, ["rev-list", "--count", "main..origin/main"]).trim()).toBe("0");
  });

  it("fetches and fast-forwards the local base branch when it is a clean ancestor of its remote", () => {
    const fixture = createFixtureWithRemote("claude/fast-forward-base");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    // Advance the feature branch past the not-yet-fetched remote commit first,
    // so the source-into-base fast-forward below still holds once `go` itself
    // brings local main up to date with that same remote commit.
    git(fixture.main, ["fetch", "origin"]);
    git(fixture.feature, ["merge", "--ff-only", "origin/main"]);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.baseRemoteSync).toEqual({ attempted: true, remote: "origin", fastForwarded: true, reason: null });
    expect(git(fixture.main, ["log", "--format=%s", "main"])).toContain("remote-only commit");
  });

  it("refuses when the local base branch has diverged from its fetched remote", () => {
    const fixture = createFixtureWithRemote("claude/diverged-base");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    git(fixture.main, ["commit", "--allow-empty", "-m", "local-only commit"]);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    expectValidation(
      () => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }),
      "diverged from its remote"
    );
    expect(git(fixture.main, ["log", "-1", "--format=%s", "main"]).trim()).toBe("local-only commit");
  });
});

describe("arcadia go — next-session model resolution", () => {
  it("refuses an active plan with no pinned model before it can dispatch", () => {
    const fixture = createFixture("codex/no-model", planDocument.replace("recommended_model: gpt-5.6-terra\n", ""));
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    expectValidation(
      () => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude" }),
      "does not resolve exactly one dispatchable"
    );
    expect(existsSync(fixture.feature)).toBe(true);
    expect(git(fixture.main, ["log", "-1", "--format=%s"]).trim()).toBe("initial");
  });

  it("uses the plan's recommended_model and recommended_reasoning_effort when no override is given", () => {
    const fixture = createFixture("codex/plan-model", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude" });

    expect(result.data.nextWorktree?.model).toBe("opus");
    expect(result.data.nextWorktree?.effort).toBe("high");
    expect(result.data.nextWorktree?.command).toContain('claude --model "opus" --effort "high" "arcadia advance"');
  });

  it("an explicit --model/--effort overrides the plan's recommendation", () => {
    const fixture = createFixture("codex/override-model", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      model: "claude-haiku-4-5",
      effort: "low"
    });

    expect(result.data.nextWorktree?.model).toBe("claude-haiku-4-5");
    expect(result.data.nextWorktree?.effort).toBe("low");
  });

  it("builds the codex launch command with -m and the reasoning-effort TOML override", () => {
    const fixture = createFixture("codex/codex-shape", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "codex" });

    expect(result.data.nextWorktree?.command).toContain('-m "opus"');
    expect(result.data.nextWorktree?.command).toContain('-c model_reasoning_effort="high"');
    expect(result.data.nextWorktree?.command).not.toContain("--effort");
  });

  it("omits the effort flag entirely when only a model resolves", () => {
    const fixture = createFixture("codex/model-only", planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude", model: "claude-sonnet-5" });

    expect(result.data.nextWorktree?.effort).toBeNull();
    expect(result.data.nextWorktree?.command).not.toContain("--effort");
  });
});

function createFixture(branch: string, plan: string = planDocument): { root: string; main: string; feature: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-go-"));
  roots.push(root);
  const main = path.join(root, "repo");
  const feature = path.join(root, "feature");
  mkdirSync(main);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["config", "user.email", "arcadia@example.test"]);
  git(main, ["config", "user.name", "Arcadia Test"]);
  git(main, ["remote", "add", "origin", main]);
  git(main, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  writeFileSync(path.join(main, "PROJECT.md"), projectDocument);
  mkdirSync(path.join(main, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(main, "docs", "plans", "copy-proof.md"), plan);
  git(main, ["add", "."]);
  git(main, ["commit", "-m", "initial"]);
  git(main, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(main, ["worktree", "add", "-q", "-b", branch, feature, "main"]);
  return { root, main, feature };
}

/** Like createFixture, but `main` is a real clone of a separate remote repo, so `git fetch` has something distinct to pull. */
function createFixtureWithRemote(branch: string, plan: string = planDocument): { root: string; remote: string; main: string; feature: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-go-remote-"));
  roots.push(root);
  const remote = path.join(root, "remote");
  const main = path.join(root, "repo");
  const feature = path.join(root, "feature");
  mkdirSync(remote);
  git(remote, ["init", "-q", "-b", "main"]);
  git(remote, ["config", "user.email", "arcadia@example.test"]);
  git(remote, ["config", "user.name", "Arcadia Test"]);
  writeFileSync(path.join(remote, "PROJECT.md"), projectDocument);
  mkdirSync(path.join(remote, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(remote, "docs", "plans", "copy-proof.md"), plan);
  git(remote, ["add", "."]);
  git(remote, ["commit", "-m", "initial"]);
  git(root, ["clone", "-q", remote, main]);
  git(main, ["config", "user.email", "arcadia@example.test"]);
  git(main, ["config", "user.name", "Arcadia Test"]);
  git(main, ["worktree", "add", "-q", "-b", branch, feature, "main"]);
  return { root, remote, main, feature };
}

function commitFeature(cwd: string, file: string, content: string): void {
  writeFileSync(path.join(cwd, file), content);
  git(cwd, ["add", file]);
  git(cwd, ["commit", "-m", "feature proof"]);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function expectValidation(run: () => unknown, fragment: string): void {
  try {
    run();
    throw new Error("Expected validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    expect((error as Error).message).toContain(fragment);
  }
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
status: active
goal: Prove safe handoffs.
active_plan: copy-proof
current_action: define-contract
updated: 2026-08-05
---

# Test Project

## Mission

Prove safe handoffs.
`;

const planDocument = `---
arcadia: v1
type: plan
slug: copy-proof
project: test-project
status: active
milestone: Prove the copy contract
token_impact: medium
token_budget: "Use one bounded coding-agent session; keep Git and validation deterministic."
recommended_model: gpt-5.6-terra
updated: 2026-08-05
actions:
  - id: define-contract
    title: Define the contract
    status: in_progress
    responsibility: codex
    effort: session
    clarification: clarified
    next_action: Define the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
---

# Copy proof
`;

const planDocumentWithModel = planDocument.replace(
  "recommended_model: gpt-5.6-terra\n",
  "recommended_model: opus\n" +
    "recommended_reasoning_effort: high\n"
);
