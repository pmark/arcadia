/**
 * The /todo "Next steps" list (#1284, Action todo-next-steps-route-to-forward).
 *
 * Operator directive, 2026-10-13: /todo always shows exactly what the operator must do to move production
 * forward, including the order in which pull requests must be merged. This module is pure: injected plain data
 * in, an ordered list of steps out. No clock, no randomness, no I/O, no commander, no database. It reads nothing
 * and grants nothing; the one click a step names is a plain link the operator follows. The pinned head sha is a
 * display and verification aid: the GitHub merge page is the guard that actually refuses a moved head.
 *
 * ORDERING RULE (tested):
 *  1. A pull request's stack parents come before it (parents derived from baseRef/headRef, matched on head
 *     repository + ref so a fork branch never becomes a parent; the stack order comes from batchMerge.orderStack).
 *  2. Among steps whose parents are placed, lower EFFECTIVE rank first. A node's effective rank is the minimum of
 *     its own rank and the ranks of descendants that would be takeable once their parent merges (priority
 *     inheritance; a draft, conflicted, failing-check, unreviewed or unreadable child keeps its own blocker
 *     visible and promotes nothing), so a parent that unlocks a pointer-advancing child is ordered ahead of
 *     unrelated pull requests, and its step says so. Own ranks:
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
 * batchMerge requires), it has an approving independent review at that head, every required check is green
 * (SKIPPED and NEUTRAL count as green, as on GitHub), its merge state is CLEAN, HAS_HOOKS or UNSTABLE (only
 * non-required checks failing; the click carries that note), and its parent is not an open pull request. Its own
 * blockers are named before "parent not merged". Otherwise it is a `wait` step
 * that names what it waits on and has NO click and NO link.
 *
 * Result `state` is a closed union and the only thing a UI may say production's status from:
 *   now          a takeable step exists (`nowStep`, the first takeable in order, over ALL pull requests).
 *   unavailable  no takeable step and a source could not be read (or a pull request's facts were unreadable);
 *                names which. Never "moving".
 *   waiting      no takeable step, no unread source, but wait steps exist: every one is listed.
 *   moving       zero steps AND every source was read.
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
const WAITING_AHEAD_MAX = 5;

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
  /** GitHub's mergeStateStatus from the same fresh read as headSha; only CLEAN and HAS_HOOKS are takeable. */
  mergeStateStatus?: string | null;
  /** owner/name of the head repository; a fork's head ref is never matched as a stack parent. Null means the base repo. */
  headRepo?: string | null;
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

/** What a reader may fail to read; any of them blocks "moving". */
export type NextStepsSource = "prs" | "queue" | "cards" | "checks";

export interface NextStepsInput {
  prs: ReadonlyArray<NextStepsPr>;
  queue?: NextStepsQueue | null;
  /** Absent (undefined or null) is an unread source; an empty array is a successful read of no cards. */
  cards?: ReadonlyArray<NextStepsCard> | null;
  /** Head shas pinned in an earlier snapshot, by PR number; a different current head is refused visibly. */
  pinnedHeads?: Readonly<Record<number, string>> | null;
  trunk?: string;
  repo?: string;
  /** Most steps returned in `steps`; the rest are counted in `hidden`, never dropped silently. */
  cap?: number;
  /** Sources the caller could not read. */
  unavailable?: ReadonlyArray<NextStepsSource>;
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
  | "merge_state_not_clean"
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
  /** Own priority rank (0 advances governance, 1 unblocks a queued Action, 2 other). */
  rank: 0 | 1 | 2;
}

export type NextStepsState = "now" | "waiting" | "moving" | "unavailable";

export interface NextStepsResult {
  state: NextStepsState;
  nowStep: NextStep | null;
  /** Ordered steps, capped. Wait steps are always listed; only `moving` has none. */
  steps: NextStep[];
  /** Steps beyond the cap that are not shown (the now step is always shown separately). */
  hidden: number;
  total: number;
  /** Unreadable pull-request or card inputs and cards of a verb this list does not carry. */
  ignored: number;
  /** Invalid pull-request entries among `ignored`; any makes `prs` unavailable. */
  invalidPrs: number;
  /** Sources that could not be read (including pull requests whose facts were unreadable). */
  unavailable: NextStepsSource[];
  /** Higher-priority pull requests that are waiting, said in words next to the now step. */
  waitingAhead: string[];
  /** State `waiting` only: "Nothing for you to click; waiting on <named>". */
  waitingSummary: string | null;
}

