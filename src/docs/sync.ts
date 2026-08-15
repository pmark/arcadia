import type Database from "better-sqlite3";
import {
  createMilestoneForProject,
  createMissionLog,
  createReviewItem,
  createWorkItemRecord,
  getMilestoneByDocRef,
  getMilestoneByTitle,
  getMissionLogByDocRef,
  getProjectMetadata,
  getReviewItemByDocRef,
  getWorkItemByDocRef,
  listWorkItemDependencies,
  replaceDocumentWorkItemDependencies,
  setMilestoneDocRef,
  setMissionLogDocRef,
  setReviewItemDocRef,
  setWorkItemDocRef,
  updateMilestoneStatus,
  updateMilestoneTitle,
  updateMissionLogFromDoc,
  updateProject,
  updateReviewItemFromDoc,
  updateWorkItem
} from "../db/repositories.js";
import { queueForWorkClassification, type WorkClassification } from "../domain/constants.js";
import type { Project } from "../domain/types.js";
import { executionRequirementToPortableValue } from "../execution/profiles.js";
import { discoverDocs } from "./discover.js";
import {
  actionDocRef,
  decisionDocRef,
  logEntryDocRef,
  planDocRef,
  planMilestoneDocRef,
  planQuestionDocRef,
  type ArcadiaDoc,
  type DecisionDoc,
  type DocValidationError,
  type LogDoc,
  type PlanDoc,
  type PlanActionDoc,
  type PlanStatus,
  type ProjectDoc
} from "./types.js";

/**
 * The same placeholder `capture` writes. An Action that a document has not
 * decided must not carry a next action that reads like a decision — the
 * clarification columns hold the truth, exactly as they do after capture.
 */
const PLACEHOLDER_NEXT_ACTION = "Clarify the desired outcome or approve a Codex execution path.";

/**
 * What a Log entry's `next_action` says when the entry recorded no **Next:**
 * bullet. The column is NOT NULL, and inventing a plausible next action from
 * the entry's prose would put a sentence nobody wrote into the operator's
 * history — so the absence is stated instead of filled.
 */
const NO_LOGGED_NEXT_ACTION = "No next action recorded in this Log entry.";

/** The intent Phase 3 uses for a question awaiting an answer. */
const ACTION_CLARIFICATION_INTENT = "ActionClarification";

export type ChangeAction = "create" | "update" | "unchanged" | "skipped";
export type ChangeEntity =
  | "project"
  | "milestone"
  | "action"
  | "dependency"
  | "question"
  | "decision"
  | "log"
  | "narrative";

export interface DocChange {
  action: ChangeAction;
  entity: ChangeEntity;
  relativePath: string;
  ref: string;
  title: string;
  /** Present for `skipped`, and for `update` to say what moved. */
  reason?: string;
}

export interface ProjectSyncResult {
  projectId: string;
  projectSlug: string;
  repoRoot: string | null;
  changes: DocChange[];
  errors: DocValidationError[];
  rejected: string[];
  /** Docs found whose `project:` slug points somewhere else. */
  foreign: string[];
}

/**
 * Ingest one project's repository.
 *
 * `apply: false` computes every change without writing, which is the default
 * everywhere this is called from. The computation is identical in both modes —
 * the dry run is the real thing with the writes withheld, not a separate
 * estimate that can drift from what `--apply` would do.
 */
