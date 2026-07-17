import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Project } from "../domain/types.js";
import { slugify } from "../utils/slug.js";
import { localDateStamp } from "../utils/time.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export interface ExperimentBriefMarkdownInput {
  project: Project;
  opportunity: string;
  hypothesis: string;
  metric: string;
  baseline: string;
  evidenceNeeded: string;
  decisionCriteria: string;
  recommendedNextAction: string;
}

export function buildExperimentBriefRelativePath(input: {
  projectSlug: string;
  opportunity: string;
  date?: Date;
}): string {
  const dateStamp = localDateStamp(input.date);
  const safeSlug = slugify(input.opportunity);
  return path.posix.join(
    "artifacts",
    "experiments",
    `${dateStamp}-${input.projectSlug}-${safeSlug}-experiment-brief.md`
  );
}

export function renderExperimentBriefMarkdown(input: ExperimentBriefMarkdownInput): string {
  return [
    "Experiment Brief:",
    "",
    "Project",
    "",
    input.project.name,
    "",
    "Opportunity",
    "",
    input.opportunity,
    "",
    "Hypothesis",
    "",
    input.hypothesis,
    "",
    "Primary Metric",
    "",
    input.metric,
    "",
    "Baseline",
    "",
    input.baseline,
    "",
    "Evidence Needed",
    "",
    input.evidenceNeeded,
    "",
    "Decision Criteria",
    "",
    input.decisionCriteria,
    "",
    "Project Update Target",
    "",
    "What project state, strategy, milestone, or next action may change if this experiment succeeds or fails.",
    "",
    "Recommended Next Action",
    "",
    input.recommendedNextAction,
    "",
    "Review",
    "",
    "This experiment should not proceed until Mark approves, revises, defers, or rejects it.",
    ""
  ].join("\n");
}

export function writeExperimentBriefMarkdown(
  workspacePath: string,
  relativePath: string,
  markdown: string
): string {
  const absolutePath = path.join(getWorkspacePaths(workspacePath).root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, markdown, "utf8");
  return absolutePath;
}
