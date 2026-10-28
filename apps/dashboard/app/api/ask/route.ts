import { NextResponse } from "next/server";
import { ArcadiaCliError, runAsk, captureOperatorDirection } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AskRequest {
  request?: unknown;
  requestId?: unknown;
  projectId?: unknown;
  directionTarget?: unknown;
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
    if (body.directionTarget !== undefined) {
      if (typeof body.requestId !== "string" || !body.requestId.trim()) return NextResponse.json({ error: "A direction requires its original request ID.", details: null }, { status: 400 });
      const response = await captureOperatorDirection({ request: body.request as string, requestId: body.requestId, directionTarget: body.directionTarget });
      return NextResponse.json({ message: `Direction ${response.data.direction.state}.`, direction: response.data.direction });
    }

    if (body.projectId !== undefined && (typeof body.projectId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(body.projectId))) {
      return NextResponse.json({ error: "Project ID must be a non-empty identifier.", details: null }, { status: 400 });
    }

    const response = await runAsk({
      request: text,
      projectId: body.projectId,
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
