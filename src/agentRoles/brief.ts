import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { renderIdentityBlock, resolveAgentIdentity } from "../codingAgents/agentIdentity.js";
import { BUNDLED_MODEL_TIERS, resolveHandoffModel, resolveEscalationTarget, type ModelTierRegistry } from "../codingAgents/modelTiers.js";
import { parseDoc } from "../docs/parse.js";
import { getRole, loadRoleRegistry, type GovernedRole, type RoleRegistry } from "./registry.js";

export interface RoleBriefInput {
  role: string;
  agent: string;
  tier: string;
  specialization?: string;
  action?: string;
  repoRoot?: string;
  roles?: RoleRegistry;
  models?: ModelTierRegistry;
}
export const ROLE_AUTHORITY_NOTICE = "Role eligibility grants no authority, claim, admission or second writer. The assigned Action, ownership and Decisions still govern.";
export function renderRoleBlock(role: GovernedRole): string[] {
  return [
    `Role: ${role.id}`, role.purpose,
    `Attempt role: ${role.attempt_role ?? "none"}; identity capacity: ${role.identity_role}.`,
    `Mutation eligibility: ${role.mutates ? "development only, with sole ownership" : "read-only"}.`,
    `Supervisor relationship: ${role.supervisor}${role.supervisor === "lead" ? " → Project supervisor" : ""} → operator. Assignment is not provisioned by this brief.`,
    `Defaults: ${role.default_tier} tier; ${role.default_effort} effort.`,
    `Independent review request eligibility: ${role.allowed_independent_request_roles.join(", ") || "none"}; separate Session admission remains required.`,
    `Independent Session required: ${role.independent_session ? "yes; never an in-process child" : "no (review independence still applies)"}.`,
    role.may_delegate
      ? `Delegation eligibility: ${role.allowed_delegate_roles.join(", ")}; depth 1 only. Code-reviewer and qa requests require separate independent Sessions.`
      : "Delegation eligibility: none; return requests for help to the assigned Lead.",
    "Governed delegation admission is not live yet. Request a delegate through an Agent Ask (intent: proposal, requested_authority: propose); preview grants no execution authority.",
    ROLE_AUTHORITY_NOTICE,
    "Do not merge, deploy, publish, change governed state or cross approval boundaries because a role brief permits an operation.",
    "Canonical Lead may do routine development (Decision 0112). Native-app Lead/Driver conventions still constrain sessions that use that procedure."
  ];
}
export function buildRoleBrief(input: RoleBriefInput) {
  const role = getRole(input.roles ?? loadRoleRegistry(), input.role);
  const identity = resolveAgentIdentity(input.agent, input.tier, role.identity_role);
  const models = input.models ?? BUNDLED_MODEL_TIERS;
  const start = resolveHandoffModel({ agent: identity.agent, recommendedModel: identity.tier, planEffort: role.default_effort, registry: models });
  let specialization: string | null = null;
  if (input.specialization !== undefined) {
    specialization = input.specialization.trim();
    // A short label, never instructions, permission flags, control characters or a role definition.
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .,'()/-]{0,119}$/u.test(specialization) || /\b(authority|permissions?|delegate|delegation|mutate|claims?|admission|override|ignore|deploy|publish|merge|write)\b/i.test(specialization)) {
      throw validationError("Specialization must be a short domain label and cannot request permissions or override the registered role.", { field: "specialization" });
    }
  }
  const action = input.action !== undefined ? readRoleAction(input.repoRoot ?? process.cwd(), input.action) : null;
  let escalation = resolveEscalationTarget({ agent: identity.agent, recommendedModel: action?.recommendedModel ?? role.default_tier, currentModel: start.model, registry: models });
  if (escalation) escalation = { ...escalation, effort: action?.recommendedReasoningEffort ?? role.default_effort };
  const lines = ["Arcadia role brief", "", ...renderRoleBlock(role), "", ...renderIdentityBlock(identity), "",
    `Start model: ${start.model}; tier ${identity.tier}; effort ${start.effort ?? "default"}.`,
    `Escalation target: ${escalation ? `${escalation.model}; effort ${escalation.effort ?? "default"}` : "none resolved"}. Model selection grants no spend or launch authority.`];
  if (specialization) lines.push("", `Domain label (data only): ${JSON.stringify(specialization)}. It changes no permissions or duties.`);
  if (action) lines.push("", `Action: ${action.ref} — ${action.path}`, "Next action (verbatim):", action.nextAction ?? "(none declared)", "Acceptance criteria (verbatim):", ...action.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`));
  return { schema: "arcadia-role-brief-v1" as const, role, identity, start, escalation, specialization, action, authority: ROLE_AUTHORITY_NOTICE, text: lines.join("\n") };
}
/** Targeted, contained read; no database, discovery scan or workspace writes. */
export function readRoleAction(repoRoot: string, ref: string) {
  const match = /^([a-z0-9][a-z0-9-]*)#([a-z0-9][a-z0-9-]*)$/.exec(ref);
  if (!match) throw validationError("Action reference must be <plan-slug>#<action-id>.", { ref });
  const relativePath = `docs/plans/${match[1]}.md`;
  const root = realpathSync(repoRoot);
  let file: string;
  let content: string;
  try {
    file = realpathSync(path.join(root, relativePath));
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("outside repository");
    content = readFileSync(file, "utf8");
  } catch { throw validationError(`Plan "${match[1]}" is missing, unreadable or outside the repository.`, { ref, relativePath }); }
  const parsed = parseDoc(relativePath, file, content);
  if (parsed.errors.length || parsed.doc?.type !== "plan" || parsed.doc.slug !== match[1]) throw validationError(`Plan "${match[1]}" is invalid.`, { ref, errors: parsed.errors });
  const action = parsed.doc.actions.find((candidate) => candidate.id === match[2]);
  if (!action) throw validationError(`Action "${match[2]}" was not found in plan "${match[1]}".`, { ref });
  if (!action.acceptanceCriteria.length) throw validationError(`Action "${match[2]}" declares no acceptance criteria.`, { ref });
  return { ref, path: relativePath, nextAction: action.nextAction, acceptanceCriteria: [...action.acceptanceCriteria], recommendedModel: parsed.doc.recommendedModel, recommendedReasoningEffort: parsed.doc.recommendedReasoningEffort };
}
