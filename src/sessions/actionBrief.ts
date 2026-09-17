import { validationError } from "../cli/errors.js";
import { discoverDocs } from "../docs/discover.js";
import { readStandingConstraints } from "../docs/dispatch.js";
import type { PlanDoc } from "../docs/types.js";
import type { SessionAgent } from "./index.js";

/**
 * The actionable brief handed to a managed-production Session at launch.
 *
 * A Session used to be started with the literal prompt `arcadia advance
 * --session <id>`, which prints the receipt's own metadata — session id, packet
 * hash, worktree, reattach command. The agent was never told the Action's
 * `next_action`, its acceptance criteria, or how to finish, so an unattended
 * run had to reconstruct its task from the packet or guess. This module renders
 * the brief that replaces that surface, derived from the authoritative plan
 * document rather than a hardcoded copy, and refuses the launch when the plan
 * or Action cannot supply one.
 */
export interface ActionBriefInput {
  /** The worktree the Session was launched into; the plan document is read from here. */
  repoRoot: string;
  projectSlug: string;
  /** The Session's recorded plan, as stored on its receipt. */
  planSlug: string;
  /** The Session's recorded Action id. */
  actionId: string;
  worktreePath: string;
  branch: string;
  agent: SessionAgent;
}

/**
 * Render one Action brief. Fails closed with a named validation error when the
 * recorded plan or Action is missing, or when the Action declares no acceptance
 * criteria, so a Session can never launch with a brief that does not state what
 * "finished" means.
 */
export function renderActionBrief(input: ActionBriefInput): string {
  const discovered = discoverDocs(input.repoRoot);
  const plan = discovered.docs.find(
    (doc): doc is PlanDoc =>
      doc.type === "plan" &&
      doc.slug.toLowerCase() === input.planSlug.toLowerCase() &&
      doc.project.toLowerCase() === input.projectSlug.toLowerCase()
  );
  if (!plan) {
    throw validationError(
      `A managed-production Session cannot launch: plan "${input.planSlug}" was not found in repository ${input.repoRoot}.`,
      { planSlug: input.planSlug, projectSlug: input.projectSlug, repoRoot: input.repoRoot }
    );
  }

  const action = plan.actions.find((candidate) => candidate.id === input.actionId);
  if (!action) {
    throw validationError(
      `A managed-production Session cannot launch: Action "${input.actionId}" was not found in plan "${input.planSlug}".`,
      { planSlug: input.planSlug, actionId: input.actionId, planPath: plan.relativePath }
    );
  }
  if (action.acceptanceCriteria.length === 0) {
    throw validationError(
      `A managed-production Session cannot launch: Action "${input.actionId}" declares no acceptance criteria.`,
      { planSlug: input.planSlug, actionId: input.actionId, planPath: plan.relativePath }
    );
  }

  const constitution = readStandingConstraints(input.repoRoot);
  if (constitution.blocker) {
    throw validationError(
      `A managed-production Session cannot launch: ${constitution.blocker.message}`,
      { planSlug: input.planSlug, actionId: input.actionId, relativePath: constitution.blocker.relativePath }
    );
  }

  const lines: string[] = [
    "Arcadia managed-production Action brief",
    "",
    `Project: ${input.projectSlug}`,
    `Plan: ${plan.slug} — ${plan.relativePath}`,
    `Action: ${action.id}`,
    `Title: ${action.title}`,
    `Candidate worktree: ${input.worktreePath}`,
    `Branch: ${input.branch}`,
    "",
    "Next action:",
    action.nextAction ?? "(none declared)",
    "",
    "Acceptance criteria (verbatim, in the plan's order):",
    ...numbered(action.acceptanceCriteria),
    "",
    "Standing constraints — from this Session, do not merge, deploy, publish, push to shared",
    "branches, or edit the Project pointer; those remain operator gates."
  ];
  if (constitution.constraints.length > 0) {
    lines.push("", "The repository's CONSTITUTION.md also binds this action:", "", ...constitution.constraints);
  }
  lines.push(
    "",
    "Completion protocol — finish by:",
    "  1. Run the repository's declared validation and make it pass.",
    `  2. Request protected preservation through the existing fixed launcher: arcadia-preserve-broker-${input.agent}`,
    "  3. Settle a `complete` Agent Ask with `candidate_revision` equal to this worktree's HEAD and one",
    "     `met` evidence entry per acceptance criterion above, verbatim and in order."
  );
  return lines.join("\n");
}

function numbered(values: string[]): string[] {
  const width = String(values.length).length;
  return values.map((value, index) => `  ${String(index + 1).padStart(width)}. ${value}`);
}
