import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { readProductionPolicySafely } from "../production/policy.js";

/**
 * The run window, as a visible signal for `arcadia work monitor`.
 *
 * Merging to origin/main while a live run or a waiting START card depends on
 * it makes the card refuse (`origin main is ..., not the reviewed revision`)
 * or disturbs the run. This is a read-only signal: it blocks nothing, adds no
 * gate and grants no authority. It reads the same two sources everyone
 * already trusts: the production policy (as `arcadia production status`
 * does) and the operator-script library (descriptor plus consumed marker).
 * A source that cannot be read makes the state `unknown`, never an error.
 *
 * A governed hold (`<card-id>.held.json`, written only by `arcadia start-run hold`)
 * reports a waiting card as held. A held card is not counted as opening the window.
 */

export interface RunWindowReason {
  kind: "production_active" | "start_card_waiting";
  /** Production: the policy state; card: the card id. */
  subject: string;
  /** ISO instant the window is known to hold until; null when it has no known end (Active production). */
  until: string | null;
  detail: string;
  /** Card only: false when the press would refuse at preflight P2 because the pinned worker job has no running PID (Issue #2179). */
  pressable?: boolean;
  /** Card only: the full origin/main revision the card pins. */
  revision?: string;
}

export interface RunWindow {
  /** `open`: merging to main now would disturb a run or a waiting card. `unknown`: a source could not be read. */
  state: "open" | "closed" | "unknown";
  reasons: RunWindowReason[];
  /** One line per source that could not be read. */
  unknown: string[];
  /** One line per waiting START card held by a governed marker. Never counted in `reasons`, so never opens the window. */
  held: string[];
  observedAt: string;
}

export const START_CARD_HOLD_SCHEMA = "arcadia-card-held-v1";

/** A governed hold on one waiting START card, written only by `arcadia start-run hold`. */
export interface StartCardHold {
  schema: typeof START_CARD_HOLD_SCHEMA;
  id: string;
  reason: string;
  /** An https URL, or a repository-relative path. */
  evidence: string;
  heldAt: string;
  heldBy: string;
}

export interface RunWindowDeps {
  now(): Date;
  /** The operator-script library directory (descriptors, `<id>.consumed.json` markers and `<id>.held.json` holds). */
  libraryDir(): string;
  /** The local view of origin/main, or null when it cannot be resolved. */
  originMain(): string | null;
  /** Whether launchd reports a running PID for the job: true/false, or null when it cannot be told (not macOS, launchctl denied). */
  workerRunning?(label: string): boolean | null;
}

/** Same resolution order as /actions: an explicit override, else the main checkout's library, never a worktree's copy. */
export function defaultRunWindowDeps(repositoryPath: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): RunWindowDeps {
  return {
    now: () => new Date(),
    libraryDir: () => {
      const override = env.ARCADIA_OPERATOR_SCRIPT_LIBRARY?.trim();
      if (override) return override;
      try {
        const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
          cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000
        }).trim();
        const candidate = path.join(path.dirname(common), "artifacts", "generated", "operator-scripts");
        if (existsSync(candidate)) return candidate;
      } catch {
        // fall through to the same default /actions uses
      }
      return path.join(os.homedir(), "Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts");
    },
    workerRunning: (label) => {
      try {
        const out = execFileSync("launchctl", ["list", label], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
        return /"PID" = \d+;/.test(out);
      } catch (error) {
        // Only "not loaded" is a definite no; anything else (no launchctl, denied) leaves the answer unknown.
        const text = String((error as { stderr?: unknown }).stderr ?? "") + String((error as Error).message ?? "");
        return /Could not find (specified )?service|No such process|not loaded/i.test(text) ? false : null;
      }
    },
    originMain: () => {
      try {
        const sha = execFileSync("git", ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"], {
          cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000
        }).trim();
        return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
      } catch {
        return null;
      }
    }
  };
}