/* -------------------------------- helpers -------------------------------- */

// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/** Text for display: control and bidi characters removed, whitespace collapsed, bounded. Never HTML. */
export function safeText(value: unknown, max: number): string {
  const raw = typeof value === "string" ? value : "";
  const cleaned = raw.replace(UNSAFE_TEXT_RE, " ").replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}\u2026`;
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
  /** Effective rank: min of own and all descendants' ranks. */
  effRank: 0 | 1 | 2;
  /** The descendant whose rank this node inherits, when lower than its own. */
  inheritedFrom: number | null;
  /** What this node's own rank means, in words; empty at rank 2. */
  phrase: string;
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
): { rank: 0 | 1 | 2; unblocks: string; phrase: string } {
  if (queue !== null) {
    if (matchesPath(touched, "PROJECT.md")) {
      return { rank: 0, phrase: "advances the active-Plan pointer", unblocks: "Advances the active-Plan pointer: it changes PROJECT.md." };
    }
    if (queue.planPath !== null && matchesPath(touched, queue.planPath)) {
      return {
        rank: 0,
        phrase: "changes the active Plan",
        unblocks:
          queue.currentActionId !== null
            ? `Changes the active Plan (${safeText(queue.planPath, 120)}), which settles or moves Action ${safeText(queue.currentActionId, 80)}.`
            : `Changes the active Plan (${safeText(queue.planPath, 120)}).`,
      };
    }
    if (queue.currentExpectedArtifact != null && matchesPath(touched, queue.currentExpectedArtifact)) {
      return {
        rank: 0,
        phrase: "delivers the current Action's artifact",
        unblocks: `Delivers ${safeText(queue.currentExpectedArtifact, 120)}, the artifact that completes current Action ${safeText(queue.currentActionId, 80)}.`,
      };
    }
    for (const action of queue.queued) {
      const candidates = [action.expectedArtifact, ...action.dependencies.filter((d) => typeof d === "string" && d.includes("/"))];
      const hit = candidates.find((c) => c != null && matchesPath(touched, c));
      if (hit != null) {
        return {
          rank: 1,
          phrase: `delivers an artifact queued Action ${safeText(action.actionId, 80)} needs`,
          unblocks: `Delivers ${safeText(hit, 120)}, which queued Action ${safeText(action.actionId, 80)} needs.`,
        };
      }
    }
  }
  return {
    rank: 2,
    phrase: "",
    unblocks: `Merges #${pr.number} into ${safeText(pr.baseRef, 80)}; no queued Action was derived as waiting on it.`,
  };
}

const sameRepo = (headRepo: string | null | undefined, repo: string): boolean =>
  typeof headRepo !== "string" || headRepo.trim() === "" || headRepo.trim().toLowerCase() === repo.toLowerCase();

