import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { loadModelTierRegistry } from "../codingAgents/modelTiers.js";
import { resolveWorkspace } from "../workspace/resolve.js";
import { loadRoleRegistry, getRole } from "../agentRoles/registry.js";
import { buildRoleBrief, renderRoleBlock, type RoleBriefInput } from "../agentRoles/brief.js";

export function runRolesCommand(options: { workspace?: string; id?: string } = {}) {
  const workspace = resolveWorkspace({ workspace: options.workspace }).workspacePath;
  const registry = loadRoleRegistry(workspace);
  return createSuccess({ command: options.id ? "roles show" : "roles", data: { schema: "arcadia-roles-v1" as const, session_start_role: registry.session_start_role, roles: options.id ? [getRole(registry, options.id)] : registry.roles } });
}
export function renderRolesSuccess(response: ReturnType<typeof runRolesCommand>): string[] {
  return response.data.roles.flatMap((role) => [...renderRoleBlock(role), ""]);
}
export function runRoleBriefCommand(options: RoleBriefInput & { workspace?: string }) {
  const workspace = resolveWorkspace({ workspace: options.workspace }).workspacePath;
  return createSuccess({ command: "role brief", data: buildRoleBrief({ ...options, roles: loadRoleRegistry(workspace), models: loadModelTierRegistry(workspace) }) });
}
export function renderRoleBriefSuccess(response: CommandSuccess<ReturnType<typeof buildRoleBrief>>): string[] {
  return [response.data.text];
}