export function observeRunWindow(db: Database.Database, deps: RunWindowDeps = defaultRunWindowDeps()): RunWindow {
  const now = deps.now();
  const reasons: RunWindowReason[] = [];
  const unknown: string[] = [];
  let held: string[] = [];

  try {
    const read = readProductionPolicySafely(db);
    if (read.status !== "ok") {
      unknown.push(`managed production state could not be read (${oneLine(read.reason)})`);
    } else if (read.policy.desiredState === "active") {
      reasons.push({
        kind: "production_active",
        subject: "managed production Active",
        until: null,
        detail: `managed production is Active (policy revision ${read.policy.revision}, epoch ${read.policy.epoch}); the window closes at the run's terminal production Off`
      });
    }
  } catch (error) {
    unknown.push(`managed production state could not be read (${oneLine(error)})`);
  }

  try {
    const waiting = waitingStartCards(deps, now, unknown);
    reasons.push(...waiting.reasons);
    held = waiting.held;
  } catch (error) {
    unknown.push(`the operator-script library could not be read (${oneLine(error)})`);
  }

  const state = reasons.length > 0 ? "open" : unknown.length > 0 ? "unknown" : "closed";
  return { state, reasons, unknown, held, observedAt: now.toISOString() };
}

/** Reads `<id>.held.json`: null when there is no hold, the hold when valid, "unreadable" when present but invalid. */
function readStartCardHold(library: string, id: string): StartCardHold | null | "unreadable" {
  const file = path.join(library, `${id}.held.json`);
  if (!existsSync(file)) return null;
  try {
    const hold = JSON.parse(readFileSync(file, "utf8")) as Partial<StartCardHold>;
    if (hold?.schema !== START_CARD_HOLD_SCHEMA || hold.id !== id) return "unreadable";
    if (typeof hold.reason !== "string" || !hold.reason.trim() || typeof hold.evidence !== "string" || !hold.evidence.trim()) return "unreadable";
    return hold as StartCardHold;
  } catch {
    return "unreadable";
  }
}

function waitingStartCards(deps: RunWindowDeps, now: Date, unknown: string[]): { reasons: RunWindowReason[]; held: string[] } {
  const library = deps.libraryDir();
  const names = readdirSync(library).filter((name) => name.endsWith(".json") && !name.endsWith(".consumed.json") && !name.endsWith(".held.json")).sort();
  const candidates: Array<{ id: string; reviewedRevision: string; expiresAt: string; expiry: number; workerLabel: string | null }> = [];
  let unreadable = 0;
  for (const name of names) {
    let descriptor: { startRun?: { reviewedRevision?: unknown; workerLabel?: unknown }; expires_at?: unknown };
    try {
      descriptor = JSON.parse(readFileSync(path.join(library, name), "utf8"));
    } catch {
      unreadable += 1;
      continue;
    }
    const pins = descriptor?.startRun;
    if (!pins || typeof pins !== "object") continue;
    const id = name.slice(0, -".json".length);
    if (typeof pins.reviewedRevision !== "string" || typeof descriptor.expires_at !== "string") {
      unreadable += 1;
      continue;
    }
    const expiry = Date.parse(descriptor.expires_at);
    if (!Number.isFinite(expiry)) {
      unreadable += 1;
      continue;
    }
    if (expiry <= now.getTime() || existsSync(path.join(library, `${id}.consumed.json`))) continue;
    candidates.push({ id, reviewedRevision: pins.reviewedRevision, expiresAt: new Date(expiry).toISOString(), expiry, workerLabel: typeof pins.workerLabel === "string" && pins.workerLabel ? pins.workerLabel : null });
  }
  if (unreadable > 0) unknown.push(`${unreadable} operator-script descriptor${unreadable === 1 ? "" : "s"} could not be read, so a waiting START card may be hidden`);
  if (candidates.length === 0) return { reasons: [], held: [] };

  const origin = deps.originMain();
  if (!origin) {
    unknown.push("the local origin/main revision could not be resolved, so waiting START cards cannot be matched");
    return { reasons: [], held: [] };
  }
  const reasons: RunWindowReason[] = [];
  const held: string[] = [];
  for (const card of candidates.filter((item) => item.reviewedRevision === origin)) {
    const hold = readStartCardHold(library, card.id);
    if (hold === "unreadable") {
      unknown.push(`START card ${card.id} hold marker could not be read, so the card is counted as waiting`);
    } else if (hold) {
      held.push(`START card ${card.id} is held: ${hold.reason} (${hold.evidence})`);
      continue;
    }
    reasons.push(waitingReason(card, origin, deps));
  }
  return { reasons, held };
}

