import { readFileSync } from "node:fs";
import path from "node:path";
import { agentAskFingerprint, buildAgentAskEffects, normalizeAgentAsk, requiresManagedDocumentTransition, stableProposalId, type AgentAskProposal } from "../ask/agentAsk.js";
import { captureAskEnvelope } from "../ask/captureEnvelope.js";
import { resolveProjectReference } from "../ask/rules.js";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";

export interface AgentAskPreviewOptions { workspace: string; request?: string; file?: string; requestId?: string; project?: string; }
export interface AgentAskPreviewData { proposal: AgentAskProposal; preview: string[]; projectWritesPerformed: 0; replayed: boolean; }

export function runAgentAskPreviewCommand(options: AgentAskPreviewOptions): CommandSuccess<AgentAskPreviewData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (options.request && options.file) throw validationError("Pass either an Agent Ask argument or --file, not both.");
  const request = options.file ? readFileSync(path.resolve(options.file), "utf8") : options.request ?? "";
  const parsed = normalizeAgentAsk({ request, requestId: options.requestId, project: options.project });
  const normalized = withDatabase(workspacePath, (db) => {
    if (parsed.project === "unknown") return parsed;
    const project = resolveProjectReference(db, parsed.project);
    if (!project) throw validationError("Agent Ask destination Project was not found.", { project: parsed.project, remedy: "Use a configured Project reference or `project: unknown`." });
    return { ...parsed, project: project.slug };
  });
  const fingerprint = agentAskFingerprint(request, normalized);
  const result = withDatabase(workspacePath, (db) => {
    const existing = db.prepare("SELECT fingerprint, proposal_json FROM agent_ask_proposals WHERE request_id = ?").get(normalized.requestId) as { fingerprint: string; proposal_json: string } | undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw validationError("Agent Ask request id was already used with different content.", { requestId: normalized.requestId });
      return { proposal: JSON.parse(existing.proposal_json) as AgentAskProposal, replayed: true };
    }
    return db.transaction(() => {
      const capture = captureAskEnvelope(db, { requestId: normalized.requestId, originalText: request, ingressSource: "agent.ask" });
      const built = buildAgentAskEffects(normalized);
      const proposal: AgentAskProposal = { id: stableProposalId(fingerprint), captureId: capture.id, normalized, effects: built.effects, requiredDecisions: built.requiredDecisions, unchanged: [], conflicts: [], refused: [], managedDocumentTransition: { required: requiresManagedDocumentTransition(normalized.intent), status: "withheld_until_acceptance", authority: "checked_in_documents" }, queueConsequence: "none_until_accepted", writes: { captureReceipt: true, proposalReceipt: true, projectChanges: false }, nonActions: ["No Project record is created or changed by preview.", "Agent input grants no approval or execution authority."], fingerprint, createdAt: new Date().toISOString() };
      db.prepare(`INSERT INTO agent_ask_proposals (id, request_id, capture_id, fingerprint, format, intent_kind, project_ref, proposal_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(proposal.id, normalized.requestId, capture.id, fingerprint, normalized.format, normalized.intent, normalized.project, JSON.stringify(proposal), proposal.createdAt);
      return { proposal, replayed: false };
    })();
  });
  const preview = renderAgentAskPreview(result.proposal);
  return createSuccess({ command: "agent-ask.preview", workspace: workspacePath, data: { proposal: result.proposal, preview, projectWritesPerformed: 0, replayed: result.replayed } });
}
export function renderAgentAskPreviewSuccess(response: CommandSuccess<AgentAskPreviewData>): string[] { return ["Agent Ask v1 preview", ...response.data.preview]; }
function renderAgentAskPreview(proposal: AgentAskProposal): string[] { const effect = proposal.effects[0]!; return [`Request: ${proposal.normalized.requestId}${proposal.normalized.format === "natural" ? " (natural fallback)" : ""}`, `Project: ${proposal.normalized.project}`, `Intent: ${proposal.normalized.intent}`, `Proposed effect: ${effect.operation} ${effect.targetKind}${effect.targetRef ? ` ${effect.targetRef}` : ""}`, `Decisions required: ${proposal.requiredDecisions.length}`, "Queue: no entry until accepted", "Project writes: 0"]; }
