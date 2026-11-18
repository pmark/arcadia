import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { GUIDANCE_FINGERPRINTS, GUIDANCE_INDEX, guidanceEntries, guidanceFingerprint, renderGuidanceFingerprints } from "../projects/agentGuidance.js";

/**
 * Deterministic repair of mechanically red candidates (Decision 0247 E, first
 * round). A leaf module: no model call, no person, no GitHub or Git write of
 * its own. The caller supplies the candidate's diff, the failed required
 * check logs and the effects (a generator runner, a commit, the governed
 * pointer advance); this decides which existing generator runs, at most once
 * per candidate head, and what is handed to the bounded repair Session
 * (Action repair-red-candidates-with-a-bounded-session) instead.
 */

export type MechanicalClass = "lint-autofixable" | "guidance-fingerprint" | "stale-current-action" | "unknown";

export interface MechanicalClassification {
  /** The sole mechanical class, or `unknown` when nothing matched or any failure is not mechanical. */
  class: MechanicalClass;
  /** Every mechanical class the log shows (several may share one round). */
  classes: Exclude<MechanicalClass, "unknown">[];
  /** Guidance documents a stale-fingerprint line names. */
  guidancePaths: string[];
  /** A failure outside the mechanical classes shows in the log. */
  residue: boolean;
  reason: string;
}

const STALE_FINGERPRINT = /Canonical guidance fingerprint is stale: (\S+?\.md)\./g;
const ESLINT_SUMMARY = /✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/;
const ESLINT_FIXABLE = /(\d+) errors? and (\d+) warnings? potentially fixable with the `--fix` option/;
const STALE_POINTER = /current_action "([^"]+)"[^\n]*(?:is already done|is not the queue(?:'s)? current|does not match the queue|stale)|current_action[^\n]*(?:left behind|stale pointer|names a finished Action)|Action pointer (?:is )?stale/i;
/** Failures no generator addresses: a failing test, a type error, a build error. */
const NON_MECHANICAL = /(?:^|\n)\s*(?:FAIL\s|✗|×\s)|error TS\d+|Test Files\s+\d+ failed|Tests\s+\d+ failed|AssertionError|Build failed|ELIFECYCLE.*(?:test|tsc|build)/;

/**
 * Map one failed required check's log to a mechanical class. Pure. A log that
 * shows any failure outside the three classes is `unknown`, so a lint fix is
 * never applied beside a real test failure.
 */
export function classifyCheckFailureLog(log: string): MechanicalClassification {
  const classes = new Set<Exclude<MechanicalClass, "unknown">>();
  const guidancePaths = [...new Set([...log.matchAll(STALE_FINGERPRINT)].map((match) => match[1]))];
  if (guidancePaths.length > 0) classes.add("guidance-fingerprint");
  const summary = ESLINT_SUMMARY.exec(log);
  const fixable = ESLINT_FIXABLE.exec(log);
  let lintResidue = false;
  if (summary) {
    const [errors, warnings] = [Number(summary[2]), Number(summary[3])];
    if (fixable && Number(fixable[1]) === errors && Number(fixable[2]) === warnings) classes.add("lint-autofixable");
    else lintResidue = true;
  }
  if (STALE_POINTER.test(log)) classes.add("stale-current-action");
  if (lintResidue) return { class: "unknown", classes: [...classes], guidancePaths, residue: true, reason: "eslint reports problems --fix cannot fix" };
  if (NON_MECHANICAL.test(log)) return { class: "unknown", classes: [...classes], guidancePaths, residue: true, reason: "the log shows a failure no generator addresses" };
  if (classes.size === 0) return { class: "unknown", classes: [], guidancePaths, residue: false, reason: "no mechanical failure recognised" };
  const list = [...classes];
  return { class: list.length === 1 ? list[0] : "unknown", classes: list, guidancePaths, residue: false, reason: list.length === 1 ? `sole class ${list[0]}` : `several classes: ${list.join(", ")}` };
}

/* ------------------------------------------------------------------------ */
/* Generators: each is the class's existing tool, scoped to the candidate.    */
/* ------------------------------------------------------------------------ */

const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;

/** `eslint --fix` arguments limited to the candidate's own changed, lintable files; null when it changed none. */
export function lintFixArgs(changedPaths: readonly string[]): string[] | null {
  const files = changedPaths.filter((file) => LINTABLE.test(file));
  return files.length > 0 ? ["eslint", "--fix", "--", ...files] : null;
}

/**
 * Refresh the fingerprint of each stale guidance document that the candidate
 * itself changed, by the same fingerprint function the guidance check uses.
 * A stale document outside the candidate's diff is returned in `refused` and
 * never touched: its drift belongs to the base, not to this candidate.
 */
