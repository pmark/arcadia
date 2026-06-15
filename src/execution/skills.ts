import type Database from "better-sqlite3";
import { isRequiresReviewValue, type ExecutorType, type WorkClassification } from "../domain/constants.js";
import type { WorkItemSummary } from "../domain/types.js";
import { upsertSkillDefinition } from "../db/repositories.js";

export interface BuiltInSkill {
  name: string;
  title: string;
  description: string;
  executorType: ExecutorType;
  safeToRun: boolean;
}

export interface PlannedSkillStep {
  skillName: string;
  title: string;
  command: string | null;
  executorType: ExecutorType;
  safeToRun: boolean;
  needsMark: string | null;
}

export interface IntentClassification {
  title: string;
  queue: "work_queue" | "requires_review";
  workClassification: WorkClassification;
  nextAction: string;
  matchedSkillName: string | null;
}

export const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    name: "validate_workspace_repository",
    title: "Validate workspace and repository",
    description: "Confirm the Arcadia workspace has the required local folders and database.",
    executorType: "deterministic",
    safeToRun: true
  },
  {
    name: "generate_status_report",
    title: "Generate status report",
    description: "Write the deterministic Arcadia status report from SQLite.",
    executorType: "deterministic",
    safeToRun: true
  },
  {
    name: "generate_weekly_review",
    title: "Generate weekly review",
    description: "Write the deterministic weekly review from SQLite.",
    executorType: "deterministic",
    safeToRun: true
  },
  {
    name: "prepare_publication_packet",
    title: "Prepare publication packet",
    description: "Create a local Markdown packet for review before publication.",
    executorType: "deterministic",
    safeToRun: true
  },
  {
    name: "prepare_weekly_update_draft",
    title: "Prepare weekly update draft",
    description: "Write a local weekly update draft from recent mission logs and work state.",
    executorType: "deterministic",
    safeToRun: true
  },
  {
    name: "generate_specification_artifact",
    title: "Generate specification artifact",
    description: "Create a local Markdown specification artifact from captured intent.",
    executorType: "deterministic",
    safeToRun: true
  },
  {
    name: "create_mission_log_from_run",
    title: "Create mission log from run",
    description: "Record the run outcome as a mission log.",
    executorType: "deterministic",
    safeToRun: true
  },
  {
    name: "codex_planning",
    title: "Invoke Codex Planning Mode",
    description: "Requires Codex to turn ambiguous or implementation-heavy work into a plan.",
    executorType: "codex_planning",
    safeToRun: false
  },
  {
    name: "codex_build",
    title: "Invoke Codex Build Mode",
    description: "Requires Codex to make code or repository changes.",
    executorType: "codex_build",
    safeToRun: false
  },
  {
    name: "requires_review_decision",
    title: "Surface required review",
    description: "Pause execution until the user provides direction, approval, or missing context.",
    executorType: "mark",
    safeToRun: false
  },
  {
    name: "needs_mark_decision",
    title: "Surface required review",
    description: "Legacy alias for required-review pauses.",
    executorType: "mark",
    safeToRun: false
  }
];

export function ensureBuiltInSkills(db: Database.Database): void {
  for (const skill of BUILT_IN_SKILLS) {
    upsertSkillDefinition(db, {
      name: skill.name,
      title: skill.title,
      description: skill.description,
      executorType: skill.executorType,
      safeToRun: skill.safeToRun
    });
  }
}

export function classifyCapturedIntent(text: string): IntentClassification {
  const normalized = text.toLowerCase();
  const title = titleFromIntent(text);
  const matchedSkillName = safeSkillForIntent(normalized);

  if (matchedSkillName) {
    return {
      title,
      queue: "work_queue",
      workClassification: "autonomous",
      nextAction: nextActionForSkill(matchedSkillName),
      matchedSkillName
    };
  }

  return {
    title,
    queue: "requires_review",
    workClassification: "requires_review",
    nextAction: "Clarify the desired outcome or approve a Codex execution path.",
    matchedSkillName: null
  };
}

