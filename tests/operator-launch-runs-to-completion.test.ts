import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toDashboardAgentSession, UNRECONCILED_EXIT_BOUND_MS } from "../src/dashboard/snapshot.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { runProductionActivateCommand, runProductionPreviewCommand } from "../src/commands/production.js";
import { loadPhase3Registries } from "../src/intent/registries.js";
import { preserveSessionCandidate } from "../src/production/sessionHandoff.js";
import { getSession, type AgentSession } from "../src/sessions/index.js";
import { reconcileSessionExit } from "../src/sessions/reconciliation.js";
import { launchGuardedHostSession } from "../src/sessions/launch.js";
import { buildLaunchPreview } from "../src/sessions/launchPreview.js";
import {
  confirmOperatorLaunchAtTerminal,
  findOperatorLaunchAuthorization,
  OPERATOR_LAUNCH_TTL_MS,
  operatorLaunchAuthorityFor,
  SESSION_ENV_MARKER,
  type OperatorLaunchSource,
  type TerminalIo
} from "../src/sessions/operatorLaunch.js";
import { capacity, git, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Decision 0096: a confirmed operator Launch records a one-shot authorization
 * for its Session, and when that Session exits with production NOT Active the
 * existing tick validates, commits and pushes the candidate, reconciles, and
 * only on accepted_completion opens a DRAFT pull request through the same
 * `preserveSessionCandidate`. Real tick, real Git (a bare `origin`), real
 * settlement; only tmux, the GitHub CLI and the agent are faked (the shared
 * rehearsal harness). Production is never activated here.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];

/** A registered fixture with production Off (never activated) and a bare origin. */
function fixture(): Rehearsal {
  const rehearsal = new Rehearsal({ independentReviewers: "tick" });
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  return rehearsal;
}

/** The preview-then-launch flow the dashboard and the CLI both run, with an optional confirmed operator Launch. */
function launch(rehearsal: Rehearsal, operatorLaunch?: { source: OperatorLaunchSource; env?: NodeJS.ProcessEnv }, requestId = "operator-launch-1"): AgentSession {
  const registries = loadPhase3Registries(rehearsal.workspace);
  return withDatabase(rehearsal.workspace, (db) => {
    const preview = buildLaunchPreview({
      db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, requestId,
      profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters, tmux: rehearsal.tmux, now: rehearsal.now
    });
    return launchGuardedHostSession({
      db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, requestId,
      previewFingerprint: preview.previewFingerprint, ...(operatorLaunch ? { operatorLaunch } : {}),
      profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters, tmux: rehearsal.tmux, now: rehearsal.now,
      capacityObservation: capacity(rehearsal.provider), agentWorktreeRoot: rehearsal.worktrees,
      providerSignIn: () => ({ signedIn: true, remedy: "" })
    }).session;
  });
}

function authorization(rehearsal: Rehearsal, session: AgentSession) {
  return withReadOnlyDatabase(rehearsal.workspace, (db) => findOperatorLaunchAuthorization(db, session.id));
}

function events(rehearsal: Rehearsal, type: string): Array<Record<string, unknown>> {
  return withReadOnlyDatabase(rehearsal.workspace, (db) =>
    (db.prepare("SELECT payload_json FROM events WHERE event_type = ? ORDER BY created_at, rowid").all(type) as Array<{ payload_json: string }>)
      .map((row) => JSON.parse(row.payload_json) as Record<string, unknown>));
}

/** The agent works and the Session's pane ends. */
function agentExits(rehearsal: Rehearsal, session: AgentSession, how: "settled" | "uncommitted"): void {
  rehearsal.agentEdit(session, "MARKER.md", `${LINE_A}\n`);
  if (how === "settled") rehearsal.agentFinish(session, CRITERIA_A);
  rehearsal.tmux.exit(session.tmux_session_name);
}

const candidateHead = (rehearsal: Rehearsal, session: AgentSession) => git(rehearsal.repo, ["rev-parse", `refs/heads/${session.branch}`]).trim();

