import { parse as parseYaml } from "yaml";
import {
  CLARIFICATION_CONFIDENCE_LEVELS,
  CLARIFICATION_STATUSES,
  GAP_TYPES,
  MILESTONE_STATUSES,
  PROJECT_STATUSES,
  WORK_CLASSIFICATIONS,
  WORK_ITEM_STATUSES
} from "../domain/constants.js";
import { ORIENTATION_EFFORTS } from "../orientation/types.js";
import { parseExecutionRequirement } from "../execution/profiles.js";
import {
  ARCADIA_DOC_VERSION,
  DECISION_DOC_STATUSES,
  DOC_TYPES,
  PLAN_STATUSES,
  SCOPED_OUT_PLAN_STATUSES,
  SUPPORTING_DOC_TYPES,
  TOKEN_IMPACTS,
  type ArcadiaDoc,
  type DocType,
  type DocValidationError,
  type LogEntryDoc,
  type PlanActionDoc,
  type PlanQuestionDoc,
  type SupportingDocType
} from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParseResult {
  doc: ArcadiaDoc | null;
  errors: DocValidationError[];
}

/**
 * Collects field-level problems instead of throwing on the first one.
 *
 * A chatbot that got three enum values wrong should hear about all three in one
 * pass, not discover them one re-run at a time.
 */
class Problems {
  public readonly errors: DocValidationError[] = [];

  public constructor(private readonly relativePath: string) {}

  public add(field: string, message: string): void {
    this.errors.push({ relativePath: this.relativePath, field, message });
  }

  public get ok(): boolean {
    return this.errors.length === 0;
  }
}

/** Textual fallback for frontmatter that claims the marker but will not parse. */
const MARKER_LINE = new RegExp(`^\\s*arcadia\\s*:\\s*["']?${ARCADIA_DOC_VERSION}["']?\\s*$`, "m");

/**
 * True when a file declares itself managed. Cheap enough to run over every
 * markdown file in a repo, because it reads only the frontmatter block.
 *
 * A file whose frontmatter claims the marker but fails to parse still counts as
 * managed, deliberately. Chatbot-written frontmatter breaks in predictable ways
 * — an unquoted question containing a colon is the common one — and treating
 * that as "not our file" would make the document silently disappear from the
 * portfolio with nothing to explain why. Claiming the marker means the operator
 * gets a parse error they can act on.
 */
export function isManagedDoc(content: string): boolean {
  const match = FRONTMATTER.exec(content);
  if (!match) {
    return false;
  }

  try {
    const data = parseYaml(match[1]) as Record<string, unknown> | null;
    return String(data?.arcadia ?? "") === ARCADIA_DOC_VERSION;
  } catch {
    return MARKER_LINE.test(match[1]);
  }
}

