import { NextResponse } from "next/server";
import { loadWorkQueue } from "../../../lib/arcadia-cli";
import { loadCurrentCards } from "../../../lib/decision-cards-server";
import { ghRunner, loadNextSteps, type NextStepsResponse } from "../../../lib/next-steps-server";
import type { DashboardOutstandingPullRequests } from "../../../lib/types";
import { GET as readPullRequests } from "../pull-requests/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The /todo "Next steps" list. GET only: it reads the cached pull-request inventory, the work queue and the
 * current cards, orders every operator touch by what unblocks the queue, and writes nothing. The merge click it
 * names is a plain link to the pull request on GitHub; no route here merges, answers or runs anything.
 */
const CACHE_MS = 30_000;
let cached: { at: number; value: NextStepsResponse } | null = null;
let inFlight: Promise<NextStepsResponse> | null = null;

function load(): Promise<NextStepsResponse> {
  return loadNextSteps({
    async readInventory() {
      const response = await readPullRequests(new Request("http://localhost/api/pull-requests"));
      if (!response.ok) throw new Error("pull-request inventory unavailable");
      const body = (await response.json()) as { snapshot: DashboardOutstandingPullRequests; stale?: boolean };
      return { pullRequests: body.snapshot.pullRequests, stale: body.stale === true };
    },
    async readQueue() {
      return (await loadWorkQueue()).data;
    },
    async readCards() {
      const { cards, targets } = await loadCurrentCards();
      return { cards, targets };
    },
    runGh: ghRunner()
  });
}

export async function GET() {
  const now = Date.now();
  if (cached !== null && now - cached.at < CACHE_MS) {
    return NextResponse.json(cached.value, { headers: { "cache-control": "no-store" } });
  }
  inFlight ??= load()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  try {
    return NextResponse.json(await inFlight, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Next steps could not be read.", retryAfterSeconds: 5 }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
  }
}
