import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { renderGoSuccess, runGoCommand } from "../src/commands/go.js";
import { expectIdentityBlock } from "./helpers/identityBlock.js";
import { runTidyCommand } from "../src/commands/tidy.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { SAFE_TASK_BRANCH, SAFE_TASK_BRANCH_PREFIXES } from "../src/git/worktrees.js";
import { runGoBroker } from "../src/goBroker.js";
import { setWorktreeLivenessProbeForTests, type WorktreeLiveness } from "../src/sessions/worktreeLiveness.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("retires a base-ahead source without changing main and dispatches from the settled base", () => {
    const fixture = createFixture("codex/completed-settlement");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    git(fixture.main, ["merge", "--ff-only", "codex/completed-settlement"]);
    settleNextAction(fixture.main);
    const settledMain = git(fixture.main, ["rev-parse", "main"]).trim();

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.integration).toBe("already-integrated");
    expect(result.data.dispatch.context?.action.id).toBe("dispatch-next");
    expect(result.data.sourceWorktreeRemoved).toBe(true);
    expect(result.data.sourceBranchDeleted).toBe(true);
    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(settledMain);
    expect(existsSync(fixture.feature)).toBe(false);
  });

  it("retires a squash-merged source by patch equivalence without changing main", () => {
    const fixture = createFixture("claude/squash-completed");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    git(fixture.main, ["merge", "--squash", "claude/squash-completed"]);
    git(fixture.main, ["commit", "-m", "settle completed action"]);
    const settledMain = git(fixture.main, ["rev-parse", "main"]).trim();

    expect(git(fixture.main, ["cherry", "main", "claude/squash-completed"])).not.toContain("+");
    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.integration).toBe("already-integrated");
    expect(result.data.dispatch.context?.action.id).toBe("define-contract");
    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(settledMain);
    expect(existsSync(fixture.feature)).toBe(false);
    expect(() => git(fixture.main, ["show-ref", "--verify", "refs/heads/claude/squash-completed"])).toThrow();
  });

  it("deletes a verified-safe local source despite a stale remote tracking ref", () => {
    const fixture = createFixture("codex/stale-upstream");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const staleHead = git(fixture.feature, ["rev-parse", "HEAD"]).trim();
    git(fixture.main, ["merge", "--squash", "codex/stale-upstream"]);
    git(fixture.main, ["commit", "-m", "settle completed action"]);
    const settledMain = git(fixture.main, ["rev-parse", "main"]).trim();
    git(fixture.main, ["update-ref", "refs/remotes/origin/codex/stale-upstream", staleHead]);
    git(fixture.feature, ["branch", "--set-upstream-to=origin/codex/stale-upstream"]);

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.sourceBranchDeleted).toBe(true);
    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(settledMain);
    expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/codex/stale-upstream"]).trim()).toBe(staleHead);
    expect(() => git(fixture.main, ["show-ref", "--verify", "refs/heads/codex/stale-upstream"])).toThrow();
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
      workspace: fixture.workspace,
      model: "claude-sonnet-5",
      agentWorktreeRoot: agentRoot,
      now: new Date("2026-08-05T12:34:56.000Z")
    });

    expect(result.data.nextWorktree?.agent).toBe("claude");
    expect(result.data.nextWorktree?.branch).toBe("claude/define-contract-20260805T123456000Z");
    expect(result.data.nextWorktree?.model).toBe("claude-sonnet-5");
    expect(result.data.nextWorktree?.effort).toBeNull();
    expect(result.data.nextWorktree?.command).toContain('claude --model "claude-sonnet-5" "arcadia advance"');
    // "claude-sonnet-5" binds no tier and no effort was given, so the Identity
    // block names nobody rather than guessing a tier.
    expect(result.data.identity?.[0]).toBe("Identity:");
    expect(result.data.identity?.join("\n")).not.toMatch(/^You are /m);
    expect(result.data.identity?.join("\n")).toContain("arcadia identity resolve");
    expect(existsSync(result.data.nextWorktree!.path)).toBe(true);
    expect(git(result.data.nextWorktree!.path, ["branch", "--show-current"]).trim()).toBe(result.data.nextWorktree!.branch);
    expect(git(result.data.nextWorktree!.path, ["merge-base", "--is-ancestor", "main", "HEAD"])).toBe("");
  });

  it("resolves the go Identity block from the default workspace's tier registry and live partners when --workspace is omitted", () => {
    const fixture = createFixture("codex/prepare-default-workspace");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    // A workspace override binds this concrete model to Claude's heavy tier,
    // so the launch environment commits as Claudia Atlas; the bundled mapping
    // alone would not resolve it at all.
    mkdirSync(path.join(fixture.workspace, "config"), { recursive: true });
    writeFileSync(
      path.join(fixture.workspace, "config", "coding-agent-models.json"),
      JSON.stringify({ tiers: { heavy: { claude: "claude-sonnet-5" } } })
    );
    withDatabase(fixture.workspace, (db) => db.prepare(`INSERT INTO agent_worktree_reservations
      (id, repository_path, worktree_path, branch, created_at, expires_at, project, action_id, claim_generation)
      VALUES ('other-claim', ?, '/elsewhere/peer', 'codex/peer', '2026-08-05T00:00:00.000Z', '2999-01-01T00:00:00.000Z', 'test-project', 'peer-action', 'g-peer')`)
      .run(fixture.main));
    vi.stubEnv("ARCADIA_WORKSPACE", fixture.workspace);

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      model: "claude-sonnet-5",
      agentWorktreeRoot: path.join(fixture.root, "agent-worktrees"),
      now: new Date("2026-08-05T12:34:56.000Z")
    });

    const block = (result.data.identity ?? []).join("\n");
    expectIdentityBlock(block, "claude", "heavy");
    expect(block).toContain("Your current partners on this Project, from live claims and Sessions, are: an unattributed claim on Action peer-action.");
  });

  it("prepares an opencode worktree on the opencode branch with the pinned model and variant", () => {
    const fixture = createFixture("codex/prepare-opencode");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const agentRoot = path.join(fixture.root, "agent-worktrees");

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "opencode",
      workspace: fixture.workspace,
      model: "opencode-go/deepseek-v4.1-flash",
      effort: "high",
      agentWorktreeRoot: agentRoot,
      now: new Date("2026-08-05T12:34:56.000Z")
    });

    expect(result.data.nextWorktree?.agent).toBe("opencode");
    expect(result.data.nextWorktree?.branch).toBe("opencode/define-contract-20260805T123456000Z");
    expect(result.data.nextWorktree?.command).toContain(
      'opencode run --model "opencode-go/deepseek-v4.1-flash" --variant "high" "arcadia advance"'
    );
    expect(existsSync(result.data.nextWorktree!.path)).toBe(true);
    // The pinned model is OpenCode's standard binding; this candidate's own
    // claim is not its partner, and nobody else is live.
    const rendered = renderGoSuccess(result).join("\n");
    expectIdentityBlock(rendered, "opencode", "standard");
    expect(rendered).toContain("Your current partners on this Project, from live claims and Sessions, are: none.");
  });

  it("keeps the zero-commit handoff when tidy --apply runs immediately after go --apply", () => {
    const fixture = createFixture("codex/prepare-then-tidy");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const handoff = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "codex",
      model: "gpt-5.6-terra",
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "agent-worktrees"),
      now: new Date("2026-09-06T12:34:56.000Z")
    }).data.nextWorktree!;

    // Same instant as the go handoff above: the reservation's 24h expiry is
    // computed from go's `now`, so evaluating it against the real clock here
    // instead would make this test's outcome depend on how much real time has
    // passed since 2026-09-06T12:34:56.000Z rather than on tidy's actual logic.
    const tidy = runTidyCommand({
      repo: fixture.main,
      workspace: fixture.workspace,
      apply: true,
      now: new Date("2026-09-06T12:34:56.000Z")
    }).data;

    expect(tidy.worktrees.find((candidate: { path: string }) => candidate.path === realpathSync(handoff.path))?.verdict).toBe("protected");
    expect(existsSync(handoff.path)).toBe(true);
    expect(git(fixture.main, ["worktree", "list"])).toContain(handoff.path);
  });

  it("removes the just-created worktree if its reservation transaction cannot commit", () => {
    const fixture = createFixture("codex/reservation-failure");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const agentRoot = path.join(fixture.root, "agent-worktrees");
    const expectedPath = path.join(agentRoot, "define-contract-20260906T123456000Z", "repo");

    expect(() => runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "codex",
      model: "gpt-5.6-terra",
      workspace: fixture.workspace,
      agentWorktreeRoot: agentRoot,
      now: new Date("2026-09-06T12:34:56.000Z"),
      testHooks: {
        afterWorktreeCreatedBeforeReservationCommit() {
          throw new Error("synthetic reservation commit failure");
        }
      }
    })).toThrow("synthetic reservation commit failure");

    expect(existsSync(expectedPath)).toBe(false);
    expect(() => git(fixture.main, ["show-ref", "--verify", "refs/heads/codex/define-contract-20260906T123456000Z"])).toThrow();
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM agent_worktree_reservations").get() as { count: number }).count
    )).toBe(0);
  });

  it("fails closed when the source worktree is dirty", () => {
    const fixture = createFixture("codex/dirty-copy");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    writeFileSync(path.join(fixture.feature, "unsaved.txt"), "not committed\n");

    expectValidation(() => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }), "not clean");
    expect(existsSync(fixture.feature)).toBe(true);
    expect(git(fixture.main, ["rev-parse", "main"]).trim()).not.toBe(git(fixture.feature, ["rev-parse", "HEAD"]).trim());
  });

  it("recovers a drifted legacy agent-ask.yaml on the base worktree instead of blocking the handoff", () => {
    const fixture = createFixture("codex/recover-legacy-ask");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    writeFileSync(
      path.join(fixture.main, "agent-ask.yaml"),
      "agent_ask: v1\nrequest_id: legacy-drift-2026-09-12\nproject: unknown\nintent: log\ndesired_result: test drift\n"
    );

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.applied).toBe(true);
    expect(result.data.askRecoveries).toHaveLength(1);
    const recovery = result.data.askRecoveries[0];
    expect(recovery.askFile).toMatch(/^\.arcadia\/asks\/agent-ask-legacy-drift-2026-09-12-.+\.yaml$/);
    expect(recovery.requestId).toBe("legacy-drift-2026-09-12");
    expect(existsSync(path.join(fixture.main, "agent-ask.yaml"))).toBe(false);
    expect(git(fixture.main, ["status", "--porcelain"]).trim()).toBe("");

    const recoveredContent = git(fixture.main, ["show", `${recovery.branch}:${recovery.askFile}`]);
    expect(recoveredContent).toContain("request_id: legacy-drift-2026-09-12");

    // The preserved Ask can be previewed straight from its isolated branch by
    // request id alone — no manual `git show` into a scratch file needed.
    const previewed = runAgentAskPreviewCommand({
      workspace: fixture.workspace, requestId: "legacy-drift-2026-09-12", dir: fixture.main
    });
    expect(previewed.data.proposal.normalized.requestId).toBe("legacy-drift-2026-09-12");
    expect(previewed.data.proposal.normalized.desiredResult).toBe("test drift");
  });

  it("recovers two simultaneously drifting Asks (source and base worktree) onto fully disjoint branches within the same shared repository", () => {
    const fixture = createFixture("codex/recover-concurrent-source-and-base");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    // Both the source worktree (an agent's in-progress branch) and the base
    // worktree (the shared checkout `arcadia go` is reconciling into) have
    // drifted at once — the realistic case this Action's concurrency
    // criterion is about, since both recoveries below run against the same
    // `repo` (shared .git, shared refs namespace) in a single `go` call.
    writeFileSync(
      path.join(fixture.feature, "agent-ask.yaml"),
      "agent_ask: v1\nrequest_id: concurrent-drift-source\nproject: unknown\nintent: log\ndesired_result: concurrent drift on source\n"
    );
    writeFileSync(
      path.join(fixture.main, "agent-ask.yaml"),
      "agent_ask: v1\nrequest_id: concurrent-drift-base\nproject: unknown\nintent: log\ndesired_result: concurrent drift on base\n"
    );

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.askRecoveries).toHaveLength(2);
    const [recoverySource, recoveryBase] = result.data.askRecoveries;
    expect(recoverySource.requestId).toBe("concurrent-drift-source");
    expect(recoveryBase.requestId).toBe("concurrent-drift-base");
    expect(recoverySource.branch).not.toBe(recoveryBase.branch);
    expect(recoverySource.askFile).not.toBe(recoveryBase.askFile);
    expect(existsSync(path.join(fixture.feature, "agent-ask.yaml"))).toBe(false);
    expect(existsSync(path.join(fixture.main, "agent-ask.yaml"))).toBe(false);
    expect(git(fixture.main, ["status", "--porcelain"]).trim()).toBe("");

    // Both branches genuinely exist, side by side, in the one shared repo —
    // neither recovery's worktree-add/commit/worktree-remove sequence
    // clobbered the other's branch or left it half-written.
    expect(git(fixture.main, ["branch", "--list", "ask/recover-*"]).trim().split("\n")).toHaveLength(2);
    expect(git(fixture.main, ["show", `${recoverySource.branch}:${recoverySource.askFile}`])).toContain("concurrent drift on source");
    expect(git(fixture.main, ["show", `${recoveryBase.branch}:${recoveryBase.askFile}`])).toContain("concurrent drift on base");

    const previewedSource = runAgentAskPreviewCommand({ workspace: fixture.workspace, requestId: "concurrent-drift-source", dir: fixture.main });
    const previewedBase = runAgentAskPreviewCommand({ workspace: fixture.workspace, requestId: "concurrent-drift-base", dir: fixture.main });
    expect(previewedSource.data.proposal.normalized.desiredResult).toBe("concurrent drift on source");
    expect(previewedBase.data.proposal.normalized.desiredResult).toBe("concurrent drift on base");
  });

  it("recovers a suffixed legacy root Ask (agent-ask-<topic>.yaml), the name the old convention produced most often", () => {
    const fixture = createFixture("codex/recover-suffixed-legacy-ask");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    writeFileSync(
      path.join(fixture.main, "agent-ask-triage.yaml"),
      "agent_ask: v1\nrequest_id: suffixed-drift-2026-09-13\nproject: unknown\nintent: log\ndesired_result: test suffixed drift\n"
    );

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.applied).toBe(true);
    expect(result.data.askRecoveries).toHaveLength(1);
    const recovery = result.data.askRecoveries[0];
    // Renamed into the isolated directory under its own request id, exactly
    // like the bare legacy name — the topic suffix carries no identity.
    expect(recovery.askFile).toMatch(/^\.arcadia\/asks\/agent-ask-suffixed-drift-2026-09-13-.+\.yaml$/);
    expect(recovery.requestId).toBe("suffixed-drift-2026-09-13");
    expect(existsSync(path.join(fixture.main, "agent-ask-triage.yaml"))).toBe(false);
    expect(git(fixture.main, ["status", "--porcelain"]).trim()).toBe("");
    expect(git(fixture.main, ["show", `${recovery.branch}:${recovery.askFile}`])).toContain("request_id: suffixed-drift-2026-09-13");
  });

  it("still fails closed on an unrelated root YAML file that only looks adjacent to the Ask convention", () => {
    const fixture = createFixture("codex/unrelated-root-yaml");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    writeFileSync(path.join(fixture.main, "agent-config.yaml"), "unrelated: true\n");

    expectValidation(() => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }), "not clean");
    expect(existsSync(path.join(fixture.main, "agent-config.yaml"))).toBe(true);
  });

  it("recovers a correctly named isolated Ask draft left dirty on the base worktree, without renaming it", () => {
    const fixture = createFixture("codex/recover-isolated-draft");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    mkdirSync(path.join(fixture.main, ".arcadia", "asks"), { recursive: true });
    writeFileSync(
      path.join(fixture.main, ".arcadia", "asks", "agent-ask-isolated-draft-2026-09-13.yaml"),
      "agent_ask: v1\nrequest_id: isolated-draft-2026-09-13\nproject: unknown\nintent: log\ndesired_result: test isolated draft drift\n"
    );

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.applied).toBe(true);
    expect(result.data.askRecoveries).toHaveLength(1);
    const recovery = result.data.askRecoveries[0];
    expect(recovery.askFile).toBe(".arcadia/asks/agent-ask-isolated-draft-2026-09-13.yaml");
    expect(recovery.requestId).toBe("isolated-draft-2026-09-13");
    expect(existsSync(path.join(fixture.main, ".arcadia", "asks", "agent-ask-isolated-draft-2026-09-13.yaml"))).toBe(false);
    expect(git(fixture.main, ["status", "--porcelain"]).trim()).toBe("");
    expect(git(fixture.main, ["show", `${recovery.branch}:${recovery.askFile}`])).toContain("request_id: isolated-draft-2026-09-13");
  });

  it("fails closed and preserves the original drifted file when recovery is interrupted before the commit", () => {
    const fixture = createFixture("codex/recovery-interrupted-early");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    writeFileSync(
      path.join(fixture.main, "agent-ask.yaml"),
      "agent_ask: v1\nrequest_id: interrupted-early-2026-09-13\nproject: unknown\nintent: log\ndesired_result: test\n"
    );

    expect(() => runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      testHooks: { askRecovery: { afterWorktreeCreatedBeforeWrite() { throw new Error("synthetic recovery write failure"); } } }
    })).toThrow("synthetic recovery write failure");

    expect(existsSync(path.join(fixture.main, "agent-ask.yaml"))).toBe(true);
    expect(git(fixture.main, ["status", "--porcelain"]).trim()).toBe("?? agent-ask.yaml");
    // No orphaned isolated worktree is left registered against the repository.
    expect(git(fixture.main, ["worktree", "list", "--porcelain"])).not.toContain(".arcadia-ask-recovery-");

    const retried = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });
    expect(retried.data.applied).toBe(true);
    expect(retried.data.askRecoveries).toHaveLength(1);
    expect(existsSync(path.join(fixture.main, "agent-ask.yaml"))).toBe(false);
  });

  it("retries idempotently, without a duplicate commit or an orphaned draft, when recovery is interrupted after the commit", () => {
    const fixture = createFixture("codex/recovery-interrupted-late");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    writeFileSync(
      path.join(fixture.main, "agent-ask.yaml"),
      "agent_ask: v1\nrequest_id: interrupted-late-2026-09-13\nproject: unknown\nintent: log\ndesired_result: test\n"
    );

    expect(() => runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      testHooks: { askRecovery: { afterCommitBeforeCleanup() { throw new Error("synthetic cleanup failure"); } } }
    })).toThrow("synthetic cleanup failure");

    // The commit already landed on the isolated branch before the injected failure.
    const branches = git(fixture.main, ["branch", "--list", "ask/recover-*"]).trim();
    expect(branches.split("\n")).toHaveLength(1);
    expect(existsSync(path.join(fixture.main, "agent-ask.yaml"))).toBe(true);

    const retried = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });
    expect(retried.data.applied).toBe(true);
    expect(retried.data.askRecoveries).toHaveLength(1);
    expect(existsSync(path.join(fixture.main, "agent-ask.yaml"))).toBe(false);
    expect(git(fixture.main, ["status", "--porcelain"]).trim()).toBe("");
    // Retrying produced no second branch and no second commit under this same drift.
    const branchesAfterRetry = git(fixture.main, ["branch", "--list", "ask/recover-*"]).trim();
    expect(branchesAfterRetry).toBe(branches);
    const recoveredBranch = retried.data.askRecoveries[0].branch!;
    expect(git(fixture.main, ["log", recoveredBranch, "--oneline", "--grep=Recover drifted Agent Ask"]).trim().split("\n")).toHaveLength(1);
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

    const refusal = expectValidation(() => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }), "agent-owned");
    expect(existsSync(fixture.feature)).toBe(true);
    // The reported prefixes are exactly what the guard accepts, opencode/
    // included, so the refusal can never name a subset of it (Issue #459).
    const allowed = (refusal.details as { allowedPrefixes: string[] }).allowedPrefixes;
    expect(allowed).toEqual([...SAFE_TASK_BRANCH_PREFIXES]);
    expect(allowed).toContain("opencode/");
    for (const prefix of allowed) expect(SAFE_TASK_BRANCH.test(`${prefix}copy-contract`)).toBe(true);
    expect(SAFE_TASK_BRANCH.test("feature/copy-contract")).toBe(false);
  });
});

