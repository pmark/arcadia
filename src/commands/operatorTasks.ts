import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import {
  attachOperatorTaskEvidence,
  closeOperatorTask,
  declineOperatorTask,
  getOperatorTask,
  listOperatorTasks,
  raiseOperatorTask,
  resolveOperatorTaskOrigin,
  type OperatorTask,
  type OperatorTaskStatus
} from "../docs/operatorTasks.js";

export interface OperatorTaskListOptions {
  repo: string;
  status?: OperatorTaskStatus | "all";
}

export interface OperatorTaskListData {
  repoRoot: string;
  count: number;
  tasks: OperatorTask[];
}

/** Read only. Every open operator task, repo-local -- no workspace, no database. */
export function runOperatorTaskListCommand(options: OperatorTaskListOptions): CommandSuccess<OperatorTaskListData> {
  const tasks = listOperatorTasks(options.repo, options.status ?? "waiting");
  return createSuccess({
    command: "operator-task.list",
    data: { repoRoot: options.repo, count: tasks.length, tasks }
  });
}

export interface OperatorTaskShowOptions {
  repo: string;
  id: string;
}

export interface OperatorTaskShowData {
  task: OperatorTask;
}

export function runOperatorTaskShowCommand(options: OperatorTaskShowOptions): CommandSuccess<OperatorTaskShowData> {
  const task = getOperatorTask(options.repo, options.id);
  if (!task) {
    throw validationError("No operator task matches this id.", { id: options.id });
  }
  return createSuccess({ command: "operator-task.show", data: { task } });
}

export interface OperatorTaskRaiseOptions {
  repo: string;
  asks: string;
  because: string;
  action?: string;
  decision?: string;
  reference?: string;
  by?: string;
  idHint?: string;
}

export interface OperatorTaskRaiseData {
  task: OperatorTask;
}

/**
 * The one path an agent may write through: raising a task never closes it.
 * Every origin must already be in project control -- an Action id or a
 * Decision id -- so this can never become a second, uncited backlog.
 */
export function runOperatorTaskRaiseCommand(options: OperatorTaskRaiseOptions): CommandSuccess<OperatorTaskRaiseData> {
  if (!options.asks?.trim()) {
    throw validationError('An operator task needs the ask: what should the operator do?', {});
  }
  if (!options.because?.trim()) {
    throw validationError('An operator task needs --because "<why only the operator can do this>".', {});
  }
  const origin = withOriginError(() =>
    resolveOperatorTaskOrigin(options.repo, { action: options.action, decision: options.decision })
  );
  const task = raiseOperatorTask(options.repo, {
    asks: options.asks.trim(),
    whyOnlyYou: options.because.trim(),
    origin,
    reference: options.reference,
    by: options.by,
    idHint: options.idHint
  });
  return createSuccess({ command: "operator-task.raise", data: { task } });
}

export interface OperatorTaskEvidenceOptions {
  repo: string;
  id: string;
  note: string;
  by?: string;
}

export interface OperatorTaskEvidenceData {
  task: OperatorTask;
}

/** An agent's non-binding note that something looks complete. Never closes the task. */
export function runOperatorTaskEvidenceCommand(
  options: OperatorTaskEvidenceOptions
): CommandSuccess<OperatorTaskEvidenceData> {
  if (!options.note?.trim()) {
    throw validationError('Evidence needs a --note "<what looks complete>".', {});
  }
  const task = withTaskError(options.id, () =>
    attachOperatorTaskEvidence(options.repo, options.id, options.note.trim(), options.by)
  );
  return createSuccess({ command: "operator-task.evidence", data: { task } });
}

export interface OperatorTaskCloseOptions {
  repo: string;
  id: string;
  operator?: boolean;
  by?: string;
}

export interface OperatorTaskCloseData {
  task: OperatorTask;
}

/**
 * Terminal, and operator-only. This CLI holds no credentials that could
 * enforce that harder, so `--operator` is the loud escape hatch an agent is
 * instructed never to pass -- the same shape as `--allow-blocking` elsewhere.
 */