export function syncProjectDocs(
  db: Database.Database,
  project: Project,
  options: { apply: boolean }
): ProjectSyncResult {
  const metadata = getProjectMetadata(db, project.id);
  const repoRoot = metadata?.repo_path?.trim() || null;

  const result: ProjectSyncResult = {
    projectId: project.id,
    projectSlug: project.slug,
    repoRoot,
    changes: [],
    errors: [],
    rejected: [],
    foreign: []
  };

  if (!repoRoot) {
    result.changes.push({
      action: "skipped",
      entity: "project",
      relativePath: "-",
      ref: project.slug,
      title: project.name,
      reason: "No repo_path recorded for this Project; nothing to crawl."
    });
    return result;
  }

  const discovered = discoverDocs(repoRoot);
  result.errors.push(...discovered.errors);
  result.rejected.push(...discovered.rejected);

  const mine: ArcadiaDoc[] = [];
  for (const doc of discovered.docs) {
    if (doc.type === "scoped_out") {
      result.changes.push({
        action: "skipped",
        entity: "narrative",
        relativePath: doc.relativePath,
        ref: doc.sourceType,
        title: doc.sourceStatus ?? doc.sourceType,
        reason: "Supporting record is governed outside Arcadia dispatch."
      });
      continue;
    }
    const owner = doc.type === "project" ? doc.slug : doc.project;
    if (owner.toLowerCase() !== project.slug.toLowerCase()) {
      result.foreign.push(`${doc.relativePath} (project: ${owner})`);
      continue;
    }
    mine.push(doc);
  }

  const projectDoc = mine.find((doc): doc is ProjectDoc => doc.type === "project") ?? null;
  const plans = mine.filter((doc): doc is PlanDoc => doc.type === "plan");
  const decisions = mine.filter((doc): doc is DecisionDoc => doc.type === "decision");
  const logs = mine.filter((doc): doc is LogDoc => doc.type === "log");

  // A ref claimed twice would make ingestion order decide who wins, so refuse
  // both rather than silently letting the later file overwrite the earlier.
  const claimed = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const plan of plans) {
    for (const ref of [planDocRef(plan.slug), ...plan.actions.map((a) => actionDocRef(plan.slug, a.id))]) {
      const existing = claimed.get(ref);
      if (existing && existing !== plan.relativePath) {
        conflicting.add(ref);
        result.errors.push({
          relativePath: plan.relativePath,
          field: "slug",
          message: `Reference "${ref}" is also claimed by ${existing}.`
        });
      }
      claimed.set(ref, plan.relativePath);
    }
  }
  for (const decision of decisions) {
    const ref = decisionDocRef(decision.slug);
    const existing = claimed.get(ref);
    if (existing && existing !== decision.relativePath) {
      conflicting.add(ref);
      result.errors.push({
        relativePath: decision.relativePath,
        field: "slug",
        message: `Reference "${ref}" is also claimed by ${existing}.`
      });
    }
    claimed.set(ref, decision.relativePath);
  }
  // Two entries sharing a whole heading is the one collision a Log can produce
  // on its own. Reported once per contested heading rather than once per
  // repetition, so a file that repeats a heading five times says so once.
  for (const log of logs) {
    const seenHeadings = new Set<string>();
    for (const entry of log.entries) {
      const ref = logEntryDocRef(log.slug, entry.date, entry.title);
      const existing = claimed.get(ref);
      if (existing && existing !== log.relativePath) {
        conflicting.add(ref);
        result.errors.push({
          relativePath: log.relativePath,
          field: "slug",
          message: `Reference "${ref}" is also claimed by ${existing}.`
        });
      } else if (seenHeadings.has(ref) && !conflicting.has(ref)) {
        conflicting.add(ref);
        result.errors.push({
          relativePath: log.relativePath,
          field: `entry(${entry.date})`,
          message: `Two Log entries share the heading "${entry.date} — ${entry.title}"; the heading is the entry's key, so one would overwrite the other.`
        });
      }
      seenHeadings.add(ref);
      claimed.set(ref, log.relativePath);
    }
  }

  // Shared across every document in one run so a milestone named by both
  // PROJECT.md and a plan is created once, not twice.
  const plannedMilestones = new Map<string, string | null>();

  if (projectDoc) {
    result.changes.push(...syncProject(db, project, projectDoc, options.apply, plannedMilestones));
  }

  for (const plan of plans) {
    if (conflicting.has(planDocRef(plan.slug))) {
      continue;
    }
    result.changes.push(
      ...syncPlan(db, project, plan, decisions, conflicting, options.apply, plannedMilestones)
    );
  }

  for (const decision of decisions) {
    if (conflicting.has(decisionDocRef(decision.slug))) {
      continue;
    }
    result.changes.push(syncDecision(db, project, decision, options.apply));
  }

  for (const log of logs) {
    result.changes.push(...syncLog(db, project, log, conflicting, options.apply));
  }

  // Recognized but not yet ingested. Reported rather than ignored so the
  // operator can see the protocol knows about them and this build does not
  // handle them yet.
  for (const doc of mine) {
    if (doc.type === "architecture" || doc.type === "strategy" || doc.type === "reference") {
      result.changes.push({
        action: "skipped",
        entity: "narrative",
        relativePath: doc.relativePath,
        ref: doc.slug,
        title: doc.type,
        reason: "Narrative summarization is not implemented yet."
      });
    }
  }

  return result;
}