describe("arcadia go — refuses a stale session on an unchanged Action", () => {
  it("refuses to prepare the next worktree when the outgoing session made no commits and its Action is still open", () => {
    const fixture = createFixture(
      "claude/define-contract-20260805T123456000Z",
      planDocument
    );

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.feature,
        apply: true,
        agent: "claude",
        workspace: fixture.workspace
      }),
      "leaves the current Action unchanged"
    );

    expect(failure.details).toMatchObject({ actionId: "define-contract" });
    // The zero-commit branch was already provably safe to retire -- that
    // cleanup still ran; only the next worktree was refused.
    expect(() => git(fixture.main, ["show-ref", "--verify", "refs/heads/claude/define-contract-20260805T123456000Z"])).toThrow();
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT COUNT(*) AS n FROM agent_worktree_reservations").get())).toEqual({ n: 0 });
  });

  it("still refuses a stale, unchanged Action on a cross-agent handoff (the branch's own agent, not the next session's)", () => {
    const fixture = createFixture(
      "claude/define-contract-20260805T123456000Z",
      planDocument
    );

    // The next session is handed to a different agent than the one the
    // stale branch was originally prepared for -- must not let a mismatched
    // `options.agent` slip the refusal.
    expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.feature,
        apply: true,
        agent: "codex",
        workspace: fixture.workspace
      }),
      "leaves the current Action unchanged"
    );
  });

  it("does not refuse a zero-commit branch whose slug merely prefixes a different Action's slug", () => {
    // "define-contract-extra" is not "define-contract": a prefix match would
    // wrongly conflate them, but an exact slug comparison must not.
    const fixture = createFixture(
      "claude/define-contract-extra-20260805T123456000Z",
      planDocument
    );

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      workspace: fixture.workspace
    });

    expect(result.data.nextWorktree?.branch).toContain("define-contract");
  });

  it("does not refuse when the same session's branch made progress commits, even though its Action is still open", () => {
    const fixture = createFixture("claude/define-contract-20260805T123456000Z", planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      workspace: fixture.workspace
    });

    expect(result.data.nextWorktree?.branch).toContain("define-contract");
  });

  it("does not refuse a zero-commit branch whose Action was already completed by a different session", () => {
    const fixture = createFixtureWithRemote("claude/define-contract-20260805T123456000Z");
    settleNextAction(fixture.remote);
    git(fixture.main, ["switch", "-c", "claude/unrelated-parking"]);

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      workspace: fixture.workspace
    });

    expect(result.data.dispatch.context?.action.id).toBe("dispatch-next");
    expect(result.data.nextWorktree).not.toBeNull();
  });

  it("does not refuse a bare 'what's next' call where the source is already the base branch", () => {
    const fixture = createFixture("claude/no-op", planDocument);

    const result = runGoCommand({ repo: fixture.main, source: fixture.main, apply: true, agent: "claude", workspace: fixture.workspace });

    expect(result.data.integration).toBe("not-needed");
    expect(result.data.dispatch.context?.action.id).toBe("define-contract");
  });
});

