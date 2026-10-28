import { NextResponse } from "next/server";
import { ArcadiaCliError, loadGoContext } from "../../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const response = await loadGoContext(id);
    return NextResponse.json(response.data.projects[0]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error),
      details: error instanceof ArcadiaCliError ? error.details : null },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 });
  }
}