export function planStepsForWorkItem(workItem: WorkItemSummary): PlannedSkillStep[] {
  const raw = `${workItem.title}\n${workItem.raw_input}\n${workItem.next_action}`.toLowerCase();
  const safeSkillName = safeSkillForIntent(raw);

  if (isRequiresReviewValue(workItem.queue) || isRequiresReviewValue(workItem.work_classification)) {
    return [
      {
        skillName: "requires_review_decision",
        title: "Surface required review",
        command: null,
        executorType: "mark",
        safeToRun: false,
        needsMark: workItem.next_action
      }
    ];
  }

  if (workItem.work_classification === "codex" || requiresCodex(raw)) {
    return [
      {
        skillName: raw.includes("implement") || raw.includes("code") || raw.includes("prototype")
          ? "codex_build"
          : "codex_planning",
        title: "Prepare Codex handoff",
        command: null,
        executorType: raw.includes("implement") || raw.includes("code") || raw.includes("prototype")
          ? "codex_build"
          : "codex_planning",
        safeToRun: false,
        needsMark: "Codex execution requires explicit review or invocation."
      }
    ];
  }

  if (!safeSkillName) {
    return [
      {
        skillName: "requires_review_decision",
        title: "Surface missing execution path",
        command: null,
        executorType: "mark",
        safeToRun: false,
        needsMark: "No deterministic skill matched this work item."
      }
    ];
  }

  return [
    {
      skillName: safeSkillName,
      title: nextActionForSkill(safeSkillName),
      command: commandForSkill(safeSkillName),
      executorType: "deterministic",
      safeToRun: true,
      needsMark: null
    },
    {
      skillName: "create_mission_log_from_run",
      title: "Record execution outcome",
      command: "arcadia log create <deterministic-run-outcome>",
      executorType: "deterministic",
      safeToRun: true,
      needsMark: null
    }
  ];
}

function safeSkillForIntent(normalized: string): string | null {
  if (normalized.includes("weekly review")) {
    return "generate_weekly_review";
  }

  if (normalized.includes("status report") || normalized.includes("generate status") || normalized.includes("workspace status")) {
    return "generate_status_report";
  }

  if (normalized.includes("validate") || normalized.includes("verify workspace") || normalized.includes("verify repository")) {
    return "validate_workspace_repository";
  }

  if (normalized.includes("publication packet") || normalized.includes("publish packet")) {
    return "prepare_publication_packet";
  }

  if (normalized.includes("specification") || normalized.includes("spec artifact") || normalized.includes("write spec")) {
    return "generate_specification_artifact";
  }

  return null;
}

function requiresCodex(normalized: string): boolean {
  return /\b(implement|code|build|prototype|repository|repo|fix|refactor)\b/.test(normalized);
}

function titleFromIntent(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return firstLine.slice(0, 120) || "Captured intent";
}

function nextActionForSkill(skillName: string): string {
  switch (skillName) {
    case "validate_workspace_repository":
      return "Validate the workspace and repository.";
    case "generate_status_report":
      return "Generate the deterministic status report.";
    case "generate_weekly_review":
      return "Generate the deterministic weekly review.";
    case "prepare_publication_packet":
      return "Prepare a local publication packet for review.";
    case "prepare_weekly_update_draft":
      return "Prepare a local weekly update draft from recent mission logs.";
    case "generate_specification_artifact":
      return "Generate a specification artifact from captured intent.";
    default:
      return "Run the matched deterministic skill.";
  }
}

function commandForSkill(skillName: string): string | null {
  switch (skillName) {
    case "validate_workspace_repository":
      return "arcadia run validate-workspace";
    case "generate_status_report":
      return "arcadia report status";
    case "generate_weekly_review":
      return "arcadia review weekly";
    case "prepare_publication_packet":
      return "arcadia run prepare-publication-packet";
    case "prepare_weekly_update_draft":
      return "arcadia review weekly";
    case "generate_specification_artifact":
      return "arcadia run generate-specification";
    default:
      return null;
  }
}
