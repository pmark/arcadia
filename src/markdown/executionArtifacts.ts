import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExecutionRunSummary, WorkItemSummary } from "../domain/types.js";
import { localDateStamp } from "../utils/time.js";
import { slugify } from "../utils/slug.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";

export function writeSpecificationArtifact(workspace: string, workItem: WorkItemSummary): string {
  const relativePath = artifactRelativePath(workspace, "specifications", workItem, "specification");
  const absolutePath = path.join(getWorkspacePaths(workspace).root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    [
      `# Specification: ${workItem.title}`,
      "",
      `Source work item: ${workItem.id}`,
      `Project: ${workItem.project_name ?? "Unassigned"}`,
      "",
      "## Captured Intent",
      "",
      workItem.raw_input,
      "",
      "## Next Action",
      "",
      workItem.next_action,
      ""
    ].join("\n"),
    "utf8"
  );
  return absolutePath;
}

export function writePublicationPacket(workspace: string, workItem: WorkItemSummary): string {
  const relativePath = artifactRelativePath(workspace, "publication-packets", workItem, "packet");
  const absolutePath = path.join(getWorkspacePaths(workspace).root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    [
      `# Publication Packet: ${workItem.title}`,
      "",
      `Source work item: ${workItem.id}`,
      `Project: ${workItem.project_name ?? "Unassigned"}`,
      "",
      "## Intent",
      "",
      workItem.raw_input,
      "",
      "## Review Required",
      "",
      "The user must approve the packet before publication.",
      ""
    ].join("\n"),
    "utf8"
  );
  return absolutePath;
}

export function renderRunSummary(run: ExecutionRunSummary): string {
  const lines = [
    `Execution run ${run.id}`,
    `Status: ${run.status}`,
    `Work item: ${run.work_item_title}`,
    `Plan: ${run.plan_id}`,
    `Mission log: ${run.mission_log_path ?? "None"}`,
    "",
    "Steps:"
  ];

  for (const step of run.steps) {
    const detail = step.error ? ` - ${step.error}` : step.output ? ` - ${step.output}` : "";
    lines.push(`- ${step.status}: ${step.plan_step_title}${detail}`);
  }

  if (run.artifacts.length > 0) {
    lines.push("", "Artifacts:");
    for (const artifact of run.artifacts) {
      lines.push(`- ${artifact.title}: ${artifact.path ?? "No path"}`);
    }
  }

  return lines.join("\n");
}

function artifactRelativePath(workspace: string, group: string, workItem: WorkItemSummary, suffix: string): string {
  const paths = getWorkspacePaths(workspace);
  const absolutePath = path.join(
    paths.artifacts,
    group,
    `${localDateStamp()}-${slugify(workItem.title)}-${suffix}.md`
  );
  return toWorkspaceRelativePath(workspace, absolutePath);
}
