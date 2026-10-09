import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProjectImportCommand, runProjectMetadataCommand } from "../src/commands/project.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { loadPhase3Registries } from "../src/intent/registries.js";
import type { AgentSession } from "../src/sessions/index.js";
import { githubRepositoryOf, verifyFixtureStandingLaunch } from "../src/sessions/fixtureStandingLaunch.js";
import { launchGuardedHostSession } from "../src/sessions/launch.js";
import { buildLaunchPreview } from "../src/sessions/launchPreview.js";
import { ensureOperatorLaunchSchema, findOperatorLaunchAuthorization, SESSION_ENV_MARKER } from "../src/sessions/operatorLaunch.js";
import { capacity, git, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Decision 0100: `--fixture-standing` mints the same one-shot authorization as a
 * confirmed operator Launch, with no confirmation, only for a registered
 * disposable fixture, only while Decision 0100 is answered, and only until
 * 2026-10-18. Real launch and tick through the shared rehearsal harness.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const FIXTURE_REMOTE = "https://github.com/pmark/arcadia-three-action-rehearsal-20261004.git";
const ANSWER_MERGE = "Standing fixture launch, with merge on green";
const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];

function decisionDoc(status: string, answer: string | null): string {
  return [
    "---", "arcadia: v1", "type: decision", 'id: "0100"',
    "slug: decide-whether-agents-may-launch-actions-in-disposable-fixture-projects-without",
    "project: arcadia", `status: ${status}`,
    "question: Decide whether agents may launch Actions in disposable fixture Projects without a per-launch operator confirmation.",
    "gap_type: missing-decision", "gate_question: approval_boundary", `recommendation: ${ANSWER_MERGE}`,
    "options:",
    `  - label: ${ANSWER_MERGE}`, "    consequence: Standing fixture launch with merge on green.", "    recommended: true",
    "  - label: Standing fixture launch, you merge", "    consequence: Fixture pull requests stay draft.", "    recommended: false",
    "  - label: Not now", "    consequence: Nothing changes.", "    recommended: false",
    "confidence: high", "updated: 2026-10-09",
    ...(answer ? [`answer: ${answer}`, "decided: 2026-10-10"] : []),
    "---", "", "# Decision 0100: fixture standing launch", ""
  ].join("\n");
}

/** A registered `arcadia` Project whose repository holds Decision 0100 in the given state. */
function seedDecision(rehearsal: Rehearsal, status: string, answer: string | null): void {
  const repo = path.join(rehearsal.root, "arcadia-checkout");
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "docs", "decisions", "0100-decide-whether-agents-may-launch-actions-in-disposable-fixture-projects-without.md"), decisionDoc(status, answer));
  const imported = runProjectImportCommand({
    workspace: rehearsal.workspace, name: "Arcadia", mission: "Test stand-in for the Arcadia Project.", status: "active",
    milestone: "m", nextAction: "n", classification: "agent"
  });
  runProjectMetadataCommand({ workspace: rehearsal.workspace, projectId: imported.data.project.id, repoPath: repo });
}

/** A fixture whose raw origin URL is the registered GitHub fixture, rewritten to the local bare origin for pushes. */
function fixture(remote: string | null = FIXTURE_REMOTE): Rehearsal {
  const rehearsal = new Rehearsal({ independentReviewers: "tick" });
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  if (remote) {
    const bare = git(rehearsal.repo, ["config", "--get", "remote.origin.url"]).trim();
    git(rehearsal.repo, ["config", `url.${bare}.insteadOf`, remote]);
    git(rehearsal.repo, ["remote", "set-url", "origin", remote]);
  }
  return rehearsal;
}

type Standing = { agentIdentity: string };
function launch(rehearsal: Rehearsal, standing: Standing | null = { agentIdentity: "claude-test" }, env?: NodeJS.ProcessEnv): AgentSession {
  const registries = loadPhase3Registries(rehearsal.workspace);
  const requestId = "fixture-standing-1";
  return withDatabase(rehearsal.workspace, (db) => {
    const preview = buildLaunchPreview({
      db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, requestId,
      profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters, tmux: rehearsal.tmux, now: rehearsal.now
    });
    return launchGuardedHostSession({
      db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, requestId,
      previewFingerprint: preview.previewFingerprint,
      operatorLaunch: { source: "fixture_standing", ...(standing ? { standing } : {}), ...(env ? { env } : {}) },
      profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters, tmux: rehearsal.tmux, now: rehearsal.now,
      capacityObservation: capacity(rehearsal.provider), agentWorktreeRoot: rehearsal.worktrees,
      providerSignIn: () => ({ signedIn: true, remedy: "" })
    }).session;
  });
}

const authorization = (rehearsal: Rehearsal, session: AgentSession) =>
  withReadOnlyDatabase(rehearsal.workspace, (db) => findOperatorLaunchAuthorization(db, session.id));

