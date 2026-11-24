import type Database from "better-sqlite3";
import { parse as parseYaml } from "yaml";

/**
 * The "parked for you" batch reading (Decision 0282's draft, option A): a batch whose pinned steps are each merged or parked
 * for a policy reason, with at least one parked, is not a failed batch. This module only READS records production already
 * wrote (it writes nothing, adds no tick record and grants nothing):
 *
 *  - the pinned steps are the activation receipt's `scope.actions`;
 *  - a merged step's latest `production_worker_merges` row inside the run is `merged`;
 *  - a parked step's latest row inside the run is the worker's `authority_adjacent` refusal, whose reason names the park:
 *    a standing-merge C1 park (a delegated card, an Action not pinned, a requirement changed since approval), a C4 park
 *    (the diff touches the shared gate set or a hard class), or the plain refusal that names no standing condition (no
 *    authorizing in-run Decision). The worker evaluates the independent review before the blast radius, and the review step
 *    polls required checks to green before any review runs, so such a row means the head passed review and checks;
 *  - anything else is NOT parked: a missing, partial or unreadable record, a C1 park whose cause could not be read, a C2 or
 *    C5 park, a refusal for any other code (a red check, no review, a moved head), a step that has no row at all, a review
 *    step recorded for another head, or an escalation on a pinned step.
 *
 * Without the answered Decision (`isParkedBatchAnswered`) nothing here is used: the callers keep today's FAILED reading.
 */
export const PARKED_BATCH_SLUG = "may-a-batch-whose-pinned-steps-all-parked-for-a-policy-reason-none-failed-read";
export const PARKED_BATCH_ANSWER = "A. Approve";
/** The word the executor script must carry before a card that names a parked batch is derived (see startRunDerive). */
export const PARKED_BATCH_EXECUTOR_MARKER = "parked-for-you";

/** The Decisions on the pinned main: their `docs/decisions/` paths and a reader of one of them. */
export interface ParkedBatchDecisionSource { paths: string[]; read: (file: string) => string }

/** The one record with PARKED_BATCH_SLUG among `docs/decisions/` paths, or a reason it cannot be told apart. Found by slug, never by number. */
export function findParkedBatchDecision(paths: string[]): { file: string; id: string } | { problem: string } {
  const matches = paths.filter((entry) => /^docs\/decisions\/\d{4}-[^/]+\.md$/.test(entry) && entry.slice("docs/decisions/0000-".length, -".md".length) === PARKED_BATCH_SLUG);
  if (matches.length === 0) return { problem: `no Decision record has the slug ${PARKED_BATCH_SLUG}` };
  if (matches.length > 1) return { problem: `${matches.length} Decision records share the slug ${PARKED_BATCH_SLUG} (${matches.join(", ")})` };
  return { file: matches[0], id: matches[0].slice("docs/decisions/".length, "docs/decisions/0000".length) };
}

/** Whether a Decision's frontmatter (never its body, which quotes every option) is approved with option A. */
export function isParkedBatchAnswered(content: string, id: string): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return false;
  let fields: Record<string, unknown> | null;
  try { fields = parseYaml(match[1]) as Record<string, unknown> | null; } catch { return false; }
  const answer = fields?.answer;
  return !!fields && String(fields.id) === id && fields.status === "approved" && typeof answer === "string" && answer.startsWith(PARKED_BATCH_ANSWER);
}

/**
 * True only when the Decision is on the pinned main and approved with option A. Fail closed: an absent source, zero or several
 * matching records, an unreadable file or any other answer is false, which keeps today's reading. Never throws.
 */
export function parkedBatchEnabled(source: ParkedBatchDecisionSource | undefined): boolean {
  if (!source) return false;
  try {
    const found = findParkedBatchDecision(source.paths);
    if ("problem" in found) return false;
    return isParkedBatchAnswered(source.read(found.file), found.id);
  } catch { return false; }
}

export type ParkCondition = "authorization" | "C1" | "C4";
export interface ParkedStep { action: string; head: string; pullRequestUrl: string; condition: ParkCondition; at: string }
export type ParkedBatchReading =
  | { kind: "parked-for-you"; merged: string[]; parked: ParkedStep[] }
  | { kind: "not-parked"; reason: string };

/** The C1 causes that are a policy reservation for the operator; a C1 park that could not read its inputs is not among them. */
const C1_POLICY = [
  /^card [a-z0-9]+(?:-[a-z0-9]+)* was pressed under a delegation/,
  /^Action \S+ is not pinned on card [a-z0-9]+(?:-[a-z0-9]+)*;/,
  /^Action \S+'s requirement content changed since the operator approved it on card /
];
const C4_POLICY = [/^the diff touches the shared gate set or a hard class: \S/, /^the diff touches a hard class: \S/];
const STANDING_MARK = /Standing merge parked at (\S+?): /g;
const PLAIN_ADJACENT = /^The blast-radius assessment marks [0-9a-f]{7,40} authority-adjacent: /;

/**
 * The park a refused worker-merge reason records, or null when it is not one of the three policy reservations.
 * The plain form (no standing condition named) is the worker's refusal with no authorizing in-run Decision or no Active
 * card (`standingMerge.ts` names neither); the record cannot tell the two apart, so the caller also requires the row to
 * lie inside the activation, while production was Active.
 */
