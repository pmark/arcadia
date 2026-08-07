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

describe("arcadia go — next-session model resolution", () => {
  it("refuses to launch an agent session with no model resolved anywhere", () => {
    const fixture = createFixture("codex/no-model");
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    // The model check runs after the fast-forward, deliberately: the plan's
    // recommended_model must be read as it exists on the base branch after
    // the merge, not before it, since the recommendation itself may be new
    // content the merge just introduced. So refusing here does not roll back
    // an already-completed, independently-valid git reconciliation — it only
    // means the *next agent worktree* was not prepared.
    expectValidation(
      () => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude" }),
      "will not launch one unpinned"
    );
    expect(existsSync(fixture.feature)).toBe(false);
    expect(git(fixture.main, ["log", "-1", "--format=%s"]).trim()).toBe("feature proof");
  });

  it("uses the plan's recommended_model and recommended_reasoning_effort when no override is given", () => {
    const fixture = createFixture("codex/plan-model", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude" });

    expect(result.data.nextWorktree?.model).toBe("claude-opus-5");
    expect(result.data.nextWorktree?.effort).toBe("high");
    expect(result.data.nextWorktree?.command).toContain('claude --model "claude-opus-5" --effort "high" "arcadia advance"');
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

    expect(result.data.nextWorktree?.command).toContain('-m "claude-opus-5"');
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
  'token_budget: "Use one bounded coding-agent session; keep Git and validation deterministic."\n',
  'token_budget: "Use one bounded coding-agent session; keep Git and validation deterministic."\n' +
    "recommended_model: claude-opus-5\n" +
    "recommended_reasoning_effort: high\n"
);
