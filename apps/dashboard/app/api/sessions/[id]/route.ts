import { NextResponse } from "next/server";
import { readSessionObservation } from "../../../../lib/session-observation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return NextResponse.json({ error: "Invalid Session id." }, { status: 400 });
  try {
    const observation = await readSessionObservation({ id });
    return NextResponse.json(observation, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
