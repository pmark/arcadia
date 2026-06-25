import { NextResponse } from "next/server";
import { ArcadiaCliError, listAskFeedback, recordAskFeedback } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FeedbackRequest {
  askRequestId?: unknown;
  decision?: unknown;
  note?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FeedbackRequest;
    const askRequestId = typeof body.askRequestId === "string" ? body.askRequestId.trim() : "";
    const decision = body.decision === "up" || body.decision === "down" ? body.decision : null;
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;

    if (!askRequestId) {
      return NextResponse.json({ error: "Ask request id is required.", details: null }, { status: 400 });
    }
    if (!decision) {
      return NextResponse.json({ error: "Decision must be 'up' or 'down'.", details: null }, { status: 400 });
    }

    const response = await recordAskFeedback({ askRequestId, decision, note });
    return NextResponse.json({
      message: response.data.result.summary,
      result: response.data
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

export async function GET() {
  try {
    const response = await listAskFeedback(50);
    return NextResponse.json({ result: response.data });
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
