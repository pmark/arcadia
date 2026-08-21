import { NextResponse } from "next/server";
import { ArcadiaCliError, setNorthStarGate } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { gateId, status } = (body ?? {}) as { gateId?: unknown; status?: unknown };
  if (typeof gateId !== "string" || gateId.trim().length === 0) {
    return NextResponse.json({ error: "gateId is required." }, { status: 400 });
  }
  if (status !== "done" && status !== "open") {
    return NextResponse.json({ error: "status must be \"done\" or \"open\"." }, { status: 400 });
  }

  try {
    const response = await setNorthStarGate({ gateId, status });
    return NextResponse.json(response.data);
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
