import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listPendingAgentAskNotifications } from "../src/ask/settlement.js";
import { openDatabase, withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { PRODUCTION_CONTROL_DEADLINES } from "../src/production/policy.js";
import {
  diagnoseOpenRedAlerts,
  listRedAlertDiagnoses,
  readDiagnosisSettings,
  type DiagnosisDeps,
  type GhRunner
} from "../src/production/redAlertDiagnosis.js";
import { ADMISSION_REFUSAL_MIN_MS, ADMISSION_REFUSAL_MIN_TICKS, listOpenRedAlerts, type RedAlertTrigger } from "../src/production/redAlerts.js";
import { ensureSessionExitReceiptsTable } from "../src/sessions/reconciliation.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { Rehearsal, type RehearsalOptions } from "./helpers/rehearsalHarness.js";

/**
 * Red alert proof (`prove-red-alert-with-injected-failures`): the real worker
 * tick, driven through the rehearsal harness, is handed each Stop-the-line
 * failure in turn. Every case asserts the alert is raised with evidence, posts
 * exactly one notification however many ticks still see the failure, starts
 * exactly one bounded diagnosis, and clears once the failure is resolved.
 *
 * Hermetic: diagnosis is enabled only in the temp workspace's own config, and
 * its model call and `gh` are fakes, so no model usage, network or live
 * production grant is involved. The simulated tmux, agent and provider are the
 * harness's (see rehearsalHarness.ts).
 */

const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

/** Fixture, registration, activation. Packet approval is left to the caller's options. */
function activated(options: RehearsalOptions = {}) {
  const rehearsal = new Rehearsal(options);
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  const approvalA = rehearsal.registerProject();
  return { rehearsal, approvalA };
}

function activatedAndApproved() {
  const fixture = activated();
  fixture.rehearsal.approve(fixture.approvalA);
  fixture.rehearsal.activate();
  return fixture.rehearsal;
}

/** The alert's own tick clock moves only as far as the test says. */
function advance(rehearsal: Rehearsal, ms: number): void {
  rehearsal.now = new Date(rehearsal.now.getTime() + ms);
}

function openAlerts(rehearsal: Rehearsal) {
  return withReadOnlyDatabase(rehearsal.workspace, (db) => listOpenRedAlerts(db));
}

function redNotices(rehearsal: Rehearsal) {
  return withDatabase(rehearsal.workspace, (db) => listPendingAgentAskNotifications(db).filter((entry) => entry.requestId?.startsWith("red-alert-")));
}

/** Enable diagnosis in this temp workspace only, and hand back fakes for its two outside calls. */
function diagnosisHarness(rehearsal: Rehearsal) {
  const configFile = getWorkspacePaths(rehearsal.workspace).configFile;
  const config = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
  writeFileSync(configFile, JSON.stringify({ ...config, redAlertDiagnosis: { enabled: true, issueRepo: "pmark/arcadia", tokenBudget: 4000 } }, null, 2));
  const settings = readDiagnosisSettings(rehearsal.workspace);
  expect(settings.enabled).toBe(true);

  const model = vi.fn(async ({ prompt }: { prompt: string }) => {
    expect(prompt).toContain("Evidence file:");
    return {
      finding: {
        cause: "Injected failure diagnosed by the fake model.",
        evidence: [{ file: "src/production/stallDetection.ts", line: 800, note: "where the tick observed it" }],
        proposedFix: { summary: "Fix the injected failure.", files: ["src/production/stallDetection.ts"], acceptance: ["The failure no longer recurs."] }
      },
      tokensUsed: 700
    };
  });
  const ghCalls: string[][] = [];
  const gh: GhRunner = async (args) => {
    ghCalls.push(args);
    if (args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
    if (args[1] === "create") return { status: 0, stdout: "https://github.com/pmark/arcadia/issues/9001\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const drafted: string[] = [];
  const deps: DiagnosisDeps = {
    model: { route: "fake-local-route", diagnose: model },
    gh,
    draftAsk: (request) => {
      drafted.push(request);
      return { path: path.join(rehearsal.workspace, "drafted-fix-ask.yaml") };
    }
  };
  const run = async () => {
    // The diagnosis is async, so it needs a handle that outlives one synchronous callback.
    const db = openDatabase(rehearsal.workspace);
    try {
      return await diagnoseOpenRedAlerts(db, settings, () => deps);
    } finally {
      db.close();
    }
  };
  const issuesCreated = () => ghCalls.filter((args) => args[0] === "issue" && args[1] === "create").length;
  return { run, model, drafted, issuesCreated };
}

/**
 * The shared assertions. `failing` ticks the fixture once with the failure
 * still present; `resolve` removes it and ticks. Returns the alert raised.
 */
function proveAlertLifecycle(
  rehearsal: Rehearsal,
  expected: { trigger: RedAlertTrigger; detail: RegExp },
  failing: () => void,
  resolve: () => void
) {
  const alerts = openAlerts(rehearsal);
  expect(alerts).toHaveLength(1);
  const [alert] = alerts;
  expect(alert.trigger).toBe(expected.trigger);
  expect(alert.projectSlug).toBe(rehearsal.projectSlug);
  expect(alert.detail).toMatch(expected.detail);
  expect(existsSync(alert.evidencePath)).toBe(true);
  const evidence = readFileSync(alert.evidencePath, "utf8");
  expect(evidence).toContain(`- Trigger: ${expected.trigger}`);
  expect(evidence).toContain(alert.detail);

  // Exactly one notification, carrying the trigger and the evidence path.
  const notices = redNotices(rehearsal);
  expect(notices).toHaveLength(1);
  expect(notices[0].requestId).toBe(alert.requestId);
  expect(notices[0].desiredResult).toContain(expected.trigger);
  expect(notices[0].desiredResult).toContain(alert.evidencePath);

  // Exactly one bounded diagnosis, however many ticks still see the failure.
  const diagnosis = diagnosisHarness(rehearsal);
  return {
    async run() {
      const first = await diagnosis.run();
      expect(first.enabled).toBe(true);
      expect(first.diagnosed).toHaveLength(1);
      expect(first.diagnosed[0]).toMatchObject({ alertId: alert.id, status: "proposed", tokenBudget: 4000, tokensUsed: 700 });
      expect(first.diagnosed[0].issueUrl).toBe("https://github.com/pmark/arcadia/issues/9001");

      failing();
      const repeated = openAlerts(rehearsal);
      expect(repeated).toHaveLength(1);
      expect(repeated[0].id).toBe(alert.id);
      expect(repeated[0].occurrences).toBeGreaterThan(alert.occurrences);
      const second = await diagnosis.run();
      expect(second.diagnosed).toHaveLength(0);
      expect(second.skipped).toBe(1);
      expect(diagnosis.model).toHaveBeenCalledTimes(1);
      expect(diagnosis.issuesCreated()).toBe(1);
      expect(diagnosis.drafted).toHaveLength(1);
      expect(withReadOnlyDatabase(rehearsal.workspace, (db) => listRedAlertDiagnoses(db))).toHaveLength(1);
      expect(redNotices(rehearsal)).toHaveLength(1);

      resolve();
      expect(openAlerts(rehearsal)).toHaveLength(0);
      // Clearing posts nothing further and starts no further diagnosis.
      expect(redNotices(rehearsal)).toHaveLength(1);
      const third = await diagnosis.run();
      expect(third.diagnosed).toHaveLength(0);
      expect(diagnosis.model).toHaveBeenCalledTimes(1);
    }
  };
}

describe("red alerts raised by the real tick under injected failures", () => {
  it("a stalled Session raises session_stalled, posts once, diagnoses once, and clears when its output resumes", async () => {
    const rehearsal = activatedAndApproved();
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3);
    const session = rehearsal.lease()!;
    rehearsal.tick(); // first observation of the frozen pane
    expect(openAlerts(rehearsal)).toHaveLength(0);

    advance(rehearsal, PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1);
    rehearsal.tick();

    const proof = proveAlertLifecycle(
      rehearsal,
      { trigger: "session_stalled", detail: /stall window/ },
      () => rehearsal.tick(),
      () => {
        rehearsal.tmux.capturePane = () => "agent wrote a file\n";
        rehearsal.tick();
      }
    );
    expect(openAlerts(rehearsal)[0].sessionId).toBe(session.id);
    await proof.run();
  });

  it("an admission refused on consecutive ticks raises admission_refused_consecutive, posts once, diagnoses once, and clears when admission succeeds", async () => {
    const { rehearsal, approvalA } = activated({ withoutPacketApproval: true });
    rehearsal.approve(approvalA);
    rehearsal.activate();
    rehearsal.providerSignedIn = false;

    // Refused on every tick, but not for long enough: no alert yet.
    for (let tick = 0; tick < ADMISSION_REFUSAL_MIN_TICKS - 1; tick += 1) {
      const result = rehearsal.tick();
      expect(result.launch?.outcome).toBe("refused");
    }
    expect(openAlerts(rehearsal)).toHaveLength(0);
    // The fifth refusal, past the minimum duration.
    advance(rehearsal, ADMISSION_REFUSAL_MIN_MS);
    expect(rehearsal.tick().launch?.outcome).toBe("refused");

    const proof = proveAlertLifecycle(
      rehearsal,
      { trigger: "admission_refused_consecutive", detail: new RegExp(`refused for ${ADMISSION_REFUSAL_MIN_TICKS} consecutive ticks`) },
      () => expect(rehearsal.tick().launch?.outcome).toBe("refused"),
      () => {
        rehearsal.providerSignedIn = true;
        expect(rehearsal.tick().launch?.outcome).toBe("launched");
      }
    );
    expect(openAlerts(rehearsal)[0].actionKey).toBe(rehearsal.actionA);
    await proof.run();
  });

  it("a failed reconcile raises reconcile_failed, posts once, diagnoses once, and clears when the reconcile succeeds", async () => {
    const rehearsal = activatedAndApproved();
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3);
    const session = rehearsal.lease()!;
    rehearsal.tmux.exit(session.tmux_session_name);

    // A real SQLite failure in the exit receipt write: the reconcile aborts and its transaction rolls back.
    withDatabase(rehearsal.workspace, (db) => {
      ensureSessionExitReceiptsTable(db);
      db.exec(
        "CREATE TRIGGER injected_reconcile_failure BEFORE INSERT ON session_exit_receipts BEGIN SELECT RAISE(ABORT, 'injected reconcile failure'); END;"
      );
    });
    rehearsal.tick();

    const proof = proveAlertLifecycle(
      rehearsal,
      { trigger: "reconcile_failed", detail: new RegExp(`Reconciling Session ${session.id} failed: .*injected reconcile failure`) },
      () => rehearsal.tick(),
      () => {
        withDatabase(rehearsal.workspace, (db) => db.exec("DROP TRIGGER injected_reconcile_failure"));
        rehearsal.tick();
      }
    );
    expect(openAlerts(rehearsal)[0].sessionId).toBe(session.id);
    await proof.run();
  });
});
