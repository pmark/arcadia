import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

import type { Project, WorkItemSummary } from "../domain/types.js";
import { localDateStamp } from "../utils/time.js";

/**
 * The plan a newly adopted repository gets when it has none.
 *
 * Named for what it is rather than for the project, so a second seeding run
 * against a repository that already has this file is a no-op by path as well
 * as by discovery.
 */
export const BOOTSTRAP_PLAN_SLUG_SUFFIX = "bootstrap";

/** Where a seeded plan goes. The protocol's directory, not a new one. */
export const PLANS_DIRECTORY = "docs/plans";

export interface SeedControlDocumentsInput {
  repoPath: string;
  project: Project;
  /** Title of the project's active Milestone, when it has one. */
  milestoneTitle: string | null;
  /** The project's unfinished Actions, newest first. */
  workItems: WorkItemSummary[];
  /** True when the repository already has a PROJECT.md declaring this slug. */
  hasProjectDocument: boolean;
  /** True when the repository already has any plan document for this project. */
  hasPlanDocument: boolean;
}

export interface SeedControlDocumentsResult {
  /** Absolute path written, or null when one already existed. */
  projectDocument: string | null;
  /** Absolute path written, or null when a plan already existed, or there was
   *  nothing to put in one. */
  plan: string | null;
  /** Why a document was not written, in operator-facing words. Empty when both
   *  were written. */
  skipped: string[];
  /** Stable identifiers needed to bind the seeded Action back to its source row. */
  planSlug?: string;
  currentActionId?: string | null;
}

/**
 * Seed the work pointer chain into a repository that has none.
 *
 * Adoption used to stop one document short of working: `setup-context` wrote
 * the governance files an agent reads, but never a `PROJECT.md`, so every
 * adopted repository resolved to the same refusal — no project document, no
 * active plan, no dispatchable Action — with no command that would produce
 * one. The Actions were in the database the whole time; nothing translated
 * them into the documents the contract makes authoritative.
 *
 * This writes that translation, and only that. It never overwrites: a
 * repository that already carries either document keeps what it has, because
 * checked-in documentation outranks the database by contract and a generator
 * that can clobber it would invert the rule.
 */
export function seedControlDocuments(input: SeedControlDocumentsInput): SeedControlDocumentsResult {
  const skipped: string[] = [];
  const planSlug = bootstrapPlanSlug(input.project.slug);
  const unfinished = input.workItems.filter((item) => item.status !== "done");
  const faithful = unfinished.map((item) => toPlanAction(item, unfinished));
  const currentActionId = pickCurrentAction(faithful);
  // Only the Action being pointed at is held to the schema's clarification
  // rules, so only that one is adjusted. The rest stay exactly as the database
  // recorded them.
  const actions = faithful.map((action) => (action.id === currentActionId ? promoteToCurrent(action) : action));

  let plan: string | null = null;
  if (input.hasPlanDocument) {
    skipped.push("Plan: left alone — this project already has a plan document.");
  } else if (actions.length === 0) {
    skipped.push(
      "Plan: not written — this project has no unfinished Actions to put in one. " +
        "Capture one, then run setup-context again."
    );
  } else {
    const planPath = path.join(input.repoPath, PLANS_DIRECTORY, `${planSlug}.md`);
    mkdirSync(path.dirname(planPath), { recursive: true });
    writeFileSync(
      planPath,
      renderBootstrapPlan({
        slug: planSlug,
        project: input.project,
        milestoneTitle: input.milestoneTitle,
        actions,
        currentActionId
      }),
      "utf8"
    );
    plan = planPath;
  }

  let projectDocument: string | null = null;
  if (input.hasProjectDocument) {
    skipped.push("PROJECT.md: left alone — this repository already declares this project.");
  } else {
    const projectPath = path.join(input.repoPath, "PROJECT.md");
    writeFileSync(
      projectPath,
      renderProjectDocument({
        project: input.project,
        milestoneTitle: input.milestoneTitle,
        // Point at the plan only if one now exists. An `active_plan` naming a
        // file nobody wrote is a worse starting state than none: it reports as
        // a dangling pointer rather than as the absence it actually is.
        activePlan: plan ? planSlug : null,
        currentAction: plan ? currentActionId : null
      }),
      "utf8"
    );
    projectDocument = projectPath;
  }

  return { projectDocument, plan, skipped, planSlug, currentActionId };
}

export function bootstrapPlanSlug(projectSlug: string): string {
  return `${projectSlug}-${BOOTSTRAP_PLAN_SLUG_SUFFIX}`;
}

