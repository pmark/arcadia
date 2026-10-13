import { NextResponse } from "next/server";
import { ArcadiaCliError, loadOutstandingPullRequests } from "../../../lib/arcadia-cli";
import { createPullRequestInventoryCache } from "../../../lib/pull-request-inventory-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inventoryCache = createPullRequestInventoryCache({
  load: async () => (await loadOutstandingPullRequests()).data.snapshot
});

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const response = await inventoryCache.read({ refresh });
    return NextResponse.json(response, {
      headers: {
        "cache-control": "no-store",
        "x-arcadia-inventory-cache": response.stale ? "stale" : "fresh"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ArcadiaCliError ? error.details : null,
        retryAfterSeconds: 5
      },
      {
        status: error instanceof ArcadiaCliError ? error.statusCode : 503,
        headers: { "cache-control": "no-store", "retry-after": "5" }
      }
    );
  }
}