export function refreshCandidateGuidanceFingerprints(
  repoRoot: string,
  stalePaths: readonly string[],
  changedPaths: readonly string[]
): { refreshed: string[]; refused: string[]; written: boolean } {
  const changed = new Set(changedPaths);
  const refused = stalePaths.filter((file) => !changed.has(file));
  const wanted = stalePaths.filter((file) => changed.has(file));
  if (wanted.length === 0) return { refreshed: [], refused, written: false };
  const indexText = readFileSync(path.join(repoRoot, GUIDANCE_INDEX), "utf8");
  const fingerprintsPath = path.join(repoRoot, GUIDANCE_FINGERPRINTS);
  const fingerprintsText = existsSync(fingerprintsPath) ? readFileSync(fingerprintsPath, "utf8") : null;
  if (fingerprintsText === null) return { refreshed: [], refused: [...refused, ...wanted], written: false };
  const entries = guidanceEntries(indexText, fingerprintsText);
  const fingerprints = { ...(JSON.parse(fingerprintsText) as { fingerprints: Record<string, string> }).fingerprints };
  const refreshed: string[] = [];
  for (const file of wanted) {
    const entry = entries.find((candidate) => candidate.path === file);
    if (!entry || !existsSync(path.join(repoRoot, file))) { refused.push(file); continue; }
    fingerprints[entry.id] = guidanceFingerprint(readFileSync(path.join(repoRoot, file), "utf8"));
    refreshed.push(file);
  }
  if (refreshed.length === 0) return { refreshed, refused, written: false };
  const next = renderGuidanceFingerprints(fingerprints);
  if (next === fingerprintsText) return { refreshed, refused, written: false };
  writeFileSync(fingerprintsPath, next);
  return { refreshed, refused, written: true };
}

/* ------------------------------------------------------------------------ */
/* The bounded round.                                                         */
/* ------------------------------------------------------------------------ */

export type MechanicalRepairOutcome =
  | { kind: "repaired"; newHead: string; classes: string[]; generators: string[] }
  /** Unknown class, nothing for a generator to change, or a refused generator: the bounded repair Session's turn. */
  | { kind: "handoff"; reason: string; classes: string[] }
  /** This head already had its one round: never a second (a still-red repaired head is handed off, not looped). */
  | { kind: "already_attempted"; outcome: string };

export interface MechanicalRepairEffects {
  /** Run a generator command in the candidate worktree; a non-zero status is a refused generator. */
  run(command: string, args: string[]): { status: number; detail?: string };
  /** Whether the worktree now differs from the head (a generator that changed nothing leaves it red). */
  dirty(): boolean;
  /** Commit the generators' output on the candidate branch as a production-owned head and return it, or null. */
  commit(message: string): string | null;
  /** The governed pointer advance for a candidate whose base merge left `current_action` behind; true when it advanced. */
  advancePointer(): boolean;
  /** Refresh stale fingerprints (default: {@link refreshCandidateGuidanceFingerprints} in the worktree). */
  refreshFingerprints(stalePaths: readonly string[], changedPaths: readonly string[]): { refreshed: string[]; refused: string[]; written: boolean };
}

export interface MechanicalRepairInput {
  db: Database.Database;
  actionKey: string;
  /** The candidate head whose required checks failed. */
  head: string;
  /** Failed required check logs on that head. */
  logs: readonly string[];
  /** The candidate's own diff against its base. */
  changedPaths: readonly string[];
  effects: MechanicalRepairEffects;
  now: Date;
}

const TABLE = "production_mechanical_repairs";

