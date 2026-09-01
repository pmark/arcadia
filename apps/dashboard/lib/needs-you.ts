import type { AgentQueueEntry, DashboardAttentionItem, DashboardReviewFocus, DashboardReviewItem } from "./types";

export type AttentionCost = "short" | "medium" | "long";

export interface NeedsYouReason {
  label: string;
  detail: string;
}

export interface RankedNeedsYouItem {
  item: DashboardAttentionItem;
  reasons: NeedsYouReason[];
  attentionCost: AttentionCost;
  tokenImpact: string | null;
  tokenBudget: string | null;
}

export interface ExcludedNeedsYouItem {
  item: DashboardAttentionItem;
  exclusionReason: string;
}

export interface NeedsYouBoard {
  dominant: RankedNeedsYouItem | null;
  queue: RankedNeedsYouItem[];
  excluded: ExcludedNeedsYouItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORICAL_ATTENTION_DAYS = 30;

const CLARIFICATION_COST: Record<string, AttentionCost> = {
  ActionClarification: "short",
  CodexPlanningRunApproval: "medium",
  CodexPlanningRetryApproval: "medium",
  CodexPlanningArtifactAcceptance: "long"
};

/**
 * "Deterministic repair" per the board's acceptance criteria: a blocked_work
 * item's blockers name a remedy Arcadia (or an agent) can apply directly, so
 * it never required operator judgment in the first place. Everything else
 * buildAttentionItems() surfaces (review, codex_packet, run) is an operator
 * decision by construction -- reviews and packets grant execution authority,
 * and the runs here already failed or are flagged isRequiresReviewStatus.
 */
function exclusionReasonFor(
  item: DashboardAttentionItem,
  age: number,
  currentActionIds: Set<string>,
  representedRunIds: Set<string>
): string | null {
  if (item.kind === "blocked_work") {
    return "Deterministic repair to Arcadia's control documents -- not an operator decision.";
  }

  if (item.kind === "run" && item.relatedRunId && representedRunIds.has(item.relatedRunId)) {
    return "The Run's open Review already carries the operator Decision.";
  }

  if (item.kind === "run" && item.status !== "failed" && item.relatedReviewId) {
    return "The Run's linked Review is the canonical Decision record; the Run remains available in history.";
  }

  if (
    (item.kind === "codex_packet" || item.kind === "run") &&
    age >= HISTORICAL_ATTENTION_DAYS &&
    (!item.actionId || !currentActionIds.has(item.actionId))
  ) {
    const label = item.kind === "codex_packet" ? "packet" : "Run";
    return `Historical ${label} from ${Math.floor(age)} days ago for an Action that is not current.`;
  }

  return null;
}

function duplicateKey(item: DashboardAttentionItem): string | null {
  if ((item.kind !== "codex_packet" && item.kind !== "run") || !item.actionId) {
    return null;
  }

  return `${item.kind}:${item.projectId ?? "unassigned"}:${item.actionId}`;
}

function attentionCostFor(item: DashboardAttentionItem, reviewByReviewId: Map<string, DashboardReviewItem>): AttentionCost {
  if (item.kind === "review" && item.relatedReviewId) {
    const review = reviewByReviewId.get(item.relatedReviewId);
    if (review) {
      return CLARIFICATION_COST[review.resolvedIntent] ?? "medium";
    }
  }

  if (item.kind === "run") {
    return "short";
  }

  return "medium";
}

function ageDays(createdAt: string, now: number): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) {
    return 0;
  }

  return Math.max(0, (now - created) / DAY_MS);
}

function buildReasons(item: DashboardAttentionItem, age: number, cost: AttentionCost): NeedsYouReason[] {
  const reasons: NeedsYouReason[] = [];

  reasons.push({
    label: "Urgency",
    detail: item.severity === "blocked"
      ? "Blocked -- downstream work cannot proceed until this is resolved."
      : age >= 1
        ? `Open ${Math.floor(age)} day${Math.floor(age) === 1 ? "" : "s"} with no operator response.`
        : "Opened today."
  });

  reasons.push({
    label: "Relevance",
    detail: item.milestone
      ? `Tied to ${item.projectName ?? "this project"}'s current milestone: ${item.milestone}.`
      : `Concerns ${item.projectName ?? "an unassigned project"}.`
  });

  reasons.push({
    label: "Significance",
    detail: item.expectedArtifact
      ? `Unlocks: ${item.expectedArtifact}`
      : item.actionId
        ? "Moves the Project's current Action forward."
        : `Resolves an open Decision for ${item.projectName ?? "the portfolio"}.`
  });

  reasons.push({
    label: "Operator attention",
    detail: cost === "short"
      ? "A short reply or approval resolves this."
      : cost === "long"
        ? "Reading a full plan or Artifact is required before deciding."
        : "Reviewing evidence before approving is required."
  });

  return reasons;
}