function syncProject(
  db: Database.Database,
  project: Project,
  doc: ProjectDoc,
  apply: boolean,
  planned: Map<string, string | null>
): DocChange[] {
  const changes: DocChange[] = [];
  const staleness = stalenessOf(doc.updated, project.updated_at);

  const drift: Array<[string, unknown, unknown]> = [
    ["name", project.name, doc.name],
    ["status", project.status, doc.status],
    ["goal", project.goal ?? null, doc.goal]
  ];
  const changed = drift.filter(([, current, next]) => (current ?? null) !== (next ?? null));

  if (changed.length === 0) {
    changes.push({
      action: "unchanged",
      entity: "project",
      relativePath: doc.relativePath,
      ref: doc.slug,
      title: doc.name
    });
  } else if (staleness) {
    changes.push({
      action: "skipped",
      entity: "project",
      relativePath: doc.relativePath,
      ref: doc.slug,
      title: doc.name,
      reason: staleness
    });
  } else {
    if (apply) {
      updateProject(db, project.id, { status: doc.status, mission: doc.name, goal: doc.goal });
    }
    changes.push({
      action: "update",
      entity: "project",
      relativePath: doc.relativePath,
      ref: doc.slug,
      title: doc.name,
      reason: describeDrift(changed)
    });
  }

  // The milestone PROJECT.md names is the one being pursued, so it is active by
  // definition. Plans sync after this and may narrow it: a plan that is over
  // ends its own milestone, and the more specific statement wins.
  if (doc.milestone) {
    changes.push(
      ...ensureMilestone(db, project, doc.milestone, null, doc.relativePath, apply, planned, "active")
    );
  }

  return changes;
}

function syncPlan(
  db: Database.Database,
  project: Project,
  doc: PlanDoc,
  decisions: DecisionDoc[],
  conflicting: Set<string>,
  apply: boolean,
  planned: Map<string, string | null>
): DocChange[] {
  const changes: DocChange[] = [];
  const ref = planDocRef(doc.slug);
  const milestoneTitle = doc.milestone ?? doc.slug;
  const planMilestoneStatus = milestoneStatusForPlan(doc.status);

  const milestoneChanges = ensureMilestone(
    db,
    project,
    milestoneTitle,
    ref,
    doc.relativePath,
    apply,
    planned,
    planMilestoneStatus
  );
  changes.push(...milestoneChanges);

  const milestone =
    getMilestoneByDocRef(db, project.id, ref) ?? getMilestoneByTitle(db, project.id, milestoneTitle);

  // An action may name a milestone other than the plan's own. Its ref is
  // distinct from `plan/<slug>` so the plan's own milestone keeps the identity
  // every existing row was ingested under; nothing needs migrating.
  const overrides = new Map<string, string | null>();
  for (const action of doc.actions) {
    if (!action.milestone || action.milestone === milestoneTitle || overrides.has(action.milestone)) {
      continue;
    }
    const overrideRef = planMilestoneDocRef(doc.slug, action.milestone);
    changes.push(
      ...ensureMilestone(
        db,
        project,
        action.milestone,
        overrideRef,
        doc.relativePath,
        apply,
        planned,
        planMilestoneStatus
      )
    );
    const resolved =
      getMilestoneByDocRef(db, project.id, overrideRef) ??
      getMilestoneByTitle(db, project.id, action.milestone);
    overrides.set(action.milestone, resolved?.id ?? null);
  }

  for (const action of doc.actions) {
    const actionRef = actionDocRef(doc.slug, action.id);
    if (conflicting.has(actionRef)) {
      continue;
    }
    const actionMilestoneId =
      action.milestone && action.milestone !== milestoneTitle
        ? overrides.get(action.milestone) ?? milestone?.id ?? null
        : milestone?.id ?? null;
    changes.push(
      syncAction(db, project, doc, action, actionRef, actionMilestoneId, apply)
    );
  }

  // Dependencies run as a second pass over the same plan: an action may depend
  // on one declared later in the list, so both endpoints must exist as rows
  // before any edge can be resolved.
  changes.push(...syncPlanDependencies(db, doc, conflicting, apply));

  for (const question of doc.questions) {
    changes.push(syncPlanQuestion(db, project, doc, question, decisions, apply));
  }

  return changes;
}

/**
 * Persist each action's `depends_on` as edges between the ingested Actions.
 *
 * Reported in terms of doc refs rather than row ids, so a dry run describes
 * exactly the change `--apply` performs even when both endpoints are rows that
 * do not exist yet. The parser has already rejected any dependency naming an id
 * outside this plan, so an unresolved ref here means the target action was
 * skipped as conflicting, not that the document is wrong.
 */
