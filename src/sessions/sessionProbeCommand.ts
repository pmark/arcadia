import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The in-Session capability probe's command. The script ships with Arcadia
 * (src/sessions and dist/sessions both sit two levels under the package
 * root), not with the Project's worktree, so every Project's Session can run
 * it by absolute path.
 */
export const SESSION_PROBE_SCRIPT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/session-capability-probe.mjs");

/** The command prefix a headless allow rule matches (arguments follow). */
export const SESSION_PROBE_COMMAND_PREFIX = `node ${SESSION_PROBE_SCRIPT_PATH}`;

export function sessionProbeCommand(workspace: string, worktreePath: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `${SESSION_PROBE_COMMAND_PREFIX} --workspace ${quote(workspace)} --worktree ${quote(worktreePath)}`;
}
