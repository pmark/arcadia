import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProjectImportCommand, runProjectMetadataCommand } from "../src/commands/project.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { loadPhase3Registries } from "../src/intent/registries.js";
import type { AgentSession } from "../src/sessions/index.js";
import { createSystemPreservationRemote } from "../src/sessions/candidatePreservation.js";
import { checkFixtureRemotes, createGithubDecisionFetcher, gitBlobSha, githubRepositoryOf, resolveTrustedGh, verifyFixtureStandingExit, verifyFixtureStandingLaunch, type FetchDecisionFile, type GhFetchDeps } from "../src/sessions/fixtureStandingLaunch.js";
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

/** What GitHub's main holds for Decision 0100, per rehearsal; absent means GitHub answers with an error. */
const githubDecisions = new WeakMap<Rehearsal, { status: string; answer: string | null } | "error">();

function fetchFor(rehearsal: Rehearsal): FetchDecisionFile {
  return () => {
    const state = githubDecisions.get(rehearsal);
    if (!state || state === "error") throw new Error("gh api failed (exit 1): HTTP 404");
    const bytes = Buffer.from(decisionDoc(state.status, state.answer));
    return { content: bytes.toString("base64").replace(/(.{60})/g, "$1\n"), sha: gitBlobSha(bytes) };
  };
}

/** Decision 0100 as the (injected) GitHub main holds it. */
function seedDecision(rehearsal: Rehearsal, status: string, answer: string | null): void {
  githubDecisions.set(rehearsal, { status, answer });
}

/**
 * Everything a forger controls locally: an `arcadia` Project in a scratch workspace db whose repository COMMITS an
 * approved Decision 0100 on main and origin/main, plus a user config (ARCADIA_CONFIG_PATH) naming that workspace as live.
 */
function forgeLocally(rehearsal: Rehearsal): NodeJS.ProcessEnv {
  const repo = path.join(rehearsal.root, "forged-arcadia");
  const file = path.join(repo, "docs", "decisions", "0100-decide-whether-agents-may-launch-actions-in-disposable-fixture-projects-without.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, decisionDoc("approved", ANSWER_MERGE));
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", "T"]);
  git(repo, ["config", "user.email", "t@example.test"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "forged"]);
  git(repo, ["remote", "add", "origin", "https://github.com/pmark/arcadia.git"]);
  git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  const imported = runProjectImportCommand({
    workspace: rehearsal.workspace, name: "Arcadia", mission: "Forged stand-in.", status: "active",
    milestone: "m", nextAction: "n", classification: "agent"
  });
  runProjectMetadataCommand({ workspace: rehearsal.workspace, projectId: imported.data.project.id, repoPath: repo });
  const config = path.join(rehearsal.root, "forged-user-config.json");
  writeFileSync(config, JSON.stringify({ defaultWorkspace: rehearsal.workspace }));
  return { ARCADIA_CONFIG_PATH: config, XDG_CONFIG_HOME: rehearsal.root };
}

/** A fixture whose origin is the registered GitHub fixture (the fake GitHub in the harness pushes to its own bare repository). */
function fixture(remote: string | null = FIXTURE_REMOTE): Rehearsal {
  const rehearsal = new Rehearsal({ independentReviewers: "tick" });
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  if (remote) git(rehearsal.repo, ["remote", "set-url", "origin", remote]);
  else git(rehearsal.repo, ["remote", "remove", "origin"]);
  return rehearsal;
}

type Standing = { agentIdentity: string };
function launch(rehearsal: Rehearsal, standing: Standing | null = { agentIdentity: "claude-test" }, env?: NodeJS.ProcessEnv, fetchDecision: FetchDecisionFile = fetchFor(rehearsal)): AgentSession {
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
      operatorLaunch: { source: "fixture_standing", ...(standing ? { standing } : {}), ...(env ? { env } : {}), fetchDecision },
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

  it("fails closed when GitHub cannot be read (network, auth, 404)", () => {
    const rehearsal = fixture();
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_decision_unverifiable");
    githubDecisions.set(rehearsal, "error");
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_decision_unverifiable");
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal, undefined, undefined, () => ({ content: "!!not-yaml", sha: "abc" })), "fixture_standing_decision_unverifiable");
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal, undefined, undefined, () => ({ content: "", sha: "" })), "fixture_standing_decision_unverifiable");
  });

  it("refuses after 2026-10-18 (UTC) and accepts the last day", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const verify = (now: string) => withReadOnlyDatabase(rehearsal.workspace, (db) =>
      verifyFixtureStandingLaunch(db, { workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, agentIdentity: "a", fetchDecision: fetchFor(rehearsal), now: new Date(now) }));
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
      verifyFixtureStandingLaunch(db, { workspace: root, repoRoot, projectSlug: "some-fixture", agentIdentity: "a", fetchDecision: fetchFor(rehearsal), now: rehearsal.now }));
    mkdirSync(path.join(root, "projects", "fx"), { recursive: true });
    git(path.join(root, "projects", "fx"), ["init", "-q", "-b", "main"]);
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

