import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import { existingDirectory } from "../git/worktrees.js";
import { buildAgentQueue, type AgentQueue, type AgentQueueEntry } from "../dispatch/queue.js";
import { arrangeActionOrder, moveActionOrder, undoActionOrder, type ActionOrderReceipt } from "../dispatch/order.js";
import { discoverDocs } from "../docs/discover.js";
import { getLatestSession, getSession, resolveProjectTransition, sessionView, type ProjectTransition } from "../sessions/index.js";

export interface AdvanceQueueCommandData extends AgentQueue {}
export interface AdvanceQueueReorderData { receipt: ActionOrderReceipt; nextActionKey: string | null; }

interface AdvanceCommandData {
  session: ReturnType<typeof sessionView> | null;
  transition: ProjectTransition | null;
}

export function runAdvanceCommand(options: { workspace: string; repo: string; session?: string }): CommandSuccess<AdvanceCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (options.session) {
    const sessionId = options.session;
    const session = withReadOnlyDatabase(workspacePath, (db) => getSession(db, sessionId));
    if (!session) throw new Error(`Session was not found: ${options.session}`);
    return createSuccess({ command: "advance", workspace: workspacePath, data: { session: sessionView(session), transition: null } });
  }
  const repoRoot = existingDirectory(options.repo, "repository");
  const project = discoverDocs(repoRoot).docs.find((doc) => doc.type === "project");
  if (!project || project.type !== "project") throw new Error("Arcadia advance requires one managed Project document.");
  const transition = withReadOnlyDatabase(workspacePath, (db) => resolveProjectTransition({ repoRoot, projectSlug: project.slug, db }));
  return createSuccess({ command: "advance", workspace: workspacePath, data: { session: null, transition } });
}

export function renderAdvanceSuccess(response: ReturnType<typeof runAdvanceCommand>): string[] {
  const data = response.data as any;
  if (data.session) {
    return [
      `Session: ${data.session.id}`,
      `Status: ${data.session.observedStatus}`,
      `Project: ${data.session.project_slug} · ${data.session.plan_slug}#${data.session.action_id}`,
      `Packet: ${data.session.packet_id} · sha256 ${data.session.packet_sha256}`,
      `Worktree: ${data.session.worktree_path}`,
      `Reattach: ${data.session.reattachCommand}`,
      `Resume after exit: ${data.session.resumeCommand}`
    ];
  }
  return [
    `Transition: ${data.transition.kind}`,
    data.transition.reason,
    `Next: ${data.transition.nextAction}`
  ];
}

export function runSessionShowCommand(options: { workspace: string; id?: string }) {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const session = withReadOnlyDatabase(workspacePath, (db) => options.id ? getSession(db, options.id) : getLatestSession(db));
  if (!session) throw new Error(options.id ? `Session was not found: ${options.id}` : "No Session has been prepared yet.");
  return createSuccess({ command: "session.show", workspace: workspacePath, data: sessionView(session) });
}

export function renderSessionShowSuccess(response: ReturnType<typeof runSessionShowCommand>): string[] {
  const data = response.data;
  return [
    `Session: ${data.id}`,
    `Status: ${data.observedStatus}${data.live ? " (tmux live)" : ""}`,
    `Project: ${data.project_slug} · ${data.plan_slug}#${data.action_id}`,
    `Provider: ${data.provider} · ${data.model}${data.effort ? ` · ${data.effort}` : ""}`,
    `Packet: ${data.packet_id} · sha256 ${data.packet_sha256}`,
    `Reattach: ${data.reattachCommand}`,
    `Resume after exit: ${data.resumeCommand}`
  ];
}

export function runAdvanceQueueCommand(options: { workspace: string }): CommandSuccess<AdvanceQueueCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const queue = withReadOnlyDatabase(workspacePath, (db) => buildAgentQueue(db));

  return createSuccess({
    command: "advance.queue",
    workspace: workspacePath,
    data: queue
  });
}

