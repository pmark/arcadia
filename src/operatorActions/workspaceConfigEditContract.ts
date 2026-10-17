import path from "node:path";

/**
 * A pinned, one-shot removal of one workspace-config field (Decision 0123:
 * removing `codingAgent.capacityGateEnabled: false` is operator-owned). The
 * shape is deliberately narrow: one allowlisted field, its exact expected
 * value, and the exact workspace. Production must read Inactive, the config
 * must still hold exactly the pinned value, and the edit rewrites only that
 * field. It never adds, sets or restores a field; the inverse is a separate
 * operator decision, documented in the receipt and never built here.
 */
export interface WorkspaceConfigEditInput {
  schema: "arcadia-workspace-config-edit-v1";
  /** Absolute path of the exact workspace; the run refuses any other resolution. */
  workspace: string;
  operation: "remove";
  field: WorkspaceConfigEditField;
  /** The exact value the field must hold before the edit. */
  expected: false;
}

/** Allowlist. Widening it is a reviewed code change, never a descriptor edit. */
export const WORKSPACE_CONFIG_EDIT_FIELDS = ["codingAgent.capacityGateEnabled"] as const;
export type WorkspaceConfigEditField = (typeof WORKSPACE_CONFIG_EDIT_FIELDS)[number];

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateWorkspaceConfigEditInput(value: unknown): WorkspaceConfigEditInput {
  const v = value as WorkspaceConfigEditInput;
  if (!v || typeof v !== "object" || Array.isArray(v) ||
      Object.keys(v).sort().join(",") !== "expected,field,operation,schema,workspace" ||
      v.schema !== "arcadia-workspace-config-edit-v1" || v.operation !== "remove" ||
      !(WORKSPACE_CONFIG_EDIT_FIELDS as readonly string[]).includes(v.field) || v.expected !== false ||
      typeof v.workspace !== "string" || !path.isAbsolute(v.workspace) || path.normalize(v.workspace) !== v.workspace ||
      v.workspace.endsWith(path.sep)) {
    throw new Error("workspaceConfigEdit needs exactly schema arcadia-workspace-config-edit-v1, an absolute normalized workspace, operation remove, an allowlisted field and expected false.");
  }
  return v;
}

/** Exact executable shape: the worker owns every check, so the launcher carries no logic. */
export function workspaceConfigEditLauncher(id: string): string {
  if (!slug.test(id)) throw new Error("Operator action id must be a lowercase slug.");
  return '#!/usr/bin/env bash\nset -euo pipefail\nlibrary_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nrepo="$(cd "$library_dir/../../.." && pwd)"\ncd "$repo"\nexec mise exec -- node --import tsx "$repo/scripts/workspace-config-edit-worker.ts" "$library_dir/' + id + '.json" "${1:-}"\n';
}
