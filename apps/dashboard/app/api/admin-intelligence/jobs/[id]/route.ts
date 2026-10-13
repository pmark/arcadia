import { NextResponse } from "next/server";
import { getIntelligenceClient } from "../../../../../lib/intelligence";
import { safeIntelligenceJob } from "../../../../../lib/safe-intelligence-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const job = await getIntelligenceClient().getJob(id);
    return NextResponse.json({ job: safeIntelligenceJob(job) });
  } catch (error) {
    const status = error instanceof Error && /404/.test(error.message) ? 404 : 502;
    return NextResponse.json({ error: status === 404 ? `Job not found: ${id}` : "Could not load the Intelligence job." }, { status });
  }
}
