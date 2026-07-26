import { discoverDocs } from "./discover.js";
import type {
  ArcadiaDoc,
  DecisionDoc,
  PlanActionDoc,
  PlanDoc,
  ProjectDoc
} from "./types.js";

/**
 * Why a dispatch cannot proceed. Every blocker names the file and the field to
 * repair, because under the continuation contract incomplete control
 * documentation *is* the work — a blocker is a task, not an apology.
 */
export interface DispatchBlocker {
  relativePath: string;
  field: string;
  message: string;
  /** The concrete repair, phrased as an instruction. */
  remedy: string;
}

export interface DispatchContext {
  repoRoot: string;
  projectSlug: string;
  projectName: string;
  projectStatus: string;
  activePlan: string;
  planPath: string;
  planStatus: string;
  milestone: string | null;
  action: PlanActionDoc;
  actionPath: string;
  /** Decisions the action names, with whether each is actually resolved. */
  requiredDecisions: Array<{ id: string; slug: string; status: string; question: string; resolved: boolean }>;
  /** What the agent is authorized to do, derived from responsibility. */
  authorization: string;
}

export interface DispatchResolution {
  context: DispatchContext | null;
  blockers: DispatchBlocker[];
  /** Populated when the action is question_open: the one question to surface. */
  operatorQuestion: string | null;
}

const AUTHORIZATION: Record<string, string> = {
  autonomous: "Arcadia may execute and advance this action without review.",
  codex: "A coding agent may implement this using normal repository authority.",
  requires_review: "The operator must act, approve, or decide. A coding agent must not implement this.",
  blocked: "Progress depends on an outside party or an external state change."
};

/**
 * Resolve the authoritative work pointer from the repository.
 *
 * Reads documents, never the database: the contract makes checked-in
 * documentation authoritative when it disagrees with dispatch metadata, so
 * resolving from anywhere else would defeat the point.
 */