export function runOperatorTaskCloseCommand(options: OperatorTaskCloseOptions): CommandSuccess<OperatorTaskCloseData> {
  if (!options.operator) {
    throw validationError(`arcadia operator-task close is operator-only. Pass --operator to close "${options.id}".`, {
      id: options.id
    });
  }
  const task = withTaskError(options.id, () => closeOperatorTask(options.repo, options.id, options.by));
  return createSuccess({ command: "operator-task.close", data: { task } });
}

export interface OperatorTaskDeclineOptions {
  repo: string;
  id: string;
  because: string;
  operator?: boolean;
  by?: string;
}

export interface OperatorTaskDeclineData {
  task: OperatorTask;
}

export function runOperatorTaskDeclineCommand(
  options: OperatorTaskDeclineOptions
): CommandSuccess<OperatorTaskDeclineData> {
  if (!options.because?.trim()) {
    throw validationError('arcadia operator-task decline requires --because "<reason>".', {});
  }
  if (!options.operator) {
    throw validationError(
      `arcadia operator-task decline is operator-only. Pass --operator to decline "${options.id}".`,
      { id: options.id }
    );
  }
  const task = withTaskError(options.id, () =>
    declineOperatorTask(options.repo, options.id, options.because.trim(), options.by)
  );
  return createSuccess({ command: "operator-task.decline", data: { task } });
}

export function renderOperatorTaskListSuccess(response: CommandSuccess<OperatorTaskListData>): string[] {
  if (response.data.tasks.length === 0) {
    return ["Nothing waiting on the operator."];
  }
  return [
    `Operator tasks — ${response.data.count} open`,
    ...response.data.tasks.flatMap((task) => [
      "",
      `${task.id}  (${ageDays(task.raisedAt)}d, ${describeOrigin(task.origin)})`,
      `  ${task.asks}`,
      `  why only you: ${task.whyOnlyYou}`,
      ...(task.evidence.length ? [`  evidence: ${task.evidence.map((entry) => entry.note).join("; ")}`] : [])
    ])
  ];
}

export function renderOperatorTaskShowSuccess(response: CommandSuccess<OperatorTaskShowData>): string[] {
  const { task } = response.data;
  return [
    `Operator task ${task.id}`,
    `Status: ${task.status}`,
    `Asks: ${task.asks}`,
    `Why only you: ${task.whyOnlyYou}`,
    `Origin: ${describeOrigin(task.origin)}`,
    `Reference: ${task.reference ?? "None"}`,
    `Raised: ${task.raisedAt} by ${task.raisedBy}`,
    `Evidence: ${task.evidence.length ? task.evidence.map((entry) => `${entry.note} (${entry.by}, ${entry.at})`).join("; ") : "None"}`,
    ...(task.status !== "waiting" ? [`Closed: ${task.closedAt} by ${task.closedBy}${task.because ? ` — ${task.because}` : ""}`] : [])
  ];
}

export function renderOperatorTaskRaiseSuccess(response: CommandSuccess<OperatorTaskRaiseData>): string[] {
  return [`Raised ${response.data.task.id}`, `  ${response.data.task.asks}`, `  why only you: ${response.data.task.whyOnlyYou}`];
}

export function renderOperatorTaskEvidenceSuccess(response: CommandSuccess<OperatorTaskEvidenceData>): string[] {
  return [
    `Recorded evidence on ${response.data.task.id}.`,
    "This did not close the task — only the operator can, with --operator."
  ];
}

export function renderOperatorTaskCloseSuccess(response: CommandSuccess<OperatorTaskCloseData>): string[] {
  return [`Closed ${response.data.task.id} as done.`];
}

export function renderOperatorTaskDeclineSuccess(response: CommandSuccess<OperatorTaskDeclineData>): string[] {
  return [`Declined ${response.data.task.id}: ${response.data.task.because}`];
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function describeOrigin(origin: OperatorTask["origin"]): string {
  return origin.kind === "action" ? `action ${origin.id}` : `Decision ${origin.id}`;
}

function withOriginError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : String(error), {});
  }
}

function withTaskError<T>(id: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : String(error), { id });
  }
}
