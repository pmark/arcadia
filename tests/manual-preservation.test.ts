import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureGit, preservationFixture } from "../scripts/preservation-fixture.js";
import { withDatabase } from "../src/db/connection.js";
import { runAdvanceCommand } from "../src/commands/advance.js";
import { runGoCommand } from "../src/commands/go.js";
import { bindManualPreservation, assertManualPreservationBinding } from "../src/sessions/manualPreservation.js";
import { processPreservationRequests, requestCandidatePreservation } from "../src/sessions/preservationTransport.js";
import * as validation from "../src/sessions/preservationValidation.js";
import { snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import * as preserve from "../src/commands/preserve.js";
import { runPreserveCommand } from "../src/commands/preserve.js";

const fixtures: ReturnType<typeof preservationFixture>[] = [];
function fixture(command?: string) {
  const f = preservationFixture(undefined, command); fixtures.push(f);
  withDatabase(f.workspace, db => {
    db.prepare("DELETE FROM agent_sessions").run();
    db.prepare("UPDATE production_policy SET desired_state = 'inactive', scope_json = NULL, authority_json = NULL").run();
  });
  rmSync(path.join(f.workspace, f.lease.packet_path));
  return f;
}
function bind(f: ReturnType<typeof fixture>) {
  return withDatabase(f.workspace, db => bindManualPreservation(db, {
    repository: f.repo, worktree: f.candidate, baseBranch: "main", projectSlug: "preservation-fixture"
  }));
}
beforeEach(() => vi.stubEnv("CODEX_SANDBOX", ""));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    rmSync(f.candidate, { recursive: true, force: true }); rmSync(f.root, { recursive: true, force: true });
  }
});

