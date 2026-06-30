import { NextResponse } from "next/server";
import { loadIntelligenceCapabilities } from "../../../../lib/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const capabilities = await loadIntelligenceCapabilities();
  return NextResponse.json(capabilities);
}
