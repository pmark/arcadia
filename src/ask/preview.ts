import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import {
  agentAskFingerprint,
  buildAgentAskEffects,
  normalizeAgentAsk,
  requiresManagedDocumentTransition,
  stableProposalId,
  type AgentAskProposal
} from "./agentAsk.js";
import { captureAskEnvelope } from "./captureEnvelope.js";
import { resolveProjectReference } from "./rules.js";

export interface PreviewAgentAskRequestInput { request: string; requestId?: string; project?: string; sourcePath?: string | null; }
export interface PreviewAgentAskRequestResult { proposal: AgentAskProposal; replayed: boolean; }

/**
 * Validate one Agent Ask request against `db` and record its preview
 * proposal, or return the existing proposal unchanged when this exact
 * request id and content were already previewed. This is the one place that
 * decides "new proposal" vs. "replay" vs. "conflicting content under a used
 * id" — both the explicit `agent-ask preview` command and automatic
 * discovery of unprocessed `.arcadia/asks/` files call it, so a file
 * discovered automatically is judged by exactly the same rule as one a
 * human or agent previews by hand.
 */
export function previewAgentAskRequest(db: Database.Database, input: PreviewAgentAskRequestInput): PreviewAgentAskRequestResult {
  const parsed = normalizeAgentAsk({ request: input.request, requestId: input.requestId, project: input.project });
  const normalized = parsed.project === "unknown" ? parsed : (() => {
    const project = resolveProjectReference(db, parsed.project);
    if (!project) throw validationError("Agent Ask destination Project was not found.", { project: parsed.project, remedy: "Use a configured Project reference or `project: unknown`." });
    return { ...parsed, project: project.slug };
  })();
  const fingerprint = agentAskFingerprint(input.request, normalized);
  const existing = db.prepare("SELECT fingerprint, proposal_json FROM agent_ask_proposals WHERE request_id = ?")
    .get(normalized.requestId) as { fingerprint: string; proposal_json: string } | undefined;
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw validationError("Agent Ask request id was already used with different content.", { requestId: normalized.requestId });
    return { proposal: JSON.parse(existing.proposal_json) as AgentAskProposal, replayed: true };
  }
  return db.transaction(() => {
    const capture = captureAskEnvelope(db, { requestId: normalized.requestId, originalText: input.request, ingressSource: "agent.ask" });
    const built = buildAgentAskEffects(normalized);
    const proposal: AgentAskProposal = {
      id: stableProposalId(fingerprint), captureId: capture.id, normalized, effects: built.effects,
      requiredDecisions: built.requiredDecisions, unchanged: [], conflicts: [], refused: [],
      managedDocumentTransition: { required: requiresManagedDocumentTransition(normalized.intent), status: "withheld_until_acceptance", authority: "checked_in_documents" },
      queueConsequence: "none_until_accepted", writes: { captureReceipt: true, proposalReceipt: true, projectChanges: false },
      nonActions: ["No Project record is created or changed by preview.", "Agent input grants no approval or execution authority."],
      fingerprint, createdAt: new Date().toISOString(), sourcePath: input.sourcePath ?? null
    };
    db.prepare(`INSERT INTO agent_ask_proposals (id, request_id, capture_id, fingerprint, format, intent_kind, project_ref, proposal_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(proposal.id, normalized.requestId, capture.id, fingerprint, normalized.format, normalized.intent, normalized.project, JSON.stringify(proposal), proposal.createdAt);
    return { proposal, replayed: false };
  })();
}