export function parseDoc(relativePath: string, absolutePath: string, content: string): ParseResult {
  const problems = new Problems(relativePath);
  const match = FRONTMATTER.exec(content);

  if (!match) {
    problems.add("frontmatter", "No YAML frontmatter block found.");
    return { doc: null, errors: problems.errors };
  }

  let data: Record<string, unknown>;
  try {
    const parsed = parseYaml(match[1]) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      problems.add("frontmatter", "Frontmatter must be a YAML mapping.");
      return { doc: null, errors: problems.errors };
    }
    data = parsed as Record<string, unknown>;
  } catch (error) {
    problems.add("frontmatter", `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
    return { doc: null, errors: problems.errors };
  }

  const body = match[2] ?? "";
  const location = { relativePath, absolutePath };

  const type = enumField(problems, data, "type", DOC_TYPES) as DocType | null;

  if (!type) {
    return { doc: null, errors: problems.errors };
  }

  // PPN's continuation, proposal, template, and review records intentionally
  // use the Arcadia marker while their own protocol owns their metadata and
  // lifecycle. Recognize them without forcing dispatch-only fields onto them.
  if (isSupportingDocType(type)) {
    return {
      doc: { ...location, type: "scoped_out", sourceType: type, sourceStatus: null, body },
      errors: problems.errors
    };
  }

  // `dormant` and `proposed` plans are similarly governed outside Arcadia:
  // their trigger/order semantics live in the repository-local shim. They must
  // not become competing plans or require execution-budget metadata here.
  if (type === "plan" && isScopedOutPlanStatus(data.status)) {
    return {
      doc: { ...location, type: "scoped_out", sourceType: "plan", sourceStatus: data.status, body },
      errors: problems.errors
    };
  }

  const updated = dateField(problems, data, "updated");
  const slug = slugField(problems, data, "slug");

  // PROJECT.md is the one type that does not carry a `project:` pointer — it
  // *is* the project, and its own slug is the pointer everything else uses.
  const project = type === "project" ? slug : slugField(problems, data, "project");

  switch (type) {
    case "project": {
      const status = enumField(problems, data, "status", PROJECT_STATUSES);
      // Human-written project docs put the name in the H1 and the mission in a
      // section, not in frontmatter. Both are recoverable without guessing, and
      // rejecting an otherwise-valid document over a duplicated heading would
      // make the protocol expensive to adopt.
      const name = optionalString(data, "name") ?? headingTitle(body);
      if (!name) {
        problems.add("name", "`name` is required, or provide it as the document's first `#` heading.");
      }
      const goal = optionalString(data, "goal") ?? sectionParagraph(body, "Mission");
      if (!goal) {
        problems.add("goal", "`goal` is required, or provide it as the first paragraph under `## Mission`.");
      }
      if (!problems.ok) {
        return { doc: null, errors: problems.errors };
      }
      return {
        doc: {
          ...location,
          type: "project",
          slug: slug!,
          name: name!,
          status: status as never,
          goal: goal!,
          outcome: optionalString(data, "outcome"),
          milestone: optionalString(data, "milestone"),
          activePlan: optionalSlug(problems, data, "active_plan"),
          currentAction: optionalSlug(problems, data, "current_action"),
          updated: updated!,
          body
        },
        errors: problems.errors
      };
    }

    case "plan": {
      const status = enumField(problems, data, "status", PLAN_STATUSES);
      const tokenImpact = enumField(problems, data, "token_impact", TOKEN_IMPACTS);
      const tokenBudget = requiredString(problems, data, "token_budget");
      const currentAction = optionalSlug(problems, data, "current_action");
      const actions = parseActions(problems, data.actions, currentAction);
      const questions = parseQuestions(problems, data.questions);
      const decisions = stringArray(data.decisions);
      if (!problems.ok) {
        return { doc: null, errors: problems.errors };
      }
      return {
        doc: {
          ...location,
          type: "plan",
          slug: slug!,
          project: project!,
          status: status as never,
          milestone: optionalString(data, "milestone"),
          currentAction,
          tokenImpact: tokenImpact as never,
          tokenBudget: tokenBudget!,
          recommendedModel: optionalString(data, "recommended_model"),
          recommendedReasoningEffort: optionalString(data, "recommended_reasoning_effort"),
          updated: updated!,
          actions,
          questions,
          decisions,
          body
        },
        errors: problems.errors
      };
    }

    case "decision": {
      const status = enumField(problems, data, "status", DECISION_DOC_STATUSES);
      // The protocol names decision files `NNNN-<slug>.md`, so the id is already
      // in the path. ADR-style documents state the decision in the heading
      // rather than as a question field; both are recoverable.
      const id = optionalString(data, "id") ?? idFromFilename(relativePath);
      if (!id) {
        problems.add("id", "`id` is required, or name the file `NNNN-<slug>.md`.");
      }
      const question = optionalString(data, "question") ?? headingTitle(body);
      if (!question) {
        problems.add("question", "`question` is required, or state it as the document's first `#` heading.");
      }
      const gapType = optionalEnum(problems, data, "gap_type", GAP_TYPES);
      const confidence = optionalEnum(problems, data, "confidence", CLARIFICATION_CONFIDENCE_LEVELS);
      const decided = optionalDate(problems, data, "decided");

      // An approved decision without an answer is the failure mode that matters:
      // it looks resolved in every rollup while recording nothing anyone can act
      // on.
      const answer = optionalString(data, "answer");
      if (status === "approved" && !answer) {
        problems.add("answer", 'A decision with status "approved" must record an `answer`.');
      }

      if (!problems.ok) {
        return { doc: null, errors: problems.errors };
      }
      return {
        doc: {
          ...location,
          type: "decision",
          id: id!,
          slug: slug!,
          project: project!,
          plan: optionalString(data, "plan"),
          action: optionalString(data, "action"),
          status: status as never,
          question: question!,
          gapType: gapType as never,
          recommendation: optionalString(data, "recommendation"),
          confidence: confidence as never,
          decided,
          answer,
          updated: updated!,
          body
        },
        errors: problems.errors
      };
    }

    case "log": {
      const entries = parseLogEntries(problems, body);
      if (!problems.ok) {
        return { doc: null, errors: problems.errors };
      }
      return {
        doc: {
          ...location,
          type: "log",
          slug: slug!,
          project: project!,
          updated: updated!,
          entries,
          body
        },
        errors: problems.errors
      };
    }

    default: {
      if (!problems.ok) {
        return { doc: null, errors: problems.errors };
      }
      return {
        doc: {
          ...location,
          type,
          slug: slug!,
          project: project!,
          updated: updated!,
          body
        },
        errors: problems.errors
      };
    }
  }
}

