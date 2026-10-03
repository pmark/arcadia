import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CapacityAdmissionDecision } from "../src/codingAgents/capacity.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import {
  runProductionReactivateCommand,
  runProductionReactivatePreviewCommand,
  runProductionStatusCommand
} from "../src/commands/production.js";
import {
  CONCURRENT_READY_SET_ADMISSION_PROOF_REF,
  activateProduction,
  commitAdmission,
  deactivateProduction,
  fingerprintProductionScope,
  issueAdmission,
  listAdmissions,
  normalizeProductionScope,
  readInactiveConfiguration,
  readProductionPolicy,
  type ProductionScope
} from "../src/production/policy.js";
import { evaluateReactivation, reactivateProduction } from "../src/production/reactivation.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-reactivation-"));
  temporary.push(directory);
  return directory;
}

const PLAN_PATH = ["docs", "plans", "queue-plan.md"];

function planDocument(actions: Array<{ id: string; status?: string; dependsOn?: string[] }>): string {
  return [
    "---", "arcadia: v1", "type: plan", "slug: queue-plan", "project: demo", "status: active",
    "milestone: Queue milestone", "token_impact: medium",
    "token_budget: One bounded implementation pass.", "recommended_model: gpt-5.6-terra",
    "current_action: migrate",
    "updated: 2026-09-05", "actions:",
    ...actions.flatMap((action) => [
      `  - id: ${action.id}`, `    title: ${action.id}`, `    status: ${action.status ?? "open"}`,
      "    responsibility: agent", `    next_action: Do ${action.id}.`,
      `    expected_artifact: ${action.id} artifact`, "    clarification: clarified",
      "    acceptance_criteria:", `      - ${action.id} is done.`,
      `    depends_on: [${(action.dependsOn ?? []).join(", ")}]`
    ]),
    "---", "", "# Queue plan", ""
  ].join("\n");
}

interface Fixture {
  workspace: string;
  repo: string;
}

/** A workspace whose queue offers demo/migrate and demo/ship-it, read from real Plan files. */
function fixture(): Fixture {
  const repo = scratch();
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  writeFileSync(
    path.join(repo, "PROJECT.md"),
    [
      "---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
      "goal: Exercise managed production.", "milestone: Queue milestone",
      "active_plan: queue-plan", "current_action: migrate", "updated: 2026-09-05", "---", "", "# Demo", ""
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    path.join(repo, ...PLAN_PATH),
    planDocument([{ id: "migrate" }, { id: "ship-it", dependsOn: ["migrate"] }]),
    "utf8"
  );
  const workspace = path.join(scratch(), "workspace");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Exercise managed production.",
      status: "active",
      currentMilestone: "Queue milestone",
      nextAction: "Prepare the fixture.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
  });
  return { workspace, repo };
}

function scope(overrides: Partial<ProductionScope> = {}): ProductionScope {
  return normalizeProductionScope({
    intent: "Finish the bootstrap Plan without a per-Action relay.",
    projects: ["demo"],
    plans: ["demo/queue-plan"],
    actions: ["demo/migrate", "demo/ship-it"],
    providers: ["claude"],
    maxConcurrentSessions: 1,
    mechanicalTransitions: ["validation", "acceptance", "pointer"],
    ...overrides
  });
}

function activate(workspace: string, requestId: string, overrides: Partial<ProductionScope> = {}) {
  return withDatabase(workspace, (db) => {
    const authorized = scope(overrides);
    return activateProduction(db, {
      requestId,
      scope: authorized,
      scopeFingerprint: fingerprintProductionScope(authorized),
      grantedBy: "operator"
    });
  });
}

function off(workspace: string, requestId: string) {
  return withDatabase(workspace, (db) => deactivateProduction(db, { requestId }));
}

function expectedFrom(workspace: string) {
  const preview = withDatabase(workspace, (db) => evaluateReactivation(db));
  if (!preview.expected) throw new Error("no saved configuration to bind to");
  return preview.expected;
}

function reactivate(workspace: string, requestId: string, expected = expectedFrom(workspace)) {
  return withDatabase(workspace, (db) => reactivateProduction(db, { requestId, grantedBy: "operator", expected }));
}

function refusalCodes(workspace: string): string[] {
  return withDatabase(workspace, (db) => evaluateReactivation(db)).refusals.map((refusal) => refusal.code);
}

