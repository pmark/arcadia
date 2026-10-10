import { CHAIN_FIXTURE, chainActionIds, chainActionTask, completionRequestId } from "./rehearsalChain.js";

/**
 * Pure rules of the single-Action fixture reset (operator script
 * reset-single-action-fixture): reopen ONE Action of the disposable rehearsal
 * fixture with a fresh completion request id, without the chain's production
 * receipts. The script owns every side effect; this module only renders the
 * amended Plan and PROJECT.md and judges which prior artifacts must go.
 */

export const SINGLE_ACTION_DEFAULT = "write-start-marker";
export const RUN_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_RUN_TAG = 40;

export class SingleActionResetError extends Error {
  constructor(public reason: string, message: string) { super(message); }
}

/** Fixture Actions this script may reopen: the chain's twelve possible ids. */
export const singleActionIds = (): string[] => chainActionIds(12);

export function singleActionProblems(actionId: string, runTag: string): string[] {
  const problems: string[] = [];
  if (!singleActionIds().includes(actionId)) problems.push(`--action ${actionId} is not a fixture Action (${singleActionIds().join(", ")})`);
  if (!RUN_TAG_PATTERN.test(runTag) || runTag.length > MAX_RUN_TAG) problems.push(`--run-tag must be lowercase letters, digits and hyphens, 1 to ${MAX_RUN_TAG} characters (got ${JSON.stringify(runTag)})`);
  return problems;
}

export const singleActionCompletionId = (actionId: string, runTag: string): string => completionRequestId(actionId, runTag);
export const singleActionCommitSubject = (actionId: string, runTag: string): string => `Reopen ${actionId} for single-Action rehearsal ${runTag}`;
export const singleActionQueueKey = (actionId: string): string => `${CHAIN_FIXTURE.project}/${actionId}`;
export const singleActionQueueRequestId = (actionId: string, runTag: string, revision: number): string => `arrange-single-action-queue-${actionId}-${runTag}-r${revision}`;

/** The Action's next_action: its own task sentence, then a run note with the fresh completion id and the clean-tree rule. */
export function singleActionNextAction(actionId: string, runTag: string): string {
  const index = singleActionIds().indexOf(actionId);
  if (index < 0) throw new SingleActionResetError("UNKNOWN_ACTION", `${actionId} is not a fixture Action`);
  return `${chainActionTask(index)} (single-Action rehearsal, run tag ${runTag}; earlier attempts and candidates stay as evidence; record completion under the unused Agent Ask request id ${singleActionCompletionId(actionId, runTag)}; leave \`git status\` clean after settling (settlement archives the drafted Ask file itself; do not commit or keep a copy of it; if a stray draft remains, delete it)).`;
}

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DATE_LINE = /^updated: ([0-9]{4}-[0-9]{2}-[0-9]{2})$/;

function frontMatter(text: string, what: string): { lines: string[]; end: number } {
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new SingleActionResetError("NOT_A_DOCUMENT", `${what} does not start with front matter`);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new SingleActionResetError("NOT_A_DOCUMENT", `${what}'s front matter is not closed`);
  return { lines, end };
}

function bumpDate(lines: string[], end: number, resetDate: string, what: string): string {
  const at = lines.map((line, i) => [line, i] as const).filter(([line, i]) => i > 0 && i < end && DATE_LINE.test(line));
  if (at.length !== 1) throw new SingleActionResetError("DATE_LINE", `${what} does not carry exactly one updated: date line`);
  const before = DATE_LINE.exec(at[0][0])![1];
  if (resetDate < before) {
    throw new SingleActionResetError("RESET_DATE_BEFORE_RECORD", `the reset date ${resetDate} is before ${what}'s updated: ${before}; docs sync would skip the amendment as older than its record. Correct the host clock or rerun on or after that date UTC; do not hand-edit the date.`);
  }
  lines[at[0][1]] = `updated: ${resetDate}`;
  return before;
}

/** Replace the one top-level `current_action:` line of a front matter (optional for a Plan). Returns whether it changed. */
function pointAt(lines: string[], end: number, actionId: string, required: boolean, what: string): boolean {
  const at = lines.map((line, i) => [line, i] as const).filter(([line, i]) => i > 0 && i < end && line.startsWith("current_action: "));
  if (at.length > 1 || (required && at.length === 0)) throw new SingleActionResetError("CURRENT_ACTION", `${what} does not carry exactly one current_action: line`);
  if (at.length === 0) return false;
  const next = `current_action: ${actionId}`;
  if (lines[at[0][1]] === next) return false;
  lines[at[0][1]] = next;
  return true;
}

export interface RenderedSingleAction {
  plan: string;
  project: string;
  planUpdatedBefore: string;
  projectUpdatedBefore: string;
  statusBefore: string;
  nextAction: string;
  completionId: string;
  projectChanged: boolean;
}

/**
 * Reopen one Action: status open, a fresh next_action (a new requirement input
 * revision), the Plan's and PROJECT.md's current_action pointing at it, and
 * their updated: dates moved to the reset date. Every other line is kept byte
 * for byte, and the acceptance criteria are never touched.
 */