function parseActions(problems: Problems, raw: unknown, currentAction: string | null): PlanActionDoc[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    problems.add("actions", "`actions` must be a list.");
    return [];
  }

  const actions: PlanActionDoc[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const field = `actions[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.add(field, "Each action must be a mapping.");
      return;
    }
    const value = entry as Record<string, unknown>;

    const id = slugField(problems, value, "id", field);
    const title = requiredString(problems, value, "title", field);
    const status = enumField(problems, value, "status", WORK_ITEM_STATUSES, field);
    // An action nobody can start yet often has no meaningful owner. Defaulting
    // to requires_review routes it to a human, which is the safe direction; the
    // unsafe one would be defaulting to codex and handing an undecided task to
    // an executor.
    const responsibility =
      value.responsibility === undefined || value.responsibility === null
        ? "requires_review"
        // `operator` is a document-facing actor term. Preserve its existing
        // safe Arcadia meaning rather than allowing an agent to execute it.
        : value.responsibility === "operator"
          ? "requires_review"
          : enumField(problems, value, "responsibility", WORK_CLASSIFICATIONS, field);
    const effort = optionalEnum(problems, value, "effort", ORIENTATION_EFFORTS, field);
    const clarification = optionalEnum(problems, value, "clarification", CLARIFICATION_STATUSES, field);
    const gapType = optionalEnum(problems, value, "gap_type", GAP_TYPES, field);
    const confidence = optionalEnum(problems, value, "confidence", CLARIFICATION_CONFIDENCE_LEVELS, field);
    const nextAction = optionalString(value, "next_action");
    const question = optionalString(value, "question");

    if (id) {
      if (seen.has(id)) {
        problems.add(`${field}.id`, `Duplicate action id "${id}" within this plan.`);
      }
      seen.add(id);
    }

    // The protocol's central rule, enforced at ingest rather than trusted: an
    // action is either decided or it carries the one question blocking it.
    // Anything else is the vague placeholder the whole program exists to kill.
    if (clarification === "clarified" && !nextAction) {
      problems.add(
        `${field}.next_action`,
        'An action with clarification "clarified" must carry a concrete `next_action`.'
      );
    }
    if (clarification === "question_open") {
      if (!question) {
        problems.add(`${field}.question`, 'An action with clarification "question_open" must carry a `question`.');
      }
      if (!gapType) {
        problems.add(`${field}.gap_type`, 'An action with clarification "question_open" must carry a `gap_type`.');
      }
      if (nextAction) {
        problems.add(
          `${field}.next_action`,
          'An action with clarification "question_open" must not carry a `next_action` — it is blocked.'
        );
      }
    }

    if (!id || !title || !status || !responsibility) {
      return;
    }

    // The continuation contract's executable-action test, enforced where it
    // matters most. Applied only to the current action: requiring criteria on
    // every clarified action would retroactively invalidate completed history,
    // while the objective a coding agent is about to start must say what
    // finished means before anyone starts it.
    const acceptanceCriteria = stringArray(value.acceptance_criteria);
    const executionResult = value.execution === undefined || value.execution === null
      ? { requirement: null, resolved: null, issues: [] }
      : parseExecutionRequirement(value.execution, responsibility as never);
    for (const issue of executionResult.issues) {
      problems.add(`${field}.${issue.field}`, issue.message);
    }
    if (id && id === currentAction) {
      if (clarification === "clarified" && acceptanceCriteria.length === 0) {
        problems.add(
          `${field}.acceptance_criteria`,
          "The current action must define objective acceptance criteria before it can be dispatched."
        );
      }
      if (!clarification) {
        problems.add(
          `${field}.clarification`,
          'The current action must declare `clarification` as "clarified" or "question_open".'
        );
      }
    }

    actions.push({
      id,
      title,
      status: status as never,
      responsibility: responsibility as never,
      effort: (effort ?? null) as never,
      nextAction: nextAction ?? null,
      expectedArtifact: optionalString(value, "expected_artifact"),
      clarification: (clarification ?? null) as never,
      gapType: (gapType ?? null) as never,
      question: question ?? null,
      confidence: (confidence ?? null) as never,
      source: optionalString(value, "source"),
      milestone: optionalString(value, "milestone"),
      dependsOn: stringArray(value.depends_on),
      acceptanceCriteria,
      decisions: stringArray(value.decisions),
      references: stringArray(value.references),
      execution: executionResult.requirement,
      resolvedExecution: executionResult.resolved
    });
  });

  const ids = new Set(actions.map((action) => action.id));

  // A pointer to an action that does not exist leaves a dispatched agent with
  // no objective at all, which is worse than having no pointer.
  if (currentAction && !ids.has(currentAction)) {
    problems.add(
      "current_action",
      `\`current_action\` is "${currentAction}", which is not an action id in this plan.`
    );
  }

  // Dangling dependencies silently break ordering, so name them.
  for (const action of actions) {
    for (const dependency of action.dependsOn) {
      if (!ids.has(dependency)) {
        problems.add(
          `actions.${action.id}.depends_on`,
          `Depends on "${dependency}", which is not an action id in this plan.`
        );
      }
    }
  }

  reportDependencyCycles(problems, actions);

  return actions;
}

