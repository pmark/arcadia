import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { ArcadiaError, validationError } from "../src/cli/errors.js";
import { runGoCommand } from "../src/commands/go.js";
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
import { getRepositoryLease, launchPreparedSession, prepareSession, reserveAgentWorktree, sessionView, type TmuxAdapter } from "../src/sessions/index.js";
import { headlessClaudeAllowList } from "../src/sessions/headlessPermissions.js";
import { sessionLogPath, sessionSettingsPath, type SessionRecording } from "../src/sessions/sessionRecording.js";
import { launchGuardedHostSession, type GuardedLaunchResult } from "../src/sessions/launch.js";
import { buildLaunchPreview } from "../src/sessions/launchPreview.js";
import { getSessionContinuation, getSessionExitReceipt, reconcileSessionExit } from "../src/sessions/reconciliation.js";
import { setWorktreeLivenessProbeForTests, type WorktreeLiveness } from "../src/sessions/worktreeLiveness.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

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
  launches: Array<{ name: string; cwd: string; command: string; args: string[]; record?: SessionRecording }> = [];
  available() { return this.isAvailable; }
  hasSession(name: string) { return this.collision || this.live.has(name); }
  launch(input: { name: string; cwd: string; command: string; args: string[]; record?: SessionRecording }) {
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

  it("launches normally when the selected provider's sign-in check reports it signed in", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const signIn = () => ({ signedIn: true, remedy: "unused" });

    const result = doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, signIn);
    expect(result.reused).toBe(false);
    expect(result.session.status).toBe("running");
    expect(tmux.launches).toHaveLength(1);
  });

  it("refuses to launch a signed-out provider before reserving admission, a worktree, or the repository lease", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const signIn = (provider: string) => ({ signedIn: false, remedy: `Sign in to ${provider} on this worker.` });

    let caught: unknown;
    try {
      doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, signIn);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ArcadiaError);
    const error = caught as ArcadiaError;
    expect(error.message).toContain("Claude Code");
    expect(error.message).toContain("is not signed in for this worker");
    expect(error.message).toContain("Sign in to claude-code-cli on this worker.");
    expect(error.details).toMatchObject({ code: "provider_not_signed_in", conflict: true, provider: "claude-code-cli" });
    expect(tmux.launches).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
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
    expect(tmux.launches[0].command).toBe("env");
    expect(tmux.launches[0].args.slice(0, -1)).toEqual([
      "-u", "ARCADIA_OPERATOR_SCRIPT_ID", "-u", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR",
      "-u", "ARCADIA_REQUIRE_INLINE_WORKSPACE",
      "GIT_AUTHOR_NAME=Owen Swift",
      "GIT_AUTHOR_EMAIL=owen.swift@agents.arcadia.local",
      "GIT_COMMITTER_NAME=Owen Swift",
      "GIT_COMMITTER_EMAIL=owen.swift@agents.arcadia.local",
      expect.stringMatching(/^ARCADIA_SESSION_ID=session_/),
      "opencode",
      "run",
      "--model",
      // The packet binds deepseek (the plan's tier); the Session starts on the light model.
      "opencode-go/glm-5.3-flash",
      "--variant",
      "low"
    ]);
    expect(tmux.launches[0].args.at(-1)).toContain("Escalation target: opencode-go/deepseek-v4.1-flash");
    const brief = tmux.launches[0].args.at(-1)!;
    expect(brief).toContain("Action: define-contract");
    expect(brief).toContain("The contract exists.");
    expect(brief).toContain(`Candidate worktree: ${result.session.worktree_path}`);
    expect(brief).toContain("arcadia-preserve-broker-opencode");
    // opencode owns its native session id, so Arcadia never invents a resume.
    expect(result.session.provider_session_id).toBe(result.session.id);
    expect(sessionView(result.session, tmux).resumeCommand).toBeNull();
  });

  it("translates an abstract reasoning effort to the provider value at spawn", () => {
    for (const [provider, model, profileName, command, expected] of [
      ["codex-cli", "gpt-5.6-terra", "codex_build", "codex", ["--model", "gpt-6-luna", "--config", 'model_reasoning_effort="low"']],
      ["claude-code-cli", "sonnet", "claude_build", "claude", ["--model", "haiku", "--effort", "low"]]
    ] as const) {
      const fixture = preparedFixture({ provider, model, profileName, command, effort: "e3_deep" });
      const tmux = new FakeTmux();
      const preview = preview1(fixture);

      doLaunch(fixture, tmux, preview.previewFingerprint);
      expect(tmux.launches[0].args).toEqual(expect.arrayContaining([...expected]));
      expect(tmux.launches[0].args).not.toContain("e1_brief");
      expect(tmux.launches[0].args).not.toContain("e3_deep");
      // A fingerprint launch is headless like a standing-policy one: same builder, same flags.
      const args = tmux.launches[0].args;
      expect(args.slice(args.indexOf(command))).toEqual(
        command === "claude"
          ? expect.arrayContaining(["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--settings"])
          : expect.arrayContaining(["exec", "--json", "--sandbox", "workspace-write"])
      );
    }
  });

  it("pins no workspace in any provider's launch environment, sets no ARCADIA_REQUIRE_INLINE_WORKSPACE and unsets an inherited one", () => {
    // ARCADIA_REQUIRE_INLINE_WORKSPACE belongs only in a launch environment
    // that also pins ARCADIA_WORKSPACE (src/workspace/resolve.ts). None does:
    // a launched Session's own arcadia commands resolve the user config
    // default, which the mode would refuse. A launcher running with both
    // variables set passes neither on the `env` command line, and `env -u`
    // strips the mode the tmux server or launcher shell would hand down.
    const previousWorkspace = process.env.ARCADIA_WORKSPACE;
    const previousMode = process.env.ARCADIA_REQUIRE_INLINE_WORKSPACE;
    try {
      for (const [provider, model, profileName, command] of [
        ["codex-cli", "gpt-5.6-terra", "codex_build", "codex"],
        ["claude-code-cli", "sonnet", "claude_build", "claude"],
        ["opencode-cli", "opencode-go/deepseek-v4.1-flash", "opencode_build", "opencode"]
      ] as const) {
        const fixture = preparedFixture({ provider, model, profileName, command });
        const tmux = new FakeTmux();
        const preview = preview1(fixture);
        process.env.ARCADIA_WORKSPACE = fixture.workspace;
        process.env.ARCADIA_REQUIRE_INLINE_WORKSPACE = "1";
        try {
          doLaunch(fixture, tmux, preview.previewFingerprint);
        } finally {
          delete process.env.ARCADIA_WORKSPACE;
          delete process.env.ARCADIA_REQUIRE_INLINE_WORKSPACE;
        }
        expect(tmux.launches, provider).toHaveLength(1);
        const settings = tmux.launches[0].args.slice(0, -1);
        expect(settings, provider).toEqual(expect.arrayContaining([expect.stringMatching(/^GIT_AUTHOR_NAME=/)]));
        expect(settings.filter((arg) => /^ARCADIA_(WORKSPACE|REQUIRE_INLINE_WORKSPACE)=/.test(arg)), provider).toEqual([]);
        const unset = settings.indexOf("ARCADIA_REQUIRE_INLINE_WORKSPACE");
        expect(unset, provider).toBeGreaterThan(0);
        expect(settings[unset - 1], provider).toBe("-u");
        expect(settings, provider).not.toContain("ARCADIA_WORKSPACE");
        // The brief's Identity block tells the agent how to turn the mode on itself.
        expect(tmux.launches[0].args.at(-1), provider).toContain("ARCADIA_REQUIRE_INLINE_WORKSPACE=1");
      }
    } finally {
      if (previousWorkspace === undefined) delete process.env.ARCADIA_WORKSPACE; else process.env.ARCADIA_WORKSPACE = previousWorkspace;
      if (previousMode === undefined) delete process.env.ARCADIA_REQUIRE_INLINE_WORKSPACE; else process.env.ARCADIA_REQUIRE_INLINE_WORKSPACE = previousMode;
    }
  });

  it("applies the sign-in preflight before resuming a prepared Session whose process never started, not only a fresh launch", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const signedIn = () => ({ signedIn: true, remedy: "unused" });

    const first = doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, signedIn);
    expect(first.session.status).toBe("running");

    // Simulate a crash between the Session row's insert and its tmux spawn:
    // the row is still "prepared" and tmux no longer shows it live, so a
    // retry must resume it through `resumeOrReturn`, not treat it as fresh.
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE agent_sessions SET status = 'prepared' WHERE id = ?").run(first.session.id);
    });
    tmux.live.delete(first.session.tmux_session_name);

    const nowSignedOut = () => ({ signedIn: false, remedy: "Sign in to claude-code-cli on this worker." });
    let caught: unknown;
    try {
      doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, nowSignedOut);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ArcadiaError);
    expect((caught as ArcadiaError).details).toMatchObject({ code: "provider_not_signed_in", conflict: true });
    // The resume never re-spawned the process while signed out: still just the one launch from above.
    expect(tmux.launches).toHaveLength(1);
  });

  it("leaves a provider-native reasoning effort unchanged at spawn", () => {
    const fixture = preparedFixture({
      provider: "codex-cli",
      model: "gpt-5.6-terra",
      profileName: "codex_build",
      command: "codex",
      effort: "high"
    });
    const tmux = new FakeTmux();
    const preview = preview1(fixture);

    doLaunch(fixture, tmux, preview.previewFingerprint);
    // Smallest model first: the start tier's own effort, not the packet's provider-native one.
    expect(tmux.launches[0].args).toEqual(expect.arrayContaining(["--model", "gpt-6-luna", "--config", 'model_reasoning_effort="low"']));
  });

  it("translates an effort recomputed from an Action's execution requirement, not only a packet-verbatim value", () => {
    const fixture = preparedFixture({
      provider: "codex-cli",
      model: "gpt-6.1-sol",
      profileName: "codex_build",
      command: "codex",
      mappingId: "bundled-2026-07-25.1",
      bindingId: "codex-sol",
      executionRequirement: { schema: "arcadia.execution/v1", profile: "systems_change" }
    });

    const preview = preview1(fixture);
    expect(preview.ready).toBe(true);
    // systems_change resolves to an abstract key, which is the value the session
    // stores and the bound packet records — the spawn must not see it raw.
    expect(preview.selection).toMatchObject({ provider: "codex-cli", model: "gpt-6.1-sol", effort: "e3_deep" });

    const tmux = new FakeTmux();
    doLaunch(fixture, tmux, preview.previewFingerprint);
    expect(tmux.launches[0].args).toEqual(expect.arrayContaining(["--config", 'model_reasoning_effort="low"']));
    expect(tmux.launches[0].args).not.toContain("e3_deep");
  });

  it("translates an effort recomputed for a Claude-only selection", () => {
    const claudeOnlyProfiles = [profile("claude_build", "claude-code-cli")];
    const fixture = preparedFixture({
      provider: "claude-code-cli",
      model: "opus",
      profileName: "claude_build",
      command: "claude",
      mappingId: "bundled-2026-07-25.1",
      bindingId: "claude-opus",
      executionRequirement: { schema: "arcadia.execution/v1", profile: "systems_change" }
    });

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-claude-recompute",
        profiles: claudeOnlyProfiles,
        adapters
      })
    );
    expect(preview.ready).toBe(true);
    expect(preview.selection).toMatchObject({ provider: "claude-code-cli", model: "opus", effort: "e3_deep" });

    const tmux = new FakeTmux();
    const result = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-claude-recompute",
        previewFingerprint: preview.previewFingerprint,
        profiles: claudeOnlyProfiles,
        adapters,
        now: fixture.now,
        tmux,
        agentWorktreeRoot: path.join(fixture.root, "claude-recompute")
      })
    );
    expect(result.session.provider).toBe("claude-code-cli");
    expect(tmux.launches[0].args).toEqual(expect.arrayContaining(["--model", "haiku", "--effort", "low"]));
    expect(tmux.launches[0].args).not.toContain("e3_deep");
    // The headless settings let the Session spawn a subagent on the bigger model, and the brief says how.
    expect(JSON.parse(readFileSync(sessionSettingsPath(fixture.workspace, result.session.id), "utf8")).permissions.allow).toContain("Agent");
    expect(tmux.launches[0].args.at(-1)).toContain('Escalation target: sonnet.');
    expect(tmux.launches[0].args.at(-1)).toContain('spawn a subagent with the Agent tool and `model: "sonnet"`');
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

  it("records a per-launch time limit with the lease on a fresh launch, and applies it on the reused-lease path", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const launchWith = (timeLimitMs: number | undefined, requestId: string) =>
      withDatabase(fixture.workspace, (db) =>
        launchGuardedHostSession({
          db, workspace: fixture.workspace, repoRoot: fixture.repo, projectSlug: "test-project", requestId,
          previewFingerprint: preview.previewFingerprint, profiles, adapters, now: fixture.now, tmux,
          agentWorktreeRoot: path.join(fixture.root, "limit-wt"), timeLimitMs
        })
      );
    const first = launchWith(90_000, "req-1");
    expect(first.session.time_limit_ms).toBe(90_000);
    const stored = (id: string) => withReadOnlyDatabase(fixture.workspace, (db) => (db.prepare("SELECT time_limit_ms FROM agent_sessions WHERE id = ?").get(id) as { time_limit_ms: number | null }).time_limit_ms);
    expect(stored(first.session.id)).toBe(90_000);

    // A retry of the same request reuses the lease and carries the new override.
    const second = launchWith(45_000, "req-1");
    expect(second.reused).toBe(true);
    expect(second.session.id).toBe(first.session.id);
    expect(stored(first.session.id)).toBe(45_000);
    expect(() => launchWith(0, "req-1")).toThrow(/positive whole number/);
  });

  it("exposes --time-limit-minutes on `session launch` and refuses a non-positive value", () => {
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", path.resolve(import.meta.dirname, "../src/cli.ts"), ...args], { encoding: "utf8" });
    expect(run(["session", "launch", "--help"]).stdout).toContain("--time-limit-minutes");
    const bad = run(["session", "launch", "--request-id", "x", "--time-limit-minutes", "0"]);
    expect(bad.status).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).toContain("--time-limit-minutes must be a positive number");
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

  it("refuses an Action whose claim is older than 24 hours while its candidate is unmerged, and launches once it is abandoned (Issue #549)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const branch = "claude/define-contract-20260829T000000000Z";
    const candidate = path.join(fixture.root, "earlier-candidate");
    git(fixture.repo, ["worktree", "add", "-q", "-b", branch, candidate, "main"]);
    writeFileSync(path.join(candidate, "contract.md"), "the earlier dispatch's work\n");
    git(candidate, ["add", "contract.md"]);
    git(candidate, ["commit", "-qm", "earlier candidate"]);
    withDatabase(fixture.workspace, (db) => {
      reserveAgentWorktree(db, {
        repositoryPath: fixture.repo,
        worktreePath: candidate,
        branch,
        now: new Date(fixture.now.getTime() - 25 * 60 * 60 * 1000),
        project: "test-project",
        actionId: "define-contract"
      });
    });

    const preview = preview1(fixture);
    expectArcadiaError(
      () => doLaunch(fixture, tmux, preview.previewFingerprint),
      `candidate branch ${branch} is still unmerged`
    );
    expect(tmux.launches).toHaveLength(0);

    // Explicitly abandoned: the candidate's worktree and branch are removed.
    git(fixture.repo, ["worktree", "remove", "--force", candidate]);
    git(fixture.repo, ["branch", "-D", branch]);
    const launched = doLaunch(fixture, tmux, preview.previewFingerprint);
    expect(launched.session.action_id).toBe("define-contract");
    expect(tmux.launches).toHaveLength(1);
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

  it("refuses to start a prepared-but-never-launched lease once its Project declares no validation commands", () => {
    // CodeRabbit review on PR #647: `matchesPreview` (the lease-reuse guard
    // above) checks only project/Action/packet hash, not `preview.ready`, so
    // without this refusal a prepared-but-not-running lease would still be
    // handed to `resumeOrReturn` -- which calls `launchPreparedSession` and
    // starts a brand-new process -- even though the fresh preview built in
    // this same call already carries the "no validation commands" prerequisite.
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const result = doLaunch(fixture, tmux, preview.previewFingerprint);
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE agent_sessions SET status = 'prepared', started_at = NULL WHERE id = ?").run(result.session.id);
    });
    tmux.live.delete(result.session.tmux_session_name);
    tmux.launches.length = 0;

    withDatabase(fixture.workspace, (db) => {
      const project = upsertProject(db, { name: "Test Project", mission: "Prove guarded launch.", goal: "Prove guarded launch.", status: "active" });
      upsertProjectMetadata(db, { projectId: project.id, repoPath: fixture.repo, validationCommands: [] });
    });

    expectArcadiaError(
      () =>
        withDatabase(fixture.workspace, (db) =>
          launchGuardedHostSession({
            db,
            workspace: fixture.workspace,
            repoRoot: fixture.repo,
            projectSlug: "test-project",
            requestId: "recover-req-no-validation-commands",
            previewFingerprint: preview.previewFingerprint,
            profiles,
            adapters,
            now: fixture.now,
            tmux
          })
        ),
      "not ready to launch"
    );
    expect(tmux.launches).toHaveLength(0);

    const lease = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo));
    expect(lease?.id).toBe(result.session.id);
    expect(lease?.status).toBe("prepared");
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

  it("injects CLAUDE_CODE_OAUTH_TOKEN into a claude-code-cli launch from the workspace token file, never as a literal value on the command line", () => {
    const fixture = preparedFixture();
    writeTokenFile(fixture.workspace, "sk-ant-oat-secret-value");
    const tmux = new FakeTmux();
    const preview = preview1(fixture);

    doLaunch(fixture, tmux, preview.previewFingerprint);
    expect(tmux.launches).toHaveLength(1);
    const launch = tmux.launches[0];
    // The GIT_AUTHOR_*/GIT_COMMITTER_* identity vars are still literal `env`
    // arguments (they are not secret); everything after them is now wrapped
    // in a shell that reads the token file itself rather than a literal
    // "claude" argv, so the token value is never a process argument anywhere.
    expect(launch.command).toBe("env");
    expect(launch.args[11]).toBe("sh");
    expect(launch.args[12]).toBe("-c");
    const script = launch.args[13];
    expect(script).toContain("CLAUDE_CODE_OAUTH_TOKEN=");
    expect(script).toContain("cat");
    expect(script).toContain(getWorkspacePaths(fixture.workspace).claudeCodeTokenFile);
    expect(script).toContain("exec 'claude'");
    for (const arg of launch.args) {
      expect(arg).not.toContain("sk-ant-oat-secret-value");
    }
  });

  it("never injects the token for a codex-cli or opencode-cli launch, even when the workspace token file exists", () => {
    for (const [provider, model, profileName, command] of [
      ["codex-cli", "gpt-5.6-terra", "codex_build", "codex"],
      ["opencode-cli", "opencode-go/deepseek-v4.1-flash", "opencode_build", "opencode"]
    ] as const) {
      const fixture = preparedFixture({ provider, model, profileName, command });
      writeTokenFile(fixture.workspace, "sk-ant-oat-secret-value");
      const tmux = new FakeTmux();
      const preview = preview1(fixture);

      doLaunch(fixture, tmux, preview.previewFingerprint);
      expect(tmux.launches[0].command).toBe("env");
      expect(tmux.launches[0].args).not.toContain("sh");
      for (const arg of tmux.launches[0].args) {
        expect(arg).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
        expect(arg).not.toContain("sk-ant-oat-secret-value");
      }
    }
  });

  it("launches a claude-code-cli Session unchanged when no workspace token file exists", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);

    doLaunch(fixture, tmux, preview.previewFingerprint);
    expect(tmux.launches[0].command).toBe("env");
    expect(tmux.launches[0].args).not.toContain("sh");
    expect(tmux.launches[0].args[11]).toBe("claude");
    expect(tmux.launches[0].args).toContain("--session-id");
  });

  it("refuses to launch a claude-code-cli Session when the workspace token file fails its permission check", () => {
    const fixture = preparedFixture();
    const tokenFile = getWorkspacePaths(fixture.workspace).claudeCodeTokenFile;
    writeFileSync(tokenFile, "sk-ant-oat-secret-value");
    chmodSync(tokenFile, 0o644);
    const tmux = new FakeTmux();
    const preview = preview1(fixture);

    let caught: unknown;
    try {
      doLaunch(fixture, tmux, preview.previewFingerprint);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ArcadiaError);
    expect((caught as ArcadiaError).message).toContain("group or others");
    expect((caught as ArcadiaError).message).toContain("chmod 600");
    expect(tmux.launches).toHaveLength(0);
  });
});

