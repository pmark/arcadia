import { discoverDocs, isAuthoritativeControlPath, type DiscoveryResult } from "./discover.js";
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
  planTokenImpact: PlanDoc["tokenImpact"];
  planTokenBudget: string;
  /** From the plan's `recommended_model`. Null when the plan does not declare one. */
  planRecommendedModel: string | null;
  /** From the plan's `recommended_reasoning_effort`. Null when not declared. */
  planRecommendedReasoningEffort: string | null;
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

/** The Project and its active plan, resolved structurally -- before anything
 *  is asked about `current_action`. */
interface ActivePlanResolution {
  discovered: DiscoveryResult;
  project: ProjectDoc | null;
  plan: PlanDoc | null;
  blockers: DispatchBlocker[];
}

/**
 * Resolve the Project and its active plan document.
 *
 * Shared by `resolveDispatch`, which goes on to resolve one Action from the
 * result, and `resolveReadySet`, which enumerates every Action in the plan
 * instead — so both agree about what "the active plan" even is, and neither
 * silently diverges into a second implementation of this resolution.
 *
 * Reads documents, never the database: the contract makes checked-in
 * documentation authoritative when it disagrees with dispatch metadata, so
 * resolving from anywhere else would defeat the point.
 */
function resolveActivePlan(repoRoot: string, projectSlug?: string): ActivePlanResolution {
  const blockers: DispatchBlocker[] = [];
  const discovered = discoverDocs(repoRoot);

  for (const error of discovered.errors.filter((candidate) => isAuthoritativeControlPath(candidate.relativePath))) {
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
    return { discovered, project: null, plan: null, blockers };
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
    return { discovered, project, plan: null, blockers };
  }

  const plan = plans.find((doc) => doc.slug.toLowerCase() === project.activePlan!.toLowerCase()) ?? null;
  if (!plan) {
    blockers.push({
      relativePath: project.relativePath,
      field: "active_plan",
      message: `active_plan is "${project.activePlan}", which matches no plan in this project.`,
      remedy: `Point active_plan at an existing plan: ${plans.map((doc) => doc.slug).join(", ") || "(none)"}.`
    });
    return { discovered, project, plan: null, blockers };
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
  if (project.currentAction && plan.currentAction && project.currentAction !== plan.currentAction) {
    blockers.push({
      relativePath: plan.relativePath,
      field: "current_action",
      message: `PROJECT.md names "${project.currentAction}" but plan "${plan.slug}" names "${plan.currentAction}".`,
      remedy: "Remove the plan's current_action, or make the two agree. PROJECT.md is authoritative."
    });
  }

  return { discovered, project, plan, blockers };
}

/**
 * Resolve the authoritative work pointer from the repository.
 *
 * Reads documents, never the database: the contract makes checked-in
 * documentation authoritative when it disagrees with dispatch metadata, so
 * resolving from anywhere else would defeat the point.
 */
export function resolveDispatch(repoRoot: string, projectSlug?: string): DispatchResolution {
  const { discovered, project, plan, blockers } = resolveActivePlan(repoRoot, projectSlug);

  if (!project || !plan) {
    return { context: null, blockers, operatorQuestion: null };
  }

  const currentActionId = project.currentAction ?? plan.currentAction;

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

  const readiness = checkActionReadiness(plan, action, decisionDocs);
  blockers.push(...readiness.blockers);
  const { requiredDecisions, operatorQuestion } = readiness;

  const context: DispatchContext = {
    repoRoot,
    projectSlug: project.slug,
    projectName: project.name,
    projectStatus: project.status,
    activePlan: plan.slug,
    planPath: plan.relativePath,
    planStatus: plan.status,
    planTokenImpact: plan.tokenImpact,
    planTokenBudget: plan.tokenBudget,
    planRecommendedModel: plan.recommendedModel,
    planRecommendedReasoningEffort: plan.recommendedReasoningEffort,
    milestone: plan.milestone ?? project.milestone,
    action,
    actionPath: plan.relativePath,
    requiredDecisions,
    authorization: AUTHORIZATION[action.responsibility] ?? "Unknown responsibility; treat as requires_review."
  };

  return { context, blockers, operatorQuestion };
}

/** Everything the documents say about whether one action may start. */
interface ActionReadinessResult {
  blockers: DispatchBlocker[];
  requiredDecisions: DispatchContext["requiredDecisions"];
  operatorQuestion: string | null;
}

/**
 * The per-action half of dispatch: unmet prerequisites, unanswered required
 * decisions, and an open clarification question.
 *
 * Shared by the work-pointer resolution and the action-scoped check so a run
 * prepared for a specific Action is held to exactly the same document rules as
 * one dispatched through the pointer. Two implementations would drift, and the
 * looser one would become the way to get work through.
 */
function checkActionReadiness(
  plan: PlanDoc,
  action: PlanActionDoc,
  decisionDocs: DecisionDoc[]
): ActionReadinessResult {
  const blockers: DispatchBlocker[] = [];

  // The plan's `depends_on` edges are an ordering claim, and dispatching past
  // them hands an agent work whose prerequisites do not exist yet. Transitive,
  // because a dependency that is itself blocked blocks this action just as
  // hard. Cycles are rejected at parse time, so this cannot loop forever.
  for (const dependency of collectUnmetDependencies(plan, action)) {
    blockers.push({
      relativePath: plan.relativePath,
      field: `actions.${action.id}.depends_on`,
      message:
        dependency.path.length > 1
          ? `Depends on "${dependency.id}" (via ${dependency.path.slice(0, -1).join(" -> ")}), which is "${dependency.status}", not done.`
          : `Depends on "${dependency.id}", which is "${dependency.status}", not done.`,
      remedy: `Finish "${dependency.id}" first, or make it the current_action, or drop the dependency if it no longer holds.`
    });
  }

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

  return {
    blockers,
    requiredDecisions,
    operatorQuestion: action.clarification === "question_open" ? action.question : null
  };
}

/** What the documents say about one named action, independent of the pointer. */
export interface ActionReadiness {
  /** False when the repository has no such action; nothing was checked. */
  found: boolean;
  planSlug: string | null;
  planPath: string | null;
  /** The plan document's own `updated:` field — a cheap staleness signal for
   *  callers that snapshot readiness now and want to know later whether it is
   *  still worth rechecking, without re-parsing the whole document. */
  planUpdated: string | null;
  action: PlanActionDoc | null;
  blockers: DispatchBlocker[];
  operatorQuestion: string | null;
  requiredDecisions: DispatchContext["requiredDecisions"];
}

/**
 * Resolve whether one specific action may start, by id, from the documents.
 *
 * The pointer answers "what should I work on"; this answers "may this
 * particular thing start", which is the question a run prepared against an
 * existing Action actually asks. Searches every plan in the project rather than
 * only the active one: an Action can outlive the plan being pointed at, and
 * refusing to check it would leave the looser path unguarded.
 *
 * Deliberately does not require the action to be the current_action. Preparing
 * work off the pointer is a real workflow; preparing work whose prerequisites
 * are unfinished is not.
 */
export function resolveActionReadiness(
  repoRoot: string,
  projectSlug: string,
  actionId: string
): ActionReadiness {
  const empty: ActionReadiness = {
    found: false,
    planSlug: null,
    planPath: null,
    planUpdated: null,
    action: null,
    blockers: [],
    operatorQuestion: null,
    requiredDecisions: []
  };

  const discovered = discoverDocs(repoRoot);
  const plans = discovered.docs.filter(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project.toLowerCase() === projectSlug.toLowerCase()
  );

  const plan = plans.find((candidate) => candidate.actions.some((entry) => entry.id === actionId)) ?? null;
  const action = plan?.actions.find((entry) => entry.id === actionId) ?? null;
  if (!plan || !action) {
    return empty;
  }

  const decisionDocs = discovered.docs.filter(
    (doc): doc is DecisionDoc =>
      doc.type === "decision" && doc.project.toLowerCase() === projectSlug.toLowerCase()
  );

  // A plan that no longer parses cannot be trusted to say this action is
  // ready, so its parse errors are blockers here too.
  const parseBlockers: DispatchBlocker[] = discovered.errors
    .filter((error) => error.relativePath === plan.relativePath)
    .map((error) => ({
      relativePath: error.relativePath,
      field: error.field,
      message: error.message,
      remedy: "Fix the document so it parses and validates before starting work from it."
    }));

  const readiness = checkActionReadiness(plan, action, decisionDocs);
  return {
    found: true,
    planSlug: plan.slug,
    planPath: plan.relativePath,
    planUpdated: plan.updated,
    action,
    blockers: [...parseBlockers, ...readiness.blockers],
    operatorQuestion: readiness.operatorQuestion,
    requiredDecisions: readiness.requiredDecisions
  };
}

/** An unfinished prerequisite, with the dependency chain that reached it. */
interface UnmetDependency {
  id: string;
  status: string;
  /** Ids from the current action's first dependency down to this one. */
  path: string[];
}

/**
 * Walk `depends_on` from the given action and collect every prerequisite that
 * is not done.
 *
 * Breadth-first so the nearest unmet prerequisite is reported first — that is
 * the one the operator can act on. Dangling ids are skipped; the parser already
 * reports those against the plan file, and repeating it here would send the
 * operator to the same field twice with different wording.
 */
function collectUnmetDependencies(plan: PlanDoc, action: PlanActionDoc): UnmetDependency[] {
  const byId = new Map(plan.actions.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>([action.id]);
  const unmet: UnmetDependency[] = [];
  const queue: string[][] = action.dependsOn.map((id) => [id]);

  while (queue.length > 0) {
    const chain = queue.shift()!;
    const id = chain[chain.length - 1];
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const dependency = byId.get(id);
    if (!dependency) {
      continue;
    }
    if (dependency.status !== "done") {
      unmet.push({ id, status: dependency.status, path: chain });
    }
    for (const next of dependency.dependsOn) {
      queue.push([...chain, next]);
    }
  }

  return unmet;
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

/** One Action a coding agent could dispatch right now. */
export interface ReadySetEntry {
  actionId: string;
  title: string;
  responsibility: string;
}

/** The single unfinished Action closest to ready, reported when nothing is. */
export interface NearestToReady {
  actionId: string;
  title: string;
  responsibility: string;
  blockers: DispatchBlocker[];
  operatorQuestion: string | null;
}

export interface ReadySetResolution {
  projectSlug: string | null;
  planSlug: string | null;
  planPath: string | null;
  planTokenImpact: PlanDoc["tokenImpact"] | null;
  planTokenBudget: string | null;
  /** Populated only when the active plan itself could not be resolved at
   *  all — the same refusal `resolveDispatch` would report for the pointer,
   *  not a second explanation of it. */
  blockers: DispatchBlocker[];
  /** Every Action in the active plan with no unmet transitive prerequisite,
   *  no unanswered required Decision, no open clarification question, and a
   *  responsibility a coding agent may act on. In plan declaration order. */
  ready: ReadySetEntry[];
  /** A suggestion only — never written. The current current_action if it is
   *  itself ready, otherwise the first ready Action in declaration order, or
   *  null when nothing is ready. */
  suggestedCurrentAction: string | null;
  /** Populated only when `ready` is empty, so an empty set still names a
   *  next step instead of printing nothing. */
  nearest: NearestToReady | null;
}

/**
 * Compute every Action in the active plan a coding agent could dispatch right
 * now, instead of only refusing a bad pointer.
 *
 * Deliberately narrower than `resolveDispatch` in what it requires: it shares
 * `resolveActivePlan` to resolve the Project and its active plan document,
 * but — unlike `resolveDispatch` — does not additionally require a
 * `current_action` to already resolve. A plan with no `current_action`, or a
 * dangling one, is exactly the case this command exists to help with: it
 * still enumerates every Action and reports what could be pointed at, rather
 * than refusing for the same reason `next` refuses. Each candidate's
 * readiness is resolved through `resolveActionReadiness` — the same rule
 * `resolveDispatch` itself uses for its current_action — so this can never
 * disagree with what `arcadia next` would say about any one Action.
 *
 * Only refuses on the same conditions that leave `resolveActivePlan` with no
 * plan at all (no project, no active_plan, active_plan matching no plan). It
 * does not additionally refuse on every blocker `resolveDispatch` might
 * report (an inactive Project, a competing current_action elsewhere),
 * because those describe the *pointer*, not any one Action's readiness, and
 * this command computes readiness, never dispatches anything — nothing
 * unsafe is enabled by reporting what would be ready.
 */
export function resolveReadySet(repoRoot: string, projectSlug?: string): ReadySetResolution {
  const { project, plan, blockers } = resolveActivePlan(repoRoot, projectSlug);

  if (!project || !plan) {
    return {
      projectSlug: project?.slug ?? projectSlug ?? null,
      planSlug: null,
      planPath: null,
      planTokenImpact: null,
      planTokenBudget: null,
      blockers,
      ready: [],
      suggestedCurrentAction: null,
      nearest: null
    };
  }

  const resolvedProjectSlug = project.slug;
  const planSlug = plan.slug;
  const planPath = plan.relativePath;
  const currentActionId = project.currentAction ?? plan.currentAction;

  const unfinished = plan.actions.filter((action) => action.status !== "done" && action.status !== "blocked");

  const evaluated = unfinished.map((action) => {
    const readiness = resolveActionReadiness(repoRoot, resolvedProjectSlug, action.id);
    const authorized = action.responsibility === "codex" || action.responsibility === "autonomous";
    const isReady = readiness.blockers.length === 0 && readiness.operatorQuestion === null && authorized;
    return { action, readiness, isReady };
  });

  const ready: ReadySetEntry[] = evaluated
    .filter((entry) => entry.isReady)
    .map((entry) => ({
      actionId: entry.action.id,
      title: entry.action.title,
      responsibility: entry.action.responsibility
    }));

  const suggestedCurrentAction = ready.length === 0
    ? null
    : ready.some((entry) => entry.actionId === currentActionId)
      ? currentActionId
      : ready[0].actionId;

  let nearest: NearestToReady | null = null;
  if (ready.length === 0) {
    // Fewest readiness blockers wins; ties keep plan declaration order, since
    // that is the only ordering the document itself asserts.
    const best = evaluated.reduce<(typeof evaluated)[number] | null>((closest, entry) => {
      if (!closest) {
        return entry;
      }
      return entry.readiness.blockers.length < closest.readiness.blockers.length ? entry : closest;
    }, null);
    if (best) {
      nearest = {
        actionId: best.action.id,
        title: best.action.title,
        responsibility: best.action.responsibility,
        blockers: best.readiness.blockers,
        operatorQuestion: best.readiness.operatorQuestion
      };
    }
  }

  return {
    projectSlug: resolvedProjectSlug,
    planSlug,
    planPath,
    planTokenImpact: plan.tokenImpact,
    planTokenBudget: plan.tokenBudget,
    blockers: [],
    ready,
    suggestedCurrentAction,
    nearest
  };
}

export type { ArcadiaDoc };