describe("arcadia go — refuses to orphan an uncommitted candidate", () => {
  it("reports the exact path of a manually-prepared candidate holding uncommitted changes instead of preparing a second worktree for the same Action", () => {
    const fixture = createFixture("claude/manual-first", planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const first = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      model: "claude-sonnet-5",
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "agent-worktrees")
    });
    const preparedPath = first.data.nextWorktree!.path;
    // Nobody ever launched this candidate through Arcadia -- it is exactly the
    // "operator ran the agent by hand" manual handoff -- but it already holds
    // real, uncommitted work.
    writeFileSync(path.join(preparedPath, "draft.md"), "in progress\n");

    expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "claude",
        model: "claude-sonnet-5",
        workspace: fixture.workspace,
        agentWorktreeRoot: path.join(fixture.root, "agent-worktrees-2")
      }),
      "already holds uncommitted changes"
    );
    // Refused before any second worktree for this Action was created.
    expect(
      git(fixture.main, ["worktree", "list", "--porcelain"])
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
    ).toHaveLength(2); // fixture.main itself, plus the one manual candidate above.
  });

  it("counts an abandoned agent worktree as clutter instead of shielding it away by its own unexpired reservation", () => {
    const fixture = createFixture("claude/clutter-first", planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      model: "claude-sonnet-5",
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "agent-worktrees")
    });
    // The first candidate above is now an abandoned, still-reserved (within
    // its 24h window) worktree that nobody is using -- exactly the state that
    // used to shield itself, and any sibling, out of the clutter count.
    settleNextAction(fixture.main);

    const second = runGoCommand({
      repo: fixture.main,
      source: fixture.main,
      apply: true,
      agent: "claude",
      model: "claude-sonnet-5",
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "agent-worktrees-2")
    });

    // Two agent worktrees now exist (the abandoned first one, and this run's
    // own fresh one). This run's own handoff is exempted so `go` never nags
    // about the worktree it just prepared, but the abandoned first one must
    // still be counted.
    expect(second.data.clutter?.extraWorktrees).not.toBe(0);
    expect(second.data.clutter?.extraWorktrees).toBe(1);
  });
});

