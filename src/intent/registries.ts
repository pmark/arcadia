import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationError } from "../cli/errors.js";
import type { ApprovalGateType, ExecutorType, WorkClassification } from "../domain/constants.js";
import { APPROVAL_GATE_TYPES, EXECUTOR_TYPES, WORK_CLASSIFICATIONS, assertAllowedValue } from "../domain/constants.js";
import type { PlannedSkillStep } from "../execution/skills.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export interface IntentRegistry {
  version: number;
  intents: IntentDefinition[];
}

export interface IntentDefinition {
  id: string;
  aliases: string[];
  examples: string[];
  outputKind: string;
  templateRefs?: string[];
  workClassification: WorkClassification;
  nextAction: string;
  expectedArtifact?: string;
  skillSequence: PlannedSkillStep[];
  approvalGates: ApprovalGateType[];
}

export interface TemplateRegistry {
  version: number;
  templates: TemplateDefinition[];
}

export interface TemplateDefinition {
  id: string;
  title: string;
  description: string;
  projectType: string;
  defaults: Record<string, string>;
  skills: Record<string, string>;
  approvalGates: ApprovalGateType[];
}

export interface CodingAgentProfileRegistry {
  version: number;
  defaults?: Partial<Record<"planning" | "build", string>>;
  profiles: CodingAgentProfile[];
}

export interface CodingAgentProfile {
  name: string;
  provider: string;
  package: string;
  command: string;
  purpose: "planning" | "build";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  args: string[];
}

export interface Phase3Registries {
  intents: IntentRegistry;
  templates: TemplateRegistry;
  codingAgents: CodingAgentProfileRegistry;
}

export function loadPhase3Registries(workspace: string): Phase3Registries {
  return {
    intents: readRegistry<IntentRegistry>(registryPath(workspace, "intent-registry.json")),
    templates: readRegistry<TemplateRegistry>(registryPath(workspace, "template-registry.json")),
    codingAgents: readRegistry<CodingAgentProfileRegistry>(registryPath(workspace, "coding-agent-profiles.json"))
  };
}

export function validatePhase3Registries(registries: Phase3Registries): void {
  validateIntentRegistry(registries.intents);
  validateTemplateRegistry(registries.templates);
  validateCodingAgentProfileRegistry(registries.codingAgents);
}

export function getDefaultRegistryPath(fileName: string): string {
  const fromCwd = path.resolve("config", "defaults", fileName);
  if (existsSync(fromCwd)) {
    return fromCwd;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fromModule = path.resolve(moduleDir, "..", "..", "config", "defaults", fileName);
  if (existsSync(fromModule)) {
    return fromModule;
  }

  throw new Error(`Could not find default registry: ${fileName}`);
}

function registryPath(workspace: string, fileName: string): string {
  const paths = getWorkspacePaths(workspace);
  const workspacePath = path.join(paths.config, fileName);
  return existsSync(workspacePath) ? workspacePath : getDefaultRegistryPath(fileName);
}

function readRegistry<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function validateIntentRegistry(registry: IntentRegistry): void {
  if (!Number.isInteger(registry.version) || !Array.isArray(registry.intents)) {
    throw validationError("Intent registry must include version and intents.");
  }

  const seen = new Set<string>();
  for (const intent of registry.intents) {
    requireString(intent.id, "Intent id");
    if (seen.has(intent.id)) {
      throw validationError("Intent ids must be unique.", { intentId: intent.id });
    }
    seen.add(intent.id);
    requireStringArray(intent.aliases, "Intent aliases");
    requireStringArray(intent.examples, "Intent examples");
    requireString(intent.outputKind, "Intent output kind");
    assertAllowedValue("Work classification", intent.workClassification, WORK_CLASSIFICATIONS);
    requireString(intent.nextAction, "Intent next action");
    if (!Array.isArray(intent.skillSequence) || intent.skillSequence.length === 0) {
      throw validationError("Intent skill sequence is required.", { intentId: intent.id });
    }
    for (const step of intent.skillSequence) {
      requireString(step.skillName, "Skill name");
      requireString(step.title, "Skill step title");
      assertAllowedValue("Executor type", step.executorType, EXECUTOR_TYPES);
      if (typeof step.safeToRun !== "boolean") {
        throw validationError("Skill step safeToRun must be boolean.", { intentId: intent.id });
      }
    }
    validateGateTypes(intent.approvalGates ?? [], intent.id);
  }
}

function validateTemplateRegistry(registry: TemplateRegistry): void {
  if (!Number.isInteger(registry.version) || !Array.isArray(registry.templates)) {
    throw validationError("Template registry must include version and templates.");
  }

  for (const template of registry.templates) {
    requireString(template.id, "Template id");
    requireString(template.title, "Template title");
    requireString(template.description, "Template description");
    requireString(template.projectType, "Template project type");
    validateGateTypes(template.approvalGates ?? [], template.id);
  }
}

function validateCodingAgentProfileRegistry(registry: CodingAgentProfileRegistry): void {
  if (!Number.isInteger(registry.version) || !Array.isArray(registry.profiles)) {
    throw validationError("Coding agent profile registry must include version and profiles.");
  }

  for (const profile of registry.profiles) {
    requireString(profile.name, "Coding agent profile name");
    requireString(profile.provider, "Coding agent provider");
    requireString(profile.command, "Coding agent command");
    if (!["planning", "build"].includes(profile.purpose)) {
      throw validationError("Coding agent purpose must be planning or build.", { profile: profile.name });
    }
    if (!["read-only", "workspace-write", "danger-full-access"].includes(profile.sandbox)) {
      throw validationError("Coding agent sandbox is invalid.", { profile: profile.name });
    }
    if (!Array.isArray(profile.args)) {
      throw validationError("Coding agent args must be an array.", { profile: profile.name });
    }
  }

  for (const purpose of ["planning", "build"] as const) {
    const defaultName = registry.defaults?.[purpose];
    if (!defaultName) {
      continue;
    }
    const profile = registry.profiles.find((candidate) => candidate.name === defaultName);
    if (!profile) {
      throw validationError(`Default ${purpose} coding agent profile was not found.`, { profile: defaultName });
    }
    if (profile.purpose !== purpose) {
      throw validationError(`Default ${purpose} coding agent profile has the wrong purpose.`, { profile: defaultName });
    }
  }
}

function validateGateTypes(gates: ApprovalGateType[], owner: string): void {
  if (!Array.isArray(gates)) {
    throw validationError("Approval gates must be an array.", { owner });
  }

  for (const gate of gates) {
    assertAllowedValue("Approval gate type", gate, APPROVAL_GATE_TYPES);
  }
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${label} is required`);
  }
}

function requireStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw validationError(`${label} must be a non-empty string array.`);
  }
}
