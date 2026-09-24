import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";
import {
  approveDecision,
  ArcadiaCliError,
  loadOpenDecisions,
  loadPendingAgentAsks,
  settlePendingAgentAsk,
  type AgentAskPendingItem,
  type OpenDecisionItem
} from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type ApprovalOption = { label: string; consequence: string; recommended: boolean };

/**
 * One terminal operator-only approval blocking managed production: either an
 * Agent Ask proposal awaiting settlement, or an open Decision awaiting an
 * answer. Both are read fresh on every GET — a cheap, deterministic read, no
 * model call — and both settle through their existing canonical writer:
 * `agent-ask settle --apply` or `decision approve`.
 */
export interface Approval {
  kind: "agent_ask" | "decision";
  id: string;
  project: string;
  title: string;
  detail: string | null;
  gateQuestion: string | null;
  options: ApprovalOption[];
  evidence: string[];
  /** What settling this costs to run — both settlement paths are deterministic CLI writes, never a model call. */
  cost: string;
  createdAt: string;
}

const NO_MODEL_COST = "Deterministic — a CLI write, no model call.";

function toAgentAskApproval(item: AgentAskPendingItem): Approval {
  return {
    kind: "agent_ask",
    id: item.proposalId,
    project: item.project,
    title: item.desiredResult,
    detail: item.rationale,
    gateQuestion: item.gateQuestion,
    options: item.options,
    evidence: item.effects,
    cost: NO_MODEL_COST,
    createdAt: item.createdAt
  };
}

function toDecisionApproval(item: OpenDecisionItem): Approval {
  return {
    kind: "decision",
    id: item.id,
    project: item.projectSlug,
    title: item.question,
    detail: item.recommendation,
    gateQuestion: item.gateQuestion,
    options: item.options,
    evidence: [],
    cost: NO_MODEL_COST,
    createdAt: item.updated
  };
}

/** Every pending approval, most recently raised first, with anything still awaiting an operator decision ranked above one already recommended but merely unactioned — there is no such split today, so this is simply newest-first. */
export async function GET() {
  try {
    const [asks, decisions] = await Promise.all([loadPendingAgentAsks(), loadOpenDecisions()]);
    const approvals: Approval[] = [
      ...asks.data.pending.map(toAgentAskApproval),
      ...decisions.data.decisions.map(toDecisionApproval)
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ approvals });
  } catch (error) {
    return errorResponse(error);
  }
}

interface ApprovalActionRequest {
  kind?: unknown;
  id?: unknown;
  project?: unknown;
  /** The option label chosen; defaults to the recommended option when omitted. */
  option?: unknown;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin approval requests are refused." }, { status: 403 });
  }
  let body: ApprovalActionRequest;
  try {
    body = (await request.json()) as ApprovalActionRequest;
  } catch {
    return NextResponse.json({ error: "A valid JSON body is required." }, { status: 400 });
  }
  const kind = body.kind === "agent_ask" || body.kind === "decision" ? body.kind : null;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const project = typeof body.project === "string" ? body.project.trim() : "";
  const option = typeof body.option === "string" ? body.option.trim() : undefined;
  if (!kind || !id || !project) {
    return NextResponse.json({ error: "kind, id, and project are required." }, { status: 400 });
  }

  try {
    if (kind === "agent_ask") {
      const response = await settlePendingAgentAsk({
        proposalId: id,
        requestId: `dashboard-approve-${id}-${Date.now()}`,
        disposition: "accepted"
      });
      return NextResponse.json({
        message: `Applied. ${response.data.receipt.effects.join(" ")}`.trim(),
        receipt: response.data.receipt
      });
    }

    // kind === "decision": approve with the chosen option's label, defaulting
    // to whichever option `decision list` marked recommended.
    const decisions = await loadOpenDecisions();
    const decision = decisions.data.decisions.find((candidate) => candidate.id === id && candidate.projectSlug === project);
    if (!decision) {
      return NextResponse.json({ error: "This Decision is no longer open, or its state changed. Refresh and try again." }, { status: 409 });
    }
    const chosen = option
      ? decision.options.find((candidate) => candidate.label.toLowerCase() === option.toLowerCase())
      : decision.options.find((candidate) => candidate.recommended) ?? decision.options[0];
    if (!chosen) {
      return NextResponse.json({ error: "This Decision offers no option to answer with." }, { status: 400 });
    }
    const response = await approveDecision({ projectSlug: project, decisionId: id, answer: chosen.label });
    return NextResponse.json({ message: `Decision ${id} answered: ${chosen.label}.`, result: response.data });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : String(error),
      details: error instanceof ArcadiaCliError ? error.details : null
    },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