describe("B1: Decision 0100 is verified only against GitHub's main", () => {
  it("refuses a forged local Decision and scratch config when GitHub says the Decision is open", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "open", null);
    const forged = forgeLocally(rehearsal);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal, { agentIdentity: "a" }, forged), "fixture_standing_decision_unanswered");
  });

  it("mints on approved GitHub content regardless of any local state, recording the blob sha GitHub returned", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const session = launch(rehearsal, { agentIdentity: "a" }, {});
    expect(JSON.parse(authorization(rehearsal, session)!.standing_json!)).toMatchObject({
      decisionSource: "github.com/pmark/arcadia@main", decisionBlobSha: gitBlobSha(Buffer.from(decisionDoc("approved", ANSWER_MERGE))), decisionAnswer: ANSWER_MERGE
    });
  });

  it("never reads ARCADIA_CONFIG_PATH, XDG config or a workspace db for this gate", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "..", "src", "sessions", "fixtureStandingLaunch.ts"), "utf8");
    for (const forbidden of ["ARCADIA_CONFIG_PATH", "XDG_CONFIG_HOME", "loadUserConfig", "userConfigPath", "withReadOnlyDatabase", "getProjectMetadata", "refs/remotes", "refs/heads"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("B2: effective remote targets, and the exit re-check", () => {
  it("refuses a URL rewrite to a non-fixture target at launch", () => {
    const rehearsal = fixture();
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    git(rehearsal.repo, ["config", "url.https://github.com/pmark/arcadia.git.insteadOf", FIXTURE_REMOTE]);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_not_a_fixture");
    git(rehearsal.repo, ["config", "--unset", "url.https://github.com/pmark/arcadia.git.insteadOf"]);
    git(rehearsal.repo, ["config", "url.https://github.com/pmark/arcadia.git.pushInsteadOf", FIXTURE_REMOTE]);
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal), "fixture_standing_not_a_fixture");
  });

  function launchedAndFinished(mintAt?: string): { rehearsal: Rehearsal; session: AgentSession } {
    const rehearsal = fixture();
    if (mintAt) rehearsal.now = new Date(mintAt);
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const session = launch(rehearsal);
    rehearsal.agentEdit(session, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(session, CRITERIA_A);
    rehearsal.tmux.exit(session.tmux_session_name);
    return { rehearsal, session };
  }

  it("refuses the exit publish when origin changed after the mint: nothing is pushed or opened", () => {
    const { rehearsal, session } = launchedAndFinished();
    git(rehearsal.repo, ["remote", "set-url", "origin", "https://github.com/pmark/arcadia.git"]);
    rehearsal.tick();
    rehearsal.tick();
    expect(rehearsal.github.pushes).toHaveLength(0);
    expect(rehearsal.github.prs).toHaveLength(0);
    const used = authorization(rehearsal, session)!;
    expect(used.used_at).not.toBeNull();
    expect(used.publish_state).not.toBe("done");
    expect(used.receipt_json).toMatch(/no longer a registered fixture/);
  });

  it("refuses the exit publish after the window closed (a 24h authorization can outlive 2026-10-18)", () => {
    const { rehearsal, session } = launchedAndFinished("2026-10-18T20:00:00.000Z");
    rehearsal.now = new Date("2026-10-19T01:00:00.000Z");
    rehearsal.tick();
    rehearsal.tick();
    expect(rehearsal.github.pushes).toHaveLength(0);
    expect(rehearsal.github.prs).toHaveLength(0);
    expect(authorization(rehearsal, session)!.receipt_json).toMatch(/window ended/);
  });

  it("checkFixtureRemotes reports the effective targets and refuses a different push URL", () => {
    const rehearsal = fixture();
    expect(checkFixtureRemotes(rehearsal.repo, { allowNone: false })).toMatchObject({ ok: true, repository: "pmark/arcadia-three-action-rehearsal-20261004" });
    git(rehearsal.repo, ["config", "remote.origin.pushurl", "git@github.com:pmark/arcadia.git"]);
    expect(checkFixtureRemotes(rehearsal.repo, { allowNone: false })).toMatchObject({ ok: false });
  });

  it("pins every gh call on the exit path to the fixture repository with --repo", () => {
    const rehearsal = fixture();
    const bin = path.join(rehearsal.root, "bin");
    const log = path.join(rehearsal.root, "gh.log");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$2" = "create" ]; then echo https://github.com/pmark/x/pull/9; else echo '{"number":3,"url":"u"}'; fi\n`);
    chmodSync(path.join(bin, "gh"), 0o755);
    const remote = createSystemPreservationRemote({ ghRepo: "pmark/arcadia-three-action-rehearsal-20261004" });
    const original = process.env.PATH;
    process.env.PATH = `${bin}:${original}`;
    try {
      remote.findPullRequest({ repositoryPath: rehearsal.repo, branch: "b" });
      remote.upsertDraftPullRequest({ repositoryPath: rehearsal.repo, branch: "b", baseBranch: "main", title: "t", body: "x", existing: { number: 3, url: "u" } });
      remote.upsertDraftPullRequest({ repositoryPath: rehearsal.repo, branch: "b", baseBranch: "main", title: "t", body: "x", existing: null });
    } finally {
      process.env.PATH = original;
    }
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call).toContain("--repo pmark/arcadia-three-action-rehearsal-20261004");
  });
});