/** Per-PR parent derivation from baseRef/headRef. Unlike batchMerge's all-or-nothing form, one bad PR never hides the rest. */
function buildNodes(prs: NextStepsPr[], trunk: string, repo: string, queue: NextStepsQueue | null): Map<number, Node> {
  const nodes = new Map<number, Node>();
  const duplicated = new Set<number>();
  for (const pr of prs) {
    if (nodes.has(pr.number)) {
      duplicated.add(pr.number);
      continue;
    }
    const touched = touchedPaths(pr.files);
    const { rank, unblocks, phrase } = classifyPriority(pr, touched, queue);
    nodes.set(pr.number, { pr, parent: null, orderParent: null, forced: null, touched, rank, effRank: rank, inheritedFrom: null, phrase, unblocks });
  }
  // Only a branch in the base repository can be a stack parent: head repository + ref, never the ref alone.
  const byHead = new Map<string, number[]>();
  for (const node of nodes.values()) {
    if (!sameRepo(node.pr.headRepo, repo)) continue;
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

/**
 * Effective rank = min(own, ranks of descendants that can actually become takeable once their parent merges).
 * A child contributes only when `eligible` has it (its own blocker, ignoring the stack parent, is none); a
 * draft, conflicted, failing, unreviewed or unreadable child keeps its own blocker and promotes nothing.
 * `orderParent` links are acyclic, so a memoised walk terminates.
 */
function inheritRanks(nodes: Map<number, Node>, eligible: ReadonlySet<number>): void {
  const children = new Map<number, number[]>();
  for (const node of nodes.values()) {
    if (node.orderParent === null) continue;
    const list = children.get(node.orderParent) ?? [];
    list.push(node.pr.number);
    children.set(node.orderParent, list);
  }
  const done = new Set<number>();
  const visit = (n: number): void => {
    if (done.has(n)) return;
    done.add(n);
    const node = nodes.get(n)!;
    for (const c of [...(children.get(n) ?? [])].sort((a, b) => a - b)) {
      visit(c);
      const child = nodes.get(c)!;
      if (eligible.has(c) && child.effRank < node.effRank) {
        node.effRank = child.effRank;
        node.inheritedFrom = child.inheritedFrom ?? c;
      }
    }
  };
  for (const n of [...nodes.keys()].sort((a, b) => a - b)) visit(n);
}

function checkState(pr: NextStepsPr, name: string): "green" | "pending" | "failing" {
  const rows = pr.checks.filter((c) => c.name === name);
  if (rows.length === 0) return "pending";
  const concl = rows.map((r) => (typeof r.conclusion === "string" ? r.conclusion.trim().toLowerCase() : ""));
  // GitHub counts a SKIPPED or NEUTRAL required check as passing, so this module does too. batchMerge's isGreen
  // accepts only SUCCESS and is deliberately left unchanged; the divergence is confined to this readiness view.
  if (concl.every((c) => c === "success" || c === "skipped" || c === "neutral")) return "green";
  const settledBad = concl.some((c) => c !== "" && c !== "success" && c !== "pending" && c !== "queued" && c !== "in_progress" && c !== "expected");
  return settledBad ? "failing" : "pending";
}

/** Review states at the pinned head, named, so a COMMENTED review beside an APPROVED one is visible. */
function reviewStatesAtHead(pr: NextStepsPr): string {
  const rows = pr.reviews
    .filter((r) => r.headSha === pr.headSha)
    .map((r) => `${safeText(r.verdict, 30).toUpperCase() || "UNKNOWN"} by ${safeText(r.author ?? "an unknown reviewer", 40)}`);
  return rows.length === 0 ? "none at this head" : rows.join(", ");
}

/** Each non-clean merge state names its real cause and what ends it; none says merely "waiting on GitHub". */
const MERGE_STATE_TEXT: Record<string, { named: string; waitingFor: string }> = {
  BLOCKED: {
    named:
      "GitHub blocks the merge although the review and required checks read here are satisfied; a branch-protection rule this list does not read (for example a code-owner review or an unresolved conversation) is unmet. Open the pull request: GitHub names it",
    waitingFor: "the branch-protection requirement GitHub names on the pull request page",
  },
  BEHIND: {
    named: "its branch is behind its base branch and must be updated (merge or rebase the base in) before it can merge",
    waitingFor: "the branch being updated with its base branch",
  },
  UNKNOWN: {
    named: "GitHub has not finished computing the merge state; it resolves on its own, reload in a moment",
    waitingFor: "GitHub finishing its merge-state computation (it resolves by itself)",
  },
};

/** Names of checks that completed badly and are not required (what makes GitHub report UNSTABLE). */
function nonRequiredFailures(pr: NextStepsPr): string[] {
  const required = new Set(pr.requiredChecks);
  const names = new Set<string>();
  for (const check of pr.checks) {
    if (required.has(check.name)) continue;
    const c = typeof check.conclusion === "string" ? check.conclusion.trim().toLowerCase() : "";
    if (c !== "" && !["success", "skipped", "neutral", "pending", "queued", "in_progress", "expected"].includes(c)) {
      names.add(safeText(check.name, CHECK_MAX) || "an unnamed check");
    }
  }
  return [...names].sort();
}

/** Inventory older than this is never read as "moving" (applied by the loader and the route's cache). */
export const INVENTORY_MAX_AGE_SECONDS = 60;

/* --------------------------------- build -------------------------------- */

export function buildNextSteps(input: NextStepsInput): NextStepsResult {
  const trunk = typeof input.trunk === "string" && input.trunk !== "" ? input.trunk : "main";
  const repo = isRepoSlug(input.repo) ? input.repo : DEFAULT_CARD_REPO;
  const cap = Number.isSafeInteger(input.cap) && (input.cap as number) >= 1 ? (input.cap as number) : NEXT_STEPS_DEFAULT_CAP;
  const queue = input.queue ?? null;
  const pinnedHeads = input.pinnedHeads ?? null;

  let ignored = 0;
  let invalidPrs = 0;
  const prs: NextStepsPr[] = [];
  for (const candidate of Array.isArray(input.prs) ? input.prs : []) {
    if (isValidPr(candidate)) prs.push(candidate);
    else {
      ignored += 1;
      invalidPrs += 1;
    }
  }
  if (!Array.isArray(input.prs)) invalidPrs += 1;
  const nodes = buildNodes(prs, trunk, repo, queue);

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
    const unblocks =
      node.inheritedFrom !== null
        ? `Merging #${pr.number} unlocks #${node.inheritedFrom}, which ${nodes.get(node.inheritedFrom)?.phrase ?? "ranks higher"}.`
        : node.unblocks;
    const base = {
      id,
      kind: "wait" as const,
      title,
      click: null,
      href: null,
      pinnedHeadSha: shaOk ? pr.headSha : null,
      unblocks,
      authorityBoundaries: boundaries,
      rank: node.rank,
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
    // The pull request's own blockers come first and are never masked by "parent not merged": the parent check
    // is last (below). A call with parentStepId null is the intrinsic read used to decide rank inheritance.
    if (pr.isDraft === true) return wait("draft", "It is a draft; mark it ready for review.", "the author marking it ready for review");
    try {
      const facts: BatchPrFacts = {
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
      if (codes.has("review_not_approved")) {
        return wait(
          "review_not_approved",
          `Its reviews at this head are not all approvals (${reviewStatesAtHead(pr)}).`,
          "an approving independent review",
        );
      }
      // A stacked child's base is not the trunk, so no required checks are configured for it: its checks
      // are judged after it retargets, so this is not a blocker of its own (it stays parent_unmerged).
      if (codes.has("no_required_checks") && node.parent === null) return wait("no_required_checks", "It names no required checks, so green cannot be established.", "required checks being reported");
      for (const name of pr.requiredChecks) {
        const state = checkState(pr, name);
        if (state === "green") continue;
        const label = safeText(name, CHECK_MAX);
        return state === "failing"
          ? wait("check_failing", `Required check ${label} is failing at ${short(pr.headSha)}.`, `required check ${label} to pass on #${pr.number}`)
          : wait("check_pending", `Required check ${label} has not finished at ${short(pr.headSha)}.`, `required check ${label} to finish on #${pr.number}`);
      }
    } catch {
      return wait("unreadable", "Its review or check facts could not be read.", "readable review and check facts");
    }
    const mergeState = typeof pr.mergeStateStatus === "string" ? pr.mergeStateStatus.trim().toUpperCase() : "";
    if (mergeState === "DIRTY") {
      return wait("merge_conflict", "It conflicts with its base branch; the author must resolve the conflict.", "the author resolving the merge conflict");
    }
    // UNSTABLE means only non-required checks fail (the required ones were checked above): GitHub allows the merge.
    if (mergeState !== "CLEAN" && mergeState !== "HAS_HOOKS" && mergeState !== "UNSTABLE") {
      if (mergeState === "") {
        return wait("merge_state_not_clean", "GitHub did not report a merge state for this pull request, so it cannot be offered.", "a readable merge state");
      }
      const known = MERGE_STATE_TEXT[mergeState];
      return wait(
        "merge_state_not_clean",
        `Merge state is ${mergeState}: ${known?.named ?? `GitHub reports a merge state this list does not know (${safeText(mergeState, 30)})`}.`,
        known?.waitingFor ?? `the merge state ${safeText(mergeState, 30)} to be explained on the pull request page`,
      );
    }
    if (parentStepId !== null) {
      const parent = node.parent as number;
      return wait("parent_unmerged", `Its stack parent #${parent} is not merged yet.`, `step ${parentStepId} (merge #${parent})`, parentStepId);
    }
    const failing = mergeState === "UNSTABLE" ? nonRequiredFailures(pr) : [];
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
      }${
        mergeState === "UNSTABLE"
          ? `; a non-required check is failing: ${failing.length > 0 ? failing.join(", ") : "name not reported"}`
          : ""
      }.`,
    };
  };

  // Rank inheritance only from children that would be takeable once their parent merges.
  const eligible = new Set<number>();
  for (const node of nodes.values()) {
    if (buildPrStep(node, null).kind === "merge") eligible.add(node.pr.number);
  }
  inheritRanks(nodes, eligible);

  // Cards: answer/run steps.
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
        rank,
      },
    });
  }

  // Priority-topological placement over the PRs, by effective rank.
  const remaining = new Set(nodes.keys());
  const prSteps: Placed[] = [];
  while (remaining.size > 0) {
    let best: Node | null = null;
    for (const n of remaining) {
      const node = nodes.get(n)!;
      if (node.orderParent !== null && remaining.has(node.orderParent)) continue;
      if (
        best === null ||
        node.effRank < best.effRank ||
        (node.effRank === best.effRank && (stackIndex.get(n) ?? 0) < (stackIndex.get(best.pr.number) ?? 0))
      ) {
        best = node;
      }
    }
    if (best === null) break; // unreachable: cycles are cut loose
    remaining.delete(best.pr.number);
    const parentStep = best.parent !== null ? placedSteps.get(best.parent) : undefined;
    const step = buildPrStep(best, parentStep ? parentStep.id : null);
    placedSteps.set(best.pr.number, step);
    prSteps.push({ rank: best.effRank, index: prSteps.length, step });
  }

  // Merge the PR sequence and the card sequence by (rank, sequence); PR order already honours parents.
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

  const numbered: NextStep[] = merged.map((p, idx) => ({ ...p.step, order: idx + 1 }));
  const nowStep = numbered.find((s) => s.kind !== "wait") ?? null;

  const unavailable: NextStepsSource[] = [...new Set(input.unavailable ?? [])].sort();
  const markUnread = (source: NextStepsSource): void => {
    if (!unavailable.includes(source)) {
      unavailable.push(source);
      unavailable.sort();
    }
  };
  if (prs.some((p) => typeof p.unreadable === "string")) markUnread("checks");
  // An invalid pull-request entry may be a real one the reader could not shape: never "moving" past it.
  if (invalidPrs > 0) markUnread("prs");
  // An absent queue or card input is an unread source, distinct from a read-empty one.
  if (input.queue === undefined || input.queue === null) markUnread("queue");
  if (!Array.isArray(input.cards)) markUnread("cards");

  // Higher-priority pull requests that are waiting (and are not just the now step's own descendants).
  const waitingAhead: string[] = [];
  if (nowStep !== null) {
    const nowNumber = /^pr-(\d+)$/.exec(nowStep.id)?.[1];
    const descendsFromNow = (n: number): boolean => {
      let cursor: number | null = nodes.get(n)?.parent ?? null;
      const seen = new Set<number>();
      while (cursor !== null && !seen.has(cursor)) {
        if (String(cursor) === nowNumber) return true;
        seen.add(cursor);
        cursor = nodes.get(cursor)?.parent ?? null;
      }
      return false;
    };
    for (const step of numbered) {
      if (waitingAhead.length >= WAITING_AHEAD_MAX) break;
      const m = /^pr-(\d+)$/.exec(step.id);
      if (step.kind !== "wait" || m === null || step.rank >= nowStep.rank) continue;
      const n = Number(m[1]);
      // The now step's own children that merely wait on it are covered by its "unlocks" text; a child with a
      // real blocker of its own is named here.
      if (step.waitCode === "parent_unmerged" && descendsFromNow(n)) continue;
      const phrase = nodes.get(n)?.phrase ?? "";
      waitingAhead.push(`#${n} ${phrase !== "" ? `${phrase} ` : "ranks higher "}but is waiting on ${step.waitingFor ?? "something"}.`);
    }
  }

  const state: NextStepsState =
    nowStep !== null ? "now" : unavailable.length > 0 ? "unavailable" : numbered.length > 0 ? "waiting" : "moving";
  const waitingSummary =
    state === "waiting"
      ? `Nothing for you to click; waiting on ${numbered[0].waitingFor ?? "something"}${numbered.length > 1 ? ` (and ${numbered.length - 1} more)` : ""}.`
      : null;

  const shown = numbered.slice(0, cap);
  const nowShown = nowStep === null || shown.some((s) => s.id === nowStep.id);
  return {
    state,
    nowStep,
    steps: shown,
    hidden: numbered.length - shown.length - (nowShown ? 0 : 1),
    total: numbered.length,
    ignored,
    invalidPrs,
    unavailable,
    waitingAhead,
    waitingSummary,
  };
}
