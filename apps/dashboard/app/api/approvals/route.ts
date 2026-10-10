import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";
import {
  approveDecision,
  ArcadiaCliError,
  loadAgentAskEligibility,
  loadOpenDecisions,
  loadOperatorTodo,
  loadPendingAgentAsks,
  settlePendingAgentAsk
} from "../../../lib/arcadia-cli";
import { buildApprovals } from "../../../lib/approvals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The operator's one list, read fresh on every GET — a cheap, deterministic
 * read, no model call. `arcadia todo --json --all` supplies the list; the
 * Decision and Agent Ask loaders that predate it still supply each row's
 * options and settle controls, so those rows keep settling through their
 * existing canonical writer (`agent-ask settle --apply` or `decision
 * approve`) exactly as before. Review items and any other kind are read-only.
 * If the to-do call fails the old loaders stand alone with a visible note.
 */
export async function GET() {
  try {
    const [asks, decisions, todo] = await Promise.allSettled([loadPendingAgentAsks(), loadOpenDecisions(), loadOperatorTodo()]);
    const loaderFailure = [asks, decisions].find((result) => result.status === "rejected");
    if (loaderFailure && todo.status === "rejected") throw loaderFailure.reason;
    const pendingAsks = asks.status === "fulfilled" ? asks.value.data.pending : null;
    // Whether Accept would apply is read here, server-side, so the page never offers a button the data does not support.
    const eligibility = pendingAsks ? await loadAgentAskEligibility(pendingAsks).catch(() => undefined) : undefined;
    const list = buildApprovals({
      eligibility,
      asks: pendingAsks,
      decisions: decisions.status === "fulfilled" ? decisions.value.data.decisions : null,
      todo: todo.status === "fulfilled" ? { items: todo.value.data.items, unavailable: todo.value.data.unavailable ?? [] } : null,
      loadError: loaderFailure ? describeFailure(loaderFailure.reason) : undefined,
      todoError: todo.status === "rejected" ? describeFailure(todo.reason) : undefined
    });
    return NextResponse.json(list);
  } catch (error) {
    return errorResponse(error);
  }
}

function describeFailure(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
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
