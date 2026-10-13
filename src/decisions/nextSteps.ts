/**
 * The /todo "Next steps" list (#1284, Action todo-next-steps-route-to-forward).
 *
 * Operator directive, 2026-10-13: /todo always shows exactly what the operator must do to move production
 * forward, including the order in which pull requests must be merged. This module is pure: injected plain data
 * in, an ordered list of steps out. No clock, no randomness, no I/O, no commander, no database. It reads nothing
 * and grants nothing; the one click a step names is a plain link the operator follows.
 *
 * ORDERING RULE (tested):
 *  1. A pull request's stack parents come before it (parents derived from baseRef/headRef; the stack order
 *     comes from batchMerge.orderStack). A child never precedes its parent.
 *  2. Among steps whose parents are placed, lower rank first:
 *       rank 0  advances governance: touches PROJECT.md, the active Plan document, or the current Action's
 *               expected artifact path (a rename OUT of such a path counts); an answer/run card that unblocks
 *               the current Action.
 *       rank 1  unblocks a queued Action: touches a queued Action's expected artifact path, or a path listed
 *               in its dependencies (only entries that look like a repository path, i.e. contain "/", are
 *               matched; an Action-id dependency is NOT derived from a diff), or a card that unblocks one.
 *       rank 2  everything else.
 *  3. Ties by stack order (which is by PR number), then card id.
 *
 * A pull request is a takeable `merge` step only when it is not a draft, its head sha is a full hex sha equal to
 * any earlier pinned sha, its file list is complete (fetched count equals the PR's own changed-file count, as
 * batchMerge requires), it has an approving independent review at that head, every required check is green, it
 * is not conflicting, and its parent is not an open pull request. Otherwise it is a `wait` step that names what
 * it waits on (the parent step id, or the named check) and has NO click and NO link. Exactly one step is
 * `nowStep`: the first takeable step in order, computed over ALL pull requests before any display cap. When no
 * step is takeable the result is `{ moving: true, steps: [] }`: production is moving, nothing is asked.
 *
 * Reuses batchMerge's classifier (`classifyAuthorityPaths`, `normalizeAuthorityPath`), its readiness gate
 * (`assessPr`) and its stack order (`orderStack`); nothing is forked.
 */
import {
  assessPr,
  classifyAuthorityPaths,
  isPinnedHeadSha,
  isRepoSlug,
  normalizeAuthorityPath,
  orderStack,
  type AuthorityBoundary,
  type BatchFileEntry,
  type BatchPrCheck,
  type BatchPrFacts,
  type BatchPrReview,
} from "./batchMerge.js";
import { DEFAULT_CARD_REPO } from "./cardSources.js";
import type { DecisionCard } from "./card.js";

export const NEXT_STEPS_DEFAULT_CAP = 25;
const TITLE_MAX = 120;
const CHECK_MAX = 80;

/* --------------------------------- input -------------------------------- */

export interface NextStepsPr {
  number: number;
  title: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  isDraft: boolean;
  author?: string | null;
  files: ReadonlyArray<BatchFileEntry>;
  /** The PR's own changed-file count; the fetched list must equal it exactly. */
  changedFiles: number | null;
  reviews: ReadonlyArray<BatchPrReview>;
  checks: ReadonlyArray<BatchPrCheck>;
  requiredChecks: ReadonlyArray<string>;
  mergeStateStatus?: string | null;
  /**
   * Set by the reader when this pull request's facts could not be read; it is shown as a refused wait step,
   * never classified from the partial data.
   */
  unreadable?: string | null;
}

export interface NextStepsQueuedAction {
  actionId: string;
  expectedArtifact: string | null;
  dependencies: ReadonlyArray<string>;
}

export interface NextStepsQueue {
  /** The Action the active-Plan pointer rests on, or null when none is current. */
  currentActionId: string | null;
  currentExpectedArtifact?: string | null;
  /** Repository path of the active Plan document (for example docs/plans/x.md). */
  planPath: string | null;
  queued: ReadonlyArray<NextStepsQueuedAction>;
}

