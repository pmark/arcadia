import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProjectImportCommand, runProjectMetadataCommand } from "../src/commands/project.js";
import { runReviewApproveCommand, runReviewApproveFixturePacketCommand } from "../src/commands/review.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { createReviewItem } from "../src/db/repositories.js";
import { FIXTURE_PACKET_ANSWER } from "../src/sessions/fixturePacketApproval.js";
import { gitBlobSha, verifyDisposableFixtureTarget, type FetchDecisionFile } from "../src/sessions/fixtureStandingLaunch.js";
import { SESSION_ENV_MARKER } from "../src/sessions/operatorLaunch.js";
import { git, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Decision 0119: an agent may approve ONLY a build-packet Decision of a registered
 * disposable fixture, with no execution and no follow-up Decision, while Decision
 * 0119 is answered on GitHub main and until 2026-10-18. Hooks are function parameters only.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const FIXTURE_REMOTE = "https://github.com/pmark/arcadia-three-action-rehearsal-20261004.git";
const NOW = new Date("2026-10-10T12:00:00.000Z");

function decisionDoc(status: string, answer: string | null): string {
  return [
    "---", "arcadia: v1", "type: decision", 'id: "0119"',
    "slug: decide-whether-agents-may-approve-the-immutable-build-packet-of-an-action-in-a",
    "project: arcadia", `status: ${status}`,
    "question: Decide whether agents may approve the immutable build packet of an Action in a registered disposable fixture Project.",
    "gap_type: missing-decision", "gate_question: approval_boundary", `recommendation: ${FIXTURE_PACKET_ANSWER}`,
    "options:",
    `  - label: ${FIXTURE_PACKET_ANSWER}`, "    consequence: Agents approve fixture build packets.", "    recommended: true",
    "  - label: Not now", "    consequence: Nothing changes.", "    recommended: false",
    "confidence: high", "updated: 2026-10-10",
    ...(answer ? [`answer: ${answer}`, "decided: 2026-10-10"] : []),
    "---", "", "# Decision 0119: fixture packet approval", ""
  ].join("\n");
}

function fetchOf(text: string, shaOverride?: string): FetchDecisionFile {
  return () => {
    const bytes = Buffer.from(text);
    return { content: bytes.toString("base64").replace(/(.{60})/g, "$1\n"), sha: shaOverride ?? gitBlobSha(bytes) };
  };
}
const answered = fetchOf(decisionDoc("approved", FIXTURE_PACKET_ANSWER));

function fixture(remote: string | null = FIXTURE_REMOTE): { rehearsal: Rehearsal; packetId: string } {
  const rehearsal = new Rehearsal({ independentReviewers: "tick" });
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  const packetId = rehearsal.registerProject();
  if (remote) git(rehearsal.repo, ["remote", "set-url", "origin", remote]);
  else git(rehearsal.repo, ["remote", "remove", "origin"]);
  return { rehearsal, packetId };
}

const approve = (
  { rehearsal, packetId }: { rehearsal: Rehearsal; packetId: string },
  hooks: Parameters<typeof runReviewApproveFixturePacketCommand>[1] = {},
  options: { id?: string; agentIdentity?: string | null; execute?: boolean } = {}
) =>
  runReviewApproveFixturePacketCommand(
    {
      workspace: rehearsal.workspace, id: options.id ?? packetId, fixtureStanding: true, execute: options.execute,
      ...(options.agentIdentity === null ? {} : { agentIdentity: options.agentIdentity ?? "claude-test" })
    },
    { now: NOW, fetchDecision: answered, ...hooks }
  );

const counts = (rehearsal: Rehearsal) =>
  withReadOnlyDatabase(rehearsal.workspace, (db) => {
    const statuses = new Map((db.prepare("SELECT id, status FROM review_items").all() as Array<{ id: string; status: string }>).map((row) => [row.id, row.status]));
    return {
      reviews: (db.prepare("SELECT COUNT(*) AS n FROM review_items").get() as { n: number }).n,
      runs: (db.prepare("SELECT COUNT(*) AS n FROM execution_runs").get() as { n: number }).n,
      status: (id: string) => statuses.get(id)
    };
  });

function expectRefused(setup: { rehearsal: Rehearsal; packetId: string }, run: () => unknown, code: string): void {
  const before = counts(setup.rehearsal);
  let caught: { details?: { code?: string } } | undefined;
  try { run(); } catch (error) { caught = error as typeof caught; }
  expect(caught, "the approval must be refused").toBeDefined();
  expect(caught?.details?.code).toBe(code);
  const after = counts(setup.rehearsal);
  expect(after.reviews).toBe(before.reviews);
  expect(after.runs).toBe(before.runs);
  expect(after.status(setup.packetId)).toBe("open");
}

describe("review approve --fixture-standing (Decision 0119)", () => {
  it("approves a fixture build packet with no run and no follow-up Decision, recording a receipt", () => {
    const setup = fixture();
    const before = counts(setup.rehearsal);
    const response = approve(setup);

    expect(response.data.result.status).toBe("approved");
    expect(response.data.run).toBeNull();
    const after = counts(setup.rehearsal);
    expect(after.status(setup.packetId)).toBe("approved");
    expect(after.reviews).toBe(before.reviews);
    expect(after.runs).toBe(before.runs);

    const blob = gitBlobSha(Buffer.from(decisionDoc("approved", FIXTURE_PACKET_ANSWER)));
    withReadOnlyDatabase(setup.rehearsal.workspace, (db) => {
      const row = db.prepare("SELECT context_json, decision_note FROM review_items WHERE id = ?").get(setup.packetId) as { context_json: string; decision_note: string };
      expect(JSON.parse(row.context_json).fixturePacketApproval).toMatchObject({
        decisionId: "0119", decisionAnswer: FIXTURE_PACKET_ANSWER, decisionBlobSha: blob, agentIdentity: "claude-test",
        fixtureBasis: "registered_fixture_remote", remotes: [FIXTURE_REMOTE], approvedAt: NOW.toISOString()
      });
      expect(row.decision_note).toContain("claude-test");
      expect(row.decision_note).toContain(blob);
      const event = db.prepare("SELECT payload_json FROM events WHERE event_type = 'review.fixture_packet_approved'").get() as { payload_json: string };
      expect(JSON.parse(event.payload_json)).toMatchObject({ agentIdentity: "claude-test", decisionBlobSha: blob });
    });
  });

  it("is reachable through runReviewApproveCommand and refuses without an agent identity before any fetch", () => {
    const setup = fixture();
    let fetched = false;
    expectRefused(setup, () => approve(setup, { fetchDecision: () => { fetched = true; throw new Error("no"); } }, { agentIdentity: null }), "fixture_packet_agent_identity_required");
    expect(fetched).toBe(false);
    expectRefused(setup, () => runReviewApproveCommand({ workspace: setup.rehearsal.workspace, id: setup.packetId, fixtureStanding: true }), "fixture_packet_agent_identity_required");
  });

  it("refuses inside an Arcadia Session", () => {
    const setup = fixture();
    expectRefused(setup, () => approve(setup, { env: { [SESSION_ENV_MARKER]: "session-1" } }), "operator_launch_inside_session");
  });

  it("refuses after 2026-10-18 (UTC) and allows the last day", () => {
    const setup = fixture();
    expectRefused(setup, () => approve(setup, { now: new Date("2026-10-19T00:00:00.000Z") }), "fixture_packet_expired");
    expect(approve(setup, { now: new Date("2026-10-18T23:59:59.000Z") }).data.result.status).toBe("approved");
  });

  it("refuses when Decision 0119 is open, wrongly answered, unreachable, malformed or has a forged sha", () => {
    const setup = fixture();
    expectRefused(setup, () => approve(setup, { fetchDecision: fetchOf(decisionDoc("open", null)) }), "fixture_packet_decision_unanswered");
    expectRefused(setup, () => approve(setup, { fetchDecision: fetchOf(decisionDoc("approved", "Not now")) }), "fixture_packet_decision_unanswered");
    expectRefused(setup, () => approve(setup, { fetchDecision: () => { throw new Error("gh api failed (exit 1): HTTP 404"); } }), "fixture_packet_decision_unverifiable");
    expectRefused(setup, () => approve(setup, { fetchDecision: fetchOf("not a decision") }), "fixture_packet_decision_unverifiable");
    expectRefused(setup, () => approve(setup, { fetchDecision: fetchOf(decisionDoc("approved", FIXTURE_PACKET_ANSWER), "0".repeat(40)) }), "fixture_packet_decision_unverifiable");
    // Decision 0100's answer does not stand in for 0119.
    expectRefused(setup, () => approve(setup, { fetchDecision: fetchOf(decisionDoc("approved", "Standing fixture launch, with merge on green")) }), "fixture_packet_decision_unanswered");
  });

  it("refuses a Project whose repository is not a registered fixture, or has no remote", () => {
    const real = fixture("https://github.com/pmark/arcadia.git");
    expectRefused(real, () => approve(real), "fixture_packet_not_a_fixture");
    const rewritten = fixture();
    git(rewritten.rehearsal.repo, ["config", "url.https://github.com/pmark/arcadia.git.insteadOf", FIXTURE_REMOTE]);
    expectRefused(rewritten, () => approve(rewritten), "fixture_packet_not_a_fixture");
    const none = fixture(null);
    expectRefused(none, () => approve(none), "fixture_packet_not_a_fixture");
  });

  it("refuses when the packet's Action belongs to a different Project than the Decision's", () => {
    const setup = fixture();
    const other = runProjectImportCommand({
      workspace: setup.rehearsal.workspace, name: "Other Project", mission: "Not the fixture.", status: "active",
      milestone: "m", nextAction: "n", classification: "agent"
    });
    withDatabase(setup.rehearsal.workspace, (db) => {
      db.prepare("UPDATE work_items SET project_id = ? WHERE id = (SELECT work_item_id FROM review_items WHERE id = ?)").run(other.data.project.id, setup.packetId);
    });
    expectRefused(setup, () => approve(setup), "fixture_packet_not_a_fixture");
  });

  it("accepts an experiment workspace's repository through the command, with no allowlisted remote", () => {
    const setup = fixture(null);
    const workspace = setup.rehearsal.workspace;
    mkdirSync(path.join(workspace, "config"), { recursive: true });
    writeFileSync(path.join(workspace, "config", "arcadia.json"), JSON.stringify({ experiment: { enabled: true, allowedRepoRoot: "projects" } }));
    const fx = path.join(workspace, "projects", "fx");
    mkdirSync(fx, { recursive: true });
    git(fx, ["init", "-q", "-b", "main"]);
    runProjectMetadataCommand({ workspace, projectId: setup.rehearsal.projectId, repoPath: fx });
    const response = approve(setup);
    expect(response.data.result.status).toBe("approved");
    withReadOnlyDatabase(setup.rehearsal.workspace, (db) => {
      const row = db.prepare("SELECT context_json FROM review_items WHERE id = ?").get(setup.packetId) as { context_json: string };
      expect(JSON.parse(row.context_json).fixturePacketApproval).toMatchObject({ fixtureBasis: "experiment_workspace", remotes: [] });
    });
  });

  it("never treats Arcadia's own Project as a fixture", () => {
    let code: string | undefined;
    try {
      verifyDisposableFixtureTarget("/nonexistent", "/nonexistent", "Arcadia", (reason, details) => {
        throw Object.assign(new Error(reason), { details: { code: "own", ...details } });
      });
    } catch (error) {
      code = (error as { details?: { code?: string } }).details?.code;
    }
    expect(code).toBe("own");
  });

  it("approves only build packets: a planning-run or other Decision is refused", () => {
    const setup = fixture();
    const other = withDatabase(setup.rehearsal.workspace, (db) => createReviewItem(db, {
      projectId: null, decisionNeeded: "Approve a planning run.", recommendation: "r", sourceInput: "s", proposedAction: "p",
      resolvedIntent: "CodexPlanningApproval", confidenceLabel: "high", confidence: 1, missingFields: [], context: {}
    }));
    const before = counts(setup.rehearsal);
    let caught: { details?: { code?: string } } | undefined;
    try { approve(setup, {}, { id: other.id }); } catch (error) { caught = error as typeof caught; }
    expect(caught?.details?.code).toBe("fixture_packet_not_a_build_packet");
    expect(counts(setup.rehearsal).status(other.id)).toBe("open");
    expect(counts(setup.rehearsal).runs).toBe(before.runs);
  });

  it("refuses --execute and an already-decided packet", () => {
    const setup = fixture();
    expectRefused(setup, () => approve(setup, {}, { execute: true }), "fixture_packet_flag_conflict");
    approve(setup);
    expect(() => approve(setup)).toThrow(/already decided/);
  });
});
