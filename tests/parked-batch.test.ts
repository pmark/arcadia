import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectDayGrantChain, isFailedBatch, isParkedForYouBatch, failedBatchesInWindow, STANDING_SLUG, type DayEvidenceActivation
} from "../src/operatorActions/startRunDayGrant.js";
import { StartRunDelegationError } from "../src/operatorActions/startRunDelegation.js";
import {
  PARKED_BATCH_SLUG, classifyPark, findParkedBatchDecision, isParkedBatchAnswered, parkedBatchEnabled, readLiveParkedBatch, scopeActionKeys,
  type ParkedBatchDecisionSource
} from "../src/production/parkedBatch.js";
import { ensureProductionPolicyTables, readDayGrantEvidence } from "../src/production/policy.js";
import { ensureProductionReviewStepTable } from "../src/production/independentReview.js";
import { ensureWorkerMergeTable } from "../src/production/workerMerge.js";
import { DAY_PLAN, evidenceOf, named, pressKey, STOP_ID, writeDayScenario, type DayScenario } from "./helpers/dayGrantFixture.js";

/**
 * The "parked for you" batch reading (the draft Decision 0282, option A): a batch whose pinned steps are each merged or
 * parked for a policy reason, at least one parked, is not a failed batch, and only when that Decision is answered A on the
 * pinned main. These tests replay recorded production shapes against the real readers; no new record is written by any of them.
 */
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const tempDir = (prefix: string) => { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))); directories.push(dir); return dir; };

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const URL_A = "https://github.com/pmark/arcadia/pull/101";
const URL_B = "https://github.com/pmark/arcadia/pull/102";
const SINCE = "2026-11-03T19:26:51Z";
const ON = "2026-11-22T06:00:00.000Z";
const OFF = "2026-11-22T09:00:00.000Z";
const STEPS = ["arcadia/park-and-continue", "arcadia/finish-allocate"];

const authorityAdjacent = (head: string, suffix = "") => `The blast-radius assessment marks ${head.slice(0, 12)} authority-adjacent: the diff touches src/production/standingMerge.ts.${suffix}`;
const c4 = authorityAdjacent(HEAD_A, " Standing merge parked at C4: the diff touches the shared gate set or a hard class: src/production/standingMerge.ts");
const c1Delegated = authorityAdjacent(HEAD_B, " Standing merge parked at C1: card standing-start-abc was pressed under a delegation, which records no operator-pressed Action content");
const noAuthorization = authorityAdjacent(HEAD_A);

interface WorkerRow { action: string; head?: string; url?: string | null; outcome?: string; code?: string | null; reason?: string; at?: string }

