import { NextResponse } from "next/server";
import { loadCorePart, loadQueuePart } from "../../../lib/production-console-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only. `part=core` (default) is the fast, frequently polled part:
 * production state, worker heartbeat and Sessions. `part=queue` is the slower
 * queue and ready-set batch. Both serve a recently cached read; `fresh=1`
 * waits for a new one (after a state change or a manual Refresh).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const part = params.get("part") ?? "core";
  const fresh = params.get("fresh") === "1";
  if (part === "queue") return NextResponse.json(await loadQueuePart({ fresh }));
  if (part !== "core") return NextResponse.json({ error: 'part must be "core" or "queue".', details: null }, { status: 400 });
  return NextResponse.json(await loadCorePart({ fresh }));
}
