import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  resolveReviewReply,
  reviewApproveWithExecute,
  runReviewAction
} from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReviewAction = "approve" | "reject" | "defer" | "resolve";

interface ReviewActionRequest {
  id?: unknown;
  action?: unknown;
  reply?: unknown;
  execute?: unknown;
  executor?: unknown;
  trigger?: unknown;
  /** Set by the Needs you board, whose defer control always collects a trigger; other quick-action surfaces don't send it and keep their untriggered defer. */
  requireTrigger?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReviewActionRequest;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim() as ReviewAction : "";
    const execute = body.execute === true;
    const executor = typeof body.executor === "string" ? body.executor.trim() : undefined;
    const trigger = typeof body.trigger === "string" ? body.trigger.trim() : "";
    const requireTrigger = body.requireTrigger === true;

    if (!id) {
      return NextResponse.json({ error: "Requires Review Decision id is required.", details: null }, { status: 400 });
    }

    if (action === "defer" && requireTrigger && !trigger) {
      return NextResponse.json(
        { error: "A deferral requires a named trigger condition before it is accepted.", details: null },
        { status: 400 }
      );
    }

    if (action === "approve" && execute) {
      const response = await reviewApproveWithExecute({ id, executor });
      const runId = response.data.run?.id ?? null;
      return NextResponse.json({
        message: `Decision ${response.data.result.status}. ${response.data.result.summary}`,
        result: response.data,
        runId
      });
    }

    if (action === "approve" || action === "reject" || action === "defer") {
      const response = await runReviewAction({ id, action, trigger: action === "defer" ? trigger : undefined });
      return NextResponse.json({
        message: `Decision ${response.data.result.status}. ${response.data.result.summary}`,
        result: response.data
      });
    }

    if (action === "resolve") {
      const reply = typeof body.reply === "string" ? body.reply.trim() : "";
      if (!reply) {
        return NextResponse.json({ error: "Review reply is required.", details: null }, { status: 400 });
      }

      const response = await resolveReviewReply({ id, reply });
      return NextResponse.json({
        message: response.data.confirmation,
        result: response.data
      });
    }

    return NextResponse.json(
      { error: "Review action must be approve, reject, defer, or resolve.", details: { action } },
      { status: 400 }
    );
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