function capacity(): CapacityAdmissionDecision {
  return {
    providerId: "claude",
    admitted: true,
    code: null,
    reason: "test",
    unattendedProof: true,
    retryAfter: null,
    refreshRequired: false,
    receipt: {
      version: 1,
      providerId: "claude",
      providerLabel: "claude",
      profiles: [],
      accountScope: "test",
      source: "codex_app_server",
      evidence: "simulated",
      unattended: true,
      observedAt: "2026-09-05T00:00:00.000Z",
      observedAgeMs: 0,
      expiresAt: null,
      confidence: "observed",
      freshness: "fresh",
      usagePolicy: "included",
      usagePolicyReason: "test fixture",
      windows: [{ label: "5h", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
      nextResetAt: null,
      unsupported: [],
      availability: "available",
      telemetry: "test fixture"
    }
  };
}

function admit(workspace: string, requestId: string, actionKey = "demo/migrate") {
  return withDatabase(workspace, (db) =>
    issueAdmission(db, {
      requestId,
      actionKey,
      projectSlug: "demo",
      planSlug: "queue-plan",
      provider: "claude",
      capacity: capacity()
    })
  );
}

describe("Off retains the reviewed configuration apart from active authority", () => {
  it("saves the exact scope while the policy row holds no scope or authority", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");

    const policy = withDatabase(workspace, readProductionPolicy);
    expect(policy.desiredState).toBe("inactive");
    expect(policy.scope).toBeNull();
    expect(policy.authority).toBeNull();

    const saved = withDatabase(workspace, readInactiveConfiguration);
    expect(saved?.scope).toEqual(scope());
    expect(saved?.fingerprint).toBe(fingerprintProductionScope(scope()));
    expect(saved?.configurationRevision).toBe(1);
    expect(saved?.sourceEpoch).toBe(1);
    expect(saved?.sourceAuthorityRequestId).toBe("grant-1");
    expect(saved?.savedAtPolicyRevision).toBe(policy.revision);
  });

  it("survives a restart: a fresh connection still reads the saved configuration", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");

    // withDatabase opens and closes a connection per call, which is a restart.
    expect(withDatabase(workspace, readInactiveConfiguration)?.scope.actions).toEqual(["demo/migrate", "demo/ship-it"]);
    const status = runProductionStatusCommand({ workspace }).data;
    expect(status.inactiveConfiguration?.scope.actions).toEqual(["demo/migrate", "demo/ship-it"]);
    expect(status.read.status === "ok" && status.read.policy.scope).toBeNull();
  });

  it("does not carry grants, exceptions, delegation expiry or remote preservation", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1", {
      remotePreservation: true,
      integrationGrant: { decisionRef: "decision-0058", expiresAt: "2030-01-01T00:00:00.000Z", actions: [] },
      rehearsalException: { actionRef: CONCURRENT_READY_SET_ADMISSION_PROOF_REF, expiresAt: "2030-01-01T00:00:00.000Z" },
      mechanicalTransitions: ["validation", "packet_approval"],
      packetApprovalExpiresAt: "2030-01-01T00:00:00.000Z"
    });
    off(workspace, "off-1");

    const saved = withDatabase(workspace, readInactiveConfiguration)!;
    expect(saved.scope.integrationGrant).toBeUndefined();
    expect(saved.scope.rehearsalException).toBeUndefined();
    expect(saved.scope.packetApprovalExpiresAt).toBeUndefined();
    expect(saved.scope.remotePreservation).toBeUndefined();
    expect([...saved.notCarried].sort()).toEqual(
      ["integrationGrant", "packetApprovalExpiresAt", "rehearsalException", "remotePreservation"]
    );
  });

  it("keeps the saved configuration through a second Off and an Off that never had one", () => {
    const { workspace } = fixture();
    off(workspace, "off-never-active");
    expect(withDatabase(workspace, readInactiveConfiguration)).toBeNull();

    activate(workspace, "grant-1");
    off(workspace, "off-1");
    const first = withDatabase(workspace, readInactiveConfiguration)!;
    off(workspace, "off-2");
    const second = withDatabase(workspace, readInactiveConfiguration)!;
    expect(second).toEqual(first);
  });

  it("still fences every admission while saved configuration exists", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    const outcome = admit(workspace, "admit-after-off");
    expect(outcome.admitted).toBe(false);
    if (!outcome.admitted) expect(outcome.code).toBe("production_inactive");
  });

  it("reads as nothing saved on a store that predates the table, without failing status", () => {
    const { workspace } = fixture();
    withDatabase(workspace, (db) => db.exec("DROP TABLE production_inactive_configuration"));
    // The write-capable open re-creates it empty (the idempotent migration).
    expect(withDatabase(workspace, readInactiveConfiguration)).toBeNull();
    withDatabase(workspace, (db) => db.exec("DROP TABLE production_inactive_configuration"));
    // A read-only open cannot migrate; status must report null rather than throw.
    expect(runProductionStatusCommand({ workspace }).data.inactiveConfiguration).toBeNull();
  });
});

