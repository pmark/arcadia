import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import { systemTmux, type TmuxAdapter } from "../sessions/index.js";
import {
  applyHandoffRetirement,
  previewHandoffRetirement,
  type HandoffRetirementPreview,
  type HandoffRetirementRecord
} from "../sessions/handoffRetirement.js";

export interface SessionRetireHandoffOptions {
  workspace: string;
  session: string;
  requestId: string;
  reason: string;
  apply?: boolean;
  /** The exact fingerprint printed by the preview; required with `apply`. */
  preview?: string;
  tmux?: TmuxAdapter;
}

export type SessionRetireHandoffData =
  | ({ mode: "preview" } & HandoffRetirementPreview)
  | { mode: "apply"; created: boolean; retirement: HandoffRetirementRecord };

/** `arcadia session retire-handoff`: previews unless `--apply --preview <fingerprint>`. */
export function runSessionRetireHandoffCommand(options: SessionRetireHandoffOptions): CommandSuccess<SessionRetireHandoffData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const input = { sessionId: options.session, requestId: options.requestId, reason: options.reason, tmux: options.tmux ?? systemTmux };
  if (!options.apply) {
    const data = withReadOnlyDatabase(workspacePath, db => previewHandoffRetirement({ db, ...input }));
    return createSuccess({ command: "session.retireHandoff", workspace: workspacePath, data: { mode: "preview", ...data } });
  }
  if (!options.preview) throw validationError("--apply needs the exact --preview <fingerprint> printed by the preview.");
  const result = withDatabase(workspacePath, db => applyHandoffRetirement({ db, ...input, fingerprint: options.preview! }));
  return createSuccess({ command: "session.retireHandoff", workspace: workspacePath, data: { mode: "apply", ...result } });
}

export function renderSessionRetireHandoffSuccess(response: CommandSuccess<SessionRetireHandoffData>): string[] {
  const data = response.data;
  if (data.mode === "apply") {
    const { retirement, created } = data;
    return [
      `Retired handoff: ${retirement.id}${created ? "" : " (already recorded)"}`,
      `Session ${retirement.session_id} (${retirement.project_slug}/${retirement.action_id}) is no longer resumable; the next tick dispatches the Action fresh.`,
      `Worktree (left on disk, untouched, for manual salvage): ${retirement.worktree_path}`,
      `Branch ${retirement.branch} · base ${retirement.base_revision.slice(0, 12)}${retirement.candidate_revision ? ` · candidate ${retirement.candidate_revision.slice(0, 12)}` : ""}`,
      `Reason: ${retirement.reason}`
    ];
  }
  const binding = data.binding;
  return [
    `Ready: ${data.ready ? "yes" : "no"}`,
    ...(data.fingerprint ? [`Retirement fingerprint: ${data.fingerprint}`] : []),
    ...(binding ? [
      `Session: ${binding.sessionId} · ${binding.projectSlug}/${binding.actionId} · request ${binding.requestId}`,
      `Worktree (stays on disk, untouched): ${binding.worktreePath} @ base ${binding.baseRevision.slice(0, 12)}`,
      `Claim to release: ${binding.claimGeneration ?? "(none held by this candidate)"}`
    ] : []),
    ...(data.retirement ? [`Already retired: ${data.retirement.id} at ${data.retirement.created_at} (request ${data.retirement.request_id})`] : []),
    ...data.refusals.map(refusal => `Refused (${refusal.code}): ${refusal.reason}`),
    ...(data.ready ? [`Apply with: --apply --preview ${data.fingerprint}`] : [])
  ];
}