/**
 * Report every dependency cycle in the plan's action graph.
 *
 * A cycle is not a dispatch problem to discover later: no action in it can ever
 * become ready, so the plan describes work that can never start. Reported at
 * parse time, next to the dangling-reference check, because both are the same
 * class of defect — an ordering the document claims but cannot satisfy.
 */
function reportDependencyCycles(problems: Problems, actions: PlanActionDoc[]): void {
  const byId = new Map(actions.map((action) => [action.id, action]));
  // 0 = unvisited, 1 = on the current path, 2 = fully explored.
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const reported = new Set<string>();

  const visit = (id: string): void => {
    const action = byId.get(id);
    if (!action) {
      // Dangling; already reported above.
      return;
    }
    if (state.get(id) === 2) {
      return;
    }
    if (state.get(id) === 1) {
      const cycle = path.slice(path.indexOf(id));
      // One cycle, one problem: key on the members so the same loop reached
      // from two entry points is not reported twice.
      const key = [...cycle].sort().join(",");
      if (!reported.has(key)) {
        reported.add(key);
        problems.add(
          `actions.${cycle[0]}.depends_on`,
          `Dependency cycle: ${[...cycle, cycle[0]].join(" -> ")}. No action in a cycle can ever become ready.`
        );
      }
      return;
    }

    state.set(id, 1);
    path.push(id);
    for (const dependency of action.dependsOn) {
      visit(dependency);
    }
    path.pop();
    state.set(id, 2);
  };

  // Sorted so the reported entry point is stable across runs rather than
  // dependent on document order.
  for (const id of [...byId.keys()].sort()) {
    visit(id);
  }
}

function parseQuestions(problems: Problems, raw: unknown): PlanQuestionDoc[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    problems.add("questions", "`questions` must be a list.");
    return [];
  }

  const questions: PlanQuestionDoc[] = [];
  raw.forEach((entry, index) => {
    const field = `questions[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.add(field, "Each question must be a mapping.");
      return;
    }
    const value = entry as Record<string, unknown>;
    const id = slugField(problems, value, "id", field);
    const question = requiredString(problems, value, "question", field);
    const gapType = optionalEnum(problems, value, "gap_type", GAP_TYPES, field);
    const decision = optionalString(value, "decision");
    if (!id || !question) {
      return;
    }
    questions.push({ id, question, gapType: (gapType ?? null) as never, decision });
  });

  return questions;
}

const LOG_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+?)\s*$/;
const LOG_BULLET = /^-\s+\*\*(Did|Result|Next|Blockers):\*\*\s*(.*)$/i;

/**
 * Log entries are the one place the protocol parses the body, because an
 * append-only log in frontmatter would be unreadable to the human who writes
 * it. The heading shape is strict; a heading that does not match is skipped
 * rather than guessed at.
 */
function parseLogEntries(problems: Problems, body: string): LogEntryDoc[] {
  const lines = body.split(/\r?\n/);
  const entries: LogEntryDoc[] = [];
  let current: { date: string; title: string; fields: Record<string, string> } | null = null;

  const flush = (): void => {
    if (!current) {
      return;
    }
    const { date, title, fields } = current;
    if (!fields.did || !fields.result) {
      problems.add(`entry(${date})`, "A log entry needs at least **Did:** and **Result:** bullets.");
    } else {
      entries.push({
        date,
        title,
        did: fields.did,
        result: fields.result,
        next: fields.next || null,
        blockers: fields.blockers && !/^none$/i.test(fields.blockers) ? fields.blockers : null
      });
    }
    current = null;
  };

  for (const line of lines) {
    const heading = LOG_HEADING.exec(line);
    if (heading) {
      flush();
      current = { date: heading[1], title: heading[2], fields: {} };
      continue;
    }
    const bullet = LOG_BULLET.exec(line.trim());
    if (bullet && current) {
      current.fields[bullet[1].toLowerCase()] = bullet[2].trim();
    }
  }
  flush();

  return entries;
}

/**
 * The document's first `#` heading, with a leading `ADR 0011:`-style prefix
 * removed. Deterministic recovery, not inference: if there is no heading the
 * caller reports the field as missing rather than inventing one.
 */
function headingTitle(body: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  if (!match) {
    return null;
  }
  return match[1].replace(/^ADR\s+\d+\s*[:\u2014-]\s*/i, "").trim() || null;
}

/** First paragraph under a named `##` section. */
function sectionParagraph(body: string, heading: string): string | null {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, "mi");
  const match = pattern.exec(body);
  if (!match) {
    return null;
  }
  const paragraph = match[1]
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block.length > 0);
  return paragraph ? paragraph.replace(/\s+/g, " ") : null;
}