function syncPlanDependencies(
  db: Database.Database,
  doc: PlanDoc,
  conflicting: Set<string>,
  apply: boolean
): DocChange[] {
  const changes: DocChange[] = [];

  for (const action of doc.actions) {
    const actionRef = actionDocRef(doc.slug, action.id);
    if (conflicting.has(actionRef)) {
      continue;
    }

    const desiredRefs = action.dependsOn
      .filter((dependency) => dependency !== action.id)
      .map((dependency) => actionDocRef(doc.slug, dependency))
      .filter((dependencyRef) => !conflicting.has(dependencyRef));

    const existingItem = getWorkItemByDocRef(db, actionRef);
    const currentRefs = existingItem
      ? listWorkItemDependencies(db, existingItem.id)
          .filter((dependency) => dependency.docRef !== null)
          .map((dependency) => dependency.docRef as string)
      : [];

    if (sameRefSet(currentRefs, desiredRefs)) {
      if (desiredRefs.length === 0) {
        continue;
      }
      changes.push({
        action: "unchanged",
        entity: "dependency",
        relativePath: doc.relativePath,
        ref: actionRef,
        title: describeDependencies(desiredRefs)
      });
      continue;
    }

    // Dry run: the endpoints may be planned-but-unwritten, so there is nothing
    // to resolve yet. The ref-level comparison above is already the real answer.
    if (!apply) {
      changes.push({
        action: existingItem && currentRefs.length > 0 ? "update" : "create",
        entity: "dependency",
        relativePath: doc.relativePath,
        ref: actionRef,
        title: describeDependencies(desiredRefs),
        reason: describeDependencyDrift(currentRefs, desiredRefs)
      });
      continue;
    }

    const dependent = existingItem ?? getWorkItemByDocRef(db, actionRef);
    if (!dependent) {
      changes.push({
        action: "skipped",
        entity: "dependency",
        relativePath: doc.relativePath,
        ref: actionRef,
        title: describeDependencies(desiredRefs),
        reason: "The dependent Action was not ingested, so its ordering has nothing to attach to."
      });
      continue;
    }

    const targetIds: string[] = [];
    const unresolved: string[] = [];
    for (const dependencyRef of desiredRefs) {
      const target = getWorkItemByDocRef(db, dependencyRef);
      if (target) {
        targetIds.push(target.id);
      } else {
        unresolved.push(dependencyRef);
      }
    }

    replaceDocumentWorkItemDependencies(db, dependent.id, actionRef, targetIds);

    changes.push({
      action: currentRefs.length > 0 ? "update" : "create",
      entity: "dependency",
      relativePath: doc.relativePath,
      ref: actionRef,
      title: describeDependencies(desiredRefs),
      reason:
        unresolved.length > 0
          ? `${describeDependencyDrift(currentRefs, desiredRefs)}; unresolved: ${unresolved.join(", ")}`
          : describeDependencyDrift(currentRefs, desiredRefs)
    });
  }

  return changes;
}

function sameRefSet(current: string[], desired: string[]): boolean {
  if (current.length !== desired.length) {
    return false;
  }
  const currentSet = new Set(current);
  return desired.every((ref) => currentSet.has(ref));
}

function describeDependencies(refs: string[]): string {
  if (refs.length === 0) {
    return "no dependencies";
  }
  return `depends on ${refs.length} action${refs.length === 1 ? "" : "s"}`;
}

function describeDependencyDrift(current: string[], desired: string[]): string {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  const added = desired.filter((ref) => !currentSet.has(ref));
  const removed = current.filter((ref) => !desiredSet.has(ref));
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`+${added.join(", +")}`);
  }
  if (removed.length > 0) {
    parts.push(`-${removed.join(", -")}`);
  }
  return parts.join(" ") || "no change";
}