export function ensureMechanicalRepairTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    action_key TEXT NOT NULL,
    failed_head TEXT NOT NULL,
    outcome TEXT NOT NULL,
    classes TEXT NOT NULL,
    repaired_head TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (action_key, failed_head)
  )`);
}

export interface MechanicalRepairRow { action_key: string; failed_head: string; outcome: string; classes: string; repaired_head: string | null; reason: string | null; created_at: string }

export function getMechanicalRepair(db: Database.Database, actionKey: string, head: string): MechanicalRepairRow | null {
  ensureMechanicalRepairTable(db);
  return (db.prepare(`SELECT * FROM ${TABLE} WHERE action_key = ? AND failed_head = ?`).get(actionKey, head) as MechanicalRepairRow | undefined) ?? null;
}

/**
 * Whether `head` is a head production itself pushed in a mechanical repair
 * round for the Action. Such a head is the candidate's next head, reviewed
 * afresh, not a moved head: the worker treats it as `review_head_moved` only
 * when this is false.
 */
export function isProductionOwnedRepairHead(db: Database.Database, actionKey: string, head: string): boolean {
  ensureMechanicalRepairTable(db);
  return db.prepare(`SELECT 1 FROM ${TABLE} WHERE action_key = ? AND repaired_head = ? AND outcome = 'repaired'`).get(actionKey, head) !== undefined;
}

function record(input: MechanicalRepairInput, outcome: string, classes: string[], repairedHead: string | null, reason: string | null): void {
  input.db.prepare(`INSERT INTO ${TABLE} (action_key, failed_head, outcome, classes, repaired_head, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(action_key, failed_head) DO NOTHING`)
    .run(input.actionKey, input.head, outcome, classes.join(","), repairedHead, reason, input.now.toISOString());
}

/**
 * One deterministic round for one candidate head. The first call for a head
 * claims its round before any generator runs, so a crash or a second tick
 * cannot start another; the repaired head is a NEW head with its own round
 * (still red after the round: {@link MechanicalRepairOutcome} `handoff`).
 */
export function runMechanicalRepairRound(input: MechanicalRepairInput): MechanicalRepairOutcome {
  ensureMechanicalRepairTable(input.db);
  const prior = getMechanicalRepair(input.db, input.actionKey, input.head);
  if (prior) return { kind: "already_attempted", outcome: prior.outcome };
  // A head this module produced and that is red again has had its round: hand off.
  if (isProductionOwnedRepairHead(input.db, input.actionKey, input.head)) {
    const reason = "The production-owned repaired head is still red after the deterministic round.";
    record(input, "handoff", [], null, reason);
    return { kind: "handoff", reason, classes: [] };
  }
  const classifications = input.logs.map(classifyCheckFailureLog);
  const unknown = classifications.find((classification) => classification.residue || classification.classes.length === 0);
  const classes = [...new Set(classifications.flatMap((classification) => classification.classes))];
  const hand = (reason: string): MechanicalRepairOutcome => { record(input, "handoff", classes, null, reason); return { kind: "handoff", reason, classes }; };
  if (input.logs.length === 0 || unknown) return hand(unknown ? `Unknown or non-mechanical failure: ${unknown.reason}.` : "No failed check log to classify.");
  if (classes.length === 0) return hand("No mechanical class recognised.");

  const generators: string[] = [];
  const stalePaths = [...new Set(classifications.flatMap((classification) => classification.guidancePaths))];
  if (classes.includes("lint-autofixable")) {
    const args = lintFixArgs(input.changedPaths);
    if (!args) return hand("Lint is red but the candidate changed no lintable file.");
    const result = input.effects.run("pnpm", ["exec", ...args]);
    // eslint --fix exits non-zero when problems remain; the dirty check judges the effect.
    generators.push(`pnpm exec ${args.slice(0, 2).join(" ")} (${args.length - 3} file(s))`);
    if (result.status > 1) return hand(`eslint --fix could not run: ${result.detail ?? `exit ${result.status}`}.`);
  }
  if (classes.includes("guidance-fingerprint")) {
    const outcome = input.effects.refreshFingerprints(stalePaths, input.changedPaths);
    if (outcome.refused.length > 0) return hand(`Stale guidance fingerprint outside the candidate's diff or unindexed, never refreshed: ${outcome.refused.join(", ")}.`);
    generators.push(`fingerprint refresh (${outcome.refreshed.join(", ")})`);
  }
  if (classes.includes("stale-current-action")) {
    if (!input.effects.advancePointer()) return hand("The governed pointer advance did not apply.");
    generators.push("governed pointer advance");
  }
  if (!input.effects.dirty()) return hand("The generators changed nothing, so the red check cannot be a mechanical one.");
  const newHead = input.effects.commit(`chore(production): mechanical repair (${classes.join(", ")}) of ${input.head.slice(0, 12)}`);
  if (!newHead || newHead === input.head) return hand("The repair commit produced no new head.");
  record(input, "repaired", classes, newHead, null);
  return { kind: "repaired", newHead, classes, generators };
}

/**
 * Whether a PR head that is not the settled head is a production-owned repair
 * descendant (reviewed afresh as the new head) or a moved head.
 */
export function judgeRepairHeadMove(db: Database.Database, actionKey: string, prHead: string): "production_owned" | "head_moved" {
  return isProductionOwnedRepairHead(db, actionKey, prHead) ? "production_owned" : "head_moved";
}

/* ------------------------------------------------------------------------ */
/* One alert per episode.                                                     */
/* ------------------------------------------------------------------------ */

/**
 * A stable key for one repair episode: the Action and the failed head. A
 * caller raising a repaired or handed-off notice asks {@link claimRepairNotice}
 * and raises only when it returns true, so a tick that sees the same episode
 * again (the recorded 139,735-repeat `repair_budget_repeat` case) raises nothing.
 */
export function repairEpisodeKey(actionKey: string, head: string): string {
  return createHash("sha256").update(`${actionKey}\u0000${head}`).digest("hex").slice(0, 16);
}

export function ensureRepairNoticeTable(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS production_mechanical_repair_notices (episode TEXT NOT NULL, trigger TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (episode, trigger))");
}

/** True exactly once per (episode, trigger). */
export function claimRepairNotice(db: Database.Database, episode: string, trigger: string, now: Date): boolean {
  ensureRepairNoticeTable(db);
  return db.prepare("INSERT INTO production_mechanical_repair_notices (episode, trigger, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(episode, trigger, now.toISOString()).changes === 1;
}