export function resolveDispatch(repoRoot: string, projectSlug?: string): DispatchResolution {
  const blockers: DispatchBlocker[] = [];
  const discovered = discoverDocs(repoRoot);

  for (const error of discovered.errors) {
    blockers.push({
      relativePath: error.relativePath,
      field: error.field,
      message: error.message,
      remedy: "Fix the document so it parses and validates before dispatching work from it."
    });
  }

  const projects = discovered.docs.filter((doc): doc is ProjectDoc => doc.type === "project");
  const project = projectSlug
    ? projects.find((doc) => doc.slug.toLowerCase() === projectSlug.toLowerCase()) ?? null
    : projects[0] ?? null;

  if (!project) {
    blockers.push({
      relativePath: "PROJECT.md",
      field: "type: project",
      message: projectSlug
        ? `No PROJECT.md declaring slug "${projectSlug}" was found under ${repoRoot}.`
        : `No PROJECT.md with \`arcadia: v1\` frontmatter was found under ${repoRoot}.`,
      remedy: "Add a managed PROJECT.md declaring the project slug, status, goal, and active_plan."
    });
    return { context: null, blockers, operatorQuestion: null };
  }

  if (project.status !== "active") {
    blockers.push({
      relativePath: project.relativePath,
      field: "status",
      message: `Project is "${project.status}", not active; Arcadia does not dispatch work to it.`,
      remedy: 'Set `status: active` when this project should receive work.'
    });
  }

  const plans = discovered.docs.filter(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project.toLowerCase() === project.slug.toLowerCase()
  );

  if (!project.activePlan) {
    blockers.push({
      relativePath: project.relativePath,
      field: "active_plan",
      message: "PROJECT.md declares no active_plan, so no plan governs current work.",
      remedy: `Set \`active_plan\` to one of: ${plans.map((plan) => plan.slug).join(", ") || "(no plans found)"}.`
    });
    return { context: null, blockers, operatorQuestion: null };
  }

  const plan = plans.find((doc) => doc.slug.toLowerCase() === project.activePlan!.toLowerCase()) ?? null;
  if (!plan) {
    blockers.push({
      relativePath: project.relativePath,
      field: "active_plan",
      message: `active_plan is "${project.activePlan}", which matches no plan in this project.`,
      remedy: `Point active_plan at an existing plan: ${plans.map((doc) => doc.slug).join(", ") || "(none)"}.`
    });
    return { context: null, blockers, operatorQuestion: null };
  }

  // Only one action may be current across the whole project. Checked only once
  // the active plan resolves: if `active_plan` itself is wrong, saying "this
  // other plan is competing" sends the operator to fix the wrong file.
  for (const other of plans) {
    if (other.currentAction && other.slug.toLowerCase() !== plan.slug.toLowerCase() && !project.currentAction) {
      blockers.push({
        relativePath: other.relativePath,
        field: "current_action",
        message: `Plan "${other.slug}" designates a competing current_action; only the active plan "${plan.slug}" may.`,
        remedy: `Remove current_action from "${other.slug}", or point PROJECT.md's active_plan at it instead.`
      });
    }
  }

  // The contract puts both pointers on the project. A plan-level pointer is
  // still honored for projects that have not adopted that, but the project's
  // wins and a disagreement is reported rather than silently resolved.
  const currentActionId = project.currentAction ?? plan.currentAction;
  if (project.currentAction && plan.currentAction && project.currentAction !== plan.currentAction) {
    blockers.push({
      relativePath: plan.relativePath,
      field: "current_action",
      message: `PROJECT.md names "${project.currentAction}" but plan "${plan.slug}" names "${plan.currentAction}".`,
      remedy: "Remove the plan's current_action, or make the two agree. PROJECT.md is authoritative."
    });
  }

  if (!currentActionId) {
    blockers.push({
      relativePath: plan.relativePath,
      field: "current_action",
      message: `The active plan "${plan.slug}" designates no current_action.`,
      remedy: `Set \`current_action\` to one action id in this plan: ${plan.actions
        .filter((action) => action.status !== "done")
        .map((action) => action.id)
        .join(", ") || "(no unfinished actions)"}.`
    });
    return { context: null, blockers, operatorQuestion: null };
  }

  // A dangling pointer is already reported per-file by the parser, which means
  // the plan never became a doc; reaching here with no match would be a bug.
  const action = plan.actions.find((candidate) => candidate.id === currentActionId) ?? null;
  if (!action) {
    blockers.push({
      relativePath: project.currentAction ? project.relativePath : plan.relativePath,
      field: "current_action",
      message: `current_action "${currentActionId}" matches no action in plan "${plan.slug}".`,
      remedy: "Point current_action at an existing action id."
    });
    return { context: null, blockers, operatorQuestion: null };
  }

  if (action.status === "done") {
    blockers.push({
      relativePath: plan.relativePath,
      field: "current_action",
      message: `current_action "${action.id}" is already done.`,
      remedy: "Select the next current_action, or record one operator question if the choice is not obvious."
    });
  }

  const decisionDocs = discovered.docs.filter(
    (doc): doc is DecisionDoc =>
      doc.type === "decision" && doc.project.toLowerCase() === project.slug.toLowerCase()
  );
  const requiredDecisions = action.decisions.map((id) => {
    const found = decisionDocs.find((doc) => doc.id === id || doc.slug === id);
    if (!found) {
      blockers.push({
        relativePath: plan.relativePath,
        field: `actions.${action.id}.decisions`,
        message: `Action requires decision "${id}", which has no document in this project.`,
        remedy: `Write docs/decisions/${id}-<slug>.md, or remove the reference.`
      });
      return { id, slug: id, status: "missing", question: "", resolved: false };
    }
    const resolved = found.status === "approved" || found.status === "rejected";
    if (!resolved) {
      blockers.push({
        relativePath: found.relativePath,
        field: "status",
        message: `Required decision ${found.id} is still "${found.status}".`,
        remedy: "Answer the decision before this action is dispatched."
      });
    }
    return { id: found.id, slug: found.slug, status: found.status, question: found.question, resolved };
  });

  // Ordering is a dispatch constraint, not documentation. Handing an agent an
  // Action whose prerequisite is unfinished is how a plan gets built out of
  // order, so an unfinished dependency blocks the objective rather than being
  // reported as context the agent is free to ignore.
  const unfinishedDependencies = action.dependsOn
    .map((id) => plan.actions.find((candidate) => candidate.id === id) ?? null)
    .filter((candidate): candidate is PlanActionDoc => candidate !== null && candidate.status !== "done");

  for (const dependency of unfinishedDependencies) {
    blockers.push({
      relativePath: plan.relativePath,
      field: `actions.${action.id}.depends_on`,
      message: `Depends on "${dependency.id}" ("${dependency.title}"), which is "${dependency.status}", not done.`,
      remedy: `Finish "${dependency.id}" first, or point current_action at it, or remove the dependency if it no longer holds.`
    });
  }

  const operatorQuestion = action.clarification === "question_open" ? action.question : null;

  const context: DispatchContext = {
    repoRoot,
    projectSlug: project.slug,
    projectName: project.name,
    projectStatus: project.status,
    activePlan: plan.slug,
    planPath: plan.relativePath,
    planStatus: plan.status,
    milestone: plan.milestone ?? project.milestone,
    action,
    actionPath: plan.relativePath,
    requiredDecisions,
    authorization: AUTHORIZATION[action.responsibility] ?? "Unknown responsibility; treat as requires_review."
  };

  return { context, blockers, operatorQuestion };
}

/** True when the resolution is safe to hand to a coding agent as-is. */
export function isDispatchable(resolution: DispatchResolution): boolean {
  return (
    resolution.context !== null &&
    resolution.blockers.length === 0 &&
    resolution.operatorQuestion === null &&
    (resolution.context.action.responsibility === "codex" ||
      resolution.context.action.responsibility === "autonomous")
  );
}

export type { ArcadiaDoc };