export function classifyPark(reason: string): ParkCondition | null {
  const marks = [...reason.matchAll(STANDING_MARK)];
  if (marks.length === 0) return PLAIN_ADJACENT.test(reason) ? "authorization" : null;
  if (marks.length > 1) return null;
  const mark = marks[0];
  const detail = reason.slice((mark.index ?? 0) + mark[0].length);
  if (mark[1] === "C1") return C1_POLICY.some((pattern) => pattern.test(detail)) ? "C1" : null;
  if (mark[1] === "C4") return C4_POLICY.some((pattern) => pattern.test(detail)) ? "C4" : null;
  return null;
}

const notParked = (reason: string): ParkedBatchReading => ({ kind: "not-parked", reason });
const hasTable = (db: Database.Database, name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/** The pinned `<project>/<action>` keys an activation receipt scopes; empty when unreadable. */
export function scopeActionKeys(receiptJson: string): string[] {
  try {
    const actions = (JSON.parse(receiptJson) as { scope?: { actions?: unknown } } | null)?.scope?.actions;
    if (!Array.isArray(actions) || !actions.length || !actions.every((key) => typeof key === "string" && /^[^/]+\/[^/]+$/.test(key))) return [];
    return [...new Set(actions as string[])];
  } catch { return []; }
}

interface MergeRow { action_key: string; pull_request_url: string | null; head: string; outcome: string; code: string | null; reason: string; updated_at: string }

/**
 * Reads one activation's batch from the worker's own records. `from` is when it was activated and `until` when production next
 * went Off (null while it is on). Every pinned step must be merged or parked; at least one must be parked. Never writes.
 */
export function readParkedBatch(db: Database.Database, input: { scopeActions: readonly string[]; from: string; until: string | null }): ParkedBatchReading {
  const keys = [...new Set(input.scopeActions)];
  if (keys.length === 0) return notParked("the activation's pinned steps could not be read");
  try {
    if (!hasTable(db, "production_worker_merges")) return notParked("production recorded no worker-merge outcomes");
    if (hasTable(db, "production_operator_escalations")) {
      const open = (db.prepare("SELECT action_key, kind FROM production_operator_escalations").all() as Array<{ action_key: string; kind: string }>).filter((row) => keys.includes(row.action_key));
      if (open.length > 0) return notParked(`${open.map((row) => `${row.action_key} (${row.kind})`).join(", ")} is escalated`);
    }
    const reviewSteps = hasTable(db, "production_review_steps");
    const merged: string[] = [];
    const parked: ParkedStep[] = [];
    for (const key of keys) {
      const row = db.prepare(
        `SELECT action_key, pull_request_url, head, outcome, code, reason, updated_at FROM production_worker_merges
          WHERE action_key = ? AND updated_at >= ? AND (? IS NULL OR updated_at <= ?) ORDER BY updated_at DESC, rowid DESC LIMIT 1`
      ).get(key, input.from, input.until, input.until) as MergeRow | undefined;
      if (!row) return notParked(`${key} has no worker-merge record in this run`);
      if (row.outcome === "merged") { merged.push(key); continue; }
      if (row.outcome !== "refused" || row.code !== "authority_adjacent") return notParked(`${key} was ${row.outcome}${row.code ? ` (${row.code})` : ""}, not parked for a policy reason`);
      const condition = classifyPark(row.reason);
      if (!condition) return notParked(`${key}'s park does not name a policy reservation (C1 delegation, pin or requirement change; C4 protected path; no in-run authorization)`);
      if (!row.pull_request_url || !/^[0-9a-f]{40}$/.test(row.head)) return notParked(`${key}'s park record names no pull request or exact head`);
      if (reviewSteps) {
        const latest = db.prepare("SELECT target_head FROM production_review_steps WHERE action_key = ? AND updated_at >= ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(key, input.from) as { target_head: string } | undefined;
        if (latest && latest.target_head !== row.head) return notParked(`${key} was reviewed at ${latest.target_head.slice(0, 12)} after it parked at ${row.head.slice(0, 12)}; no park is recorded for that head`);
      }
      parked.push({ action: key, head: row.head, pullRequestUrl: row.pull_request_url, condition, at: row.updated_at });
    }
    return parked.length === 0 ? notParked("no pinned step is parked") : { kind: "parked-for-you", merged, parked };
  } catch (error) {
    return notParked(`the park records could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The reading of the activation that produced policy revision `revision` (the live run); not-parked when its receipt cannot be read. */
export function readLiveParkedBatch(db: Database.Database, revision: number): ParkedBatchReading {
  try {
    const row = db.prepare("SELECT created_at, receipt_json FROM production_policy_receipts WHERE transition = 'activate' AND revision_after = ?").get(revision) as { created_at: string; receipt_json: string } | undefined;
    if (!row) return notParked(`no activation receipt for policy revision ${revision}`);
    return readParkedBatch(db, { scopeActions: scopeActionKeys(row.receipt_json), from: row.created_at, until: null });
  } catch (error) {
    return notParked(`the activation could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}
