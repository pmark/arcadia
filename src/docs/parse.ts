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
import {
  ARCADIA_DOC_VERSION,
  DECISION_DOC_STATUSES,
  DOC_TYPES,
  PLAN_STATUSES,
  type ArcadiaDoc,
  type DocType,
  type DocValidationError,
  type LogEntryDoc,
  type PlanActionDoc,
  type PlanQuestionDoc
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
  const updated = dateField(problems, data, "updated");
  const slug = slugField(problems, data, "slug");

  if (!type) {
    return { doc: null, errors: problems.errors };
  }

  // PROJECT.md is the one type that does not carry a `project:` pointer — it
  // *is* the project, and its own slug is the pointer everything else uses.
  const project = type === "project" ? slug : slugField(problems, data, "project");

  switch (type) {
    case "project": {
      const name = requiredString(problems, data, "name");
      const status = enumField(problems, data, "status", PROJECT_STATUSES);
      const goal = requiredString(problems, data, "goal");
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
          updated: updated!,
          body
        },
        errors: problems.errors
      };
    }

    case "plan": {
      const status = enumField(problems, data, "status", PLAN_STATUSES);
      const actions = parseActions(problems, data.actions);
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
      const id = requiredString(problems, data, "id");
      const status = enumField(problems, data, "status", DECISION_DOC_STATUSES);
      const question = requiredString(problems, data, "question");
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

function parseActions(problems: Problems, raw: unknown): PlanActionDoc[] {
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
    const responsibility = enumField(problems, value, "responsibility", WORK_CLASSIFICATIONS, field);
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
      dependsOn: stringArray(value.depends_on)
    });
  });

  // Dangling dependencies silently break ordering, so name them.
  const ids = new Set(actions.map((action) => action.id));
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

  return actions;
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
    if (!id || !question) {
      return;
    }
    questions.push({ id, question, gapType: (gapType ?? null) as never });
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