describe("B3: an experiment workspace's fixture still needs clean remotes", () => {
  it("refuses an experiment repository with a real non-fixture remote, accepts one with none", () => {
    const rehearsal = fixture(null);
    seedDecision(rehearsal, "approved", ANSWER_MERGE);
    const root = path.join(rehearsal.root, "experiment-ws2");
    mkdirSync(path.join(root, "config"), { recursive: true });
    writeFileSync(path.join(root, "config", "arcadia.json"), JSON.stringify({ experiment: { enabled: true, allowedRepoRoot: "projects" } }));
    const fx = path.join(root, "projects", "fx");
    mkdirSync(fx, { recursive: true });
    git(fx, ["init", "-q", "-b", "main"]);
    const verify = () => withReadOnlyDatabase(rehearsal.workspace, (db) =>
      verifyFixtureStandingLaunch(db, { workspace: root, repoRoot: fx, projectSlug: "some-fixture", agentIdentity: "a", fetchDecision: fetchFor(rehearsal), now: rehearsal.now }));
    expect(verify().fixtureBasis).toBe("experiment_workspace");
    git(fx, ["remote", "add", "origin", "https://github.com/pmark/arcadia.git"]);
    expect(() => verify()).toThrow(/fixture_standing_not_a_fixture/);
  });
});