function expectRefusedBeforeLaunch(rehearsal: Rehearsal, run: () => unknown, code: string): void {
  let caught: { message: string; details?: { code?: string } } | undefined;
  try { run(); } catch (error) { caught = error as typeof caught; }
  expect(caught, "the launch must be refused").toBeDefined();
  expect(caught?.details?.code).toBe(code);
  expect(rehearsal.tmux.launches).toHaveLength(0);
  expect(rehearsal.lease()).toBeNull();
  const minted = withReadOnlyDatabase(rehearsal.workspace, (db) =>
    db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = 'operator_launch.authorization_minted'").get() as { n: number });
  expect(minted.n).toBe(0);
}

describe("--fixture-standing mints the one-shot authorization for a registered fixture", () => {
  it("mints for the registered fixture remote with an answered Decision, recording the Decision, answer and agent", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const session = launch(rehearsal);

    const row = authorization(rehearsal, session)!;
    expect(row).toMatchObject({ session_id: session.id, source: "fixture_standing", used_at: null, publish_state: "none" });
    expect(JSON.parse(row.standing_json!)).toMatchObject({
      decisionId: "0100", decisionAnswer: ANSWER_MERGE, agentIdentity: "claude-test", fixtureBasis: "registered_fixture_remote", remotes: [FIXTURE_REMOTE]
    });
    const minted = withReadOnlyDatabase(rehearsal.workspace, (db) =>
      (db.prepare("SELECT payload_json FROM events WHERE event_type = 'operator_launch.authorization_minted'").all() as Array<{ payload_json: string }>)
        .map((event) => JSON.parse(event.payload_json) as Record<string, unknown>));
    expect(minted).toEqual([expect.objectContaining({
      authorizationId: row.id, source: "fixture_standing", mintKind: "fixture_standing",
      standing: expect.objectContaining({ decisionId: "0100", agentIdentity: "claude-test" })
    })]);
    expect(rehearsal.tmux.launches).toHaveLength(1);
  });

  it("also accepts the 'you merge' answer", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", "Standing fixture launch, you merge");
    expect(authorization(rehearsal, launch(rehearsal))?.source).toBe("fixture_standing");
  });

  it("exits through the same path as a confirmed Launch: commit, push, one DRAFT PR, never a merge, standing fields in the receipt", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const session = launch(rehearsal);
    rehearsal.agentEdit(session, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(session, CRITERIA_A);
    rehearsal.tmux.exit(session.tmux_session_name);

    const exited = rehearsal.tick();
    expect(exited.reconciled.map((entry) => entry.outcome)).toEqual(["accepted_completion"]);
    expect(exited.handoff?.preservation).toMatchObject({ kind: "preserved", state: "PUSHED" });
    expect(rehearsal.github.prs).toHaveLength(1);
    expect(rehearsal.github.prs[0]).toMatchObject({ branch: session.branch, baseBranch: "main", isDraft: true });
    expect(exited.handoff?.integration.kind).toBe("refused");
    expect(rehearsal.github.ghCalls.some((call) => / merge\b/.test(call) || call.startsWith("gh pr ready"))).toBe(false);

    const used = authorization(rehearsal, session)!;
    expect(used).toMatchObject({ outcome: "accepted_completion", publish_state: "done", publish_attempts: 1 });
    expect(JSON.parse(used.receipt_json!)).toMatchObject({
      mintKind: "fixture_standing", standing: { decisionId: "0100", agentIdentity: "claude-test" }, merged: false
    });
  });
});