export function renderSingleActionReopen(basePlan: string, baseProject: string, input: { actionId: string; runTag: string; resetDate: string }): RenderedSingleAction {
  const { actionId, runTag, resetDate } = input;
  const bad = singleActionProblems(actionId, runTag);
  if (bad.length > 0) throw new SingleActionResetError("INVALID_ARGUMENTS", bad.join("; "));
  if (!DATE.test(resetDate)) throw new SingleActionResetError("INVALID_RESET_DATE", `reset date ${resetDate} is not YYYY-MM-DD`);
  const nextAction = singleActionNextAction(actionId, runTag);

  const plan = frontMatter(basePlan, "the base Plan");
  const planFront = plan.lines.slice(0, plan.end + 1);
  const start = planFront.findIndex((line) => line === `  - id: ${actionId}`);
  if (start < 0) throw new SingleActionResetError("ACTION_MISSING", `the base Plan has no Action ${actionId}`);
  let stop = start + 1;
  while (stop < plan.end && planFront[stop].startsWith("    ")) stop++;
  const lineIndex = (prefix: string) => {
    const hits = planFront.map((line, i) => [line, i] as const).filter(([line, i]) => i > start && i < stop && line.startsWith(prefix));
    if (hits.length !== 1) throw new SingleActionResetError("ACTION_BLOCK", `the base Plan's ${actionId} does not carry exactly one ${prefix.trim()} line`);
    return hits[0][1];
  };
  const nextAt = lineIndex("    next_action: ");
  const statusAt = lineIndex("    status: ");
  if (planFront[nextAt] === `    next_action: ${nextAction}`) throw new SingleActionResetError("NEXT_ACTION_NOT_FRESH", `the base Plan already carries this run tag's next_action for ${actionId}; choose a new --run-tag`);
  const statusBefore = planFront[statusAt].slice("    status: ".length);
  planFront[nextAt] = `    next_action: ${nextAction}`;
  planFront[statusAt] = "    status: open";
  const planUpdatedBefore = bumpDate(planFront, plan.end, resetDate, "the base Plan");
  pointAt(planFront, plan.end, actionId, false, "the base Plan");
  const renderedPlan = [...planFront, ...plan.lines.slice(plan.end + 1)].join("\n");

  const project = frontMatter(baseProject, "the base PROJECT.md");
  const projectFront = project.lines.slice(0, project.end + 1);
  const projectChanged = pointAt(projectFront, project.end, actionId, true, "the base PROJECT.md");
  let projectUpdatedBefore: string;
  if (projectChanged) projectUpdatedBefore = bumpDate(projectFront, project.end, resetDate, "the base PROJECT.md");
  else {
    const dates = projectFront.filter((line) => DATE_LINE.test(line));
    projectUpdatedBefore = dates.length === 1 ? DATE_LINE.exec(dates[0])![1] : "";
  }
  const renderedProject = projectChanged ? [...projectFront, ...project.lines.slice(project.end + 1)].join("\n") : baseProject;
  return { plan: renderedPlan, project: renderedProject, planUpdatedBefore, projectUpdatedBefore, statusBefore, nextAction, completionId: singleActionCompletionId(actionId, runTag), projectChanged };
}

export interface SingleActionOutputs {
  /** Repository-relative files that exist and belong to this Action alone: the commit removes them. */
  remove: string[];
  /** Why this Action cannot be reopened cleanly: its output is already inside a file other Actions share. */
  problems: string[];
}

const stepNumber = (actionId: string) => /^chain-step-([0-9]{2})$/.exec(actionId)?.[1] ?? null;

/**
 * What the Action's earlier work left in the fixture tree. `read` returns a
 * file's text or null when it is absent. An artifact only this Action owns is
 * removed; a line this Action wrote into a file other Actions also use is a
 * refusal (the script removes files, it never edits shared output).
 */
export function singleActionOutputs(actionId: string, read: (file: string) => string | null): SingleActionOutputs {
  const out: SingleActionOutputs = { remove: [], problems: [] };
  const lines = (file: string) => (read(file) ?? "").split("\n");
  const own = (...files: string[]) => { for (const file of files) if (read(file) !== null) out.remove.push(file); };
  const shared = (file: string, line: string, hint: string) => {
    if (lines(file).includes(line)) out.problems.push(`${actionId}'s output (the line ${JSON.stringify(line)}) is already in ${file}, which other Actions share; ${hint}`);
  };
  if (actionId === "write-start-marker") own("MARKER.md", "tests/marker.test.mjs");
  else if (actionId === "transform-start-marker") {
    shared("MARKER.md", "THREE-ACTION REHEARSAL START", "reopen write-start-marker instead, which removes it");
    own("tests/marker.test.mjs");
  } else if (actionId === "verify-final-rehearsal") shared("MARKER.md", "three-action rehearsal verified", "reopen write-start-marker instead, which removes it");
  else if (actionId === "chain-step-04") own("CHAIN.md");
  else {
    const step = stepNumber(actionId);
    if (step) {
      const previous = String(Number(step) - 1).padStart(2, "0");
      shared("CHAIN.md", `chain step ${step} follows chain step ${previous}`, "reopen chain-step-04 instead, which removes CHAIN.md");
    }
  }
  return out;
}
