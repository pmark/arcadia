import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { ArcadiaError } from "../src/cli/errors.js";
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
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { getRepositoryLease, type TmuxAdapter } from "../src/sessions/index.js";
import { launchGuardedHostSession, type GuardedLaunchResult } from "../src/sessions/launch.js";
import { buildLaunchPreview } from "../src/sessions/launchPreview.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const profiles: CodingAgentProfile[] = [
  profile("codex_build", "codex-cli"),
  profile("claude_build", "claude-code-cli")
];
const adapters = defaultAdapters as ProviderAdapterRegistry;

class FakeTmux implements TmuxAdapter {
  isAvailable = true;
  collision = false;
  failLaunch = false;
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() { return this.isAvailable; }
  hasSession(name: string) { return this.collision || this.live.has(name); }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    if (this.failLaunch) throw new Error("synthetic spawn failure");
    this.launches.push(input);
    this.live.add(input.name);
  }
}

describe("launchGuardedHostSession", () => {
  it("resolves the repository, executable and arguments on the server and starts exactly one process", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);

    const result = doLaunch(fixture, tmux, preview.previewFingerprint);
    expect(result.reused).toBe(false);
    expect(result.session.status).toBe("running");
    expect(result.session.project_slug).toBe("test-project");
    expect(result.session.action_id).toBe("define-contract");
    expect(tmux.launches).toHaveLength(1);
  });

  it("rejects a stale or altered preview fingerprint for a brand-new launch", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();

    expectArcadiaError(
      () => doLaunch(fixture, tmux, "not-the-real-fingerprint"),
      "stale or was altered"
    );
    expect(tmux.launches).toHaveLength(0);
  });

  it("recovers a lost response: retrying the same approved request reuses the durable Session instead of starting a second one", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);

    const first = doLaunch(fixture, tmux, preview.previewFingerprint);
    expect(first.reused).toBe(false);

    // A second tab, or a retry after the first response was lost, replays the
    // exact same request id and (now-stale, since a lease now exists)
    // fingerprint. It must recover the first call's durable result rather
    // than erroring or starting a second process.
    const second = doLaunch(fixture, tmux, preview.previewFingerprint);
    expect(second.reused).toBe(true);
    expect(second.session.id).toBe(first.session.id);
    expect(tmux.launches).toHaveLength(1);
  });

  it("refuses a different Action while this repository already holds a lease", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();

    // A lease for a different Action/packet on this same canonical
    // repository, standing in for some other in-flight launch this request
    // did not originate.
    withDatabase(fixture.workspace, (db) => {
      const project = db.prepare("SELECT id FROM projects WHERE name = 'Test Project'").get() as { id: string };
      const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
      db.prepare(`INSERT INTO agent_sessions (
        id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id,
        packet_id, packet_path, packet_sha256, authorizing_decisions_json, execution_profile_json,
        provider_profile, provider, model, effort, provider_mapping_id, provider_binding_id,
        base_revision, branch, worktree_path, provider_session_id, display_name, terminal_transport,
        tmux_session_name, status, prepared_at, started_at, ended_at, exit_status, created_at, updated_at
      ) VALUES (
        'session_other_action', ?, 'test-project', ?, 'docs/plans/copy-proof.md', 'copy-proof',
        'some-other-action', ?, ?, 'prompts/other/prompt.md', ${"'" + "0".repeat(64) + "'"},
        '[]', NULL, 'claude_build', 'claude-code-cli', 'sonnet', 'high', 'fixture-map', 'fixture-binding',
        ${"'" + "1".repeat(40) + "'"}, 'claude/other', '/tmp/other-worktree', 'provider-session-other',
        'Other Action', 'tmux', 'arcadia-other-session', 'running', '2026-08-30T12:00:00.000Z',
        '2026-08-30T12:00:00.000Z', NULL, NULL, '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z'
      )`).run(project.id, realpathSync(fixture.repo), workItem.id, fixture.packetId);
    });
    tmux.live.add("arcadia-other-session");

    const preview = preview1(fixture, "req-1", tmux);
    expectArcadiaError(() => doLaunch(fixture, tmux, preview.previewFingerprint), "different Action");
    expect(tmux.launches).toHaveLength(0);
  });

  it("recovers a pre-spawn crash: a prepared-but-never-launched lease is resumed rather than left stuck", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);

    // Simulate the process dying after prepareSession's INSERT committed but
    // before launchPreparedSession ever called tmux.launch, by directly
    // stamping a matching "prepared" row via the real launch call and then
    // rewinding it to "prepared" as if the launch step never ran.
    const result = doLaunch(fixture, tmux, preview.previewFingerprint);
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE agent_sessions SET status = 'prepared', started_at = NULL WHERE id = ?").run(result.session.id);
    });
    tmux.live.delete(result.session.tmux_session_name);
    tmux.launches.length = 0;

    const recovered = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "recover-req",
        previewFingerprint: preview.previewFingerprint,
        profiles,
        adapters,
        now: fixture.now,
        tmux
      })
    );
    expect(recovered.reused).toBe(true);
    expect(recovered.session.id).toBe(result.session.id);
    expect(recovered.session.status).toBe("running");
    expect(tmux.launches).toHaveLength(1);

    const lease = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo));
    expect(lease?.id).toBe(result.session.id);
  });

  it("recovers a post-spawn crash: a failed spawn releases the lease so a fresh launch succeeds with exactly one live Session", () => {
    const fixture = preparedFixture();
    const failing = new FakeTmux();
    failing.failLaunch = true;
    const preview = preview1(fixture);

    expectArcadiaError(() => doLaunch(fixture, failing, preview.previewFingerprint), "could not start");
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();

    // The failed attempt released the lease. A fresh preview against the
    // unchanged Action reproduces the same fingerprint, and a real launch now
    // succeeds — proving at most one live conflicting execution across the
    // crash.
    const retryPreview = preview1(fixture, "retry-req");
    const working = new FakeTmux();
    const retried = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "retry-req",
        previewFingerprint: retryPreview.previewFingerprint,
        profiles,
        adapters,
        // A distinct clock tick avoids colliding with the failed attempt's
        // still-present worktree/branch (a spawn failure does not retire
        // them — matching the existing recorded behavior for a failed
        // launch); production requests are never this close in wall time.
        now: new Date(fixture.now.getTime() + 1000),
        tmux: working,
        agentWorktreeRoot: path.join(fixture.root, "retry-req")
      })
    );
    expect(retried.session.status).toBe("running");
    expect(working.launches).toHaveLength(1);
  });

  it("recovers a database-level lease race between the pre-check and insert without a second live Session", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();

    // Simulate a true concurrent race: a second caller's Session is inserted
    // (and running) after this call's own pre-check passed but before its
    // insert would run, by pre-seeding the lease immediately via a competing
    // real launch that this call did not know about.
    const racerPreview = preview1(fixture, "racer-req");
    const racer = doLaunch(fixture, tmux, racerPreview.previewFingerprint, "racer-req");

    const loserPreview = preview1(fixture, "loser-req");
    const result = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "loser-req",
        previewFingerprint: loserPreview.previewFingerprint,
        profiles,
        adapters,
        now: fixture.now,
        tmux,
        agentWorktreeRoot: path.join(fixture.root, "loser")
      })
    );
    expect(result.reused).toBe(true);
    expect(result.session.id).toBe(racer.session.id);
    expect(tmux.launches).toHaveLength(1);
  });
});