describe("a confirmed operator Launch mints a one-shot authorization", () => {
  it("binds it to the Session and Action, expires it in 24 hours and writes an auditable receipt (dashboard source)", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });

    const row = authorization(rehearsal, session)!;
    expect(row).toMatchObject({
      session_id: session.id, project_slug: rehearsal.projectSlug, action_id: "write-marker-a", source: "dashboard",
      request_id: "operator-launch-1", used_at: null, publish_state: "none"
    });
    expect(Date.parse(row.expires_at) - Date.parse(row.minted_at)).toBe(OPERATOR_LAUNCH_TTL_MS);
    expect(events(rehearsal, "operator_launch.authorization_minted")).toEqual([
      expect.objectContaining({ authorizationId: row.id, sessionId: session.id, source: "dashboard", actionKey: `${rehearsal.projectSlug}/write-marker-a` })
    ]);
    expect(rehearsal.tmux.launches).toHaveLength(1);
    // The launched Session carries the marker a later mint attempt refuses on.
    expect(rehearsal.tmux.launches[0].args).toContain(`${SESSION_ENV_MARKER}=${session.id}`);
  });

  it("mints nothing for a launch that was not confirmed", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal);
    expect(authorization(rehearsal, session)).toBeNull();
    expect(events(rehearsal, "operator_launch.authorization_minted")).toEqual([]);
  });

  it("refuses to mint from inside an Arcadia Session, before anything is launched", () => {
    const rehearsal = fixture();
    expect(() => launch(rehearsal, { source: "dashboard", env: { [SESSION_ENV_MARKER]: "session_inside" } })).toThrow(/inside an Arcadia Session/);
    expect(rehearsal.tmux.launches).toHaveLength(0);
    expect(rehearsal.lease()).toBeNull();
    expect(events(rehearsal, "operator_launch.authorization_minted")).toEqual([]);
  });

  it("is never combined with the standing production policy grant", () => {
    const rehearsal = fixture();
    const registries = loadPhase3Registries(rehearsal.workspace);
    expect(() => withDatabase(rehearsal.workspace, (db) => launchGuardedHostSession({
      db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, requestId: "standing",
      standingPolicy: true, operatorLaunch: { source: "dashboard" }, profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters
    }))).toThrow(/never under the standing production policy/);
  });
});

describe("--operator-launch's terminal confirmation", () => {
  const tty = (answer: string): TerminalIo => ({ stdinIsTTY: true, stdoutIsTTY: true, ask: () => answer });

  it("confirms only at an interactive terminal answered yes", () => {
    expect(confirmOperatorLaunchAtTerminal({ actionLabel: "plan/x#a", env: {}, io: tty("y") })).toBe("cli_tty");
    expect(confirmOperatorLaunchAtTerminal({ actionLabel: "plan/x#a", env: {}, io: tty("YES") })).toBe("cli_tty");
  });

  it("refuses a non-interactive shell, an unconfirmed answer and an Arcadia Session", () => {
    expect(() => confirmOperatorLaunchAtTerminal({ actionLabel: "a", env: {}, io: { stdinIsTTY: false, stdoutIsTTY: true, ask: () => "y" } }))
      .toThrow(/interactive terminal/);
    expect(() => confirmOperatorLaunchAtTerminal({ actionLabel: "a", env: {}, io: { stdinIsTTY: true, stdoutIsTTY: false, ask: () => "y" } }))
      .toThrow(/interactive terminal/);
    expect(() => confirmOperatorLaunchAtTerminal({ actionLabel: "a", env: {}, io: tty("") })).toThrow(/not confirmed/);
    expect(() => confirmOperatorLaunchAtTerminal({ actionLabel: "a", env: {}, io: tty("n") })).toThrow(/not confirmed/);
    // An interactive answer still never mints from inside a Session.
    expect(() => confirmOperatorLaunchAtTerminal({ actionLabel: "a", env: { [SESSION_ENV_MARKER]: "s1" }, io: tty("y") }))
      .toThrow(/inside an Arcadia Session/);
  });

  it("names the consequence in its prompt", () => {
    let prompt = "";
    confirmOperatorLaunchAtTerminal({ actionLabel: "plan/x#a", env: {}, io: { stdinIsTTY: true, stdoutIsTTY: true, ask: (text) => { prompt = text; return "y"; } } });
    expect(prompt).toContain("DRAFT pull request");
    expect(prompt).toContain("never merges");
    expect(prompt).toContain("plan/x#a");
  });
});