function syncAction(
  db: Database.Database,
  project: Project,
  plan: PlanDoc,
  action: PlanActionDoc,
  ref: string,
  milestoneId: string | null,
  apply: boolean
): DocChange {
  const existing = getWorkItemByDocRef(db, ref);
  const responsibility = action.responsibility as WorkClassification;
  const desired = {
    title: action.title,
    status: action.status,
    work_classification: responsibility,
    queue: queueForWorkClassification(responsibility),
    next_action: action.nextAction ?? PLACEHOLDER_NEXT_ACTION,
    expected_artifact: action.expectedArtifact,
    effort: action.effort,
    clarification_status: action.clarification,
    gap_type: action.gapType,
    open_question: action.question,
    confidence: action.confidence,
    clarification_source: action.source,
    execution_requirement_json: action.execution
      ? JSON.stringify(executionRequirementToPortableValue(action.execution))
      : null,
    // Kept as declared, in order: these are the plan author's words, and the
    // packet builder quotes them to the coding agent verbatim. An empty list
    // stores NULL so "declared none" and "never came from a plan" read alike
    // downstream — neither gives the agent anything to satisfy.
    acceptance_criteria_json:
      action.acceptanceCriteria.length > 0 ? JSON.stringify(action.acceptanceCriteria) : null
  };

  if (!existing) {
    if (apply) {
      const created = createWorkItemRecord(db, {
        projectId: project.id,
        milestoneId,
        title: desired.title,
        rawInput: `${plan.relativePath}#${action.id}`,
        queue: desired.queue,
        workClassification: responsibility,
        nextAction: desired.next_action,
        expectedArtifact: desired.expected_artifact ?? undefined,
        status: desired.status,
        clarificationStatus: desired.clarification_status ?? undefined
      });
      setWorkItemDocRef(db, created.id, ref);
      updateWorkItem(db, created.id, {
        effort: desired.effort,
        gapType: desired.gap_type,
        openQuestion: desired.open_question,
        confidence: desired.confidence,
        clarificationSource: desired.clarification_source,
        executionRequirementJson: desired.execution_requirement_json,
        acceptanceCriteriaJson: desired.acceptance_criteria_json
      });
    }
    return {
      action: "create",
      entity: "action",
      relativePath: plan.relativePath,
      ref,
      title: action.title
    };
  }

  const drift: Array<[string, unknown, unknown]> = [
    ["title", existing.title, desired.title],
    ["status", existing.status, desired.status],
    ["responsibility", existing.work_classification, desired.work_classification],
    ["next_action", existing.next_action, desired.next_action],
    ["expected_artifact", existing.expected_artifact, desired.expected_artifact],
    ["effort", existing.effort, desired.effort],
    ["clarification", existing.clarification_status, desired.clarification_status],
    ["gap_type", existing.gap_type, desired.gap_type],
    ["question", existing.open_question, desired.open_question],
    ["confidence", existing.confidence, desired.confidence],
    ["source", existing.clarification_source, desired.clarification_source],
    ["execution", existing.execution_requirement_json, desired.execution_requirement_json],
    ["acceptance_criteria", existing.acceptance_criteria_json, desired.acceptance_criteria_json]
  ];
  const changed = drift.filter(([, current, next]) => (current ?? null) !== (next ?? null));

  if (changed.length === 0) {
    return { action: "unchanged", entity: "action", relativePath: plan.relativePath, ref, title: action.title };
  }

  const staleness = stalenessOf(plan.updated, existing.updated_at);
  if (staleness) {
    return {
      action: "skipped",
      entity: "action",
      relativePath: plan.relativePath,
      ref,
      title: action.title,
      reason: staleness
    };
  }

  if (apply) {
    updateWorkItem(db, existing.id, {
      queue: desired.queue,
      workClassification: desired.work_classification,
      nextAction: desired.next_action,
      status: desired.status,
      effort: desired.effort,
      expectedArtifact: desired.expected_artifact,
      clarificationStatus: desired.clarification_status,
      gapType: desired.gap_type,
      openQuestion: desired.open_question,
      confidence: desired.confidence,
      clarificationSource: desired.clarification_source,
      executionRequirementJson: desired.execution_requirement_json,
      acceptanceCriteriaJson: desired.acceptance_criteria_json
    });
    if (existing.title !== desired.title) {
      db.prepare("UPDATE work_items SET title = ? WHERE id = ?").run(desired.title, existing.id);
    }
  }

  return {
    action: "update",
    entity: "action",
    relativePath: plan.relativePath,
    ref,
    title: action.title,
    reason: describeDrift(changed)
  };
}

/**
 * A plan-level question becomes the same kind of Decision `review open`
 * authors, so it surfaces in `review`, `attention`, and the Dashboard rather
 * than staying buried in a file.
 */
