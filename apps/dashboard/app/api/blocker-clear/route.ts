import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";
import { invalidateApprovalsCache } from "../../../lib/approvals-feed";
import { ArcadiaCliError, clearPinnedBlocker } from "../../../lib/arcadia-cli";
import { isOneClickBlockerKind } from "../../../../../src/production/blockerRemedies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The /todo one-click clear for a platform-raised stop (environment_wall, budget_exhausted). It runs exactly
 * `arcadia production reset-repair-budget <actionKey> --expect-kind <kind>`: pinned to the blocker the card showed,
 * a no-op when that blocker is already gone, refused (409) when the Action is held by a different one. The kind must
 * be a registry one-click kind; this route grants no authority and changes no policy.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin blocker-clear requests are refused." }, { status: 403 });
  }
  let body: { actionKey?: unknown; kind?: unknown };
  try {
    body = (await request.json()) as { actionKey?: unknown; kind?: unknown };
  } catch {
    return NextResponse.json({ error: "A valid JSON body is required." }, { status: 400 });
  }
  const actionKey = typeof body.actionKey === "string" ? body.actionKey.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  if (!/^[^/\s]+\/[^\s]+$/.test(actionKey) || !kind) {
    return NextResponse.json({ error: "actionKey (project/action) and kind are required." }, { status: 400 });
  }
  if (!isOneClickBlockerKind(kind)) {
    return NextResponse.json({ error: `${kind} has no one-click clear; answer it with the control its card names.` }, { status: 400 });
  }
  try {
    const response = await clearPinnedBlocker({ actionKey, kind });
    const receipt = response.data;
    return NextResponse.json({
      message: receipt.alreadyClear
        ? `${actionKey} had no ${kind} blocker; it was already clear.`
        : `Cleared the ${kind} stop on ${actionKey}; ${receipt.attemptsCleared} repair attempt(s) reset. The next worker tick re-admits it.`,
      receipt
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ArcadiaCliError ? error.details : null
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  } finally {
    // Even a refused clear may have been answered by the tick meanwhile; rebuild rather than serve the old list.
    invalidateApprovalsCache();
  }
}
