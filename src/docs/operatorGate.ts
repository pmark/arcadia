import type { DispatchBlocker } from "./dispatch.js";

/** One option a pending operator item offers, shaped identically whether it came from a Decision or an Agent Ask. */
export interface OperatorGateOption {
  label: string;
  consequence: string;
  recommended: boolean;
}

/** A Decision or unsettled Agent Ask proposal, reduced to what the gate needs to classify and print it. */
export interface PendingDecisionGateInput {
  id: string;
  projectSlug: string;
  question: string;
  /** The Action this Decision governs, per its `action:` field. Null when it names none. */
  actionId: string | null;
  options: OperatorGateOption[];
  updated: string;
  relativePath: string;
}

export interface PendingAgentAskGateInput {
  proposalId: string;
  requestId: string;
  projectSlug: string;
  desiredResult: string;
  /** Every Action id this proposal names, across its own `actions[]` and `target_ref`. */
  actionIds: string[];
  options: OperatorGateOption[];
  createdAt: string;
}

export interface OperatorGateItem {
  kind: "agent_ask" | "decision";
  id: string;
  title: string;
  recommendedOption: string | null;
  consequence: string | null;
  settleCommand: string;
  projectSlug: string;
  /** ISO timestamp used to order alerts newest-first. */
  timestamp: string;
  /** The Decision's document path, for a "decision" item; null for an Agent Ask (no fixed doc path). */
  relativePath: string | null;
}

export interface OperatorGateResolution {
  blocking: OperatorGateItem[];
  alerts: OperatorGateItem[];
}

function recommendedOf(options: OperatorGateOption[]): OperatorGateOption | null {
  return options.find((option) => option.recommended) ?? options[0] ?? null;
}

/** Single-quote a value for a POSIX shell command line, escaping embedded single quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function decisionGateItem(decision: PendingDecisionGateInput): OperatorGateItem {
  const recommended = recommendedOf(decision.options);
  return {
    kind: "decision",
    id: decision.id,
    title: decision.question,
    recommendedOption: recommended?.label ?? null,
    consequence: recommended?.consequence ?? null,
    settleCommand: recommended
      ? `arcadia decision approve ${decision.id} --project ${decision.projectSlug} --answer ${shellQuote(recommended.label)}`
      : `arcadia decision approve ${decision.id} --project ${decision.projectSlug} --answer "<answer>"`,
    projectSlug: decision.projectSlug,
    timestamp: decision.updated,
    relativePath: decision.relativePath
  };
}

function agentAskGateItem(ask: PendingAgentAskGateInput): OperatorGateItem {
  const recommended = recommendedOf(ask.options);
  return {
    kind: "agent_ask",
    id: ask.proposalId,
    title: ask.desiredResult,
    recommendedOption: recommended?.label ?? null,
    consequence: recommended?.consequence ?? null,
    settleCommand: `arcadia agent-ask settle --proposal ${ask.proposalId} --request-id <settlement-request-id> --disposition accepted`,
    projectSlug: ask.projectSlug,
    timestamp: ask.createdAt,
    relativePath: null
  };
}

/**
 * Classify every pending operator-only item (unsettled Agent Ask proposals,
 * open Decisions) scoped to one Project as blocking or alert.
 *
 * Blocking: the item names — or its Decision's `action:` field names — the
 * Action the current dispatch resolution would otherwise select, or (via
 * `blockingDecisionIds`) it is the reason no Action in the current queue
 * segment is eligible. Every other pending item scoped to this Project is an
 * alert; items scoped to another Project are neither, so a blocking item in
 * one Project never suppresses dispatch for an unrelated one.
 */
export function classifyOperatorItems(input: {
  projectSlug: string;
  /** The Action id the current dispatch resolution would select, or null. */
  selectedActionId: string | null;
  /**
   * Decision ids that are the reason no Action in the ready set's current
   * queue segment is eligible (a `resolveReadySet` candidate's
   * `deferringDecisionId`/`requiredDecisionId`). Omit when no ready-set walk
   * was computed — clause 1 alone still applies.
   */
  blockingDecisionIds?: string[];
  decisions: PendingDecisionGateInput[];
  agentAsks: PendingAgentAskGateInput[];
}): OperatorGateResolution {
  const projectSlug = input.projectSlug.toLowerCase();
  const blockingDecisionIds = new Set(input.blockingDecisionIds ?? []);

  const blocking: OperatorGateItem[] = [];
  const alerts: OperatorGateItem[] = [];

  for (const decision of input.decisions) {
    if (decision.projectSlug.toLowerCase() !== projectSlug) continue;
    const names = input.selectedActionId !== null && decision.actionId === input.selectedActionId;
    const isReason = blockingDecisionIds.has(decision.id);
    (names || isReason ? blocking : alerts).push(decisionGateItem(decision));
  }

  for (const ask of input.agentAsks) {
    if (ask.projectSlug.toLowerCase() !== projectSlug) continue;
    const names = input.selectedActionId !== null && ask.actionIds.includes(input.selectedActionId);
    (names ? blocking : alerts).push(agentAskGateItem(ask));
  }

  blocking.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  alerts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { blocking, alerts };
}

/**
 * Render blocking operator items as `DispatchBlocker`s, so every surface that
 * already prints `DispatchResolution.blockers` (`next`'s `renderBlockers`,
 * `go`'s `validationError` throws) prints a blocking operator item for free,
 * instead of a second, parallel print path.
 */
export function operatorGateBlockers(items: OperatorGateItem[]): DispatchBlocker[] {
  return items.map((item) => ({
    relativePath: item.relativePath ?? "(unsettled Agent Ask proposal)",
    field: item.kind,
    message: item.recommendedOption
      ? `${item.title} — recommended: "${item.recommendedOption}"${item.consequence ? ` (${item.consequence})` : ""}`
      : item.title,
    remedy: item.settleCommand
  }));
}

const DEFAULT_ALERT_CAP = 5;

/** Render the alert list `next`/`go`/`advance` append when dispatch proceeds normally. */
export function renderOperatorAlerts(items: OperatorGateItem[], cap = DEFAULT_ALERT_CAP): string[] {
  if (items.length === 0) return [];
  const shown = items.slice(0, cap);
  const remainder = items.length - shown.length;
  const lines = [
    "Pending operator items (not blocking):",
    ...shown.map((item) => `  - ${item.title}${item.consequence ? ` — ${item.consequence}` : ""}`)
  ];
  if (remainder > 0) {
    lines.push(`  ...and ${remainder} more.`);
  }
  return lines;
}
