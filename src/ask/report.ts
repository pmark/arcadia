import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { MEMO_ROUTE_TYPES, OPERATOR_CORRECTION_SOURCES, hasAskCorrectionsTable } from "./corrections.js";
import type { GoldenCase } from "./goldenCases.js";
import { MEMO_PATTERN_THRESHOLD, backingKey, tokenPattern } from "./memoPattern.js";
import { ingressSourceKind } from "./replyCapture.js";

/**
 * The weekly Ask report (Plan Action ask-golden-set-and-vanish-report): is Ask routing getting better, and does any
 * operator Ask still vanish? Read-only. Counts only; no Ask text is returned except the three leading words of a
 * correction pattern the report is asked to hint at (see `patternHints`).
 *
 * The unit is an Ask the operator sent: one capture envelope with an Ask record. A correction re-routes the same
 * capture, so a corrected Ask is still one Ask. Every classification metric (questions, memo hits, flags) reads the
 * Ask as it was first heard; the vanish rate reads where it stands now.
 */
export const ASK_REPORT_SCHEMA = "arcadia-ask-report-v1";

/** An Ask is judged for vanishing once it is this old: the operator has had an hour for a record to appear. */
export const VANISH_GRACE_MS = 60 * 60 * 1000;

/** Three recurrence-flagged Asks revive the deferred Schedule capability. */
export const SCHEDULE_REVIVAL_THRESHOLD = 3;

/** How many vanished Ask ids the text report names before pointing at `--json`. */
export const VANISHED_IDS_SHOWN = 10;

export type AskOutcome = "listed" | "acted" | "answered" | "idea" | "vanished";

export interface AskReportCounts {
  /** Operator Asks captured in the window that left an Ask record. */
  asks: number;
  /** Suppressed (an acknowledgement, or an exact repeat of an open question): no question was created; apart from the vanish rate. */
  suppressed: number;
  /** Asks routed by the rules or a memo: every Ask that was not suppressed. */
  classified: number;
  /** Classified Asks an operator corrected (a re-route, or an answer to the Ask's own question). */
  corrected: number;
  /** corrected ÷ classified; null when nothing was classified. */
  correctedRate: number | null;
  /** Asks first heard as a Clarify First question. */
  questions: number;
  /** questions ÷ Asks; null when there are no Asks. */
  questionRate: number | null;
  /** Classified Asks at least one hour old. The vanish rate's denominator. */
  eligible: number;
  /** Eligible Asks with no listed open record and no acted, answered or operator-filed Idea outcome. Target zero. */
  vanished: number;
  /** vanished ÷ eligible; null when nothing is eligible yet. */
  vanishRate: number | null;
  /** The vanished Asks' `ask_…` ids, for `arcadia ask show`. Ids only. */
  vanishedAskIds: string[];
  /** Back Burner items the window's Asks created. */
  backBurnerArrivals: number;
  /** Of those, filed on purpose: an intake Idea, an explicit --back-burner or a correction to idea. The rest were shelved as a fallback. */
  backBurnerOperatorFiled: number;
  /** Asks routed by an operator's earlier correction of the same words. */
  memoHits: number;
  /** Asks flagged recurrence (every, daily, weekly, monthly, recurring or schedule). */
  recurrence: number;
  /** Asks flagged planning. */
  planning: number;
}

export interface AskReportSource extends AskReportCounts {
  source: string;
}

export interface AskReportPatternHint {
  type: string;
  /** The first three meaningful words the memos share. Derived from Ask text: do not copy it into a repository. */
  pattern: string;
  memos: number;
  /** True when a golden case already has this corrected type and pattern. */
  backedByGolden: boolean;
}

export interface AskReportData {
  schema: typeof ASK_REPORT_SCHEMA;
  window: { since: string; until: string };
  /** Per operator ingress source, ordered by Ask count then name. */
  sources: AskReportSource[];
  total: AskReportCounts;
  /** Envelopes captured in the window with no Ask record at all. Not in any rate: some are empty rule payloads. */
  capturedWithoutAskRecord: number;
  schedule: { recurrence: number; threshold: number; revivalTriggerMet: boolean };
  corrections: {
    /** Operator corrections that are memos today (the newest operator correction per exact text names a memo type). All time. */
    memos: number;
    /** Memos no golden case backs; null when the golden set could not be read. */
    notBackedByGolden: number | null;
    golden: { path: string | null; cases: number | null };
  };
  /** Three or more memos share a corrected type and a token pattern. A hint only; no rule is ever generated. */
  patternHints: AskReportPatternHint[];
  notes: string[];
}

