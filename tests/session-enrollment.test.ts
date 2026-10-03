import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyInitialSchema } from "../src/db/schema.js";
import {
  allocateSessionRoleAttempt,
  attemptVerdictIsCurrent,
  enrollGovernedSession,
  nextDependencyReadyAction,
  recordSessionRoleAttemptTerminal,
  type EnrollmentRequest,
  type GovernedEnrollmentContext
} from "../src/sessions/enrollment.js";

describe("protected session enrollment", () => {
  let db: Database.Database;
  const context: GovernedEnrollmentContext = {
    projectSlug: "arcadia", planSlug: "flight-deck", actionId: "enroll",
    canonicalBrief: "canonical host brief", operatorGates: ["packet-approved"],
    provider: "codex-cli", model: "gpt-5.6-sol", effort: "high",
    policyState: "active", policyEpoch: 12, packetApproved: true,
    capacityAvailable: true,
    existingClaim: { id: "claim-1", worktree: "/candidate", generation: "generation-1" }
  };
  const request: EnrollmentRequest = {
    requestId: "enroll-request-0001", source: "/repo", agent: "codex", callerId: "helper-1",
    mode: "prepare", projectSlug: "arcadia", planSlug: "flight-deck", actionId: "enroll",
    requirementId: "requirement-1", inputRevision: "revision-1", expectedPolicyEpoch: 12
  };
  const dependencies = (overrides: Partial<GovernedEnrollmentContext> = {}) => ({
    resolve: vi.fn(() => ({ ...context, ...overrides })),
    prepare: vi.fn(() => ({ id: "claim-1", worktree: "/candidate" })),
    launch: vi.fn(() => ({ id: "session-1", worktree: "/candidate" })),
    rollback: vi.fn(),
    now: () => new Date("2026-10-03T18:00:00.000Z")
  });

  beforeEach(() => { db = new Database(":memory:"); applyInitialSchema(db); });
  afterEach(() => db.close());

  it("replays the original receipt and refuses changed caller, Action, or mode before effects", () => {
    const deps = dependencies();
    const first = enrollGovernedSession(db, request, deps);
    const replay = enrollGovernedSession(db, request, deps);
    expect(replay).toEqual(first);
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    for (const changed of [
      { callerId: "helper-2" }, { actionId: "other" }, { mode: "managed-launch" as const }
    ]) {
      expect(() => enrollGovernedSession(db, { ...request, ...changed }, deps)).toThrow("already used");
    }
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it("returns the canonical candidate and fenced host-derived receipt", () => {
    const receipt = enrollGovernedSession(db, request, dependencies());
    expect(receipt).toMatchObject({
      requestId: request.requestId, canonicalBrief: "canonical host brief",
      execution: { provider: "codex-cli", model: "gpt-5.6-sol", effort: "high" },
      claim: context.existingClaim,
      principal: { kind: "prepared", id: "claim-1", worktree: "/candidate" }
    });
  });

  it.each([
    [{ policyState: "off" as const }, "production_off"],
    [{ packetApproved: false }, "packet_approval_required"],
    [{ capacityAvailable: false }, "capacity_unavailable"],
    [{ policyEpoch: 13 }, "stale_policy_epoch"]
  ])("refuses managed launch preconditions without effects: %s", (override, code) => {
    const deps = dependencies(override);
    expect(() => enrollGovernedSession(db, { ...request, mode: "managed-launch" }, deps))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code }) }));
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.launch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) count FROM session_enrollments").get()).toEqual({ count: 0 });
  });

  it("cleans a failed effect and permits a recoverable exact retry", () => {
    const deps = dependencies();
    deps.prepare.mockImplementationOnce(() => { throw new Error("transport refused"); });
    expect(() => enrollGovernedSession(db, request, deps)).toThrow("transport refused");
    expect(deps.rollback).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT count(*) count FROM session_enrollments").get()).toEqual({ count: 0 });
    expect(enrollGovernedSession(db, request, deps).principal.id).toBe("claim-1");
  });

  it("fences concurrent enrollment before a duplicate principal", () => {
    const deps = dependencies();
    deps.prepare.mockImplementation(() => {
      expect(() => enrollGovernedSession(db, request, deps)).toThrow("already in progress");
      return { id: "claim-1", worktree: "/candidate" };
    });
    expect(enrollGovernedSession(db, request, deps).principal.id).toBe("claim-1");
    expect(deps.prepare).toHaveBeenCalledOnce();
  });

  it("reconciles a pending exact request after restart without duplicating its principal", () => {
    const deps = dependencies();
    deps.prepare.mockImplementation(() => {
      throw new Error("host response lost");
    });
    // Model a process death after the pending row became durable but before
    // its host result was recorded; a restart gets the host-observed result.
    db.prepare(`INSERT INTO session_enrollments VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`)
      .run(request.requestId,
        "unused-by-this-fixture", context.projectSlug, context.planSlug, context.actionId,
        request.callerId, request.mode, "2026-10-03T18:00:00.000Z", "2026-10-03T18:00:00.000Z");
    const fingerprint = db.prepare("SELECT request_fingerprint FROM session_enrollments WHERE request_id = ?").get(request.requestId) as { request_fingerprint: string };
    // Obtain the canonical fingerprint from an isolated completed request, then
    // put it on the simulated pending row.
    const scratch = new Database(":memory:");
    applyInitialSchema(scratch);
    enrollGovernedSession(scratch, request, dependencies());
    const canonical = scratch.prepare("SELECT request_fingerprint FROM session_enrollments WHERE request_id = ?").get(request.requestId) as { request_fingerprint: string };
    scratch.close();
    db.prepare("UPDATE session_enrollments SET request_fingerprint = ? WHERE request_id = ?").run(canonical.request_fingerprint, request.requestId);
    expect(fingerprint.request_fingerprint).toBe("unused-by-this-fixture");
    const recovered = {
      enrollmentId: "enrollment_recovered", requestId: request.requestId, mode: request.mode,
      projectSlug: context.projectSlug, planSlug: context.planSlug, actionId: context.actionId,
      callerId: request.callerId, canonicalBrief: context.canonicalBrief, operatorGates: context.operatorGates,
      execution: { provider: context.provider, model: context.model, effort: context.effort },
      requirementId: request.requirementId, inputRevision: request.inputRevision, claim: context.existingClaim,
      principal: { kind: "prepared" as const, id: "claim-1", worktree: "/candidate" },
      createdAt: "2026-10-03T18:00:00.000Z"
    };
    const restarted = enrollGovernedSession(db, request, { ...deps, recover: () => recovered });
    expect(restarted).toEqual(recovered);
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it("refuses unsupervisable native adoption with the managed-worker remedy", () => {
    const deps = dependencies();
    expect(() => enrollGovernedSession(db, { ...request, mode: "native-adopt" }, deps)).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ code: "native_runtime_not_supervisable", remedy: expect.stringContaining("managed-launch") }) })
    );
    const adopted = enrollGovernedSession(db, {
      ...request, requestId: "native-request-0001", mode: "native-adopt",
      nativeAdapter: { adapterId: "observable-v1", runtimeId: "runtime-1", stableIdentity: true,
        livenessObservable: true, terminalOutcomeObservable: true, recoveryObservable: true }
    }, deps);
    expect(adopted.principal).toEqual({ kind: "native-runtime", id: "runtime-1" });
  });
});