describe("arcadia session launch's operator-launch flags (the real CLI)", () => {
  /** Runs the CLI entry with stdin closed (a non-interactive shell) and no workspace: both refusals precede any workspace use. */
  function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "session", "launch", "--repo", ".", "--request-id", "r1", "--json",
      "--workspace", path.join(tmpdir(), "arcadia-no-such-workspace-operator-launch"), ...args], {
      cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ARCADIA_SESSION_ID: "", ...env }
    });
    // A failed command prints its JSON error envelope on stderr (after any host noise).
    const text = run.stdout.trim() || run.stderr.slice(Math.max(0, run.stderr.indexOf("{\n")));
    if (!text.startsWith("{")) throw new Error(`The CLI printed no JSON (status ${String(run.status)}): ${run.stderr.slice(0, 800)}`);
    return JSON.parse(text) as { ok: boolean; error?: { code: string; message: string; details?: { code?: string } } };
  }

  it("--operator-launch from a non-interactive shell mints nothing and launches nothing", () => {
    const result = runCli(["--preview-fingerprint", "f", "--operator-launch"]);
    expect(result.ok).toBe(false);
    expect(result.error?.details?.code).toBe("operator_launch_not_interactive");
  });

  it("the dashboard confirmation flag is refused from inside an Arcadia Session", () => {
    const result = runCli(["--preview-fingerprint", "f", "--operator-launch-dashboard"], { ARCADIA_SESSION_ID: "session_x" });
    expect(result.ok).toBe(false);
    expect(result.error?.details?.code).toBe("operator_launch_inside_session");
  });

  it("an authorization flag without the previewed fingerprint is refused", () => {
    expect(runCli(["--operator-launch-dashboard"]).error?.message).toMatch(/needs the previewed --preview-fingerprint/);
    expect(runCli(["--operator-launch"]).error?.message).toMatch(/needs the previewed --preview-fingerprint/);
  });
});