function writeTokenFile(workspace: string, token: string): void {
  const tokenFile = getWorkspacePaths(workspace).claudeCodeTokenFile;
  writeFileSync(tokenFile, token);
  chmodSync(tokenFile, 0o600);
}

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

  it("releases a committed admission when the spawn fails after commitment, instead of leaking it (Issue #610)", () => {
    const fixture = preparedFixture();
    const failing = new FakeTmux();
    failing.failLaunch = true;
    activatePolicy(fixture);

    expectArcadiaError(() => doStandingLaunch(fixture, failing), "could not start");

    const admissions = withReadOnlyDatabase(fixture.workspace, (db) => listAdmissions(db));
    expect(admissions).toHaveLength(1);
    expect(admissions[0].status).toBe("released");
    expect(liveAdmissionCount(fixture)).toBe(0);
  });

  it("releases a reserved admission when worktree preparation fails, before any Session exists to release it later", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    expectArcadiaError(
      () =>
        doStandingLaunch(fixture, tmux, "policy-worktree-fail", undefined, {
          afterWorktreeCreatedBeforeReservationCommit: () => {
            throw validationError("simulated worktree preparation failure");
          }
        }),
      "simulated worktree preparation failure"
    );

    expect(tmux.launches).toHaveLength(0);
    expect(liveAdmissionCount(fixture)).toBe(0);
    const admission = withReadOnlyDatabase(fixture.workspace, (db) => listAdmissions(db)).find(
      (row) => row.requestId === "policy-worktree-fail:admission"
    );
    expect(admission?.status).toBe("released");
  });

  it("releases a reserved admission when prepareSession fails for a reason other than a lease race", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    expectArcadiaError(
      () =>
        doStandingLaunch(fixture, tmux, "policy-prepare-fail", undefined, {
          beforeSessionInsert: () => {
            throw validationError("simulated prepareSession failure");
          }
        }),
      "simulated prepareSession failure"
    );

    expect(tmux.launches).toHaveLength(0);
    expect(liveAdmissionCount(fixture)).toBe(0);
    const admission = withReadOnlyDatabase(fixture.workspace, (db) => listAdmissions(db)).find(
      (row) => row.requestId === "policy-prepare-fail:admission"
    );
    expect(admission?.status).toBe("released");
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
    expect(tmux.launches[0].command).toBe("env");
    expect(tmux.launches[0].args).toContain("opencode");

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

  it("refuses a provider with no Session adapter before it reserves an admission slot", () => {
    // This provider is in no adapter registry, so nothing refuses it during
    // preview; the Session-adapter guard is the only defense. It must fire
    // before `issueAdmission` reserves a slot it would never commit.
    const fixture = preparedFixture({
      provider: "mystery-cli",
      model: "mystery-model",
      profileName: "mystery_build",
      command: "mystery"
    });
    const tmux = new FakeTmux();
    activatePolicy(fixture, "policy-mystery-grant", mysteryScope);

    expectArcadiaError(
      () => doStandingLaunch(fixture, tmux, "mystery-req-1", undefined, undefined, fixtureCapacityObservation("mystery-cli")),
      'No Session launch adapter is registered for provider "mystery-cli"'
    );

    expect(tmux.launches).toHaveLength(0);
    const liveAdmissions = withReadOnlyDatabase(fixture.workspace, (db) =>
      listAdmissions(db).filter((row) => row.status === "issued" || row.status === "committed")
    );
    expect(liveAdmissions).toHaveLength(0);
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
    expect(liveAdmissionCount(fixture)).toBe(0);
  });

  it("releases the admission when the policy read fails at commit time, since that refusal fences nothing (CodeRabbit, PR #729)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    expectArcadiaError(
      () =>
        doStandingLaunch(fixture, tmux, "policy-unreadable-at-commit", undefined, {
          afterAdmissionIssuedBeforeCommit: () => {
            withDatabase(fixture.workspace, (db) => db.exec("DROP TABLE production_policy"));
          }
        }),
      "withdrew authorization"
    );

    expect(tmux.launches).toHaveLength(0);
    expect(liveAdmissionCount(fixture)).toBe(0);
  });

  it("resumes a dead-but-claimed worktree from a proven-terminal exit instead of refusing forever (Issue #695)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const first = doStandingLaunch(fixture, tmux, "policy-req-1");
    expect(first.reused).toBe(false);
    const worktreePath = first.session.worktree_path;
    const branch = first.session.branch;
    const tmuxSessionName = first.session.tmux_session_name;

    // The dead Session left real, uncommitted-turned-committed work behind --
    // this is exactly what must not be discarded.
    writeFileSync(path.join(worktreePath, "candidate-note.txt"), "unfinished work\n");
    git(worktreePath, ["add", "candidate-note.txt"]);
    git(worktreePath, ["commit", "-m", "wip: partial progress before the crash"]);

    // The provider process died: its tmux pane is gone, but nothing released
    // the worktree/Action claim.
    tmux.live.delete(tmuxSessionName);

    const reconciled = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: first.session.id, requestId: "reconcile-1", repoRoot: fixture.repo })
    );
    expect(reconciled.receipt.outcome).toBe("incomplete_resumable");
    expect(reconciled.receipt.lease_handoff).toBe(1);

    // Before the fix, this second tick attempt refused with
    // "already claimed by a live worktree" forever, because nothing released
    // the stale claim -- it must instead resume the same worktree/branch.
    const second = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "policy-req-2",
        standingPolicy: true,
        profiles,
        adapters,
        // A distinct clock tick, exactly like an ordinary next tick -- this
        // must not matter to which worktree gets resumed.
        now: new Date(fixture.now.getTime() + 1000),
        tmux,
        agentWorktreeRoot: path.join(fixture.root, "policy-req-2-unused"),
        capacityObservation: fixtureCapacityObservation()
      })
    );

    expect(second.reused).toBe(false);
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.session.worktree_path).toBe(worktreePath);
    expect(second.session.branch).toBe(branch);
    expect(second.session.status).toBe("running");
    expect(tmux.launches).toHaveLength(2);
    expect(tmux.launches[1].cwd).toBe(worktreePath);
    const resumedBrief = tmux.launches[1].args.at(-1)!;
    expect(tmux.launches[0].args.at(-1)).not.toContain("Continuation —");
    expect(resumedBrief).toContain("Continuation — this is a resumed Session");
    expect(resumedBrief).toContain(`Previous Session: ${first.session.id}`);
    expect(resumedBrief).toContain(reconciled.receipt.candidate_revision!);
    expect(resumedBrief).toContain("do not repeat a deliberate first-Session partial exit");
    expect(resumedBrief).toContain("The contract exists.");
    expect(() => withReadOnlyDatabase(fixture.workspace, (db) => getSessionContinuation(db,
      { ...second.session, action_id: "another-action" }))).toThrow(/does not match its candidate and Action/);



    // The resumed worktree's prior commit must survive untouched.
    expect(git(worktreePath, ["log", "-1", "--format=%s"]).trim()).toBe("wip: partial progress before the crash");

    const supersededReceipt = withReadOnlyDatabase(fixture.workspace, (db) => getSessionExitReceipt(db, first.session.id));
    expect(supersededReceipt?.superseded_by_session_id).toBe(second.session.id);

    // The resumed Session's own recorded `base_revision` must stay the
    // lineage's true starting point (the original base branch HEAD), not the
    // worktree's HEAD at resume time -- otherwise a resumed Session that
    // itself makes no further commits before dying again would be
    // misclassified as carrying no changes at all, losing the first Session's
    // real committed work (CodeRabbit, PR #696).
    expect(second.session.base_revision).toBe(first.session.base_revision);
    expect(second.session.base_revision).not.toBe(git(worktreePath, ["log", "-1", "--format=%H"]).trim());

    tmux.live.delete(second.session.tmux_session_name);
    const secondReconciled = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: second.session.id, requestId: "reconcile-2", repoRoot: fixture.repo })
    );
    expect(secondReconciled.receipt.outcome).toBe("incomplete_resumable");
    expect(secondReconciled.receipt.lease_handoff).toBe(1);
  });

  it("retries a resumed-but-never-launched prepared Session through resumeOrReturn without a false base-revision failure", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const first = doStandingLaunch(fixture, tmux, "policy-req-1");
    const worktreePath = first.session.worktree_path;

    writeFileSync(path.join(worktreePath, "candidate-note.txt"), "unfinished work\n");
    git(worktreePath, ["add", "candidate-note.txt"]);
    git(worktreePath, ["commit", "-m", "wip: partial progress before the crash"]);

    tmux.live.delete(first.session.tmux_session_name);
    withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: first.session.id, requestId: "reconcile-1", repoRoot: fixture.repo })
    );

    const second = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "policy-req-2",
        standingPolicy: true,
        profiles,
        adapters,
        now: new Date(fixture.now.getTime() + 1000),
        tmux,
        agentWorktreeRoot: path.join(fixture.root, "policy-req-2-unused"),
        capacityObservation: fixtureCapacityObservation()
      })
    );
    expect(second.session.worktree_path).toBe(worktreePath);
    expect(second.session.status).toBe("running");

    // Simulate this process dying between `prepareSession` committing the
    // resumed Session's row and `launchPreparedSession` ever running it --
    // the row is still "prepared" in substance, and tmux no longer shows it.
    // Before persisting `launch_revision`, a retry here reached
    // `resumeOrReturn` -> `launchPreparedSession`, which compared the
    // worktree's HEAD (carrying the first Session's real commit) against
    // `base_revision` (the original, older lineage baseline) and refused
    // with a false "base revision changed" -- while the original handoff was
    // already irreversibly superseded onto this exact Session, so nothing
    // could ever resume this candidate again (CodeRabbit, PR #696).
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE agent_sessions SET status = 'prepared' WHERE id = ?").run(second.session.id);
    });
    tmux.live.delete(second.session.tmux_session_name);

    const retryPreview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({ db, workspace: fixture.workspace, repoRoot: fixture.repo, projectSlug: "test-project", requestId: "policy-req-3", profiles, adapters, tmux })
    );
    const third = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "policy-req-3",
        standingPolicy: true,
        profiles,
        adapters,
        now: new Date(fixture.now.getTime() + 2000),
        tmux,
        agentWorktreeRoot: path.join(fixture.root, "policy-req-3-unused"),
        capacityObservation: fixtureCapacityObservation()
      })
    );
    expect(retryPreview.actionId).toBe("define-contract");
    expect(third.reused).toBe(true);
    expect(third.session.id).toBe(second.session.id);
    expect(third.session.status).toBe("running");
    expect(third.session.worktree_path).toBe(worktreePath);
    // Two real spawns so far (the resumed Session's original launch, then this
    // retry's actual re-spawn since its tmux pane was gone) plus the very
    // first, now-dead attempt: three total.
    expect(tmux.launches).toHaveLength(3);
    expect(tmux.launches[2].cwd).toBe(worktreePath);
    expect(git(worktreePath, ["log", "-1", "--format=%s"]).trim()).toBe("wip: partial progress before the crash");
  });

  it("releases a stale claim rather than resuming it when the claimed worktree is no longer valid Git state", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const first = doStandingLaunch(fixture, tmux, "policy-req-1");
    const worktreePath = first.session.worktree_path;
    const tmuxSessionName = first.session.tmux_session_name;

    writeFileSync(path.join(worktreePath, "candidate-note.txt"), "unfinished work\n");
    git(worktreePath, ["add", "candidate-note.txt"]);
    git(worktreePath, ["commit", "-m", "wip: partial progress before the crash"]);

    tmux.live.delete(tmuxSessionName);
    const reconciled = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: first.session.id, requestId: "reconcile-1", repoRoot: fixture.repo })
    );
    expect(reconciled.receipt.outcome).toBe("incomplete_resumable");

    // The worktree directory survives (so `existsSync` alone cannot tell), but
    // its Git metadata is gone -- e.g. its `.git` worktree link was corrupted
    // or the main checkout's `.git/worktrees` bookkeeping was lost. It must not
    // be resumed, and its stale claim must not be left stuck either.
    rmSync(path.join(worktreePath, ".git"), { force: true });

    const second = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "policy-req-2",
        standingPolicy: true,
        profiles,
        adapters,
        now: new Date(fixture.now.getTime() + 1000),
        tmux,
        agentWorktreeRoot: path.join(fixture.root, "policy-req-2"),
        capacityObservation: fixtureCapacityObservation()
      })
    );

    expect(second.reused).toBe(false);
    expect(second.session.worktree_path).not.toBe(worktreePath);
    expect(second.session.status).toBe("running");
    expect(tmux.launches).toHaveLength(2);
  });

  it("releases a stale claim rather than looping forever when the claimed worktree is gone outright", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const first = doStandingLaunch(fixture, tmux, "policy-req-1");
    const worktreePath = first.session.worktree_path;
    const tmuxSessionName = first.session.tmux_session_name;

    writeFileSync(path.join(worktreePath, "candidate-note.txt"), "unfinished work\n");
    git(worktreePath, ["add", "candidate-note.txt"]);
    git(worktreePath, ["commit", "-m", "wip: partial progress before the crash"]);

    tmux.live.delete(tmuxSessionName);
    const reconciled = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: first.session.id, requestId: "reconcile-1", repoRoot: fixture.repo })
    );
    expect(reconciled.receipt.outcome).toBe("incomplete_resumable");

    // The worktree directory is removed entirely, not merely corrupted. This
    // must not skip the stale-claim release the same way the corrupted-Git
    // case does not: `existsSync` being false is not itself a signal that
    // nothing needs releasing.
    rmSync(worktreePath, { recursive: true, force: true });

    const second = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "policy-req-2",
        standingPolicy: true,
        profiles,
        adapters,
        now: new Date(fixture.now.getTime() + 1000),
        tmux,
        agentWorktreeRoot: path.join(fixture.root, "policy-req-2"),
        capacityObservation: fixtureCapacityObservation()
      })
    );

    expect(second.reused).toBe(false);
    expect(second.session.worktree_path).not.toBe(worktreePath);
    expect(second.session.status).toBe("running");
    expect(tmux.launches).toHaveLength(2);
  });

  it("restores a resumed handoff for a later retry when the resume attempt itself fails before ever running", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const first = doStandingLaunch(fixture, tmux, "policy-req-1");
    const worktreePath = first.session.worktree_path;
    const branch = first.session.branch;
    const tmuxSessionName = first.session.tmux_session_name;

    writeFileSync(path.join(worktreePath, "candidate-note.txt"), "unfinished work\n");
    git(worktreePath, ["add", "candidate-note.txt"]);
    git(worktreePath, ["commit", "-m", "wip: partial progress before the crash"]);

    tmux.live.delete(tmuxSessionName);
    withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: first.session.id, requestId: "reconcile-1", repoRoot: fixture.repo })
    );

    // The resume attempt itself dies before ever reaching a real process --
    // this must not permanently lose the candidate: a resumed handoff that
    // `prepareSession` marked superseded onto this now-failed Session has to
    // become resumable again for the next tick.
    const failingTmux = new FakeTmux();
    failingTmux.failLaunch = true;
    let caught: unknown;
    try {
      withDatabase(fixture.workspace, (db) =>
        launchGuardedHostSession({
          db,
          workspace: fixture.workspace,
          repoRoot: fixture.repo,
          projectSlug: "test-project",
          requestId: "policy-req-2",
          standingPolicy: true,
          profiles,
          adapters,
          now: new Date(fixture.now.getTime() + 1000),
          tmux: failingTmux,
          agentWorktreeRoot: path.join(fixture.root, "policy-req-2-unused"),
          capacityObservation: fixtureCapacityObservation()
        })
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ArcadiaError);

    const restoredReceipt = withReadOnlyDatabase(fixture.workspace, (db) => getSessionExitReceipt(db, first.session.id));
    expect(restoredReceipt?.superseded_by_session_id).toBeNull();
    expect(restoredReceipt?.outcome).toBe("incomplete_resumable");

    // A third, working attempt must still resume the same original worktree.
    const workingTmux = new FakeTmux();
    const third = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "policy-req-3",
        standingPolicy: true,
        profiles,
        adapters,
        now: new Date(fixture.now.getTime() + 2000),
        tmux: workingTmux,
        agentWorktreeRoot: path.join(fixture.root, "policy-req-3-unused"),
        capacityObservation: fixtureCapacityObservation()
      })
    );
    expect(third.session.worktree_path).toBe(worktreePath);
    expect(third.session.branch).toBe(branch);
    expect(third.session.status).toBe("running");
    expect(git(worktreePath, ["log", "-1", "--format=%s"]).trim()).toBe("wip: partial progress before the crash");
  });
});

