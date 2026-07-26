import { NextResponse } from "next/server";
import { ArcadiaCliError, continueClarification } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ClarifyActionRequest {
  workItemId?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ClarifyActionRequest;
    const workItemId = typeof body.workItemId === "string" ? body.workItemId.trim() : "";
    if (!workItemId) {
      return NextResponse.json({ error: "Action id is required.", details: null }, { status: 400 });
    }

    const response = await continueClarification(workItemId);
    const evaluation = response.data.evaluated[0];
    const message =
      evaluation?.verdict.verdict === "clarified"
        ? `Action clarified. Next Action: ${evaluation.verdict.nextAction}`
        : evaluation?.verdict.verdict === "question_open"
          ? "Arcadia has one focused follow-up question."
          : "The Action remains ready for clarification.";

    return NextResponse.json({ message, result: response.data });
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
