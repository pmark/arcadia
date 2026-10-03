import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyInitialSchema, applyMigrations } from "../src/db/schema.js";
import {
  allocateSessionRoleAttempt,
  attemptVerdictIsCurrent,
  enrollGovernedSession,
  nextDependencyReadyAction,
  recordSessionRoleAttemptTerminal,
  type EnrollmentDependencies,
  type EnrollmentRequest,
  type GovernedEnrollmentContext
} from "../src/sessions/enrollment.js";

const AT = new Date("2026-10-03T18:00:00.000Z");
const claim = { id: "claim-1", worktree: "/candidate", generation: "generation-1" };

describe("protected session enrollment", () => {
  let db: Database.Database;
  const context: GovernedEnrollmentContext = {
    projectSlug: "arcadia", planSlug: "flight-deck", actionId: "enroll",
    canonicalBrief: "canonical host brief", operatorGates: ["decision:0072"],
    packet: { invocationId: "packet-1", sha256: "a".repeat(64) },
    provider: "codex-cli", model: "gpt-5.6-sol", effort: "high",
    policyState: "active", policyEpoch: 12, packetApproved: true,
    capacityAvailable: true,
    existingClaim: null
  };
  const request: EnrollmentRequest = {
    requestId: "enroll-request-0001", source: "/repo", agent: "codex", callerId: "helper-0001",
    mode: "prepare", projectSlug: "arcadia", planSlug: "flight-deck", actionId: "enroll",
    requirementId: "requirement-1", inputRevision: "revision-1"
  };
  const dependencies = (overrides: Partial<GovernedEnrollmentContext> = {}) => ({
    resolve: vi.fn(() => ({ ...context, ...overrides })),
    prepare: vi.fn(() => ({ id: "claim-1", worktree: "/candidate", claim })),
    launch: vi.fn(() => ({ id: "session-1", worktree: "/candidate", claim, admission: { id: "adm-1", requestId: "enroll-request-0001:admission", epoch: 12, status: "committed" } })),
    rollback: vi.fn(),
    now: () => AT
  });
  const count = () => (db.prepare("SELECT count(*) count FROM session_enrollments").get() as { count: number }).count;
  const status = (requestId = request.requestId) =>
    (db.prepare("SELECT status FROM session_enrollments WHERE request_id = ?").get(requestId) as { status: string } | undefined)?.status;

  beforeEach(() => { db = new Database(":memory:"); applyInitialSchema(db); });
  afterEach(() => db.close());

  it("replays the original receipt and refuses changed caller, Action, mode or input before effects", () => {
    const deps = dependencies();
    const first = enrollGovernedSession(db, request, deps);
    const replay = enrollGovernedSession(db, request, deps);
    expect(replay).toEqual(first);
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    for (const changed of [
      { callerId: "helper-0002" }, { actionId: "other" }, { mode: "managed-launch" as const }, { inputRevision: "revision-2" },
      { agent: "claude" as const }, { source: "/other" }, { requirementId: "requirement-2" }, { planSlug: "other-plan" }
    ]) {
      expect(() => enrollGovernedSession(db, { ...request, ...changed }, deps))
        .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "enrollment_request_changed" }) }));
    }
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect(deps.launch).not.toHaveBeenCalled();
    expect(count()).toBe(1);
  });

  it("returns the canonical candidate, packet binding and fenced claim receipt without production authority", () => {
    const receipt = enrollGovernedSession(db, request, dependencies());
    expect(receipt).toMatchObject({
      requestId: request.requestId, canonicalBrief: "canonical host brief", operatorGates: ["decision:0072"],
      packet: { invocationId: "packet-1" },
      execution: { provider: "codex-cli", model: "gpt-5.6-sol", effort: "high" },
      claim,
      admission: null,
      principal: { kind: "prepared", id: "claim-1", worktree: "/candidate" }
    });
  });

  it("refuses to hand an existing claim to a second caller before any row is written", () => {
    const deps = dependencies({ existingClaim: claim });
    expect(() => enrollGovernedSession(db, request, deps))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "action_claimed" }) }));
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(count()).toBe(0);
  });

  it.each([
    [{ policyState: "off" as const }, "production_off"],
    [{ packetApproved: false }, "packet_approval_required"],
    [{ capacityAvailable: false }, "capacity_unavailable"],
    [{ actionId: "moved" }, "enrollment_governance_changed"],
    [{ existingClaim: claim }, "action_claimed"],
    [{ existingSession: { id: "session-other", worktree: "/other", actionId: "enroll" } }, "action_claimed"],
    [{ existingSession: { id: "session-other", worktree: "/other", actionId: "different" } }, "repository_leased"]
  ])("refuses managed launch preconditions without effects: %s", (override, code) => {
    const deps = dependencies(override);
    expect(() => enrollGovernedSession(db, { ...request, mode: "managed-launch" }, deps))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code }) }));
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.launch).not.toHaveBeenCalled();
    expect(count()).toBe(0);
  });

  it("records a failed effect with no own effect as failed, keeps its identity, and permits the exact retry", () => {
    const deps = dependencies();
    deps.prepare.mockImplementationOnce(() => { throw new Error("transport refused"); });
    expect(() => enrollGovernedSession(db, request, deps)).toThrow("transport refused");
    expect(deps.rollback).toHaveBeenCalledOnce();
    expect(status()).toBe("failed");
    // The failed record still binds the request id: a different mode is refused.
    expect(() => enrollGovernedSession(db, { ...request, mode: "managed-launch" }, deps))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "enrollment_request_changed" }) }));
    expect(enrollGovernedSession(db, request, deps).principal.id).toBe("claim-1");
    expect(status()).toBe("completed");
    expect(count()).toBe(1);
  });

  it("adopts an effect that committed even though its adapter then threw", () => {
    const deps = dependencies();
    deps.prepare.mockImplementationOnce(() => { throw new Error("claim committed, response lost"); });
    const recover = vi.fn(() => ({ id: "claim-1", worktree: "/candidate", claim }));
    const receipt = enrollGovernedSession(db, request, { ...deps, recover });
    expect(receipt.principal).toEqual({ kind: "prepared", id: "claim-1", worktree: "/candidate" });
    expect(deps.rollback).not.toHaveBeenCalled();
    expect(status()).toBe("completed");
  });

  it("keeps the row pending, never deleted, when the receipt write fails after a successful effect", () => {
    const deps = dependencies();
    deps.prepare.mockImplementationOnce(() => {
      db.exec(`CREATE TRIGGER fail_receipt BEFORE UPDATE OF receipt_json ON session_enrollments
        BEGIN SELECT RAISE(ABORT, 'simulated busy receipt write'); END`);
      return { id: "claim-1", worktree: "/candidate", claim };
    });
    expect(() => enrollGovernedSession(db, request, deps)).toThrow("simulated busy receipt write");
    db.exec("DROP TRIGGER fail_receipt");
    expect(status()).toBe("pending");
    const recover = vi.fn(() => ({ id: "claim-1", worktree: "/candidate", claim }));
    expect(enrollGovernedSession(db, request, { ...deps, recover }).principal.id).toBe("claim-1");
    expect(deps.prepare).toHaveBeenCalledOnce();
    expect(status()).toBe("completed");
  });

  it("refuses an unknown mode in the core before any row", () => {
    expect(() => enrollGovernedSession(db, { ...request, mode: "bogus" as never }, dependencies()))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "invalid_enrollment_mode" }) }));
    expect(count()).toBe(0);
  });

  it("fences concurrent enrollment of the same request or the same Action before a duplicate principal", () => {
    const deps = dependencies();
    deps.prepare.mockImplementation(() => {
      expect(() => enrollGovernedSession(db, request, deps)).toThrow("already in progress");
      expect(() => enrollGovernedSession(db, { ...request, requestId: "enroll-request-0002", callerId: "helper-0002" }, deps))
        .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "enrollment_in_progress" }) }));
      return { id: "claim-1", worktree: "/candidate", claim };
    });
    expect(enrollGovernedSession(db, request, deps).principal.id).toBe("claim-1");
    expect(deps.prepare).toHaveBeenCalledOnce();
  });

  it("fences a concurrent enrollment on a second database connection", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-enroll-race-")));
    const file = path.join(root, "arcadia.db");
    const first = new Database(file);
    const second = new Database(file);
    try {
      applyInitialSchema(first);
      const deps = dependencies();
      deps.prepare.mockImplementation(() => {
        expect(() => enrollGovernedSession(second, { ...request, requestId: "enroll-request-0002", callerId: "helper-0002" }, dependencies()))
          .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "enrollment_in_progress" }) }));
        expect(() => enrollGovernedSession(second, request, dependencies())).toThrow("already in progress");
        return { id: "claim-1", worktree: "/candidate", claim };
      });
      const receipt = enrollGovernedSession(first, request, deps);
      expect(enrollGovernedSession(second, request, dependencies())).toEqual(receipt);
      expect((second.prepare("SELECT count(*) count FROM session_enrollments").get() as { count: number }).count).toBe(1);
    } finally {
      first.close();
      second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Model a host child that died after its pending row was durable but before its receipt. */
  function crashAfterPending(pendingRequest: EnrollmentRequest = request) {
    const scratch = new Database(":memory:");
    applyInitialSchema(scratch);
    enrollGovernedSession(scratch, pendingRequest, dependencies());
    const fingerprint = (scratch.prepare("SELECT request_fingerprint FROM session_enrollments").get() as { request_fingerprint: string }).request_fingerprint;
    scratch.close();
    db.prepare(`INSERT INTO session_enrollments (request_id, request_fingerprint, project_slug, plan_slug, action_id, caller_id, mode,
      status, receipt_json, created_at, updated_at, lease_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`)
      .run(pendingRequest.requestId, fingerprint, context.projectSlug, context.planSlug, context.actionId, pendingRequest.callerId,
        pendingRequest.mode, AT.toISOString(), AT.toISOString(), new Date(AT.getTime() + 60_000).toISOString());
  }

  it("reconciles a pending exact request after restart onto its own effect without duplicating the principal", () => {
    const deps = dependencies();
    crashAfterPending();
    const recover = vi.fn(() => ({ id: "claim-1", worktree: "/candidate", claim }));
    const restarted = enrollGovernedSession(db, request, { ...deps, recover });
    expect(restarted.principal).toEqual({ kind: "prepared", id: "claim-1", worktree: "/candidate" });
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({ pending: expect.objectContaining({ createdAt: AT.toISOString(), effectClaimId: null }) }));
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(enrollGovernedSession(db, request, deps)).toEqual(restarted);
  });

  it("loses the takeover compare-and-set to a concurrent taker and never re-runs the effect", () => {
    const deps = dependencies();
    crashAfterPending();
    // Between this replay's lease read and its compare-and-set, another
    // connection takes the expired row over (renews its lease).
    const recover = vi.fn(() => {
      db.prepare("UPDATE session_enrollments SET lease_expires_at = ? WHERE request_id = ?")
        .run(new Date(AT.getTime() + 999_000).toISOString(), request.requestId);
      return null;
    });
    expect(() => enrollGovernedSession(db, request, { ...deps, recover, now: () => new Date(AT.getTime() + 61_000) }))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "enrollment_in_progress" }) }));
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(status()).toBe("pending");
  });

  it("lets a takeover finish while the original writer still runs, and the original then returns the same receipt", () => {
    const deps = dependencies();
    let nested: ReturnType<typeof enrollGovernedSession> | undefined;
    deps.prepare.mockImplementationOnce(() => {
      // The first writer outlives its lease; an exact replay takes over and completes.
      nested = enrollGovernedSession(db, request, { ...dependencies(), now: () => new Date(AT.getTime() + 400_000) });
      return { id: "claim-1", worktree: "/candidate", claim };
    });
    const outer = enrollGovernedSession(db, request, deps);
    expect(outer).toEqual(nested);
    expect(status()).toBe("completed");
    expect(count()).toBe(1);
  });

  it("keeps a live pending row fenced, then lets an exact replay take over once its lease expired with no effect", () => {
    const deps = dependencies();
    crashAfterPending();
    const recover = vi.fn(() => null);
    expect(() => enrollGovernedSession(db, request, { ...deps, recover }))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "enrollment_in_progress" }) }));
    expect(deps.prepare).not.toHaveBeenCalled();
    const later = { ...deps, recover, now: () => new Date(AT.getTime() + 61_000) };
    const taken = enrollGovernedSession(db, request, later);
    expect(taken.principal.id).toBe("claim-1");
    expect(deps.prepare).toHaveBeenCalledOnce();
    expect(enrollGovernedSession(db, request, later)).toEqual(taken);
  });

  it("fails an expired pending managed request with no own effect that now meets Off, replayable once On", () => {
    const managed = { ...request, requestId: "enroll-managed-0001", mode: "managed-launch" as const };
    crashAfterPending(managed);
    const off = { ...dependencies({ policyState: "off" }), recover: () => null, now: () => new Date(AT.getTime() + 61_000) };
    expect(() => enrollGovernedSession(db, managed, off))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "production_off" }) }));
    expect(off.launch).not.toHaveBeenCalled();
    expect(status(managed.requestId)).toBe("failed");
    const on = dependencies();
    expect(enrollGovernedSession(db, managed, on).principal).toEqual({ kind: "managed-session", id: "session-1", worktree: "/candidate" });
    expect(on.launch).toHaveBeenCalledOnce();
  });

  describe("a different caller and another request's pending row for the same Action", () => {
    const other = { ...request, requestId: "enroll-request-0009", callerId: "helper-0009" };

    it("is still blocked by a live pending row, named with its remedy", () => {
      crashAfterPending();
      expect(() => enrollGovernedSession(db, other, { ...dependencies(), recover: () => null })).toThrow(expect.objectContaining({
        details: expect.objectContaining({ code: "enrollment_in_progress", blockingRequestId: request.requestId, remedy: expect.any(String) })
      }));
      expect(status()).toBe("pending");
      expect(status(other.requestId)).toBeUndefined();
    });

    it("frees an expired row whose dead caller left no effect, keeping it as a failed record", () => {
      crashAfterPending();
      const deps = { ...dependencies(), recover: vi.fn(() => null), now: () => new Date(AT.getTime() + 61_000) };
      expect(enrollGovernedSession(db, other, deps).principal.id).toBe("claim-1");
      expect(deps.recover).toHaveBeenCalledWith(expect.objectContaining({ pending: expect.objectContaining({ requestId: request.requestId }) }));
      expect(status()).toBe("failed");
      expect(status(other.requestId)).toBe("completed");
      expect(deps.prepare).toHaveBeenCalledOnce();
    });

    it("never frees an Action whose expired row has a proven effect to a second owner", () => {
      crashAfterPending();
      const recover = vi.fn(({ pending }: { pending: { requestId: string } }) =>
        pending.requestId === request.requestId ? { id: "claim-1", worktree: "/candidate", claim } : null);
      const deps = { ...dependencies(), recover, now: () => new Date(AT.getTime() + 61_000) };
      expect(() => enrollGovernedSession(db, other, deps)).toThrow(expect.objectContaining({
        details: expect.objectContaining({ code: "action_claimed", blockingRequestId: request.requestId })
      }));
      expect(deps.prepare).not.toHaveBeenCalled();
      expect(status()).toBe("pending");
      expect(status(other.requestId)).toBeUndefined();
    });
  });

  it("refuses native adoption without a host-observed adapter and names the managed-worker route", () => {
    const deps = dependencies();
    const native = { ...request, requestId: "native-request-0001", mode: "native-adopt" as const, nativeRuntimeId: "runtime-1" };
    const refusal = { details: expect.objectContaining({
      code: "native_runtime_not_supervisable",
      supportedRoute: expect.objectContaining({ mode: "managed-launch", launcher: "arcadia-enroll-broker-codex" }),
      remedy: expect.stringContaining("managed-launch")
    }) };
    expect(() => enrollGovernedSession(db, native, deps)).toThrow(expect.objectContaining(refusal));
    const partial = { id: "partial-v1", observe: vi.fn(() => ({ stableIdentity: true, liveness: true, terminalOutcome: false, recovery: true })) };
    expect(() => enrollGovernedSession(db, native, { ...deps, nativeAdapter: partial })).toThrow(expect.objectContaining(refusal));
    expect(partial.observe).toHaveBeenCalledWith("runtime-1");
    expect(count()).toBe(0);
    const full = { id: "observable-v1", observe: () => ({ stableIdentity: true, liveness: true, terminalOutcome: true, recovery: true }) };
    const adopted = enrollGovernedSession(db, native, { ...deps, nativeAdapter: full } satisfies EnrollmentDependencies);
    expect(adopted.principal).toEqual({ kind: "native-runtime", id: "runtime-1" });
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it("stops the owner-fence migration with the conflicting attempts instead of dropping data", () => {
    const legacy = new Database(":memory:");
    try {
      applyInitialSchema(legacy);
      legacy.exec(`DROP INDEX idx_session_role_attempts_one_requirement_owner;
        CREATE UNIQUE INDEX idx_session_role_attempts_one_mutation_owner ON session_role_attempts(requirement_id, input_revision)
          WHERE mutation_owner = 1 AND status IN ('pending', 'running');`);
      const insert = legacy.prepare(`INSERT INTO session_role_attempts VALUES (?, 'requirement-1', ?, 'development', 1, ?, ?, 1, 'running',
        NULL, NULL, NULL, NULL, 'x', 'x')`);
      insert.run("attempt-a", "revision-1", "attempt-request-a", "developer-1");
      insert.run("attempt-b", "revision-2", "attempt-request-b", "developer-2");
      expect(() => applyMigrations(legacy)).toThrow(/Migration stopped: 1 requirement\(s\).*requirement-1: attempt-request-a,attempt-request-b/);
      expect((legacy.prepare("SELECT count(*) count FROM session_role_attempts").get() as { count: number }).count).toBe(2);
      legacy.prepare("UPDATE session_role_attempts SET status = 'failed' WHERE id = 'attempt-b'").run();
      expect(() => applyMigrations(legacy)).not.toThrow();
    } finally { legacy.close(); }
  });

  it("migrates a candidate-era enrollment store additively and idempotently", () => {
    const legacy = new Database(":memory:");
    try {
      applyInitialSchema(legacy);
      legacy.exec(`DROP TABLE session_enrollments; DROP TABLE session_role_attempts;
        CREATE TABLE session_enrollments (request_id TEXT PRIMARY KEY, request_fingerprint TEXT NOT NULL, project_slug TEXT NOT NULL,
          plan_slug TEXT NOT NULL, action_id TEXT NOT NULL, caller_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
          receipt_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO session_enrollments VALUES ('enroll-legacy-01', 'f', 'p', 'pl', 'a', 'c', 'prepare', 'pending', NULL, 'x', 'x');
        CREATE TABLE session_role_attempts (id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL, input_revision TEXT NOT NULL, role TEXT NOT NULL,
          ordinal INTEGER NOT NULL, request_id TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, mutation_owner INTEGER NOT NULL, status TEXT NOT NULL,
          target_head TEXT, criteria_fingerprint TEXT, evidence_fingerprint TEXT, terminal_receipt_json TEXT, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, UNIQUE(requirement_id, input_revision, role, ordinal));
        CREATE UNIQUE INDEX idx_session_role_attempts_one_mutation_owner ON session_role_attempts(requirement_id, input_revision)
          WHERE mutation_owner = 1 AND status IN ('pending', 'running');`);
      applyMigrations(legacy);
      applyMigrations(legacy);
      expect(legacy.prepare("SELECT lease_expires_at FROM session_enrollments").get()).toEqual({ lease_expires_at: "1970-01-01T00:00:00.000Z" });
      const indexes = (legacy.prepare("PRAGMA index_list(session_role_attempts)").all() as Array<{ name: string }>).map(row => row.name);
      expect(indexes).toContain("idx_session_role_attempts_one_requirement_owner");
      expect(indexes).not.toContain("idx_session_role_attempts_one_mutation_owner");
      // The rebuilt table accepts the failed status and the effect marker, keeps the pending-Action fence.
      legacy.prepare("UPDATE session_enrollments SET status = 'failed', effect_claim_id = 'claim-x' WHERE request_id = 'enroll-legacy-01'").run();
      expect((legacy.prepare("PRAGMA index_list(session_enrollments)").all() as Array<{ name: string }>).map(row => row.name))
        .toContain("idx_session_enrollments_single_pending_action");
    } finally { legacy.close(); }
  });
});

