import { NextResponse } from "next/server";
import { getIntelligenceClient } from "../../../../../lib/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const job = await getIntelligenceClient().getJob(id);
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load job.";
    const status = /404/.test(message) ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