/** A workspace database with one activation over `scope`, ended at OFF unless `open`, plus the worker's merge rows. */
function database(options: { scope?: string[] | string; rows?: WorkerRow[]; escalations?: Array<[string, string]>; reviewSteps?: Array<[string, string, string]>; noWorkerTable?: boolean; open?: boolean; scopeComplete?: { merged: number; escalated: number } } = {}) {
  const db = new Database(":memory:");
  ensureProductionPolicyTables(db);
  db.exec("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS production_operator_escalations (action_key TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, remedy TEXT, first_detected_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)");
  ensureProductionReviewStepTable(db);
  if (!options.noWorkerTable) ensureWorkerMergeTable(db);
  const scope = options.scope ?? STEPS;
  const receipt = db.prepare("INSERT INTO production_policy_receipts (id, request_id, transition, revision_before, revision_after, epoch_after, receipt_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)");
  receipt.run("r1", "start-card-2", "activate", 100, 101, typeof scope === "string" ? scope : JSON.stringify({ scope: { actions: scope } }), ON);
  if (!options.open) receipt.run("r2", "rowan-off-successor-press-scope-complete", "deactivate", 101, 102, "{}", OFF);
  db.prepare("INSERT INTO production_admissions (id, request_id, action_key, project_slug, plan_slug, provider, epoch, policy_revision, status, issued_at, expires_at, committed_at) VALUES ('a1', 'a1', 'arcadia/park-and-continue', 'arcadia', 'p', 'claude-code', 1, 101, 'released', ?, ?, ?)").run(ON, OFF, ON);
  if (options.scopeComplete) db.prepare("INSERT INTO events (id, event_type, payload_json, created_at) VALUES ('e1', 'managed_production.scope_complete', ?, ?)").run(JSON.stringify({ projectSlug: "arcadia", policyRevision: 101, ...options.scopeComplete }), "2026-11-22T08:00:00.000Z");
  (options.rows ?? []).forEach((row, index) => {
    const insert = db.prepare("INSERT INTO production_worker_merges (request_id, session_id, action_key, pull_request_url, head, outcome, code, reason, boundaries_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)");
    const head = row.head ?? HEAD_A;
    insert.run(`worker-merge-s${index}-${head}`, `s${index}`, row.action, row.url === undefined ? URL_A : row.url, head, row.outcome ?? "refused", row.code === undefined ? "authority_adjacent" : row.code, row.reason ?? c4, row.at ?? "2026-11-22T07:00:00.000Z");
  });
  for (const [action, kind] of options.escalations ?? []) db.prepare("INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES (?, ?, 'm', 'r', ?, ?)").run(action, kind, ON, ON);
  for (const [action, head, at] of options.reviewSteps ?? []) {
    db.prepare("INSERT INTO production_review_steps (request_id, session_id, action_key, target_head, pull_request_url, policy_epoch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").run(`rs-${action}-${head}`, "s", action, head, URL_A, at, at);
  }
  return db;
}
const twoParked: WorkerRow[] = [
  { action: STEPS[0], head: HEAD_A, url: URL_A, reason: c4 },
  { action: STEPS[1], head: HEAD_B, url: URL_B, reason: c1Delegated }
];
const evidenceOfDb = (db: Database.Database) => readDayGrantEvidence(db, SINCE);
/** The activation's reading as the day-evidence record carries it: scope read from the receipt, window from its activation and Off. */
const reading = (db: Database.Database) => evidenceOfDb(db).activations[0].parked!;

describe("classifyPark: only the three policy reservations", () => {
  it.each([
    ["a C4 park on a protected path", c4, "C4"],
    ["a C4 park on a hard class", authorityAdjacent(HEAD_A, " Standing merge parked at C4: the diff touches a hard class: decisions"), "C4"],
    ["a C1 park of a delegated card", c1Delegated, "C1"],
    ["a C1 park of an Action the card does not pin", authorityAdjacent(HEAD_A, " Standing merge parked at C1: Action x is not pinned on card c-1; added scope waits for the operator"), "C1"],
    ["a C1 park of a changed requirement", authorityAdjacent(HEAD_A, " Standing merge parked at C1: Action x's requirement content changed since the operator approved it on card c-1 (a -> b); it waits"), "C1"],
    ["the plain refusal with no authorizing in-run Decision", noAuthorization, "authorization"]
  ])("reads %s", (_label, reason, condition) => expect(classifyPark(reason)).toBe(condition));

  it.each([
    ["a C2 park (review marker)", authorityAdjacent(HEAD_A, " Standing merge parked at C2: no \"Independent review, head\" comment names exactly aaaaaaaaaaaa")],
    ["a C5 park", authorityAdjacent(HEAD_A, " Standing merge parked at C5: production is not Active for a pressed START card")],
    ["a C1 park whose inputs could not be read", authorityAdjacent(HEAD_A, " Standing merge parked at C1: the card c-1 pins could not be read: ENOENT")],
    ["a C4 park whose paths could not be read", authorityAdjacent(HEAD_A, " Standing merge parked at C4: the changed paths of the candidate could not be read")],
    ["a reason that names two conditions", `${c4} Standing merge parked at C1: card c was pressed under a delegation`],
    ["a text that is not a worker refusal at all", "something else happened"],
    ["an empty reason", ""]
  ])("does not read %s", (_label, reason) => expect(classifyPark(reason)).toBeNull());
});