describe("arcadia go — resumes a draft-only never-launched candidate in place (Issue #884)", () => {
  const preparedAt = new Date("2026-09-06T12:00:00.000Z");
  const resumedAt = new Date("2026-09-06T13:00:00.000Z");
  // The host process probe is replaced so these tests never depend on lsof or
  // /proc; tests/worktree-liveness.test.ts exercises the real probe.
  let liveness: WorktreeLiveness = { ok: true, processes: [] };
  beforeEach(() => {
    liveness = { ok: true, processes: [] };
    setWorktreeLivenessProbeForTests(() => liveness);
  });
  afterEach(() => setWorktreeLivenessProbeForTests(null));

  function prepareCandidate(name: string): { fixture: ReturnType<typeof createFixture>; path: string; branch: string } {
    const fixture = createFixture(`claude/${name}`, planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const prepared = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      model: "claude-sonnet-5",
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "agent-worktrees"),
      now: preparedAt
    }).data.nextWorktree!;
    // Git reports worktrees by real path; a macOS temp dir is a symlink.
    return { fixture, path: realpathSync(prepared.path), branch: prepared.branch };
  }

  function writeDraft(worktree: string, name: string, project: string, extra = ""): Buffer {
    mkdirSync(path.join(worktree, ".arcadia", "asks"), { recursive: true });
    const bytes = Buffer.from(`{\n  "agent_ask": "v1",\n  "request_id": "${name}",\n  "project": "${project}",\n  "intent": "proposal"${extra}\n}\n`);
    writeFileSync(path.join(worktree, ".arcadia", "asks", `agent-ask-${name}.yaml`), bytes);
    return bytes;
  }

  function goAgain(fixture: ReturnType<typeof createFixture>, extra: Partial<Parameters<typeof runGoCommand>[0]> = {}) {
    return runGoCommand({
      repo: fixture.main,
      source: fixture.main,
      apply: true,
      agent: "claude",
      model: "claude-sonnet-5",
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "agent-worktrees-2"),
      now: resumedAt,
      ...extra
    });
  }

  function worktreeCount(fixture: ReturnType<typeof createFixture>): number {
    return git(fixture.main, ["worktree", "list", "--porcelain"]).split("\n").filter((line) => line.startsWith("worktree ")).length;
  }

  function claims(fixture: ReturnType<typeof createFixture>): Array<{ worktree_path: string; branch: string }> {
    return withReadOnlyDatabase(fixture.workspace, (db) => db.prepare(
      "SELECT worktree_path, branch FROM agent_worktree_reservations WHERE action_id = 'define-contract'"
    ).all() as Array<{ worktree_path: string; branch: string }>);
  }

  function receiptIds(fixture: ReturnType<typeof createFixture>): string[] {
    return withReadOnlyDatabase(fixture.workspace, (db) => {
      const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_draft_recoveries'").get();
      if (!table) return [];
      return (db.prepare("SELECT request_id FROM candidate_draft_recoveries ORDER BY request_id").all() as Array<{ request_id: string }>)
        .map((row) => row.request_id);
    });
  }

  function handouts(fixture: ReturnType<typeof createFixture>): Array<{ request_id: string; resumed_route: string }> {
    return withReadOnlyDatabase(fixture.workspace, (db) => db.prepare(
      "SELECT request_id, resumed_route FROM candidate_draft_recoveries WHERE resumed_at IS NOT NULL"
    ).all() as Array<{ request_id: string; resumed_route: string }>);
  }

  interface Disposition {
    receiptId: string;
    blocker: string;
    handedOut: { receiptId: string; route: string; at: string } | null;
    drafts: Array<{ path: string; sha256: string }>;
    nextStep: string;
  }

  function sha256(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  it("resumes the same worktree and branch with one claim, byte-identical drafts and a path+sha256+origin receipt", () => {
    const { fixture, path: candidate, branch } = prepareCandidate("draft-resume");
    const draft = writeDraft(candidate, "draft-resume-2026-09-06", "test-project");

    const result = goAgain(fixture);

    expect(result.data.nextWorktree?.path).toBe(candidate);
    expect(result.data.nextWorktree?.branch).toBe(branch);
    expect(worktreeCount(fixture)).toBe(2);
    expect(claims(fixture)).toEqual([{ worktree_path: realpathSync(candidate), branch }]);
    const draftPath = path.join(candidate, ".arcadia", "asks", "agent-ask-draft-resume-2026-09-06.yaml");
    expect(readFileSync(draftPath).equals(draft)).toBe(true);
    const receipt = result.data.draftRecovery!;
    expect(receipt.worktree).toBe(realpathSync(candidate));
    expect(receipt.branch).toBe(branch);
    expect(receipt.baseSha).toBe(git(candidate, ["rev-parse", "HEAD"]).trim());
    expect(receipt.drafts).toEqual([{
      path: ".arcadia/asks/agent-ask-draft-resume-2026-09-06.yaml",
      sha256: sha256(draft),
      bytes: draft.length,
      origin: { worktree: realpathSync(candidate), branch },
      project: "test-project",
      requestId: "draft-resume-2026-09-06",
      relevance: "current_action"
    }]);
    expect(receiptIds(fixture)).toEqual([receipt.requestId]);
    expect(handouts(fixture)).toEqual([{ request_id: receipt.requestId, resumed_route: "go" }]);
    expect(git(candidate, ["status", "--porcelain"])).toBe("?? .arcadia/\n");
  });

  it("hashes a draft naming another Project and leaves both drafts in place, unsettled, uncopied and unmoved", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-other");
    const own = writeDraft(candidate, "own-2026-09-06", "test-project");
    const foreign = writeDraft(candidate, "foreign-2026-09-06", "another-project");

    const receipt = goAgain(fixture).data.draftRecovery!;

    expect(receipt.drafts.map((draft) => [draft.path, draft.sha256, draft.relevance])).toEqual([
      [".arcadia/asks/agent-ask-foreign-2026-09-06.yaml", sha256(foreign), "other_project"],
      [".arcadia/asks/agent-ask-own-2026-09-06.yaml", sha256(own), "current_action"]
    ]);
    expect(readFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-own-2026-09-06.yaml")).equals(own)).toBe(true);
    expect(readFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-foreign-2026-09-06.yaml")).equals(foreign)).toBe(true);
    expect(git(fixture.main, ["branch", "--list", "ask/recover-*"]).trim()).toBe("");
    expect(existsSync(path.join(fixture.main, ".arcadia"))).toBe(false);
    expect(git(fixture.main, ["log", "--all", "--format=%s"])).not.toMatch(/agent-ask|recover/i);
  });

  it.each<[string, (candidate: string) => void, "code_bearing" | "unknown"]>([
    ["a tracked-file edit", (candidate) => writeFileSync(path.join(candidate, "PROJECT.md"), "changed\n"), "code_bearing"],
    ["an untracked code file", (candidate) => writeFileSync(path.join(candidate, "feature.ts"), "export {};\n"), "code_bearing"],
    ["a rename", (candidate) => git(candidate, ["mv", "PROJECT.md", "PROJECT-renamed.md"]), "code_bearing"],
    ["a non-Ask .arcadia file", (candidate) => writeFileSync(path.join(candidate, ".arcadia", "other.txt"), "x\n"), "unknown"],
    ["an archived Ask", (candidate) => {
      mkdirSync(path.join(candidate, ".arcadia", "asks", "archive"), { recursive: true });
      writeFileSync(path.join(candidate, ".arcadia", "asks", "archive", "agent-ask-old.yaml"), "{}\n");
    }, "unknown"],
    ["a symlinked draft", (candidate) => {
      const target = path.join(path.dirname(candidate), "outside.yaml");
      writeFileSync(target, "{}\n");
      symlinkSync(target, path.join(candidate, ".arcadia", "asks", "agent-ask-linked.yaml"));
    }, "unknown"],
    ["an oversized draft", (candidate) => writeFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-huge.yaml"), Buffer.alloc(1024 * 1024 + 1, 0x20)), "unknown"],
    ["a non-UTF-8 draft", (candidate) => writeFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-binary.yaml"), Buffer.from([0xff, 0xfe, 0x00])), "unknown"]
  ])("keeps the original refusal for %s alongside a draft, touching nothing", (_label, dirty, candidateKind) => {
    const { fixture, path: candidate } = prepareCandidate(`draft-dirty-${candidateKind}`);
    const draft = writeDraft(candidate, "kept-2026-09-06", "test-project");
    dirty(candidate);
    const before = git(candidate, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);

    const error = expectValidation(() => goAgain(fixture), "already holds uncommitted changes");

    expect(error.details?.candidateKind).toBe(candidateKind);
    expect(error.details?.worktreePath).toBe(candidate);
    expect(readFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-kept-2026-09-06.yaml")).equals(draft)).toBe(true);
    expect(git(candidate, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).toBe(before);
    expect(worktreeCount(fixture)).toBe(2);
    expect(receiptIds(fixture)).toEqual([]);
  });

  it("refuses with one structured disposition when a draft changes between its receipt and the resume", () => {
    const { fixture, path: candidate, branch } = prepareCandidate("draft-changed");
    const original = writeDraft(candidate, "changing-2026-09-06", "test-project");
    const draftPath = path.join(candidate, ".arcadia", "asks", "agent-ask-changing-2026-09-06.yaml");

    const error = expectValidation(() => goAgain(fixture, {
      testHooks: { beforeDraftResumeVerification: () => writeFileSync(draftPath, "edited by a live terminal\n") }
    }), "holds only Agent Ask drafts");

    const disposition = error.details?.disposition as Disposition;
    expect(error.details?.candidateKind).toBe("draft_only");
    expect(error.details?.branch).toBe(branch);
    expect(disposition.drafts).toEqual([{ path: ".arcadia/asks/agent-ask-changing-2026-09-06.yaml", sha256: sha256(original) }]);
    expect(disposition.nextStep).toContain("Only once every draft is settled or copied out, retire the candidate");
    // The receipt is committed after the refusal rolled back; the edit is left as found.
    expect(handouts(fixture)).toEqual([]);
    expect(receiptIds(fixture)).toEqual([disposition.receiptId]);
    expect(readFileSync(draftPath, "utf8")).toBe("edited by a live terminal\n");
    expect(worktreeCount(fixture)).toBe(2);
  });

  it("classifies a refused-only candidate afresh after an edit, on a new receipt, and hands it out", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-refused-then-edited");
    writeDraft(candidate, "edited-2026-09-06", "test-project");
    const draftPath = path.join(candidate, ".arcadia", "asks", "agent-ask-edited-2026-09-06.yaml");
    const refused = expectValidation(() => goAgain(fixture, {
      testHooks: { beforeDraftResumeVerification: () => writeFileSync(draftPath, "{\"project\": \"test-project\"}\n") }
    }), "holds only Agent Ask drafts");
    const refusedReceipt = (refused.details?.disposition as Disposition).receiptId;

    const resumed = goAgain(fixture, { now: new Date("2026-09-06T14:00:00.000Z") });

    expect(resumed.data.nextWorktree?.path).toBe(candidate);
    expect(resumed.data.draftRecovery?.requestId).not.toBe(refusedReceipt);
    expect(receiptIds(fixture).sort()).toEqual([refusedReceipt, resumed.data.draftRecovery!.requestId].sort());
    expect(handouts(fixture)).toEqual([{ request_id: resumed.data.draftRecovery!.requestId, resumed_route: "go" }]);
  });

  it("refuses with the handed-out disposition once a handed-out candidate's draft changes", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-changed-later");
    writeDraft(candidate, "later-2026-09-06", "test-project");
    const first = goAgain(fixture).data.draftRecovery!;
    const edited = Buffer.from("edited after the handout\n");
    writeFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-later-2026-09-06.yaml"), edited);

    const error = expectValidation(() => goAgain(fixture, { now: new Date("2026-09-06T14:00:00.000Z") }), "holds only Agent Ask drafts");

    const disposition = error.details?.disposition as Disposition;
    expect(disposition.handedOut).toEqual({ receiptId: first.requestId, route: "go", at: resumedAt.toISOString() });
    expect(disposition.drafts.map((draft) => draft.sha256)).toEqual([sha256(edited)]);
    expect(disposition.nextStep).toContain("is gone");
    // Both observed versions stay receipted; only the first was ever handed out.
    expect(receiptIds(fixture).sort()).toEqual([first.requestId, disposition.receiptId].sort());
    expect(handouts(fixture)).toEqual([{ request_id: first.requestId, resumed_route: "go" }]);
    expect(worktreeCount(fixture)).toBe(2);
  });

  it("hands a candidate out once: a repeated Go call replays the same receipt and refuses with the disposition", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-replay");
    writeDraft(candidate, "replay-2026-09-06", "test-project");

    const first = goAgain(fixture).data.draftRecovery!;
    const error = expectValidation(() => goAgain(fixture, { now: new Date("2026-09-06T14:00:00.000Z") }), "holds only Agent Ask drafts");

    const disposition = error.details?.disposition as Disposition;
    expect(disposition.receiptId).toBe(first.requestId);
    expect(disposition.handedOut?.receiptId).toBe(first.requestId);
    expect(disposition.blocker).toContain("Already handed out via arcadia go");
    expect(receiptIds(fixture)).toEqual([first.requestId]);
    expect(handouts(fixture)).toHaveLength(1);
    expect(claims(fixture)).toHaveLength(1);
    expect(worktreeCount(fixture)).toBe(2);
  });

  it("gives exactly one of two racing Go attempts the candidate; the other refuses with the disposition", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-race");
    writeDraft(candidate, "race-2026-09-06", "test-project");
    let outerError: ArcadiaError | null = null;

    // The second attempt runs entirely inside the first one's window before its
    // own dispatch transaction opens; that transaction then sees the handout.
    const inner = { result: null as ReturnType<typeof goAgain> | null };
    try {
      goAgain(fixture, { testHooks: { beforeDispatchTransaction: () => { inner.result = goAgain(fixture); } } });
    } catch (error) {
      outerError = error as ArcadiaError;
    }

    expect(inner.result!.data.nextWorktree?.path).toBe(candidate);
    expect(outerError?.message).toContain("holds only Agent Ask drafts");
    expect((outerError?.details?.disposition as Disposition).handedOut?.receiptId).toBe(inner.result!.data.draftRecovery?.requestId);
    expect(receiptIds(fixture)).toHaveLength(1);
    expect(handouts(fixture)).toHaveLength(1);
    expect(claims(fixture)).toHaveLength(1);
    expect(worktreeCount(fixture)).toBe(2);
  });

  it("refuses with the disposition, handing nothing out, while a process still has its cwd inside the candidate", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-live-process");
    const draft = writeDraft(candidate, "live-2026-09-06", "test-project");
    liveness = { ok: true, processes: [{ pid: 4242, command: "claude", cwd: candidate }] };

    const error = expectValidation(() => goAgain(fixture), "holds only Agent Ask drafts");

    const disposition = error.details?.disposition as Disposition;
    expect(disposition.blocker).toContain("That session still appears to be running here: pid 4242 (claude)");
    expect(disposition.nextStep).toContain("Only once every draft is settled or copied out");
    expect(receiptIds(fixture)).toEqual([disposition.receiptId]);
    expect(handouts(fixture)).toEqual([]);
    expect(readFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-live-2026-09-06.yaml")).equals(draft)).toBe(true);

    // Once that process is gone, the same candidate is handed out as before.
    liveness = { ok: true, processes: [] };
    expect(goAgain(fixture, { now: new Date("2026-09-06T14:00:00.000Z") }).data.nextWorktree?.path).toBe(candidate);
    expect(handouts(fixture)).toHaveLength(1);
  });

  it("fails closed with the disposition when the liveness probe cannot tell", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-probe-failed");
    writeDraft(candidate, "probe-2026-09-06", "test-project");
    liveness = { ok: false, error: "lsof could not run: spawn lsof ENOENT" };

    const error = expectValidation(() => goAgain(fixture), "holds only Agent Ask drafts");

    expect((error.details?.disposition as Disposition).blocker).toContain("Could not verify that no session is running in this worktree: lsof could not run");
    expect(handouts(fixture)).toEqual([]);
    expect(worktreeCount(fixture)).toBe(2);
  });

  it("refuses with the disposition when the base moved since the candidate was prepared", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-stale-base");
    const draft = writeDraft(candidate, "stale-2026-09-06", "test-project");
    commitFeature(fixture.main, "landed.txt", "another candidate landed\n");
    git(fixture.main, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    const error = expectValidation(() => goAgain(fixture), "holds only Agent Ask drafts");

    const disposition = error.details?.disposition as Disposition;
    expect(disposition.blocker).toContain("must be re-prepared from the current base. Its drafts remain on disk in this worktree");
    expect(receiptIds(fixture)).toEqual([disposition.receiptId]);
    expect(handouts(fixture)).toEqual([]);
    expect(readFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-stale-2026-09-06.yaml")).equals(draft)).toBe(true);
    expect(worktreeCount(fixture)).toBe(2);
  });

  it.each([".arcadia-go-request", ".arcadia-preserve-request"])("treats %s beside a draft as evidence a session ran, refusing with the disposition", (transport) => {
    const { fixture, path: candidate } = prepareCandidate(`draft-transport${transport.replaceAll(".", "-")}`);
    writeDraft(candidate, "transport-2026-09-06", "test-project");
    writeFileSync(path.join(candidate, transport), "{}\n");

    const error = expectValidation(() => goAgain(fixture), "holds only Agent Ask drafts");

    expect((error.details?.disposition as Disposition).blocker).toContain(`A session has run in this candidate: ${transport}`);
    expect(handouts(fixture)).toEqual([]);
    expect(existsSync(path.join(candidate, transport))).toBe(true);
    expect(worktreeCount(fixture)).toBe(2);
  });

  it("refuses with the disposition, not a resume, when the candidate branch already carries commits", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-committed");
    commitFeature(candidate, "work.txt", "work\n");
    writeDraft(candidate, "committed-2026-09-06", "test-project");

    const error = expectValidation(() => goAgain(fixture), "holds only Agent Ask drafts");

    expect((error.details?.disposition as { blocker: string }).blocker).toContain("commit(s) beyond main");
    expect(worktreeCount(fixture)).toBe(2);
  });

  it("still leaves a draft-holding candidate to tidy as dirt, never retiring it", () => {
    const { fixture, path: candidate } = prepareCandidate("draft-tidy");
    const draft = writeDraft(candidate, "tidy-2026-09-06", "test-project");
    // Drop the handoff reservation so only tidy's own dirt rule stands between
    // this candidate and retirement.
    withDatabase(fixture.workspace, (db) => db.prepare("DELETE FROM agent_worktree_reservations").run());

    // No liveness grace either: the drafts alone must keep it.
    const tidy = runTidyCommand({ repo: fixture.main, workspace: fixture.workspace, apply: true, livenessGraceMs: 0, now: new Date(Date.now() + 60_000) }).data;

    const entry = tidy.worktrees.find((candidateEntry: { path: string }) => candidateEntry.path === realpathSync(candidate));
    expect(entry?.verdict).toBe("dirty");
    expect(existsSync(candidate)).toBe(true);
    expect(readFileSync(path.join(candidate, ".arcadia", "asks", "agent-ask-tidy-2026-09-06.yaml")).equals(draft)).toBe(true);
  });
});

