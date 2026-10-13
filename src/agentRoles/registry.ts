import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import bundled from "../../config/defaults/agent-roles.json" with { type: "json" };
import { validationError } from "../cli/errors.js";
import { MODEL_TIERS, type ModelTier } from "../codingAgents/modelTiers.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "../execution/profiles.js";
import { SESSION_ATTEMPT_ROLES, type SessionAttemptRole } from "../sessions/enrollment.js";

export const ROLE_IDS = ["lead", "planner", "plan-critic", "implementer", "code-reviewer", "qa", "researcher"] as const;
export type RoleId = typeof ROLE_IDS[number];
export interface GovernedRole {
  id: RoleId;
  purpose: string;
  attempt_role: SessionAttemptRole | null;
  identity_role: "builder" | "critic";
  mutates: boolean;
  may_delegate: boolean;
  allowed_delegate_roles: RoleId[];
  allowed_independent_request_roles: RoleId[];
  max_delegation_depth: number;
  supervisor: "lead" | "project-supervisor";
  default_tier: ModelTier;
  default_effort: ReasoningEffort;
  independent_session: boolean;
}
export interface RoleRegistry {
  schema: "arcadia-agent-roles-v1";
  session_start_role: "lead";
  roles: GovernedRole[];
}
function fail(role: string, field: string): never {
  throw validationError(`Role "${role}" has an invalid or unapproved ${field}.`, { role, field });
}
function object(value: unknown, role: string, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(role, field);
  return value as Record<string, unknown>;
}
/** Canonical authority cannot be expanded by a local config override. */
export function validateRoleRegistry(value: unknown): RoleRegistry {
  const root = object(value, "registry", "registry");
  for (const key of Object.keys(root)) if (!["schema", "session_start_role", "roles"].includes(key)) fail("registry", key);
  if (root.schema !== "arcadia-agent-roles-v1") fail("registry", "schema");
  if (root.session_start_role !== "lead") fail("registry", "session_start_role");
  if (!Array.isArray(root.roles) || root.roles.length !== ROLE_IDS.length) fail("registry", "roles");
  const seen = new Set<string>();
  const roles = root.roles.map((value: unknown) => {
    const row = object(value, "unknown", "role");
    const id = String(row.id);
    const canonical = bundled.roles.find((role) => role.id === id);
    if (!canonical || seen.has(id)) fail(id, "id");
    seen.add(id);
    const expectedAttempt = { lead: "development", planner: "planner", "plan-critic": "critique", implementer: "development", "code-reviewer": "code-review", qa: "qa", researcher: null }[id as RoleId];
    if (row.attempt_role !== expectedAttempt) fail(id, "attempt_role");
    const critic = ["plan-critic", "code-reviewer", "qa"].includes(id);
    const independent = ["code-reviewer", "qa"].includes(id);
    if (row.identity_role !== (critic ? "critic" : "builder")) fail(id, "identity_role");
    if (row.independent_session !== independent) fail(id, "independent_session");
    if (row.mutates !== ["lead", "implementer"].includes(id)) fail(id, "mutates");
    if (row.may_delegate !== (id === "lead")) fail(id, "may_delegate");
    if (row.max_delegation_depth !== (id === "lead" ? 1 : 0)) fail(id, "max_delegation_depth");
    if (row.supervisor !== (id === "lead" || independent ? "project-supervisor" : "lead")) fail(id, "supervisor");
    if (JSON.stringify(row.allowed_independent_request_roles) !== JSON.stringify(id === "lead" ? ["code-reviewer", "qa"] : [])) fail(id, "allowed_independent_request_roles");
    if (JSON.stringify(row.allowed_delegate_roles) !== JSON.stringify(id === "lead" ? ["planner", "plan-critic", "implementer", "researcher"] : [])) fail(id, "allowed_delegate_roles");
    for (const key of Object.keys(row)) if (!(key in canonical)) fail(id, key);
    if (row.attempt_role !== null && !(SESSION_ATTEMPT_ROLES as readonly unknown[]).includes(row.attempt_role)) fail(id, "attempt_role");
    if (row.mutates && row.attempt_role !== "development") fail(id, "mutates");
    if (row.mutates && row.identity_role === "critic") fail(id, "identity_role");
    for (const key of Object.keys(canonical)) {
      if (key === "default_tier" || key === "default_effort") continue;
      if (JSON.stringify(row[key]) !== JSON.stringify(canonical[key as keyof typeof canonical])) fail(id, key);
    }
    if (!(MODEL_TIERS as readonly unknown[]).includes(row.default_tier)) fail(id, "default_tier");
    if (!(REASONING_EFFORTS as readonly unknown[]).includes(row.default_effort)) fail(id, "default_effort");
    return structuredClone(row) as unknown as GovernedRole;
  });
  return { schema: "arcadia-agent-roles-v1", session_start_role: "lead", roles: ROLE_IDS.map((id) => roles.find((role) => role.id === id)!) };
}
export function mergeRoleRegistry(base: RoleRegistry, override: unknown): RoleRegistry {
  const root = object(override, "registry", "override");
  for (const key of Object.keys(root)) if (!["schema", "roles"].includes(key)) fail("registry", key);
  if (root.schema !== "arcadia-agent-roles-v1") fail("registry", "schema");
  const patches = object(root.roles, "registry", "roles");
  const merged = structuredClone(base);
  for (const [id, patch] of Object.entries(patches)) {
    const role = merged.roles.find((candidate) => candidate.id === id);
    if (!role) fail(id, "id");
    const fields = object(patch, id, "override");
    // Defaults are operational preferences, never a local authority amendment.
    for (const key of Object.keys(fields)) if (!["default_tier", "default_effort"].includes(key)) fail(id, key);
    Object.assign(role, fields);
  }
  return validateRoleRegistry(merged);
}
export function loadRoleRegistry(workspace?: string | null): RoleRegistry {
  const base = validateRoleRegistry(bundled);
  if (!workspace) return base;
  const file = path.join(path.resolve(workspace), "config", "agent-roles.json");
  if (!existsSync(file)) return base;
  let override: unknown;
  try { override = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw validationError("The agent-roles override is not valid JSON.", { file }); }
  return mergeRoleRegistry(base, override);
}
export function getRole(registry: RoleRegistry, id: string): GovernedRole {
  const role = registry.roles.find((candidate) => candidate.id === id);
  if (!role) fail(id, "id");
  return structuredClone(role);
}
/** Describes policy eligibility only; admission and ownership remain separate. */
export function assertRoleOperation(registry: RoleRegistry, id: string, operation: "mutate" | "delegate" | "independent-review-request", target?: string, depth = 0): void {
  const role = getRole(registry, id);
  if (!["mutate", "delegate", "independent-review-request"].includes(operation)) fail(id, "operation");
  if (operation === "mutate") {
    if (!role.mutates) fail(id, "mutates");
    return;
  }
  if (operation === "independent-review-request") {
    if (depth !== 0 || !role.allowed_independent_request_roles.includes(target as RoleId)) fail(id, "independent-review-request");
    return;
  }
  if (!role.may_delegate || depth !== 0 || !role.allowed_delegate_roles.includes(target as RoleId)) fail(id, "delegation");
}
