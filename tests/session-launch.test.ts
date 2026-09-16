import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { ArcadiaError } from "../src/cli/errors.js";
import { openDatabase, withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import {
  createCodexInvocation,
  createReviewItem,
  getWorkItemByDocRef,
  upsertProject,
  upsertProjectMetadata,
  updateReviewItemStatus
} from "../src/db/repositories.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import {
  activateProduction,
  deactivateProduction,
  fingerprintProductionScope,
  listAdmissions,
  normalizeProductionScope,
  type ProductionScope
} from "../src/production/policy.js";
import { getRepositoryLease, prepareSession, sessionView, type TmuxAdapter } from "../src/sessions/index.js";
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

  it("launches the packet-selected opencode adapter headlessly with its reasoning variant", () => {
    const fixture = preparedFixture({
      provider: "opencode-cli",
      model: "opencode-go/deepseek-v4.1-flash",
      profileName: "opencode_build",
      command: "opencode",
      effort: "e3_deep"
    });
    const tmux = new FakeTmux();
    const preview = preview1(fixture);

    const result = doLaunch(fixture, tmux, preview.previewFingerprint);
    expect(result.session.provider).toBe("opencode-cli");
    expect(result.reused).toBe(false);
    expect(tmux.launches).toHaveLength(1);
    expect(tmux.launches[0]!.command).toBe("opencode");
    expect(tmux.launches[0]!.args).toEqual([
      "run",
      "--model",
      "opencode-go/deepseek-v4.1-flash",
      "--variant",
      "high",
      `arcadia advance --session ${result.session.id}`
    ]);
    // opencode owns its native session id, so Arcadia never invents a resume.
    expect(result.session.provider_session_id).toBe(result.session.id);
    expect(sessionView(result.session, tmux).resumeCommand).toBeNull();
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

  it("serializes prepareSession's own lease check against its insert so two truly concurrent callers grant only one lease", () => {
    const fixture = preparedFixture();
    const dispatch = resolveDispatch(fixture.repo, "test-project");
    const baseRevision = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    // Two independent connections to the same underlying database file, the
    // way two separate `arcadia go` processes would each open their own
    // connection. `db2` gets a short busy_timeout so an attempt that cannot
    // acquire the write lock fails fast instead of hanging the test.
    const db1 = openDatabase(fixture.workspace);
    const db2 = openDatabase(fixture.workspace);
    db2.pragma("busy_timeout = 50");

    const sharedSessionInput = (overrides: { db: typeof db1; branch: string; worktreeDir: string; tmux: TmuxAdapter }) => ({
      db: overrides.db,
      workspace: fixture.workspace,
      repoRoot: fixture.repo,
      dispatch,
      agent: "claude" as const,
      model: "sonnet",
      effort: "high",
      baseRevision,
      branch: overrides.branch,
      worktreePath: path.join(fixture.root, overrides.worktreeDir),
      now: fixture.now,
      tmux: overrides.tmux
    });

    try {
      let racerAttemptError: unknown = null;
      const first = prepareSession({
        ...sharedSessionInput({ db: db1, branch: "claude/racer", worktreeDir: "racer-worktree", tmux: new FakeTmux() }),
        testHooks: {
          afterChecksBeforeInsert: () => {
            // While `first`'s IMMEDIATE transaction still holds the write
            // lock (and has not yet inserted its row), a second connection
            // running the exact same check-then-write sequence must not be
            // able to observe the lease-free state this call already passed
            // through: it can only fail to even acquire the lock.
            try {
              prepareSession(
                sharedSessionInput({ db: db2, branch: "claude/loser", worktreeDir: "loser-worktree", tmux: new FakeTmux() })
              );
            } catch (error) {
              racerAttemptError = error;
            }
          }
        }
      });

      expect(racerAttemptError).not.toBeNull();
      expect(String((racerAttemptError as Error).message)).toMatch(/SQLITE_BUSY|database is locked/i);

      // Once `first` has committed, a fresh attempt on the same connection
      // now correctly observes the lease it raced against and is refused
      // rather than granted a second, competing one.
      expectArcadiaError(
        () =>
          prepareSession(
            sharedSessionInput({ db: db2, branch: "claude/loser-retry", worktreeDir: "loser-worktree-2", tmux: new FakeTmux() })
          ),
        "already has a prepared or running Session lease"
      );

      const sessions = db1
        .prepare("SELECT id FROM agent_sessions WHERE repository_path = ?")
        .all(realpathSync(fixture.repo)) as Array<{ id: string }>;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(first.id);
    } finally {
      db1.close();
      db2.close();
    }
  });

  it("rejects a launch that carries both an operator fingerprint and a standing-policy grant", () => {
    const fixture = preparedFixture();
    const preview = preview1(fixture);

    expect(() =>
      withDatabase(fixture.workspace, (db) =>
        launchGuardedHostSession({
          db,
          workspace: fixture.workspace,
          repoRoot: fixture.repo,
          projectSlug: "test-project",
          requestId: "both-req",
          previewFingerprint: preview.previewFingerprint,
          standingPolicy: true,
          profiles,
          adapters,
          now: fixture.now,
          tmux: new FakeTmux()
        })
      )
    ).toThrow(/may not carry both/);
  });

  it("rejects a launch that carries neither grant", () => {
    const fixture = preparedFixture();

    expect(() =>
      withDatabase(fixture.workspace, (db) =>
        launchGuardedHostSession({
          db,
          workspace: fixture.workspace,
          repoRoot: fixture.repo,
          projectSlug: "test-project",
          requestId: "neither-req",
          profiles,
          adapters,
          now: fixture.now,
          tmux: new FakeTmux()
        })
      )
    ).toThrow(/must carry either/);
  });
});