describe("a draft-only never-launched candidate: the managed tick agrees with arcadia go (Issue #884)", () => {
  // The host process probe is replaced so these tests never depend on lsof or
  // /proc; tests/worktree-liveness.test.ts exercises the real probe.
  let liveness: WorktreeLiveness = { ok: true, processes: [] };
  beforeEach(() => {
    liveness = { ok: true, processes: [] };
    setWorktreeLivenessProbeForTests(() => liveness);
  });
  afterEach(() => setWorktreeLivenessProbeForTests(null));

  function neverLaunchedCandidate(fixture: ReturnType<typeof preparedFixture>): { candidate: string; branch: string; draft: Buffer; draftPath: string } {
    const branch = "claude/define-contract-20260830T113456000Z";
    const candidate = path.join(realpathSync(fixture.root), "never-launched", "repo");
    git(fixture.repo, ["worktree", "add", "-q", "-b", branch, candidate, "main"]);
    withDatabase(fixture.workspace, (db) => reserveAgentWorktree(db, {
      repositoryPath: fixture.repo,
      worktreePath: candidate,
      branch,
      now: new Date(fixture.now.getTime() - 60 * 60 * 1000),
      project: "test-project",
      actionId: "define-contract"
    }));
    const draft = Buffer.from('{"agent_ask": "v1", "request_id": "parity-2026-08-30", "project": "test-project", "intent": "proposal"}\n');
    const draftPath = path.join(candidate, ".arcadia", "asks", "agent-ask-parity-2026-08-30.yaml");
    mkdirSync(path.dirname(draftPath), { recursive: true });
    writeFileSync(draftPath, draft);
    return { candidate, branch, draft, draftPath };
  }

  function goFor(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux) {
    return runGoCommand({
      repo: fixture.repo,
      source: fixture.repo,
      apply: true,
      agent: "claude",
      model: "sonnet",
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "go-unused"),
      now: fixture.now,
      tmux
    });
  }

  function claimRows(fixture: ReturnType<typeof preparedFixture>): number {
    return withReadOnlyDatabase(fixture.workspace, (db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM agent_worktree_reservations WHERE action_id = 'define-contract'").get() as { count: number }).count);
  }

  function worktreeCount(fixture: ReturnType<typeof preparedFixture>): number {
    return git(fixture.repo, ["worktree", "list", "--porcelain"]).split("\n").filter((line) => line.startsWith("worktree ")).length;
  }

  function handoutRoutes(fixture: ReturnType<typeof preparedFixture>): string[] {
    return withReadOnlyDatabase(fixture.workspace, (db) =>
      (db.prepare("SELECT resumed_route FROM candidate_draft_recoveries WHERE resumed_at IS NOT NULL").all() as Array<{ resumed_route: string }>)
        .map((row) => row.resumed_route));
  }

  it("lets the tick hand the candidate out once at its own tip, after which Go hands nothing out", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const { candidate, branch, draft, draftPath } = neverLaunchedCandidate(fixture);
    const tip = git(candidate, ["rev-parse", "HEAD"]).trim();

    const launched = doStandingLaunch(fixture, tmux, "policy-req-draft");
    const goError = captureArcadiaError(() => goFor(fixture, tmux));

    expect(launched.session.worktree_path).toBe(candidate);
    expect(launched.session.branch).toBe(branch);
    expect(launched.session.status).toBe("running");
    expect(launched.session.base_revision).toBe(tip);
    expect(tmux.launches).toHaveLength(1);
    expect(tmux.launches[0].cwd).toBe(candidate);
    expect(handoutRoutes(fixture)).toEqual(["tick"]);
    // The tick's Session now owns the candidate; Go hands nothing out again.
    expect(goError.message).toContain("A Session is already live for this repository");
    expect(goError.details?.worktreePath).toBe(candidate);
    expect(worktreeCount(fixture)).toBe(2);
    expect(claimRows(fixture)).toBe(1);
    expect(readFileSync(draftPath).equals(draft)).toBe(true);
    expect(git(fixture.repo, ["branch", "--list", "ask/recover-*"]).trim()).toBe("");
  });

  it("never launches into a candidate Go already handed out by hand, refusing with the same disposition", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const { candidate, branch, draft, draftPath } = neverLaunchedCandidate(fixture);

    const go = goFor(fixture, tmux).data;
    const launchError = captureArcadiaError(() => doStandingLaunch(fixture, tmux, "policy-req-after-go"));

    expect(go.nextWorktree?.path).toBe(candidate);
    expect(go.nextWorktree?.branch).toBe(branch);
    expect(launchError.message).toContain("holds only Agent Ask drafts");
    expect(launchError.details?.candidateKind).toBe("draft_only");
    const disposition = launchError.details?.disposition as { receiptId: string; handedOut: { receiptId: string; route: string } };
    expect(disposition.receiptId).toBe(go.draftRecovery!.requestId);
    expect(disposition.handedOut).toMatchObject({ receiptId: go.draftRecovery!.requestId, route: "go" });
    expect(tmux.launches).toHaveLength(0);
    expect(liveAdmissionCount(fixture)).toBe(0);
    expect(handoutRoutes(fixture)).toEqual(["go"]);
    expect(worktreeCount(fixture)).toBe(2);
    expect(claimRows(fixture)).toBe(1);
    expect(readFileSync(draftPath).equals(draft)).toBe(true);
  });

  it("refuses in both paths, handing nothing out and launching nothing, while a manual session still runs in the candidate", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    // Indistinguishable in the database from a fresh manual `go` handout whose
    // agent has just drafted an Ask: only the host process table tells.
    const { candidate, draft, draftPath } = neverLaunchedCandidate(fixture);
    liveness = { ok: true, processes: [{ pid: 31337, command: "claude", cwd: path.join(candidate, "src") }] };

    const launchError = captureArcadiaError(() => doStandingLaunch(fixture, tmux, "policy-req-live"));
    const goError = captureArcadiaError(() => goFor(fixture, tmux));

    for (const error of [launchError, goError]) {
      expect(error.message).toContain("holds only Agent Ask drafts");
      expect((error.details?.disposition as { blocker: string }).blocker).toContain("That session still appears to be running here: pid 31337 (claude)");
    }
    expect(tmux.launches).toHaveLength(0);
    expect(liveAdmissionCount(fixture)).toBe(0);
    expect(handoutRoutes(fixture)).toEqual([]);
    expect(worktreeCount(fixture)).toBe(2);
    expect(claimRows(fixture)).toBe(1);
    expect(readFileSync(draftPath).equals(draft)).toBe(true);
  });

  it("refuses the tick launch when the liveness probe cannot tell", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    neverLaunchedCandidate(fixture);
    liveness = { ok: false, error: "/proc could not be listed: EACCES" };

    const error = captureArcadiaError(() => doStandingLaunch(fixture, tmux, "policy-req-unknown"));

    expect((error.details?.disposition as { blocker: string }).blocker).toContain("Could not verify that no session is running in this worktree");
    expect(tmux.launches).toHaveLength(0);
    expect(handoutRoutes(fixture)).toEqual([]);
  });

  it("voids the handout when the launch fails before any Session row exists, so the next tick can hand it out", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const { candidate } = neverLaunchedCandidate(fixture);

    const failed = captureArcadiaError(() => doStandingLaunch(fixture, tmux, "policy-req-fail", undefined, {
      beforeSessionInsert: () => { throw validationError("synthetic Session insert failure"); }
    }));
    expect(failed.message).toContain("synthetic Session insert failure");
    expect(handoutRoutes(fixture)).toEqual([]);
    expect(liveAdmissionCount(fixture)).toBe(0);

    const retried = doStandingLaunch(fixture, tmux, "policy-req-retry");
    expect(retried.session.worktree_path).toBe(candidate);
    expect(tmux.launches).toHaveLength(1);
    expect(handoutRoutes(fixture)).toEqual(["tick"]);
    expect(worktreeCount(fixture)).toBe(2);
  });

  it("keeps the handout when a draft changes after the handout and before launch, so the next tick and Go refuse", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const { draftPath } = neverLaunchedCandidate(fixture);

    const mismatch = captureArcadiaError(() => doStandingLaunch(fixture, tmux, "policy-req-mismatch", undefined, {
      beforeDraftLaunchVerification: () => writeFileSync(draftPath, "edited by something we cannot see\n")
    }));
    expect(mismatch.message).toContain("holds only Agent Ask drafts");
    expect(handoutRoutes(fixture)).toEqual(["tick"]);
    expect(liveAdmissionCount(fixture)).toBe(0);

    const nextTick = captureArcadiaError(() => doStandingLaunch(fixture, tmux, "policy-req-after-mismatch"));
    const go = captureArcadiaError(() => goFor(fixture, tmux));
    for (const error of [nextTick, go]) {
      expect((error.details?.disposition as { handedOut: { route: string } | null }).handedOut?.route).toBe("tick");
    }
    expect(tmux.launches).toHaveLength(0);
    expect(handoutRoutes(fixture)).toEqual(["tick"]);
  });

  it("refuses a code-bearing candidate with the same reason and candidateKind in both paths, creating nothing", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const { candidate, draft, draftPath } = neverLaunchedCandidate(fixture);
    writeFileSync(path.join(candidate, "contract.md"), "real work\n");

    const goError = captureArcadiaError(() => goFor(fixture, tmux));
    const launchError = captureArcadiaError(() => doStandingLaunch(fixture, tmux, "policy-req-code"));

    expect(launchError.message).toBe(goError.message);
    expect(goError.message).toContain("already holds uncommitted changes");
    expect(launchError.details?.candidateKind).toBe("code_bearing");
    expect(goError.details?.candidateKind).toBe("code_bearing");
    expect(launchError.details?.worktreePath).toBe(goError.details?.worktreePath);
    expect(tmux.launches).toHaveLength(0);
    expect(liveAdmissionCount(fixture)).toBe(0);
    expect(worktreeCount(fixture)).toBe(2);
    expect(readFileSync(draftPath).equals(draft)).toBe(true);
  });
});