/** A plan Action, shaped for the document rather than for the database. */
export interface SeededAction {
  id: string;
  title: string;
  status: string;
  responsibility: string;
  effort: string | null;
  nextAction: string | null;
  expectedArtifact: string | null;
  clarification: "clarified" | "question_open" | "unclarified" | null;
  gapType: string | null;
  question: string | null;
  confidence: string | null;
  acceptanceCriteria: string[];
  /** Where every field above came from, recorded in the document itself. */
  source: string;
}

/**
 * One database Action as a plan Action, faithfully.
 *
 * Nothing is invented here and nothing is dropped: `next_action` is preserved,
 * and `clarification` is carried only when the row actually has one, because
 * the plan schema requires it on the current Action alone. The one adjustment
 * is that a `question_open` Action may not also carry a `next_action` — the
 * schema treats those as contradictory, and the clarification status is the
 * side that was written deliberately.
 */
function toPlanAction(item: WorkItemSummary, all: WorkItemSummary[]): SeededAction {
  const clarification = item.clarification_status;
  return {
    id: uniqueActionId(item, all),
    title: item.title,
    status: item.status,
    responsibility: item.responsibility ?? item.work_classification,
    effort: item.effort,
    nextAction: clarification === "question_open" ? null : item.next_action?.trim() || null,
    expectedArtifact: item.expected_artifact?.trim() || null,
    clarification,
    gapType: item.gap_type,
    question: item.open_question?.trim() || null,
    confidence: item.confidence,
    acceptanceCriteria: decodeAcceptanceCriteria(item.acceptance_criteria_json),
    source: `Seeded from Arcadia work item ${item.id} during repository adoption.`
  };
}

/**
 * Make one Action legal to point `current_action` at.
 *
 * This is the only place the seed adds anything the database did not say, and
 * it is unavoidable: the schema requires the current Action to declare either
 * `clarified` with acceptance criteria, or `question_open` with a question. A
 * row that has been captured but never clarified satisfies neither, and most
 * rows in a repository being adopted are exactly that.
 *
 * So it derives at most one criterion, and only from a field the operator
 * wrote: `expected_artifact` names something that either exists or does not,
 * which is the definition of observable. When even that is absent there is
 * genuinely nothing to assert, and the Action is emitted as the open question
 * it already was — which surfaces on the project as one operator question
 * rather than as a document that will not parse.
 */
function promoteToCurrent(action: SeededAction): SeededAction {
  if (action.clarification === "clarified" && action.acceptanceCriteria.length > 0 && action.nextAction) {
    return action;
  }
  if (action.clarification === "question_open" && action.question) {
    return { ...action, gapType: action.gapType ?? "missing-success-criteria", nextAction: null };
  }

  const derived = action.acceptanceCriteria.length > 0
    ? action.acceptanceCriteria
    : action.expectedArtifact
      ? [`The expected Artifact exists: ${action.expectedArtifact}`]
      : [];

  if (derived.length > 0 && action.nextAction) {
    return { ...action, clarification: "clarified", acceptanceCriteria: derived, gapType: null, question: null };
  }

  return {
    ...action,
    clarification: "question_open",
    nextAction: null,
    acceptanceCriteria: [],
    gapType: action.gapType ?? "missing-success-criteria",
    question:
      action.question ??
      `What observable result counts as done for "${action.title}"? Arcadia holds no acceptance criteria and no expected Artifact for it.`
  };
}

/**
 * The Action to point at, or null when the documents should not guess.
 *
 * Prefers the one already in progress, because that is a claim the operator or
 * a previous session already made rather than one made here. Falls back to a
 * sole startable Action. Anything more ambiguous is left unset on purpose:
 * choosing the objective out of several equals is the operator's call, and the
 * resulting blocker names every candidate id, which is a smaller ask than
 * undoing a wrong pointer.
 */
function pickCurrentAction(actions: SeededAction[]): string | null {
  const inProgress = actions.filter((action) => action.status === "in_progress");
  if (inProgress.length === 1) {
    return inProgress[0]!.id;
  }
  const startable = actions.filter((action) => action.status === "open" && action.responsibility !== "blocked");
  return startable.length === 1 ? startable[0]!.id : null;
}

function decodeAcceptanceCriteria(raw: string | null): string[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim())
      : [];
  } catch {
    return [];
  }
}

/**
 * A kebab-case action id derived from the Action's title.
 *
 * Titles are what the operator will recognize in a diff; the database id is
 * not. Collisions and unusable titles fall back to the database id's suffix,
 * which is unique by construction.
 */