export interface NextStepsCard {
  id: string;
  verb: DecisionCard["verb"];
  kind: string;
  what: string;
  /** The Action this card unblocks, when the caller knows it. */
  unblocksActionId?: string | null;
}

export interface NextStepsInput {
  prs: ReadonlyArray<NextStepsPr>;
  queue?: NextStepsQueue | null;
  cards?: ReadonlyArray<NextStepsCard>;
  /** Head shas pinned in an earlier snapshot, by PR number; a different current head is refused visibly. */
  pinnedHeads?: Readonly<Record<number, string>> | null;
  trunk?: string;
  repo?: string;
  /** Most steps returned in `steps`; the rest are counted in `hidden`, never dropped silently. */
  cap?: number;
}

/* --------------------------------- output ------------------------------- */

export type NextStepKind = "merge" | "answer" | "run" | "wait";

export type NextStepWaitCode =
  | "duplicate_pr"
  | "bad_head_sha"
  | "head_moved"
  | "stack_cycle"
  | "base_pr_missing"
  | "ambiguous_base"
  | "parent_unmerged"
  | "draft"
  | "files_incomplete"
  | "review_missing"
  | "review_stale_head"
  | "review_not_approved"
  | "no_required_checks"
  | "check_failing"
  | "check_pending"
  | "merge_conflict"
  | "unreadable";

export interface NextStep {
  id: string;
  order: number;
  kind: NextStepKind;
  title: string;
  /** The exact words of the one click. Null for a wait step. */
  click: string | null;
  /** Where the click goes. Null for a wait step. */
  href: string | null;
  /** The head sha a merge step is pinned to (also shown, informationally, on a wait step); null for a card. */
  pinnedHeadSha: string | null;
  unblocks: string;
  /** The step this one waits on, when that is another step. */
  waitingOn: string | null;
  /** What a wait step waits on in words (a step, or a named check). Null unless kind is wait. */
  waitingFor: string | null;
  waitCode: NextStepWaitCode | null;
  authorityBoundaries: AuthorityBoundary[];
  reason: string;
}

export interface NextStepsResult {
  /** True when no step is takeable: production is moving and nothing is asked of the operator. */
  moving: boolean;
  nowStep: NextStep | null;
  /** Ordered steps, capped; always empty when `moving`. */
  steps: NextStep[];
  /** Steps beyond the cap that are not shown (the now step is always shown separately). */
  hidden: number;
  total: number;
  /** Unreadable pull-request or card inputs and cards of a verb this list does not carry. */
  ignored: number;
}

/* -------------------------------- helpers -------------------------------- */

// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/** Text for display: control and bidi characters removed, whitespace collapsed, bounded. Never HTML. */
export function safeText(value: unknown, max: number): string {
  const raw = typeof value === "string" ? value : "";
  const cleaned = raw.replace(UNSAFE_TEXT_RE, " ").replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

const isPrNumber = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const short = (sha: string): string => sha.slice(0, 7);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lower-cased normalised names of every path a file list touches, rename origins included. */
function touchedPaths(files: ReadonlyArray<BatchFileEntry>): string[] {
  const out: string[] = [];
  for (const entry of files) {
    const names: unknown[] =
      typeof entry === "string"
        ? [entry]
        : isRecord(entry)
          ? [entry.filename, ...(entry.previous_filename != null ? [entry.previous_filename] : [])]
          : [];
    for (const name of names) {
      const normalized = normalizeAuthorityPath(name);
      if (normalized !== null) out.push(normalized.toLowerCase());
    }
  }
  return out;
}

function matchesPath(touched: readonly string[], target: unknown): boolean {
  const normalized = normalizeAuthorityPath(typeof target === "string" ? target.replace(/\/+$/, "") : target);
  if (normalized === null) return false;
  const want = normalized.toLowerCase();
  return touched.some((p) => p === want || p.startsWith(`${want}/`));
}

interface Node {
  pr: NextStepsPr;
  parent: number | null;
  /** The parent number used for ordering (cycle members and unresolved bases are cut loose). */
  orderParent: number | null;
  forced: { code: NextStepWaitCode; text: string } | null;
  touched: string[];
  rank: 0 | 1 | 2;
  unblocks: string;
}

function isValidPr(p: unknown): p is NextStepsPr {
  return (
    isRecord(p) &&
    isPrNumber(p.number) &&
    typeof p.headRef === "string" &&
    typeof p.baseRef === "string" &&
    Array.isArray(p.files) &&
    Array.isArray(p.reviews) &&
    Array.isArray(p.checks) &&
    Array.isArray(p.requiredChecks)
  );
}

function classifyPriority(
  pr: NextStepsPr,
  touched: string[],
  queue: NextStepsQueue | null,
): { rank: 0 | 1 | 2; unblocks: string } {
  if (queue !== null) {
    if (matchesPath(touched, "PROJECT.md")) {
      return { rank: 0, unblocks: "Advances the active-Plan pointer: it changes PROJECT.md." };
    }
    if (queue.planPath !== null && matchesPath(touched, queue.planPath)) {
      return {
        rank: 0,
        unblocks:
          queue.currentActionId !== null
            ? `Changes the active Plan (${safeText(queue.planPath, 120)}), which settles or moves Action ${safeText(queue.currentActionId, 80)}.`
            : `Changes the active Plan (${safeText(queue.planPath, 120)}).`,
      };
    }
    if (queue.currentExpectedArtifact != null && matchesPath(touched, queue.currentExpectedArtifact)) {
      return {
        rank: 0,
        unblocks: `Delivers ${safeText(queue.currentExpectedArtifact, 120)}, the artifact that completes current Action ${safeText(queue.currentActionId, 80)}.`,
      };
    }
    for (const action of queue.queued) {
      const candidates = [action.expectedArtifact, ...action.dependencies.filter((d) => typeof d === "string" && d.includes("/"))];
      const hit = candidates.find((c) => c != null && matchesPath(touched, c));
      if (hit != null) {
        return { rank: 1, unblocks: `Delivers ${safeText(hit, 120)}, which queued Action ${safeText(action.actionId, 80)} needs.` };
      }
    }
  }
  return {
    rank: 2,
    unblocks: `Merges #${pr.number} into ${safeText(pr.baseRef, 80)}; no queued Action was derived as waiting on it.`,
  };
}

/** Per-PR parent derivation from baseRef/headRef. Unlike batchMerge's all-or-nothing form, one bad PR never hides the rest. */
function buildNodes(prs: NextStepsPr[], trunk: string, queue: NextStepsQueue | null): Map<number, Node> {
  const nodes = new Map<number, Node>();
  const duplicated = new Set<number>();
  for (const pr of prs) {
    if (nodes.has(pr.number)) {
      duplicated.add(pr.number);
      continue;
    }
    const touched = touchedPaths(pr.files);
    const { rank, unblocks } = classifyPriority(pr, touched, queue);
    nodes.set(pr.number, { pr, parent: null, orderParent: null, forced: null, touched, rank, unblocks });
  }
  const byHead = new Map<string, number[]>();
  for (const node of nodes.values()) {
    const list = byHead.get(node.pr.headRef) ?? [];
    list.push(node.pr.number);
    byHead.set(node.pr.headRef, list);
  }
  for (const node of nodes.values()) {
    if (duplicated.has(node.pr.number)) {
      node.forced = { code: "duplicate_pr", text: `Pull request number #${node.pr.number} appears more than once in the input, so none of them is offered.` };
    }
    if (typeof node.pr.unreadable === "string" && node.forced === null) {
      node.forced = { code: "unreadable", text: `Its facts could not be read (${safeText(node.pr.unreadable, 80)}), so it is not offered.` };
    }
    if (node.pr.baseRef === trunk) continue;
    const candidates = (byHead.get(node.pr.baseRef) ?? []).filter((n) => n !== node.pr.number);
    if (candidates.length === 1) {
      node.parent = candidates[0];
      node.orderParent = candidates[0];
    } else if (node.forced === null) {
      if (candidates.length === 0) {
        node.forced = {
          code: "base_pr_missing",
          text: `Its base branch ${safeText(node.pr.baseRef, 80)} is neither ${safeText(trunk, 40)} nor the head of an open pull request.`,
        };
      } else {
        node.forced = { code: "ambiguous_base", text: `Its base branch ${safeText(node.pr.baseRef, 80)} is the head of more than one open pull request.` };
      }
    }
  }
  // Cycle members (including a PR that is its own base): refused, and cut loose so ordering terminates.
  const state = new Map<number, 1 | 2>();
  for (const start of [...nodes.keys()].sort((a, b) => a - b)) {
    const path: number[] = [];
    let cursor: number | null = start;
    while (cursor !== null && !state.has(cursor)) {
      state.set(cursor, 1);
      path.push(cursor);
      cursor = nodes.get(cursor)?.parent ?? null;
    }
    if (cursor !== null && state.get(cursor) === 1 && path.includes(cursor)) {
      for (const member of path.slice(path.indexOf(cursor))) {
        const node = nodes.get(member)!;
        if (node.forced === null || node.forced.code !== "duplicate_pr") {
          node.forced = { code: "stack_cycle", text: "Its base and head branches form a cycle with other open pull requests." };
        }
        node.orderParent = null;
      }
    }
    for (const n of path) state.set(n, 2);
  }
  return nodes;
}

function checkState(pr: NextStepsPr, name: string): "green" | "pending" | "failing" {
  const rows = pr.checks.filter((c) => c.name === name);
  if (rows.length === 0) return "pending";
  const concl = rows.map((r) => (typeof r.conclusion === "string" ? r.conclusion.trim().toLowerCase() : ""));
  if (concl.every((c) => c === "success")) return "green";
  const settledBad = concl.some((c) => c !== "" && c !== "success" && c !== "pending" && c !== "queued" && c !== "in_progress" && c !== "expected");
  return settledBad ? "failing" : "pending";
}

/* --------------------------------- build -------------------------------- */

export function buildNextSteps(input: NextStepsInput): NextStepsResult {
  const trunk = typeof input.trunk === "string" && input.trunk !== "" ? input.trunk : "main";
  const repo = isRepoSlug(input.repo) ? input.repo : DEFAULT_CARD_REPO;
  const cap = Number.isSafeInteger(input.cap) && (input.cap as number) >= 1 ? (input.cap as number) : NEXT_STEPS_DEFAULT_CAP;
  const queue = input.queue ?? null;
  const pinnedHeads = input.pinnedHeads ?? null;

  let ignored = 0;
  const prs: NextStepsPr[] = [];
  for (const candidate of Array.isArray(input.prs) ? input.prs : []) {
    if (isValidPr(candidate)) prs.push(candidate);
    else ignored += 1;
  }
  const nodes = buildNodes(prs, trunk, queue);

  // Stack order from batchMerge: the deterministic tie-break among equal ranks.
  const stackInput = [...nodes.values()].map((n) => ({ number: n.pr.number, parent: n.orderParent }));
  const stack = orderStack(stackInput);
  const stackIndex = new Map<number, number>();
  if (stack.ok) stack.order.forEach((n, i) => stackIndex.set(n, i));
  else [...nodes.keys()].sort((a, b) => a - b).forEach((n, i) => stackIndex.set(n, i));

  type Placed = { rank: number; index: number; step: Omit<NextStep, "order"> };
  const placedSteps = new Map<number, Omit<NextStep, "order">>();

  const buildPrStep = (node: Node, parentStepId: string | null): Omit<NextStep, "order"> => {
    const pr = node.pr;
    const id = `pr-${pr.number}`;
    const shaOk = isPinnedHeadSha(pr.headSha);
    const boundaries = classifyAuthorityPaths(pr.files);
    const title = safeText(pr.title, TITLE_MAX) || `Pull request #${pr.number}`;
    const base = {
      id,
      kind: "wait" as const,
      title,
      click: null,
      href: null,
      pinnedHeadSha: shaOk ? pr.headSha : null,
      unblocks: node.unblocks,
      authorityBoundaries: boundaries,
    };
    const wait = (code: NextStepWaitCode, reason: string, waitingFor: string, waitingOn: string | null = null): Omit<NextStep, "order"> => ({
      ...base,
      waitingOn,
      waitingFor,
      waitCode: code,
      reason,
    });

    if (node.forced !== null) return wait(node.forced.code, node.forced.text, node.forced.text);
    if (!shaOk) return wait("bad_head_sha", "Its head sha is not a full 40-character hex sha, so it cannot be pinned.", "a valid head sha");
    const pinned = pinnedHeads?.[pr.number];
    if (pinned !== undefined && pinned !== pr.headSha) {
      const was = isPinnedHeadSha(pinned) ? short(pinned) : "an invalid sha";
      return wait("head_moved", `Stale: head moved from ${was} to ${short(pr.headSha)} since it was pinned; reload to pin the new head.`, "a fresh read of the new head");
    }
    if (parentStepId !== null) {
      const parent = node.parent as number;
      return wait("parent_unmerged", `Its stack parent #${parent} is not merged yet.`, `step ${parentStepId} (merge #${parent})`, parentStepId);
    }
    if (pr.isDraft === true) return wait("draft", "It is a draft; mark it ready for review.", "the author marking it ready for review");
    let facts: BatchPrFacts;
    try {
      facts = {
        number: pr.number,
        title,
        headSha: pr.headSha,
        baseRef: pr.baseRef,
        headRef: pr.headRef,
        author: pr.author ?? null,
        files: [...pr.files],
        changedFiles: pr.changedFiles,
        why: "",
        decisions: [],
        reviews: [...pr.reviews],
        checks: [...pr.checks],
        requiredChecks: [...pr.requiredChecks],
        state: "open",
      };
      const gate = assessPr(facts, { number: pr.number, headSha: pr.headSha, parent: null, acknowledgedBoundaries: boundaries });
      const codes = new Set(gate.refusals.map((r) => r.code));
      if (codes.has("files_incomplete")) {
        return wait(
          "files_incomplete",
          `Its file list is incomplete (fetched ${pr.files.length}, the PR reports ${String(pr.changedFiles)}), so its authority boundaries cannot be established.`,
          "a complete file list",
        );
      }
      if (codes.has("review_missing")) return wait("review_missing", "It has no independent review.", "an independent review");
      if (codes.has("review_stale_head")) return wait("review_stale_head", "Its only reviews are of an earlier head.", "an independent review of this head");
      if (codes.has("review_not_approved")) return wait("review_not_approved", "Its independent review at this head is not an approval.", "an approving independent review");
      if (codes.has("no_required_checks")) return wait("no_required_checks", "It names no required checks, so green cannot be established.", "required checks being reported");
      for (const name of pr.requiredChecks) {
        const state = checkState(pr, name);
        if (state === "green") continue;
        const label = safeText(name, CHECK_MAX);
        return state === "failing"
          ? wait("check_failing", `Required check ${label} is failing at ${short(pr.headSha)}.`, `required check ${label} to pass`)
          : wait("check_pending", `Required check ${label} has not finished at ${short(pr.headSha)}.`, `required check ${label} to finish`);
      }
      if (codes.has("check_not_green")) return wait("check_pending", "A required check is not green.", "required checks to pass");
    } catch {
      return wait("unreadable", "Its review or check facts could not be read.", "readable review and check facts");
    }
    if (typeof pr.mergeStateStatus === "string" && pr.mergeStateStatus.trim().toUpperCase() === "DIRTY") {
      return wait("merge_conflict", "It conflicts with its base branch; the author must resolve the conflict.", "the author resolving the merge conflict");
    }
    return {
      ...base,
      kind: "merge",
      click: `Merge #${pr.number} on GitHub`,
      href: `https://github.com/${repo}/pull/${pr.number}`,
      waitingOn: null,
      waitingFor: null,
      waitCode: null,
      reason: `Approved at ${short(pr.headSha)} with every required check green${
        boundaries.length > 0 ? `; touches ${boundaries.join(", ")}` : ""
      }.`,
    };
  };

  // Cards first-class: answer/run steps.
  const cardSteps: Placed[] = [];
  const seenCards = new Set<string>();
  for (const card of Array.isArray(input.cards) ? input.cards : []) {
    if (!isRecord(card) || typeof card.id !== "string" || card.id === "" || typeof card.what !== "string") {
      ignored += 1;
      continue;
    }
    if (card.verb !== "answer" && card.verb !== "run") {
      ignored += 1;
      continue;
    }
    if (seenCards.has(card.id)) {
      ignored += 1;
      continue;
    }
    seenCards.add(card.id);
    const unblocksId = typeof card.unblocksActionId === "string" && card.unblocksActionId !== "" ? card.unblocksActionId : null;
    const current = queue?.currentActionId ?? null;
    const rank: 0 | 1 | 2 = unblocksId !== null && unblocksId === current ? 0 : unblocksId !== null ? 1 : 2;
    const what = safeText(card.what, TITLE_MAX) || "Untitled card";
    cardSteps.push({
      rank,
      index: 1_000_000 + cardSteps.length,
      step: {
        id: `card-${card.id}`,
        kind: card.verb,
        title: what,
        click: card.verb === "answer" ? `Answer "${safeText(card.what, 60)}" on /todo` : `Run "${safeText(card.what, 60)}" on /todo`,
        href: `#card-${encodeURIComponent(card.id)}`,
        pinnedHeadSha: null,
        unblocks: unblocksId !== null ? `Unblocks Action ${safeText(unblocksId, 80)}.` : "Clears this item from the queue; no waiting Action was derived.",
        waitingOn: null,
        waitingFor: null,
        waitCode: null,
        authorityBoundaries: [],
        reason: `${card.verb === "answer" ? "Open Decision" : "Operator script"} card (${safeText(card.kind, 40)}).`,
      },
    });
  }

  // Priority-topological placement over the PRs.
  const remaining = new Set(nodes.keys());
  const ordered: Array<Omit<NextStep, "order">> = [];
  const prSteps: Placed[] = [];
  while (remaining.size > 0) {
    let best: Node | null = null;
    for (const n of remaining) {
      const node = nodes.get(n)!;
      if (node.orderParent !== null && remaining.has(node.orderParent)) continue;
      if (
        best === null ||
        node.rank < best.rank ||
        (node.rank === best.rank && (stackIndex.get(n) ?? 0) < (stackIndex.get(best.pr.number) ?? 0))
      ) {
        best = node;
      }
    }
    if (best === null) break; // unreachable: cycles are cut loose; every remaining node has an unplaced parent otherwise
    remaining.delete(best.pr.number);
    const parentStep = best.parent !== null ? placedSteps.get(best.parent) : undefined;
    const step = buildPrStep(best, parentStep ? parentStep.id : null);
    placedSteps.set(best.pr.number, step);
    prSteps.push({ rank: best.rank, index: prSteps.length, step });
  }

  // Merge the PR sequence and the card sequence by (rank, original sequence). PR order already honours
  // parents; cards have no parents, so a stable merge keeps every parent before its child.
  const merged: Placed[] = [];
  let i = 0;
  let j = 0;
  const cards = [...cardSteps].sort((a, b) => a.rank - b.rank || a.index - b.index);
  while (i < prSteps.length || j < cards.length) {
    const a = prSteps[i];
    const b = cards[j];
    if (a !== undefined && (b === undefined || a.rank <= b.rank)) {
      merged.push(a);
      i += 1;
    } else if (b !== undefined) {
      merged.push(b);
      j += 1;
    }
  }
  for (const p of merged) ordered.push(p.step);

  const numbered: NextStep[] = ordered.map((s, idx) => ({ ...s, order: idx + 1 }));
  const nowStep = numbered.find((s) => s.kind !== "wait") ?? null;
  if (nowStep === null) {
    return { moving: true, nowStep: null, steps: [], hidden: 0, total: 0, ignored };
  }
  const shown = numbered.slice(0, cap);
  const nowShown = shown.some((s) => s.id === nowStep.id);
  return {
    moving: false,
    nowStep,
    steps: shown,
    hidden: numbered.length - shown.length - (nowShown ? 0 : 1),
    total: numbered.length,
    ignored,
  };
}
