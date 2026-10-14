/**
 * Plan close-out record: one deterministic JSON file per finished Plan, derived from the checked-in
 * Plan document, the session ledger, friction records and MISSION_LOG completion entries. The pure
 * builder takes injected inputs (no clock, no randomness, no I/O) so the same inputs always give the
 * same hash; the fs wrapper at the bottom is thin. Record location: `docs/plans/<plan-slug>.close-out.json`
 * (plans are single files, so a sibling keeps it discoverable next to the Plan and out of the `.md` scan).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseDoc } from "../docs/parse.js";
import { readFrictionFiles, readSessionLedger, type NamedContent } from "../reports/sessionLedgerSource.js";
import type { SessionLedgerRow } from "../reports/sessionLedger.js";

export const CLOSE_OUT_SCHEMA = "arcadia-plan-close-out-v1";
export const PLAN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LIVING_NOTES = "docs/reports/production-simulation-living-notes.md";
export const closeOutPath = (slug: string): string => `docs/plans/${slug}.close-out.json`;

export interface CloseOutPlanAction { id: string; title: string; status: string; splitInto: string[] }
export interface CloseOutPlan { slug: string; status: string; milestone: string | null; actions: CloseOutPlanAction[] }
export interface FrictionEntry { id: string; status: string; testIds: string[] }
export interface CompletionEntry { actionId: string; date: string; candidate: string | null; blockers: string[] }
export interface CloseOutInput {
  plan: CloseOutPlan;
  /** ALL ledger rows of the repository; the builder scopes them and reports how much evidence matched. */
  ledgerRows: SessionLedgerRow[];
  frictions: FrictionEntry[];
  completions: CompletionEntry[];
  successor: { recommendation: string | null; reason: string };
  /** Injected merge-commit resolver: completion candidate sha to the PR number that merged it, or null. */
  shaToPr?: (sha: string) => number | null;
}

export const MAX_UNMATCHED_ROWS = 20;
export const EVIDENCE_LEVELS = ["none", "partial", "complete"] as const;
export const SNAPSHOT_REMEDY = "a close-out record is a snapshot: delete the record and re-run `arcadia plan close-out <slug> --write`";

export interface CloseOutRecord {
  schema: typeof CLOSE_OUT_SCHEMA;
  plan: { slug: string; status: string; milestone: string | null; closed: boolean };
  actions: { id: string; title: string; status: string; outcome: string; prs: number[]; ledgerSessions: string[];
    completion: { date: string; candidate: string | null } | null }[];
  openRemainders: { id: string; status: string; source: "plan-action" | "split-target-not-in-plan" }[];
  openBlockers: { actionId: string; text: string }[];
  /** Aggregates are null (never 0) when `evidence` is "none": no ledger row matched this Plan's Actions. */
  ledger: { rowsConsidered: number; rowsMatched: number; rowsExcluded: number; evidence: (typeof EVIDENCE_LEVELS)[number];
    sessions: number | null; reviewRounds: number | null; subagentTokens: number | null; attempts: number | null;
    operatorTouches: number | null; outcomes: Record<string, number> | null };
  frictions: { id: string; status: string; testIds: string[]; uncited: boolean }[];
  unresolvedFrictionIds: string[];
  /** First MAX_UNMATCHED_ROWS excluded rows by session_id; `unmatchedTruncated` says whether more exist. */
  unmatchedLedgerRows: { session_id: string; action_id: string }[];
  unmatchedTruncated: boolean;
  duplicateLedgerSessions: string[];
  successor: { recommendation: string | null; reason: string };
  hash: string;
}

const RECORD_KEYS = ["schema", "plan", "actions", "openRemainders", "openBlockers", "ledger", "frictions",
  "unresolvedFrictionIds", "unmatchedLedgerRows", "unmatchedTruncated", "duplicateLedgerSessions", "successor", "hash"] as const;
const LEDGER_KEYS = ["rowsConsidered", "rowsMatched", "rowsExcluded", "evidence", "sessions", "reviewRounds", "subagentTokens",
  "attempts", "operatorTouches", "outcomes"] as const;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = (values: string[]): string[] => [...new Set(values)].sort(cmp);