function captureArcadiaError(run: () => unknown): ArcadiaError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    return error as ArcadiaError;
  }
  throw new Error("Expected an ArcadiaError");
}

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

const mysteryScope: ProductionScope = normalizeProductionScope({
  intent: "Prove an unlaunchable provider never reserves an admission slot.",
  projects: ["test-project"],
  plans: ["test-project/copy-proof"],
  actions: ["test-project/define-contract"],
  providers: ["mystery-cli"],
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

function liveAdmissionCount(fixture: ReturnType<typeof preparedFixture>): number {
  return withReadOnlyDatabase(fixture.workspace, (db) =>
    listAdmissions(db).filter((row) => row.status === "issued" || row.status === "committed")
  ).length;
}

/**
 * A directory of stub provider executables, so the preflight runs against a
 * hermetic PATH instead of this host's real `claude` and `codex`. Each stub
 * prints the help text, sign-in verdict or exit code its options describe.
 */
function stubProviders(options: {
  claude?: { help?: string; loggedIn?: boolean } | false;
  codex?: { help?: string; loggedIn?: boolean } | false;
}): NodeJS.ProcessEnv {
  const bin = mkdtempSync(path.join(tmpdir(), "arcadia-stub-providers-"));
  roots.push(bin);
  const claudeHelp = "--print --output-format <format> --permission-mode <mode> --settings <file-or-json> --setting-sources <sources> --verbose";
  const codexHelp = "--json --sandbox <SANDBOX_MODE>";
  if (options.claude !== false) {
    const claude = options.claude ?? {};
    writeFileSync(path.join(bin, "claude"), [
      "#!/bin/sh",
      `if [ "$1" = "--help" ]; then printf '%s\\n' '${claude.help ?? claudeHelp}'; exit 0; fi`,
      `if [ "$1" = "auth" ]; then echo '{"loggedIn": ${claude.loggedIn === false ? "false" : "true"}}'; exit ${claude.loggedIn === false ? 1 : 0}; fi`,
      "exit 0"
    ].join("\n"));
    chmodSync(path.join(bin, "claude"), 0o755);
  }
  if (options.codex !== false && options.codex !== undefined) {
    const codex = options.codex;
    writeFileSync(path.join(bin, "codex"), [
      "#!/bin/sh",
      `if [ "$1" = "exec" ]; then printf '%s\\n' '${codex.help ?? codexHelp}'; exit 0; fi`,
      `if [ "$1" = "login" ]; then echo 'login status'; exit ${codex.loggedIn === false ? 1 : 0}; fi`,
      "exit 0"
    ].join("\n"));
    chmodSync(path.join(bin, "codex"), 0o755);
  }
  return { PATH: bin };
}

describe("launch preflight and headless permission posture", () => {
  function refusal(run: () => unknown): ArcadiaError {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      return error as ArcadiaError;
    }
    throw new Error("expected the launch to be refused");
  }

  function expectNothingReserved(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux) {
    expect(tmux.launches).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
    expect(existsSync(path.join(fixture.root, "req-1"))).toBe(false);
  }

  it("refuses with provider_binary_missing, before reserving anything, when the provider executable is not on PATH", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const error = refusal(() => doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, undefined, stubProviders({ claude: false })));
    expect(error.details).toMatchObject({ code: "provider_binary_missing", conflict: true, provider: "claude-code-cli", executable: "claude" });
    expect(error.message).toContain('"claude" executable was not found');
    expectNothingReserved(fixture, tmux);
  });

  it("refuses with permission_posture_missing when the installed claude cannot carry the headless flags", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const env = stubProviders({ claude: { help: "--print --output-format --permission-mode --verbose" } });
    const error = refusal(() => doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, undefined, env));
    expect(error.details).toMatchObject({ code: "permission_posture_missing", conflict: true, unsupportedFlags: ["--settings", "--setting-sources"] });
    expectNothingReserved(fixture, tmux);
  });

  it("refuses with provider_not_signed_in when Claude Code has neither a token file nor a login", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const env = stubProviders({ claude: { loggedIn: false } });
    const error = refusal(() => doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, undefined, env));
    expect(error.details).toMatchObject({ code: "provider_not_signed_in", conflict: true, provider: "claude-code-cli" });
    expectNothingReserved(fixture, tmux);
  });

  it("accepts a Claude Code token file as its auth, without consulting the login", () => {
    const fixture = preparedFixture();
    const tokenFile = getWorkspacePaths(fixture.workspace).claudeCodeTokenFile;
    writeFileSync(tokenFile, "stub-token\n", { mode: 0o600 });
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const env = stubProviders({ claude: { loggedIn: false } });
    expect(doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, undefined, env).session.status).toBe("running");
  });

  it("refuses a codex launch for a missing login or a missing sandbox flag, and launches when both are present", () => {
    const selection = { provider: "codex-cli", model: "gpt-5.6-terra", profileName: "codex_build", command: "codex" };

    const signedOut = preparedFixture(selection);
    const signedOutTmux = new FakeTmux();
    const signedOutError = refusal(() => doLaunch(signedOut, signedOutTmux, preview1(signedOut).previewFingerprint, "req-1", undefined, undefined, stubProviders({ codex: { loggedIn: false } })));
    expect(signedOutError.details).toMatchObject({ code: "provider_not_signed_in", provider: "codex-cli" });
    expectNothingReserved(signedOut, signedOutTmux);

    const noSandbox = preparedFixture(selection);
    const noSandboxTmux = new FakeTmux();
    const noSandboxError = refusal(() => doLaunch(noSandbox, noSandboxTmux, preview1(noSandbox).previewFingerprint, "req-1", undefined, undefined, stubProviders({ codex: { help: "--json" } })));
    expect(noSandboxError.details).toMatchObject({ code: "permission_posture_missing", unsupportedFlags: ["--sandbox"] });
    expectNothingReserved(noSandbox, noSandboxTmux);

    const missing = preparedFixture(selection);
    const missingTmux = new FakeTmux();
    const missingError = refusal(() => doLaunch(missing, missingTmux, preview1(missing).previewFingerprint, "req-1", undefined, undefined, stubProviders({ codex: false })));
    expect(missingError.details).toMatchObject({ code: "provider_binary_missing", executable: "codex" });

    const ready = preparedFixture(selection);
    const readyTmux = new FakeTmux();
    expect(doLaunch(ready, readyTmux, preview1(ready).previewFingerprint, "req-1", undefined, undefined, stubProviders({ codex: {} })).session.status).toBe("running");
    expect(readyTmux.launches[0].args).toEqual(expect.arrayContaining(["exec", "--json", "--sandbox", "workspace-write"]));
  });

  it("launches a ready Claude headless: the argv carries stream-json with --verbose and the per-Session settings file", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const preview = preview1(fixture);
    const result = doLaunch(fixture, tmux, preview.previewFingerprint, "req-1", undefined, undefined, stubProviders({ claude: {} }));

    const args = tmux.launches[0].args;
    const claude = args.indexOf("claude");
    const settingsFile = sessionSettingsPath(fixture.workspace, result.session.id);
    // `--setting-sources ""` keeps the operator's user settings and the worktree's own
    // (agent-editable) project settings from widening the per-Session allow list.
    expect(args.slice(claude, claude + 12)).toEqual([
      "claude", "--print", "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits", "--settings", settingsFile, "--setting-sources", "", "--model"
    ]);
    // Every headless launch is recorded; the pane keeps streaming the same output.
    expect(tmux.launches[0].record).toEqual({
      sessionId: result.session.id,
      logFile: sessionLogPath(fixture.workspace, result.session.id),
      databaseFile: getWorkspacePaths(fixture.workspace).databaseFile
    });
    expect(sessionView(result.session, tmux).reattachCommand).toBe(`tmux attach-session -t ${result.session.tmux_session_name}`);
  });

  it("allows only the Project's validation commands and `arcadia agent-ask draft`, in a workspace file no shared settings file feeds", () => {
    const fixture = preparedFixture();
    withDatabase(fixture.workspace, (db) => {
      const project = db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
      upsertProjectMetadata(db, {
        projectId: project.id,
        repoPath: fixture.repo,
        validationCommands: ["pnpm exec tsc --noEmit && pnpm lint", "node -e \"process.exit(0)\""]
      });
    });
    const tmux = new FakeTmux();
    const result = doLaunch(fixture, tmux, preview1(fixture).previewFingerprint, "req-1", undefined, undefined, stubProviders({ claude: {} }));

    const file = sessionSettingsPath(fixture.workspace, result.session.id);
    expect(file.startsWith(fixture.workspace + path.sep)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const settings = JSON.parse(readFileSync(file, "utf8"));
    expect(settings).toEqual({
      permissions: {
        defaultMode: "acceptEdits",
        allow: [
          "Bash(pnpm exec tsc --noEmit)",
          "Bash(pnpm lint)",
          "Bash(node -e \"process.exit\\(0\\)\")",
          "Bash(arcadia agent-ask draft:*)",
          "Bash(pnpm arcadia agent-ask draft:*)",
          "Agent"
        ]
      }
    });
    // Exactly that list: no commit, push, settle, broker or arbitrary shell.
  });

  it("escapes a literal star in a declared validation command so it can never become a wildcard or a :* prefix rule", () => {
    expect(headlessClaudeAllowList(["pnpm test:*", "node scripts/*.mjs", "echo (a)"])).toEqual([
      "Bash(pnpm test:\\*)",
      "Bash(node scripts/\\*.mjs)",
      "Bash(echo \\(a\\))",
      "Bash(arcadia agent-ask draft:*)",
      "Bash(pnpm arcadia agent-ask draft:*)",
      "Agent"
    ]);
  });

  it("go --launch is headless by default and the explicit --interactive opt-in keeps the TUI, unrecorded", () => {
    const headless = preparedFixture();
    const headlessTmux = new FakeTmux();
    const launched = doLaunch(headless, headlessTmux, preview1(headless).previewFingerprint, "req-1", undefined, undefined, stubProviders({ claude: {} }));

    // The same prepared Session, launched interactively by an operator at the terminal.
    const interactiveTmux = new FakeTmux();
    withDatabase(headless.workspace, (db) =>
      launchPreparedSession(db, launched.session, interactiveTmux, undefined, headless.workspace, { interactive: true })
    );
    const args = interactiveTmux.launches[0].args;
    expect(args).not.toContain("--print");
    expect(args).not.toContain("--output-format");
    expect(args).not.toContain("--settings");
    expect(interactiveTmux.launches[0].record).toBeUndefined();
    expect(headlessTmux.launches[0].record).toBeDefined();
  });
});

