import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWorkspacePaths } from "../workspace/paths.js";

export interface DashboardReviewFocus {
  projectOrder: string[];
  excludedProjects: string[];
  maxItems: number;
}

export function readReviewFocus(workspace: string): DashboardReviewFocus | null {
  try {
    const parsed = JSON.parse(readFileSync(getWorkspacePaths(workspace).configFile, "utf8")) as {
      reviewFocus?: Record<string, unknown>;
    };
    return parsed.reviewFocus ? parseReviewFocus(parsed.reviewFocus) : null;
  } catch {
    return null;
  }
}

export function saveReviewFocus(
  workspace: string,
  input: DashboardReviewFocus,
  availableProjects: string[]
): DashboardReviewFocus {
  const configPath = getWorkspacePaths(workspace).configFile;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const focus = parseReviewFocus(input);
  const available = new Set(availableProjects.map(normalizeProjectName));

  for (const project of [...focus.projectOrder, ...focus.excludedProjects]) {
    if (!available.has(normalizeProjectName(project))) {
      throw new Error(`Unknown Project in Review focus: ${project}`);
    }
  }

  const priorities = new Set(focus.projectOrder.map(normalizeProjectName));
  const overlap = focus.excludedProjects.find((project) => priorities.has(normalizeProjectName(project)));
  if (overlap) {
    throw new Error(`A priority Project cannot also be parked: ${overlap}`);
  }

  const temporaryPath = path.join(path.dirname(configPath), `.arcadia-review-focus-${randomUUID()}.json`);
  writeFileSync(temporaryPath, `${JSON.stringify({ ...config, reviewFocus: focus }, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, configPath);
  return focus;
}

function parseReviewFocus(value: Record<string, unknown> | DashboardReviewFocus): DashboardReviewFocus {
  const projectOrder = uniqueProjectNames(value.projectOrder);
  const excludedProjects = uniqueProjectNames(value.excludedProjects);
  const maxItems = typeof value.maxItems === "number" && Number.isInteger(value.maxItems) && value.maxItems >= 1 && value.maxItems <= 20
    ? value.maxItems
    : 5;
  return { projectOrder, excludedProjects, maxItems };
}

function uniqueProjectNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((project): project is string => typeof project === "string" && Boolean(project.trim()))
    .map((project) => project.trim())
    .filter((project) => {
      const normalized = normalizeProjectName(project);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function normalizeProjectName(value: string): string {
  return value.trim().toLocaleLowerCase();
}