const isFixed = (status: string): boolean => /^(fixed|closed|resolved|done)\b/i.test(status);

/** Canonical JSON: recursively sorted object keys, arrays kept in their (already deterministic) order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort(cmp).filter(key => object[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashCloseOut(record: Omit<CloseOutRecord, "hash"> | CloseOutRecord): string {
  const { hash: _hash, ...rest } = record as CloseOutRecord;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

function sortKeys(object: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => cmp(a, b)));
}

export function buildCloseOut(input: CloseOutInput): CloseOutRecord {
  const planIds = new Set(input.plan.actions.map(action => action.id));
  // Duplicate session ids: keep the lexicographically smallest serialisation so input order never matters.
  const bySession = new Map<string, SessionLedgerRow>();
  const duplicates = new Set<string>();
  for (const row of input.ledgerRows) {
    const prior = bySession.get(row.session_id);
    if (prior) {
      duplicates.add(row.session_id);
      if (canonicalJson(row) < canonicalJson(prior)) bySession.set(row.session_id, row);
    } else bySession.set(row.session_id, row);
  }
  const rows = [...bySession.values()].sort((a, b) => cmp(a.session_id, b.session_id));
  const matched = rows.filter(row => planIds.has(row.action_id));
  const unmatched = rows.filter(row => !planIds.has(row.action_id))
    .map(row => ({ session_id: row.session_id, action_id: row.action_id }));
  const completionOf = new Map<string, CompletionEntry>();
  const candidatesOf = new Map<string, Set<string>>();
  for (const entry of [...input.completions].sort((a, b) => cmp(a.date, b.date) || cmp(a.actionId, b.actionId))) {
    completionOf.set(entry.actionId, entry); // latest entry per Action wins
    if (entry.candidate) candidatesOf.set(entry.actionId, (candidatesOf.get(entry.actionId) ?? new Set()).add(entry.candidate));
  }

  const actions = [...input.plan.actions].sort((a, b) => cmp(a.id, b.id)).map(action => {
    const own = matched.filter(row => row.action_id === action.id);
    const completion = completionOf.get(action.id);
    const outcome = action.status === "done" && action.splitInto.length > 0 ? "split" : action.status;
    const resolved = [...(candidatesOf.get(action.id) ?? [])].map(sha => input.shaToPr?.(sha) ?? null);
    return {
      id: action.id, title: action.title, status: action.status, outcome,
      prs: [...new Set([...own.map(row => row.pr), ...resolved].filter((pr): pr is number => pr !== null))].sort((a, b) => a - b),
      ledgerSessions: own.map(row => row.session_id),
      completion: completion ? { date: completion.date, candidate: completion.candidate } : null
    };
  });

  const remainders: CloseOutRecord["openRemainders"] = [];
  for (const action of input.plan.actions) {
    if (action.status !== "done") remainders.push({ id: action.id, status: action.status, source: "plan-action" });
    for (const target of action.splitInto) {
      if (!planIds.has(target)) remainders.push({ id: target, status: "unknown", source: "split-target-not-in-plan" });
    }
  }
  const seenRemainder = new Set<string>();
  const openRemainders = remainders.sort((a, b) => cmp(a.id, b.id) || cmp(a.source, b.source))
    .filter(item => (seenRemainder.has(item.id) ? false : (seenRemainder.add(item.id), true)));

  const openBlockers = input.completions.filter(entry => planIds.has(entry.actionId))
    .flatMap(entry => entry.blockers.map(text => ({ actionId: entry.actionId, text })))
    .sort((a, b) => cmp(a.actionId, b.actionId) || cmp(a.text, b.text))
    .filter((item, index, all) => index === 0 || item.actionId !== all[index - 1].actionId || item.text !== all[index - 1].text);

  const doneWithoutRow = input.plan.actions.some(action => action.status === "done" && !matched.some(row => row.action_id === action.id));
  const evidence: (typeof EVIDENCE_LEVELS)[number] = matched.length === 0 && rows.length > 0 ? "none"
    : doneWithoutRow ? "partial" : "complete";
  const sum = (pick: (row: SessionLedgerRow) => number | null | undefined): number | null =>
    evidence === "none" ? null : matched.reduce((total, row) => total + (pick(row) ?? 0), 0);
  const closed = input.plan.actions.length > 0 && openRemainders.length === 0;
  const outcomes: Record<string, number> = {};
  for (const row of matched) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;

  const known = new Map<string, FrictionEntry>();
  for (const entry of [...input.frictions].sort((a, b) => cmp(a.id, b.id) || cmp(a.status, b.status))) {
    if (!known.has(entry.id)) known.set(entry.id, entry);
  }
  const cited = uniqSorted(matched.flatMap(row => row.frictions.map(friction => friction.id)));
  const frictions = cited.filter(id => known.has(id)).map(id => {
    const entry = known.get(id)!;
    const testIds = uniqSorted(entry.testIds);
    return { id, status: entry.status, testIds, uncited: isFixed(entry.status) && testIds.length === 0 };
  });

  const record: Omit<CloseOutRecord, "hash"> = {
    schema: CLOSE_OUT_SCHEMA,
    plan: { slug: input.plan.slug, status: input.plan.status, milestone: input.plan.milestone, closed },
    actions, openRemainders, openBlockers,
    ledger: {
      rowsConsidered: rows.length, rowsMatched: matched.length, rowsExcluded: unmatched.length, evidence,
      sessions: evidence === "none" ? null : matched.length, reviewRounds: sum(row => row.review_rounds),
      subagentTokens: sum(row => row.subagent_tokens_total), attempts: sum(row => row.attempts),
      operatorTouches: sum(row => row.operator_touches), outcomes: evidence === "none" ? null : sortKeys(outcomes)
    },
    frictions,
    unresolvedFrictionIds: cited.filter(id => !known.has(id)),
    unmatchedLedgerRows: unmatched.slice(0, MAX_UNMATCHED_ROWS),
    unmatchedTruncated: unmatched.length > MAX_UNMATCHED_ROWS,
    duplicateLedgerSessions: [...duplicates].sort(cmp),
    successor: { recommendation: input.successor.recommendation, reason: input.successor.reason }
  };
  return { ...record, hash: hashCloseOut(record) };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => key in value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** Every problem with one parsed record; empty means valid. `planActionIds` (when given) must contain every cited Action. */
