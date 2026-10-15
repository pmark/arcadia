import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";
import { approveDecision, ArcadiaCliError, loadOpenDecisions, settlePendingAgentAsk } from "../../../lib/arcadia-cli";
import { getApprovals, invalidateApprovalsCache } from "../../../lib/approvals-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getApprovals());
  } catch (error) {
    return errorResponse(error);
  }
}

interface ApprovalActionRequest {
  kind?: unknown;
  id?: unknown;
  project?: unknown;
  /** Required for kind "decision": the option label to answer with; defaults to the recommended option when omitted. */
  option?: unknown;
  /** Required for kind "agent_ask": the terminal disposition to settle with. An Agent Ask's own `options` (when it has any) describe something other than accept/reject and never drive this. */
  disposition?: unknown;
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
  const disposition = body.disposition === "accepted" || body.disposition === "rejected" ? body.disposition : undefined;
  if (!kind || !id || !project) {
    return NextResponse.json({ error: "kind, id, and project are required." }, { status: 400 });
  }

  try {
    if (kind === "agent_ask") {
      if (option) {
        return NextResponse.json({ error: "An Agent Ask settles by disposition (accepted/rejected), not by option." }, { status: 400 });
      }
      if (!disposition) {
        return NextResponse.json({ error: "disposition must be \"accepted\" or \"rejected\"." }, { status: 400 });
      }
      const response = await settlePendingAgentAsk({
        proposalId: id,
        requestId: `dashboard-approve-${id}-${Date.now()}`,
        disposition
      });
      return NextResponse.json({
        message: disposition === "accepted" ? `Applied. ${response.data.receipt.effects.join(" ")}`.trim() : "Rejected.",
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
  } finally {
    // Even a failed write may have changed state; the next poll must rebuild rather than serve the old list.
    invalidateApprovalsCache();
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