describe("arcadia go — base branch remote sync", () => {
  it("refuses direct mutation inside a coding-agent sandbox before changing Git state", () => {
    const fixture = createFixture("claude/sandbox-direct-apply");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const mainBefore = git(fixture.main, ["rev-parse", "main"]).trim();
    const sourceBefore = git(fixture.main, ["rev-parse", "claude/sandbox-direct-apply"]).trim();
    vi.stubEnv("CODEX_SANDBOX", "seatbelt");

    const failure = expectValidation(
      () => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }),
      "protected host controller"
    );

    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(mainBefore);
    expect(git(fixture.main, ["rev-parse", "claude/sandbox-direct-apply"]).trim()).toBe(sourceBefore);
    expect(existsSync(fixture.feature)).toBe(true);
    expectNoManualGitRemedy(failure);
  });

  it("skips cleanly when the base branch has no tracked remote", () => {
    const fixture = createFixture("claude/no-tracked-remote");
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true });

    expect(result.data.baseRemoteSync).toMatchObject({
      attempted: false,
      remote: null,
      fastForwarded: false,
      strategy: "none",
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

    expect(result.data.baseRemoteSync).toMatchObject({
      attempted: true,
      remote: "origin",
      fastForwarded: true,
      strategy: "fast-forward",
      reason: null
    });
    expect(result.data.baseRemoteSync.resultHead).toBe(result.data.baseRemoteSync.remoteHead);
    expect(git(fixture.main, ["log", "--format=%s", "main"])).toContain("remote-only commit");
  });

  it("re-resolves the pointer Action from the fetched base when no worktree sits on it, instead of a stale already-integrated checkout", () => {
    // Regression for GitHub Issue #511: another session settles the pointer
    // Action and pushes, while this session's own (already-integrated, never
    // advanced) source worktree stays frozen at the pre-settlement content --
    // and no worktree is checked out on `main` locally to have picked up the
    // fetch, so `projectRoot` used to fall back to that stale source.
    const fixture = createFixtureWithRemote("claude/stale-checkout");
    settleNextAction(fixture.remote);
    // Park the primary checkout off `main`, exactly as a live agent worktree
    // would leave it: nothing local is checked out on the base branch.
    git(fixture.main, ["switch", "-c", "claude/unrelated-parking"]);

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      workspace: fixture.workspace
    });

    expect(result.data.integration).toBe("already-integrated");
    expect(result.data.baseWorktree).toBeNull();
    // The stale checkout never names `define-contract`: re-resolved from the
    // truly current (fetched) base, the pointer is `dispatch-next`, and a
    // worktree is claimed for that Action, not a duplicate of settled work.
    expect(result.data.dispatch.context?.action.id).toBe("dispatch-next");
    expect(result.data.queueFallback).toBeNull();
    expect(result.data.nextWorktree).not.toBeNull();
    expect(result.data.nextWorktree?.branch).toContain("dispatch-next");
    expect(result.data.nextWorktree?.branch).not.toContain("define-contract");
  });

  it("refuses outright, claiming no worktree, when the fetched base no longer resolves the pointer Action as dispatchable at all", () => {
    const fixture = createFixtureWithRemote("claude/stale-checkout-done");
    const donePlan = planDocument.replace("status: in_progress", "status: done");
    writeFileSync(path.join(fixture.remote, "docs", "plans", "copy-proof.md"), donePlan);
    git(fixture.remote, ["add", "docs/plans/copy-proof.md"]);
    git(fixture.remote, ["commit", "-m", "mark define-contract done without repointing current_action"]);
    git(fixture.main, ["switch", "-c", "claude/unrelated-parking"]);
    const agentRoot = path.join(fixture.root, "agent-worktrees");
    const worktreeCountBefore = git(fixture.main, ["worktree", "list", "--porcelain"])
      .split("\n").filter((line) => line.startsWith("worktree ")).length;

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.feature,
        apply: true,
        agent: "claude",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      }),
      "no longer dispatchable"
    );

    expect(failure.details).toMatchObject({ staleActionId: "define-contract" });
    // No worktree and no DB claim were created for the refused Action: the
    // agent worktree root that would have held one was never populated, and
    // the repository's registered worktree count never grows past whatever
    // the (unrelated) Git reconciliation above already retired.
    expect(existsSync(agentRoot)).toBe(false);
    const worktreeCountAfter = git(fixture.main, ["worktree", "list", "--porcelain"])
      .split("\n").filter((line) => line.startsWith("worktree ")).length;
    expect(worktreeCountAfter).toBeLessThanOrEqual(worktreeCountBefore);
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT COUNT(*) AS n FROM agent_worktree_reservations").get())).toEqual({ n: 0 });
  });

  it("reconciles recognized governed base commits before issuing the prepared-worktree receipt", () => {
    const fixture = createFixtureWithRemote("claude/diverged-base");
    writeFileSync(path.join(fixture.remote, "remote-one.txt"), "remote one\n");
    git(fixture.remote, ["add", "remote-one.txt"]);
    git(fixture.remote, ["commit", "-m", "remote-only commit one"]);
    writeFileSync(path.join(fixture.remote, "remote-two.txt"), "remote two\n");
    git(fixture.remote, ["add", "remote-two.txt"]);
    git(fixture.remote, ["commit", "-m", "remote-only commit two"]);
    const remoteHead = git(fixture.remote, ["rev-parse", "HEAD"]).trim();
    commitGovernance(fixture.main, "governed local state\n");
    const settlementHead = git(fixture.main, ["rev-parse", "HEAD"]).trim();
    commitGovernedPointer(fixture.main);
    const localHead = git(fixture.main, ["rev-parse", "HEAD"]).trim();
    const agentRoot = path.join(fixture.root, "agent-worktrees");
    const hookSentinel = path.join(fixture.root, "post-merge-ran");
    const referenceHookSentinel = path.join(fixture.root, "reference-transaction-ran");
    const postMergeHook = path.join(fixture.main, ".git", "hooks", "post-merge");
    const referenceHook = path.join(fixture.main, ".git", "hooks", "reference-transaction");
    writeFileSync(postMergeHook, `#!/bin/sh\nprintf ran > ${JSON.stringify(hookSentinel)}\n`);
    writeFileSync(referenceHook, `#!/bin/sh\nprintf ran > ${JSON.stringify(referenceHookSentinel)}\n`);
    chmodSync(postMergeHook, 0o755);
    chmodSync(referenceHook, 0o755);

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.main,
      apply: true,
      agent: "codex",
      model: "gpt-5.6-terra",
      workspace: fixture.workspace,
      agentWorktreeRoot: agentRoot,
      now: new Date("2026-09-19T23:30:00.000Z")
    });

    expect(result.data.baseRemoteSync).toMatchObject({
      strategy: "governed-merge",
      upstream: "origin/main",
      localHeadBefore: localHead,
      remoteHead,
      localGovernanceCommits: [settlementHead, localHead],
      remoteCommitsIntegrated: 2,
      reason: null
    });
    const reconciled = result.data.baseRemoteSync.resultHead!;
    expect(git(fixture.main, ["show", "-s", "--format=%P", reconciled]).trim()).toBe(`${localHead} ${remoteHead}`);
    expect(git(fixture.main, ["merge-base", "--is-ancestor", localHead, reconciled])).toBe("");
    expect(git(fixture.main, ["merge-base", "--is-ancestor", remoteHead, reconciled])).toBe("");
    expect(result.data.nextWorktree).not.toBeNull();
    expect(git(result.data.nextWorktree!.path, ["rev-parse", "HEAD"]).trim()).toBe(reconciled);
    expect(result.data.dispatch.context?.action.id).toBe("dispatch-next");
    expect(readFileSync(path.join(result.data.nextWorktree!.path, "MISSION_LOG.md"), "utf8")).toBe("governed local state\n");
    expect(readFileSync(path.join(result.data.nextWorktree!.path, "remote-one.txt"), "utf8")).toBe("remote one\n");
    expect(readFileSync(path.join(result.data.nextWorktree!.path, "remote-two.txt"), "utf8")).toBe("remote two\n");
    expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(remoteHead);
    expect(git(fixture.main, ["for-each-ref", "--format=%(refname)", "refs/arcadia/go-fetch"])).toBe("");
    expect(git(fixture.remote, ["rev-parse", "HEAD"]).trim()).toBe(remoteHead);
    expect(existsSync(hookSentinel)).toBe(false);
    expect(existsSync(referenceHookSentinel)).toBe(false);
  });

  it("returns the governed reconciliation as a normal protected-broker receipt", () => {
    const fixture = createFixtureWithRemote("claude/broker-diverged-base");
    writeFileSync(path.join(fixture.remote, "remote.txt"), "remote\n");
    git(fixture.remote, ["add", "remote.txt"]);
    git(fixture.remote, ["commit", "-m", "remote-only commit"]);
    commitGovernance(fixture.main, "governed local state\n");
    const agentRoot = path.join(fixture.root, "broker-agent-worktrees");

    const result = runGoBroker(
      { source: fixture.main, agent: "codex", operation: "go" },
      options => runGoCommand({
        ...options,
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot,
        now: new Date("2026-09-19T23:30:00.000Z")
      })
    );

    expect(result.command).toBe("go-broker");
    expect("baseRemoteSync" in result.data && result.data.baseRemoteSync.strategy).toBe("governed-merge");
    expect("nextWorktree" in result.data && result.data.nextWorktree).not.toBeNull();
  });

  it("refuses a conflicting governed divergence before preparing any worktree", () => {
    const fixture = createFixtureWithRemote("claude/conflicting-base");
    const remoteProject = readFileSync(path.join(fixture.remote, "PROJECT.md"), "utf8")
      .replace("goal: Prove safe handoffs.", "goal: Remote direction.");
    writeFileSync(path.join(fixture.remote, "PROJECT.md"), remoteProject);
    git(fixture.remote, ["add", "PROJECT.md"]);
    git(fixture.remote, ["commit", "-m", "remote project change"]);
    const localProject = readFileSync(path.join(fixture.main, "PROJECT.md"), "utf8")
      .replace("goal: Prove safe handoffs.", "goal: Local governed direction.");
    writeFileSync(path.join(fixture.main, "PROJECT.md"), localProject);
    git(fixture.main, ["add", "PROJECT.md"]);
    git(fixture.main, ["commit", "-m", "chore(arcadia): point at define-contract", "-m", "Written by `arcadia advance queue make-next --apply` (qpointer_test)."]);
    const localHead = git(fixture.main, ["rev-parse", "HEAD"]).trim();
    const remoteHead = git(fixture.remote, ["rev-parse", "HEAD"]).trim();
    const trackingBefore = git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim();
    const worktreesBefore = git(fixture.main, ["worktree", "list", "--porcelain"]);
    const agentRoot = path.join(fixture.root, "conflict-agent-worktrees");

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      }),
      "do not reconcile cleanly"
    );
    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expect(git(fixture.main, ["status", "--porcelain"]).trim()).toBe("");
    expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(trackingBefore);
    expect(git(fixture.remote, ["rev-parse", "HEAD"]).trim()).toBe(remoteHead);
    expect(git(fixture.main, ["worktree", "list", "--porcelain"])).toBe(worktreesBefore);
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("refuses unrecognized local base history without a manual Git remedy", () => {
    const fixture = createFixtureWithRemote("claude/unrecognized-base");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    writeFileSync(path.join(fixture.main, "local-code.ts"), "export const local = true;\n");
    git(fixture.main, ["add", "local-code.ts"]);
    git(fixture.main, ["commit", "-m", "local code change"]);
    const localHead = git(fixture.main, ["rev-parse", "HEAD"]).trim();
    const worktreesBefore = git(fixture.main, ["worktree", "list", "--porcelain"]);
    const agentRoot = path.join(fixture.root, "unrecognized-agent-worktrees");
    let failure: ArcadiaError | null = null;
    try {
      runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      });
    } catch (error) {
      failure = error as ArcadiaError;
    }
    expect(failure).toBeInstanceOf(ArcadiaError);
    expect(failure?.message).toContain("not recognized Arcadia-generated governance writes");
    expectNoManualGitRemedy(failure!);
    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expect(git(fixture.main, ["worktree", "list", "--porcelain"])).toBe(worktreesBefore);
    expect(existsSync(agentRoot)).toBe(false);
  });

  it("refuses a base ref race before publishing or preparing a worktree", () => {
    const fixture = createFixtureWithRemote("claude/racing-base");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    commitGovernance(fixture.main, "governed local state\n");
    const agentRoot = path.join(fixture.root, "race-agent-worktrees");
    const worktreesBefore = git(fixture.main, ["worktree", "list", "--porcelain"]);
    const trackingBefore = git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim();

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot,
        testHooks: {
          beforeBaseReconciliationPublish() {
            expect(existsSync(agentRoot)).toBe(false);
            expect(git(fixture.main, ["worktree", "list", "--porcelain"])).toBe(worktreesBefore);
            git(fixture.main, ["commit", "--allow-empty", "-m", "concurrent base update"]);
          }
        }
      }),
      "changed during protected reconciliation"
    );
    expect(git(fixture.main, ["log", "-1", "--format=%s"]).trim()).toBe("concurrent base update");
    expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(trackingBefore);
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("refuses when the base worktree switches branches before publication", () => {
    const fixture = createFixtureWithRemote("claude/base-worktree-branch-race");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    commitGovernance(fixture.main, "governed local state\n");
    const localHead = git(fixture.main, ["rev-parse", "main"]).trim();
    const trackingBefore = git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim();
    const agentRoot = path.join(fixture.root, "branch-race-agent-worktrees");

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot,
        testHooks: {
          beforeBaseReconciliationPublish() {
            git(fixture.main, ["switch", "-c", "concurrent-base-branch"]);
          }
        }
      }),
      "changed branches during protected reconciliation"
    );

    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expect(git(fixture.main, ["rev-parse", "concurrent-base-branch"]).trim()).toBe(localHead);
    expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(trackingBefore);
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("refuses source-only work before publishing a divergent base result", () => {
    const fixture = createFixtureWithRemote("claude/separate-source");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    commitGovernance(fixture.main, "governed local state\n");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    const localHead = git(fixture.main, ["rev-parse", "main"]).trim();
    const worktreesBefore = git(fixture.main, ["worktree", "list", "--porcelain"]);
    const agentRoot = path.join(fixture.root, "separate-source-agent-worktrees");

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.feature,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      }),
      "cannot absorb source-only work"
    );
    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expect(git(fixture.main, ["worktree", "list", "--porcelain"])).toBe(worktreesBefore);
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("reconciles the base when a prepared source is already integrated remotely", () => {
    const fixture = createFixtureWithRemote("claude/integrated-source");
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    git(fixture.remote, ["fetch", fixture.main, "refs/heads/claude/integrated-source"]);
    git(fixture.remote, ["cherry-pick", "FETCH_HEAD"]);
    writeFileSync(path.join(fixture.remote, "remote-follow-up.txt"), "remote follow-up\n");
    git(fixture.remote, ["add", "remote-follow-up.txt"]);
    git(fixture.remote, ["commit", "-m", "remote follow-up"]);
    commitGovernance(fixture.main, "governed local state\n");
    const agentRoot = path.join(fixture.root, "integrated-source-agent-worktrees");

    const brokerResult = runGoBroker(
      { source: fixture.feature, agent: "codex", operation: "go" },
      options => runGoCommand({
        ...options,
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      })
    );
    if (!("baseRemoteSync" in brokerResult.data)) throw new Error("Expected protected Go receipt");
    const result = brokerResult.data;

    expect(brokerResult.command).toBe("go-broker");
    expect(result.baseRemoteSync.strategy).toBe("governed-merge");
    expect(result.integration).toBe("already-integrated");
    expect(result.sourceWorktreeRemoved).toBe(true);
    expect(result.sourceBranchDeleted).toBe(true);
    expect(result.nextWorktree).not.toBeNull();
    expect(readFileSync(path.join(result.nextWorktree!.path, "proof.txt"), "utf8")).toBe("proof\n");
    expect(readFileSync(path.join(result.nextWorktree!.path, "MISSION_LOG.md"), "utf8")).toBe("governed local state\n");
  });

  it("refuses a conflict-free merge whose governed pointer is semantically invalid", () => {
    const fixture = createFixtureWithRemote("claude/invalid-merged-dispatch");
    const remoteProject = readFileSync(path.join(fixture.remote, "PROJECT.md"), "utf8")
      .replace("current_action: define-contract", "current_action: missing-action");
    writeFileSync(path.join(fixture.remote, "PROJECT.md"), remoteProject);
    git(fixture.remote, ["add", "PROJECT.md"]);
    git(fixture.remote, ["commit", "-m", "remote pointer change"]);
    commitGovernance(fixture.main, "governed local state\n");
    const localHead = git(fixture.main, ["rev-parse", "main"]).trim();
    const trackingBefore = git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim();
    const worktreesBefore = git(fixture.main, ["worktree", "list", "--porcelain"]);
    const agentRoot = path.join(fixture.root, "invalid-dispatch-agent-worktrees");

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      }),
      "does not resolve a dispatchable governed Action"
    );

    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(trackingBefore);
    expect(git(fixture.main, ["worktree", "list", "--porcelain"])).toBe(worktreesBefore);
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("preserves remote rewrite evidence and refuses the same rewrite on retry", () => {
    const fixture = createFixtureWithRemote("claude/rewritten-upstream");
    const initial = git(fixture.remote, ["rev-parse", "HEAD"]).trim();
    writeFileSync(path.join(fixture.remote, "observed.txt"), "observed\n");
    git(fixture.remote, ["add", "observed.txt"]);
    git(fixture.remote, ["commit", "-m", "observed remote head"]);
    const observedHead = git(fixture.remote, ["rev-parse", "HEAD"]).trim();
    git(fixture.main, ["fetch", "origin"]);
    expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(observedHead);

    git(fixture.remote, ["switch", "--detach", initial]);
    writeFileSync(path.join(fixture.remote, "rewritten.txt"), "rewritten\n");
    git(fixture.remote, ["add", "rewritten.txt"]);
    git(fixture.remote, ["commit", "-m", "rewritten remote head"]);
    const rewrittenHead = git(fixture.remote, ["rev-parse", "HEAD"]).trim();
    git(fixture.remote, ["branch", "-f", "main", rewrittenHead]);
    git(fixture.remote, ["switch", "main"]);
    const localHead = git(fixture.main, ["rev-parse", "main"]).trim();
    const agentRoot = path.join(fixture.root, "rewrite-agent-worktrees");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failure = expectValidation(
        () => runGoCommand({
          repo: fixture.main,
          source: fixture.main,
          apply: true,
          agent: "codex",
          model: "gpt-5.6-terra",
          workspace: fixture.workspace,
          agentWorktreeRoot: agentRoot
        }),
        "rewritten instead of advanced"
      );
      expectNoManualGitRemedy(failure);
      expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(observedHead);
      expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
      expect(existsSync(agentRoot)).toBe(false);
    }
    expect(git(fixture.remote, ["rev-parse", "main"]).trim()).toBe(rewrittenHead);
  });

  it("refuses divergent history when its prior remote-tracking observation is missing", () => {
    const fixture = createFixtureWithRemote("claude/missing-remote-observation");
    writeFileSync(path.join(fixture.remote, "remote.txt"), "remote\n");
    git(fixture.remote, ["add", "remote.txt"]);
    git(fixture.remote, ["commit", "-m", "remote-only commit"]);
    commitGovernance(fixture.main, "governed local state\n");
    const localHead = git(fixture.main, ["rev-parse", "main"]).trim();
    git(fixture.main, ["update-ref", "-d", "refs/remotes/origin/main"]);
    const agentRoot = path.join(fixture.root, "missing-observation-agent-worktrees");

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      }),
      "no pinned prior observation"
    );

    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expect(() => git(fixture.main, ["show-ref", "--verify", "refs/remotes/origin/main"])).toThrow();
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("refuses a disappeared configured upstream before preparing a worktree", () => {
    const fixture = createFixtureWithRemote("claude/missing-upstream");
    git(fixture.remote, ["switch", "-c", "surviving-branch"]);
    git(fixture.remote, ["branch", "-D", "main"]);
    const localHead = git(fixture.main, ["rev-parse", "main"]).trim();
    const agentRoot = path.join(fixture.root, "missing-upstream-agent-worktrees");

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      }),
      "could not observe the configured upstream"
    );

    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("recognizes and verifies a prior protected reconciliation on a later run", () => {
    const fixture = createFixtureWithRemote("claude/repeated-reconciliation");
    writeFileSync(path.join(fixture.remote, "remote-one.txt"), "one\n");
    git(fixture.remote, ["add", "remote-one.txt"]);
    git(fixture.remote, ["commit", "-m", "remote one"]);
    commitGovernance(fixture.main, "governed state one\n");

    const first = runGoCommand({
      repo: fixture.main,
      source: fixture.main,
      apply: true,
      now: new Date("2026-09-19T23:30:00.000Z")
    });
    expect(first.data.baseRemoteSync.strategy).toBe("governed-merge");
    const firstResult = first.data.baseRemoteSync.resultHead!;

    writeFileSync(path.join(fixture.remote, "remote-two.txt"), "two\n");
    git(fixture.remote, ["add", "remote-two.txt"]);
    git(fixture.remote, ["commit", "-m", "remote two"]);
    commitGovernance(fixture.main, "governed state two\n");
    const second = runGoCommand({
      repo: fixture.main,
      source: fixture.main,
      apply: true,
      now: new Date("2026-09-20T00:30:00.000Z")
    });

    expect(second.data.baseRemoteSync.strategy).toBe("governed-merge");
    expect(second.data.baseRemoteSync.localGovernanceCommits).toContain(firstResult);
    expect(git(fixture.main, ["merge-base", "--is-ancestor", firstResult, second.data.baseRemoteSync.resultHead!])).toBe("");
  });

  it("refuses a forged prior reconciliation whose tree does not match its parents", () => {
    const fixture = createFixtureWithRemote("claude/forged-reconciliation");
    const initial = git(fixture.main, ["rev-parse", "main"]).trim();
    writeFileSync(path.join(fixture.remote, "remote-one.txt"), "remote one\n");
    git(fixture.remote, ["add", "remote-one.txt"]);
    git(fixture.remote, ["commit", "-m", "remote one"]);
    const remoteOne = git(fixture.remote, ["rev-parse", "HEAD"]).trim();
    git(fixture.main, ["fetch", "origin"]);
    commitGovernance(fixture.main, "governed local state\n");
    const localGovernance = git(fixture.main, ["rev-parse", "HEAD"]).trim();

    const forgedPath = path.join(fixture.main, "forged-code.ts");
    writeFileSync(forgedPath, "export const forged = true;\n");
    git(fixture.main, ["add", "forged-code.ts"]);
    const forgedTree = git(fixture.main, ["write-tree"]).trim();
    git(fixture.main, ["restore", "--staged", "forged-code.ts"]);
    rmSync(forgedPath);
    const forgedMessage = [
      "chore(arcadia): reconcile main with origin/main",
      "",
      `Local-Head: ${localGovernance}`,
      `Remote-Head: ${remoteOne}`,
      `Merge-Base: ${initial}`,
      "Local-Governance-Commits: 1",
      "Remote-Commits-Integrated: 1",
      "",
      "Written by protected Arcadia Go host-controller reconciliation."
    ].join("\n");
    const forgedCommit = git(fixture.main, [
      "commit-tree", forgedTree,
      "-p", localGovernance,
      "-p", remoteOne,
      "-m", forgedMessage
    ]).trim();
    git(fixture.main, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", forgedCommit]);
    writeFileSync(path.join(fixture.remote, "remote-two.txt"), "remote two\n");
    git(fixture.remote, ["add", "remote-two.txt"]);
    git(fixture.remote, ["commit", "-m", "remote two"]);
    const agentRoot = path.join(fixture.root, "forged-reconciliation-agent-worktrees");

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot
      }),
      "not recognized Arcadia-generated governance writes"
    );

    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(forgedCommit);
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("refuses a remote-tracking race before publishing the generated base", () => {
    const fixture = createFixtureWithRemote("claude/remote-ref-race");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    commitGovernance(fixture.main, "governed local state\n");
    const localHead = git(fixture.main, ["rev-parse", "main"]).trim();
    const agentRoot = path.join(fixture.root, "remote-race-agent-worktrees");

    const failure = expectValidation(
      () => runGoCommand({
        repo: fixture.main,
        source: fixture.main,
        apply: true,
        agent: "codex",
        model: "gpt-5.6-terra",
        workspace: fixture.workspace,
        agentWorktreeRoot: agentRoot,
        testHooks: {
          beforeBaseReconciliationPublish() {
            expect(existsSync(agentRoot)).toBe(false);
            git(fixture.main, ["update-ref", "refs/remotes/origin/main", localHead]);
          }
        }
      }),
      "remote-tracking ref changed before"
    );

    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expect(git(fixture.main, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(localHead);
    expect(existsSync(agentRoot)).toBe(false);
    expectNoManualGitRemedy(failure);
  });

  it("refuses configured merge drivers before computing a host merge", () => {
    const fixture = createFixtureWithRemote("claude/custom-merge-driver");
    git(fixture.remote, ["commit", "--allow-empty", "-m", "remote-only commit"]);
    commitGovernance(fixture.main, "governed local state\n");
    git(fixture.main, ["config", "merge.arcadia.driver", "false"]);
    const localHead = git(fixture.main, ["rev-parse", "main"]).trim();

    const failure = expectValidation(
      () => runGoCommand({ repo: fixture.main, source: fixture.main, apply: true }),
      "refuses to run repository-configured merge drivers"
    );

    expect(git(fixture.main, ["rev-parse", "main"]).trim()).toBe(localHead);
    expectNoManualGitRemedy(failure);
  });
});

