import { NextResponse } from "next/server";
import { ArcadiaCliError, checkProofTarget, listProofTargets } from "../../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json((await listProofTargets(id)).data);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await context.params;
    const body = (await request.json()) as { targetId?: unknown };
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) {
      return NextResponse.json({ error: "A configured proof target id is required." }, { status: 400 });
    }
    return NextResponse.json((await checkProofTarget(targetId)).data);
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error), details: error instanceof ArcadiaCliError ? error.details : null },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