describe("readParkedBatch: replayed production shapes", () => {
  it("(2) reads a batch whose two pull requests both parked at C4 and C1 as parked for you, whether or not the operator merges them later", () => {
    const db = database({ rows: twoParked, reviewSteps: [[STEPS[0], HEAD_A, "2026-11-22T06:50:00.000Z"], [STEPS[1], HEAD_B, "2026-11-22T06:55:00.000Z"]] });
    const result = reading(db);
    expect(result).toMatchObject({ kind: "parked-for-you", merged: [] });
    expect(result.kind === "parked-for-you" && result.parked.map((step) => [step.action, step.condition, step.head])).toEqual([[STEPS[0], "C4", HEAD_A], [STEPS[1], "C1", HEAD_B]]);
    // The operator merging them in the morning writes nothing inside this run: the reading is unchanged.
    expect(reading(db)).toEqual(result);
    // The day-evidence record carries the same reading for the activation, which has no scope-complete record.
    const [activation] = evidenceOfDb(db).activations;
    expect(activation).toMatchObject({ requestId: "start-card-2", admitted: 1, endedAt: OFF, scopeComplete: null });
    expect(activation.parked).toEqual(result);
    db.close();
  });

  it("reads one merged step and one parked step as parked for you, and an all-merged batch as not parked (the scope-complete reading governs it)", () => {
    const mixed = database({ rows: [{ action: STEPS[0], outcome: "merged", code: null, reason: "Merged." }, { action: STEPS[1], head: HEAD_B, url: URL_B, reason: c1Delegated }] });
    expect(reading(mixed)).toMatchObject({ kind: "parked-for-you", merged: [STEPS[0]] });
    mixed.close();
    const allMerged = database({ rows: STEPS.map((action) => ({ action, outcome: "merged", code: null, reason: "Merged." })) });
    expect(reading(allMerged)).toMatchObject({ kind: "not-parked", reason: "no pinned step is parked" });
    allMerged.close();
  });

  it("(1) card 2 of 2026-11-22: park-and-continue parked and the operator merged it, but finish-allocate failed its governed review: stays FAILED, not parked", () => {
    const failedReview = database({ rows: [
      { action: STEPS[0], head: HEAD_A, url: URL_A, reason: c4 },
      { action: STEPS[1], head: HEAD_B, url: URL_B, code: "review_missing", reason: `No passing independent review of ${HEAD_B.slice(0, 12)} is recorded: the verdict failed.` }
    ] });
    expect(reading(failedReview)).toMatchObject({ kind: "not-parked", reason: expect.stringContaining("review_missing") });
    const [activation] = evidenceOfDb(failedReview).activations;
    expect(isFailedBatch(activation, true)).toBe(true);
    expect(isFailedBatch(activation, false)).toBe(true);
    failedReview.close();
    // The same card where finish-allocate left no record at all (it never reached the worker).
    const absent = database({ rows: [{ action: STEPS[0], head: HEAD_A, url: URL_A, reason: c4 }] });
    expect(reading(absent)).toMatchObject({ kind: "not-parked", reason: `${STEPS[1]} has no worker-merge record in this run` });
    absent.close();
  });

  it("(3) last night's verify run, {merged 1, escalated 1}: its scope-complete record governs, so a parked reading is never computed and it stays failed", () => {
    const db = database({ scopeComplete: { merged: 1, escalated: 1 }, scope: ["arcadia/only-step"], rows: [{ action: "arcadia/only-step", reason: c4 }] });
    const [activation] = evidenceOfDb(db).activations;
    expect(activation).toMatchObject({ scopeComplete: { merged: 1, escalated: 1 }, parked: null });
    expect(isFailedBatch(activation, true)).toBe(true);
    expect(isFailedBatch(activation, false)).toBe(true);
    expect(isParkedForYouBatch(activation, true)).toBe(false);
    // A clean scope-complete batch is untouched too.
    expect(isFailedBatch({ admitted: 1, scopeComplete: { merged: 1, escalated: 0 }, parked: null }, true)).toBe(false);
    db.close();
  });

  it.each<[string, () => Database.Database, string | RegExp]>([
    ["(4) no worker-merge table at all", () => database({ noWorkerTable: true }), "no worker-merge outcomes"],
    ["(4) a partial record: only one of two pinned steps", () => database({ rows: [twoParked[0]] }), "has no worker-merge record"],
    ["(4) an unreadable activation scope", () => database({ scope: "not json", rows: twoParked }), "could not be read"],
    ["(4) a park reason nobody can classify", () => database({ rows: [twoParked[0], { ...twoParked[1], reason: "Worker merge refused: unknown" }] }), "does not name a policy reservation"],
    ["(4) a park with no pull request URL", () => database({ rows: [twoParked[0], { ...twoParked[1], url: null }] }), "names no pull request or exact head"],
    ["(4) a park with a head that is not a full commit id", () => database({ rows: [twoParked[0], { ...twoParked[1], head: "abc123" }] }), "names no pull request or exact head"],
    ["a C2 park", () => database({ rows: [twoParked[0], { ...twoParked[1], reason: authorityAdjacent(HEAD_B, " Standing merge parked at C2: no review marker") }] }), "does not name a policy reservation"],
    ["a C5 park", () => database({ rows: [twoParked[0], { ...twoParked[1], reason: authorityAdjacent(HEAD_B, " Standing merge parked at C5: production is not Active for a pressed START card") }] }), "does not name a policy reservation"],
    ["a red check", () => database({ rows: [twoParked[0], { ...twoParked[1], code: "check_failed", reason: "A check did not pass" }] }), "check_failed"],
    ["a moved head", () => database({ rows: [twoParked[0], { ...twoParked[1], code: "head_moved", reason: "moved" }] }), "head_moved"],
    ["an escalation on a pinned step", () => database({ rows: twoParked, escalations: [[STEPS[1], "repair_budget_exhausted"]] }), "is escalated"],
    ["a candidate reviewed at another head after it parked", () => database({ rows: twoParked, reviewSteps: [[STEPS[1], "c".repeat(40), "2026-11-22T08:00:00.000Z"]] }), "no park is recorded for that head"],
    ["a park recorded before the run began", () => database({ rows: [twoParked[0], { ...twoParked[1], at: "2026-11-21T07:00:00.000Z" }] }), "has no worker-merge record"],
    ["a park recorded after the run ended", () => database({ rows: [twoParked[0], { ...twoParked[1], at: "2026-11-22T10:00:00.000Z" }] }), "has no worker-merge record"]
  ])("%s stays not-parked", (_label, build, expected) => {
    const db = build();
    const result = reading(db);
    expect(result.kind).toBe("not-parked");
    if (result.kind === "not-parked") expect(result.reason).toMatch(expected instanceof RegExp ? expected : new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    db.close();
  });

  it("uses the latest row of each step: a step that parked and then merged reads merged, and one that merged then failed reads not parked", () => {
    const db = database({ rows: [
      { action: STEPS[0], head: HEAD_A, reason: c4, at: "2026-11-22T07:00:00.000Z" },
      { action: STEPS[0], head: HEAD_A, outcome: "merged", code: null, reason: "Merged.", at: "2026-11-22T07:30:00.000Z" },
      { action: STEPS[1], head: HEAD_B, url: URL_B, reason: c1Delegated, at: "2026-11-22T07:10:00.000Z" }
    ] });
    expect(reading(db)).toMatchObject({ kind: "parked-for-you", merged: [STEPS[0]] });
    db.prepare("INSERT INTO production_worker_merges (request_id, session_id, action_key, pull_request_url, head, outcome, code, reason, boundaries_json, updated_at) VALUES ('x', 'sx', ?, ?, ?, 'refused', 'check_failed', 'red', '[]', '2026-11-22T08:00:00.000Z')").run(STEPS[1], URL_B, HEAD_B);
    expect(reading(db).kind).toBe("not-parked");
    db.close();
  });

  it("reads the live run by its policy revision, only while it has pinned steps, and writes nothing", () => {
    const db = database({ rows: twoParked, open: true });
    const before = db.prepare("SELECT COUNT(*) AS n FROM production_worker_merges").get();
    expect(readLiveParkedBatch(db, 101)).toMatchObject({ kind: "parked-for-you" });
    expect(readLiveParkedBatch(db, 150)).toMatchObject({ kind: "not-parked" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM production_worker_merges").get()).toEqual(before);
    const [activation] = evidenceOfDb(db).activations;
    expect(activation.endedAt).toBeNull();
    expect(activation.parked?.kind).toBe("parked-for-you");
    db.close();
  });

  it("reads pinned steps only from a well-formed receipt scope", () => {
    expect(scopeActionKeys(JSON.stringify({ scope: { actions: ["arcadia/a", "arcadia/a", "arcadia/b"] } }))).toEqual(["arcadia/a", "arcadia/b"]);
    for (const bad of ["{}", "nope", JSON.stringify({ scope: { actions: [] } }), JSON.stringify({ scope: { actions: ["a"] } }), JSON.stringify({ scope: { actions: [1] } })]) expect(scopeActionKeys(bad)).toEqual([]);
  });
});

describe("the verdict: only an answered Decision lets a parked reading count", () => {
  const parked = (merged: string[] = []): DayEvidenceActivation["parked"] => ({ kind: "parked-for-you", merged, parked: [{ action: "arcadia/a", head: HEAD_A, pullRequestUrl: URL_A, condition: "C4", at: ON }] });
  const activation = (over: Partial<DayEvidenceActivation> = {}): DayEvidenceActivation => ({ requestId: "c", revisionAfter: 1, at: ON, admitted: 1, endedAt: OFF, scopeComplete: null, parked: parked(), ...over });

  it("(5) flag off: today's FAILED reading exactly, for every shape of the parked field", () => {
    for (const a of [activation(), activation({ parked: null }), activation({ parked: undefined }), activation({ scopeComplete: { merged: 1, escalated: 1 } })]) expect(isFailedBatch(a)).toBe(true);
    expect(isFailedBatch(activation(), false)).toBe(true);
    expect(isParkedForYouBatch(activation(), false)).toBe(false);
    // The legacy single-argument call on today's evidence reads exactly as before.
    expect(isFailedBatch({ admitted: 1, scopeComplete: null })).toBe(true);
    expect(isFailedBatch({ admitted: 1, scopeComplete: { merged: 1, escalated: 0 } })).toBe(false);
    expect(isFailedBatch({ admitted: 0, scopeComplete: null })).toBe(false);
  });

  it("flag on: a parked reading is not failed; everything else keeps failing closed", () => {
    expect(isFailedBatch(activation(), true)).toBe(false);
    expect(isParkedForYouBatch(activation(), true)).toBe(true);
    for (const a of [
      activation({ parked: null }), activation({ parked: undefined }), activation({ admitted: 1, parked: { kind: "not-parked", reason: "x" } }),
      activation({ parked: { kind: "parked-for-you", merged: [], parked: [] } }), activation({ parked: { kind: "parked-for-you", merged: [] } as never }),
      activation({ scopeComplete: { merged: 1, escalated: 1 } }), activation({ scopeComplete: { merged: 0, escalated: 0 } })
    ]) expect(isFailedBatch(a, true)).toBe(true);
    // A batch that admitted no Session is no batch, as before.
    expect(isFailedBatch(activation({ admitted: 0 }), true)).toBe(false);
    expect(failedBatchesInWindow({ transitions: [], activations: [activation(), activation({ requestId: "d", parked: null })] }, 0, true).map((a) => a.requestId)).toEqual(["d"]);
  });

  const doc = (answer: string | null, id = "0282") => `---\nid: "${id}"\nstatus: ${answer === null ? "open" : "approved"}\n${answer === null ? "" : `answer: ${JSON.stringify(answer)}\n`}question: "A. Approve: quoted in the front matter, not an answer"\n---\nBody quotes A. Approve.\n`;
  const sourceOf = (content: string, id = "0282", paths?: string[]): ParkedBatchDecisionSource => ({ paths: paths ?? [`docs/decisions/${id}-${PARKED_BATCH_SLUG}.md`], read: () => content });

  it("is enabled only by the one Decision found by its slug, approved with option A in its front matter", () => {
    expect(parkedBatchEnabled(sourceOf(doc("A. Approve: a parked step is not a failed batch")))).toBe(true);
    expect(parkedBatchEnabled(sourceOf(doc("A. Approve: a parked step is not a failed batch", "0291"), "0291"))).toBe(true);
    for (const closed of [
      undefined,
      sourceOf(doc(null)),
      sourceOf(doc("B. Keep the rule")),
      sourceOf(doc("C. Change: you state a different rule")),
      sourceOf(doc("A. Approve"), "0282", []),
      sourceOf(doc("A. Approve"), "0282", [`docs/decisions/0282-${PARKED_BATCH_SLUG}.md`, `docs/decisions/0290-${PARKED_BATCH_SLUG}.md`]),
      sourceOf(doc("A. Approve", "9999")),
      sourceOf("no front matter A. Approve"),
      { paths: [`docs/decisions/0282-${PARKED_BATCH_SLUG}.md`], read: () => { throw new Error("unreadable"); } },
      sourceOf(doc("A. Approve"), "0282", ["docs/decisions/0282-some-other-slug.md"])
    ]) expect(parkedBatchEnabled(closed)).toBe(false);
    expect(findParkedBatchDecision([`docs/decisions/0282-${PARKED_BATCH_SLUG}.md`])).toEqual({ file: `docs/decisions/0282-${PARKED_BATCH_SLUG}.md`, id: "0282" });
    expect(isParkedBatchAnswered(doc("A. Approve"), "0282")).toBe(true);
    expect(isParkedBatchAnswered(doc("A. Approve"), "0283")).toBe(false);
  });
});

/** The standing-grant chain over the shared day-grant fixture files, with a parked reading set on the card's batch. */
describe("the standing chain: a parked batch does not stop the next card, but only with the Decision answered", () => {
  const NOW = Date.parse("2026-11-22T12:00:00Z");
  const SCOPE = { project: "arcadia", plan: DAY_PLAN, provider: "claude-code-cli", concurrency: 1, spendDecision: "0130", offId: STOP_ID };
  const ANSWERED: ParkedBatchDecisionSource = { paths: [`docs/decisions/0282-${PARKED_BATCH_SLUG}.md`], read: () => `---\nid: "0282"\nstatus: approved\nanswer: "A. Approve: a parked step is not a failed batch"\n---\n` };
  const OPEN: ParkedBatchDecisionSource = { paths: ANSWERED.paths, read: () => `---\nid: "0282"\nstatus: open\n---\n` };
  const parkedReading = { kind: "parked-for-you" as const, merged: [], parked: [{ action: "arcadia/a", head: HEAD_A, pullRequestUrl: URL_A, condition: "C4" as const, at: ON }] };
  const started = { card: "start-a", at: NOW - 40 * 60_000, status: "succeeded", receipt: { outcome: "succeeded", reason: "", productionActivated: true, allowanceConsumed: true } };

  function run(options: { decision: ParkedBatchDecisionSource | undefined; kind: string; parked?: typeof parkedReading | { kind: "not-parked"; reason: string } | null; previousKind?: string }) {
    const library = tempDir("arcadia-parked-chain-");
    const scenario: DayScenario = {
      label: "", code: "", approval: { standing: true, pressedAt: NOW - 120 * 60_000 }, attempt: 2, presses: [started],
      steps: [{ activate: "start-a" }, { off: "rowan-off-successor-press-scope-complete" }],
      previous: named(pressKey("start-a"), options.kind, (options.previousKind ?? options.kind) as never)
    };
    const written = writeDayScenario(library, scenario, NOW);
    written.evidence.activations[0].parked = options.parked === undefined ? parkedReading : options.parked;
    const standingDecision = { paths: [`docs/decisions/0241-${STANDING_SLUG}.md`], read: () => `---\nid: "0241"\nstatus: approved\nanswer: E. Standing grant over your approved work queue\n---\n` };
    const chain = () => inspectDayGrantChain({
      library, approvalCard: written.approval.card, approvalRun: written.approval.run, approvalReceiptSha256: written.approval.receiptSha256, approvalPressSha256: written.approval.pressSha256,
      now: new Date(NOW), evidence: written.evidence, policyRevision: written.policyRevision, excludePress: null, scope: SCOPE, previous: scenario.previous, attempt: scenario.attempt,
      grant: "standing", standingDecision, ...(options.decision ? { parkedDecision: options.decision } : {})
    });
    try { return { code: "none", latest: chain().latest }; } catch (error) { return { code: error instanceof StartRunDelegationError ? error.code : String(error), latest: null }; }
  }

  it("with the Decision answered A, the batch reads parked-for-you and the next card passes the chain", () => {
    expect(run({ decision: ANSWERED, kind: "parked-for-you" })).toEqual({ code: "none", latest: { press: pressKey("start-a"), kind: "parked-for-you" } });
  });

  it("(5) with no Decision, an open Decision, or no source, the same record stays FAILED_BATCH exactly as today", () => {
    for (const decision of [undefined, OPEN]) {
      expect(run({ decision, kind: "failed-attempt" }).code).toBe("FAILED_BATCH");
      expect(run({ decision, kind: "parked-for-you" }).code).toBe("FAILED_BATCH");
    }
  });

  it("with the Decision answered, a card that calls the parked batch clean or failed is refused as a mismatch (the record decides the kind)", () => {
    expect(run({ decision: ANSWERED, kind: "x-cause", previousKind: "clean-batch" }).code).toBe("PREVIOUS_MISMATCH");
    expect(run({ decision: ANSWERED, kind: "x-cause", previousKind: "failed-attempt" }).code).toBe("PREVIOUS_MISMATCH");
  });

  it.each<[string, Parameters<typeof run>[0]["parked"]]>([
    ["no park reading", null],
    ["a not-parked reading", { kind: "not-parked", reason: "finish-allocate failed governed review" }],
    ["an empty parked reading", { kind: "parked-for-you", merged: [], parked: [] }]
  ])("(4) with the Decision answered, %s still stops for the operator", (_label, parked) => {
    expect(run({ decision: ANSWERED, kind: "failed-attempt", parked }).code).toBe("FAILED_BATCH");
  });
});

describe("the evidence shape the executor script also reads", () => {
  it("keeps scopeComplete and admitted exactly as before, so scripts/start-run.sh reads the same failed or clean batch", () => {
    const db = database({ rows: twoParked });
    const [activation] = evidenceOfDb(db).activations;
    // The script's own failedBatch(x): admitted >= 1 and no scope-complete record reads failed, whatever `parked` says.
    expect(activation.admitted >= 1 && !(activation.scopeComplete && activation.scopeComplete.merged >= 1 && activation.scopeComplete.escalated === 0)).toBe(true);
    const { evidence } = evidenceOf(83, Date.now(), [{ activate: "a" }]);
    expect(evidence.activations[0].parked).toBeUndefined();
    db.close();
  });
});
