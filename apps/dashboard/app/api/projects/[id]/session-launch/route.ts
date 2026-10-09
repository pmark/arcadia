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

/** What a confirmed Launch authorizes (Decision 0096, option 1): shown before the operator confirms, never a merge. */
const OPERATOR_LAUNCH_CONSEQUENCE =
  "Confirming also authorizes Arcadia, once and for this one Action, to validate, commit and push the Session's branch when it exits and, only if the work is accepted as complete, open a DRAFT pull request. It never merges, integrates or turns production on. The authorization expires after 24 hours or at the Session's first exit.";

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
    return NextResponse.json({ ...preview.data, operatorLaunchConsequence: OPERATOR_LAUNCH_CONSEQUENCE });
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
    let body: { requestId?: unknown; previewFingerprint?: unknown; confirmOperatorLaunch?: unknown };
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be an object");
      body = parsed as { requestId?: unknown; previewFingerprint?: unknown; confirmOperatorLaunch?: unknown };
    } catch {
      return NextResponse.json({ error: "A valid JSON request body is required.", details: null }, { status: 400 });
    }
    const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
    const previewFingerprint = typeof body.previewFingerprint === "string" ? body.previewFingerprint.trim() : "";
    if (!requestId || !previewFingerprint) {
      return NextResponse.json({ error: "requestId and previewFingerprint are required.", details: null }, { status: 400 });
    }

    // Decision 0096: `confirmOperatorLaunch: true` is the operator's explicit
    // confirmation, after seeing that this Launch also authorizes the host to
    // validate, commit, push and open a DRAFT PR for this one Action when the
    // Session exits (never a merge). It is a browser-UI action: only a browser
    // sends `Sec-Fetch-Site: same-origin`, and `isSameOriginRequest` alone also
    // passes a header-less local request (an agent's curl, in a Session or a
    // non-interactive shell). Such a request is refused outright: nothing is
    // launched and nothing is minted.
    const confirmed = body.confirmOperatorLaunch === true;
    if (confirmed && request.headers.get("sec-fetch-site") !== "same-origin") {
      return NextResponse.json(
        {
          error: "An operator launch authorization can only be confirmed from the dashboard in a browser; this request did not come from one, so nothing was launched.",
          details: { conflict: true, code: "operator_launch_not_from_browser" }
        },
        { status: 403 }
      );
    }

    const continuation = await loadProjectContinuation(id);
    const launch = await launchGuardedSession(continuation.data.repoRoot, requestId, previewFingerprint, {
      operatorLaunch: confirmed
    });

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
