import { NextResponse } from "next/server";
import { ArcadiaCliError, changeRecurringSchedule, loadRecurringSchedules } from "../../../lib/arcadia-cli";
import { isSameOriginRequest } from "../../../lib/originGuard";
import type { ClockTiming } from "../../../lib/clock-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json((await loadRecurringSchedules()).data); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Cross-origin schedule changes are refused." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 }); }
  const { action, id, expected, timing } = body;
  if (!["enable", "pause", "edit"].includes(String(action)) || typeof id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(id) || typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) {
    return NextResponse.json({ error: "A valid action, schedule id and current fingerprint are required." }, { status: 400 });
  }
  if (Object.keys(body).some((key) => !["action", "id", "expected", "timing"].includes(key))) return NextResponse.json({ error: "Unknown schedule change field." }, { status: 400 });
  if (action === "edit" && (!timing || typeof timing !== "object" || Array.isArray(timing))) return NextResponse.json({ error: "Timing is required." }, { status: 400 });
  try {
    await changeRecurringSchedule({ action: action as "enable" | "pause" | "edit", id, expected, timing: timing as ClockTiming | undefined });
    return NextResponse.json((await loadRecurringSchedules()).data);
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error), details: error instanceof ArcadiaCliError ? error.details : null }, { status: error instanceof ArcadiaCliError ? error.statusCode : 500 });
}
