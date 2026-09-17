import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { runGoCommand } from "../src/commands/go.js";
import { runTidyCommand } from "../src/commands/tidy.js";
import { withReadOnlyDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

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
    expect(existsSync(result.data.nextWorktree!.path)).toBe(true);
    expect(git(result.data.nextWorktree!.path, ["branch", "--show-current"]).trim()).toBe(result.data.nextWorktree!.branch);
    expect(git(result.data.nextWorktree!.path, ["merge-base", "--is-ancestor", "main", "HEAD"])).toBe("");
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
    const recovery = result.data.askRecoveries[0]!;
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
    expect(recoverySource!.requestId).toBe("concurrent-drift-source");
    expect(recoveryBase!.requestId).toBe("concurrent-drift-base");
    expect(recoverySource!.branch).not.toBe(recoveryBase!.branch);
    expect(recoverySource!.askFile).not.toBe(recoveryBase!.askFile);
    expect(existsSync(path.join(fixture.feature, "agent-ask.yaml"))).toBe(false);
    expect(existsSync(path.join(fixture.main, "agent-ask.yaml"))).toBe(false);
    expect(git(fixture.main, ["status", "--porcelain"]).trim()).toBe("");

    // Both branches genuinely exist, side by side, in the one shared repo —
    // neither recovery's worktree-add/commit/worktree-remove sequence
    // clobbered the other's branch or left it half-written.
    expect(git(fixture.main, ["branch", "--list", "ask/recover-*"]).trim().split("\n")).toHaveLength(2);
    expect(git(fixture.main, ["show", `${recoverySource!.branch}:${recoverySource!.askFile}`])).toContain("concurrent drift on source");
    expect(git(fixture.main, ["show", `${recoveryBase!.branch}:${recoveryBase!.askFile}`])).toContain("concurrent drift on base");

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
    const recovery = result.data.askRecoveries[0]!;
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
    const recovery = result.data.askRecoveries[0]!;
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
    const recoveredBranch = retried.data.askRecoveries[0]!.branch!;
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

    expectValidation(() => runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true }), "agent-owned");
    expect(existsSync(fixture.feature)).toBe(true);
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
      workspace: fixture.workspace,
      model: "claude-haiku-4-5",
      effort: "low"
    });

    expect(result.data.nextWorktree?.model).toBe("claude-haiku-4-5");
    expect(result.data.nextWorktree?.effort).toBe("low");
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

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "codex", workspace: fixture.workspace });

    expect(result.data.nextWorktree?.model).toBe("gpt-5.6-terra");
    expect(result.data.nextWorktree?.command).toContain('-m "gpt-5.6-terra"');
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

    expect(result.data.nextWorktree?.model).toBe("sonnet");
    expect(result.data.modelResolution).toMatchObject({ source: "fallback", tier: "standard" });
    expect(result.data.modelResolution?.note).toContain("gpt-5.6-terra");
    expect(result.data.nextWorktree?.command).toContain('claude --model "sonnet"');
    // The Git reconciliation (fast-forward and source retirement) still ran.
    expect(existsSync(path.join(fixture.main, "proof.txt"))).toBe(true);
    expect(() => git(fixture.main, ["show-ref", "--verify", "refs/heads/codex/wrong-provider-model"])).toThrow();
  });

  it("resolves a logical tier for every agent from the bundled registry", () => {
    const tieredPlan = planDocument.replace("recommended_model: gpt-5.6-terra\n", "recommended_model: heavy\n");
    const expected = { codex: "gpt-5.6-sol", claude: "opus", opencode: "opencode-go/gpt-5.6-luna" } as const;
    for (const agent of ["codex", "claude", "opencode"] as const) {
      const fixture = createFixture(`codex/tier-${agent}`, tieredPlan);
      commitFeature(fixture.feature, "proof.txt", "proof\n");
      const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent, workspace: fixture.workspace });
      expect(result.data.nextWorktree?.model).toBe(expected[agent]);
      expect(result.data.modelResolution).toMatchObject({ tier: "heavy", source: "tier" });
    }
  });

  it("resolves an opencode model for a plan pinned to Claude, the #282 case", () => {
    const fixture = createFixture("codex/opencode-fallback", planDocumentWithModel);
    commitFeature(fixture.feature, "proof.txt", "proof\n");

    const result = runGoCommand({ repo: fixture.main, source: fixture.feature, apply: true, agent: "opencode", workspace: fixture.workspace, effort: "high" });

    expect(result.data.nextWorktree?.model).toBe("opencode-go/deepseek-v4.1-flash");
    expect(result.data.modelResolution).toMatchObject({ source: "fallback", tier: "standard" });
    expect(result.data.nextWorktree?.command).toContain(
      'opencode run --model "opencode-go/deepseek-v4.1-flash" --variant "high" "arcadia advance"'
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

    expect(result.data.nextWorktree?.model).toBe("gpt-5.6-terra");
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