export function validateCloseOut(record: unknown, planActionIds?: ReadonlySet<string>): string[] {
  if (!isObject(record)) return ["record is not a JSON object"];
  const errors: string[] = [];
  const extra = Object.keys(record).filter(key => !(RECORD_KEYS as readonly string[]).includes(key));
  const missing = RECORD_KEYS.filter(key => !(key in record));
  if (extra.length > 0) errors.push(`unknown keys: ${extra.sort(cmp).join(", ")}`);
  if (missing.length > 0) return [...errors, `missing keys: ${missing.join(", ")}`];
  if (record.schema !== CLOSE_OUT_SCHEMA) errors.push(`schema must be ${CLOSE_OUT_SCHEMA}`);
  const plan = record.plan;
  if (!isObject(plan) || !hasExactKeys(plan, ["slug", "status", "milestone", "closed"]) || typeof plan.closed !== "boolean" || typeof plan.slug !== "string" ||
    !PLAN_SLUG.test(plan.slug) || typeof plan.status !== "string" || !(plan.milestone === null || typeof plan.milestone === "string")) {
    errors.push("plan must be exactly {slug, status, milestone, closed}");
  }
  const ids: string[] = [];
  if (!Array.isArray(record.actions)) errors.push("actions must be an array");
  else {
    record.actions.forEach((action, index) => {
      const ok = isObject(action) && hasExactKeys(action, ["id", "title", "status", "outcome", "prs", "ledgerSessions", "completion"]) &&
        typeof action.id === "string" && typeof action.title === "string" && typeof action.status === "string" &&
        typeof action.outcome === "string" && Array.isArray(action.prs) && action.prs.every(pr => Number.isInteger(pr)) &&
        isStringArray(action.ledgerSessions) &&
        (action.completion === null || (isObject(action.completion) && hasExactKeys(action.completion, ["date", "candidate"]) &&
          typeof action.completion.date === "string" && (action.completion.candidate === null || typeof action.completion.candidate === "string")));
      if (!ok) errors.push(`actions[${index}] is malformed`);
      else ids.push((action as { id: string }).id);
    });
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) errors.push(`duplicate Action ${id}`);
    if (planActionIds) for (const id of ids) if (!planActionIds.has(id)) errors.push(`Action ${id} is not in the Plan document; ${SNAPSHOT_REMEDY}`);
  }
  if (!Array.isArray(record.openRemainders) || !record.openRemainders.every(item => isObject(item) &&
    hasExactKeys(item, ["id", "status", "source"]) && typeof item.id === "string" && typeof item.status === "string" &&
    (item.source === "plan-action" || item.source === "split-target-not-in-plan"))) errors.push("openRemainders is malformed");
  if (!Array.isArray(record.openBlockers) || !record.openBlockers.every(item => isObject(item) &&
    hasExactKeys(item, ["actionId", "text"]) && typeof item.actionId === "string" && typeof item.text === "string")) errors.push("openBlockers is malformed");
  const ledger = record.ledger;
  if (!isObject(ledger) || !hasExactKeys(ledger, LEDGER_KEYS)) errors.push("ledger is malformed");
  else {
    const counts = ["rowsConsidered", "rowsMatched", "rowsExcluded"];
    const aggregates = ["sessions", "reviewRounds", "subagentTokens", "attempts", "operatorTouches"];
    const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
    if (!counts.every(key => isCount(ledger[key])) || !(EVIDENCE_LEVELS as readonly unknown[]).includes(ledger.evidence)) {
      errors.push("ledger counts or evidence are malformed");
    } else {
      if ((ledger.rowsMatched as number) + (ledger.rowsExcluded as number) !== ledger.rowsConsidered) errors.push("ledger.rowsMatched + rowsExcluded must equal rowsConsidered");
      const none = ledger.evidence === "none";
      if (none !== (ledger.rowsMatched === 0 && (ledger.rowsConsidered as number) > 0)) errors.push("ledger.evidence none must hold exactly when 0 of >0 considered rows matched");
      if (none) {
        if (!aggregates.every(key => ledger[key] === null) || ledger.outcomes !== null) errors.push("ledger aggregates must be null when evidence is none");
      } else if (!aggregates.every(key => isCount(ledger[key])) || !isObject(ledger.outcomes) ||
        !Object.values(ledger.outcomes).every(n => Number.isInteger(n))) errors.push("ledger aggregates must be non-null counts unless evidence is none");
      else if (ledger.sessions !== ledger.rowsMatched) errors.push("ledger.sessions must equal rowsMatched");
    }
  }
  if (typeof record.unmatchedTruncated !== "boolean") errors.push("unmatchedTruncated must be a boolean");
  else if (isObject(ledger) && Array.isArray(record.unmatchedLedgerRows) && isObject(plan) && typeof ledger.rowsExcluded === "number") {
    const listed = record.unmatchedLedgerRows.length;
    if (listed > MAX_UNMATCHED_ROWS || record.unmatchedTruncated !== ledger.rowsExcluded > MAX_UNMATCHED_ROWS ||
      listed !== Math.min(ledger.rowsExcluded, MAX_UNMATCHED_ROWS)) errors.push("unmatchedLedgerRows is inconsistent with ledger.rowsExcluded");
  }
  if (isObject(plan) && plan.closed === true && Array.isArray(record.actions) &&
    (record.actions.length === 0 || !record.actions.every(a => isObject(a) && a.status === "done") ||
      !Array.isArray(record.openRemainders) || record.openRemainders.length > 0)) errors.push("plan.closed is true but Actions remain open");
  if (!Array.isArray(record.frictions) || !record.frictions.every(item => isObject(item) &&
    hasExactKeys(item, ["id", "status", "testIds", "uncited"]) && typeof item.id === "string" && typeof item.status === "string" &&
    isStringArray(item.testIds) && typeof item.uncited === "boolean")) errors.push("frictions is malformed");
  if (!isStringArray(record.unresolvedFrictionIds)) errors.push("unresolvedFrictionIds must be a string array");
  if (!isStringArray(record.duplicateLedgerSessions)) errors.push("duplicateLedgerSessions must be a string array");
  if (!Array.isArray(record.unmatchedLedgerRows) || !record.unmatchedLedgerRows.every(item => isObject(item) &&
    hasExactKeys(item, ["session_id", "action_id"]) && typeof item.session_id === "string" && typeof item.action_id === "string")) errors.push("unmatchedLedgerRows is malformed");
  const successor = record.successor;
  if (!isObject(successor) || !hasExactKeys(successor, ["recommendation", "reason"]) ||
    !(successor.recommendation === null || typeof successor.recommendation === "string") || typeof successor.reason !== "string" || successor.reason === "") {
    errors.push("successor must be {recommendation: string|null, reason: non-empty string}");
  }
  if (typeof record.hash !== "string" || !/^[0-9a-f]{64}$/.test(record.hash)) errors.push("hash must be a sha256 hex string");
  else if (errors.length === 0 && hashCloseOut(record as unknown as CloseOutRecord) !== record.hash) {
    errors.push(`hash does not match the record content; ${SNAPSHOT_REMEDY}`);
  }
  return errors;
}

