import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  activateProduction,
  deactivateProduction,
  loadCapacityStatus,
  loadDispatchJournal,
  loadProductionStatus,
  loadScheduleSummary,
  resolveDashboardWorkspace
} from "../../../lib/arcadia-cli";
import { readManagedRunWorker } from "../../../lib/system-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const workspace = await resolveDashboardWorkspace();
    const [production, capacity, schedule, journal, worker] = await Promise.all([
      loadProductionStatus(),
      loadCapacityStatus().catch(() => null),
      loadScheduleSummary().catch(() => null),
      loadDispatchJournal(10).catch(() => null),
      readManagedRunWorker(workspace)
    ]);

    const refusedProviders = (capacity?.data.observation.providers ?? []).filter((entry) => !entry.admitted);
    const blockedDispatches = (journal?.data.events ?? []).filter((event) => !event.dispatchable).slice(0, 5);

    return NextResponse.json({
      production: production.data,
      worker,
      capacity: capacity?.data ?? null,
      schedule: schedule?.data ?? null,
      alerts: {
        capacityRefusals: refusedProviders.map((entry) => ({
          providerId: entry.providerId,
          label: entry.receipt.providerLabel,
          reason: entry.reason
        })),
        blockedDispatches
      }
    });
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
  try {
    const body = (await request.json()) as ToggleRequest;
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "activate" && action !== "deactivate") {
      return NextResponse.json({ error: 'action must be "activate" or "deactivate".', details: null }, { status: 400 });
    }

    const requestId = `dashboard-toggle-${Date.now()}`;

    if (action === "deactivate") {
      await deactivateProduction({ requestId, reason: "Switched off from the Runs dashboard." });
      const status = await loadProductionStatus();
      return NextResponse.json({ production: status.data });
    }

    // Reactivating reuses the scope already on record — the toggle is a
    // switch, not a re-entry of every project/plan/provider flag.
    const current = await loadProductionStatus();
    const scope = current.data.read.policy?.scope;
    const revision = current.data.read.policy?.revision ?? 0;
    if (!scope || scope.projects.length === 0 || scope.providers.length === 0) {
      return NextResponse.json(
        {
          error: "No prior production scope is on record. Run `arcadia production preview` and `activate` once from the CLI to establish one.",
          details: null
        },
        { status: 409 }
      );
    }

    await activateProduction({ scope, requestId, grantedBy: "dashboard-toggle", expectRevision: revision });
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