describe("durable role attempts and serial readiness", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); applyInitialSchema(db); });
  afterEach(() => db.close());

  const allocate = (overrides: Record<string, unknown> = {}) => allocateSessionRoleAttempt(db, {
    requirementId: "requirement-1", inputRevision: "revision-1", role: "development",
    requestId: "attempt-development-1", actorId: "developer-1", mutationOwner: true,
    authorityCurrent: true, ...overrides
  } as any);

  it("allocates one mutation owner, replays transport, and bounds authorized retries", () => {
    const first = allocate();
    expect(allocate()).toEqual(first);
    expect(() => allocate({ requestId: "attempt-development-2" })).toThrow("explicitly authorized");
    recordSessionRoleAttemptTerminal(db, { requestId: first.request_id, actorId: "developer-1", status: "failed", receipt: { reason: "failed" } });
    const second = allocate({ requestId: "attempt-development-2", retryAuthorized: true, maxOrdinal: 2 });
    expect(second.ordinal).toBe(2);
    recordSessionRoleAttemptTerminal(db, { requestId: second.request_id, actorId: "developer-1", status: "failed", receipt: {} });
    expect(() => allocate({ requestId: "attempt-development-3", retryAuthorized: true, maxOrdinal: 2 })).toThrow("limit is exhausted");
  });

  it("keeps helpers read-only and requires independent review and QA identities", () => {
    expect(() => allocate({ role: "planner", mutationOwner: true })).toThrow("Only the development role");
    allocate();
    expect(() => allocate({ role: "code-review", requestId: "attempt-review-developer", actorId: "developer-1", mutationOwner: false }))
      .toThrow("cannot be allocated to the developer");
    expect(() => allocate({ role: "qa", requestId: "attempt-qa-developer", actorId: "developer-1", mutationOwner: false }))
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
