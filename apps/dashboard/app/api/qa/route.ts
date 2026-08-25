import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  checkProofTarget,
  listQaCandidates,
  recordQaDecision,
  refreshQaProject
} from "../../../lib/arcadia-cli";

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
    const body = await request.json() as { action?: unknown; candidateId?: unknown; decision?: unknown; note?: unknown };
    const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    const action = typeof body.action === "string" ? body.action : "record";

    if (action === "check") {
      if (!candidateId) {
        return NextResponse.json({ error: "A configured QA Candidate id is required." }, { status: 400 });
      }
      return NextResponse.json((await checkProofTarget(candidateId)).data);
    }

    if (action === "refresh") {
      const candidate = await findCandidate(candidateId);
      if (candidate.environmentKind === "remote") {
        return NextResponse.json({ error: "Remote QA targets are refreshed by their deployment workflow; use Check to re-probe this target." }, { status: 400 });
      }
      if (!candidate.refreshable) {
        return NextResponse.json({ error: `${candidate.project} does not ship scripts/services.sh, so Arcadia cannot restart it from here.` }, { status: 400 });
      }
      if (candidate.environmentKind !== "local" && candidate.environmentKind !== "lan") {
        return NextResponse.json({ error: "Only local and LAN QA targets can be pulled and restarted from this page." }, { status: 400 });
      }
      return NextResponse.json((await refreshQaProject(candidate.project)).data);
    }

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

async function findCandidate(candidateId: string) {
  if (!candidateId) {
    throw new ArcadiaCliError("A configured QA Candidate id is required.", 400);
  }
  const response = await listQaCandidates();
  const candidate = response.data.candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new ArcadiaCliError("QA Candidate was not found in the configured targets.", 404, { candidateId });
  }
  return candidate;
}

function failure(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error), details: error instanceof ArcadiaCliError ? error.details : null },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