function syncPlanQuestion(
  db: Database.Database,
  project: Project,
  plan: PlanDoc,
  question: { id: string; question: string; gapType: string | null; decision?: string | null },
  decisions: DecisionDoc[],
  apply: boolean
): DocChange {
  const ref = planQuestionDocRef(plan.slug, question.id);
  const existing = getReviewItemByDocRef(db, ref);

  // A question naming a decision inherits that decision's resolution. Ingestion
  // never deletes, so without this a question answered elsewhere stays open in
  // the queue forever; and resolving on the question's *absence* instead would
  // mean a doc that merely trails reality silently closes live work.
  const answering = question.decision
    ? decisions.find((doc) => doc.id === question.decision || doc.slug === question.decision) ?? null
    : null;

  if (question.decision && !answering) {
    return {
      action: "skipped",
      entity: "question",
      relativePath: plan.relativePath,
      ref,
      title: question.question,
      reason: `Names decision "${question.decision}", which has no document in this project.`
    };
  }

  const resolution = answering && answering.status !== "open" ? answering : null;

  // The decision document raises its own Decision, so a question naming one
  // must not raise a second. The question stays in the plan as the record of
  // what was asked; the decision owns the queue entry. Questions that predate
  // their decision keep an existing row and go on mirroring its resolution.
  if (answering && !existing) {
    return {
      action: "skipped",
      entity: "question",
      relativePath: plan.relativePath,
      ref,
      title: question.question,
      reason: `Surfaced by decision ${answering.id}; not raised twice.`
    };
  }

  if (!existing) {
    if (apply) {
      const created = createReviewItem(db, {
        projectId: project.id,
        decisionNeeded: question.question,
        recommendation: null,
        sourceInput: `${plan.relativePath} (${plan.slug})`,
        proposedAction: `Answer the open question from plan ${plan.slug}.`,
        resolvedIntent: ACTION_CLARIFICATION_INTENT,
        confidenceLabel: "medium",
        confidence: 0,
        missingFields: question.gapType ? [question.gapType] : [],
        context: { schemaVersion: 1, gapType: question.gapType, docRef: ref, source: plan.relativePath }
      });
      setReviewItemDocRef(db, created.id, ref);
      if (resolution) {
        updateReviewItemFromDoc(db, created.id, {
          decisionNeeded: question.question,
          recommendation: resolution.recommendation,
          status: resolution.status,
          decisionNote: resolution.answer,
          decidedAt: resolution.decided,
          confidenceLabel: resolution.confidence ?? "medium",
          missingFields: question.gapType ? [question.gapType] : []
        });
      }
    }
    return { action: "create", entity: "question", relativePath: plan.relativePath, ref, title: question.question };
  }

  if (resolution && existing.status !== resolution.status) {
    if (apply) {
      updateReviewItemFromDoc(db, existing.id, {
        decisionNeeded: question.question,
        recommendation: resolution.recommendation,
        status: resolution.status,
        decisionNote: resolution.answer,
        decidedAt: resolution.decided,
        confidenceLabel: resolution.confidence ?? existing.confidence_label,
        missingFields: question.gapType ? [question.gapType] : []
      });
    }
    return {
      action: "update",
      entity: "question",
      relativePath: plan.relativePath,
      ref,
      title: question.question,
      reason: `resolved by decision ${answering!.id}: ${existing.status} -> ${resolution.status}`
    };
  }

  if (existing.decision_needed === question.question) {
    return {
      action: "unchanged",
      entity: "question",
      relativePath: plan.relativePath,
      ref,
      title: question.question
    };
  }

  // A question the operator already decided is history. Rewording the document
  // must not silently reopen it.
  if (existing.status !== "open" && existing.status !== "deferred") {
    return {
      action: "skipped",
      entity: "question",
      relativePath: plan.relativePath,
      ref,
      title: question.question,
      reason: `Decision ${existing.slug ?? existing.id} is already ${existing.status}; not reopening it.`
    };
  }

  if (apply) {
    updateReviewItemFromDoc(db, existing.id, {
      decisionNeeded: question.question,
      recommendation: existing.recommendation,
      status: existing.status,
      decisionNote: existing.decision_note,
      decidedAt: existing.decided_at,
      confidenceLabel: existing.confidence_label,
      missingFields: question.gapType ? [question.gapType] : []
    });
  }

  return {
    action: "update",
    entity: "question",
    relativePath: plan.relativePath,
    ref,
    title: question.question,
    reason: "question text changed"
  };
}

/**
 * Ingest one mission Log file, one row per dated entry.
 *
 * A Log is append-only in practice, so the common path here is "every entry
 * already exists and one new one is at the top": re-running touches nothing,
 * and the single new heading creates the single new row.
 */
