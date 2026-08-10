import { NextResponse } from "next/server";
import { ArcadiaCliError, listQaCandidates, recordQaDecision } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json((await listQaCandidates()).data);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { candidateId?: unknown; decision?: unknown; note?: unknown };
    const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    const decision = typeof body.decision === "string" ? body.decision : "";
    if (!candidateId || !["pass", "fail", "needs-follow-up"].includes(decision)) {
      return NextResponse.json({ error: "Candidate id and pass, fail, or needs-follow-up Decision are required." }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note : undefined;
    return NextResponse.json((await recordQaDecision({ candidateId, decision: decision as "pass" | "fail" | "needs-follow-up", note })).data);
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
