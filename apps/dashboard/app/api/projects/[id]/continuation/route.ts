import { NextResponse } from "next/server";
import { actionDocRef } from "../../../../../../../src/docs/types";
import { resolveReadyWorkspace } from "../../../../../../../src/cli/workspace";
import { withDatabase } from "../../../../../../../src/db/connection";
import { getWorkItemByDocRef } from "../../../../../../../src/db/repositories";
import {
  ArcadiaCliError,
  loadDashboardSnapshot,
  loadProjectContinuation,
  prepareDailyAdvantage
} from "../../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const continuation = await loadProjectContinuation(id);
    const snapshot = await loadDashboardSnapshot();
    const project = snapshot.data.snapshot.projects.find((candidate) => candidate.id === id) ?? null;
    if (!project) {
      return NextResponse.json({ error: "Project was not found.", details: { projectId: id } }, { status: 404 });
    }

    return NextResponse.json({
      project,
      continuation: continuation.data,
      reviewItems: snapshot.data.snapshot.requiresReviewItems.filter((item) => item.projectId === id)
    });
  } catch (error) {
    const details = error instanceof ArcadiaCliError ? error.details : null;
    const cause = details && typeof details === "object" && "cause" in details && typeof details.cause === "string"
      ? details.cause
      : null;
    return NextResponse.json(
      {
        error: cause ?? (error instanceof Error ? error.message : String(error)),
        details
      },
      { status: cause ? 409 : error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { actionId?: unknown };
    const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
    if (!actionId) {
      return NextResponse.json({ error: "Current Action id is required.", details: null }, { status: 400 });
    }

    const continuation = await loadProjectContinuation(id);
    const current = continuation.data;
    if (!current.context || current.context.action.id !== actionId) {
      return NextResponse.json(
        { error: "The project current Action changed. Refresh the project before getting to work.", details: { conflict: true } },
        { status: 409 }
      );
    }
    if (!current.dispatchable) {
      return NextResponse.json(
        {
          error: current.operatorQuestion ?? current.blockers[0]?.message ?? "This Action is not ready to dispatch.",
          details: { continuation: current }
        },
        { status: 409 }
      );
    }

    const { workspacePath } = resolveReadyWorkspace();
    const workItem = withDatabase(workspacePath, (db) =>
      getWorkItemByDocRef(db, actionDocRef(current.context?.activePlan ?? "", actionId))
    );
    if (!workItem) {
      return NextResponse.json(
        {
          error: "This Action is present in the repository documents but has not been synced into Arcadia yet.",
          details: { actionId, remedy: "Run arcadia docs sync --project <project> --apply, then refresh this Project." }
        },
        { status: 409 }
      );
    }

    const response = await prepareDailyAdvantage(workItem.id);
    const decision = response.data.planningDecision;
    if (!decision) {
      return NextResponse.json(
        { error: "This Action has no managed planning path yet, so Arcadia refused to start work.", details: { actionId } },
        { status: 409 }
      );
    }

    return NextResponse.json({
      message: response.data.reused
        ? `Planning Decision ${decision.slug ?? decision.id} is ready in Review.`
        : `Planning Decision ${decision.slug ?? decision.id} prepared. No Run was queued and Codex was not invoked.`,
      result: response.data,
      decisionId: decision.id,
      decisionSlug: decision.slug
    });
  } catch (error) {
    const details = error instanceof ArcadiaCliError ? error.details : null;
    const cause = details && typeof details === "object" && "cause" in details && typeof details.cause === "string"
      ? details.cause
      : null;
    return NextResponse.json(
      {
        error: cause ?? (error instanceof Error ? error.message : String(error)),
        details
      },
      { status: cause ? 409 : error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}