function waitingReason(card: { id: string; expiresAt: string; workerLabel: string | null }, origin: string, deps: RunWindowDeps): RunWindowReason {
  // Preflight P2 refuses "worker job <label> has no running PID"; say so here instead of "ready to press" (Issue #2179).
  const down = card.workerLabel !== null && deps.workerRunning?.(card.workerLabel) === false;
  return {
    kind: "start_card_waiting",
    subject: card.id,
    until: card.expiresAt,
    pressable: !down,
    revision: origin,
    detail: down
      ? `START card ${card.id} is not pressable: worker ${card.workerLabel} has no running PID, so preflight P2 would refuse (see arcadia worker status and worker.log for a lost lock); it is pinned to origin/main ${origin.slice(0, 12)} and expires ${card.expiresAt}`
      : `START card ${card.id} is ready to press at origin/main ${origin.slice(0, 12)} and expires ${card.expiresAt}`
  };
}

/** Lines for the top of the text output. A closed window shows only held-card notes (empty when there are none). */
export function formatRunWindowLines(window: RunWindow): string[] {
  if (window.state === "closed") return window.held.slice();
  if (window.state === "unknown") return [`Run window: UNKNOWN (${window.unknown.join("; ")}).`, ...window.held];
  const cardWaiting = window.reasons.some((reason) => reason.kind === "start_card_waiting");
  const lines = [cardWaiting
    ? "Run window: OPEN. Do not merge to main now: it will make the waiting START card refuse."
    : "Run window: OPEN. A live run is in progress: follow docs/agent-guidance/rehearsal-freeze-window.md before merging."];
  for (const reason of window.reasons) {
    lines.push(`- ${reason.detail}${reason.until ? ` (until ${reason.until})` : ""}.`);
  }
  for (const item of window.held) lines.push(`- ${item}.`);
  for (const item of window.unknown) lines.push(`- Also unknown: ${item}.`);
  return lines;
}

/** A named refusal to merge to main, from `mergeFreezeRefusal`. */
export interface MergeFreezeRefusal {
  code: "start_card_waiting" | "run_window_unknown";
  message: string;
  /** Waiting unheld cards: id, pinned revision and expiry. Empty for an unknown window. */
  cards: Array<{ id: string; reviewedRevision: string; expiresAt: string }>;
}

/**
 * Pure merge check over an observed window. Refuses only for (a) an unheld, unexpired, unconsumed START card pinned to the
 * local origin/main, or (b) a window it cannot read (fail closed: a hidden card is worse than a stopped merge).
 * A window opened only by managed production Active stays advisory (Issue #2104); a governed-held card never refuses.
 * It reads nothing, writes nothing and grants no authority.
 */
export function mergeFreezeRefusal(window: RunWindow): MergeFreezeRefusal | null {
  const waiting = window.reasons.filter((reason) => reason.kind === "start_card_waiting");
  if (waiting.length > 0) {
    const cards = waiting.map((reason) => ({ id: reason.subject, reviewedRevision: reason.revision ?? "unknown", expiresAt: reason.until ?? "unknown" }));
    const named = cards.map((card) => `${card.id} (pinned to origin/main ${card.reviewedRevision.slice(0, 12)}, expires ${card.expiresAt})`).join("; ");
    return { code: "start_card_waiting", message: `Do not merge to main: START card ${named} is waiting and a merge would make its press refuse. Wait for it to be consumed or to expire, or hold it with arcadia start-run hold.`, cards };
  }
  if (window.state === "unknown" || window.unknown.length > 0) {
    return { code: "run_window_unknown", message: `Do not merge to main: the run window could not be read (${window.unknown.join("; ") || "state unknown"}), so a waiting START card may be hidden.`, cards: [] };
  }
  return null;
}