function syncLog(
  db: Database.Database,
  project: Project,
  doc: LogDoc,
  conflicting: Set<string>,
  apply: boolean
): DocChange[] {
  const changes: DocChange[] = [];

  for (const entry of doc.entries) {
    const ref = logEntryDocRef(doc.slug, entry.date, entry.title);
    if (conflicting.has(ref)) {
      continue;
    }

    const title = `${entry.date} — ${entry.title}`;
    const nextAction = entry.next ?? NO_LOGGED_NEXT_ACTION;
    const existing = getMissionLogByDocRef(db, ref);

    if (!existing) {
      if (apply) {
        const created = createMissionLog(db, {
          projectId: project.id,
          workPerformed: entry.did,
          result: entry.result,
          nextAction,
          blockers: entry.blockers ?? undefined,
          markdownPath: doc.relativePath
        });
        setMissionLogDocRef(db, created.id, ref);
      }
      changes.push({ action: "create", entity: "log", relativePath: doc.relativePath, ref, title });
      continue;
    }

    const drift: Array<[string, unknown, unknown]> = [
      ["did", existing.work_performed, entry.did],
      ["result", existing.result, entry.result],
      ["next", existing.next_action, nextAction],
      ["blockers", existing.blockers, entry.blockers],
      ["path", existing.markdown_path, doc.relativePath]
    ];
    const changed = drift.filter(([, current, next]) => (current ?? null) !== (next ?? null));

    if (changed.length === 0) {
      changes.push({ action: "unchanged", entity: "log", relativePath: doc.relativePath, ref, title });
      continue;
    }

    const staleness = stalenessOf(doc.updated, existing.updated_at);
    if (staleness) {
      changes.push({ action: "skipped", entity: "log", relativePath: doc.relativePath, ref, title, reason: staleness });
      continue;
    }

    if (apply) {
      updateMissionLogFromDoc(db, existing.id, {
        workPerformed: entry.did,
        result: entry.result,
        nextAction,
        blockers: entry.blockers,
        markdownPath: doc.relativePath
      });
    }

    changes.push({
      action: "update",
      entity: "log",
      relativePath: doc.relativePath,
      ref,
      title,
      reason: describeDrift(changed)
    });
  }

  return changes;
}

function syncDecision(
  db: Database.Database,
  project: Project,
  doc: DecisionDoc,
  apply: boolean
): DocChange {
  const ref = decisionDocRef(doc.slug);
  const existing = getReviewItemByDocRef(db, ref);
  const title = `${doc.id} ${doc.question}`;

  if (!existing) {
    if (apply) {
      const created = createReviewItem(db, {
        projectId: project.id,
        decisionNeeded: doc.question,
        recommendation: doc.recommendation,
        sourceInput: `${doc.relativePath} (${doc.slug})`,
        proposedAction: `Resolve decision ${doc.id}: ${doc.slug}.`,
        resolvedIntent: ACTION_CLARIFICATION_INTENT,
        confidenceLabel: doc.confidence ?? "medium",
        confidence: 0,
        missingFields: doc.gapType ? [doc.gapType] : [],
        context: { schemaVersion: 1, gapType: doc.gapType, docRef: ref, source: doc.relativePath }
      });
      setReviewItemDocRef(db, created.id, ref);
      // A document may arrive already decided — a decision the operator made in
      // the conversation that produced it. Record the resolution, don't re-ask.
      if (doc.status !== "open") {
        updateReviewItemFromDoc(db, created.id, {
          decisionNeeded: doc.question,
          recommendation: doc.recommendation,
          status: doc.status,
          decisionNote: doc.answer,
          decidedAt: doc.decided,
          confidenceLabel: doc.confidence ?? "medium",
          missingFields: doc.gapType ? [doc.gapType] : []
        });
      }
    }
    return { action: "create", entity: "decision", relativePath: doc.relativePath, ref, title };
  }

  const drift: Array<[string, unknown, unknown]> = [
    ["question", existing.decision_needed, doc.question],
    ["recommendation", existing.recommendation, doc.recommendation],
    ["status", existing.status, doc.status],
    ["answer", existing.decision_note, doc.answer]
  ];
  const changed = drift.filter(([, current, next]) => (current ?? null) !== (next ?? null));

  if (changed.length === 0) {
    return { action: "unchanged", entity: "decision", relativePath: doc.relativePath, ref, title };
  }

  const staleness = stalenessOf(doc.updated, existing.updated_at);
  if (staleness) {
    return { action: "skipped", entity: "decision", relativePath: doc.relativePath, ref, title, reason: staleness };
  }

  if (apply) {
    updateReviewItemFromDoc(db, existing.id, {
      decisionNeeded: doc.question,
      recommendation: doc.recommendation,
      status: doc.status,
      decisionNote: doc.answer,
      decidedAt: doc.decided,
      confidenceLabel: doc.confidence ?? existing.confidence_label,
      missingFields: doc.gapType ? [doc.gapType] : []
    });
  }

  return {
    action: "update",
    entity: "decision",
    relativePath: doc.relativePath,
    ref,
    title,
    reason: describeDrift(changed)
  };
}

