import { NextResponse } from "next/server";
import { ArcadiaCliError, setOrientationEntryEffort } from "../../../../../lib/arcadia-cli";
import type { OrientationEffort } from "../../../../../lib/mission-control-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EFFORTS: OrientationEffort[] = ["quick", "short", "session", "project"];

interface EffortRequest {
  /** One of the four sizes, or null to clear the size back to un-sized. */
  effort?: unknown;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as EffortRequest;
    const raw = body.effort;
    if (raw !== null && !(typeof raw === "string" && EFFORTS.includes(raw as OrientationEffort))) {
      return NextResponse.json(
        { error: `effort must be null or one of: ${EFFORTS.join(", ")}.` },
        { status: 400 }
      );
    }

    const response = await setOrientationEntryEffort({
      entryId: decodeURIComponent(id),
      effort: raw as OrientationEffort | null
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
