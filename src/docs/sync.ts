import type Database from "better-sqlite3";
import {
  createMilestoneForProject,
  createReviewItem,
  createWorkItemRecord,
  getMilestoneByDocRef,
  getMilestoneByTitle,
  getProjectMetadata,
  getReviewItemByDocRef,
  getWorkItemByDocRef,
  setMilestoneDocRef,
  setReviewItemDocRef,
  setWorkItemDocRef,
  updateMilestoneTitle,
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
  planDocRef,
  planQuestionDocRef,
  type ArcadiaDoc,
  type DecisionDoc,
  type DocValidationError,
  type PlanDoc,
  type PlanActionDoc,
  type ProjectDoc
} from "./types.js";

/**
 * The same placeholder `capture` writes. An Action that a document has not
 * decided must not carry a next action that reads like a decision — the
 * clarification columns hold the truth, exactly as they do after capture.
 */
const PLACEHOLDER_NEXT_ACTION = "Clarify the desired outcome or approve a Codex execution path.";

/** The intent Phase 3 uses for a question awaiting an answer. */
const ACTION_CLARIFICATION_INTENT = "ActionClarification";

export type ChangeAction = "create" | "update" | "unchanged" | "skipped";
export type ChangeEntity = "project" | "milestone" | "action" | "question" | "decision" | "log" | "narrative";

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
    result.changes.push(...syncPlan(db, project, plan, conflicting, options.apply, plannedMilestones));
  }

  for (const decision of decisions) {
    if (conflicting.has(decisionDocRef(decision.slug))) {
      continue;
    }
    result.changes.push(syncDecision(db, project, decision, options.apply));
  }

  // Recognized but not yet ingested. Reported rather than ignored so the
  // operator can see the protocol knows about them and this build does not
  // handle them yet.
  for (const doc of mine) {
    if (doc.type === "log") {
      result.changes.push({
        action: "skipped",
        entity: "log",
        relativePath: doc.relativePath,
        ref: doc.slug,
        title: `${doc.entries.length} log entr${doc.entries.length === 1 ? "y" : "ies"}`,
        reason: "Log ingestion is not implemented yet; the file parsed cleanly."
      });
    } else if (doc.type === "architecture" || doc.type === "strategy" || doc.type === "reference") {
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

  if (doc.milestone) {
    changes.push(...ensureMilestone(db, project, doc.milestone, null, doc.relativePath, apply, planned));
  }

  return changes;
}

function syncPlan(
  db: Database.Database,
  project: Project,
  doc: PlanDoc,
  conflicting: Set<string>,
  apply: boolean,
  planned: Map<string, string | null>
): DocChange[] {
  const changes: DocChange[] = [];
  const ref = planDocRef(doc.slug);
  const milestoneTitle = doc.milestone ?? doc.slug;

  const milestoneChanges = ensureMilestone(db, project, milestoneTitle, ref, doc.relativePath, apply, planned);
  changes.push(...milestoneChanges);

  const milestone =
    getMilestoneByDocRef(db, project.id, ref) ?? getMilestoneByTitle(db, project.id, milestoneTitle);

  for (const action of doc.actions) {
    const actionRef = actionDocRef(doc.slug, action.id);
    if (conflicting.has(actionRef)) {
      continue;
    }
    changes.push(
      syncAction(db, project, doc, action, actionRef, milestone?.id ?? null, apply)
    );
  }

  for (const question of doc.questions) {
    changes.push(syncPlanQuestion(db, project, doc, question, apply));
  }

  return changes;
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
  question: { id: string; question: string; gapType: string | null },
  apply: boolean
): DocChange {
  const ref = planQuestionDocRef(plan.slug, question.id);
  const existing = getReviewItemByDocRef(db, ref);

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
    }
    return { action: "create", entity: "question", relativePath: plan.relativePath, ref, title: question.question };
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

function ensureMilestone(
  db: Database.Database,
  project: Project,
  title: string,
  ref: string | null,
  relativePath: string,
  apply: boolean,
  planned: Map<string, string | null>
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
      if (created && ref) {
        setMilestoneDocRef(db, created.id, ref);
      }
    }
    return [
      { action: "create", entity: "milestone", relativePath, ref: ref ?? title, title }
    ];
  }

  // Adopting an existing same-titled milestone is what makes a first sync
  // attach to work already in Arcadia instead of duplicating it.
  if (ref && !byRef) {
    if (apply) {
      setMilestoneDocRef(db, existing.id, ref);
    }
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

  if (existing.title !== title) {
    if (apply) {
      updateMilestoneTitle(db, existing.id, title);
    }
    return [
      {
        action: "update",
        entity: "milestone",
        relativePath,
        ref: ref ?? title,
        title,
        reason: `title: "${existing.title}" -> "${title}"`
      }
    ];
  }

  return [{ action: "unchanged", entity: "milestone", relativePath, ref: ref ?? title, title }];
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
