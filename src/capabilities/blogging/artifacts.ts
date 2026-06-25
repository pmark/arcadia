import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { slugify } from "../../utils/slug.js";

export interface BlogArtifactInput {
  workspacePath: string;
  streamKey: string;
  title: string;
  body: string;
  artifactKind: "idea" | "brief" | "draft" | "schedule" | "publish-record";
  date?: string;
}

export function writeBlogArtifact(input: BlogArtifactInput): string {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const slug = slugify(input.title);
  const relativePath = path.join(
    "artifacts",
    "blogging",
    input.streamKey,
    `${date}-${slug}-${input.artifactKind}.md`
  );
  const absolutePath = path.join(input.workspacePath, relativePath);

  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, input.body, "utf8");

  return relativePath;
}

export function blogIdeaMarkdown(input: {
  title: string;
  streamKey: string;
  siteName: string;
  projectName: string;
  source: string;
  summary: string;
}): string {
  return [
    `# ${input.title}`,
    "",
    `Stream: ${input.streamKey}`,
    `Site: ${input.siteName}`,
    `Project: ${input.projectName}`,
    `Source: ${input.source}`,
    "",
    "## Summary",
    "",
    input.summary,
    ""
  ].join("\n");
}

export function blogScheduleMarkdown(input: {
  siteName: string;
  projectName: string;
  streamKey: string;
  weekStart: string;
}): string {
  return [
    `# ${input.siteName} Blog Schedule`,
    "",
    `Project: ${input.projectName}`,
    `Stream: ${input.streamKey}`,
    `Week Start: ${input.weekStart}`,
    "",
    "## Proposed Posts",
    "",
    "- Review recent ideas and choose the next post.",
    "- Confirm voice, positioning, and publish timing before publication.",
    "",
    "## Review Checklist",
    "",
    "- Voice matches the project.",
    "- Claims are safe and supportable.",
    "- Publishing date is intentional.",
    ""
  ].join("\n");
}

export function blogDraftMarkdown(input: {
  title: string;
  siteName: string;
  projectName: string;
  streamKey: string;
  summary: string;
}): string {
  return [
    `# ${input.title}`,
    "",
    `Project: ${input.projectName}`,
    `Site: ${input.siteName}`,
    `Stream: ${input.streamKey}`,
    `Status: Draft scaffold`,
    "",
    "## Working Summary",
    "",
    input.summary,
    "",
    "## Draft",
    "",
    "Start with the concrete update, then explain why it matters to the project audience.",
    "",
    "## Review Notes",
    "",
    "- Needs Mark voice approval.",
    "- Needs publishing approval before external release.",
    ""
  ].join("\n");
}
