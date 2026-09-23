import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validationError } from "../cli/errors.js";
import { checkCapabilityRegistry } from "./capabilities.js";
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
  /**
   * Which `CONSTITUTION.md` binds this dispatch — its path and content
   * fingerprint — or null when the repository has none.
   *
   * A reference, not the text. The text used to ride here verbatim, so every
   * surface that serialized the context (the go and advance brokers' JSON,
   * `next --json`) repeated the whole Constitution, and an agent reading the
   * broker result and then the `next` brief received it twice. Each rendered
   * brief now loads the text exactly once through `loadConstitution`, which
   * refuses when the file no longer matches this fingerprint.
   */
  constitution: ConstitutionReference | null;
}

export interface ConstitutionReference {
  path: "CONSTITUTION.md";
  /** Hex SHA-256 of the file's exact bytes. */
  sha256: string;
}

export interface DispatchResolution {
  context: DispatchContext | null;
  blockers: DispatchBlocker[];
  /** Populated when the action is question_open: the one question to surface. */
  operatorQuestion: string | null;
}

const AUTHORIZATION: Record<string, string> = {
  autonomous: "Arcadia may execute and advance this action without review.",
  agent: "A coding agent may implement this using normal repository authority.",
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
function resolveActivePlan(repoRoot: string, projectSlug?: string, alreadyRead?: DiscoveryResult): ActivePlanResolution {
  const blockers: DispatchBlocker[] = [];
  const discovered = alreadyRead ?? discoverDocs(repoRoot);

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

  if (plan.status !== "active") {
    blockers.push({
      relativePath: plan.relativePath,
      field: "status",
      message: `The active plan "${plan.slug}" is "${plan.status}", not active; Arcadia does not dispatch work from it.`,
      remedy: 'Set `status: active` only when this plan is ready to govern executable work.'
    });
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
 *
 * `options.actionId` resolves the same brief for a *named* Action of the active
 * plan instead of the pointer's. It exists for the one caller that already
 * knows which Action it is answering about because it holds that Action's
 * worktree claim: `arcadia go`'s queue-walk fallback, and the `arcadia advance`
 * run inside the worktree that fallback prepared. It reads the pointer's
 * documents and writes nothing, so `current_action` stays a single value and no
 * reader of it changes — an override is a second *reader*, not a second pointer.
 */
export function resolveDispatch(
  repoRoot: string,
  projectSlug?: string,
  options?: { actionId?: string }
): DispatchResolution {
  const { discovered, project, plan, blockers } = resolveActivePlan(repoRoot, projectSlug);

  if (!project || !plan) {
    return { context: null, blockers, operatorQuestion: null };
  }

  const claimedActionId = options?.actionId ?? null;
  const currentActionId = claimedActionId ?? project.currentAction ?? plan.currentAction;

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
    blockers.push(claimedActionId
      ? {
          relativePath: plan.relativePath,
          field: "claimed_action",
          message: `Claimed Action "${claimedActionId}" matches no action in plan "${plan.slug}".`,
          remedy: "Release the stale worktree claim, or dispatch this worktree against an Action the active plan declares."
        }
      : {
          relativePath: project.currentAction ? project.relativePath : plan.relativePath,
          field: "current_action",
          message: `current_action "${currentActionId}" matches no action in plan "${plan.slug}".`,
          remedy: "Point current_action at an existing action id."
        });
    return { context: null, blockers, operatorQuestion: null };
  }

  if (action.status === "done") {
    blockers.push(claimedActionId
      ? {
          relativePath: plan.relativePath,
          field: "claimed_action",
          message: `Claimed Action "${action.id}" is already done.`,
          remedy: "Release the claim on the finished Action; this worktree has no remaining governed work."
        }
      : {
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

  const constitution = readConstitution(repoRoot);
  if (constitution.blocker) {
    blockers.push(constitution.blocker);
  }

  // A registry that calls a writing command read-only makes the noun/verb
  // authority signal lie, and an agent is told to trust that signal before
  // running anything. Checked here so it refuses at the same place every other
  // control-document defect does.
  blockers.push(...checkCapabilityRegistry(repoRoot));

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
    authorization: AUTHORIZATION[action.responsibility] ?? "Unknown responsibility; treat as requires_review.",
    constitution: constitution.reference
  };

  return { context, blockers, operatorQuestion };
}

/**
 * Read `CONSTITUTION.md` from the repository root: its fingerprint, and its
 * text minus the H1 title and any leading or trailing blank lines.
 *
 * A missing Constitution yields no reference, no constraints, and no blocker.
 * Foreign repositories Arcadia manages are not required to have one, and
 * refusing to dispatch over its absence would block work on a rule the
 * repository never adopted.
 *
 * Any other read failure -- a permissions problem, a directory at that path,
 * bad media -- means the repository *has* adopted a Constitution that cannot
 * be shown. That refuses dispatch rather than proceeding without it, but it
 * refuses the way every other failure in this file does: a blocker naming the
 * file, the field, and the repair. Throwing would also fail closed, yet it
 * surfaces through the CLI as an opaque `UNEXPECTED_ERROR`, which tells the
 * operator nothing about which file to fix.
 */
export function readConstitution(repoRoot: string): {
  reference: ConstitutionReference | null;
  constraints: string[];
  blocker: DispatchBlocker | null;
} {
  let raw: string;
  try {
    raw = readFileSync(join(repoRoot, "CONSTITUTION.md"), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { reference: null, constraints: [], blocker: null };
    return {
      reference: null,
      constraints: [],
      blocker: {
        relativePath: "CONSTITUTION.md",
        field: "file",
        message:
          `This repository has a CONSTITUTION.md, but it could not be read (${code ?? "unknown error"}), ` +
          "so the standing constraints cannot be shown to a dispatched agent.",
        remedy:
          "Make CONSTITUTION.md a readable UTF-8 file, or remove it if this repository has not adopted one."
      }
    };
  }
  return { reference: constitutionReference(raw), constraints: constitutionBody(raw), blocker: null };
}

export function constitutionReference(raw: string): ConstitutionReference {
  return { path: "CONSTITUTION.md", sha256: createHash("sha256").update(raw).digest("hex") };
}

function constitutionBody(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const body = lines[0]?.startsWith("# ") ? lines.slice(1) : lines;

  let start = 0;
  let end = body.length;
  while (start < end && body[start].trim() === "") start += 1;
  while (end > start && body[end - 1].trim() === "") end -= 1;
  return body.slice(start, end);
}

/**
 * Load the Constitution text a brief embeds, verified against the reference
 * the dispatch pinned. Fails closed -- never renders a brief without, or with
 * a different, contract -- when the file became unreadable, disappeared,
 * appeared, or changed after it was pinned.
 */
export function loadConstitution(repoRoot: string, expected: ConstitutionReference | null): string[] {
  const current = readConstitution(repoRoot);
  if (current.blocker) {
    throw validationError(current.blocker.message, { relativePath: "CONSTITUTION.md", remedy: current.blocker.remedy });
  }
  if ((current.reference?.sha256 ?? null) !== (expected?.sha256 ?? null)) {
    throw validationError(
      "CONSTITUTION.md changed after this handoff pinned it, so the brief would carry a contract other than the one granted. " +
        "Commit or discard the change, then re-run the command to pin the current Constitution.",
      { relativePath: "CONSTITUTION.md", expected: expected?.sha256 ?? null, actual: current.reference?.sha256 ?? null }
    );
  }
  return current.constraints;
}

/** Everything the documents say about whether one action may start. */
interface ActionReadinessResult {
  blockers: DispatchBlocker[];
  requiredDecisions: DispatchContext["requiredDecisions"];
  operatorQuestion: string | null;
  deferringDecisionId: string | null;
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
  let deferringDecisionId: string | null = null;

  // A deferred Action was parked by an answered Decision against a named
  // reviving condition (Decision 0057 / Issue #310). It is unfinished but must
  // never be selected, so it blocks the same way an unmet dependency does.
  if (action.status === "deferred") {
    blockers.push({
      relativePath: plan.relativePath,
      field: `actions.${action.id}.status`,
      message: `Action "${action.id}" is deferred; dispatch must not select it.`,
      remedy: "Advance the pointer to the next eligible Action in the explicit queue. The deferral revives on its named condition."
    });
  } else {
    // The Decision is authoritative even before its consequence is written
    // into the Plan: an approved `defer` Decision parks its Action at read
    // time, so `arcadia next` and `arcadia go` stop dispatching it without
    // waiting for a command to be run (Issue #310).
    const deferringDecision = deferringDecisionFor(action.id, decisionDocs);
    if (deferringDecision) {
      deferringDecisionId = deferringDecision.id;
      blockers.push({
        relativePath: deferringDecision.relativePath,
        field: `actions.${action.id}.status`,
        message: `Action "${action.id}" is deferred by Decision ${deferringDecision.id}; dispatch must not select it.`,
        remedy: "Advance the pointer to the next eligible Action in the explicit queue, or answer the Decision the other way."
      });
    }
  }

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
    operatorQuestion: action.clarification === "question_open" ? action.question : null,
    deferringDecisionId
  };
}

/**
 * The approved Decision that parks this Action, or null. A Decision governs an
 * Action only when it carries `action:`, and only the option the operator
 * actually recorded (`answer:`) counts. Dispatch, completion resolution, and
 * `arcadia next` all read this so an answered deferral stops dispatch
 * immediately rather than waiting for its consequence to be written.
 */
export function deferringDecisionFor(actionId: string, decisionDocs: DecisionDoc[]): DecisionDoc | null {
  for (const decision of decisionDocs) {
    if (decision.status !== "approved" || decision.action !== actionId) continue;
    const answer = decision.answer?.trim().toLowerCase();
    const chosen = answer
      ? decision.options.find((option) => option.label.trim().toLowerCase() === answer)
      : undefined;
    if (chosen?.effect === "defer") return decision;
  }
  return null;
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
  /** The approved `defer` Decision that parks this Action, when one does. */
  deferringDecisionId: string | null;
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
  return actionReadinessFrom(discoverDocs(repoRoot), projectSlug, actionId);
}

/**
 * The readiness of one Action against documents that have already been read.
 *
 * Split out because a caller that asks about many Actions in one project —
 * `resolveReadySet` does, once per unfinished Action — would otherwise re-scan
 * and re-parse every document in the repository per Action. Reading documents
 * is the expensive half; this is the pure half.
 */
function actionReadinessFrom(
  discovered: DiscoveryResult,
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
    requiredDecisions: [],
    deferringDecisionId: null
  };

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
    requiredDecisions: readiness.requiredDecisions,
    // Reported separately from the blocker text so a caller that needs the
    // Decision's id — to link the operator straight to it — does not have to
    // parse a sentence to recover it.
    deferringDecisionId: readiness.deferringDecisionId
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
    (resolution.context.action.responsibility === "agent" ||
      resolution.context.action.responsibility === "autonomous")
  );
}

/** One Action a coding agent could dispatch right now. */
export interface ReadySetEntry {
  actionId: string;
  title: string;
  responsibility: string;
}

/**
 * The operator gate that stops a batch walk at one Action: the four ways a
 * dependency-clear Action still refuses to move without a human.
 *
 * `capacity_proof_run` is the document-visible proxy for a live proof that
 * spends provider capacity on the operator's own machine — `requires_review`
 * responsibility, the one class `AUTHORIZATION` says a coding agent must not
 * take. The remaining proof Actions in the production Plan are ordinary
 * `agent` work; only the operator-terminal rehearsal carries this.
 */
export type ReadySetGate = "decision" | "deferred" | "question_open" | "capacity_proof_run";

/**
 * One unfinished Action's place in the ready-set walk, in plan declaration
 * order — the whole ordered picture `ready` and `nearest` are derived from, so
 * a caller that needs the Actions *between* ready ones (a batch boundary, say)
 * does not have to re-resolve the plan or guess at the ordering rule.
 */
export interface ReadySetCandidate extends ReadySetEntry {
  /** A coding agent may start this Action now, from the documents alone. */
  ready: boolean;
  /** The operator gate that stops a batch walk here, when one does. */
  gate: ReadySetGate | null;
  /** Why it is not ready, verbatim — the same blockers `nearest` reports. */
  blockers: DispatchBlocker[];
  operatorQuestion: string | null;
  /** Set only when an approved `defer` Decision parks this Action. */
  deferringDecisionId: string | null;
  /** The first unresolved Decision this Action names, when one holds it. */
  requiredDecisionId: string | null;
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
  projectName: string | null;
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
  /** The pointer's current_action, from PROJECT.md or the plan. Null when the
   *  plan declares none. */
  currentAction: string | null;
  /** Every unfinished Action in the plan, in declaration order, with the
   *  readiness and gate each one carries. `ready` is the subset of this list
   *  that may start now, and `nearest` is chosen from it — so a caller reading
   *  the walk and a caller reading the ready set can never disagree. */
  candidates: ReadySetCandidate[];
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
  // Read the repository once and answer every question from that one read:
  // resolving the active plan and every Action's readiness from separate scans
  // would re-parse every document in the repository once per unfinished Action.
  const discovered = discoverDocs(repoRoot);
  const { project, plan, blockers } = resolveActivePlan(repoRoot, projectSlug, discovered);

  if (!project || !plan) {
    return {
      projectSlug: project?.slug ?? projectSlug ?? null,
      projectName: project?.name ?? null,
      planSlug: null,
      planPath: null,
      planTokenImpact: null,
      planTokenBudget: null,
      blockers,
      ready: [],
      currentAction: null,
      candidates: [],
      suggestedCurrentAction: null,
      nearest: null
    };
  }

  const resolvedProjectSlug = project.slug;
  const planSlug = plan.slug;
  const planPath = plan.relativePath;
  const currentActionId = project.currentAction ?? plan.currentAction;

  // Every unfinished Action, so the walk can see the gates themselves (a
  // deferred or blocked Action is a stop, not an absence). `blocked` and
  // `deferred` are read but excluded from `ready`/`nearest` below, exactly as
  // they were before this list existed — a caller that only wants the ready
  // set sees no change.
  const evaluatedAll = plan.actions
    .filter((action) => action.status !== "done")
    .map((action) => {
      const readiness = actionReadinessFrom(discovered, resolvedProjectSlug, action.id);
      const authorized = action.responsibility === "agent" || action.responsibility === "autonomous";
      const isReady = readiness.blockers.length === 0 && readiness.operatorQuestion === null && authorized;
      return { action, readiness, isReady };
    });

  const evaluated = evaluatedAll.filter(
    ({ action }) => action.status !== "blocked" && action.status !== "deferred"
  );

  const ready: ReadySetEntry[] = evaluated
    .filter((entry) => entry.isReady)
    .map((entry) => ({
      actionId: entry.action.id,
      title: entry.action.title,
      responsibility: entry.action.responsibility
    }));

  const candidates: ReadySetCandidate[] = evaluatedAll.map((entry) => ({
    actionId: entry.action.id,
    title: entry.action.title,
    responsibility: entry.action.responsibility,
    ready: entry.isReady,
    gate: readySetGateFor(entry.action, entry.readiness),
    blockers: entry.readiness.blockers,
    operatorQuestion: entry.readiness.operatorQuestion,
    deferringDecisionId: entry.readiness.deferringDecisionId,
    requiredDecisionId: entry.readiness.requiredDecisions.find((decision) => !decision.resolved)?.id ?? null
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
    projectName: project.name,
    planSlug,
    planPath,
    planTokenImpact: plan.tokenImpact,
    planTokenBudget: plan.tokenBudget,
    blockers: [],
    ready,
    currentAction: currentActionId,
    candidates,
    suggestedCurrentAction,
    nearest
  };
}

/**
 * Which operator gate stops a batch walk at this Action, or null when none
 * does.
 *
 * Ordered by how directly the document states it: a deferral is a recorded
 * decision about this Action, an open question is the clarification field, a
 * required Decision is a named reference, and `requires_review` is the
 * standing "a coding agent must not implement this" responsibility.
 */
function readySetGateFor(action: PlanActionDoc, readiness: ActionReadinessResult): ReadySetGate | null {
  if (action.status === "deferred" || readiness.deferringDecisionId) return "deferred";
  if (action.clarification === "question_open") return "question_open";
  if (readiness.requiredDecisions.some((decision) => !decision.resolved)) return "decision";
  if (action.responsibility === "requires_review") return "capacity_proof_run";
  return null;
}

export type { ArcadiaDoc };
