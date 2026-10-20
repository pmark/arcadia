import { git } from "../git/worktrees.js";

/**
 * Issue #1608: a Session's completion evidence marked "The change touches only
 * tests/tick-independent-review.test.ts" as met while the candidate changed
 * src/production/tick.ts, and the completion settled -- evidence was checked
 * for verbatim coverage and `met`, never for truth. This is the host's
 * deterministic check of that one criterion shape against the candidate's own
 * diff, run before a drafted completion settles.
 *
 * Only a scope clause it can read exactly is judged: "touches only <paths>"
 * (comma/"and" separated repository paths), or an anaphor such as "those two
 * files" / "that new report file" that resolves to exactly the paths the
 * Action's other criteria name. Anything else ("changes only a row whose ...")
 * is prose this check does not grade, so it neither passes nor refuses it.
 */

export interface ScopeAllowance {
  criterion: string;
  /** Repository paths the change may touch; an entry ending in `/` allows that directory. */
  allowed: string[];
}

export interface ScopeViolation extends ScopeAllowance {
  outside: string[];
}

const SCOPE_CLAUSE = /\b(?:touch(?:es)?|modif(?:y|ies)|chang(?:e|es))\s+only\s+([^;]*)/i;
// A repository path: segments of plain path characters with at least one `/`, or a top-level file with an extension.
const SLASH_PATH = /^(?:[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+)?$/;
const ROOT_FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.[A-Za-z0-9]+$/;
const PATH_MENTION = /(?<![\w./-])((?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)+[A-Za-z0-9_-][A-Za-z0-9_.-]*\.[A-Za-z0-9]+)(?![\w/-])/g;
const FILLER = new Set(["and", "or", "the", "both", "file", "files"]);
const ANAPHOR_HEAD = new Set(["those", "these", "that", "this", "the"]);
const COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const isPath = (token: string) => !token.split("/").some((segment) => segment === "." || segment === "..")
  && (SLASH_PATH.test(token) || ROOT_FILE.test(token));

/** The clause after "touches only", cut at the end of its sentence (a period followed by space or end, not one inside a path). */
function scopeClause(criterion: string): string | null {
  const match = SCOPE_CLAUSE.exec(criterion);
  if (!match) return null;
  return match[1].replace(/\.(?:\s.*)?$/s, "").trim();
}

function strip(token: string): string {
  return token.replace(/^['"`(]+|['"`),:]+$/g, "");
}

/** Paths named by the Action's criteria other than the scope criterion itself, in first-mention order. */
function pathsNamedElsewhere(criteria: readonly string[], except: string): string[] {
  const found: string[] = [];
  for (const criterion of criteria) {
    if (criterion === except) continue;
    for (const match of criterion.matchAll(PATH_MENTION)) {
      const file = match[1];
      if (isPath(file) && !found.includes(file)) found.push(file);
    }
  }
  return found;
}

/** "those two files", "that new report file": the paths it refers to, or null when that is not exactly determined. */
function resolveAnaphor(clause: string, criteria: readonly string[], criterion: string): string[] | null {
  const words = clause.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5 || !ANAPHOR_HEAD.has(words[0])) return null;
  const last = words[words.length - 1];
  if (last !== "file" && last !== "files") return null;
  const named = pathsNamedElsewhere(criteria, criterion);
  const count = words.slice(1, -1).map((word) => COUNTS[word] ?? (/^\d+$/.test(word) ? Number(word) : undefined)).find((n) => n !== undefined);
  const expected = count ?? (last === "file" ? 1 : undefined);
  if (named.length === 0 || (expected !== undefined && named.length !== expected)) return null;
  return named;
}

/** The scope criteria this check can read exactly, each with the paths it allows. */
export function scopeAllowances(criteria: readonly string[]): ScopeAllowance[] {
  const allowances: ScopeAllowance[] = [];
  for (const criterion of criteria) {
    const clause = scopeClause(criterion);
    if (!clause) continue;
    const anaphor = resolveAnaphor(clause, criteria, criterion);
    if (anaphor) { allowances.push({ criterion, allowed: anaphor }); continue; }
    const tokens = clause.split(/[\s,]+/).map(strip).filter(Boolean);
    const paths = tokens.filter((token) => !FILLER.has(token.toLowerCase()));
    if (paths.length > 0 && paths.every(isPath)) allowances.push({ criterion, allowed: [...new Set(paths)] });
  }
  return allowances;
}

/** The paths every readable scope criterion allows at once (each is enforced on its own), or null when none is readable. */
export function scopeIntersection(criteria: readonly string[]): string[] | null {
  const allowances = scopeAllowances(criteria);
  if (allowances.length === 0) return null;
  return allowances.slice(1).reduce((kept, allowance) => kept.filter((entry) => within(entry, allowance.allowed)), allowances[0].allowed);
}

const within = (file: string, allowed: readonly string[]) =>
  allowed.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));

