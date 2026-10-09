import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
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
import { resolveDispatch } from "../src/docs/dispatch.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import {
  activateProduction,
  fingerprintProductionScope,
  normalizeProductionScope,
  type ProductionScope
} from "../src/production/policy.js";
import { observeSessionActivity } from "../src/production/stallDetection.js";
import {
  FIXTURE_EDIT_FILE,
  FIXTURE_PROVIDER,
  applyFixtureExitStatus,
  fixtureModelFor,
  getSession,
  prepareSession,
  sessionAgentForProvider,
  SESSION_AGENTS,
  launchPreparedSession,
  systemTmux,
  type FixtureOutcome,
  type TmuxAdapter
} from "../src/sessions/index.js";
import { launchGuardedHostSession, type GuardedLaunchResult } from "../src/sessions/launch.js";
import { findExecutable } from "../src/sessions/launchPreflight.js";
import { reconcileSessionExit } from "../src/sessions/reconciliation.js";
import { sessionLogPath, sessionRecordingFor, wrapRecordedLaunch, type SessionRecording } from "../src/sessions/sessionRecording.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class FakeTmux implements TmuxAdapter {
  isAvailable = true;
  collision = false;
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  panes = new Map<string, string>();
  available() { return this.isAvailable; }
  hasSession(name: string) { return this.collision || this.live.has(name); }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    this.launches.push(input);
    this.live.add(input.name);
  }
  capturePane(name: string) { return this.panes.get(name) ?? ""; }
}

