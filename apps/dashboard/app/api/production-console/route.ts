import { NextResponse } from "next/server";
import { loadCorePart, loadQueuePart } from "../../../lib/production-console-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only. `part=core` (default) is the fast, frequently polled part:
 * production state, worker heartbeat and Sessions. `part=queue` is the slower
 * queue and ready-set batch.
 */
export async function GET(request: Request) {
  const part = new URL(request.url).searchParams.get("part") ?? "core";
  if (part === "queue") return NextResponse.json(await loadQueuePart());
  if (part !== "core") return NextResponse.json({ error: 'part must be "core" or "queue".', details: null }, { status: 400 });
  return NextResponse.json(await loadCorePart());
}