/**
 * A `review` or `codex_packet` item carries a live Decision -- an approve
 * button that actually grants authority. A `run` item's severity can also
 * read "blocked" (a failed run), but its only primaryAction is a "View Run"
 * link: it points at the Decision, it isn't one. Weighting kind ahead of raw
 * severity keeps the resolvable Decision dominant instead of the status flag
 * describing why the Decision exists.
 */
function scoreFor(item: DashboardAttentionItem, age: number, cost: AttentionCost): number {
  const severityWeight = item.severity === "blocked" ? 30 : item.severity === "action" ? 20 : 5;
  const kindWeight = item.kind === "review" || item.kind === "codex_packet" ? 15 : 0;
  const costPenalty = cost === "long" ? 3 : cost === "medium" ? 1 : 0;
  const significanceBonus = item.expectedArtifact ? 5 : 0;
  return severityWeight + kindWeight + Math.min(age, 30) + significanceBonus - costPenalty;
}

function normalizedProjectName(value: string | null): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function focusScore(item: DashboardAttentionItem, focus: DashboardReviewFocus | null): number {
  if (!focus) return 0;
  const project = normalizedProjectName(item.projectName);
  const index = focus.projectOrder.findIndex((name) => normalizedProjectName(name) === project);
  return index === -1 ? 0 : (focus.projectOrder.length - index) * 100;
}

export function buildNeedsYouBoard(
  attentionItems: DashboardAttentionItem[],
  reviewItems: DashboardReviewItem[] = [],
  agentQueueEntries: AgentQueueEntry[] = [],
  now: number = Date.now(),
  focus: DashboardReviewFocus | null = null
): NeedsYouBoard {
  const reviewByReviewId = new Map(reviewItems.map((review) => [review.id, review]));
  const agentQueueByActionId = new Map(
    agentQueueEntries.filter((entry) => entry.actionId).map((entry) => [entry.actionId as string, entry])
  );
  const currentActionIds = new Set(
    agentQueueEntries
      .filter((entry) => entry.selected && entry.actionId)
      .map((entry) => entry.actionId as string)
  );
  const representedRunIds = new Set(
    attentionItems
      .filter((item) => item.kind === "review" && item.relatedRunId)
      .map((item) => item.relatedRunId as string)
  );
  const newestByDuplicateKey = new Map<string, DashboardAttentionItem>();
  for (const item of attentionItems) {
    const key = duplicateKey(item);
    if (!key) continue;
    const existing = newestByDuplicateKey.get(key);
    if (!existing || item.updatedAt.localeCompare(existing.updatedAt) > 0) {
      newestByDuplicateKey.set(key, item);
    }
  }

  const excluded: ExcludedNeedsYouItem[] = [];
  const ranked: Array<{ ranked: RankedNeedsYouItem; score: number }> = [];
  const excludedProjects = new Set((focus?.excludedProjects ?? []).map((name) => normalizedProjectName(name)));

  for (const item of attentionItems) {
    const age = ageDays(item.createdAt, now);
    const key = duplicateKey(item);
    const canonical = key ? newestByDuplicateKey.get(key) : null;
    const exclusionReason = excludedProjects.has(normalizedProjectName(item.projectName))
      ? `${item.projectName ?? "This Project"} is outside the operator's current focus.`
      : canonical && canonical.id !== item.id
      ? `Superseded by the newer ${canonical.kind === "codex_packet" ? "packet" : "Run"} for this Action.`
      : exclusionReasonFor(item, age, currentActionIds, representedRunIds);
    if (exclusionReason) {
      excluded.push({ item, exclusionReason });
      continue;
    }

    const cost = attentionCostFor(item, reviewByReviewId);
    const queueEntry = item.actionId ? agentQueueByActionId.get(item.actionId) : undefined;

    ranked.push({
      ranked: {
        item,
        reasons: buildReasons(item, age, cost),
        attentionCost: cost,
        tokenImpact: queueEntry?.tokenImpact ?? null,
        tokenBudget: queueEntry?.tokenBudget ?? null
      },
      score: scoreFor(item, age, cost) + focusScore(item, focus)
    });
  }

  ranked.sort((a, b) => b.score - a.score);

  const focusLimit = focus?.maxItems ?? ranked.length;
  for (const entry of ranked.slice(focusLimit)) {
    excluded.push({
      item: entry.ranked.item,
      exclusionReason: "Open, but outside the focused set. Promote it by changing the workspace review focus."
    });
  }

  const [dominant, ...rest] = ranked.slice(0, focusLimit);

  return {
    dominant: dominant?.ranked ?? null,
    queue: rest.map((entry) => entry.ranked),
    excluded
  };
}
