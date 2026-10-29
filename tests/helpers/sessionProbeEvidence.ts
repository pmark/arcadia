import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sourceCompletionCapability } from "../../src/production/sessionCapability.js";
import { readSessionProbeNonce, SESSION_PROBE_SCRIPT_PATH } from "../../src/sessions/sessionProbeCommand.js";
import { sessionLogPath } from "../../src/sessions/sessionRecording.js";

export type ProbeBoundSession = { id: string; packet_id: string; packet_sha256: string; worktree_path: string; completion_capability_mode: "legacy" | "source_only" | "direct_required" };

/** Fixture-only provider evidence for an already host-issued Session contract. */
export function recordClearProbeEvidence(workspace: string, session: ProbeBoundSession): void {
  if (session.completion_capability_mode === "legacy") return;
  const capability = sourceCompletionCapability(workspace, session);
  const nonce = readSessionProbeNonce(workspace, session.id);
  if (!capability || !nonce) throw new Error("fixture Session has no host completion contract");
  const file = sessionLogPath(workspace, session.id);
  const prior = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (prior.includes(capability.probeCommand)) return;
  const run = spawnSync(process.execPath, [SESSION_PROBE_SCRIPT_PATH, "--workspace", workspace, "--worktree", session.worktree_path, "--nonce", nonce, "--contract", capability.probeContractDigest, "--workspace-write", capability.directWorkspaceWrite], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`fixture probe failed: ${run.stdout}`);
  const id = `probe-${session.id}`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, prior + [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: capability.probeCommand } }] } }), JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: run.stdout }] } })].join("\n") + "\n");
}