export function renderAdvanceQueueSuccess(response: CommandSuccess<AdvanceQueueCommandData>): string[] {
  const queue = response.data;
  return [
    "Arcadia Agent Queue",
    `Revision: ${queue.revision} · Ordered Actions: ${queue.ordered.length} · Unpositioned: ${queue.unpositionedCount} · Order: ${queue.orderValid ? "valid" : "invalid"}`,
    `Next: ${queue.nextActionKey ?? "none"}`,
    `Ready: ${queue.counts.ready} · Running: ${queue.counts.running} · Flagged: ${queue.counts.flagged} · Needs attention: ${queue.counts.attention}`,
    "",
    "Ready to feed:",
    ...renderEntries(queue.ready, renderReadyEntry),
    "",
    "Running or queued:",
    ...renderEntries(queue.running, renderRunningEntry),
    "",
    "Flagged for agent review:",
    ...renderEntries(queue.flagged, renderFlaggedEntry),
    "",
    "Needs attention before dispatch:",
    ...renderEntries(queue.attention, renderAttentionEntry)
  ];
}

export function runAdvanceQueueReorderCommand(options: {
  workspace: string;
  move: string;
  top?: boolean;
  before?: string;
  after?: string;
  requestId: string;
  revision?: number;
  apply?: boolean;
}): CommandSuccess<AdvanceQueueReorderData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const placements = [options.top ? "top" : null, options.before ? "before" : null, options.after ? "after" : null].filter(Boolean);
  if (placements.length !== 1) throw validationError("Choose exactly one placement: --top, --before, or --after.");
  const result = withDatabase(workspacePath, (db) => {
    const queue = buildAgentQueue(db);
    const receipt = moveActionOrder(db, {
      currentKeys: queue.ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []),
      move: options.move,
      placement: placements[0] as "top" | "before" | "after",
      anchor: options.before ?? options.after,
      requestId: options.requestId,
      expectedRevision: options.revision,
      apply: options.apply
    });
    const selected = receipt.after.find((key) => queue.ordered.find((entry) => entry.orderKey === key && entry.state === "ready" && entry.pointerAuthorized));
    return { receipt, nextActionKey: selected ?? null };
  });
  return createSuccess({ command: "advance.queue.reorder", workspace: workspacePath, data: result });
}

export function renderAdvanceQueueReorderSuccess(response: CommandSuccess<AdvanceQueueReorderData>): string[] {
  const receipt = response.data.receipt;
  return [
    receipt.applied ? "Action queue order updated." : "Action queue order preview.",
    `Revision: ${receipt.revisionBefore} → ${receipt.revisionAfter}`,
    `Operation: ${renderOrderOperation(receipt)}`,
    `Next: ${response.data.nextActionKey ?? "none"}`,
    `Receipt: ${receipt.id}`
  ];
}

export function runAdvanceQueueArrangeCommand(options: {
  workspace: string;
  order: string[];
  requestId: string;
  revision?: number;
  apply?: boolean;
}): CommandSuccess<AdvanceQueueReorderData> {
  return runQueueMutation(options.workspace, "advance.queue.arrange", (db, queue) => arrangeActionOrder(db, {
    currentKeys: queueKeys(queue),
    order: options.order,
    requestId: options.requestId,
    expectedRevision: options.revision,
    apply: options.apply
  }));
}

export function runAdvanceQueueUndoCommand(options: {
  workspace: string;
  receiptId: string;
  requestId: string;
  revision?: number;
  apply?: boolean;
}): CommandSuccess<AdvanceQueueReorderData> {
  return runQueueMutation(options.workspace, "advance.queue.undo", (db, queue) => undoActionOrder(db, {
    currentKeys: queueKeys(queue),
    receiptId: options.receiptId,
    requestId: options.requestId,
    expectedRevision: options.revision,
    apply: options.apply
  }));
}