describe("durable role attempts and serial readiness", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); applyInitialSchema(db); });
  afterEach(() => db.close());

  const allocate = (overrides: Record<string, unknown> = {}, connection = db) => allocateSessionRoleAttempt(connection, {
    requirementId: "requirement-1", inputRevision: "revision-1", role: "development",
    requestId: "attempt-development-1", actorId: "developer-1", mutationOwner: true,
    authorityCurrent: true, ...overrides
  } as any);

  it("allocates one mutation owner, replays transport, and bounds authorized retries", () => {
    const first = allocate();
    expect(allocate()).toEqual(first);
    expect(() => allocate({ requestId: "attempt-development-2" })).toThrow();
    recordSessionRoleAttemptTerminal(db, { requestId: first.request_id, actorId: "developer-1", status: "failed", receipt: { reason: "failed" } });
    expect(() => allocate({ requestId: "attempt-development-2" })).toThrow("explicitly authorized");
    const second = allocate({ requestId: "attempt-development-2", retryAuthorized: true, maxOrdinal: 2 });
    expect(second.ordinal).toBe(2);
    recordSessionRoleAttemptTerminal(db, { requestId: second.request_id, actorId: "developer-1", status: "failed", receipt: {} });
    expect(() => allocate({ requestId: "attempt-development-3", retryAuthorized: true, maxOrdinal: 2 })).toThrow("limit is exhausted");
  });

  it("never admits a second concurrent mutation owner for a requirement, even under a revised input", () => {
    allocate();
    expect(() => allocate({ requestId: "attempt-development-r2", inputRevision: "revision-2", actorId: "developer-2" }))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "mutation_owner_active" }) }));
  });

  it("allocates the next ordinal atomically across two database connections", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-attempt-race-")));
    const file = path.join(root, "arcadia.db");
    const first = new Database(file);
    const second = new Database(file);
    try {
      applyInitialSchema(first);
      const attempt = allocate({}, first);
      recordSessionRoleAttemptTerminal(first, { requestId: attempt.request_id, actorId: "developer-1", status: "failed", receipt: {} });
      const retried = allocate({ requestId: "attempt-development-2a", retryAuthorized: true }, first);
      expect(() => allocate({ requestId: "attempt-development-2b", retryAuthorized: true }, second)).toThrow();
      expect(retried.ordinal).toBe(2);
      // Restart: a fresh connection replays the same transport id onto the same row.
      second.close();
      const restarted = new Database(file);
      try {
        expect(allocate({ requestId: "attempt-development-2a", retryAuthorized: true }, restarted)).toMatchObject({ id: retried.id, ordinal: 2 });
        expect((restarted.prepare("SELECT count(*) count FROM session_role_attempts").get() as { count: number }).count).toBe(2);
      } finally { restarted.close(); }
    } finally {
      first.close();
      if (second.open) second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps helpers read-only and requires independent review and QA identities across input revisions", () => {
    expect(() => allocate({ role: "planner", mutationOwner: true })).toThrow("Only the development role");
    allocate();
    expect(() => allocate({ role: "code-review", requestId: "attempt-review-developer", actorId: "developer-1", mutationOwner: false }))
      .toThrow("cannot be allocated to the developer");
    expect(() => allocate({ role: "qa", requestId: "attempt-qa-developer", actorId: "developer-1", mutationOwner: false }))
      .toThrow("cannot be allocated to the developer");
    expect(() => allocate({ role: "qa", requestId: "attempt-qa-developer-r2", inputRevision: "revision-2", actorId: "developer-1", mutationOwner: false }))
      .toThrow("cannot be allocated to the developer");
    const qa = allocate({ role: "qa", requestId: "attempt-qa-no-binding", actorId: "qa-1", mutationOwner: false });
    expect(() => recordSessionRoleAttemptTerminal(db, {
      requestId: qa.request_id, actorId: "qa-1", status: "passed", receipt: {}
    })).toThrow("exact head");
  });

  it("invalidates a dependent verdict when head, criteria, or evidence changes", () => {
    const qa = allocate({ role: "qa", requestId: "attempt-qa-1", actorId: "qa-1", mutationOwner: false });
    const terminal = recordSessionRoleAttemptTerminal(db, {
      requestId: qa.request_id, actorId: "qa-1", status: "passed",
      targetHead: "a".repeat(40), criteriaFingerprint: "criteria-1", evidenceFingerprint: "evidence-1", receipt: {}
    });
    expect(attemptVerdictIsCurrent(terminal, { head: "a".repeat(40), criteriaFingerprint: "criteria-1", evidenceFingerprint: "evidence-1" })).toBe(true);
    expect(attemptVerdictIsCurrent(terminal, { head: "b".repeat(40), criteriaFingerprint: "criteria-1", evidenceFingerprint: "evidence-1" })).toBe(false);
    expect(attemptVerdictIsCurrent(terminal, { head: "a".repeat(40), criteriaFingerprint: "criteria-2", evidenceFingerprint: "evidence-1" })).toBe(false);
    expect(attemptVerdictIsCurrent(terminal, { head: "a".repeat(40), criteriaFingerprint: "criteria-1", evidenceFingerprint: "evidence-2" })).toBe(false);
  });

  it("replays an immutable terminal receipt and refuses a changed terminal replay", () => {
    const attempt = allocate({ role: "critique", requestId: "attempt-critique-1", actorId: "critic-1", mutationOwner: false });
    const input = { requestId: attempt.request_id, actorId: "critic-1", status: "failed" as const, receipt: { reason: "needs revision" } };
    const terminal = recordSessionRoleAttemptTerminal(db, input);
    expect(recordSessionRoleAttemptTerminal(db, input)).toEqual(terminal);
    expect(() => recordSessionRoleAttemptTerminal(db, { ...input, status: "passed", receipt: { reason: "changed" } }))
      .toThrow("immutable");
  });

  it("allocates every fixed helper role as read-only and rejects unknown roles", () => {
    for (const [index, role] of ["planner", "critique", "code-review", "qa"].entries()) {
      expect(allocate({ role, requestId: `attempt-helper-${index}`, actorId: `helper-${index}`, mutationOwner: false }).mutation_owner).toBe(0);
    }
    expect(() => allocate({ role: "publisher", requestId: "attempt-unknown-1", actorId: "helper-9", mutationOwner: false }))
      .toThrow("Unknown session attempt role");
  });

  it("selects exactly the next dependency-ready Action and fences Off between Actions", () => {
    const actions = [
      { id: "one", status: "done" as const, dependsOn: [] },
      { id: "two", status: "open" as const, dependsOn: ["one"] },
      { id: "three", status: "open" as const, dependsOn: ["two"] }
    ];
    expect(nextDependencyReadyAction(actions, "active")?.id).toBe("two");
    expect(nextDependencyReadyAction(actions, "off")).toBeNull();
  });
});
