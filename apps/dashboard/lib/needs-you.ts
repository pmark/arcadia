import type { AgentQueueEntry, DashboardAttentionItem, DashboardReviewItem } from "./types";

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
function exclusionReasonFor(item: DashboardAttentionItem): string | null {
  if (item.kind === "blocked_work") {
    return "Deterministic repair to Arcadia's control documents -- not an operator decision.";
  }

  return null;
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
      : "Moves the Project's current Action forward."
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

export function buildNeedsYouBoard(
  attentionItems: DashboardAttentionItem[],
  reviewItems: DashboardReviewItem[] = [],
  agentQueueEntries: AgentQueueEntry[] = [],
  now: number = Date.now()
): NeedsYouBoard {
  const reviewByReviewId = new Map(reviewItems.map((review) => [review.id, review]));
  const agentQueueByActionId = new Map(
    agentQueueEntries.filter((entry) => entry.actionId).map((entry) => [entry.actionId as string, entry])
  );

  const excluded: ExcludedNeedsYouItem[] = [];
  const ranked: Array<{ ranked: RankedNeedsYouItem; score: number }> = [];

  for (const item of attentionItems) {
    const exclusionReason = exclusionReasonFor(item);
    if (exclusionReason) {
      excluded.push({ item, exclusionReason });
      continue;
    }

    const age = ageDays(item.createdAt, now);
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
      score: scoreFor(item, age, cost)
    });
  }

  ranked.sort((a, b) => b.score - a.score);

  const [dominant, ...rest] = ranked;

  return {
    dominant: dominant?.ranked ?? null,
    queue: rest.map((entry) => entry.ranked),
    excluded
  };
}
