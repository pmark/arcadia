import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    version: process.env.ARCADIA_VERSION?.trim() || "0.1.0",
  });
}