describe("arcadia go — next-session model resolution", () => {
  it("refuses an active plan with no pinned model before it can dispatch", () => {
    const fixture = createFixture("codex/no-model", planDocument.replace("recommended_model: gpt-5.6-terra\n", ""));
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    expectValidation(
      () => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude", workspace: fixture.workspace }),
      "does not resolve exactly one dispatchable"
    );
    expect(existsSync(fixture.feature)).toBe(true);
    expect(git(fixture.main, ["log", "-1", "--format=%s"]).trim()).toBe("initial");
  });

  it("uses the plan's recommended_model and recommended_reasoning_effort when no override is given", () => {
    const fixture = createFixture("codex/plan-model", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude", workspace: fixture.workspace });

    // Smallest model first: the plan's opus becomes the escalation target.
    expect(result.data.nextWorktree?.model).toBe("haiku");
    expect(result.data.nextWorktree?.effort).toBe("e1_brief");
    expect(result.data.nextWorktree?.command).toContain('claude --model "haiku" --effort "e1_brief" "arcadia advance"');
    expect(result.data.modelResolution).toMatchObject({ tier: "light", escalation: { model: "opus" } });
    expect(renderGoSuccess(result).join("\n")).toContain("Starts on haiku; escalation model for hard sub-problems: opus");
  });

  it("starts on the plan's own model when the workspace sets sessionStartTier to plan", () => {
    const fixture = createFixture("codex/plan-start-tier", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");
    mkdirSync(path.join(fixture.workspace, "config"), { recursive: true });
    writeFileSync(path.join(fixture.workspace, "config", "coding-agent-models.json"), JSON.stringify({ sessionStartTier: "plan" }));

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude", workspace: fixture.workspace });

    expect(result.data.nextWorktree?.model).toBe("opus");
    expect(result.data.nextWorktree?.effort).toBe("high");
    expect(result.data.modelResolution?.escalation ?? null).toBeNull();
  });

  it("an explicit --model/--effort overrides the plan's recommendation", () => {
    const fixture = createFixture("codex/override-model", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      workspace: fixture.workspace,
      model: "claude-haiku-4-5",
      effort: "low"
    });

    expect(result.data.nextWorktree?.model).toBe("claude-haiku-4-5");
    expect(result.data.nextWorktree?.effort).toBe("low");
    expect(result.data.modelResolution).toMatchObject({ source: "explicit", escalation: { model: "opus" } });
  });

  it("builds the codex launch command with -m and the reasoning-effort TOML override", () => {
    const fixture = createFixture(
      "codex/codex-shape",
      planDocument.replace(
        "recommended_model: gpt-5.6-terra\n",
        "recommended_model: gpt-5.6-terra\nrecommended_reasoning_effort: high\n"
      )
    );
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "codex", workspace: fixture.workspace, effort: "high" });

    expect(result.data.nextWorktree?.model).toBe("gpt-6-luna");
    expect(result.data.nextWorktree?.command).toContain('-m "gpt-6-luna"');
    expect(result.data.nextWorktree?.command).toContain('-c model_reasoning_effort="high"');
    expect(result.data.nextWorktree?.command).not.toContain("--effort");
  });

  it("omits the effort flag entirely when only a model resolves", () => {
    const fixture = createFixture("codex/model-only", planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude", model: "claude-sonnet-5", workspace: fixture.workspace });

    expect(result.data.nextWorktree?.effort).toBeNull();
    expect(result.data.nextWorktree?.command).not.toContain("--effort");
  });

  it("falls back to the agent's standard tier when the plan names another provider's model", () => {
    // GitHub Issue #282: a plan pinned `gpt-5.6-terra` handed to Claude must not
    // reach `claude --model` unvalidated, and must not refuse the handoff
    // either — it resolves Claude's standard tier with a visible note.
    const fixture = createFixture("codex/wrong-provider-model", planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "claude", workspace: fixture.workspace });

    expect(result.data.nextWorktree?.model).toBe("haiku");
    expect(result.data.modelResolution).toMatchObject({ source: "tier", tier: "light", escalation: { model: "sonnet", tier: "standard" } });
    expect(result.data.modelResolution?.note).toContain("gpt-5.6-terra");
    expect(result.data.nextWorktree?.command).toContain('claude --model "haiku"');
    // The Git reconciliation (fast-forward and source retirement) still ran.
    expect(existsSync(path.join(fixture.main, "proof.txt"))).toBe(true);
    expect(() => git(fixture.main, ["show-ref", "--verify", "refs/heads/codex/wrong-provider-model"])).toThrow();
  });

  it("resolves a logical tier for every agent from the bundled registry", () => {
    const tieredPlan = planDocument.replace("recommended_model: gpt-5.6-terra\n", "recommended_model: heavy\n");
    const expected = { codex: "gpt-6-luna", claude: "haiku", opencode: "opencode-go/glm-5.3-flash" } as const;
    const escalation = { codex: "gpt-6.1-sol", claude: "opus", opencode: "opencode-go/gpt-5.6-luna" } as const;
    for (const agent of ["codex", "claude", "opencode"] as const) {
      const fixture = createFixture(`codex/tier-${agent}`, tieredPlan);
      commitFeature(fixture.feature, "proof.txt", "proof\n");
      const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent, workspace: fixture.workspace });
      expect(result.data.nextWorktree?.model).toBe(expected[agent]);
      expect(result.data.modelResolution).toMatchObject({ tier: "light", source: "tier", escalation: { model: escalation[agent], tier: "heavy" } });
    }
  });

  it("resolves an opencode model for a plan pinned to Claude, the #282 case", () => {
    const fixture = createFixture("codex/opencode-fallback", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "opencode", workspace: fixture.workspace, effort: "high" });

    expect(result.data.nextWorktree?.model).toBe("opencode-go/glm-5.3-flash");
    expect(result.data.modelResolution).toMatchObject({ source: "tier", tier: "light", escalation: { model: "opencode-go/deepseek-v4.1-flash" } });
    expect(result.data.nextWorktree?.command).toContain(
      'opencode run --model "opencode-go/glm-5.3-flash" --variant "high" "arcadia advance"'
    );
  });

  it("trusts an explicit --model even when it does not look like a Claude Code model", () => {
    const fixture = createFixture("codex/override-implausible-model", planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({
      repo: fixture.main,
      source: fixture.feature,
      apply: true,
      agent: "claude",
      workspace: fixture.workspace,
      model: "gpt-5.6-terra"
    });

    expect(result.data.nextWorktree?.model).toBe("gpt-5.6-terra");
  });

  it("does not apply the Claude-model check for a Codex handoff", () => {
    const fixture = createFixture("codex/codex-handoff-unaffected", planDocument);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "codex", workspace: fixture.workspace });

    expect(result.data.nextWorktree?.model).toBe("gpt-6-luna");
  });
});

