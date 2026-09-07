import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  launchGuardedSession,
  loadProjectContinuation,
  previewGuardedSessionLaunch
} from "../../../../../lib/arcadia-cli";
import { isSameOriginRequest } from "../../../../../lib/originGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts no process — returns the fingerprint an operator launch request must present. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const requestId = new URL(request.url).searchParams.get("requestId")?.trim();
    if (!requestId) {
      return NextResponse.json({ error: "requestId is required.", details: null }, { status: 400 });
    }
    const continuation = await loadProjectContinuation(id);
    const preview = await previewGuardedSessionLaunch(continuation.data.repoRoot, requestId);
    return NextResponse.json(preview.data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // No identity layer exists on this deployment (docs/AGENT_ORIENTATION.md);
  // this is the operator-action request guard for the local/tailnet
  // deployment — it refuses a cross-site browser request, which is the only
  // kind of "unauthorized" this guard can meaningfully name. See
  // apps/dashboard/lib/originGuard.ts.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin Session launch requests are refused.", details: { conflict: true } },
      { status: 403 }
    );
  }

  try {
    const { id } = await context.params;
    const body = (await request.json()) as { requestId?: unknown; previewFingerprint?: unknown };
    const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
    const previewFingerprint = typeof body.previewFingerprint === "string" ? body.previewFingerprint.trim() : "";
    if (!requestId || !previewFingerprint) {
      return NextResponse.json({ error: "requestId and previewFingerprint are required.", details: null }, { status: 400 });
    }

    const continuation = await loadProjectContinuation(id);
    const launch = await launchGuardedSession(continuation.data.repoRoot, requestId, previewFingerprint);

    return NextResponse.json({
      message: launch.data.reused
        ? `Reused the already-durable Session ${launch.data.session.id}.`
        : `Session ${launch.data.session.id} launched.`,
      result: launch.data
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const details = error instanceof ArcadiaCliError ? error.details : null;
  const conflict = Boolean(details && typeof details === "object" && "conflict" in details && (details as { conflict?: unknown }).conflict === true);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error), details },
    { status: conflict ? 409 : error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