describe("reactivation replays only the exact validated configuration", () => {
  it("refuses with no_saved_configuration instead of fabricating a scope", () => {
    const { workspace } = fixture();
    expect(refusalCodes(workspace)).toEqual(["no_saved_configuration"]);
    expect(() =>
      reactivate(workspace, "on-1", { policyRevision: 0, configurationRevision: 0, fingerprint: "none" })
    ).toThrow(/No reviewed configuration was saved/);
    expect(withDatabase(workspace, readProductionPolicy).desiredState).toBe("inactive");
  });

  it("restores the saved scope into a fresh epoch with fresh authority", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    const before = withDatabase(workspace, readProductionPolicy);

    const result = reactivate(workspace, "on-1");

    expect(result.replayed).toBe(false);
    expect(result.policy.desiredState).toBe("active");
    expect(result.policy.epoch).toBe(before.epoch + 1);
    expect(result.policy.revision).toBe(before.revision + 1);
    expect(result.policy.scope).toEqual(scope());
    expect(result.policy.authority?.requestId).toBe("on-1");
    expect(result.policy.authority?.decisionRef).toBeNull();
    expect(result.policy.authority?.scopeFingerprint).toBe(fingerprintProductionScope(scope()));
  });

  it("never revives a grant, exception or delegation that Off dropped", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1", {
      remotePreservation: true,
      integrationGrant: { decisionRef: "decision-0058", expiresAt: "2030-01-01T00:00:00.000Z", actions: [] },
      rehearsalException: { actionRef: CONCURRENT_READY_SET_ADMISSION_PROOF_REF, expiresAt: "2030-01-01T00:00:00.000Z" }
    });
    off(workspace, "off-1");
    const result = reactivate(workspace, "on-1");
    expect(result.policy.scope?.integrationGrant).toBeUndefined();
    expect(result.policy.scope?.rehearsalException).toBeUndefined();
    expect(result.policy.scope?.remotePreservation).toBeUndefined();
  });

  it("refuses a delegated packet approval, which needs its own fresh grant (Decision 0072)", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1", {
      mechanicalTransitions: ["validation", "packet_approval"],
      packetApprovalExpiresAt: "2030-01-01T00:00:00.000Z"
    });
    off(workspace, "off-1");
    expect(refusalCodes(workspace)).toContain("packet_approval_expiry_required");
    // The delegation reads as its own gate, not as a generic invalid configuration.
    expect(refusalCodes(workspace)).not.toContain("saved_configuration_invalid");
    expect(() => reactivate(workspace, "on-1")).toThrow(/packet approval/);
    expect(withDatabase(workspace, readProductionPolicy).desiredState).toBe("inactive");
  });

  it("keeps a saved empty delegation list empty instead of widening it to the default", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1", { mechanicalTransitions: [] });
    off(workspace, "off-1");
    expect(reactivate(workspace, "on-1").policy.scope?.mechanicalTransitions).toEqual([]);
  });

  it("refuses a saved empty Action list, which the gate reads as the whole Plan", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1", { actions: [] });
    off(workspace, "off-1");
    expect(refusalCodes(workspace)).toContain("saved_actions_empty");
    expect(() => reactivate(workspace, "on-1")).toThrow(/names no Actions/);
  });

  it("refuses a moved queue naming the Action, and never narrows or re-derives the scope", () => {
    const { workspace, repo } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");

    // The Plan moved on: migrate is done and a new Action is queued.
    writeFileSync(
      path.join(repo, ...PLAN_PATH),
      planDocument([{ id: "migrate", status: "done" }, { id: "ship-it" }, { id: "brand-new" }]),
      "utf8"
    );

    const preview = withDatabase(workspace, (db) => evaluateReactivation(db));
    expect(preview.ready).toBe(false);
    const closed = preview.refusals.find((refusal) => refusal.code === "action_not_open");
    expect(closed?.reason).toContain("demo/migrate");
    expect(closed?.reason).not.toContain("demo/ship-it");
    // The saved configuration is untouched by the drift.
    expect(withDatabase(workspace, readInactiveConfiguration)?.scope.actions).toEqual(["demo/migrate", "demo/ship-it"]);
    expect(() => reactivate(workspace, "on-1", preview.expected!)).toThrow(/no longer open/);
    expect(withDatabase(workspace, readProductionPolicy).desiredState).toBe("inactive");
  });

  it("refuses a saved Action that was removed from the Plan, naming it", () => {
    const { workspace, repo } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    writeFileSync(path.join(repo, ...PLAN_PATH), planDocument([{ id: "migrate" }]), "utf8");

    const refusal = withDatabase(workspace, (db) => evaluateReactivation(db)).refusals.find(
      (entry) => entry.code === "action_missing"
    );
    expect(refusal?.reason).toContain("demo/ship-it");
    expect(refusal?.reason).not.toContain("demo/migrate");
  });

  it("refuses a saved Plan that is no longer active, so a moved pointer cannot re-scope it", () => {
    const { workspace, repo } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    writeFileSync(
      path.join(repo, ...PLAN_PATH),
      planDocument([{ id: "migrate" }, { id: "ship-it", dependsOn: ["migrate"] }]).replace("status: active", "status: complete"),
      "utf8"
    );
    expect(refusalCodes(workspace)).toContain("plan_not_active");
  });

  it("accepts dependents that wait on an open Action, since a reviewed scope lists them", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    expect(refusalCodes(workspace)).toEqual([]);
  });

  it("refuses a saved provider that is no longer configured", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    const preview = withDatabase(workspace, (db) => evaluateReactivation(db, { knownProviders: ["codex"] }));
    expect(preview.refusals.map((refusal) => refusal.code)).toContain("provider_unknown");
  });

  it("refuses stale policy and configuration revisions and a different fingerprint", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    const stale = expectedFrom(workspace);

    // A second Off moves the policy revision under the preview.
    off(workspace, "off-2");
    expect(() => reactivate(workspace, "on-1", stale)).toThrow(/moved from revision/);

    // A different scope saved by a later Off moves the configuration revision and fingerprint.
    const current = expectedFrom(workspace);
    activate(workspace, "grant-2", { actions: ["demo/migrate"] });
    off(workspace, "off-3");
    let thrown: { details?: { refusals?: Array<{ code: string }> } } | undefined;
    try {
      reactivate(workspace, "on-2", current);
    } catch (error) {
      thrown = error as typeof thrown;
    }
    const codes = thrown?.details?.refusals?.map((refusal) => refusal.code) ?? [];
    expect(codes).toEqual(expect.arrayContaining(["policy_revision_moved", "configuration_revision_moved", "configuration_fingerprint_mismatch"]));
    expect(withDatabase(workspace, readProductionPolicy).desiredState).toBe("inactive");
  });
});