function createFixture(branch: string, plan: string = planDocument): { root: string; main: string; feature: string; workspace: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-go-"));
  roots.push(root);
  const main = path.join(root, "repo");
  const feature = path.join(root, "feature");
  const workspace = path.join(root, "workspace");
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
  initWorkspace(workspace);
  return { root, main, feature, workspace };
}

/** Like createFixture, but `main` is a real clone of a separate remote repo, so `git fetch` has something distinct to pull. */
function createFixtureWithRemote(branch: string, plan: string = planDocument): { root: string; remote: string; main: string; feature: string; workspace: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-go-remote-"));
  roots.push(root);
  const remote = path.join(root, "remote");
  const main = path.join(root, "repo");
  const feature = path.join(root, "feature");
  const workspace = path.join(root, "workspace");
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
  initWorkspace(workspace);
  return { root, remote, main, feature, workspace };
}

function commitFeature(cwd: string, file: string, content: string): void {
  writeFileSync(path.join(cwd, file), content);
  git(cwd, ["add", file]);
  git(cwd, ["commit", "-m", "feature proof"]);
}

function commitGovernance(cwd: string, content: string): void {
  writeFileSync(path.join(cwd, "MISSION_LOG.md"), content);
  git(cwd, ["add", "MISSION_LOG.md"]);
  git(cwd, [
    "commit",
    "-m", "chore(arcadia): settle protected-go-divergence-test",
    "-m", "Written by `arcadia agent-ask settle --apply` (asksettle_test)."
  ]);
}

