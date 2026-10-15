import { NextResponse } from "next/server";
import { submitReadAloud } from "../../../lib/read-aloud";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Text is required." }, { status: 400 }); }
  if (!input || typeof input !== "object" || !("text" in input) || typeof input.text !== "string" || !input.text.trim() || input.text.length > 100_000) return NextResponse.json({ error: "Text must contain 1–100000 characters." }, { status: 400 });
  try { return NextResponse.json({ job: await submitReadAloud(input.text) }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
