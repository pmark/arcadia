import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationError } from "../cli/errors.js";
import { sessionRecordDirectory } from "./sessionRecording.js";

/**
 * The in-Session capability probe's command. The script ships with Arcadia
 * (src/sessions and dist/src/sessions both sit two levels under the
 * directory that holds scripts/ or dist/scripts; `package.json` build copies it into dist/scripts), not with the
 * Project's worktree, so every Project's Session can run it by absolute path.
 */
export const SESSION_PROBE_SCRIPT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/session-capability-probe.mjs");

/** `<workspace>/.arcadia/sessions/<session id>.probe-nonce`: a per-launch binding input, never evidence by itself. */
export function sessionProbeNoncePath(workspace: string, sessionId: string): string {
  return path.join(sessionRecordDirectory(workspace), `${sessionId}.probe-nonce`);
}
export function sessionCompletionContractPath(workspace: string, sessionId: string): string {
  return path.join(sessionRecordDirectory(workspace), `${sessionId}.completion-capability.json`);
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

export function readSessionCompletionContract(workspace: string, sessionId: string): HostCompletionCapabilityContract | null {
  try {
    const value = JSON.parse(readFileSync(sessionCompletionContractPath(workspace, sessionId), "utf8")) as HostCompletionCapabilityContract;
    if (value.schema !== "arcadia.host-completion-capability-v1" || value.sessionId !== sessionId
      || !value.packetId || !/^[a-f0-9]{64}$/.test(value.packetSha256) || !/^[a-f0-9]{64}$/.test(value.probeNonceSha256)
      || !["required", "unavailable"].includes(value.requirements?.directWorkspaceWrite)
      || value.requirements?.localAskTransport !== "required" || value.requirements?.freshHostValidationAtSettlement !== "required") return null;
    return value;
  } catch { return null; }
}

export interface SessionProbeLaunch {
  /** The one exact command string the brief names and the headless allow rule pins. */
  command: string;
  nonce: string;
  contractDigest: string;
}

export interface HostCompletionCapabilityContract {
  schema: "arcadia.host-completion-capability-v1";
  sessionId: string;
  packetId: string;
  packetSha256: string;
  probeNonceSha256: string;
  requirements: {
    directWorkspaceWrite: "required" | "unavailable";
    localAskTransport: "required";
    freshHostValidationAtSettlement: "required";
  };
}

export function completionCapabilityContract(input: {
  sessionId: string; packetId: string; packetSha256: string; nonce: string; directWorkspaceWrite: "required" | "unavailable";
}): HostCompletionCapabilityContract {
  return {
    schema: "arcadia.host-completion-capability-v1", sessionId: input.sessionId, packetId: input.packetId,
    packetSha256: input.packetSha256,
    probeNonceSha256: createHash("sha256").update(input.nonce).digest("hex"),
    requirements: { directWorkspaceWrite: input.directWorkspaceWrite, localAskTransport: "required", freshHostValidationAtSettlement: "required" }
  };
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Issue the probe for one Session at command-build time. Fails closed: a
 * missing script (an incomplete packaged build) refuses the launch with a
 * named remedy, because a probe that never runs would read as "no wall".
 * The nonce is random per launch and binds the host contract to the exact
 * invocation. It is not a secret: provider command/result provenance supplies
 * attribution, so a narrated or echoed value never establishes a pass.
 */
export function issueSessionProbe(input: { workspace: string; sessionId: string; packetId: string; packetSha256: string; worktreePath: string; directWorkspaceWrite: "required" | "unavailable"; scriptPath?: string }): SessionProbeLaunch {
  const script = input.scriptPath ?? SESSION_PROBE_SCRIPT_PATH;
  if (!existsSync(script)) {
    throw validationError(
      `The Session capability probe script is missing (${script}), so no Session can be launched with its first-step environment probe.`,
      { code: "session_probe_missing", sessionId: input.sessionId, remedy: "Rebuild the package (`pnpm build` copies scripts/session-capability-probe.mjs into dist/scripts) or reinstall Arcadia, then retry." }
    );
  }
  const nonce = randomBytes(16).toString("hex");
  mkdirSync(sessionRecordDirectory(input.workspace), { recursive: true });
  const contract = completionCapabilityContract({ sessionId: input.sessionId, packetId: input.packetId, packetSha256: input.packetSha256, nonce, directWorkspaceWrite: input.directWorkspaceWrite });
  const contractDigest = createHash("sha256").update(JSON.stringify(contract)).digest("hex");
  const contractFile = sessionCompletionContractPath(input.workspace, input.sessionId);
  writeFileSync(contractFile, `${JSON.stringify(contract)}\n`, { mode: 0o600 });
  chmodSync(contractFile, 0o600);
  const file = sessionProbeNoncePath(input.workspace, input.sessionId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${nonce}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return {
    command: `node ${script} --workspace ${quote(input.workspace)} --worktree ${quote(input.worktreePath)} --nonce ${nonce} --contract ${contractDigest} --workspace-write ${input.directWorkspaceWrite}`,
    nonce,
    contractDigest
  };
}