/** The `NNNN` prefix the protocol already requires in a decision filename. */
function idFromFilename(relativePath: string): string | null {
  const base = relativePath.split(/[\\/]/).pop() ?? "";
  const match = /^(\d{3,})-/.exec(base);
  return match ? match[1] : null;
}

function requiredString(
  problems: Problems,
  data: Record<string, unknown>,
  key: string,
  prefix?: string
): string | null {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) {
    problems.add(prefix ? `${prefix}.${key}` : key, `\`${key}\` is required.`);
    return null;
  }
  return value.trim();
}

function optionalString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isSupportingDocType(type: DocType): type is SupportingDocType {
  return (SUPPORTING_DOC_TYPES as readonly string[]).includes(type);
}

function isScopedOutPlanStatus(value: unknown): value is (typeof SCOPED_OUT_PLAN_STATUSES)[number] {
  return typeof value === "string" && (SCOPED_OUT_PLAN_STATUSES as readonly string[]).includes(value);
}

function slugField(
  problems: Problems,
  data: Record<string, unknown>,
  key: string,
  prefix?: string
): string | null {
  const value = requiredString(problems, data, key, prefix);
  if (value === null) {
    return null;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    problems.add(prefix ? `${prefix}.${key}` : key, `\`${key}\` must be kebab-case, got "${value}".`);
    return null;
  }
  return value;
}

function optionalSlug(problems: Problems, data: Record<string, unknown>, key: string): string | null {
  const raw = data[key];
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  return slugField(problems, data, key);
}

function dateField(problems: Problems, data: Record<string, unknown>, key: string): string | null {
  const raw = data[key];
  // The YAML parser resolves an unquoted `2026-07-25` to a Date, so accept both.
  const value = raw instanceof Date ? raw.toISOString().slice(0, 10) : typeof raw === "string" ? raw.trim() : "";
  if (!ISO_DATE.test(value)) {
    problems.add(key, `\`${key}\` must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(raw)}.`);
    return null;
  }
  return value;
}

function optionalDate(problems: Problems, data: Record<string, unknown>, key: string): string | null {
  const raw = data[key];
  if (raw === undefined || raw === null) {
    return null;
  }
  return dateField(problems, data, key);
}

function enumField(
  problems: Problems,
  data: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  prefix?: string
): string | null {
  const value = requiredString(problems, data, key, prefix);
  if (value === null) {
    return null;
  }
  if (!allowed.includes(value)) {
    problems.add(
      prefix ? `${prefix}.${key}` : key,
      `\`${key}\` must be one of: ${allowed.join(", ")} — got "${value}".`
    );
    return null;
  }
  return value;
}

function optionalEnum(
  problems: Problems,
  data: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  prefix?: string
): string | null {
  const raw = data[key];
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  return enumField(problems, data, key, allowed, prefix);
}

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : typeof entry === "number" ? String(entry) : ""))
    .filter((entry) => entry.length > 0);
}

export { MILESTONE_STATUSES };