describe("--fixture-standing refusals (each before anything is launched)", () => {
  it("refuses while Decision 0100 is open", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "open", null);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_decision_unanswered");
  });

  it("refuses 'Not now' and any other answer", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", "Not now");
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_decision_unanswered");
  });

  it("refuses when the workspace has no Decision 0100 to read", () => {
    const rehearsal = fixture();
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_decision_unanswered");
  });

  it("refuses after 2026-10-18 (UTC) and accepts the last day", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const verify = (now: string) => withReadOnlyDatabase(rehearsal.workspace, (db) =>
      verifyFixtureStandingLaunch(db, { workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, agentIdentity: "a", env: {}, now: new Date(now) }));
    expect(verify("2026-10-18T23:59:59.000Z").fixtureBasis).toBe("registered_fixture_remote");
    expect(() => verify("2026-10-19T00:00:00.000Z")).toThrow(/fixture_standing_expired/);
    rehearsal.now = new Date("2026-10-19T00:00:00.000Z");
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_expired");
  });

  it("refuses a repository whose remote is not a registered fixture (e.g. Arcadia's own)", () => {
    const rehearsal = fixture("https://github.com/pmark/arcadia.git");
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_not_a_fixture");
  });

  it("refuses a repository with no remote", () => {
    const rehearsal = fixture(null);
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_not_a_fixture");
  });

  it("refuses when any additional remote or push URL is not a fixture", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    git(rehearsal.repo, ["config", "remote.origin.pushurl", "git@github.com:pmark/arcadia.git"]);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_not_a_fixture");
  });

  it("refuses a name that only looks like the fixture", () => {
    expect(githubRepositoryOf("git@github.com:pmark/arcadia-three-action-rehearsal-20261004.git")).toBe("pmark/arcadia-three-action-rehearsal-20261004");
    expect(githubRepositoryOf("https://github.com/pmark/arcadia-three-action-rehearsal-20261004-evil")).not.toBe("pmark/arcadia-three-action-rehearsal-20261004");
    expect(githubRepositoryOf("https://evil.example/github.com/pmark/arcadia-three-action-rehearsal-20261004.git")).toBeNull();
  });

  it("refuses without an agent identity", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal, { agentIdentity: "  " }), "fixture_standing_agent_identity_required");
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal, null), "fixture_standing_agent_identity_required");
  });

  it("is still refused inside an Arcadia Session, exactly as every other mint", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal, { agentIdentity: "a" }, { [SESSION_ENV_MARKER]: "session_inside" }), "operator_launch_inside_session");
  });

  it("is never combined with the standing production policy grant", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const registries = loadPhase3Registries(rehearsal.workspace);
    expect(() => withDatabase(rehearsal.workspace, (db) => launchGuardedHostSession({
      db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, requestId: "x", standingPolicy: true,
      operatorLaunch: { source: "fixture_standing", standing: { agentIdentity: "a" } }, profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters
    }))).toThrow(/never under the standing production policy/);
  });

  it("an experiment workspace's fixture needs no allowlisted remote but still needs the answered Decision", () => {
    const rehearsal = fixture(null);
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const root = path.join(rehearsal.root, "experiment-ws");
    mkdirSync(path.join(root, "config"), { recursive: true });
    writeFileSync(path.join(root, "config", "arcadia.json"), JSON.stringify({ experiment: { enabled: true, allowedRepoRoot: "projects" } }));
    const verify = (repoRoot: string) => withReadOnlyDatabase(rehearsal.workspace, (db) =>
      verifyFixtureStandingLaunch(db, { workspace: root, repoRoot, projectSlug: "some-fixture", agentIdentity: "a", env: {}, now: rehearsal.now }));
    mkdirSync(path.join(root, "projects", "fx"), { recursive: true });
    expect(verify(path.join(root, "projects", "fx")).fixtureBasis).toBe("experiment_workspace");
    // A repository outside the experiment's allowed root is not covered by it.
    expect(() => verify(rehearsal.repo)).toThrow(/fixture_standing_not_a_fixture/);
  });
});

describe("the interactive path and storage are unchanged", () => {
  it("rebuilds a pre-Decision-0100 table once, keeping its rows", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    withDatabase(rehearsal.workspace, (db) => {
      db.exec(`CREATE TABLE operator_launch_authorizations (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, project_slug TEXT NOT NULL, plan_slug TEXT NOT NULL, action_id TEXT NOT NULL,
        repository_path TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('dashboard', 'cli_tty')), request_id TEXT NOT NULL,
        minted_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, outcome TEXT,
        publish_state TEXT NOT NULL DEFAULT 'none' CHECK (publish_state IN ('none', 'pending', 'done', 'failed')),
        publish_attempts INTEGER NOT NULL DEFAULT 0, receipt_json TEXT);`);
      db.prepare(`INSERT INTO operator_launch_authorizations (id, session_id, project_slug, plan_slug, action_id, repository_path, source, request_id, minted_at, expires_at)
                  VALUES ('olauth_old', 's1', 'p', 'pl', 'a', '/r', 'cli_tty', 'r', 't0', 't1')`).run();
      ensureOperatorLaunchSchema(db);
      ensureOperatorLaunchSchema(db);
      expect(db.prepare("SELECT id, source, standing_json FROM operator_launch_authorizations").all()).toEqual([{ id: "olauth_old", source: "cli_tty", standing_json: null }]);
    });
    expect(authorization(rehearsal, launch(rehearsal))?.source).toBe("fixture_standing");
  });
});

describe("arcadia session launch --fixture-standing (the real CLI)", () => {
  function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "session", "launch", "--repo", ".", "--request-id", "r1", "--json",
      "--workspace", path.join(tmpdir(), "arcadia-no-such-workspace-fixture-standing"), ...args], {
      cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ARCADIA_SESSION_ID: "", ...env }
    });
    const text = run.stdout.trim() || run.stderr.slice(Math.max(0, run.stderr.indexOf("{\n")));
    if (!text.startsWith("{")) throw new Error(`The CLI printed no JSON (status ${String(run.status)}): ${run.stderr.slice(0, 800)}`);
    return JSON.parse(text) as { ok: boolean; error?: { message: string; details?: { code?: string } } };
  }

  it("needs the previewed fingerprint, cannot be combined with --operator-launch, and --agent-identity needs the flag", () => {
    expect(runCli(["--fixture-standing", "--agent-identity", "a"]).error?.message).toMatch(/needs the previewed --preview-fingerprint/);
    expect(runCli(["--fixture-standing", "--operator-launch", "--preview-fingerprint", "f"]).error?.message).toMatch(/cannot be combined/);
    expect(runCli(["--agent-identity", "a", "--preview-fingerprint", "f"]).error?.message).toMatch(/applies only with --fixture-standing/);
  });
});