function uniqueActionId(item: WorkItemSummary, all: WorkItemSummary[]): string {
  const base = kebab(item.title);
  const collides = all.filter((other) => other.id !== item.id && kebab(other.title) === base).length > 0;
  if (!base || collides) {
    const suffix = kebab(item.id.replace(/^work_/, "")) || "action";
    return base ? `${base}-${suffix}` : `action-${suffix}`;
  }
  return base;
}

function kebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 10)
    .join("-");
}

export function renderProjectDocument(input: {
  project: Project;
  milestoneTitle: string | null;
  activePlan: string | null;
  currentAction: string | null;
}): string {
  const goal = input.project.goal?.trim() || input.project.mission.trim();
  const frontmatter: Record<string, unknown> = {
    arcadia: "v1",
    type: "project",
    slug: input.project.slug,
    name: input.project.name,
    status: input.project.status,
    goal
  };
  if (input.project.outcome?.trim()) {
    frontmatter.outcome = input.project.outcome.trim();
  }
  if (input.milestoneTitle?.trim()) {
    frontmatter.milestone = input.milestoneTitle.trim();
  }
  if (input.activePlan) {
    frontmatter.active_plan = input.activePlan;
  }
  if (input.currentAction) {
    frontmatter.current_action = input.currentAction;
  }
  frontmatter.updated = localDateStamp();

  return [
    frontmatterBlock(frontmatter),
    `# ${input.project.name}`,
    "",
    "## Mission",
    "",
    input.project.mission.trim(),
    "",
    "## How this document got here",
    "",
    "Arcadia seeded this file when the repository was adopted, from the Project",
    "record it already held. It is now the authoritative work pointer: when this",
    "document and Arcadia's database disagree, this document wins, and nothing",
    "regenerates it. Edit it directly.",
    ""
  ].join("\n");
}

export function renderBootstrapPlan(input: {
  slug: string;
  project: Project;
  milestoneTitle: string | null;
  actions: SeededAction[];
  currentActionId: string | null;
}): string {
  const frontmatter: Record<string, unknown> = {
    arcadia: "v1",
    type: "plan",
    slug: input.slug,
    project: input.project.slug,
    status: "active"
  };
  if (input.milestoneTitle?.trim()) {
    frontmatter.milestone = input.milestoneTitle.trim();
  }
  if (input.currentActionId) {
    frontmatter.current_action = input.currentActionId;
  }
  frontmatter.token_impact = "small";
  frontmatter.token_budget =
    "Seeded from Arcadia's own records, so producing this plan cost no model tokens. " +
    "Reserve model use for clarifying the Actions below, one at a time.";
  frontmatter.updated = localDateStamp();
  frontmatter.actions = input.actions.map((action) => {
    const entry: Record<string, unknown> = {
      id: action.id,
      title: action.title,
      status: action.status,
      responsibility: action.responsibility
    };
    if (action.effort) {
      entry.effort = action.effort;
    }
    if (action.nextAction) {
      entry.next_action = action.nextAction;
    }
    if (action.expectedArtifact) {
      entry.expected_artifact = action.expectedArtifact;
    }
    if (action.clarification) {
      entry.clarification = action.clarification;
    }
    if (action.gapType) {
      entry.gap_type = action.gapType;
    }
    if (action.question) {
      entry.question = action.question;
    }
    if (action.confidence) {
      entry.confidence = action.confidence;
    }
    entry.source = action.source;
    if (action.acceptanceCriteria.length > 0) {
      entry.acceptance_criteria = action.acceptanceCriteria;
    }
    return entry;
  });

  return [
    frontmatterBlock(frontmatter),
    `# ${input.project.name} bootstrap`,
    "",
    "## What this plan is",
    "",
    "Arcadia wrote this plan when the repository was adopted, from the Actions it",
    "already held for this Project. It exists so the work pointer resolves to",
    "something real on the first day instead of to a refusal.",
    "",
    "Every Action below carries a `source` naming the record it came from. Where",
    "an Action had no acceptance criteria, one was derived from its expected",
    "Artifact; where it had neither, the Action is recorded as the open question",
    "it actually is, rather than given criteria nobody agreed to.",
    "",
    "Rewrite this into a real plan as soon as the work has a shape. Nothing",
    "regenerates this file.",
    ""
  ].join("\n");
}

/**
 * YAML frontmatter, emitted by the same library that parses it.
 *
 * Hand-quoting was the alternative and it is a trap: a mission containing a
 * colon, a title containing a quote, or a criterion spanning lines each break
 * it differently, and the failure shows up as an unparseable document in a
 * repository the operator has just adopted.
 */
function frontmatterBlock(frontmatter: Record<string, unknown>): string {
  return ["---", stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd(), "---", ""].join("\n");
}
