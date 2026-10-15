/** Navigation selects records only. It does not imply Ask routing or execution authority. */
export interface WorkspaceScope { project?: string; plan?: string; action?: string }
export function parseWorkspaceScope(parts: string[] = []): WorkspaceScope | null {
  if (parts.length === 0) return {};
  if (![2, 4, 6].includes(parts.length) || parts[0] !== "projects" || !parts[1]) return null;
  if (parts.length >= 4 && (parts[2] !== "plans" || !parts[3])) return null;
  if (parts.length === 6 && (parts[4] !== "actions" || !parts[5])) return null;
  return { project: parts[1], ...(parts[3] ? { plan: parts[3] } : {}), ...(parts[5] ? { action: parts[5] } : {}) };
}
export function workspaceHref(scope: WorkspaceScope = {}): string {
  let path = "/workspace";
  if (scope.project) path += `/projects/${encodeURIComponent(scope.project)}`;
  if (scope.project && scope.plan) path += `/plans/${encodeURIComponent(scope.plan)}`;
  if (scope.project && scope.plan && scope.action) path += `/actions/${encodeURIComponent(scope.action)}`;
  return path;
}
/** CLI Action keys have a Project prefix; preserve the complete remaining id. */
export function workspaceActionId(key: string): string { return key.slice(key.indexOf("/") + 1); }
