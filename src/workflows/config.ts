import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationError } from "../cli/errors.js";
import type { WorkflowDefinition, WorkflowValidationResult } from "./types.js";

export function workflowConfigDirectory(workspace: string): string {
  return path.join(path.resolve(workspace), "config", "workflows");
}

export function defaultWorkflowConfigDirectory(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve("config", "defaults", "workflows"),
    path.resolve(moduleDirectory, "..", "..", "config", "defaults", "workflows"),
    path.resolve(moduleDirectory, "..", "..", "..", "config", "defaults", "workflows")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function loadWorkflowDefinitions(workspace: string): WorkflowDefinition[] {
  const byId = new Map<string, WorkflowDefinition>();
  for (const directory of [defaultWorkflowConfigDirectory(), workflowConfigDirectory(workspace)]) {
    if (!existsSync(directory)) continue;
    for (const fileName of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
      const definition = readWorkflowDefinition(path.join(directory, fileName));
      byId.set(definition.id, definition);
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function readWorkflowDefinition(filePath: string): WorkflowDefinition {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw validationError("Workflow definition is not valid JSON.", {
      filePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const result = validateWorkflowDefinition(value);
  if (!result.valid) {
    throw validationError("Workflow definition is invalid.", { filePath, errors: result.errors });
  }
  return value as WorkflowDefinition;
}

export function getWorkflowDefinition(workspace: string, id: string): WorkflowDefinition {
  const workflow = loadWorkflowDefinitions(workspace).find((candidate) => candidate.id === id);
  if (!workflow) throw validationError("Workflow was not found.", { workflowId: id });
  return workflow;
}

export function matchWorkflowDefinition(
  workspace: string,
  inputPath: string,
  source?: string
): WorkflowDefinition | null {
  const extension = path.extname(inputPath).toLowerCase();
  const fileName = path.basename(inputPath).toLowerCase();
  return loadWorkflowDefinitions(workspace).find((workflow) => {
    if (!workflow.enabled) return false;
    if (!workflow.match.extensions.map((value) => value.toLowerCase()).includes(extension)) return false;
    if (source && !workflow.match.sources.includes(source)) return false;
    return (workflow.match.fileNameIncludes ?? []).every((part) => fileName.includes(part.toLowerCase()));
  }) ?? null;
}

export function installWorkflowDefinition(workspace: string, sourcePath: string, force = false): WorkflowDefinition {
  const definition = readWorkflowDefinition(path.resolve(sourcePath));
  const directory = workflowConfigDirectory(workspace);
  const destination = path.join(directory, `${definition.id}.json`);
  if (existsSync(destination) && !force) {
    throw validationError("Workflow definition already exists in this workspace.", {
      workflowId: definition.id,
      destination,
      recoveryAction: "Pass --force to replace the workspace override."
    });
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(destination, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  return definition;
}

export function setWorkflowEnabled(workspace: string, id: string, enabled: boolean): WorkflowDefinition {
  const definition = { ...getWorkflowDefinition(workspace, id), enabled };
  const directory = workflowConfigDirectory(workspace);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${id}.json`), `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  return definition;
}

export function validateWorkflowDefinition(value: unknown): WorkflowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["Definition must be a JSON object."], warnings };
  if (value.version !== 1) errors.push("version must be 1.");
  requireString(value, "id", errors);
  requireString(value, "name", errors);
  requireString(value, "description", errors);
  if (typeof value.enabled !== "boolean") errors.push("enabled must be a boolean.");

  const match = requireRecord(value, "match", errors);
  requireStringArray(match, "sources", errors);
  const extensions = requireStringArray(match, "extensions", errors);
  if (extensions && extensions.some((extension) => !extension.startsWith("."))) {
    errors.push("match.extensions values must start with a period.");
  }
  if (match && "fileNameIncludes" in match) requireStringArray(match, "fileNameIncludes", errors);

  const action = requireRecord(value, "action", errors);
  requireString(action, "executable", errors);
  const args = requireStringArray(action, "arguments", errors);
  if (args && !args.includes("{input}")) errors.push("action.arguments must include {input} as its own argument.");
  requireString(action, "workingDirectory", errors);
  requirePositiveNumber(action, "timeoutSeconds", errors);
  if (action && typeof action.safeToRunAutomatically !== "boolean") {
    errors.push("action.safeToRunAutomatically must be a boolean.");
  }

  const output = requireRecord(value, "output", errors);
  requireString(output, "directory", errors);
  requireString(output, "expectedPattern", errors);
  requireString(output, "collectedPathPrefix", errors);

  const publication = requireRecord(value, "publication", errors);
  requireString(publication, "destinationRoot", errors);
  const directoryTemplate = requireString(publication, "directoryTemplate", errors);
  if (directoryTemplate && (!directoryTemplate.includes("{yyyy}") || !directoryTemplate.includes("{mmdd}"))) {
    errors.push("publication.directoryTemplate must include {yyyy} and {mmdd}.");
  }
  requireString(publication, "fileNameTemplate", errors);
  if (publication && !["sha256", "size"].includes(String(publication.verify))) {
    errors.push("publication.verify must be sha256 or size.");
  }

  const retry = requireRecord(value, "retry", errors);
  requirePositiveNumber(retry, "maxAttempts", errors);
  if (retry && retry.idempotency !== "sha256") errors.push("retry.idempotency must be sha256.");

  return { valid: errors.length === 0, errors, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(parent: Record<string, unknown>, key: string, errors: string[]): Record<string, unknown> | null {
  const value = parent[key];
  if (!isRecord(value)) {
    errors.push(`${key} must be an object.`);
    return null;
  }
  return value;
}

function requireString(parent: Record<string, unknown> | null, key: string, errors: string[]): string | null {
  const value = parent?.[key];
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${key} must be a non-empty string.`);
    return null;
  }
  return value;
}

function requireStringArray(parent: Record<string, unknown> | null, key: string, errors: string[]): string[] | null {
  const value = parent?.[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${key} must be a non-empty string array.`);
    return null;
  }
  return value as string[];
}

function requirePositiveNumber(parent: Record<string, unknown> | null, key: string, errors: string[]): number | null {
  const value = parent?.[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${key} must be a positive number.`);
    return null;
  }
  return value;
}