export interface BuildAskReportInput {
  since: Date;
  until: Date;
  /** `sourceRef`s `arcadia todo` lists (`review_items:<id>`, `work_items:<id>`), stale ones excluded. */
  listed: ReadonlySet<string>;
  /** The golden set, or null when it could not be read. */
  golden: readonly GoldenCase[] | null;
  goldenPath: string | null;
  /** Lines about what `arcadia todo` could not read or collapsed, which the vanish rate depends on. */
  todoNotes: readonly string[];
}

interface AskRow {
  capture_id: string;
  ingress_source: string;
  captured_at: string;
  id: string | null;
  output_kind: string | null;
  work_item_id: string | null;
  suppressed_reason: string | null;
  recurrence_flag: number | null;
  planning_flag: number | null;
  confidence: string | null;
  corrected_type: string | null;
  stewardship_json: string | null;
}

interface ReviewRow {
  id: string;
  ask_request_id: string;
  status: string;
}

interface IdeaRow {
  id: string;
  ask_request_id: string;
  classification: string;
}

const EXPLICIT_IDEA_REASON = /^Explicit idea capture/;

/** Operator input is everything that is not agent-written or a reply that only records words behind another write. */
export function isOperatorSource(source: string): boolean {
  const kind = ingressSourceKind(source);
  return kind !== "agent" && kind !== "provenance";
}

function stewardshipOf(json: string | null): { path: string | null; reason: string | null } {
  if (!json) return { path: null, reason: null };
  try {
    const parsed = JSON.parse(json) as { recommendedExecutionPath?: unknown; classificationReason?: unknown };
    return {
      path: typeof parsed.recommendedExecutionPath === "string" ? parsed.recommendedExecutionPath : null,
      reason: typeof parsed.classificationReason === "string" ? parsed.classificationReason : null
    };
  } catch {
    return { path: null, reason: null };
  }
}

const rate = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null;

function emptyCounts(): AskReportCounts {
  return {
    asks: 0,
    suppressed: 0,
    classified: 0,
    corrected: 0,
    correctedRate: null,
    questions: 0,
    questionRate: null,
    eligible: 0,
    vanished: 0,
    vanishRate: null,
    vanishedAskIds: [],
    backBurnerArrivals: 0,
    backBurnerOperatorFiled: 0,
    memoHits: 0,
    recurrence: 0,
    planning: 0
  };
}

function finish(counts: AskReportCounts): AskReportCounts {
  return {
    ...counts,
    correctedRate: rate(counts.corrected, counts.classified),
    questionRate: rate(counts.questions, counts.asks),
    vanishRate: rate(counts.vanished, counts.eligible)
  };
}

/**
 * Where an Ask stands. `listed` means `arcadia todo` shows an open record of it (the caller passes the `sourceRef`s that
 * view lists, so this never re-implements its projection). Otherwise it still did not vanish if it was acted on (an
 * Action or a direct answer), answered (a Decision it raised was approved or rejected, or it replied to one), or filed
 * as an Idea on purpose. A Back Burner item shelved as a fallback, with no one having asked for an idea, does not count.
 */
export function askOutcome(input: {
  outputKind: string | null;
  workItemId: string | null;
  reviews: ReadonlyArray<{ id: string; status: string }>;
  ideas: ReadonlyArray<{ operatorFiled: boolean }>;
  listed: ReadonlySet<string>;
}): AskOutcome {
  if (input.reviews.some((review) => input.listed.has(`review_items:${review.id}`))) return "listed";
  if (input.workItemId && input.listed.has(`work_items:${input.workItemId}`)) return "listed";
  if (input.outputKind === "review_response") return "answered";
  if (input.reviews.some((review) => review.status === "approved" || review.status === "rejected")) return "answered";
  // An Action or a direct answer is Arcadia having acted, whatever its output kind says about its review state.
  if (input.workItemId) return "acted";
  if (input.outputKind && !["back_burner", "requires_review", "suppressed"].includes(input.outputKind)) return "acted";
  if (input.ideas.some((idea) => idea.operatorFiled)) return "idea";
  return "vanished";
}