describe("fixture-cli coding agent", () => {
  it("resolves a Session adapter for fixture-cli, even though it is not a broker-launchable SessionAgent", () => {
    expect(sessionAgentForProvider(FIXTURE_PROVIDER)).toBe("fixture");
    // Never leaks into the operator-facing `arcadia go --agent` / go-broker
    // surface: those enumerate SESSION_AGENTS, which stays codex/claude/opencode.
    expect(SESSION_AGENTS as readonly string[]).not.toContain("fixture");
  });

  it("launches through the same tmux path as a real provider, carrying the configured outcome and duration", () => {
    const fixture = preparedFixture("completed", "3");
    const tmux = new FakeTmux();
    const session = prepareFixtureSession(fixture, tmux);
    const launched = withDatabase(fixture.workspace, (db) =>
      launchPreparedSession(db, session, tmux, undefined, fixture.workspace)
    );

    expect(launched.status).toBe("running");
    expect(launched.is_simulated).toBe(1);
    expect(tmux.launches).toHaveLength(1);
    const launch = tmux.launches[0];
    // Never wrapped in the Git-identity `env` prefix real providers get: this
    // process is not a real agent.
    expect(launch.command).toBe("env");
    expect(launch.args.slice(0, 8)).toEqual([
      "-u", "ARCADIA_OPERATOR_SCRIPT_ID", "-u", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR",
      "-u", "ARCADIA_REQUIRE_INLINE_WORKSPACE", expect.stringMatching(/^ARCADIA_SESSION_ID=session_/), "node"
    ]);
    expect(launch.args).toContain("--outcome");
    expect(launch.args[launch.args.indexOf("--outcome") + 1]).toBe("completed");
    expect(launch.args).toContain("--duration");
    expect(launch.args[launch.args.indexOf("--duration") + 1]).toBe("3");
    expect(launch.args).toContain("--file");
    expect(launch.args[launch.args.indexOf("--file") + 1]).toBe(FIXTURE_EDIT_FILE);
    expect(launch.args).toContain("--worktree");
    expect(launch.args[launch.args.indexOf("--worktree") + 1]).toBe(launched.worktree_path);
  });

  it("adds --db only for the failed outcome, which is the one case that must self-report", () => {
    const completedFixture = preparedFixture("completed", "0");
    const completedTmux = new FakeTmux();
    const completedSession = prepareFixtureSession(completedFixture, completedTmux);
    withDatabase(completedFixture.workspace, (db) => launchPreparedSession(db, completedSession, completedTmux, undefined, completedFixture.workspace));
    expect(completedTmux.launches[0].args).not.toContain("--db");

    const failedFixture = preparedFixture("failed", "0");
    const failedTmux = new FakeTmux();
    const failedSession = prepareFixtureSession(failedFixture, failedTmux);
    withDatabase(failedFixture.workspace, (db) => launchPreparedSession(db, failedSession, failedTmux, undefined, failedFixture.workspace));
    expect(failedTmux.launches[0].args).toContain("--db");
    expect(failedTmux.launches[0].args[failedTmux.launches[0].args.indexOf("--db") + 1])
      .toBe(getWorkspacePaths(failedFixture.workspace).databaseFile);
  });

  it("marks the Session and its exit receipt simulated, and a real (non-fixture) Session's receipt is not", () => {
    const fixture = preparedFixture("completed", "0");
    const tmux = new FakeTmux();
    const session = prepareFixtureSession(fixture, tmux);
    withDatabase(fixture.workspace, (db) => launchPreparedSession(db, session, tmux, undefined, fixture.workspace));
    tmux.live.delete(session.tmux_session_name);
    // Simulate exactly what the real script does for "completed": edit and commit.
    writeFileSync(path.join(session.worktree_path, FIXTURE_EDIT_FILE), "fixture session completed\n");
    git(session.worktree_path, ["add", FIXTURE_EDIT_FILE]);
    git(session.worktree_path, ["commit", "-m", "fixture: simulated completion"]);

    const reconciled = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: session.id, requestId: "reconcile-completed", repoRoot: fixture.repo })
    );
    expect(reconciled.receipt.is_simulated).toBe(1);
    expect(reconciled.receipt.outcome).toBe("incomplete_resumable");
  });

  it("reaches failed_execution for the failed outcome via its narrowly-gated self-report, never touching a real Session", () => {
    const fixture = preparedFixture("failed", "0");
    const tmux = new FakeTmux();
    const session = prepareFixtureSession(fixture, tmux);
    withDatabase(fixture.workspace, (db) => launchPreparedSession(db, session, tmux, undefined, fixture.workspace));
    tmux.live.delete(session.tmux_session_name);

    withDatabase(fixture.workspace, (db) => applyFixtureExitStatus(db, session.id, 1));

    const reconciled = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: session.id, requestId: "reconcile-failed", repoRoot: fixture.repo })
    );
    expect(reconciled.receipt.outcome).toBe("failed_execution");
    expect(reconciled.receipt.is_simulated).toBe(1);
  });

  it("reaches missing_evidence for the crashed outcome, which never self-reports anything", () => {
    const fixture = preparedFixture("crashed", "0");
    const tmux = new FakeTmux();
    const session = prepareFixtureSession(fixture, tmux);
    withDatabase(fixture.workspace, (db) => launchPreparedSession(db, session, tmux, undefined, fixture.workspace));
    tmux.live.delete(session.tmux_session_name);

    const reconciled = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId: session.id, requestId: "reconcile-crashed", repoRoot: fixture.repo })
    );
    expect(reconciled.receipt.outcome).toBe("missing_evidence");
  });

  it("refuses applyFixtureExitStatus against a Session that is not a simulated fixture-cli Session", () => {
    const fixture = preparedFixture("completed", "0", { provider: "claude-code-cli", model: "sonnet", profileName: "claude_build", command: "claude" });
    const tmux = new FakeTmux();
    const dispatch = resolveDispatch(fixture.repo, "test-project");
    const baseRevision = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const worktreePath = path.join(fixture.root, "real-worktree");
    git(fixture.repo, ["worktree", "add", "-b", "claude/real", worktreePath, "HEAD"]);
    const session = withDatabase(fixture.workspace, (db) =>
      prepareSession({
        db, workspace: fixture.workspace, repoRoot: fixture.repo, dispatch,
        agent: "claude", model: "sonnet", effort: null, baseRevision,
        branch: "claude/real", worktreePath,
        now: fixture.now, tmux
      })
    );
    expect(session.is_simulated).toBe(0);

    expect(() => withDatabase(fixture.workspace, (db) => applyFixtureExitStatus(db, session.id, 1)))
      .toThrow(/not a simulated fixture-cli Session/);
  });

  it("is flagged stalled by the existing stall-detection machinery once the deadline passes with no pane or Run activity", () => {
    const fixture = preparedFixture("stalled", "0");
    const tmux = new FakeTmux();
    const session = prepareFixtureSession(fixture, tmux);
    const launched = withDatabase(fixture.workspace, (db) => launchPreparedSession(db, session, tmux, undefined, fixture.workspace));
    tmux.panes.set(launched.tmux_session_name, "");

    withDatabase(fixture.workspace, (db) => {
      const baseline = getSession(db, launched.id)!;
      observeSessionActivity(db, baseline, tmux, fixture.now, 60_000);
    });
    const later = new Date(fixture.now.getTime() + 61_000);
    const observation = withDatabase(fixture.workspace, (db) => {
      const current = getSession(db, launched.id)!;
      return observeSessionActivity(db, current, tmux, later, 60_000);
    });

    expect(observation.newlyStalled).toBe(true);
    expect(observation.stalled).toBe(true);
  });

  it("admits a fixture launch under a standing policy that names fixture-cli in its scope", () => {
    const fixture = preparedFixture("completed", "0");
    const tmux = new FakeTmux();
    activatePolicy(fixture, "policy-fixture-grant", fixtureScope);

    const result = doStandingFixtureLaunch(fixture, tmux);
    expect(result.reused).toBe(false);
    expect(result.session.provider).toBe(FIXTURE_PROVIDER);
    expect(result.session.is_simulated).toBe(1);
    expect(result.admission?.status).toBe("committed");
  });

  it("refuses a standing-policy fixture launch when the scope does not name fixture-cli, before reserving a slot", () => {
    const fixture = preparedFixture("completed", "0");
    const tmux = new FakeTmux();
    activatePolicy(fixture, "policy-no-fixture-grant", noFixtureScope);

    let caught: unknown;
    try {
      doStandingFixtureLaunch(fixture, tmux, "no-fixture-req-1");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ArcadiaError);
    const error = caught as ArcadiaError;
    expect(error.details).toMatchObject({ code: "provider_not_permitted" });
    expect(tmux.launches).toHaveLength(0);
  });
});

