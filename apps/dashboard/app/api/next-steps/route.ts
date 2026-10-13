import { NextResponse } from "next/server";
import { DEFAULT_CARD_REPO } from "../../../../../src/decisions/cardSources";
import { loadWorkQueue } from "../../../lib/arcadia-cli";
import { loadCurrentCards } from "../../../lib/decision-cards-server";
import { applyInventoryAge, ghRunner, headKey, loadNextSteps, type NextStepsResponse } from "../../../lib/next-steps-server";
import type { DashboardOutstandingPullRequests } from "../../../lib/types";
import { GET as readPullRequests } from "../pull-requests/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The /todo "Next steps" list. GET only: it reads the cached pull-request inventory, the work queue and the
 * current cards, orders every operator touch by what unblocks the queue, and writes nothing. The merge click it
 * names is a plain link to the pull request on GitHub; no route here merges, answers or runs anything.
 *
 * Caching: a computed response is reused for CACHE_MS. A cache hit re-applies the inventory-age rule to the
 * combined age (age at read plus time in this cache), so "production is moving" is never served from a list that
 * has since lagged.
 *
 * Heads: the heads read by the previous computation are kept per repository and PR number and passed back as
 * `pinnedHeads`, so a head that moved between two polls is shown as head_moved. That is a ONE-POLL signal: the next
 * computation pins the new head and the step becomes takeable again if it is otherwise ready. The GitHub merge page
 * (and `--match-head-commit` in the batch script) is the guard that actually refuses a moved head.
 */
const CACHE_MS = 30_000;
let cached: { at: number; value: NextStepsResponse } | null = null;
let inFlight: Promise<NextStepsResponse> | null = null;
const previousHeads = new Map<string, string>();

function pinsFor(repo: string): Record<number, string> | null {
  const out: Record<number, string> = {};
  let any = false;
  for (const [key, sha] of previousHeads) {
    const prefix = `${repo.toLowerCase()}#`;
    if (key.startsWith(prefix)) {
      out[Number(key.slice(prefix.length))] = sha;
      any = true;
    }
  }
  return any ? out : null;
}

function load(): Promise<NextStepsResponse> {
  return loadNextSteps(
    {
      async readInventory() {
        const response = await readPullRequests(new Request("http://localhost/api/pull-requests"));
        if (!response.ok) throw new Error("pull-request inventory unavailable");
        const body = (await response.json()) as {
          snapshot: DashboardOutstandingPullRequests;
          stale?: boolean;
          checkedAt?: string;
          refreshError?: string | null;
          incomplete?: boolean;
        };
        return {
          pullRequests: body.snapshot.pullRequests,
          stale: body.stale === true,
          checkedAt: typeof body.checkedAt === "string" ? body.checkedAt : null,
          refreshError: typeof body.refreshError === "string" ? body.refreshError : null,
          incomplete: body.incomplete === true || (body.snapshot.errors?.length ?? 0) > 0
        };
      },
      async readQueue() {
        return (await loadWorkQueue()).data;
      },
      async readCards() {
        const { cards, targets } = await loadCurrentCards();
        return { cards, targets };
      },
      runGh: ghRunner()
    },
    { pinnedHeads: pinsFor(DEFAULT_CARD_REPO) }
  );
}

const json = (value: NextStepsResponse) => NextResponse.json(value, { headers: { "cache-control": "no-store" } });

export async function GET() {
  const now = Date.now();
  if (cached !== null && now - cached.at < CACHE_MS) {
    return json(applyInventoryAge(cached.value, new Date(now)));
  }
  inFlight ??= load()
    .then((value) => {
      cached = { at: Date.now(), value };
      previousHeads.clear();
      for (const [number, sha] of Object.entries(value.heads)) previousHeads.set(headKey(value.repo, Number(number)), sha);
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  try {
    return json(await inFlight);
  } catch {
    return NextResponse.json({ error: "Next steps could not be read.", retryAfterSeconds: 5 }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
  }
}
