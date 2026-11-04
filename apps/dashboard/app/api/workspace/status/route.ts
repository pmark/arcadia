import { NextResponse } from "next/server";
import { getApprovals } from "../../../../lib/approvals-feed";
import { loadCorePart } from "../../../../lib/production-console-server";
import { createWorkspaceStatus, type WorkspaceStatus } from "../../../../lib/workspace-status";
import type { NextStepsResponse } from "../../../../lib/next-steps-server";
import type { DashboardOutstandingPullRequests } from "../../../../lib/types";
import { GET as readNextSteps } from "../../next-steps/route";
import { GET as readPullRequests } from "../../pull-requests/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const READ_KEY = Symbol.for("arcadia.workspace.status");

// Anchored on the process, like the approvals cache: the bundler can load this module more than once.
const anchor = globalThis as typeof globalThis & { [READ_KEY]?: () => WorkspaceStatus };
const readStatus = (anchor[READ_KEY] ??= createWorkspaceStatus({
  approvals: async () => (await getApprovals()).approvals,
  nextSteps: async () => {
    const response = await readNextSteps();
    if (!response.ok) throw new Error("Next steps could not be read.");
    return (await response.json()) as NextStepsResponse;
  },
  pullRequests: async () => {
    const response = await readPullRequests(new Request("http://localhost/api/pull-requests"));
    if (!response.ok) throw new Error("The pull request inventory could not be read.");
    const body = (await response.json()) as { snapshot?: DashboardOutstandingPullRequests; checkedAt?: string };
    return body.snapshot && body.checkedAt ? { snapshot: body.snapshot, checkedAt: Date.parse(body.checkedAt) } : null;
  },
  production: () => loadCorePart()
}));

/** Read-only and quick: it reports what's known now, and refreshes slow sources behind the request. */
export function GET() {
  return NextResponse.json(readStatus(), { headers: { "cache-control": "no-store" } });
}