function doLaunch(
  fixture: ReturnType<typeof preparedFixture>,
  tmux: FakeTmux,
  previewFingerprint: string,
  requestId = "req-1",
  worktreeSuffix?: string,
  providerSignIn?: (provider: string) => { signedIn: boolean; remedy: string } | null,
  preflightEnv?: NodeJS.ProcessEnv
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
      agentWorktreeRoot: path.join(fixture.root, worktreeSuffix ?? requestId),
      providerSignIn,
      preflightEnv
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
  mappingId?: string;
  bindingId?: string;
  executionRequirement?: Record<string, unknown>;
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
  const mappingId = selection.mappingId ?? "fixture-map";
  const bindingId = selection.bindingId ?? "fixture-binding";
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove guarded launch.", goal: "Prove guarded launch.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo, validationCommands: ["node -e \"process.exit(0)\""] });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
    if (selection.executionRequirement) {
      db.prepare("UPDATE work_items SET execution_requirement_json = ? WHERE id = ?")
        .run(JSON.stringify(selection.executionRequirement), workItem.id);
    }
    const promptPath = `prompts/codex/${packetId}/prompt.md`;
    const baseRevision = git(repo, ["rev-parse", "HEAD"]).trim();
    mkdirSync(path.join(workspace, path.dirname(promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), "immutable build packet\n");
    writeFileSync(path.join(workspace, path.dirname(promptPath), "metadata.json"), JSON.stringify({
      invocationId: packetId,
      workItemId: workItem.id,
      promptPath,
      baseRevision,
      providerSelection: { provider, model, mappingId, bindingId, ...(selection.effort ? { effort: selection.effort } : {}) }
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
      providerMappingId: mappingId,
      providerBindingId: bindingId
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
