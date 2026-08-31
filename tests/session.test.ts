import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runGoCommand } from "../src/commands/go.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import {
  createCodexInvocation,
  createReviewItem,
  getWorkItemByDocRef,
  upsertProject,
  upsertProjectMetadata,
  updateReviewItemStatus
} from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import {
  getSession,
  launchPreparedSession,
  prepareSession,
  resolveProjectTransition,
  sessionView,
  type TmuxAdapter
} from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class FakeTmux implements TmuxAdapter {
  isAvailable = true;
  collision = false;
  live = false;
  failLaunch = false;
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() { return this.isAvailable; }
  hasSession() { return this.collision || this.live; }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    if (this.failLaunch) throw new Error("synthetic spawn failure");
    this.launches.push(input);
    this.live = true;
  }
}

describe("tmux-backed Sessions", () => {
  it("keeps preview and manual handoff non-launching", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();

    const preview = runGoCommand({ repo: fixture.repo, source: fixture.repo, agent: "claude", tmux });
    expect(preview.data.nextWorktree).toBeNull();
    expect(preview.data.session).toBeNull();

    const manual = runGoCommand({
      repo: fixture.repo,
      source: fixture.repo,
      apply: true,
      agent: "claude",
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "manual"),
      now: fixture.now,
      tmux
    });
    expect(manual.data.nextWorktree?.command).toContain('claude --model "sonnet" --effort "high" "arcadia advance"');
    expect(manual.data.session).toBeNull();
    expect(tmux.launches).toHaveLength(0);
  });

  it("persists the immutable receipt before explicit launch and exposes exact reattach instructions", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const result = launch(fixture, tmux);

    expect(result.data.session).toMatchObject({
      status: "running",
      project_slug: "test-project",
      plan_slug: "copy-proof",
      action_id: "define-contract",
      packet_id: fixture.packetId,
      packet_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      authorizing_decisions_json: expect.stringContaining('"0001"'),
      provider_profile: "claude_build",
      provider: "claude-code-cli",
      model: "sonnet",
      effort: "high",
      base_revision: expect.stringMatching(/^[a-f0-9]{40}$/),
      provider_session_id: expect.stringMatching(/^[0-9a-f-]{36}$/)
    });
    expect(tmux.launches).toHaveLength(1);
    expect(tmux.launches[0].command).toBe("claude");
    expect(tmux.launches[0].args).toContain("--session-id");
    expect(tmux.launches[0].args.at(-1)).toBe(`arcadia advance --session ${result.data.session!.id}`);

    const view = sessionView(result.data.session!, tmux);
    expect(view.observedStatus).toBe("running");
    expect(view.reattachCommand).toBe(`tmux attach-session -t ${result.data.session!.tmux_session_name}`);
    expect(view.resumeCommand).toContain(`claude --resume ${result.data.session!.provider_session_id}`);
  });

  it("refuses missing tmux and name collisions before claiming running", () => {
    const missing = preparedFixture();
    const missingTmux = new FakeTmux();
    missingTmux.isAvailable = false;
    expectArcadiaError(() => launch(missing, missingTmux), "tmux is required");

    const collision = preparedFixture();
    const collidingTmux = new FakeTmux();
    collidingTmux.collision = true;
    expectArcadiaError(() => launch(collision, collidingTmux), "already exists");
  });

  it("records spawn failure without claiming running and releases the repository lease", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    tmux.failLaunch = true;
    let sessionId: string | null = null;
    try {
      launch(fixture, tmux);
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      sessionId = ((error as ArcadiaError).details as { sessionId?: string }).sessionId ?? null;
    }
    expect(sessionId).toBeTruthy();
    const stored = withReadOnlyDatabase(fixture.workspace, (db) => getSession(db, sessionId!));
    expect(stored?.status).toBe("failed");
    expect(stored?.started_at).toBeNull();
    expect(stored?.ended_at).toBeTruthy();
  });

  it("enforces one prepared or running lease per repository", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    launch(fixture, tmux);
    expectArcadiaError(() => launch(fixture, tmux, "second"), "does not authorize a new Session");
  });

  it("requires the explicit launch authority shape", () => {
    const fixture = preparedFixture();
    expectArcadiaError(() => runGoCommand({ repo: fixture.repo, launch: true, agent: "claude" }), "requires --apply");
    expectArcadiaError(() => runGoCommand({ repo: fixture.repo, launch: true, apply: true, agent: "codex" }), "requires --apply --agent claude");
  });

  it("refuses a packet changed after its authorizing Decision", () => {
    const fixture = preparedFixture();
    writeFileSync(path.join(fixture.workspace, "prompts", "codex", fixture.packetId, "prompt.md"), "changed after approval\n");
    expectArcadiaError(() => launch(fixture, new FakeTmux()), "authority set is stale");
  });

  it("refuses when the prepared worktree base revision changes before process start", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const worktree = path.join(fixture.root, "stale-worktree");
    git(fixture.repo, ["worktree", "add", "-q", "-b", "claude/stale-base", worktree, "main"]);
    const baseRevision = git(fixture.repo, ["rev-parse", "main"]).trim();
    const dispatch = resolveDispatch(fixture.repo, "test-project");
    const prepared = withDatabase(fixture.workspace, (db) => prepareSession({
      db,
      workspace: fixture.workspace,
      repoRoot: fixture.repo,
      dispatch,
      agent: "claude",
      model: "sonnet",
      effort: "high",
      baseRevision,
      branch: "claude/stale-base",
      worktreePath: worktree,
      now: fixture.now,
      tmux
    }));
    writeFileSync(path.join(worktree, "changed.txt"), "changed\n");
    git(worktree, ["add", "changed.txt"]);
    git(worktree, ["commit", "-m", "change prepared base"]);

    expectArcadiaError(
      () => withDatabase(fixture.workspace, (db) => launchPreparedSession(db, prepared, tmux)),
      "base revision changed"
    );
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getSession(db, prepared.id))?.status).toBe("failed");
    expect(tmux.launches).toHaveLength(0);
  });

  it("resolves cross-repository launch, operator Decision, and planning outcomes without improvising", () => {
    const ppn = transitionRepo("Private Practice Now", "private-practice-now", "codex", true);
    const rebuster = transitionRepo("Rebuster", "rebuster", "requires_review", true);
    const idea = transitionRepo("Field Notes", "field-notes", "codex", false);

    expect(resolveProjectTransition({ repoRoot: ppn, projectSlug: "private-practice-now" }).kind).toBe("launch");
    expect(resolveProjectTransition({ repoRoot: rebuster, projectSlug: "rebuster" }).kind).toBe("decision");
    expect(resolveProjectTransition({ repoRoot: idea, projectSlug: "field-notes" }).kind).toBe("plan");
  });
});

