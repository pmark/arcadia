import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  loadDashboardSnapshot,
  prepareDailyAdvantage
} from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { actionId?: unknown };
    const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
    if (!actionId) {
      return NextResponse.json({ error: "Daily Advantage Action id is required.", details: null }, { status: 400 });
    }

    const snapshot = await loadDashboardSnapshot();
    const selected = snapshot.data.snapshot.dailyAdvantage;
    if (!selected || selected.actionId !== actionId) {
      return NextResponse.json(
        {
          error: "The Daily Advantage changed. Refresh Today before preparing it.",
          details: { conflict: true, selectedActionId: selected?.actionId ?? null }
        },
        { status: 409 }
      );
    }

    const response = await prepareDailyAdvantage(actionId);
    const decision = response.data.planningDecision;
    if (!decision) {
      return NextResponse.json(
        {
          error: "The selected Action did not produce a managed planning Decision.",
          details: { conflict: true, actionId }
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      message: response.data.reused
        ? `Planning Decision ${decision.slug ?? decision.id} is ready in Review.`
        : `Planning Decision ${decision.slug ?? decision.id} prepared. No Run was queued and Codex was not invoked.`,
      result: response.data,
      decisionId: decision.id,
      decisionSlug: decision.slug
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ArcadiaCliError ? error.details : null
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}
