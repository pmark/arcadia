import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  deactivateProduction,
  loadCapacityStatus,
  loadDispatchJournal,
  loadProductionStatus,
  loadScheduleSummary,
  previewProductionReactivation,
  reactivateProduction,
  resolveDashboardWorkspace
} from "../../../lib/arcadia-cli";
import { cachedStale } from "../../../lib/swr-cache";
import { isSameOriginRequest } from "../../../lib/originGuard";
import { readManagedRunWorker } from "../../../lib/system-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Part = "core" | "queue" | "alerts";

// Queue and capacity projections take seconds to compute; serve the last result
// immediately and refresh behind it.
const SLOW_TTL_MS = 15_000;

// Each part is a separate request so the panel can paint what is ready
// without waiting on the slowest CLI call.
export async function GET(request: Request) {
  try {
    const part = (new URL(request.url).searchParams.get("part") ?? "core") as Part;

    if (part === "queue") {
      const schedule = await cachedStale("production-control:queue", SLOW_TTL_MS, () => loadScheduleSummary()).catch(
        () => null
      );
      return NextResponse.json({ schedule: schedule?.data ?? null });
    }

    if (part === "alerts") {
      const [capacity, journal] = await Promise.all([
        cachedStale("production-control:capacity", SLOW_TTL_MS, () => loadCapacityStatus()).catch(() => null),
        cachedStale("production-control:journal", SLOW_TTL_MS, () => loadDispatchJournal(10)).catch(() => null)
      ]);
      const refusedProviders = (capacity?.data.observation.providers ?? []).filter((entry) => !entry.admitted);
      const blockedDispatches = (journal?.data.events ?? []).filter((event) => !event.dispatchable).slice(0, 5);
      return NextResponse.json({
        capacity: capacity?.data ?? null,
        alerts: {
          capacityRefusals: refusedProviders.map((entry) => ({
            providerId: entry.providerId,
            label: entry.receipt.providerLabel,
            reason: entry.reason
          })),
          blockedDispatches
        }
      });
    }

    const workspace = await resolveDashboardWorkspace();
    const [production, worker] = await Promise.all([loadProductionStatus(), readManagedRunWorker(workspace)]);
    return NextResponse.json({ production: production.data, worker });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ArcadiaCliError ? error.details : null
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}

interface ToggleRequest {
  action?: unknown;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin production toggle requests are refused.", details: { conflict: true } },
      { status: 403 }
    );
  }
  try {
    const body = (await request.json()) as ToggleRequest;
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "activate" && action !== "deactivate") {
      return NextResponse.json({ error: 'action must be "activate" or "deactivate".', details: null }, { status: 400 });
    }

    // The suffix keeps two toggles in the same millisecond from sharing an id, which would replay the first.
    const requestId = `dashboard-toggle-${Date.now()}-${randomUUID().slice(0, 8)}`;

    if (action === "deactivate") {
      await deactivateProduction({ requestId, reason: "Switched off from the Runs dashboard." });
      const status = await loadProductionStatus();
      return NextResponse.json({ production: status.data });
    }

    // On replays the configuration Off retained, bound to the revisions the
    // preview just showed. Drift (a moved queue, policy or configuration, a
    // delegation that needs a fresh grant) is a 409 naming the exact gate; the
    // saved scope is never rebuilt or narrowed here.
    const { data } = await previewProductionReactivation();
    const { preview } = data;
    if (!preview.ready || !preview.expected) {
      const first = preview.refusals[0];
      return NextResponse.json(
        {
          error: first ? `${first.reason} ${first.remedy}` : "The saved production configuration cannot be reactivated.",
          details: { conflict: true, code: first?.code ?? null, remedy: first?.remedy ?? null, refusals: preview.refusals }
        },
        { status: 409 }
      );
    }

    await reactivateProduction({ requestId, grantedBy: "dashboard-toggle", expected: preview.expected });
    const status = await loadProductionStatus();
    return NextResponse.json({ production: status.data });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ArcadiaCliError ? error.details : null
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}
