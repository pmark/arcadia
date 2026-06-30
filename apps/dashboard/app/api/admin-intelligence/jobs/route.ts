import { NextResponse } from "next/server";
import { AdminSubmissionError, buildAdminIntelligenceRequest, getIntelligenceClient } from "../../../../lib/intelligence";
import type { AdminSubmission } from "../../../../lib/intelligence-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let submission: AdminSubmission;
  try {
    submission = (await request.json()) as AdminSubmission;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  let intelligenceRequest;
  try {
    intelligenceRequest = buildAdminIntelligenceRequest(submission);
  } catch (error) {
    if (error instanceof AdminSubmissionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const client = getIntelligenceClient();
    const result = await client.submit(intelligenceRequest);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Arcadia Intelligence submission failed." },
      { status: 502 },
    );
  }
}
