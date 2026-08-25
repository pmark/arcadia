import { NextResponse } from "next/server";
import { ArcadiaCliError, loadPathBrief } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json((await loadPathBrief()).data);
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