describe("toggling, restart and in-flight work", () => {
  it("replays a repeated request id and refuses a second On with another id as already active", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    const expected = expectedFrom(workspace);

    const first = reactivate(workspace, "on-1", expected);
    const epoch = first.policy.epoch;

    // The same request id after a restart returns the original receipt.
    const replay = reactivate(workspace, "on-1", expected);
    expect(replay.replayed).toBe(true);
    expect(replay.policy.epoch).toBe(epoch);

    // Two concurrent toggles with distinct ids end in exactly one success.
    expect(() => reactivate(workspace, "on-2", expected)).toThrow(/already Active/);
    const policy = withDatabase(workspace, readProductionPolicy);
    expect(policy.epoch).toBe(epoch);
    expect(policy.authority?.requestId).toBe("on-1");
  });

  it("refuses to replay a deactivation's request id as an activation, and the reverse", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    const expected = expectedFrom(workspace);

    expect(() => reactivate(workspace, "off-1", expected)).toThrow(/already recorded a deactivation/);
    expect(withDatabase(workspace, readProductionPolicy).desiredState).toBe("inactive");

    reactivate(workspace, "on-1", expected);
    expect(() => off(workspace, "on-1")).toThrow(/already recorded an activation/);
    expect(withDatabase(workspace, readProductionPolicy).desiredState).toBe("active");
  });

  it("refuses to replay a request id for a different configuration", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    off(workspace, "off-1");
    const expected = expectedFrom(workspace);
    reactivate(workspace, "on-1", expected);
    expect(() => reactivate(workspace, "on-1", { ...expected, fingerprint: "different" })).toThrow(/different configuration/);
  });

  it("keeps old fenced admissions fenced and committed work identifiable across Off and On", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1");
    // Issued but never committed: Off fences it.
    expect(admit(workspace, "admit-pending", "demo/migrate").admitted).toBe(true);
    off(workspace, "off-1");
    reactivate(workspace, "on-1");

    // Committed in the new epoch: Off leaves it running and identifiable.
    expect(admit(workspace, "admit-committed", "demo/ship-it").admitted).toBe(true);
    withDatabase(workspace, (db) => commitAdmission(db, "admit-committed"));
    off(workspace, "off-2");
    reactivate(workspace, "on-2");

    const byRequest = new Map(withDatabase(workspace, listAdmissions).map((admission) => [admission.requestId, admission]));
    expect(byRequest.get("admit-pending")?.status).toBe("fenced");
    expect(byRequest.get("admit-pending")?.fencedReason).toBe("production_off");
    expect(byRequest.get("admit-committed")?.status).toBe("committed");
    expect(byRequest.get("admit-committed")?.epoch).toBe(2);
    expect(withDatabase(workspace, readProductionPolicy).epoch).toBe(3);
  });

  it("keeps effective concurrency at one until the concurrency proof gate opens", () => {
    const { workspace } = fixture();
    activate(workspace, "grant-1", { maxConcurrentSessions: 2 });
    off(workspace, "off-1");

    const preview = withDatabase(workspace, (db) => evaluateReactivation(db));
    expect(preview.configuration?.scope.maxConcurrentSessions).toBe(2);
    expect(preview.concurrencyGate?.closed).toBe(true);
    expect(preview.concurrencyGate?.effectiveMaxConcurrentSessions).toBe(1);

    reactivate(workspace, "on-1");
    expect(admit(workspace, "admit-1", "demo/migrate").admitted).toBe(true);
    const second = admit(workspace, "admit-2", "demo/ship-it");
    expect(second.admitted).toBe(false);
    if (!second.admitted) expect(second.code).toBe("concurrency_limit");
  });
});