function commitGovernedPointer(cwd: string): void {
  writeFileSync(path.join(cwd, "PROJECT.md"), projectDocument.replace("current_action: define-contract", "current_action: dispatch-next"));
  writeFileSync(path.join(cwd, "docs", "plans", "copy-proof.md"), planDocument.replace(
    "---\n\n# Copy proof",
    `  - id: dispatch-next
    title: Dispatch the next Action
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Dispatch the next governed Action.
    expected_artifact: docs/next.md
    acceptance_criteria:
      - The next Action is dispatchable.
---

# Copy proof`
  ));
  git(cwd, ["add", "PROJECT.md", "docs/plans/copy-proof.md"]);
  git(cwd, [
    "commit",
    "-m", "chore(arcadia): point at dispatch-next",
    "-m", "Written by `arcadia advance queue make-next --apply` (qpointer_test)."
  ]);
}

/** Model the completion settlement that moves the governed pointer after code landed. */
function settleNextAction(cwd: string): void {
  writeFileSync(path.join(cwd, "PROJECT.md"), projectDocument.replace("current_action: define-contract", "current_action: dispatch-next"));
  writeFileSync(path.join(cwd, "docs", "plans", "copy-proof.md"), planDocument.replace(
    "---\n\n# Copy proof",
    `  - id: dispatch-next
    title: Dispatch the next Action
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Dispatch the next governed Action.
    expected_artifact: docs/next.md
    acceptance_criteria:
      - The next Action is dispatchable.
---

# Copy proof`
  ));
  git(cwd, ["add", "PROJECT.md", "docs/plans/copy-proof.md"]);
  git(cwd, ["commit", "-m", "settle completion and advance pointer"]);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function expectValidation(run: () => unknown, fragment: string): ArcadiaError {
  try {
    run();
    throw new Error("Expected validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    expect((error as Error).message).toContain(fragment);
    return error as ArcadiaError;
  }
}

function expectNoManualGitRemedy(error: ArcadiaError): void {
  expect(JSON.stringify(error.details)).not.toMatch(/manual|rebase|git\s+merge/i);
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
