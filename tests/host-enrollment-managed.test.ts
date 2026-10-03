import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyInitialSchema } from "../src/db/schema.js";
import type { EnrollmentRequest, GovernedEnrollmentContext } from "../src/sessions/enrollment.js";

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("../src/sessions/launch.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/sessions/launch.js")>(),
  launchGuardedHostSession: mocks.launch
}));
import { enrollManagedHostSession } from "../src/sessions/hostEnrollment.js";

describe("managed host enrollment adapter", () => {
  let db: Database.Database;
  const request: EnrollmentRequest & { mode: "managed-launch" } = {
    requestId: "managed-enrollment-0001",
    source: "/repo",
    agent: "codex",
    callerId: "production-worker-1",
    mode: "managed-launch",
    projectSlug: "arcadia",
    planSlug: "flight-deck",
    actionId: "enroll",
    requirementId: "arcadia/flight-deck/enroll",
    inputRevision: "revision-1",
    expectedPolicyEpoch: 12
  };
  const context: GovernedEnrollmentContext = {
    projectSlug: "arcadia",
    planSlug: "flight-deck",
    actionId: "enroll",
    canonicalBrief: "host brief",
    operatorGates: ["packet-approved"],
    provider: "codex-cli",
    model: "gpt-5.6-sol",
    effort: "high",
    policyState: "active",
    policyEpoch: 12,
    packetApproved: true,
    capacityAvailable: true,
    existingClaim: null
  };

  beforeEach(() => {
    db = new Database(":memory:");
    applyInitialSchema(db);
    mocks.launch.mockReset().mockReturnValue({
      reused: false,
      session: { id: "session-1", worktree_path: "/candidate" },
      preview: {},
      admission: { requestId: "managed-enrollment-0001:admission" }
    });
  });
  afterEach(() => db.close());

  const launch = () => ({ db, requestId: request.requestId, projectSlug: request.projectSlug }) as any;

  it("uses the canonical guarded launch once and replays its durable Session receipt", () => {
    const first = enrollManagedHostSession({ db, request, context, launch: launch() });
    expect(first.principal).toEqual({ kind: "managed-session", id: "session-1", worktree: "/candidate" });
    expect(enrollManagedHostSession({ db, request, context, launch: launch() })).toEqual(first);
    expect(mocks.launch).toHaveBeenCalledOnce();
  });

  it("refuses mismatched launch identity and removes a pending row after launch refusal", () => {
    expect(() => enrollManagedHostSession({ db, request, context, launch: { ...launch(), requestId: "different-request" } }))
      .toThrow("identities do not match");
    mocks.launch.mockImplementation(() => { throw new Error("transport refused"); });
    expect(() => enrollManagedHostSession({ db, request, context, launch: launch() })).toThrow("transport refused");
    expect(db.prepare("SELECT count(*) count FROM session_enrollments").get()).toEqual({ count: 0 });
  });
});
