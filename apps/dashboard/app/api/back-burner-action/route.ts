import { NextResponse } from "next/server";
import { ArcadiaCliError, runBackBurnerAction } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BackBurnerAction = "promote" | "archive";

interface BackBurnerActionRequest {
  id?: unknown;
  action?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BackBurnerActionRequest;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim() as BackBurnerAction : "";

    if (!id) {
      return NextResponse.json({ error: "Back Burner item id is required.", details: null }, { status: 400 });
    }

    if (action === "promote" || action === "archive") {
      const response = await runBackBurnerAction({ id, action });
      return NextResponse.json({
        message: `Back Burner ${response.data.result.status}. ${response.data.result.summary}`,
        result: response.data
      });
    }

    return NextResponse.json(
      { error: "Back Burner action must be promote or archive.", details: { action } },
      { status: 400 }
    );
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