function launch(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux, suffix = "launch") {
  return runGoCommand({
    repo: fixture.repo,
    source: fixture.repo,
    apply: true,
    agent: "claude",
    launch: true,
    workspace: fixture.workspace,
    agentWorktreeRoot: path.join(fixture.root, suffix),
    now: fixture.now,
    tmux
  });
}

function preparedFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-session-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), planDocument);
  writeFileSync(path.join(repo, "docs", "decisions", "0001-authorize.md"), decisionDocument);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  initWorkspace(workspace);
  const packetId = "codex_session_fixture";
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove Sessions.", goal: "Prove Sessions.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
    const promptPath = `prompts/codex/${packetId}/prompt.md`;
    const baseRevision = git(repo, ["rev-parse", "HEAD"]).trim();
    mkdirSync(path.join(workspace, path.dirname(promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), "immutable build packet\n");
    writeFileSync(path.join(workspace, path.dirname(promptPath), "metadata.json"), JSON.stringify({
      invocationId: packetId,
      workItemId: workItem.id,
      promptPath,
      baseRevision,
      providerSelection: {
        provider: "claude-code-cli",
        model: "sonnet",
        mappingId: "fixture-map",
        bindingId: "fixture-binding"
      }
    }));
    createCodexInvocation(db, {
      id: packetId,
      purpose: "build",
      agentProfile: "claude_build",
      workspaceScope: repo,
      command: "claude",
      promptPath,
      jsonlOutputPath: `prompts/codex/${packetId}/output.jsonl`,
      finalMessagePath: `prompts/codex/${packetId}/final.md`,
      status: "packet_created",
      workItemId: workItem.id,
      executionProfileJson: JSON.stringify({ schema: "arcadia.execution/v1", profile: "routine_implementation" }),
      providerMappingId: "fixture-map",
      providerBindingId: "fixture-binding"
    });
    const approval = createReviewItem(db, {
      workItemId: workItem.id,
      projectId: project.id,
      codexInvocationId: packetId,
      decisionNeeded: "Approve the promoted build packet.",
      sourceInput: "fixture",
      proposedAction: "Launch the fixture Session.",
      resolvedIntent: "CodexPlanningArtifactAcceptance",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: [],
      context: {
        planningPromotion: {
          actionId: "define-contract",
          actionDocRef: "plan/copy-proof#define-contract",
          repoPath: repo,
          buildProfile: "claude_build",
          buildInvocationId: packetId,
          buildPacketPath: promptPath,
          buildPacketSha256: packetSha256(path.join(workspace, promptPath))
        }
      }
    });
    updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Fixture authority approved." });
  });
  return { root, repo, workspace, packetId, now: new Date("2026-08-30T12:34:56.000Z") };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function transitionRepo(name: string, slug: string, responsibility: "codex" | "requires_review", withPlan: boolean): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-transition-"));
  roots.push(repo);
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), `---
arcadia: v1
type: project
slug: ${slug}
name: ${name}
status: active
goal: Prove the next governed transition.
${withPlan ? "active_plan: transition\ncurrent_action: next-step\n" : ""}updated: 2026-08-30
---
\n# ${name}\n`);
  if (withPlan) {
    writeFileSync(path.join(repo, "docs", "plans", "transition.md"), `---
arcadia: v1
type: plan
slug: transition
project: ${slug}
status: active
milestone: Prove the transition
current_action: next-step
token_impact: medium
token_budget: One bounded pass.
updated: 2026-08-30
actions:
  - id: next-step
    title: Take the next step
    status: open
    responsibility: ${responsibility}
    clarification: clarified
    next_action: ${responsibility === "codex" ? "Build the bounded slice." : "Choose whether to proceed."}
    expected_artifact: A transition receipt
    acceptance_criteria:
      - The transition is explicit.
---
\n# Transition\n`);
  }
  return repo;
}

function expectArcadiaError(run: () => unknown, message: string) {
  try {
    run();
    throw new Error("Expected ArcadiaError");
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    expect((error as Error).message).toContain(message);
  }
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove Sessions.
active_plan: copy-proof
current_action: define-contract
updated: 2026-08-30
---

# Test Project
`;

const planDocument = `---
arcadia: v1
type: plan
slug: copy-proof
project: test-project
status: active
milestone: Prove the Session contract
current_action: define-contract
token_impact: medium
token_budget: One bounded Session; all checks are deterministic.
recommended_model: sonnet
recommended_reasoning_effort: high
updated: 2026-08-30
actions:
  - id: define-contract
    title: Define the contract
    status: open
    responsibility: codex
    effort: session
    clarification: clarified
    next_action: Define the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
    decisions: ["0001"]
---

# Copy proof
`;

const decisionDocument = `---
arcadia: v1
type: decision
id: "0001"
slug: authorize
project: test-project
status: approved
question: Authorize this fixture?
answer: Yes.
decided: 2026-08-30
updated: 2026-08-30
---

# Decision
`;