describe("launchGuardedHostSession under a standing managed-production policy grant", () => {
  it("launches with no operator-approved fingerprint, committing an epoch-bound admission receipt", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const result = doStandingLaunch(fixture, tmux);

    expect(result.reused).toBe(false);
    expect(result.session.status).toBe("running");
    expect(tmux.launches).toHaveLength(1);
    expect(result.admission).not.toBeNull();
    expect(result.admission?.status).toBe("committed");
    expect(result.admission?.actionKey).toBe("test-project/define-contract");

    const settled = withReadOnlyDatabase(fixture.workspace, (db) => listAdmissions(db)).find(
      (row) => row.id === result.admission?.id
    );
    expect(settled?.status).toBe("committed");
  });

  it("launches an opencode Session under a policy scoped to opencode-cli, then holds the lease guard", () => {
    const fixture = preparedFixture({
      provider: "opencode-cli",
      model: "opencode-go/deepseek-v4.1-flash",
      profileName: "opencode_build",
      command: "opencode",
      effort: "e3_deep"
    });
    const tmux = new FakeTmux();
    activatePolicy(fixture, "policy-opencode-grant", opencodeScope);

    const result = doStandingLaunch(fixture, tmux, "opencode-req-1", undefined, undefined, fixtureCapacityObservation("opencode-cli"));
    expect(result.reused).toBe(false);
    expect(result.session.provider).toBe("opencode-cli");
    expect(result.admission?.status).toBe("committed");
    expect(tmux.launches).toHaveLength(1);
    expect(tmux.launches[0]!.command).toBe("opencode");

    // The existing one-lease-per-repository guard is unchanged for opencode: a
    // second preparation against the same repository is refused.
    const dispatch = resolveDispatch(fixture.repo, "test-project");
    const baseRevision = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    expectArcadiaError(
      () =>
        withDatabase(fixture.workspace, (db) =>
          prepareSession({
            db,
            workspace: fixture.workspace,
            repoRoot: fixture.repo,
            dispatch,
            agent: "opencode",
            model: "opencode-go/deepseek-v4.1-flash",
            effort: "e3_deep",
            baseRevision,
            branch: "opencode/racer",
            worktreePath: path.join(fixture.root, "racer-worktree"),
            now: fixture.now,
            tmux
          })
        ),
      "already has a prepared or running Session lease"
    );
  });

  it("refuses a standing-policy launch while production is Inactive", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    // Production is never activated for this fixture.

    expectArcadiaError(() => doStandingLaunch(fixture, tmux), "refused this launch");
    expect(tmux.launches).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
  });

  it("rechecks Off immediately before launch commitment: a deactivation between admission and commit starts no process", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    expectArcadiaError(
      () =>
        doStandingLaunch(fixture, tmux, "policy-off-race", undefined, {
          afterAdmissionIssuedBeforeCommit: () => {
            withDatabase(fixture.workspace, (db) => deactivateProduction(db, { requestId: "off-mid-launch" }));
          }
        }),
      "withdrew authorization"
    );

    expect(tmux.launches).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();

    const admission = withReadOnlyDatabase(fixture.workspace, (db) => listAdmissions(db)).find(
      (row) => row.requestId === "policy-off-race:admission"
    );
    expect(admission?.status).toBe("fenced");
    expect(admission?.fencedReason).toBe("production_off");
  });
});