describe("the fixture script itself (scripts/fixture-coding-agent.mjs)", () => {
  it("edits and commits the declared file under a fixed, visibly-fake identity for the completed outcome", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-fixture-script-"));
    roots.push(root);
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "arcadia@example.test"]);
    git(root, ["config", "user.name", "Arcadia Test"]);
    writeFileSync(path.join(root, "README.md"), "seed\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "initial"]);

    runFixtureScript(["--worktree", root, "--file", FIXTURE_EDIT_FILE, "--duration", "0", "--outcome", "completed", "--session-id", "session_test"]);

    expect(readFileSync(path.join(root, FIXTURE_EDIT_FILE), "utf8")).toContain("session_test");
    expect(git(root, ["log", "-1", "--format=%an <%ae>"]).trim()).toBe("Arcadia Fixture <fixture@agents.arcadia.local>");
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("self-reports its configured exit status for the failed outcome, gated to a simulated fixture-cli Session", () => {
    const fixture = preparedFixture("failed", "0");
    const tmux = new FakeTmux();
    const session = prepareFixtureSession(fixture, tmux);
    const dbPath = getWorkspacePaths(fixture.workspace).databaseFile;

    let caught: { status: number | null } | undefined;
    try {
      runFixtureScript(["--worktree", session.worktree_path, "--file", FIXTURE_EDIT_FILE, "--duration", "0", "--outcome", "failed", "--session-id", session.id, "--db", dbPath]);
    } catch (error) {
      caught = error as { status: number | null };
    }
    expect(caught?.status).toBe(1);

    const updated = withReadOnlyDatabase(fixture.workspace, (db) => getSession(db, session.id));
    expect(updated?.exit_status).toBe(1);
    // A "failed" launch never touches the worktree.
    expect(git(session.worktree_path, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("dies to SIGKILL mid-line for the crashed outcome without touching the worktree or the database", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-fixture-script-crash-"));
    roots.push(root);
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "arcadia@example.test"]);
    git(root, ["config", "user.name", "Arcadia Test"]);
    writeFileSync(path.join(root, "README.md"), "seed\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "initial"]);

    let caught: { status: number | null; signal?: string | null; stdout?: string } | undefined;
    try {
      runFixtureScript(["--worktree", root, "--file", FIXTURE_EDIT_FILE, "--duration", "0", "--outcome", "crashed", "--session-id", "session_test"]);
    } catch (error) {
      caught = error as { status: number | null; signal?: string | null; stdout?: string };
    }
    expect(caught?.status).toBeNull();
    expect(caught?.signal).toBe("SIGKILL");
    // It was writing when it died: the output ends mid-line.
    expect(String(caught?.stdout)).toContain("was writing when it cra");
    expect(String(caught?.stdout).endsWith("\n")).toBe(false);
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
  });
});

/**
 * Runs the launch the way `systemTmux.launch` hands it to tmux -- through the
 * real recording wrapper (`wrapRecordedLaunch`) -- but as a plain synchronous
 * child process, so the wrapper, the fixture agent and the exit recorder are
 * exercised for real on every machine, tmux or not.
 */
class WrapperRunTmux extends FakeTmux {
  runs: Array<{ status: number | null; signal: string | null }> = [];
  launch(input: { name: string; cwd: string; command: string; args: string[]; record?: SessionRecording }) {
    super.launch(input);
    const run = input.record ? wrapRecordedLaunch(input, input.record) : input;
    const result = spawnSync(run.command, run.args, { cwd: input.cwd, encoding: "utf8" });
    this.runs.push({ status: result.status, signal: result.signal });
  }
}

function exitStatusOf(workspace: string, sessionId: string): number | null {
  return withDatabase(workspace, (db) => getSession(db, sessionId)!.exit_status);
}

function launchedFixture(outcome: FixtureOutcome, tmux: WrapperRunTmux) {
  const fixture = preparedFixture(outcome, "0");
  const session = prepareFixtureSession(fixture, tmux);
  withDatabase(fixture.workspace, (db) => launchPreparedSession(db, session, tmux, undefined, fixture.workspace));
  return { fixture, session, log: sessionLogPath(fixture.workspace, session.id) };
}

describe("headless fixture-cli launch records its output and exit through the real wrapper", () => {
  it("a clean exit records exit_status 0 and leaves the Session log, outside the repository", () => {
    const tmux = new WrapperRunTmux();
    const { fixture, session, log } = launchedFixture("completed", tmux);

    expect(exitStatusOf(fixture.workspace, session.id)).toBe(0);
    expect(tmux.runs).toEqual([{ status: 0, signal: null }]);
    const text = readFileSync(log, "utf8");
    expect(text).toContain(`fixture session ${session.id} started (completed)`);
    expect(text).toContain(`fixture session ${session.id} completed`);
    expect(text).toContain("arcadia: provider exited with status 0");
    // Named by session id, under the workspace, never in the repository or the candidate worktree.
    expect(path.basename(log)).toBe(`${session.id}.log`);
    expect(log.startsWith(fixture.workspace + path.sep)).toBe(true);
    expect(log.startsWith(fixture.repo + path.sep)).toBe(false);
    expect(log.startsWith(session.worktree_path + path.sep)).toBe(false);
    expect(existsSync(`${log}.status`)).toBe(false);
    // The log can hold briefs and tool output: owner-only.
    expect(statSync(log).mode & 0o777).toBe(0o600);
  });

  it("a non-zero exit records the provider's exit code, and stdout and stderr both reach the log", () => {
    const tmux = new WrapperRunTmux();
    const { fixture, session, log } = launchedFixture("failed", tmux);
    expect(exitStatusOf(fixture.workspace, session.id)).toBe(1);
    expect(readFileSync(log, "utf8")).toMatch(/fixture session .* failed\narcadia: provider exited with status 1/);

    // An exit code the fixture does not choose itself: the wrapper, not the provider, records it.
    const other = preparedFixture("completed", "0");
    const otherSession = prepareFixtureSession(other, new FakeTmux());
    const recording = sessionRecordingFor(other.workspace, otherSession.id);
    const run = wrapRecordedLaunch({ command: "sh", args: ["-c", "echo to-stdout; echo to-stderr >&2; exit 3"] }, recording);
    expect(spawnSync(run.command, run.args).status).toBe(3);
    expect(exitStatusOf(other.workspace, otherSession.id)).toBe(3);
    const combined = readFileSync(recording.logFile, "utf8");
    expect(combined).toContain("to-stdout");
    expect(combined).toContain("to-stderr");
  });

  it("a crash mid-output keeps the log, records the kill, and is distinguishable from a clean exit", () => {
    const tmux = new WrapperRunTmux();
    const { fixture, session, log } = launchedFixture("crashed", tmux);

    // SIGKILL surfaces as 137 to the wrapper, which survives to record it.
    expect(exitStatusOf(fixture.workspace, session.id)).toBe(137);
    expect(tmux.runs).toEqual([{ status: 137, signal: null }]);
    expect(existsSync(log)).toBe(true);
    const text = readFileSync(log, "utf8");
    expect(text).toContain("was writing when it cra");
    expect(text).toContain("arcadia: provider exited with status 137");
  });

  it("refuses to run a provider it cannot log, recording a distinct status instead of losing the output silently", () => {
    const fixture = preparedFixture("completed", "0");
    const session = prepareFixtureSession(fixture, new FakeTmux());
    const blocker = path.join(fixture.root, "not-a-directory");
    writeFileSync(blocker, "a file where a directory is needed\n");
    const run = wrapRecordedLaunch(
      { command: "sh", args: ["-c", "echo must-not-run > ran.txt"] },
      { sessionId: session.id, logFile: path.join(blocker, "x.log"), databaseFile: getWorkspacePaths(fixture.workspace).databaseFile }
    );
    expect(spawnSync(run.command, run.args, { cwd: fixture.root }).status).toBe(73);
    expect(existsSync(path.join(fixture.root, "ran.txt"))).toBe(false);
    expect(exitStatusOf(fixture.workspace, session.id)).toBe(73);
  });

  it.each(["/bin/sh", "/bin/bash", "bash", "zsh"])("the wrapper runs unchanged under %s", (shell) => {
    const resolved = shell.startsWith("/") ? (existsSync(shell) ? shell : null) : findExecutable(shell);
    if (!resolved) return;
    const fixture = preparedFixture("completed", "0");
    const session = prepareFixtureSession(fixture, new FakeTmux());
    const recording = sessionRecordingFor(fixture.workspace, session.id);
    const run = wrapRecordedLaunch({ command: "sh", args: ["-c", "echo ran-under-shell; exit 5"] }, recording);
    // The wrapper is `sh -c <script> ...`; run that same script under the shell being checked.
    expect(spawnSync(resolved, run.args).status).toBe(5);
    expect(exitStatusOf(fixture.workspace, session.id)).toBe(5);
    expect(readFileSync(recording.logFile, "utf8")).toContain("ran-under-shell");
  });
});

function tmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// The same three outcomes through a real tmux server and `systemTmux`. Skipped
// where tmux is not installed; the block above covers the wrapper logic
// everywhere, this proves tmux hands the wrapper's arguments through intact.
describe.skipIf(!tmuxAvailable())("headless fixture-cli launch through real tmux", () => {
  const tmuxSessions: string[] = [];
  afterEach(() => {
    for (const name of tmuxSessions.splice(0)) {
      try { execFileSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" }); } catch { /* already gone */ }
    }
  });

  async function runThroughTmux(outcome: FixtureOutcome) {
    const fixture = preparedFixture(outcome, "0");
    const session = prepareFixtureSession(fixture, new FakeTmux());
    tmuxSessions.push(session.tmux_session_name);
    withDatabase(fixture.workspace, (db) => launchPreparedSession(db, session, systemTmux, undefined, fixture.workspace));
    const deadline = Date.now() + 30_000;
    while (systemTmux.hasSession(session.tmux_session_name) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(systemTmux.hasSession(session.tmux_session_name)).toBe(false);
    return { fixture, session, log: sessionLogPath(fixture.workspace, session.id) };
  }

  it("a clean exit: exit_status 0 and the log outlives the tmux session", async () => {
    const { fixture, session, log } = await runThroughTmux("completed");
    expect(exitStatusOf(fixture.workspace, session.id)).toBe(0);
    expect(readFileSync(log, "utf8")).toContain(`fixture session ${session.id} completed`);
  }, 40_000);

  it("a non-zero exit: the failure status is recorded", async () => {
    const { fixture, session, log } = await runThroughTmux("failed");
    expect(exitStatusOf(fixture.workspace, session.id)).toBe(1);
    expect(readFileSync(log, "utf8")).toContain("arcadia: provider exited with status 1");
  }, 40_000);

  it("a crash mid-output: the partial log is kept and the kill is recorded", async () => {
    const { fixture, session, log } = await runThroughTmux("crashed");
    expect(exitStatusOf(fixture.workspace, session.id)).toBe(137);
    expect(readFileSync(log, "utf8")).toContain("was writing when it cra");
  }, 40_000);
});

function runFixtureScript(args: string[]): string {
  const scriptPath = path.resolve(__dirname, "..", "scripts", "fixture-coding-agent.mjs");
  return execFileSync("node", [scriptPath, ...args], { encoding: "utf8" });
}

function prepareFixtureSession(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux, suffix = "fixture-worktree") {
  const dispatch = resolveDispatch(fixture.repo, "test-project");
  const baseRevision = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
  const worktreePath = path.join(fixture.root, suffix);
  const branch = `fixture/${suffix}`;
  git(fixture.repo, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  return withDatabase(fixture.workspace, (db) =>
    prepareSession({
      db,
      workspace: fixture.workspace,
      repoRoot: fixture.repo,
      dispatch,
      agent: "fixture",
      model: fixture.model,
      effort: fixture.effort,
      baseRevision,
      branch,
      worktreePath,
      now: fixture.now,
      tmux
    })
  );
}

const fixtureScope: ProductionScope = normalizeProductionScope({
  intent: "Prove the fixture provider is admitted only when named in scope.",
  projects: ["test-project"],
  plans: ["test-project/copy-proof"],
  actions: ["test-project/define-contract"],
  providers: [FIXTURE_PROVIDER],
  maxConcurrentSessions: 1,
  mechanicalTransitions: []
});

const noFixtureScope: ProductionScope = normalizeProductionScope({
  intent: "Prove the fixture provider is refused when absent from scope.",
  projects: ["test-project"],
  plans: ["test-project/copy-proof"],
  actions: ["test-project/define-contract"],
  providers: ["claude-code-cli"],
  maxConcurrentSessions: 1,
  mechanicalTransitions: []
});

function activatePolicy(fixture: ReturnType<typeof preparedFixture>, requestId: string, scope: ProductionScope) {
  return withDatabase(fixture.workspace, (db) =>
    activateProduction(db, {
      requestId,
      scope,
      scopeFingerprint: fingerprintProductionScope(scope),
      grantedBy: "operator"
    })
  );
}

function fixtureCapacityObservation(): ProviderCapacityObservation {
  const decision: CapacityAdmissionDecision = {
    providerId: FIXTURE_PROVIDER,
    admitted: true,
    code: null,
    reason: "fixture-cli is unmetered by construction.",
    unattendedProof: true,
    retryAfter: null,
    refreshRequired: false,
    receipt: {
      version: 1,
      providerId: FIXTURE_PROVIDER,
      providerLabel: "Fixture",
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
      usagePolicyReason: "fixture provider",
      windows: [{ label: "5h", usedPercentage: 0, remainingPercentage: 100, resetsAt: null }],
      nextResetAt: null,
      unsupported: [],
      availability: "available",
      telemetry: "fixture provider"
    }
  };
  return { generatedAt: "2026-08-30T12:34:56.000Z", providers: [decision] };
}

function doStandingFixtureLaunch(
  fixture: ReturnType<typeof preparedFixture>,
  tmux: FakeTmux,
  requestId = "policy-fixture-req-1"
): GuardedLaunchResult {
  return withDatabase(fixture.workspace, (db) =>
    launchGuardedHostSession({
      db,
      workspace: fixture.workspace,
      repoRoot: fixture.repo,
      projectSlug: "test-project",
      requestId,
      standingPolicy: true,
      profiles: [],
      adapters: { version: 1, mappingId: "fixture-test", observedAt: fixture.now.toISOString(), providers: [], bindings: [] },
      now: fixture.now,
      tmux,
      agentWorktreeRoot: path.join(fixture.root, requestId),
      capacityObservation: fixtureCapacityObservation()
    })
  );
}

function preparedFixture(
  outcome: FixtureOutcome,
  duration: string,
  overrides?: { provider: string; model: string; profileName: string; command: string }
) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-fixture-provider-"));
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

  const provider = overrides?.provider ?? FIXTURE_PROVIDER;
  const model = overrides?.model ?? fixtureModelFor(outcome);
  const profileName = overrides?.profileName ?? "fixture_build";
  const command = overrides?.command ?? "node";
  const packetId = "codex_fixture_provider_test";
  const mappingId = "fixture-map";
  const bindingId = "fixture-binding";

  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove the fixture provider.", goal: "Prove the fixture provider.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo, validationCommands: ["node -e \"process.exit(0)\""] });
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
      providerSelection: { provider, model, mappingId, bindingId, effort: duration }
    }));
    createCodexInvocation(db, {
      id: packetId,
      purpose: "build",
      agentProfile: profileName,
      workspaceScope: repo,
      command,
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

  return { root, repo, workspace, packetId, model, effort: duration, now: new Date("2026-08-30T12:34:56.000Z") };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove the fixture provider.
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
milestone: Prove the fixture provider's contract
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
    expected_artifact: contract.md
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
question: May the fixture Session launch?
answer: Yes, launch the fixture Session.
decided: 2026-08-30
updated: 2026-08-30
---

# Authorize
`;
