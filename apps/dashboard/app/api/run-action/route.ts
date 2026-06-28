import { NextResponse } from "next/server";
import { ArcadiaCliError, requestRunRetry } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { id?: unknown; action?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id || body.action !== "retry") {
      return NextResponse.json(
        { error: "Run id and retry action are required.", details: null },
        { status: 400 }
      );
    }
    const response = await requestRunRetry(id);
    return NextResponse.json({
      message: `Retry Decision ${response.data.decision.slug} is ready for review.`,
      result: response.data,
      decisionId: response.data.decision.id
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