/**
 * `arcadia start-run hold`: write the governed hold marker for one waiting START card. It refuses a card that is missing,
 * consumed, expired or not a START card descriptor, and it never edits the card's own files. A hold grants nothing and
 * blocks nothing; it only stops the run window from counting the card as opening it.
 */
export function holdStartCard(
  library: string,
  id: string,
  input: { reason: string; evidence: string; heldBy: string; repository: string },
  now: Date
): StartCardHold {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw validationError("START card id must be a plain card name.");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw validationError("--reason is required and must be at most 500 characters.");
  const evidence = input.evidence.trim();
  const isUrl = /^https:\/\/\S+$/.test(evidence);
  const isRepoPath = !isUrl && !path.isAbsolute(evidence) &&!evidence.split(/[\\/]/).includes("..") && /^\S+$/.test(evidence);
  if (!isUrl && !isRepoPath) throw validationError("--evidence must be an https URL or a repository-relative path.");
  if (isRepoPath && !existsSync(path.join(input.repository, evidence))) throw validationError(`--evidence path ${evidence} does not exist in the repository.`);

  const descriptorPath = path.join(library, `${id}.json`);
  if (!existsSync(descriptorPath)) throw validationError(`START card ${id} is missing from the operator-script library.`);
  if (existsSync(path.join(library, `${id}.consumed.json`))) throw validationError(`START card ${id} is already consumed; nothing to hold.`);
  let descriptor: { startRun?: unknown; expires_at?: unknown };
  try {
    descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  } catch {
    throw validationError(`START card ${id} descriptor could not be read.`);
  }
  if (!descriptor?.startRun || typeof descriptor.expires_at !== "string" || !Number.isFinite(Date.parse(descriptor.expires_at))) {
    throw validationError(`START card ${id} is not a START card descriptor.`);
  }
  if (Date.parse(descriptor.expires_at) <= now.getTime()) throw validationError(`START card ${id} has expired; nothing to hold.`);

  const hold: StartCardHold = { schema: START_CARD_HOLD_SCHEMA, id, reason, evidence, heldAt: now.toISOString(), heldBy: input.heldBy };
  writeFileSync(path.join(library, `${id}.held.json`), `${JSON.stringify(hold, null, 2)}\n`);
  appendHoldHistory(library, id, { event: "held", at: hold.heldAt, by: hold.heldBy, reason, evidence });
  return hold;
}

/**
 * `arcadia start-run unhold`: remove only `<id>.held.json` and record the removal in `<id>.held-history.jsonl`.
 * It refuses when there is no marker. It never edits the card's own files.
 */
export function unholdStartCard(library: string, id: string, input: { reason: string; unheldBy: string }, now: Date): StartCardHold {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw validationError("START card id must be a plain card name.");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw validationError("--reason is required and must be at most 500 characters.");
  const markerPath = path.join(library, `${id}.held.json`);
  if (!existsSync(markerPath)) throw validationError(`START card ${id} has no hold marker to remove.`);
  const previous = readStartCardHold(library, id);
  if (previous === "unreadable" || previous === null) throw validationError(`START card ${id} hold marker could not be read; it was not removed.`);
  unlinkSync(markerPath);
  appendHoldHistory(library, id, { event: "unheld", at: now.toISOString(), by: input.unheldBy, reason, previousReason: previous.reason, previousEvidence: previous.evidence });
  return previous;
}

function appendHoldHistory(library: string, id: string, entry: Record<string, unknown>): void {
  appendFileSync(path.join(library, `${id}.held-history.jsonl`), `${JSON.stringify({ id, ...entry })}\n`);
}

function oneLine(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).replace(/\s+/g, " ").trim().slice(0, 160);
}
