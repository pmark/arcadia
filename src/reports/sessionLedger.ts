/**
 * Session ledger: one JSON object per line in docs/reports/session-ledger.jsonl.
 *
 * How a session adds a row: at hand-off, append exactly one line for the
 * session (not one per attempt) with the fields below. Use null for any token
 * or time number you do not have; never estimate. When only a harness
 * subagent total exists, put it in `subagent_tokens_total` and leave the
 * uncached/cached split null. A `stopped` outcome needs a `stop_reason`.
 * For subagents `model` is the requested alias (e.g. "sonnet"), not a resolved id.
 * `notes` is an optional string of at most 200 characters.
 * `pnpm check:session-ledger` (CI runs it) rejects missing or mistyped fields.
 */
export const SESSION_ROLES = ["lead", "driver", "reviewer", "replayer", "opus-planner"] as const;
export const SESSION_OUTCOMES = ["complete", "split", "stopped"] as const;

export interface SessionLedgerRow {
  session_id: string;
  role: (typeof SESSION_ROLES)[number];
  model: string;
  effort: string | null;
  action_id: string;
  pr: number | null;
  tokens_in_uncached: number | null;
  tokens_in_cached: number | null;
  tokens_out: number | null;
  subagent_tokens_total?: number | null;
  wall_min: number | null;
  attempts: number;
  review_rounds: number;
  blocking_findings: { class: string; caught_by: string }[];
  operator_touches: number | null;
  host_touches: number | null;
  frictions: { id: string; cost_min: number | null; fix_ref: string | null }[];
  outcome: (typeof SESSION_OUTCOMES)[number];
  stop_reason?: string;
  notes?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isInt = (value: unknown): value is number => isCount(value) && Number.isInteger(value);
const isCountOrNull = (value: unknown): boolean => value === null || isCount(value);

const REQUIRED = [
  "session_id", "role", "model", "effort", "action_id", "pr", "tokens_in_uncached", "tokens_in_cached", "tokens_out",
  "wall_min", "attempts", "review_rounds", "blocking_findings", "operator_touches", "host_touches", "frictions", "outcome",
] as const;
const ALLOWED = new Set<string>([...REQUIRED, "subagent_tokens_total", "stop_reason", "notes"]);

/** Returns every problem with one parsed row; an empty array means valid. */
export function validateSessionLedgerRow(row: unknown): string[] {
  if (!isObject(row)) return ["row is not a JSON object"];
  const errors: string[] = [];
  for (const key of REQUIRED) if (!(key in row)) errors.push(`missing field ${key}`);
  for (const key of Object.keys(row)) if (!ALLOWED.has(key)) errors.push(`unknown field ${key}`);
  const check = (key: string, ok: boolean, expected: string) => {
    if (key in row && !ok) errors.push(`field ${key} must be ${expected}`);
  };
  check("session_id", isString(row.session_id), "a non-empty string");
  check("role", (SESSION_ROLES as readonly unknown[]).includes(row.role), `one of ${SESSION_ROLES.join("|")}`);
  check("model", isString(row.model), "a non-empty string");
  check("effort", row.effort === null || isString(row.effort), "a string or null");
  check("action_id", isString(row.action_id), "a non-empty string");
  check("pr", row.pr === null || (isCount(row.pr) && Number.isInteger(row.pr)), "an integer or null");
  for (const key of ["tokens_in_uncached", "tokens_in_cached", "tokens_out", "wall_min"]) {
    check(key, isCountOrNull(row[key]), "a non-negative number or null");
  }
  if ("subagent_tokens_total" in row) check("subagent_tokens_total", isCountOrNull(row.subagent_tokens_total), "a non-negative number or null");
  for (const key of ["operator_touches", "host_touches"]) {
    check(key, row[key] === null || isInt(row[key]), "a non-negative integer or null");
  }
  check("attempts", isInt(row.attempts), "a non-negative integer");
  check("review_rounds", isInt(row.review_rounds), "a non-negative integer");
  if ("notes" in row) check("notes", typeof row.notes === "string" && row.notes.length <= 200, "a string of at most 200 characters");
  check("blocking_findings", Array.isArray(row.blocking_findings)
    && row.blocking_findings.every(f => isObject(f) && isString(f.class) && isString(f.caught_by)), "an array of {class, caught_by} strings");
  check("frictions", Array.isArray(row.frictions)
    && row.frictions.every(f => isObject(f) && isString(f.id) && isCountOrNull(f.cost_min) && (f.fix_ref === null || isString(f.fix_ref))),
    "an array of {id, cost_min, fix_ref}");
  check("outcome", (SESSION_OUTCOMES as readonly unknown[]).includes(row.outcome), `one of ${SESSION_OUTCOMES.join("|")}`);
  if (row.outcome === "stopped" && !isString(row.stop_reason)) errors.push("outcome stopped requires a stop_reason");
  if ("stop_reason" in row && !isString(row.stop_reason)) errors.push("field stop_reason must be a non-empty string");
  return errors;
}

/** Validates a JSONL document; returns one message per problem, prefixed with its line number. */
export function validateSessionLedger(text: string): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(`line ${index + 1}: invalid JSON`);
      return;
    }
    for (const error of validateSessionLedgerRow(parsed)) errors.push(`line ${index + 1}: ${error}`);
    const id = isObject(parsed) ? parsed.session_id : undefined;
    if (typeof id === "string") {
      if (seen.has(id)) errors.push(`line ${index + 1}: duplicate session_id ${id}`);
      seen.add(id);
    }
  });
  return errors;
}
