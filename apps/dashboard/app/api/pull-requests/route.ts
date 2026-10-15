import { NextResponse } from "next/server";
import { ArcadiaCliError, loadOutstandingPullRequests, findRepoRoot } from "../../../lib/arcadia-cli";
import { createInventoryPersistence, inventoryPersistenceScope } from "../../../lib/pull-request-inventory-persistence";
import { createPullRequestInventoryCache } from "../../../lib/pull-request-inventory-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const globalCache = globalThis as typeof globalThis & { arcadiaPrInventoryCaches?: Map<string, ReturnType<typeof createPullRequestInventoryCache>> };
const inventoryCaches = globalCache.arcadiaPrInventoryCaches ??= new Map();
async function inventoryCache() {
  const scope = await inventoryPersistenceScope(findRepoRoot(process.cwd()));
  let cache = inventoryCaches.get(scope.identity);
  if (!cache) {
    cache = createPullRequestInventoryCache({
      load: async () => (await loadOutstandingPullRequests({ workspace: scope.workspacePath, scopeIdentity: scope.identity })).data.snapshot,
      persistence: createInventoryPersistence(scope)
    });
    // Only the currently resolved workspace/checkout scope needs a live cache.
    inventoryCaches.clear();
    inventoryCaches.set(scope.identity, cache);
  }
  return cache;
}

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const cache = await inventoryCache();
    const response = new URL(request.url).searchParams.get("warm") === "1" ? await cache.warm() : await cache.read({ refresh });
    if (!response) return NextResponse.json({ warming: true, message: "PR routes warmed; inventory is refreshing with no saved snapshot yet." }, { status: 202, headers: { "cache-control": "no-store" } });
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