export function buildAskReport(db: Database.Database, input: BuildAskReportInput): AskReportData {
  const askColumns = new Set((db.prepare("PRAGMA table_info(ask_requests)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!askColumns.has("confidence") || !askColumns.has("corrected_type")) {
    throw validationError("This workspace database predates Ask corrections, so the report cannot read it.", {
      remedy: "Run any arcadia command that writes (for example arcadia ask) once with the current version, then rerun."
    });
  }
  const sinceIso = input.since.toISOString();
  const untilIso = input.until.toISOString();
  const graceCutoff = new Date(input.until.getTime() - VANISH_GRACE_MS).toISOString();

  const rows = db
    .prepare(
      `SELECT ce.id AS capture_id, ce.ingress_source, ce.captured_at, ar.id, ar.output_kind, ar.work_item_id,
              ar.suppressed_reason, ar.recurrence_flag, ar.planning_flag, ar.confidence, ar.corrected_type, ar.stewardship_json
         FROM ask_capture_envelopes ce
         LEFT JOIN ask_requests ar ON ar.capture_id = ce.id
        WHERE ce.captured_at >= ? AND ce.captured_at <= ?
        ORDER BY ce.captured_at, ce.id, ar.created_at, ar.id`
    )
    .all(sinceIso, untilIso) as AskRow[];

  // Group one capture's Ask records, oldest first: the first is how the Ask was heard, the last is where it stands.
  const captures = new Map<string, AskRow[]>();
  let capturedWithoutAskRecord = 0;
  for (const row of rows) {
    if (!isOperatorSource(row.ingress_source)) continue;
    if (row.id === null) {
      capturedWithoutAskRecord += 1;
      continue;
    }
    captures.set(row.capture_id, [...(captures.get(row.capture_id) ?? []), row]);
  }

  const reviewsOf = db.prepare("SELECT id, ask_request_id, status FROM review_items WHERE ask_request_id = ?");
  const ideasOf = db.prepare("SELECT id, ask_request_id, classification FROM back_burner_items WHERE ask_request_id = ?");
  const bySource = new Map<string, AskReportCounts>();
  const total = emptyCounts();
  const bump = (source: string, apply: (counts: AskReportCounts) => void): void => {
    const counts = bySource.get(source) ?? emptyCounts();
    apply(counts);
    apply(total);
    bySource.set(source, counts);
  };

  for (const records of captures.values()) {
    const first = records[0];
    const current = records[records.length - 1];
    const source = first.ingress_source;
    const heard = stewardshipOf(first.stewardship_json);
    const suppressed = first.suppressed_reason !== null;

    // Back Burner arrivals: every item any Ask record of this capture created, however it was later corrected.
    let arrivals = 0;
    let filed = 0;
    for (const record of records) {
      const reason = stewardshipOf(record.stewardship_json).reason;
      for (const idea of ideasOf.all(record.id) as IdeaRow[]) {
        arrivals += 1;
        if (idea.classification === "Idea" || (reason !== null && EXPLICIT_IDEA_REASON.test(reason))) filed += 1;
      }
    }

    const reviews = reviewsOf.all(current.id) as ReviewRow[];
    const currentReason = stewardshipOf(current.stewardship_json).reason;
    const ideas = (ideasOf.all(current.id) as IdeaRow[]).map((idea) => ({
      operatorFiled: idea.classification === "Idea" || (currentReason !== null && EXPLICIT_IDEA_REASON.test(currentReason))
    }));
    const outcome = suppressed
      ? null
      : askOutcome({ outputKind: current.output_kind, workItemId: current.work_item_id, reviews, ideas, listed: input.listed });
    const eligible = !suppressed && first.captured_at <= graceCutoff;

    bump(source, (counts) => {
      counts.asks += 1;
      counts.backBurnerArrivals += arrivals;
      counts.backBurnerOperatorFiled += filed;
      if (suppressed) {
        counts.suppressed += 1;
        return;
      }
      counts.classified += 1;
      if (records.some((record) => record.corrected_type !== null)) counts.corrected += 1;
      if (heard.path === "Clarify First") counts.questions += 1;
      if (first.confidence === "memo") counts.memoHits += 1;
      if (first.recurrence_flag) counts.recurrence += 1;
      if (first.planning_flag) counts.planning += 1;
      if (eligible) {
        counts.eligible += 1;
        if (outcome === "vanished") {
          counts.vanished += 1;
          counts.vanishedAskIds.push(current.id as string);
        }
      }
    });
  }

  const sources = [...bySource.entries()]
    .map(([source, counts]) => ({ source, ...finish(counts) }))
    .sort((a, b) => b.asks - a.asks || a.source.localeCompare(b.source));

  const memos = currentMemos(db);
  const goldenKeys = input.golden ? new Set(input.golden.map((golden) => backingKey(golden.expected_type, golden.text))) : null;
  const groups = new Map<string, { type: string; pattern: string; memos: number }>();
  for (const memo of memos) {
    const pattern = tokenPattern(memo.text);
    if (!pattern) continue;
    const key = `${memo.type}\u0000${pattern}`;
    const group = groups.get(key) ?? { type: memo.type, pattern, memos: 0 };
    group.memos += 1;
    groups.set(key, group);
  }
  const patternHints = [...groups.values()]
    .filter((group) => group.memos >= MEMO_PATTERN_THRESHOLD)
    .map((group) => ({ ...group, backedByGolden: goldenKeys ? goldenKeys.has(`${group.type}\u0000${group.pattern}`) : false }))
    .sort((a, b) => b.memos - a.memos || a.pattern.localeCompare(b.pattern));

  const finished = finish(total);
  const notes = [
    "An Ask is one captured operator Ask with an Ask record; a correction re-routes the same Ask. Agent-written Asks and replies that only record words behind another write are excluded.",
    `Vanish rate: of classified Asks at least one hour old, the share with no open record listed by arcadia todo and no acted, answered or operator-filed Idea outcome. It reads each Ask where it stands now. Suppressed Asks (an acknowledgement or an exact repeat of an open question) created no question and are counted apart. Target zero.`,
    "Classification metrics (questions, memo hits, recurrence, planning) read the Ask as first heard. Corrections and memos are counted across all time, not only the window.",
    ...input.todoNotes
  ];
  if (input.golden === null) notes.push("The golden set could not be read from this checkout, so corrections not yet backed by a golden case are unknown. Run from an Arcadia checkout.");

  return {
    schema: ASK_REPORT_SCHEMA,
    window: { since: sinceIso, until: untilIso },
    sources,
    total: finished,
    capturedWithoutAskRecord,
    schedule: {
      recurrence: finished.recurrence,
      threshold: SCHEDULE_REVIVAL_THRESHOLD,
      revivalTriggerMet: finished.recurrence >= SCHEDULE_REVIVAL_THRESHOLD
    },
    corrections: {
      memos: memos.length,
      notBackedByGolden: goldenKeys ? memos.filter((memo) => !goldenKeys.has(backingKey(memo.type, memo.text))).length : null,
      golden: { path: input.goldenPath, cases: input.golden ? input.golden.length : null }
    },
    patternHints,
    notes
  };
}

/**
 * The operator memos in force: for each exact text, the newest operator correction decides, and it counts only if it
 * names a type a memo may route to (the rule `findAskMemo` applies). Rows a model recorded are never read.
 */
function currentMemos(db: Database.Database): Array<{ text: string; type: string }> {
  if (!hasAskCorrectionsTable(db)) return [];
  const sources = OPERATOR_CORRECTION_SOURCES.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT text_hash, normalized_text, corrected_type FROM ask_corrections
        WHERE source IN (${sources}) ORDER BY created_at DESC, id DESC`
    )
    .all(...OPERATOR_CORRECTION_SOURCES) as Array<{ text_hash: string; normalized_text: string; corrected_type: string }>;
  const seen = new Set<string>();
  const memos: Array<{ text: string; type: string }> = [];
  for (const row of rows) {
    if (seen.has(row.text_hash)) continue;
    seen.add(row.text_hash);
    if ((MEMO_ROUTE_TYPES as readonly string[]).includes(row.corrected_type)) memos.push({ text: row.normalized_text, type: row.corrected_type });
  }
  return memos;
}