describe("production reactivate commands", () => {
  it("previews the saved bounds with the expectations to bind, then reactivates", () => {
    const { workspace } = fixture();
    // Real registry provider so the command's provider check passes.
    activate(workspace, "grant-1", { providers: ["claude-code-cli"] });
    off(workspace, "off-1");

    const preview = runProductionReactivatePreviewCommand({ workspace }).data.preview;
    expect(preview.ready).toBe(true);
    expect(preview.notCarried).toEqual([]);
    const expected = preview.expected!;

    const response = runProductionReactivateCommand({
      workspace,
      requestId: "on-1",
      grantedBy: "operator",
      expectedRevision: String(expected.policyRevision),
      expectedConfigurationRevision: String(expected.configurationRevision),
      expectedFingerprint: expected.fingerprint
    });
    expect(response.data.result.policy.desiredState).toBe("active");
    expect(response.data.result.policy.scope?.providers).toEqual(["claude-code-cli"]);
  });

  it("refuses to reactivate without every expectation from the preview", () => {
    const { workspace } = fixture();
    expect(() =>
      runProductionReactivateCommand({ workspace, requestId: "on-1", grantedBy: "operator", expectedRevision: "1" })
    ).toThrow(/--expected-configuration-revision/);
  });

  it("marks a drift refusal as a conflict carrying the exact gate", () => {
    const { workspace } = fixture();
    let thrown: { details?: { conflict?: boolean; code?: string; remedy?: string } } | undefined;
    try {
      runProductionReactivateCommand({
        workspace,
        requestId: "on-1",
        grantedBy: "operator",
        expectedRevision: "0",
        expectedConfigurationRevision: "0",
        expectedFingerprint: "none"
      });
    } catch (error) {
      thrown = error as typeof thrown;
    }
    expect(thrown?.details?.conflict).toBe(true);
    expect(thrown?.details?.code).toBe("no_saved_configuration");
    expect(thrown?.details?.remedy).toContain("arcadia production preview");
  });
});
