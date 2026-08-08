import { NextResponse } from "next/server";
import { ArcadiaCliError, recordQaSignOff } from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERDICTS = ["pass", "fail", "follow-up"] as const;
type Verdict = (typeof VERDICTS)[number];

interface QaSignOffRequest {
  targetId?: unknown;
  verdict?: unknown;
  revision?: unknown;
  note?: unknown;
}

/**
 * Records one operator QA verdict. This is the only mutating QA route, and it
 * mutates exactly one thing: the judgement. It cannot merge, deploy, promote a
 * Candidate to Stable, or mark a release delivered — the CLI command behind it
 * has no such capability to expose.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QaSignOffRequest;
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    const verdict = typeof body.verdict === "string" ? body.verdict.trim() : "";
    const revision = typeof body.revision === "string" && body.revision.trim() ? body.revision.trim() : null;
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

    if (!targetId) {
      return NextResponse.json({ error: "Proof target id is required.", details: null }, { status: 400 });
    }
    if (!(VERDICTS as readonly string[]).includes(verdict)) {
      return NextResponse.json(
        { error: `Verdict must be one of: ${VERDICTS.join(", ")}.`, details: { verdict } },
        { status: 400 }
      );
    }

    const response = await recordQaSignOff({ targetId, verdict: verdict as Verdict, revision, note });
    return NextResponse.json({
      message: `Recorded QA ${verdict}. No merge, deployment, or release was performed.`,
      reviewItemId: response.data.reviewItemId
    });
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
