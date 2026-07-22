import { NextResponse } from "next/server";
import { ArcadiaCliError, logTime } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LogTimeRequest {
  minutes?: unknown;
  description?: unknown;
  at?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LogTimeRequest;
    const minutes = Number(body.minutes);
    const description = typeof body.description === "string" ? body.description.trim() : "";

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return NextResponse.json({ error: "Minutes must be a positive number." }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ error: "Say what you did — that is what gets read back." }, { status: 400 });
    }

    const response = await logTime({
      minutes,
      description,
      at: typeof body.at === "string" && body.at.trim() ? body.at.trim() : undefined
    });
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