function doLaunch(
  fixture: ReturnType<typeof preparedFixture>,
  tmux: FakeTmux,
  previewFingerprint: string,
  requestId = "req-1",
  worktreeSuffix?: string
): GuardedLaunchResult {
  return withDatabase(fixture.workspace, (db) =>
    launchGuardedHostSession({
      db,
      workspace: fixture.workspace,
      repoRoot: fixture.repo,
      projectSlug: "test-project",
      requestId,
      previewFingerprint,
      profiles,
      adapters,
      now: fixture.now,
      tmux,
      agentWorktreeRoot: path.join(fixture.root, worktreeSuffix ?? requestId)
    })
  );
}

function preview1(fixture: ReturnType<typeof preparedFixture>, requestId = "req-1", tmux?: Pick<TmuxAdapter, "hasSession">) {
  return withReadOnlyDatabase(fixture.workspace, (db) =>
    buildLaunchPreview({
      db,
      workspace: fixture.workspace,
      repoRoot: fixture.repo,
      projectSlug: "test-project",
      requestId,
      profiles,
      adapters,
      tmux
    })
  );
}

function preparedFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-session-launch-"));
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
  const packetId = "codex_session_launch_fixture";
  const provider = "claude-code-cli";
  const model = "sonnet";
  const profileName = "claude_build";
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove guarded launch.", goal: "Prove guarded launch.", status: "active" });
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
      providerSelection: { provider, model, mappingId: "fixture-map", bindingId: "fixture-binding" }
    }));
    createCodexInvocation(db, {
      id: packetId,
      purpose: "build",
      agentProfile: profileName,
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
          buildProfile: profileName,
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

function profile(name: string, provider: string): CodingAgentProfile {
  return {
    name,
    provider,
    package: provider === "codex-cli" ? "@openai/codex" : "@anthropic-ai/claude-code",
    command: provider === "codex-cli" ? "codex" : "claude",
    purpose: "build",
    sandbox: "workspace-write",
    args: []
  };
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
goal: Prove guarded launch.
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
milestone: Prove the guarded launch contract
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
