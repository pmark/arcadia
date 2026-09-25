import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureGit, preservationFixture } from "../scripts/preservation-fixture.js";
import { withDatabase } from "../src/db/connection.js";
import { uncommittedChanges } from "../src/git/worktrees.js";
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
  describe("the preservation request marker is cleaned up by its own requester", () => {
    const marker = (f: ReturnType<typeof fixture>) => path.join(f.candidate, ".arcadia-preserve-request");
    const ready = (f: ReturnType<typeof fixture>) => {
      vi.stubEnv("ARCADIA_WORKSPACE", f.workspace);
      withDatabase(f.workspace, db => processPreservationRequests(db, f.workspace));
    };
    const service = (f: ReturnType<typeof fixture>) =>
      withDatabase(f.workspace, db => processPreservationRequests(db, f.workspace));

    it("clears the marker after a successful response, and it never trips a cleanliness check while pending", async () => {
      const f = fixture(); ready(f);
      const response = { ok: true, command: "preserve", data: { receipt: { commitSha: "fixture-only" } } };
      vi.spyOn(preserve, "runPreserveCommand").mockReturnValue(response as never);
      const pending = requestCandidatePreservation(f.candidate);
      expect(existsSync(marker(f))).toBe(true);
      expect(uncommittedChanges(f.candidate).join("\n")).not.toContain(".arcadia-preserve-request");
      service(f);
      await expect(pending).resolves.toEqual(response);
      expect(existsSync(marker(f))).toBe(false);
    });

    it("clears the marker when the host refuses", async () => {
      const f = fixture(); ready(f);
      vi.spyOn(preserve, "runPreserveCommand").mockImplementation(() => { throw new Error("host refused"); });
      const pending = requestCandidatePreservation(f.candidate);
      service(f);
      await expect(pending).rejects.toThrow();
      expect(existsSync(marker(f))).toBe(false);
      expect(uncommittedChanges(f.candidate).join("\n")).not.toContain(".arcadia-preserve-request");
    });

    it("clears the marker on timeout so an immediate retry is not blocked", async () => {
      vi.useFakeTimers();
      try {
        const f = fixture(); ready(f);
        const first = requestCandidatePreservation(f.candidate);
        const rejected = expect(first).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(1_230_000 + 500);
        await rejected;
        expect(existsSync(marker(f))).toBe(false);

        // A healthy tick republishes the projection, then the retry succeeds.
        service(f);
        const response = { ok: true, command: "preserve", data: { receipt: { commitSha: "fixture-only" } } };
        vi.spyOn(preserve, "runPreserveCommand").mockReturnValue(response as never);
        const retry = requestCandidatePreservation(f.candidate);
        expect(existsSync(marker(f))).toBe(true);
        service(f);
        await vi.advanceTimersByTimeAsync(500);
        await expect(retry).resolves.toEqual(response);
        expect(existsSync(marker(f))).toBe(false);
      } finally { vi.useRealTimers(); }
    });

    it("never removes a marker carrying another caller's nonce", async () => {
      vi.useFakeTimers();
      try {
        const f = fixture(); ready(f);
        const pending = requestCandidatePreservation(f.candidate);
        const rejected = expect(pending).rejects.toThrow("timed out");
        writeFileSync(marker(f), JSON.stringify({ nonce: randomUUID() }));
        await vi.advanceTimersByTimeAsync(1_230_000 + 500);
        await rejected;
        expect(existsSync(marker(f))).toBe(true);
      } finally { vi.useRealTimers(); }
    });

    it("leaves a tracked file at the reserved name alone", async () => {
      vi.useFakeTimers();
      try {
        const f = fixture(); ready(f);
        writeFileSync(marker(f), "tracked content");
        fixtureGit(f.candidate, ["add", "-f", ".arcadia-preserve-request"]);
        fixtureGit(f.candidate, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-m", "track marker"]);
        const pending = requestCandidatePreservation(f.candidate);
        const rejected = expect(pending).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(1_230_000 + 500);
        await rejected;
        expect(existsSync(marker(f))).toBe(true);
      } finally { vi.useRealTimers(); }
    });
  });
  it("refuses a stale base or switched candidate branch", () => {
    const f = fixture(); const binding = bind(f);
    fixtureGit(f.candidate, ["switch", "-c", "codex/other"]);
    withDatabase(f.workspace, db => expect(() => assertManualPreservationBinding(db, binding)).toThrow(/Git binding changed/));
  });
  const commitCandidateWork = (f: ReturnType<typeof fixture>) => {
    fixtureGit(f.candidate, ["add", "-A"]);
    fixtureGit(f.candidate, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-m", "candidate progress"]);
  };
  const commitOnBase = (f: ReturnType<typeof fixture>, file: string, content: string, message: string) => {
    writeFileSync(path.join(f.repo, file), content);
    fixtureGit(f.repo, ["add", file]);
    fixtureGit(f.repo, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-m", message]);
    return fixtureGit(f.repo, ["rev-parse", "HEAD"]);
  };
  it("accepts a binding whose base branch advanced cleanly", () => {
    const f = fixture(); const binding = bind(f);
    commitCandidateWork(f);
    commitOnBase(f, "unrelated.txt", "new\n", "advance base cleanly");
    withDatabase(f.workspace, db => expect(() => assertManualPreservationBinding(db, binding)).not.toThrow());
  });
  it("refuses a base advance that no longer merges cleanly, naming both revisions", () => {
    const f = fixture(); const binding = bind(f);
    commitCandidateWork(f);
    const newBase = commitOnBase(f, "marker.txt", "stale\n", "conflicting base change");
    withDatabase(f.workspace, db => expect(() => assertManualPreservationBinding(db, binding))
      .toThrow(new RegExp(`${f.base}.*${newBase}.*no longer merges cleanly`)));
  });
  it("preserves a binding for an Action that is no longer the current pointer", () => {
    const f = fixture(); const binding = bind(f);
    const rewriteFrontmatter = (relativePath: string, mutate: (fm: any) => void) => {
      const file = path.join(f.repo, relativePath);
      const fm = YAML.parse(readFileSync(file, "utf8").slice(4, -4));
      mutate(fm);
      writeFileSync(file, `---\n${YAML.stringify(fm)}---\n`);
    };
    rewriteFrontmatter("docs/plans/proof.md", fm => {
      fm.actions.push({
        id: "second-action", title: "Second action", status: "open", responsibility: "agent",
        effort: "session", clarification: "clarified", next_action: "Do the second thing.",
        expected_artifact: "second.txt", acceptance_criteria: ["Second thing done."],
        depends_on: [], decisions: [], references: []
      });
      fm.current_action = "second-action";
    });
    rewriteFrontmatter("PROJECT.md", fm => { fm.current_action = "second-action"; });
    withDatabase(f.workspace, db => expect(() => assertManualPreservationBinding(db, binding)).not.toThrow());
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
  it("names the dependency remedy instead of reporting a runnable readiness", () => {
    const f = fixture();
    withDatabase(f.workspace, db => db.prepare("UPDATE project_metadata SET validation_commands = '[\"pnpm test\"]'").run());
    expect(() => bind(f)).toThrow(/needs installed dependencies/);
    const result = runGoCommand({ repo: f.repo, apply: true, agent: "codex", workspace: f.workspace,
      agentWorktreeRoot: path.join(f.root, "handoffs") });
    expect(result.data.preservation).toMatchObject({ ready: false, operatorDecisionRequired: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "validation_requires_dependencies" }),
        expect.objectContaining({ code: "manual_binding_failed" })
      ]) });
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