/** `Completed arcadia/<action>` sections of MISSION_LOG.md: date, candidate sha and recorded blockers. */
export function parseCompletionEntries(logText: string): CompletionEntry[] {
  const entries: CompletionEntry[] = [];
  for (const section of logText.split(/^## /m).slice(1)) {
    const head = /^(\d{4}-\d{2}-\d{2}) — Completed [^/\s]+\/(\S+)/.exec(section);
    if (!head) continue;
    const candidate = /\(Candidate ([0-9a-f]{7,40})\)/.exec(section)?.[1] ?? null;
    const blockerLine = /^- \*\*Blockers:\*\*\s*(.*)$/m.exec(section)?.[1]?.trim() ?? "";
    const blockers = blockerLine === "" || /^none\b/i.test(blockerLine) ? [] : [blockerLine];
    entries.push({ actionId: head[2], date: head[1], candidate, blockers });
  }
  return entries;
}

const TEST_ID = /[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?\b|check:[a-z0-9-]+/g;

/** One friction file (`docs/reports/frictions/*.md`): front matter id/status, test ids cited in fix or body. */
export function parseFrictionFile(file: NamedContent): FrictionEntry | null {
  if (file.readError) return null;
  const front = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(file.content);
  if (!front) return null;
  const fields = new Map<string, string>();
  for (const line of front[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) fields.set(kv[1], kv[2].trim());
  }
  const id = fields.get("id");
  if (!id) return null;
  return { id, status: (fields.get("status") ?? "").toLowerCase().split(/\s+/)[0] || "unknown",
    testIds: uniqSorted(`${fields.get("fix") ?? ""}\n${front[2]}`.match(TEST_ID) ?? []) };
}

/** The frozen legacy table in the living notes; ledger ids are `F<row>`. Status is the first word of the last column. */
export function parseLegacyFrictions(notes: string): FrictionEntry[] {
  const entries: FrictionEntry[] = [];
  for (const line of notes.split("\n")) {
    const match = /^\|\s*(\d+[a-z]?)\s*\|(.*)\|\s*$/.exec(line);
    if (!match) continue;
    const cells = match[2].split("|").map(cell => cell.trim());
    if (cells.length < 4) continue;
    const status = cells[cells.length - 1];
    entries.push({ id: `F${match[1]}`, status: status.toLowerCase().split(/[\s(]+/)[0] || "unknown",
      testIds: uniqSorted(`${cells[cells.length - 2]}\n${status}`.match(TEST_ID) ?? []) });
  }
  return entries;
}

/** The Plan body line `Successor: <slug or text>` (or `Next Plan:`) when the Plan names one. */
export function parseSuccessor(body: string): { recommendation: string | null; reason: string } {
  const match = /^\s*(?:Successor|Next Plan)\s*:\s*(.+?)\s*$/im.exec(body);
  return match ? { recommendation: match[1], reason: "named by the Plan document" }
    : { recommendation: null, reason: "the Plan document names no successor" };
}

/**
 * Resolves a commit sha to the PR whose merge commit first brought it into the default branch:
 * `git log --merges --first-parent --ancestry-path --format=%s <sha>..<branch>`, oldest merge, `Merge pull request #N`.
 * Returns null when the sha is unknown, not merged, or the merge subject names no PR.
 */
export function gitShaToPr(repoRoot: string): (sha: string) => number | null {
  const run = (args: string[]): string | null => {
    try { return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
  };
  const remoteHead = run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.trim();
  const branch = [remoteHead, "main", "master", "HEAD"].find((name): name is string => !!name && run(["rev-parse", "--verify", "--quiet", `${name}^{commit}`]) !== null);
  return (sha: string): number | null => {
    if (!branch || !/^[0-9a-f]{7,40}$/.test(sha)) return null;
    const out = run(["log", "--merges", "--first-parent", "--ancestry-path", "--format=%s", `${sha}..${branch}`]);
    if (out === null) return null;
    const subjects = out.split("\n").filter(line => line !== "");
    for (let index = subjects.length - 1; index >= 0; index -= 1) {
      const match = /^Merge pull request #(\d+)\b/.exec(subjects[index]);
      if (match) return Number(match[1]);
    }
    return null;
  };
}

export interface LoadedCloseOutInputs { input: CloseOutInput; errors: string[]; excludedLedgerRows: number }

/** Thin fs wrapper: resolves the Plan, ledger, frictions and MISSION_LOG for one repository root. */
export function loadCloseOutInputs(repoRoot: string, slug: string): LoadedCloseOutInputs {
  const relative = `docs/plans/${slug}.md`;
  const absolute = path.join(repoRoot, relative);
  if (!existsSync(absolute)) throw new Error(`Plan document not found: ${relative}`);
  const parsed = parseDoc(relative, absolute, readFileSync(absolute, "utf8"));
  if (!parsed.doc || parsed.doc.type !== "plan") {
    throw new Error(`${relative} is not a valid Plan: ${parsed.errors.map(error => `${error.field}: ${error.message}`).join("; ") || "unparsed"}`);
  }
  const plan = parsed.doc;
  const ledger = readSessionLedger(repoRoot);
  const planIds = new Set(plan.actions.map(action => action.id));
  const read = (name: string): string => { try { return readFileSync(path.join(repoRoot, name), "utf8"); } catch { return ""; } };
  const frictions = [
    ...readFrictionFiles(repoRoot).map(parseFrictionFile).filter((entry): entry is FrictionEntry => entry !== null),
    ...parseLegacyFrictions(read(LIVING_NOTES))
  ];
  return {
    errors: ledger.errors,
    excludedLedgerRows: ledger.rows.filter(row => !planIds.has(row.action_id)).length,
    input: {
      plan: {
        slug: plan.slug, status: plan.status, milestone: plan.milestone,
        actions: plan.actions.map(action => ({ id: action.id, title: action.title, status: action.status, splitInto: action.splitInto }))
      },
      ledgerRows: ledger.rows,
      frictions,
      completions: parseCompletionEntries(read("MISSION_LOG.md")),
      successor: parseSuccessor(plan.body),
      shaToPr: gitShaToPr(repoRoot)
    }
  };
}

export type WriteDecision = { action: "write" } | { action: "noop" } | { action: "refuse"; reason: string };

/** Never overwrite a record whose recorded hash differs from the freshly built one. */
export function decideWrite(existingText: string | null, fresh: CloseOutRecord): WriteDecision {
  if (existingText === null) return { action: "write" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingText);
  } catch (error) {
    return { action: "refuse", reason: `the existing record is not valid JSON (${(error as Error).message}); remove it deliberately and re-run` };
  }
  if (isObject(parsed) && parsed.hash === fresh.hash && validateCloseOut(parsed).length === 0) return { action: "noop" };
  return { action: "refuse", reason: "an existing close-out record has a different hash; a closed-out record is not regenerated silently. Review the difference and delete the file deliberately to re-record" };
}

export const renderCloseOut = (record: CloseOutRecord): string => `${JSON.stringify(record, null, 2)}\n`;
