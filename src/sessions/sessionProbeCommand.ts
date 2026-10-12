import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationError } from "../cli/errors.js";
import { sessionRecordDirectory } from "./sessionRecording.js";

/**
 * The in-Session capability probe's command. The script ships with Arcadia
 * (src/sessions and dist/sessions both sit two levels under the package
 * root; `package.json` build copies it into dist/scripts), not with the
 * Project's worktree, so every Project's Session can run it by absolute path.
 */
export const SESSION_PROBE_SCRIPT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/session-capability-probe.mjs");

/** `<workspace>/.arcadia/sessions/<session id>.probe-nonce`: the per-launch secret the probe must echo. */
export function sessionProbeNoncePath(workspace: string, sessionId: string): string {
  return path.join(sessionRecordDirectory(workspace), `${sessionId}.probe-nonce`);
}

/** The Session's recorded probe nonce, or null when no probe was issued for it. */
export function readSessionProbeNonce(workspace: string, sessionId: string): string | null {
  try {
    const value = readFileSync(sessionProbeNoncePath(workspace, sessionId), "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export interface SessionProbeLaunch {
  /** The one exact command string the brief names and the headless allow rule pins. */
  command: string;
  nonce: string;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Issue the probe for one Session at command-build time. Fails closed: a
 * missing script (an incomplete packaged build) refuses the launch with a
 * named remedy, because a probe that never runs would read as "no wall".
 * The nonce is random per Session, kept in the workspace (never the repo) and
 * reused on a resume, so the host accepts only a probe line that echoes it.
 */
export function issueSessionProbe(input: { workspace: string; sessionId: string; worktreePath: string; scriptPath?: string }): SessionProbeLaunch {
  const script = input.scriptPath ?? SESSION_PROBE_SCRIPT_PATH;
  if (!existsSync(script)) {
    throw validationError(
      `The Session capability probe script is missing (${script}), so no Session can be launched with its first-step environment probe.`,
      { code: "session_probe_missing", sessionId: input.sessionId, remedy: "Rebuild the package (`pnpm build` copies scripts/session-capability-probe.mjs into dist/scripts) or reinstall Arcadia, then retry." }
    );
  }
  let nonce = readSessionProbeNonce(input.workspace, input.sessionId);
  if (!nonce) {
    nonce = randomBytes(16).toString("hex");
    const file = sessionProbeNoncePath(input.workspace, input.sessionId);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${nonce}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return {
    command: `node ${script} --workspace ${quote(input.workspace)} --worktree ${quote(input.worktreePath)} --nonce ${nonce}`,
    nonce
  };
}