const productionScope: ProductionScope = normalizeProductionScope({
  intent: "Prove the standing-policy launch path.",
  projects: ["test-project"],
  plans: ["test-project/copy-proof"],
  actions: ["test-project/define-contract"],
  providers: ["claude-code-cli"],
  maxConcurrentSessions: 1,
  mechanicalTransitions: []
});

const opencodeScope: ProductionScope = normalizeProductionScope({
  intent: "Prove the standing-policy opencode launch path.",
  projects: ["test-project"],
  plans: ["test-project/copy-proof"],
  actions: ["test-project/define-contract"],
  providers: ["opencode-cli"],
  maxConcurrentSessions: 1,
  mechanicalTransitions: []
});

function activatePolicy(
  fixture: ReturnType<typeof preparedFixture>,
  requestId = "policy-grant-1",
  scope: ProductionScope = productionScope
) {
  return withDatabase(fixture.workspace, (db) =>
    activateProduction(db, {
      requestId,
      scope,
      scopeFingerprint: fingerprintProductionScope(scope),
      grantedBy: "operator"
    })
  );
}

function provenCapacity(providerId = "claude-code-cli"): CapacityAdmissionDecision {
  return {
    providerId,
    admitted: true,
    code: null,
    reason: `${providerId} reported included allowance.`,
    unattendedProof: true,
    retryAfter: null,
    refreshRequired: false,
    receipt: {
      version: 1,
      providerId,
      providerLabel: providerId,
      profiles: [],
      accountScope: "test",
      source: "codex_app_server",
      evidence: "simulated",
      unattended: true,
      observedAt: "2026-08-30T12:00:00.000Z",
      observedAgeMs: 0,
      expiresAt: null,
      confidence: "observed",
      freshness: "fresh",
      usagePolicy: "included",
      usagePolicyReason: "test fixture",
      windows: [{ label: "5h", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
      nextResetAt: null,
      unsupported: [],
      availability: "available",
      telemetry: "test fixture"
    }
  };
}

function fixtureCapacityObservation(providerId = "claude-code-cli"): ProviderCapacityObservation {
  return { generatedAt: "2026-08-30T12:34:56.000Z", providers: [provenCapacity(providerId)] };
}

function doStandingLaunch(
  fixture: ReturnType<typeof preparedFixture>,
  tmux: FakeTmux,
  requestId = "policy-req-1",
  worktreeSuffix?: string,
  testHooks?: Parameters<typeof launchGuardedHostSession>[0]["testHooks"],
  capacityObservation: ProviderCapacityObservation = fixtureCapacityObservation()
): GuardedLaunchResult {
  return withDatabase(fixture.workspace, (db) =>
    launchGuardedHostSession({
      db,
      workspace: fixture.workspace,
      repoRoot: fixture.repo,
      projectSlug: "test-project",
      requestId,
      standingPolicy: true,
      profiles,
      adapters,
      now: fixture.now,
      tmux,
      agentWorktreeRoot: path.join(fixture.root, worktreeSuffix ?? requestId),
      capacityObservation,
      testHooks
    })
  );
}

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

interface FixtureSelection {
  provider: string;
  model: string;
  profileName: string;
  command: string;
  effort?: string;
}

const CLAUDE_SELECTION: FixtureSelection = {
  provider: "claude-code-cli",
  model: "sonnet",
  profileName: "claude_build",
  command: "claude"
};

function preparedFixture(selection: FixtureSelection = CLAUDE_SELECTION) {
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
  const { provider, model, profileName } = selection;
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
      providerSelection: { provider, model, mappingId: "fixture-map", bindingId: "fixture-binding", ...(selection.effort ? { effort: selection.effort } : {}) }
    }));
    createCodexInvocation(db, {
      id: packetId,
      purpose: "build",
      agentProfile: profileName,
      workspaceScope: repo,
      command: selection.command,
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
