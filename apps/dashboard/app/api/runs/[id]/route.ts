import { NextResponse } from "next/server";
import { ArcadiaCliError, getRunDetails } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Run id is required.", details: null }, { status: 400 });
    }

    const response = await getRunDetails(id);
    return NextResponse.json({ ...response.data, workspace: response.workspace });
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
