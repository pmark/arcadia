import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * ADR 0025's operator task ledger, promoted into Arcadia by Decision 0028.
 *
 * Work only the operator can do is the most common way a governed Action
 * actually stalls -- a person has to go create a resource in a third-party
 * console, approve something outside this repository, or answer a question
 * no agent can answer for them. `attention` covers Decisions awaiting
 * Approve/Reject/Defer; `back-burner` covers captured ideas awaiting a
 * surfacing condition. Neither records this.
 *
 * `.arcadia/operator-tasks.jsonl` is append-only, repo-local, and reads with
 * no workspace and no database -- the same shape as `resolveDispatch` and
 * `evaluateTriggers`. That is deliberate, not incidental: an agent raising a
 * task is very often reporting exactly the kind of environment gap (no
 * reachable workspace, no credential, no access) that would make a
 * database-backed ledger unusable at the moment it is needed most. A task's
 * current state is folded from its events rather than edited in place;
 * `done` and `declined` are terminal, and only the operator may append them
 * -- enforced by the CLI's `--operator` flag, the same loud escape-hatch
 * shape as `--allow-blocking` elsewhere in this repository, since this CLI
 * holds no credentials that could enforce it any harder.
 */
export type OperatorTaskStatus = "waiting" | "done" | "declined";
export type OperatorTaskOriginKind = "action" | "decision";

export interface OperatorTaskOrigin {
  kind: OperatorTaskOriginKind;
  id: string;
}

export interface OperatorTaskEvidence {
  at: string;
  by: string;
  note: string;
}

export interface OperatorTask {
  id: string;
  raisedAt: string;
  raisedBy: string;
  asks: string;
  whyOnlyYou: string;
  origin: OperatorTaskOrigin;
  reference: string | null;
  status: OperatorTaskStatus;
  evidence: OperatorTaskEvidence[];
  closedAt: string | null;
  closedBy: string | null;
  because: string | null;
}

type LedgerEvent =
  | {
      event: "raised";
      id: string;
      at: string;
      by: string;
      asks: string;
      why_only_you: string;
      origin: OperatorTaskOrigin;
      reference: string | null;
    }
  | { event: "evidence"; id: string; at: string; by: string; note: string }
  | { event: "done"; id: string; at: string; by: string }
  | { event: "declined"; id: string; at: string; by: string; because: string };

const LEDGER_RELATIVE_PATH = ".arcadia/operator-tasks.jsonl";

export function operatorTaskLedgerPath(repoRoot: string): string {
  return path.join(repoRoot, LEDGER_RELATIVE_PATH);
}

function readLedgerEvents(repoRoot: string): LedgerEvent[] {
  const file = operatorTaskLedgerPath(repoRoot);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerEvent);
}

