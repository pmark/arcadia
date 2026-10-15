import { NextResponse } from "next/server";
import { ArcadiaCliError, runAsk } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AskRequest {
  request?: unknown;
  requestId?: unknown;
}

export async function POST(request: Request) {
  try {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return NextResponse.json({ error: "Ask request must contain valid JSON.", details: null }, { status: 400 });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Ask request must be a JSON object.", details: null }, { status: 400 });
    }
    const body = parsed as AskRequest;
    const text = typeof body.request === "string" ? body.request.trim() : "";

    if (!text) {
      return NextResponse.json({ error: "Ask request is required.", details: null }, { status: 400 });
    }

    const response = await runAsk({
      request: text,
      requestId: typeof body.requestId === "string" ? body.requestId : undefined
    });
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
