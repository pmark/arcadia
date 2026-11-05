import { NextResponse } from "next/server";
import { ArcadiaCliError, loadGoContext } from "../../../../../lib/arcadia-cli";
import { goResolutionIdentity } from "../../../../../lib/go-continue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const response = await loadGoContext(id);
    const observation = response.data.projects[0];
    const resolutionId = observation?.resolution ? goResolutionIdentity(id, observation.resolution) : null;
    // The Workspace renders no alerts from here, and they were 340 KB of a 345 KB answer. The identity doesn't include them.
    const resolution = observation?.resolution ? { ...observation.resolution, operatorAlerts: [] } : observation?.resolution;
    return NextResponse.json({ ...observation, resolution, resolutionId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error),
      details: error instanceof ArcadiaCliError ? error.details : null },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 });
  }
}
