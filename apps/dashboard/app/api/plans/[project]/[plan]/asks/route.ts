import { NextResponse } from "next/server";
import { ArcadiaCliError, previewAgentAsk } from "../../../../../../lib/arcadia-cli";
import { isSameOriginRequest } from "../../../../../../lib/originGuard";
import { cliMessage, loadPlanAsks, PlanNotFound, resolvePlanTarget } from "../../../../../../lib/plans-server";
import { effectLine, planActionConsequence, type PlanAskKind, type PlanAskRequest, type PlanAsksResponse } from "../../../../../../lib/plan-picker-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ project: string; plan: string }> };

const KINDS: readonly PlanAskKind[] = ["annotate", "request-change"];
const REQUEST_ID = /^workspace-(annotate|request-change)-[a-z0-9][a-z0-9-]{0,80}$/;
const MAX_TEXT = 4000;

function failure(error: unknown, details: unknown) {
  if (error instanceof PlanNotFound) return NextResponse.json({ error: error.message, details }, { status: 404 });
  // A refused Ask (validation) is the caller's to fix; checked by shape in case the route bundles its own error class.
  const status = error instanceof ArcadiaCliError ? error.statusCode
    : error instanceof Error && (error as { code?: string }).code === "VALIDATION_ERROR" ? 400 : 500;
  return NextResponse.json({ error: cliMessage(error), details }, { status });
}

/** Read-only: every Ask whose Project and target are this Plan, newest first. */
export async function GET(_request: Request, context: Context) {
  const { project, plan } = await context.params;
  try {
    const target = await resolvePlanTarget(project, plan);
    const body: PlanAsksResponse = { project: target.project, plan: target.plan, asks: await loadPlanAsks(target.project, target.plan) };
    return NextResponse.json(body);
  } catch (error) {
    return failure(error, { project, plan });
  }
}

/**
 * Annotate or Request change. `check` composes the Agent Ask and derives its effects without recording anything;
 * `submit` records the same Ask through `agent-ask preview`. Nothing here settles an Ask: the operator does.
 */
export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin Plan Ask requests are refused.", details: null }, { status: 403 });
  }
  const { project, plan } = await context.params;
  let body: Partial<PlanAskRequest>;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed;
  } catch {
    return NextResponse.json({ error: "The request must be a JSON object.", details: null }, { status: 400 });
  }
  const { mode, kind, text, requestId } = body;
  if (mode !== "check" && mode !== "submit") return NextResponse.json({ error: "mode must be check or submit.", details: null }, { status: 400 });
  if (!kind || !KINDS.includes(kind)) return NextResponse.json({ error: "Only Annotate and Request change compose an Ask today.", details: { kind } }, { status: 400 });
  if (typeof text !== "string" || !text.trim()) return NextResponse.json({ error: kind === "annotate" ? "Write the note first." : "Say what should change first.", details: null }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: `Keep it under ${MAX_TEXT} characters.`, details: null }, { status: 400 });
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId) || !requestId.startsWith(`workspace-${kind}-`)) {
    return NextResponse.json({ error: "The request id is not one this page made.", details: { requestId } }, { status: 400 });
  }
  try {
    const target = await resolvePlanTarget(project, plan);
    const { composePlanAsk } = await import("../../../../../../../../src/plans/planAsks");
    const composed = composePlanAsk({ kind, project: target.project, plan: target.plan, text, requestId });
    const consequence = planActionConsequence(kind, target.plan);
    if (mode === "check") {
      return NextResponse.json({ mode, consequence, ask: composed.ask, effects: composed.effects.map(effectLine), requiredDecisions: composed.requiredDecisions });
    }
    const response = await previewAgentAsk(composed.ask);
    const proposal = response.data.proposal;
    return NextResponse.json({ mode, consequence, proposalId: proposal.id, requestId: proposal.normalized.requestId, replayed: response.data.replayed, effects: proposal.effects.map(effectLine) });
  } catch (error) {
    return failure(error, { project, plan });
  }
}