function runQueueMutation(
  workspace: string,
  command: string,
  mutate: (db: import("better-sqlite3").Database, queue: AgentQueue) => ActionOrderReceipt
): CommandSuccess<AdvanceQueueReorderData> {
  const { workspacePath } = resolveReadyWorkspace(workspace);
  const result = withDatabase(workspacePath, (db) => {
    const queue = buildAgentQueue(db);
    const receipt = mutate(db, queue);
    const nextActionKey = receipt.after.find((key) => queue.ordered.some(
      (entry) => entry.orderKey === key && entry.state === "ready" && entry.pointerAuthorized
    )) ?? null;
    return { receipt, nextActionKey };
  });
  return createSuccess({ command, workspace: workspacePath, data: result });
}

function queueKeys(queue: AgentQueue): string[] {
  return queue.ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []);
}

function renderOrderOperation(receipt: ActionOrderReceipt): string {
  const operation = receipt.operation;
  if (operation.kind === "move") {
    return `move ${operation.move} ${operation.placement}${operation.anchor ? ` ${operation.anchor}` : ""}`;
  }
  if (operation.kind === "undo") return `undo ${operation.receiptId}`;
  return `arrange ${operation.order.join(" → ")}`;
}

function renderFlaggedEntry(entry: AgentQueueEntry): string[] {
  return [
    `  ? ${entry.projectName ?? "Unassigned"} / ${entry.decisionId ?? "Decision"}`,
    `    ${entry.reason}`,
    "    Status: flagged; no coding-agent Run started",
    `    Next: ${entry.nextAction}`
  ];
}

function renderEntries(entries: AgentQueueEntry[], render: (entry: AgentQueueEntry) => string[]): string[] {
  if (entries.length === 0) return ["  None"];
  return entries.flatMap((entry) => render(entry));
}

function renderReadyEntry(entry: AgentQueueEntry): string[] {
  return [
    `  ${entry.selected ? "*" : "-"} ${entry.projectName ?? "Unassigned"} / ${entry.actionId ?? entry.actionTitle ?? "Action"}`,
    `    ${entry.actionTitle ?? "Untitled Action"}${entry.planSlug ? ` · plan ${entry.planSlug}` : ""}`,
    `    ${entry.reason}`,
    ...(entry.tokenImpact || entry.tokenBudget
      ? [`    Token impact: ${entry.tokenImpact ?? "unknown"}${entry.tokenBudget ? ` · ${entry.tokenBudget}` : ""}`]
      : []),
    `    Next: ${entry.nextAction}`
  ];
}

function renderRunningEntry(entry: AgentQueueEntry): string[] {
  return [
    `  - ${entry.projectName ?? "Unassigned"} / ${entry.actionTitle ?? entry.actionId ?? "Action"}`,
    `    Status: ${entry.status}${entry.runId ? ` · Run ${entry.runId}` : ""}`,
    ...(entry.tokenImpact || entry.tokenBudget
      ? [`    Token impact: ${entry.tokenImpact ?? "unknown"}${entry.tokenBudget ? ` · ${entry.tokenBudget}` : ""}`]
      : []),
    `    Next: ${entry.nextAction}`
  ];
}

function renderAttentionEntry(entry: AgentQueueEntry): string[] {
  const lines = [
    `  ! ${entry.projectName ?? "Unassigned"} / ${entry.actionTitle ?? entry.actionId ?? "Project"}`,
    `    ${entry.reason}`,
    ...(entry.tokenImpact || entry.tokenBudget
      ? [`    Token impact: ${entry.tokenImpact ?? "unknown"}${entry.tokenBudget ? ` · ${entry.tokenBudget}` : ""}`]
      : []),
    `    Next: ${entry.nextAction}`
  ];
  for (const blocker of entry.blockers) {
    lines.push(`    Blocker: ${blocker.relativePath} [${blocker.field}] ${blocker.message}`, `    Fix: ${blocker.remedy}`);
  }
  return lines;
}
