import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import {
  buildProductionActivationPreview,
  describeProductionState
} from "../src/production/activation.js";
import { buildJudgmentRequest } from "../src/production/judgment.js";
import {
  runProductionDeactivateCommand,
  runProductionStatusCommand
} from "../src/commands/production.js";
import {
  PRODUCTION_CONTROL_DEADLINES,
  activateProduction,
  commitAdmission,
  deactivateProduction,
  fingerprintProductionScope,
  issueAdmission,
  listAdmissions,
  normalizeProductionScope,
  readProductionPolicy,
  readProductionPolicySafely,
  releaseAdmission,
  type ProductionScope
} from "../src/production/policy.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-production-"));
  temporary.push(directory);
  return directory;
}

function workspace(): string {
  const target = path.join(scratch(), "workspace");
  initWorkspace(target);
  return target;
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

function activate(workspacePath: string, requestId = "grant-1", overrides: Partial<ProductionScope> = {}) {
  return withDatabase(workspacePath, (db) => {
    const authorized = scope(overrides);
    return activateProduction(db, {
      requestId,
      scope: authorized,
      scopeFingerprint: fingerprintProductionScope(authorized),
      grantedBy: "operator"
    });
  });
}

function admit(
  workspacePath: string,
  requestId: string,
  overrides: Partial<Parameters<typeof issueAdmission>[1]> = {}
) {
  return withDatabase(workspacePath, (db) =>
    issueAdmission(db, {
      requestId,
      actionKey: "demo/migrate",
      projectSlug: "demo",
      planSlug: "queue-plan",
      provider: "claude",
      ...overrides
    })
  );
}

describe("managed production policy state", () => {
  it("defaults to Inactive on first setup with no scope and no authority", () => {
    const target = workspace();
    const policy = withDatabase(target, readProductionPolicy);

    expect(policy).toMatchObject({
      desiredState: "inactive",
      revision: 0,
      epoch: 0,
      scope: null,
      authority: null,
      revokedAt: null
    });
  });

  it("persists desired state, revision, epoch and authority receipt across a restart", () => {
    const target = workspace();
    activate(target);

    // A fresh connection is exactly what an ordinary worker restart sees.
    const afterRestart = withDatabase(target, readProductionPolicy);
    expect(afterRestart.desiredState).toBe("active");
    expect(afterRestart.revision).toBe(1);
    expect(afterRestart.epoch).toBe(1);
    expect(afterRestart.scope?.intent).toContain("without a per-Action relay");
    expect(afterRestart.authority).toMatchObject({ grantedBy: "operator", requestId: "grant-1" });
  });

  it("carries the operator's whole-Plan intent and the delegated mechanics in scope", () => {
    const target = workspace();
    activate(target);
    const policy = withDatabase(target, readProductionPolicy);

    expect(policy.scope?.actions).toEqual(["demo/migrate", "demo/ship-it"]);
    expect(policy.scope?.mechanicalTransitions).toEqual(["acceptance", "pointer", "validation"]);
    expect(policy.scope?.maxConcurrentSessions).toBe(1);
  });

  it("refuses a scope that does not carry the operator's intent", () => {
    expect(() => scope({ intent: "   " })).toThrow(/whole-Plan intent/);
  });

  it("refuses activation when the previewed scope no longer matches", () => {
    const target = workspace();
    expect(() =>
      withDatabase(target, (db) =>
        activateProduction(db, {
          requestId: "grant-mismatch",
          scope: scope(),
          scopeFingerprint: "0000000000000000000000000000abcd",
          grantedBy: "operator"
        })
      )
    ).toThrow(/no longer matches the previewed scope/);
  });

  it("replays an activation request id without transitioning twice", () => {
    const target = workspace();
    activate(target, "grant-replay");
    const replay = activate(target, "grant-replay");

    expect(replay.replayed).toBe(true);
    expect(replay.policy.revision).toBe(1);
    expect(replay.policy.epoch).toBe(1);
  });

  it("never resurrects a revoked policy from a stale expected revision", () => {
    const target = workspace();
    activate(target);
    withDatabase(target, (db) => deactivateProduction(db, { requestId: "off-1" }));

    const revoked = withDatabase(target, readProductionPolicy);
    expect(revoked.desiredState).toBe("inactive");
    expect(revoked.scope).toBeNull();
    expect(revoked.authority).toBeNull();
    expect(revoked.revokedAt).not.toBeNull();

    // A process that still believes revision 1 is current cannot re-grant.
    expect(() =>
      withDatabase(target, (db) => {
        const authorized = scope();
        return activateProduction(db, {
          requestId: "stale-worker-grant",
          scope: authorized,
          scopeFingerprint: fingerprintProductionScope(authorized),
          grantedBy: "stale-worker",
          expectedRevision: 1
        });
      })
    ).toThrow(/moved since it was previewed/);
  });
});

describe("admission gating", () => {
  it("refuses every admission while production is Inactive", () => {
    const target = workspace();
    const outcome = admit(target, "adm-inactive");
    expect(outcome).toMatchObject({ admitted: false, code: "production_inactive" });
  });

  it("admits in-scope work and refuses work outside the authorization", () => {
    const target = workspace();
    activate(target);

    expect(admit(target, "adm-ok").admitted).toBe(true);
    expect(admit(target, "adm-elsewhere", { actionKey: "other/thing", projectSlug: "other", planSlug: "p" }))
      .toMatchObject({ admitted: false, code: "outside_scope" });
    expect(admit(target, "adm-provider", { provider: "unlisted" }))
      .toMatchObject({ admitted: false, code: "provider_not_permitted" });
  });

  it("holds the authorized concurrency ceiling", () => {
    const target = workspace();
    activate(target);

    expect(admit(target, "adm-first").admitted).toBe(true);
    expect(admit(target, "adm-second", { actionKey: "demo/ship-it" }))
      .toMatchObject({ admitted: false, code: "concurrency_limit" });

    withDatabase(target, (db) => releaseAdmission(db, "adm-first"));
    expect(admit(target, "adm-third", { actionKey: "demo/ship-it" }).admitted).toBe(true);
  });

  it("counts work still running from a previous grant against the ceiling", () => {
    const target = workspace();
    activate(target, "grant-carry-1");
    admit(target, "adm-carried");
    withDatabase(target, (db) => commitAdmission(db, "adm-carried"));

    // Off does not stop committed work, and the next grant must not admit past
    // the ceiling just because the running Action came from the old epoch.
    withDatabase(target, (db) => deactivateProduction(db, { requestId: "off-carry" }));
    activate(target, "grant-carry-2");

    expect(admit(target, "adm-after-carry", { actionKey: "demo/ship-it" }))
      .toMatchObject({ admitted: false, code: "concurrency_limit" });

    withDatabase(target, (db) => releaseAdmission(db, "adm-carried"));
    expect(admit(target, "adm-after-release", { actionKey: "demo/ship-it" }).admitted).toBe(true);
  });

  it("expires a reservation that is never redeemed", () => {
    const target = workspace();
    activate(target);
    const issuedAt = new Date("2026-09-05T12:00:00.000Z");
    admit(target, "adm-expiring", { now: issuedAt });

    const tooLate = new Date(issuedAt.getTime() + PRODUCTION_CONTROL_DEADLINES.admissionReceiptTtlMs + 1);
    const outcome = withDatabase(target, (db) => commitAdmission(db, "adm-expiring", tooLate));

    expect(outcome).toMatchObject({ admitted: false, code: "admission_expired" });
    expect(outcome.receipt?.status).toBe("fenced");
  });

  it("is replay-safe: committing twice yields one committed admission", () => {
    const target = workspace();
    activate(target);
    admit(target, "adm-replay");

    const first = withDatabase(target, (db) => commitAdmission(db, "adm-replay"));
    const second = withDatabase(target, (db) => commitAdmission(db, "adm-replay"));

    expect(first.admitted).toBe(true);
    expect(second.admitted).toBe(true);
    expect(second.receipt?.committedAt).toBe(first.receipt?.committedAt);
  });
});

describe("Off fences new work and preserves committed work", () => {
  it("fences reserved-but-unlaunched work and lets committed work finish", () => {
    const target = workspace();
    activate(target, "grant-off", { maxConcurrentSessions: 3 });

    admit(target, "adm-running", { actionKey: "demo/migrate" });
    withDatabase(target, (db) => commitAdmission(db, "adm-running"));
    admit(target, "adm-queued", { actionKey: "demo/ship-it" });

    const off = withDatabase(target, (db) => deactivateProduction(db, { requestId: "off-2" }));

    expect(off.fenced.map((admission) => admission.requestId)).toEqual(["adm-queued"]);
    expect(off.committed.map((admission) => admission.requestId)).toEqual(["adm-running"]);
    expect(off.withinAcknowledgementDeadline).toBe(true);

    const admissions = withDatabase(target, (db) => listAdmissions(db));
    expect(admissions.find((a) => a.requestId === "adm-queued")).toMatchObject({
      status: "fenced",
      fencedReason: "production_off"
    });
    expect(admissions.find((a) => a.requestId === "adm-running")?.status).toBe("committed");
  });

  it("refuses a launch that tries to commit after Off", () => {
    const target = workspace();
    activate(target);
    admit(target, "adm-late");
    withDatabase(target, (db) => deactivateProduction(db, { requestId: "off-3" }));

    const outcome = withDatabase(target, (db) => commitAdmission(db, "adm-late"));
    expect(outcome).toMatchObject({ admitted: false, code: "production_inactive" });
  });

  it("fences an admission carried across an Off/reactivate epoch boundary", () => {
    const target = workspace();
    activate(target, "grant-epoch-1");
    admit(target, "adm-across");
    withDatabase(target, (db) => deactivateProduction(db, { requestId: "off-4" }));
    activate(target, "grant-epoch-2");

    const outcome = withDatabase(target, (db) => commitAdmission(db, "adm-across"));
    expect(outcome).toMatchObject({ admitted: false, code: "production_inactive" });

    // A producer tick that resolved work under the old epoch is refused up front.
    const stale = admit(target, "adm-stale-epoch", { expectedEpoch: 1 });
    expect(stale).toMatchObject({ admitted: false, code: "stale_epoch" });
    expect(admit(target, "adm-fresh-epoch", { expectedEpoch: 2 }).admitted).toBe(true);
  });

  it("keeps Off durable and acknowledged within the frozen control target", () => {
    const target = workspace();
    activate(target);
    const off = withDatabase(target, (db) => deactivateProduction(db, { requestId: "off-5" }));

    expect(off.elapsedMs).toBeLessThanOrEqual(PRODUCTION_CONTROL_DEADLINES.offAcknowledgementMs);
    expect(off.withinAcknowledgementDeadline).toBe(true);
    expect(withDatabase(target, readProductionPolicy).desiredState).toBe("inactive");
  });
});

/**
 * Two connections to the same workspace database stand in for two host
 * workers. SQLite serializes their IMMEDIATE transactions, which is exactly
 * the property under test: the Off transaction and the launch commit cannot
 * both believe they won. The seeded loop is a regression screen over both
 * interleavings, not a statistical claim about production.
 */
describe("Off races an in-flight launch commitment", () => {
  it("resolves every seeded interleaving to exactly one outcome", () => {
    const target = workspace();
    const workerA = openDatabase(target);
    const workerB = openDatabase(target);

    try {
      for (let seed = 0; seed < 200; seed += 1) {
        const requestId = `race-${seed}`;
        activateProduction(workerA, {
          requestId: `race-grant-${seed}`,
          scope: scope(),
          scopeFingerprint: fingerprintProductionScope(scope()),
          grantedBy: "operator"
        });

        const issued = issueAdmission(workerA, {
          requestId,
          actionKey: "demo/migrate",
          projectSlug: "demo",
          planSlug: "queue-plan",
          provider: "claude"
        });
        expect(issued.admitted).toBe(true);

        const commitFirst = seed % 2 === 0;
        const commit = () => commitAdmission(workerB, requestId);
        const off = () => deactivateProduction(workerA, { requestId: `race-off-${seed}` });

        const outcome = commitFirst ? (() => { const c = commit(); off(); return c; })()
                                    : (() => { off(); return commit(); })();

        const settled = listAdmissions(workerA).find((a) => a.requestId === requestId)!;

        if (commitFirst) {
          // Committed before the cutoff: named as existing work, never concealed.
          expect(outcome.admitted).toBe(true);
          expect(settled.status).toBe("committed");
        } else {
          // Fenced by the cutoff: no process may start for it.
          expect(outcome.admitted).toBe(false);
          expect(settled.status).toBe("fenced");
        }

        // The invariant either way: never both, and never neither.
        expect(["committed", "fenced"]).toContain(settled.status);
        expect(settled.committedAt === null).toBe(settled.status === "fenced");
        releaseAdmission(workerA, requestId);
      }
    } finally {
      workerA.close();
      workerB.close();
    }
  });
});

describe("policy-store failure is never a confirmed Off", () => {
  it("reports unavailable, refuses admission and does not render Inactive", () => {
    const target = workspace();
    const db = openDatabase(target);
    try {
      db.exec("DROP TABLE production_policy");

      const read = readProductionPolicySafely(db);
      expect(read.status).toBe("unavailable");

      const display = describeProductionState(read, 0);
      expect(display.state).toBe("observation_unavailable");
      expect(display.label).toContain("not a confirmed Off");

      const outcome = issueAdmission(db, {
        requestId: "adm-unreadable",
        actionKey: "demo/migrate",
        projectSlug: "demo",
        planSlug: "queue-plan",
        provider: "claude"
      });
      expect(outcome).toMatchObject({ admitted: false, code: "policy_unavailable" });
    } finally {
      db.close();
    }
  });

  it("separates desired state from observed activity", () => {
    const target = workspace();
    activate(target, "grant-display", { maxConcurrentSessions: 2 });
    admit(target, "adm-display");
    withDatabase(target, (db) => commitAdmission(db, "adm-display"));

    withDatabase(target, (db) => {
      expect(describeProductionState(readProductionPolicySafely(db), 1).state).toBe("active_building");
      expect(describeProductionState(readProductionPolicySafely(db), 0).state).toBe("active_idle");
      deactivateProduction(db, { requestId: "off-display" });
      expect(describeProductionState(readProductionPolicySafely(db), 1).state).toBe("inactive_finishing");
      expect(describeProductionState(readProductionPolicySafely(db), 0).state).toBe("inactive_idle");
    });
  });
});

describe("the control surface stays reachable when other sources are broken", () => {
  it("reads status and switches Off without touching the queue or a repository", () => {
    const target = workspace();
    activate(target);

    // A Project whose repository is gone makes every queue and document read
    // fail. Status and Off must not depend on any of it.
    withDatabase(target, (db) => {
      const project = upsertProject(db, {
        name: "Broken",
        mission: "Break every document read.",
        status: "active",
        currentMilestone: "None",
        nextAction: "Repair the repository.",
        workClassification: "agent"
      });
      upsertProjectMetadata(db, { projectId: project.id, repoPath: path.join(target, "does-not-exist") });
    });

    const status = runProductionStatusCommand({ workspace: target });
    expect(status.data.display.state).toBe("active_idle");

    const off = runProductionDeactivateCommand({ workspace: target, requestId: "off-broken" });
    expect(off.data.result.policy.desiredState).toBe("inactive");
    expect(off.data.result.withinAcknowledgementDeadline).toBe(true);
  });

  it("surfaces a failed Off within the visibility target instead of confirming it", () => {
    const target = workspace();
    activate(target);
    const db = openDatabase(target);
    try {
      db.exec("DROP TABLE production_policy");

      const startedAt = Date.now();
      expect(() => deactivateProduction(db, { requestId: "off-unwritable" })).toThrow();
      expect(Date.now() - startedAt).toBeLessThanOrEqual(
        PRODUCTION_CONTROL_DEADLINES.offFailureVisibleMs
      );
      // Nothing reported a confirmed Off, and the policy is still unreadable.
      expect(readProductionPolicySafely(db).status).toBe("unavailable");
    } finally {
      db.close();
    }
  });

  it("freezes the control deadlines and the bounded attempt budget from contract 20", () => {
    expect(PRODUCTION_CONTROL_DEADLINES).toMatchObject({
      offAcknowledgementMs: 2_000,
      offFailureVisibleMs: 5_000,
      producerTickMs: 2_000,
      admissionLatencyTicks: 2,
      maxRepairAttemptsPerAction: 2
    });
  });
});

describe("activation preview", () => {
  function fixtureWorkspace(): string {
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
      path.join(repo, "docs", "plans", "queue-plan.md"),
      [
        "---", "arcadia: v1", "type: plan", "slug: queue-plan", "project: demo", "status: active",
        "milestone: Queue milestone", "token_impact: medium",
        "token_budget: One bounded implementation pass.", "recommended_model: gpt-5.6-terra",
        "current_action: migrate",
        "updated: 2026-09-05", "actions:",
        "  - id: migrate", "    title: Prepare the fixture", "    status: open",
        "    responsibility: agent", "    next_action: Prepare the fixture.",
        "    expected_artifact: A prepared fixture", "    clarification: clarified",
        "    acceptance_criteria:", "      - The fixture is prepared.", "    depends_on: []",
        "  - id: ship-it", "    title: Ship the view", "    status: open",
        "    responsibility: agent", "    next_action: Implement the view.",
        "    expected_artifact: A visible view", "    clarification: clarified",
        "    acceptance_criteria:", "      - The view is visible.", "    depends_on: [migrate]",
        "---", "", "# Queue plan", ""
      ].join("\n"),
      "utf8"
    );

    const target = path.join(scratch(), "workspace");
    initWorkspace(target);
    withDatabase(target, (db) => {
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
    return target;
  }

  it("shows the ordered Action scope, providers, concurrency and delegated mechanics", () => {
    const target = fixtureWorkspace();
    const preview = withDatabase(target, (db) =>
      buildProductionActivationPreview(db, {
        projects: ["demo"],
        providers: ["claude", "codex"],
        intent: "Finish the queue Plan.",
        maxConcurrentSessions: 2,
        mechanicalTransitions: ["validation", "pointer"]
      })
    );

    expect(preview.orderedActions.map((action) => action.actionKey)).toEqual([
      "demo/migrate",
      "demo/ship-it"
    ]);
    expect(preview.includedPlans).toEqual(["demo/queue-plan"]);
    expect(preview.scope.providers).toEqual(["claude", "codex"]);
    expect(preview.scope.maxConcurrentSessions).toBe(2);
    expect(preview.scope.mechanicalTransitions).toEqual(["pointer", "validation"]);
    expect(preview.expectedRevision).toBe(0);
    expect(preview.offConsequence).toContain("keeps running");
    expect(preview.explicitStops.join(" ")).toContain("needs its own Decision");
    expect(preview.controlDeadlines).toBe(PRODUCTION_CONTROL_DEADLINES);
  });

  it("writes nothing", () => {
    const target = fixtureWorkspace();
    withDatabase(target, (db) =>
      buildProductionActivationPreview(db, {
        projects: ["demo"],
        providers: ["claude"],
        intent: "Finish the queue Plan."
      })
    );
    expect(withDatabase(target, readProductionPolicy)).toMatchObject({
      desiredState: "inactive",
      revision: 0
    });
  });

  it("names requested Projects the queue does not offer", () => {
    const target = fixtureWorkspace();
    const preview = withDatabase(target, (db) =>
      buildProductionActivationPreview(db, {
        projects: ["demo", "ghost"],
        providers: ["claude"],
        intent: "Finish the queue Plan."
      })
    );
    expect(preview.unmatched.projects).toEqual(["ghost"]);
  });

  it("changes its fingerprint when the authorization changes", () => {
    const target = fixtureWorkspace();
    const base = withDatabase(target, (db) =>
      buildProductionActivationPreview(db, {
        projects: ["demo"], providers: ["claude"], intent: "Finish the queue Plan."
      })
    );
    const wider = withDatabase(target, (db) =>
      buildProductionActivationPreview(db, {
        projects: ["demo"], providers: ["claude"], intent: "Finish the queue Plan.", maxConcurrentSessions: 4
      })
    );
    expect(wider.scopeFingerprint).not.toBe(base.scopeFingerprint);
  });
});

describe("judgment requests", () => {
  it("accepts a request that shows objective, evidence, options with consequences and a recommendation", () => {
    const request = buildJudgmentRequest({
      objective: "Decide whether the bootstrap Plan admits its second provider.",
      evidence: ["Codex telemetry is 40 minutes stale.", "Claude has capacity until 18:00."],
      options: [
        { label: "Admit on Claude only", consequence: "Work continues at one Session; Codex stays idle.", recommended: true },
        { label: "Wait for fresh Codex telemetry", consequence: "Nothing is admitted for up to an hour." }
      ],
      recommendation: "Admit on Claude only; the Codex window is unproven.",
      actionKey: "demo/migrate"
    });

    expect(request.options).toHaveLength(2);
    expect(request.options[0].recommended).toBe(true);
  });

  it("refuses a single-option request, a consequence-free option, and a missing recommendation", () => {
    const base = {
      objective: "Decide something.",
      evidence: ["Some evidence."],
      recommendation: "Do the first one."
    };

    expect(() =>
      buildJudgmentRequest({ ...base, options: [{ label: "Only choice", consequence: "It happens." }] })
    ).toThrow(/two or more meaningful options/);

    expect(() =>
      buildJudgmentRequest({
        ...base,
        options: [{ label: "A", consequence: "Something." }, { label: "B", consequence: "  " }]
      })
    ).toThrow(/needs its consequence stated/);

    expect(() =>
      buildJudgmentRequest({
        ...base,
        recommendation: "  ",
        options: [{ label: "A", consequence: "Something." }, { label: "B", consequence: "Other." }]
      })
    ).toThrow(/must state a recommendation/);
  });
});