describe("manual Go preservation binding", () => {
  it("prepares a preservable manual Go handoff with no Session, packet or production grant", () => {
    const f = fixture();
    const result = runGoCommand({ repo: f.repo, apply: true, agent: "codex", workspace: f.workspace,
      agentWorktreeRoot: path.join(f.root, "handoffs") });
    expect(result.data.session).toBeNull();
    expect(result.data.preservation).toMatchObject({ kind: "manual_handoff", ready: true, operatorDecisionRequired: false });
    expect(runAdvanceCommand({ workspace: f.workspace, repo: result.data.nextWorktree!.path }).data.preservation)
      .toMatchObject({ kind: "manual_handoff", ready: true });
    expect(fixtureGit(result.data.nextWorktree!.path, ["rev-parse", "HEAD"])).toBe(f.base);
    withDatabase(f.workspace, db => {
      expect(db.prepare("SELECT count(*) AS n FROM agent_sessions").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT desired_state FROM production_policy").get()).toEqual({ desired_state: "inactive" });
    });
  });
  it("wires manual validation to one local commit and replay without a remote call", () => {
    const f = fixture();
    // Deterministic wiring proof only; the separate host suite proves Seatbelt.
    const validator = vi.spyOn(validation, "validateBoundCandidate").mockImplementation((_workspace, candidate, binding, assertBinding) => {
      assertBinding();
      return { passed: true, evidenceRef: "fixture-validation-only", candidateFingerprint: snapshotCandidate(candidate.worktree), binding };
    });
    const remote = { hasRemote: vi.fn(), push: vi.fn(), findPullRequest: vi.fn(), upsertDraftPullRequest: vi.fn() };
    const result = runPreserveCommand({ source: f.candidate, workspace: f.workspace, deps: { remote } }).data.receipt;
    expect(result).toMatchObject({ authorityKind: "manual_handoff", preservationState: "LOCAL ONLY", policyEpoch: 0 });
    expect(runPreserveCommand({ source: f.candidate, workspace: f.workspace }).data.receipt.commitSha).toBe(result.commitSha);
    expect(fixtureGit(f.candidate, ["rev-list", "--count", "main..HEAD"])).toBe("1");
    expect(validator).toHaveBeenCalledTimes(2);
    expect(remote.hasRemote).not.toHaveBeenCalled();
  });
  it("recovers an existing reservation once and replays the same binding", () => {
    const f = fixture(); const before = readFileSync(path.join(f.repo, "PROJECT.md"));
    const first = bind(f); expect(bind(f)).toEqual(first);
    expect(first.commands).toEqual(["node check.mjs"]);
    expect(readFileSync(path.join(f.repo, "PROJECT.md"))).toEqual(before);
    withDatabase(f.workspace, db => expect(db.prepare("SELECT count(*) AS n FROM manual_preservation_bindings").get()).toEqual({ n: 1 }));
  });
  it("publishes a manual reservation as a host transport route without fabricating a Session", () => {
    const f = fixture();
    withDatabase(f.workspace, db => processPreservationRequests(db, f.workspace));
    const heartbeat = JSON.parse(readFileSync(path.join(f.workspace, ".arcadia/preservation.heartbeat"), "utf8"));
    expect(heartbeat.sessions).toEqual([]);
    expect(heartbeat.handoffs).toEqual([{ id: expect.any(String), worktree: f.candidate }]);
  });
  it("routes a manual client request to the same host preservation command", async () => {
    const f = fixture();
    vi.stubEnv("ARCADIA_WORKSPACE", f.workspace);
    const response = { ok: true, command: "preserve", data: { receipt: { commitSha: "fixture-only" } } };
    const host = vi.spyOn(preserve, "runPreserveCommand").mockReturnValue(response as never);
    withDatabase(f.workspace, db => processPreservationRequests(db, f.workspace));
    const pending = requestCandidatePreservation(f.candidate);
    withDatabase(f.workspace, db => processPreservationRequests(db, f.workspace));
    await expect(pending).resolves.toEqual(response);
    expect(host).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: f.candidate, workspace: f.workspace }));
  });
  it("refuses a stale base or switched candidate branch", () => {
    const f = fixture(); const binding = bind(f);
    fixtureGit(f.candidate, ["switch", "-c", "codex/other"]);
    withDatabase(f.workspace, db => expect(() => assertManualPreservationBinding(db, binding)).toThrow(/Git binding changed/));
  });
  it("reports missing checks as configuration, not another planning approval", () => {
    const f = fixture();
    withDatabase(f.workspace, db => db.prepare("UPDATE project_metadata SET validation_commands = '[]'").run());
    expect(() => bind(f)).toThrow(/validation_commands; a planning approval is not the remedy/);
    const result = runGoCommand({ repo: f.repo, apply: true, agent: "codex", workspace: f.workspace,
      agentWorktreeRoot: path.join(f.root, "handoffs") });
    expect(result.data.preservation).toMatchObject({ ready: false, operatorDecisionRequired: false,
      blockers: expect.arrayContaining([expect.objectContaining({ code: "validation_commands_missing" })]) });
  });
  it("refuses changed check definitions and changed Action authority", () => {
    const f = fixture(); const binding = bind(f);
    withDatabase(f.workspace, db => {
      db.prepare("UPDATE project_metadata SET validation_commands = '[\"true\"]'").run();
      expect(() => assertManualPreservationBinding(db, binding)).toThrow(/definitions changed/);
      db.prepare("UPDATE project_metadata SET validation_commands = '[\"node check.mjs\"]'").run();
      const plan = path.join(f.repo, "docs/plans/proof.md");
      writeFileSync(plan, readFileSync(plan, "utf8").replace("Marker is ready.", "Different requirement."));
      expect(() => assertManualPreservationBinding(db, binding)).toThrow(/Action authority changed/);
    });
  });
  it("refuses expired reservations and sandbox callers", () => {
    const f = fixture(); const binding = bind(f);
    vi.stubEnv("CODEX_SANDBOX", "seatbelt");
    expect(() => bind(f)).toThrow(/host controller/);
    vi.stubEnv("CODEX_SANDBOX", "");
    withDatabase(f.workspace, db => {
      db.prepare("UPDATE agent_worktree_reservations SET expires_at = '2000-01-01'").run();
      expect(() => assertManualPreservationBinding(db, binding)).toThrow(/expired/);
    });
  });
});

describe.skipIf(process.env.ARCADIA_PRESERVATION_HOST_TEST !== "1")("manual preservation real host boundary", () => {
  it("validates and preserves one local candidate, with replay and no production activation", () => {
    const f = fixture();
    const result = runPreserveCommand({ source: f.candidate, workspace: f.workspace }).data.receipt;
    expect(result.preservationState).toBe("LOCAL ONLY");
    expect(result.policyEpoch).toBe(0);
    expect(fixtureGit(f.candidate, ["rev-parse", `${result.commitSha}^{tree}`])).toBe(result.candidateFingerprint);
    expect(runPreserveCommand({ source: f.candidate, workspace: f.workspace }).data.receipt.commitSha).toBe(result.commitSha);
    writeFileSync(path.join(f.candidate, "marker.txt"), "broken\n");
    expect(() => runPreserveCommand({ source: f.candidate, workspace: f.workspace })).toThrow(/validation failed/);
  });
});
