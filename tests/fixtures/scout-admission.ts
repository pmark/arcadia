import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { ADMISSION_STORE_SCHEMA, SCOUT_GOAL, admissionDigest, type AdmissionScope, type ScoutAdmissionEvidence, type ScoutAdmissionHistory } from "../../src/scout/runAdmission.js";
import type { LeakSnapshot } from "../../src/workspace/leakCheck.js";

/** Explicit synthetic seed for disposable tests only; never import from runtime. */
export function admissionFixture(scope: AdmissionScope, now = Date.now(), fixtureRoot = path.dirname(scope.workspace)) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "scout-admission-stores-")));
  const live = path.join(root, "protected-live");
  const ledger = path.join(root, "ledger", "history.sqlite");
  const witness = path.join(root, "independent", "witness.sqlite");
  for (const dir of [live, path.dirname(ledger), path.dirname(witness)]) mkdirSync(dir, { recursive: true });
  const stamp = new Date(now).toISOString();
  const hashes = { userConfig: "a".repeat(64), codexConfig: "b".repeat(64), claudeSettings: "c".repeat(64), claudeTrust: "d".repeat(64), capacityReceipts: "e".repeat(64) };
  const before: LeakSnapshot = { schema: "arcadia-leak-check-v1", takenAt: stamp,
    liveWorkspace: { path: live, projectCount: 0, queueRevision: 0, productionPolicy: { desiredState: "inactive", revision: 0, epoch: 0 }, productionPolicyReceipts: 0, productionAdmissions: 0, error: null },
    hashes, goBroker: {}, launchAgents: {} };
  const evidence: ScoutAdmissionEvidence = {
    schema: "arcadia-scout-admission-evidence-v1", mode: "scripted-fixture", scope: { ...scope },
    assignment: { decision: "0128", approved: true, scope: { ...scope }, implementer: "explicit-fixture-builder" },
    codeReview: { session: "explicit-fixture-reviewer", sourceHead: scope.sourceHead, verdict: "pass" },
    qa: { session: "explicit-fixture-qa", sourceHead: scope.sourceHead, verdict: "pass" },
    isolation: { pins: { sourceRevision: scope.sourceHead, nodeVersion: process.version, model: "gpt-6-luna", effort: "low",
      fixtureRoot, workspace: scope.workspace, fixtureRepo: scope.repo, liveWorkspacePath: live, fixtureTrustPath: scope.repo },
      before, after: structuredClone(before), decision: { canonicalPath: "docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md",
        text: readFileSync("docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md", "utf8") } },
    capacity: { version: 1, providerId: "codex-cli", providerLabel: "Fixture Codex", profiles: ["light"], accountScope: "fixture",
      source: "codex_app_server", evidence: "simulated", unattended: true, observedAt: stamp, observedAgeMs: 0, expiresAt: null,
      confidence: "observed", freshness: "fresh", usagePolicy: "included", usagePolicyReason: "explicit fixture",
      windows: [{ label: "fixture window", usedPercentage: 1, remainingPercentage: 99, resetsAt: new Date(now + 24 * 60 * 60_000).toISOString() }],
      nextResetAt: null, credits: { hasCredits: false, unlimited: false, balance: "0" }, bankedResets: [], planScope: "fixture", unsupported: [], availability: "available", telemetry: "synthetic fixture only" },
    billing: { subscriptionOnly: true, incrementalPaidCeiling: 0, apiBilling: false, credits: false, resetPurchase: false, fallback: false }, retry: null
  };
  const history: ScoutAdmissionHistory = { schema: 1, goal: SCOUT_GOAL, lineage: "explicit-synthetic-fixture-lineage", sequence: 0,
    firstLaunch: null, lastClock: now, repairs: 0, attempts: [] };
  for (const [file, body] of [[ledger, history], [witness, { schema: 1, lineage: history.lineage, sequence: 0, digest: admissionDigest(history), evidenceSha256: admissionDigest(evidence) }]] as const) {
    const db = new Database(file); db.exec(ADMISSION_STORE_SCHEMA);
    db.prepare("INSERT INTO scout_admission VALUES (?, ?)").run(SCOUT_GOAL, JSON.stringify(body)); db.close();
  }
  const stores = { ledger, witness };
  return { root, stores, evidence, history,
    read: () => { const db = new Database(ledger); try { return JSON.parse((db.prepare("SELECT body FROM scout_admission WHERE goal = ?").get(SCOUT_GOAL) as { body: string }).body) as ScoutAdmissionHistory; } finally { db.close(); } },
    pin: () => { const db = new Database(witness); try { const row = JSON.parse((db.prepare("SELECT body FROM scout_admission WHERE goal = ?").get(SCOUT_GOAL) as { body: string }).body) as Record<string, unknown>;
      row.evidenceSha256 = admissionDigest(evidence); db.prepare("UPDATE scout_admission SET body = ? WHERE goal = ?").run(JSON.stringify(row), SCOUT_GOAL); } finally { db.close(); } }
  };
}