/** Each readable scope criterion the changed files break, with the files outside it. */
export function scopeViolations(criteria: readonly string[], changed: readonly string[]): ScopeViolation[] {
  return scopeAllowances(criteria)
    .map((allowance) => ({ ...allowance, outside: changed.filter((file) => !within(file, allowance.allowed)) }))
    .filter((violation) => violation.outside.length > 0);
}

/**
 * Before settlement the candidate carries no settlement writes: its only
 * governed file is the Session's own completion draft. Every other path --
 * a Plan, a Decision, PROJECT.md -- is the Session's own change and judged.
 */
const isPreSettlementDraftPath = (file: string) => /^\.arcadia\/asks\/[^/]+\.ya?ml$/i.test(file);

/** The records a governed settlement writes (reconciliation.ts `isSettlementRecordPath`), never the Session's own change. */
export function isGovernedRecordPath(file: string): boolean {
  return file === "PROJECT.md"
    || file === "MISSION_LOG.md"
    || file.startsWith("docs/plans/")
    || file.startsWith("docs/decisions/")
    || file.startsWith(".arcadia/asks/");
}

/**
 * The governed records `arcadia agent-ask settle --apply` writes on a settled
 * head, found by the same rule as the host scope check: a governed record
 * outside the Session's own top-level `.arcadia/asks/*.yaml` draft or proposal
 * and outside `docs/decisions/` (an authority change, never inert). Empty
 * unless the head carries an archived Ask, the settlement's own marker, so an
 * unsettled change never has a path excused.
 */
export function settlementRecordPaths(files: readonly string[]): string[] {
  const settled = files.some((file) => /^\.arcadia\/asks\/archive\/[^/]+$/.test(file));
  if (!settled) return [];
  return files.filter((file) => isGovernedRecordPath(file) && !isPreSettlementDraftPath(file) && !file.startsWith("docs/decisions/"));
}

const MAX_LISTED = 10;
const MAX_PATH_CHARS = 200;

/** A changed path is whatever name the candidate chose: only plain path characters reach a receipt or a resumed brief. */
function shown(file: string): string {
  const plain = file.replace(/[^A-Za-z0-9_./-]/g, "?");
  return plain.length > MAX_PATH_CHARS ? `${plain.slice(0, MAX_PATH_CHARS - 1)}…` : plain;
}

/**
 * The candidate's own change (`base...revision`, the same diff the review
 * repair change gate reads, the Session's completion draft left out) judged
 * against the Action's scope criteria -- the criteria as the base declares
 * them, never the candidate's own copy, which the candidate could edit. Null
 * when every readable one holds, otherwise the refusal reason. A diff that
 * cannot be read is a refusal, never a pass.
 */
export function candidateScopeRefusal(repoRoot: string, base: string, revision: string, criteria: readonly string[]): string | null {
  if (scopeAllowances(criteria).length === 0) return null;
  let changed: string[];
  try {
    changed = git(repoRoot, ["-c", "core.quotepath=false", "diff", "-z", "--no-renames", "--name-only", `${base}...${revision}`])
      .split("\0").filter((file) => file && !isPreSettlementDraftPath(file));
  } catch {
    return `Scope check refused the completion: the candidate's diff ${base.slice(0, 12)}...${revision.slice(0, 12)} could not be read.`;
  }
  const violations = scopeViolations(criteria, changed);
  if (violations.length === 0) return null;
  const described = violations.map((violation) => {
    const listed = violation.outside.slice(0, MAX_LISTED).map(shown).join(", ");
    const more = violation.outside.length > MAX_LISTED ? ` (and ${violation.outside.length - MAX_LISTED} more)` : "";
    return `"${violation.criterion}" allows only ${violation.allowed.join(", ")}, but the candidate also changes ${listed}${more}`;
  });
  return `Scope check refused the completion: ${described.join("; ")}. Revert the out-of-scope changes; if the criteria cannot be met within that scope, stop and ask instead of widening it.`;
}