function appendLedgerEvent(repoRoot: string, event: LedgerEvent): void {
  const file = operatorTaskLedgerPath(repoRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(event)}\n`);
}

function foldOperatorTasks(events: LedgerEvent[]): OperatorTask[] {
  const tasks = new Map<string, OperatorTask>();
  for (const event of events) {
    if (event.event === "raised") {
      tasks.set(event.id, {
        id: event.id,
        raisedAt: event.at,
        raisedBy: event.by,
        asks: event.asks,
        whyOnlyYou: event.why_only_you,
        origin: event.origin,
        reference: event.reference,
        status: "waiting",
        evidence: [],
        closedAt: null,
        closedBy: null,
        because: null
      });
      continue;
    }
    // An event for an id that was never raised is a malformed ledger, not a
    // crash: reading the ledger has to keep working on a bad day, the same
    // discipline `evaluateTriggers` follows for a malformed registry.
    const task = tasks.get(event.id);
    if (!task) continue;
    if (event.event === "evidence") {
      task.evidence.push({ at: event.at, by: event.by, note: event.note });
    } else if (event.event === "done") {
      task.status = "done";
      task.closedAt = event.at;
      task.closedBy = event.by;
    } else if (event.event === "declined") {
      task.status = "declined";
      task.closedAt = event.at;
      task.closedBy = event.by;
      task.because = event.because;
    }
  }
  return [...tasks.values()];
}

export function listOperatorTasks(
  repoRoot: string,
  status: OperatorTaskStatus | "all" = "waiting"
): OperatorTask[] {
  const tasks = foldOperatorTasks(readLedgerEvents(repoRoot)).sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
  return status === "all" ? tasks : tasks.filter((task) => task.status === status);
}

export function getOperatorTask(repoRoot: string, id: string): OperatorTask | null {
  return foldOperatorTasks(readLedgerEvents(repoRoot)).find((task) => task.id === id) ?? null;
}

/** Action ids already in project control: every `id:` under a plan's `actions:` list. */
function knownActionIds(repoRoot: string): Set<string> {
  const plansDir = path.join(repoRoot, "docs/plans");
  const ids = new Set<string>();
  if (!existsSync(plansDir)) return ids;
  for (const file of readdirSync(plansDir)) {
    if (!file.endsWith(".md")) continue;
    const frontmatter = readFileSync(path.join(plansDir, file), "utf8").split(/^---\s*$/m)[1] ?? "";
    const actionsBlock = frontmatter.split(/^actions:\s*$/m)[1] ?? "";
    for (const match of actionsBlock.matchAll(/^\s{2}-\s*id:\s*([a-z0-9][a-z0-9-]*)\s*$/gm)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

/** Decision ids already in project control: every `docs/decisions/NNNN-*.md`. */
function knownDecisionIds(repoRoot: string): Set<string> {
  const dir = path.join(repoRoot, "docs/decisions");
  const ids = new Set<string>();
  if (!existsSync(dir)) return ids;
  for (const file of readdirSync(dir)) {
    const match = /^(\d{4})-/.exec(file);
    if (match) ids.add(match[1]);
  }
  return ids;
}

/**
 * There are no free-floating tasks. `--action` and `--decision` are the two
 * citable origins this implementation supports, matching the reference
 * implementation this promotes; a "recorded blocker" origin is deferred
 * until a real task needs one.
 */
export function resolveOperatorTaskOrigin(
  repoRoot: string,
  options: { action?: string; decision?: string }
): OperatorTaskOrigin {
  if (options.action) {
    if (!knownActionIds(repoRoot).has(options.action)) {
      throw new Error(
        `"${options.action}" is not a known Action id in docs/plans/*.md. An operator task cannot cite work that is not in project control.`
      );
    }
    return { kind: "action", id: options.action };
  }
  if (options.decision) {
    const normalized = /^\d+$/.test(options.decision) ? options.decision.padStart(4, "0") : options.decision;
    if (!knownDecisionIds(repoRoot).has(normalized)) {
      throw new Error(
        `"${options.decision}" is not a known Decision id in docs/decisions/. An operator task cannot cite work that is not in project control.`
      );
    }
    return { kind: "decision", id: normalized };
  }
  throw new Error(
    "An operator task requires an origin already in project control: --action <action-id> or --decision <decision-id>."
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
}

export function raiseOperatorTask(
  repoRoot: string,
  input: {
    asks: string;
    whyOnlyYou: string;
    origin: OperatorTaskOrigin;
    reference?: string | null;
    by?: string;
    idHint?: string;
  }
): OperatorTask {
  const at = new Date().toISOString();
  const existingIds = new Set(
    readLedgerEvents(repoRoot)
      .filter((event): event is Extract<LedgerEvent, { event: "raised" }> => event.event === "raised")
      .map((event) => event.id)
  );
  const slug = slugify(input.idHint ?? input.asks);
  let id = `op-${at.slice(0, 10)}-${slug}`;
  for (let suffix = 2; existingIds.has(id); suffix += 1) {
    id = `op-${at.slice(0, 10)}-${slug}-${suffix}`;
  }
  const event: LedgerEvent = {
    event: "raised",
    id,
    at,
    by: input.by ?? "agent",
    asks: input.asks,
    why_only_you: input.whyOnlyYou,
    origin: input.origin,
    reference: input.reference ?? null
  };
  appendLedgerEvent(repoRoot, event);
  return foldOperatorTasks([event])[0];
}

function requireWaitingTask(repoRoot: string, id: string): OperatorTask {
  const task = getOperatorTask(repoRoot, id);
  if (!task) {
    throw new Error(`"${id}" is not a task in the operator ledger. Run "arcadia operator-task list --status all" to see every task.`);
  }
  if (task.status !== "waiting") {
    throw new Error(`"${id}" is already ${task.status}.`);
  }
  return task;
}

export function attachOperatorTaskEvidence(repoRoot: string, id: string, note: string, by = "agent"): OperatorTask {
  requireWaitingTask(repoRoot, id);
  appendLedgerEvent(repoRoot, { event: "evidence", id, at: new Date().toISOString(), by, note });
  return getOperatorTask(repoRoot, id)!;
}

/** Terminal. Only the operator may close a task; the CLI enforces this with `--operator`. */
export function closeOperatorTask(repoRoot: string, id: string, by = "operator"): OperatorTask {
  requireWaitingTask(repoRoot, id);
  appendLedgerEvent(repoRoot, { event: "done", id, at: new Date().toISOString(), by });
  return getOperatorTask(repoRoot, id)!;
}

/** Terminal. Only the operator may decline a task; the CLI enforces this with `--operator`. */
export function declineOperatorTask(repoRoot: string, id: string, because: string, by = "operator"): OperatorTask {
  requireWaitingTask(repoRoot, id);
  appendLedgerEvent(repoRoot, { event: "declined", id, at: new Date().toISOString(), by, because });
  return getOperatorTask(repoRoot, id)!;
}