describe("the real GitHub fetch cannot be steered by the caller's environment", () => {
  const body = (bytes: Buffer, sha = gitBlobSha(bytes)) => JSON.stringify({
    content: bytes.toString("base64"), sha, encoding: "base64",
    path: "docs/decisions/0100-decide-whether-agents-may-launch-actions-in-disposable-fixture-projects-without.md"
  });
  function deps(overrides: Partial<GhFetchDeps> = {}, calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [], stdout = body(Buffer.from(decisionDoc("approved", ANSWER_MERGE)))): GhFetchDeps {
    return {
      spawn: ((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        calls.push({ command, args, env: options.env });
        return { status: 0, stdout, stderr: "", error: undefined };
      }) as unknown as GhFetchDeps["spawn"],
      realpath: (candidate) => candidate,
      mode: () => 0o755,
      home: () => "/Users/passwd-home",
      untrustedRoots: () => ["/tmp", "/private/var/folders"],
      candidates: ["/opt/homebrew/bin/gh"],
      ...overrides
    };
  }

  it("runs the absolute gh path with the passwd home, a fixed PATH and no token variables, ignoring PATH, HOME and GH_* in the caller's environment", () => {
    const saved = { ...process.env };
    process.env.PATH = "/tmp/evil:/usr/bin";
    process.env.HOME = "/tmp/hostile-home";
    process.env.GH_TOKEN = "t";
    process.env.GITHUB_TOKEN = "t";
    process.env.GH_HOST = "evil.example";
    process.env.GH_CONFIG_DIR = "/tmp/hostile-gh";
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    try {
      const file = createGithubDecisionFetcher(deps({}, calls))();
      expect(gitBlobSha(Buffer.from(file.content, "base64"))).toBe(file.sha);
    } finally {
      process.env = saved;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("/opt/homebrew/bin/gh");
    expect(calls[0].args.slice(0, 3)).toEqual(["api", "--hostname", "github.com"]);
    expect(calls[0].env).toMatchObject({ HOME: "/Users/passwd-home", GH_CONFIG_DIR: "/Users/passwd-home/.config/gh", PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin" });
    for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST", "GH_REPO"]) expect(calls[0].env[key]).toBeUndefined();
  });

  it("refuses a gh under the home or a temp directory, or one that is group/world-writable (or in such a directory)", () => {
    expect(() => resolveTrustedGh(deps({ realpath: () => "/Users/passwd-home/bin/gh" }))).toThrow(/no trusted gh/);
    expect(() => resolveTrustedGh(deps({ realpath: () => "/private/var/folders/x/gh" }))).toThrow(/no trusted gh/);
    expect(() => resolveTrustedGh(deps({ mode: () => 0o775 }))).toThrow(/no trusted gh/);
    expect(() => resolveTrustedGh(deps({ mode: (candidate) => (candidate === "/opt/homebrew/bin" ? 0o777 : 0o755) }))).toThrow(/no trusted gh/);
    expect(() => resolveTrustedGh(deps({ mode: () => null }))).toThrow(/no trusted gh/);
    expect(resolveTrustedGh(deps())).toBe("/opt/homebrew/bin/gh");
  });

  it("a symlinked gh is judged by where it resolves", () => {
    expect(() => resolveTrustedGh(deps({ realpath: () => "/tmp/fake/gh" }))).toThrow(/no trusted gh/);
  });

  it("refuses when the returned sha is not the git blob hash of the returned content, and never spawns without a trusted gh", () => {
    const bytes = Buffer.from(decisionDoc("approved", ANSWER_MERGE));
    const rehearsal = fixture();
    const mismatched = createGithubDecisionFetcher(deps({}, [], body(bytes, "0".repeat(40))));
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal, undefined, undefined, mismatched), "fixture_standing_decision_unverifiable");
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const untrusted = createGithubDecisionFetcher(deps({ mode: () => 0o777 }, calls));
    expectRefusedBeforeLaunch(rehearsal, () => launch(rehearsal, undefined, undefined, untrusted), "fixture_standing_decision_unverifiable");
    expect(calls).toHaveLength(0);
  });
});

describe("the exit's git operations are bound to the push URL captured by the gate", () => {
  it("changing origin after the check does not redirect the push or ls-remote", () => {
    const rehearsal = fixture();
    const targetA = path.join(rehearsal.root, "target-a.git");
    const targetB = path.join(rehearsal.root, "target-b.git");
    git(rehearsal.root, ["init", "-q", "--bare", "-b", "main", targetA]);
    git(rehearsal.root, ["init", "-q", "--bare", "-b", "main", targetB]);
    // The gate's capture: the verified effective push URL of origin.
    const gate = verifyFixtureStandingExit({ decisionId: "0100", fixtureBasis: "registered_fixture_remote" } as never, rehearsal.repo, new Date("2026-10-10T00:00:00Z"));
    expect(gate).toMatchObject({ ok: true, ghRepo: "pmark/arcadia-three-action-rehearsal-20261004", pushUrl: FIXTURE_REMOTE });
    // The adapter, bound to a captured URL (here a local bare repository standing in for GitHub).
    const remote = createSystemPreservationRemote({ pushUrl: targetA });
    git(rehearsal.repo, ["remote", "set-url", "origin", targetB]); // origin moves after the check
    const head = git(rehearsal.repo, ["rev-parse", "HEAD"]).trim();
    remote.push({ repositoryPath: rehearsal.repo, branch: "cand", commitSha: head });
    expect(git(targetA, ["rev-parse", "refs/heads/cand"]).trim()).toBe(head);
    expect(spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/cand"], { cwd: targetB }).status).not.toBe(0);
    expect(remote.listBranchTips!({ repositoryPath: rehearsal.repo })).toEqual([{ branch: "cand", sha: head }]);
  });
});