/**
 * The milestone lifecycle a plan's own status implies.
 *
 * Milestones are created by plans, so nothing else can know when one is over.
 * Without this a finished plan left its milestone `active` forever, and
 * `current_milestone` — which picks the newest active milestone — reported a
 * milestone from a completed plan, decided by insertion order rather than
 * intent. `draft` maps to active because a plan being drafted is still the
 * milestone being pursued; only a plan that is over ends its milestone.
 */
function milestoneStatusForPlan(planStatus: PlanStatus): string {
  return planStatus === "complete" || planStatus === "superseded" ? "completed" : "active";
}

function ensureMilestone(
  db: Database.Database,
  project: Project,
  title: string,
  ref: string | null,
  relativePath: string,
  apply: boolean,
  planned: Map<string, string | null>,
  desiredStatus: string
): DocChange[] {
  const byRef = ref ? getMilestoneByDocRef(db, project.id, ref) : null;
  const existing = byRef ?? getMilestoneByTitle(db, project.id, title);

  // In a dry run nothing is written, so a milestone this same run already
  // decided to create is invisible to the queries above. Without this the
  // preview would report two creates where `--apply` does one create and one
  // adopt — the preview has to be the real thing with writes withheld, not an
  // estimate that drifts from it.
  const key = title.toLowerCase();
  if (!existing && planned.has(key)) {
    const plannedRef = planned.get(key) ?? null;
    if (ref && plannedRef !== ref) {
      planned.set(key, ref);
      return [
        {
          action: "update",
          entity: "milestone",
          relativePath,
          ref,
          title,
          reason: "adopted an existing milestone with the same title"
        }
      ];
    }
    return [{ action: "unchanged", entity: "milestone", relativePath, ref: ref ?? title, title }];
  }

  if (!existing) {
    planned.set(key, ref);
    if (apply) {
      const created = createMilestoneForProject(db, project.id, title);
      if (created) {
        if (ref) {
          setMilestoneDocRef(db, created.id, ref);
        }
        if (created.status !== desiredStatus) {
          updateMilestoneStatus(db, created.id, desiredStatus);
        }
      }
    }
    return [
      { action: "create", entity: "milestone", relativePath, ref: ref ?? title, title }
    ];
  }

  const reasons: string[] = [];

  // Adopting an existing same-titled milestone is what makes a first sync
  // attach to work already in Arcadia instead of duplicating it.
  if (ref && !byRef) {
    if (apply) {
      setMilestoneDocRef(db, existing.id, ref);
    }
    reasons.push("adopted an existing milestone with the same title");
  }

  if (existing.title !== title) {
    if (apply) {
      updateMilestoneTitle(db, existing.id, title);
    }
    reasons.push(`title: "${existing.title}" -> "${title}"`);
  }

  if (existing.status !== desiredStatus) {
    if (apply) {
      updateMilestoneStatus(db, existing.id, desiredStatus);
    }
    reasons.push(`status: ${existing.status} -> ${desiredStatus}`);
  }

  if (reasons.length === 0) {
    return [{ action: "unchanged", entity: "milestone", relativePath, ref: ref ?? title, title }];
  }

  return [
    {
      action: "update",
      entity: "milestone",
      relativePath,
      ref: ref ?? title,
      title,
      reason: reasons.join("; ")
    }
  ];
}

/**
 * Guards against a stale document overwriting fresher work.
 *
 * Arcadia touches rows itself — `clarify` rewrites a next action, `work update`
 * changes a queue. A document written before that happened describes an older
 * world, and applying it would silently undo the newer change. Day-granularity
 * comparison is deliberate: documents carry dates, not timestamps, so
 * same-day edits are allowed through rather than being rejected as ties.
 */
function stalenessOf(docUpdated: string, rowUpdatedAt: string): string | null {
  const rowDate = rowUpdatedAt.slice(0, 10);
  if (docUpdated >= rowDate) {
    return null;
  }
  return `Document is dated ${docUpdated}, older than the record's ${rowDate}; not overwriting newer work.`;
}

function describeDrift(changed: Array<[string, unknown, unknown]>): string {
  return changed
    .map(([field, current, next]) => `${field}: ${format(current)} -> ${format(next)}`)
    .join(", ");
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "none";
  }
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}
