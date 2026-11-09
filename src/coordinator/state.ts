import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { validationError } from "../cli/errors.js";
import { ensureCoordinatorDirectories, type CoordinatorPaths } from "./paths.js";

/**
 * The coordinator-owned part of the capsule (design section b): its journal of
 * judgements, its next move, its watcher subscriptions, chat-only approvals it
 * has named as "will not carry", and the PRs it touched. Everything else in the
 * capsule is derived by the relay from canonical sources on each refresh. This
 * file is data, never authority.
 */
export const JOURNAL_LIMIT = 20;
export const NOTE_MAX_CHARS = 500;
export const JOURNAL_STALE_MS = 2 * 60 * 60 * 1000;

export interface JournalEntry { at: string; text: string; generation: number | null }
export interface Subscription {
  command: string;
  cursor: string;
  armedAt: string;
  /** The generation that (re-)armed it; null when armed by a caller with no coordinator identity. */
  armedByGeneration: number | null;
  /**
   * True for a subscription copied from a predecessor's snapshot that no
   * process of this generation has armed. Only an explicit `subscribe
   * "<command>" --cursor <c>` by the generation that runs the watcher clears it.
   */
  inherited?: boolean;
}
export interface ChatOnlyApproval { at: string; text: string; generation: number | null }

export interface CoordinatorState {
  journal: JournalEntry[];
  nextMove: JournalEntry | null;
  subscriptions: Subscription[];
  chatOnlyApprovals: ChatOnlyApproval[];
  prs: number[];
}

export function emptyState(): CoordinatorState {
  return { journal: [], nextMove: null, subscriptions: [], chatOnlyApprovals: [], prs: [] };
}

export function readCoordinatorState(paths: CoordinatorPaths): CoordinatorState {
  if (!existsSync(paths.state)) return emptyState();
  const parsed = JSON.parse(readFileSync(paths.state, "utf8")) as Partial<CoordinatorState>;
  return { ...emptyState(), ...parsed };
}

/** Atomic replace (temporary file, then rename); callers hold the relay lock. */
export function writeCoordinatorState(paths: CoordinatorPaths, state: CoordinatorState): void {
  ensureCoordinatorDirectories(paths);
  const temporary = `${paths.state}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, paths.state);
}

export function normalizeNoteText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") throw validationError("A coordinator note needs text.", { reason: "empty_note" });
  if (normalized.length > NOTE_MAX_CHARS) {
    throw validationError(`A coordinator note is at most ${NOTE_MAX_CHARS} characters; put detail in a PR or Issue and reference it.`, { reason: "note_too_long" });
  }
  return normalized;
}

export function parsePrNumbers(values: string[] = []): number[] {
  return values.map((value) => {
    const number = Number(value.replace(/^#/, ""));
    if (!Number.isInteger(number) || number <= 0) throw validationError(`--pr must be a pull request number, not "${value}".`, { reason: "invalid_pr" });
    return number;
  });
}

export function appendJournal(state: CoordinatorState, entry: JournalEntry): CoordinatorState {
  const journal = [...state.journal, entry];
  return { ...state, journal: journal.slice(Math.max(0, journal.length - JOURNAL_LIMIT)) };
}

/** What the watcher checks need from a snapshot (a `Capsule` satisfies it). */
export interface SnapshotWatchers { observedAt: string; subscriptions: Array<{ command: string; cursor: string }> }

/** A subscription counts as registered by `generation` only when that generation registered it, after the snapshot, and it is no longer flagged inherited. */
function registeredBy(have: Subscription, generation: number, snapshot: SnapshotWatchers): boolean {
  return !have.inherited && have.armedByGeneration === generation && Date.parse(have.armedAt) >= Date.parse(snapshot.observedAt);
}

/**
 * Every watcher the successor owes, fail closed (#2286 gate 1): each one the
 * snapshot lists plus each one the state file holds now. A watcher the
 * predecessor registered after the snapshot is in the state but not in the
 * snapshot; it is reported with `late: true` and verify and accept refuse until
 * the successor registers it too. "Registered" is a record, never proof that a
 * process is running (design change 5).
 */
export function unregisteredWatchers(snapshot: SnapshotWatchers, state: CoordinatorState, generation: number): Array<{ command: string; late: boolean }> {
  const wanted = new Map<string, boolean>();
  for (const subscription of snapshot.subscriptions) wanted.set(subscription.command, false);
  for (const subscription of state.subscriptions) if (!wanted.has(subscription.command)) wanted.set(subscription.command, true);
  return [...wanted]
    .filter(([command]) => !state.subscriptions.some((have) => have.command === command && registeredBy(have, generation, snapshot)))
    .map(([command, late]) => ({ command, late }));
}

/**
 * Cursor rule (#2286 gate 3). Cursors are opaque event positions with no
 * defined order, so Arcadia can tell only "same" from "different", and a
 * successor that resumes later legitimately holds a different one. Refusing a
 * difference would stick that handoff, and accepting it silently hides a
 * possible gap (or replay). So a difference never refuses: it is reported as a
 * warning naming both cursors, for the successor to state in its first message.
 */
export function cursorChanges(snapshot: SnapshotWatchers, state: CoordinatorState, generation: number): Array<{ command: string; from: string; to: string }> {
  const changes: Array<{ command: string; from: string; to: string }> = [];
  for (const wanted of snapshot.subscriptions) {
    const have = state.subscriptions.find((candidate) => candidate.command === wanted.command && registeredBy(candidate, generation, snapshot));
    if (have && have.cursor !== wanted.cursor) changes.push({ command: wanted.command, from: wanted.cursor, to: have.cursor });
  }
  return changes;
}