describe("the exit of an operator-launched Session with production Off", () => {
  it("accepted completion: validates, commits, pushes, reconciles and opens a DRAFT PR, once, with no merge", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    expect(rehearsal.status().policy?.desiredState ?? "inactive").not.toBe("active");

    const exited = rehearsal.tick();

    expect(exited.reconciled.map((entry) => entry.outcome)).toEqual(["accepted_completion"]);
    expect(exited.handoff?.preservation).toMatchObject({ kind: "preserved", state: "PUSHED" });
    // The one draft PR, opened through preservation after the accepted completion.
    expect(rehearsal.github.prs).toHaveLength(1);
    expect(rehearsal.github.prs[0]).toMatchObject({ branch: session.branch, baseBranch: "main", isDraft: true });
    expect(rehearsal.github.headOf(session.branch)).toBe(candidateHead(rehearsal, session));
    expect(git(rehearsal.repo, ["show", `${candidateHead(rehearsal, session)}:MARKER.md`])).toBe(`${LINE_A}\n`);
    // Nothing merged or integrated, and production was never turned on.
    expect(exited.handoff?.integration.kind).toBe("refused");
    expect(rehearsal.github.ghCalls.some((call) => / merge\b/.test(call) || call.startsWith("gh pr ready"))).toBe(false);
    expect(rehearsal.github.headOf("main")).toBe(git(rehearsal.repo, ["rev-list", "--max-parents=0", "refs/heads/main"]).trim());
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(rehearsal.github.headOf("main"));
    expect(exited.launch).toBeNull();

    // The authorization is used up, with its receipt.
    const used = authorization(rehearsal, session)!;
    expect(used.used_at).not.toBeNull();
    expect(used).toMatchObject({ outcome: "accepted_completion", publish_state: "done", publish_attempts: 1 });
    expect(JSON.parse(used.receipt_json!)).toMatchObject({
      commit: { kind: "preserved", state: "PUSHED" }, pullRequest: { kind: "preserved", url: rehearsal.github.prs[0].url }, merged: false
    });
    expect(events(rehearsal, "operator_launch.authorization_used")).toHaveLength(1);

    // Later ticks add no second PR, push or launch.
    const pushes = rehearsal.github.pushes.length;
    for (let i = 0; i < 3; i += 1) expect(rehearsal.tick().launch).toBeNull();
    expect(rehearsal.github.prs).toHaveLength(1);
    expect(rehearsal.github.pushes).toHaveLength(pushes);
    expect(events(rehearsal, "operator_launch.authorization_used")).toHaveLength(1);

    // Once used, the same authorization stands behind nothing more.
    withReadOnlyDatabase(rehearsal.workspace, (db) => {
      const again = operatorLaunchAuthorityFor(db, getSession(db, session.id)!, rehearsal.now);
      expect(again).toMatchObject({ ok: false, code: "used" });
    });
  });

  it("incomplete work: preserved and pushed, reconciled incomplete_resumable, and no PR is opened", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "uncommitted");

    const exited = rehearsal.tick();

    expect(exited.reconciled.map((entry) => entry.outcome)).toEqual(["incomplete_resumable"]);
    expect(exited.handoff?.preservation).toMatchObject({ kind: "preserved", state: "PUSHED" });
    // The work is a commit on the branch, on the remote and still in the worktree.
    expect(git(rehearsal.repo, ["show", `${candidateHead(rehearsal, session)}:MARKER.md`])).toBe(`${LINE_A}\n`);
    expect(rehearsal.github.headOf(session.branch)).toBe(candidateHead(rehearsal, session));
    expect(existsSync(path.join(session.worktree_path, "MARKER.md"))).toBe(true);
    expect(readFileSync(path.join(session.worktree_path, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n`);
    expect(git(session.worktree_path, ["status", "--porcelain"]).trim()).toBe("");
    // No accepted completion: no draft PR, and the authorization is still used up.
    expect(rehearsal.github.prs).toEqual([]);
    expect(authorization(rehearsal, session)).toMatchObject({ outcome: "incomplete_resumable", publish_state: "none" });
    expect(authorization(rehearsal, session)!.used_at).not.toBeNull();
    // The resumable handoff is the existing receipt; the lease is released.
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.status().operatorEscalations).toEqual([]);
  });

  it("a launch without the confirmation carries no authority: nothing is committed or pushed", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal);
    agentExits(rehearsal, session, "settled");

    const exited = rehearsal.tick();

    expect(exited.handoff?.preservation).toMatchObject({ kind: "refused", reason: expect.stringMatching(/validation is not authorized/) });
    expect(rehearsal.github.pushes).toEqual([]);
    expect(rehearsal.github.prs).toEqual([]);
    expect(authorization(rehearsal, session)).toBeNull();
  });

  it("an expired authorization preserves nothing", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    rehearsal.now = new Date(rehearsal.now.getTime() + OPERATOR_LAUNCH_TTL_MS + 60_000);

    const exited = rehearsal.tick();

    expect(exited.handoff?.preservation).toMatchObject({ kind: "refused", reason: expect.stringMatching(/expired/) });
    expect(rehearsal.github.pushes).toEqual([]);
    expect(rehearsal.github.prs).toEqual([]);
    expect(rehearsal.log.some((line) => /Operator launch authority for Session .* is not usable: .*expired/.test(line))).toBe(true);
    expect(authorization(rehearsal, session)!.used_at).toBeNull();
  });

  it("an authorization bound to another Action or Session authorizes nothing", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    const row = authorization(rehearsal, session)!;
    const otherAction: AgentSession = { ...session, action_id: "write-marker-b" };
    const otherSession: AgentSession = { ...session, id: "session_other" };

    withReadOnlyDatabase(rehearsal.workspace, (db) => {
      expect(operatorLaunchAuthorityFor(db, otherAction, rehearsal.now, row.id)).toMatchObject({ ok: false, code: "wrong_action" });
      expect(operatorLaunchAuthorityFor(db, otherSession, rehearsal.now, row.id)).toMatchObject({ ok: false, code: "wrong_session" });
      expect(operatorLaunchAuthorityFor(db, otherSession, rehearsal.now)).toMatchObject({ ok: false, code: "none" });
      expect(operatorLaunchAuthorityFor(db, session, rehearsal.now, row.id)).toMatchObject({ ok: true });
    });
    // And the preservation path itself refuses it before any Git write.
    agentExits(rehearsal, session, "settled");
    const refused = withDatabase(rehearsal.workspace, (db) => preserveSessionCandidate({
      db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, session: otherAction, now: rehearsal.now,
      operatorLaunch: { authorizationId: row.id, phase: "commit" }
    }));
    expect(refused).toMatchObject({ kind: "refused", reason: expect.stringMatching(/bound to .*write-marker-a, not .*write-marker-b/) });
    expect(rehearsal.github.pushes).toEqual([]);
  });

  it("an already-used authorization cannot preserve or publish a second time", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    rehearsal.tick();
    const row = authorization(rehearsal, session)!;
    expect(row.used_at).not.toBeNull();

    const refused = withDatabase(rehearsal.workspace, (db) => preserveSessionCandidate({
      db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, session: getSession(db, session.id)!, now: rehearsal.now,
      terminalRecovery: true, operatorLaunch: { authorizationId: row.id, phase: "publish", requestId: "second-publish" }
    }));
    expect(refused).toMatchObject({ kind: "refused", reason: expect.stringMatching(/was used at/) });
    expect(rehearsal.github.prs).toHaveLength(1);
  });

  it("retries a draft PR that could not be opened on the next tick (the branch is already on the remote)", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    const upsert = rehearsal.github.remote.upsertDraftPullRequest.bind(rehearsal.github.remote);
    let failures = 1;
    rehearsal.github.remote.upsertDraftPullRequest = (input) => {
      if (failures > 0) { failures -= 1; throw new Error("gh: network unreachable (simulated)"); }
      return upsert(input);
    };

    rehearsal.tick();
    expect(rehearsal.github.prs).toEqual([]);
    expect(authorization(rehearsal, session)).toMatchObject({ publish_state: "pending", publish_attempts: 1 });
    // The branch is already pushed, so the retry only has the PR left to do.
    expect(rehearsal.github.headOf(session.branch)).toBe(candidateHead(rehearsal, session));

    rehearsal.tick();
    expect(rehearsal.github.prs).toHaveLength(1);
    expect(rehearsal.github.prs[0].isDraft).toBe(true);
    expect(authorization(rehearsal, session)).toMatchObject({ publish_state: "done", publish_attempts: 2 });
  });

  it("finishes an exit whose tick died between reconciliation and using the authorization", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    rehearsal.tick();
    expect(rehearsal.github.prs).toHaveLength(1);
    // Simulate the crash window: the Session is reconciled, the authorization still unused.
    withDatabase(rehearsal.workspace, (db) => db.prepare(
      "UPDATE operator_launch_authorizations SET used_at = NULL, outcome = NULL, publish_state = 'none', publish_attempts = 0, receipt_json = NULL WHERE session_id = ?"
    ).run(session.id));

    rehearsal.tick();

    expect(rehearsal.github.prs).toHaveLength(1);
    expect(authorization(rehearsal, session)).toMatchObject({ outcome: "accepted_completion", publish_state: "done" });
    expect(authorization(rehearsal, session)!.used_at).not.toBeNull();
  });

  it("closes an authorization whose Session was reconciled outside the worker, once, so it is not re-listed every tick", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    // The operator's manual fallback records the exit but commits and pushes nothing.
    withDatabase(rehearsal.workspace, (db) => {
      reconcileSessionExit({ db, sessionId: session.id, requestId: "manual-reconcile", repoRoot: rehearsal.repo });
    });
    expect(rehearsal.github.pushes).toEqual([]);

    rehearsal.tick();

    expect(authorization(rehearsal, session)).toMatchObject({ outcome: "not_applicable", publish_state: "none" });
    expect(authorization(rehearsal, session)!.used_at).not.toBeNull();
    expect(events(rehearsal, "operator_launch.authorization_used")).toHaveLength(1);
    rehearsal.tick();
    expect(events(rehearsal, "operator_launch.authorization_used")).toHaveLength(1);
    expect(rehearsal.github.pushes).toEqual([]);
    expect(rehearsal.github.prs).toEqual([]);
  });

  it("a Session that never started leaves an authorization_voided event and no row", () => {
    const rehearsal = fixture();
    rehearsal.tmux.launch = () => { throw new Error("synthetic spawn failure"); };
    expect(() => launch(rehearsal, { source: "dashboard" })).toThrow(/tmux could not start/);

    expect(withReadOnlyDatabase(rehearsal.workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM operator_launch_authorizations").get())).toEqual({ n: 0 });
    expect(events(rehearsal, "operator_launch.authorization_minted")).toHaveLength(1);
    expect(events(rehearsal, "operator_launch.authorization_voided")).toEqual([
      expect.objectContaining({ reason: expect.stringContaining("the Session never started") })
    ]);
  });

  it("gives up after the bounded number of attempts", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    rehearsal.github.remote.upsertDraftPullRequest = () => { throw new Error("gh: still down (simulated)"); };

    for (let i = 0; i < 6; i += 1) rehearsal.tick();

    expect(rehearsal.github.prs).toEqual([]);
    expect(authorization(rehearsal, session)).toMatchObject({ publish_state: "failed", publish_attempts: 3 });
  });
});

/** Activate production with the given delegated transitions and a Decision 0058 integration grant, for the Action's Plan. */
function activateProduction(rehearsal: Rehearsal, transitions: string): void {
  const grantExpiresAt = new Date(rehearsal.now.getTime() + 12 * 3_600_000).toISOString();
  const base = {
    workspace: rehearsal.workspace, project: [rehearsal.projectSlug], plan: [`${rehearsal.projectSlug}/${rehearsal.planSlug}`],
    provider: [rehearsal.provider], concurrency: "1", transitions, intent: "Prove an operator grant never integrates.",
    remotePreservation: true, integrationGrantDecision: "0058", integrationGrantExpiresAt: grantExpiresAt
  };
  const preview = runProductionPreviewCommand(base);
  runProductionActivateCommand({
    ...base, requestId: "activate-without-validation", grantedBy: "test", expectedRevision: String(preview.data.preview.expectedRevision)
  });
}

describe("production's integration grant never carries an operator-launched candidate into the base", () => {
  it("Active with an integration grant but no validation delegation: preserved and draft PR under the operator grant, never fast-forwarded", () => {
    const rehearsal = fixture();
    activateProduction(rehearsal, "acceptance,pointer");
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    const mainBefore = git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim();

    const exited = rehearsal.tick();

    expect(exited.reconciled.map((entry) => entry.outcome)).toEqual(["accepted_completion"]);
    expect(exited.handoff?.preservation).toMatchObject({ kind: "preserved", state: "PUSHED" });
    expect(exited.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/never authorizes integration/) });
    expect(rehearsal.github.prs).toHaveLength(1);
    // Later ticks (the terminal-recovery path, readiness and reviewers) integrate nothing either.
    for (let i = 0; i < 6; i += 1) {
      const result = rehearsal.tick();
      expect(result.handoff?.integration.kind ?? "refused").not.toBe("integrated");
    }
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(mainBefore);
    expect(rehearsal.github.readyCalls).toEqual([]);
    expect(rehearsal.github.reviewerCalls).toEqual([]);
    expect(rehearsal.github.ghCalls.some((call) => / merge\b/.test(call))).toBe(false);
  });

  it("when production delegates validation for the Action itself, the operator row is superseded rather than failed", () => {
    const rehearsal = fixture();
    activateProduction(rehearsal, "validation,acceptance,pointer");
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");

    rehearsal.tick();
    rehearsal.tick();

    // Production's own path preserved it; the operator authorization stood aside.
    expect(authorization(rehearsal, session)).toMatchObject({ outcome: "superseded_by_production", publish_state: "none" });
    expect(rehearsal.github.prs).toHaveLength(1);
  });
});

describe("an exited but unreconciled Session on the dashboard", () => {
  function view(rehearsal: Rehearsal, sessionId: string, at: Date) {
    return withReadOnlyDatabase(rehearsal.workspace, (db) => toDashboardAgentSession(db, getSession(db, sessionId)!, at, rehearsal.tmux));
  }

  it("shows the arcadia session reconcile fallback once the exit is older than the bound, and not before", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    agentExits(rehearsal, session, "settled");
    // Nothing ticked: the worker is down.
    const row = withReadOnlyDatabase(rehearsal.workspace, (db) => getSession(db, session.id)!);
    const exitedAt = Date.parse(row.updated_at);

    const fresh = view(rehearsal, session.id, new Date(exitedAt + 1_000));
    expect(fresh.observedStatus).toBe("exited");
    expect(fresh.unreconciled).toBeNull();

    const overdue = view(rehearsal, session.id, new Date(exitedAt + UNRECONCILED_EXIT_BOUND_MS + 1_000));
    expect(overdue.unreconciled).toEqual({
      since: row.updated_at, exitStatus: null, reconcileCommand: `arcadia session reconcile ${session.id} --repo ${rehearsal.repo}`
    });
    expect(overdue.operatorLaunch).toMatchObject({ usedAt: null, publishState: "none" });
  });

  it("is not flagged while the process is alive, and clears once the tick reconciles it", () => {
    const rehearsal = fixture();
    const session = launch(rehearsal, { source: "dashboard" });
    const farFuture = new Date(Date.now() + 10 * UNRECONCILED_EXIT_BOUND_MS);
    expect(view(rehearsal, session.id, farFuture)).toMatchObject({ live: true, unreconciled: null });

    agentExits(rehearsal, session, "uncommitted");
    expect(view(rehearsal, session.id, farFuture).unreconciled).not.toBeNull();
    rehearsal.tick();
    expect(view(rehearsal, session.id, farFuture).unreconciled).toBeNull();
    expect(view(rehearsal, session.id, farFuture).operatorLaunch).toMatchObject({ outcome: "incomplete_resumable" });
  });
});

