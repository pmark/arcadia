import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  loadWorkQueue,
  makeWorkQueueActionNext,
  mutateWorkQueue
} from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await loadWorkQueue();
    return NextResponse.json(response.data);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body.", details: null }, { status: 400 });
  }

  const action = text(body.action);
  const requestId = text(body.requestId);
  const revision = Number(body.revision);
  const apply = body.apply === true;
  if (!requestId || !Number.isInteger(revision) || revision < 0) {
    return NextResponse.json({ error: "requestId and a non-negative integer revision are required.", details: null }, { status: 400 });
  }

  try {
    if (action === "move") {
      const move = text(body.move);
      const placement = text(body.placement);
      const anchor = text(body.anchor);
      if (!move || !["top", "before", "after"].includes(placement) || (placement !== "top" && !anchor)) {
        return NextResponse.json({ error: "A move target and one valid placement are required.", details: null }, { status: 400 });
      }
      const response = await mutateWorkQueue({
        action, requestId, revision, apply, move,
        placement: placement as "top" | "before" | "after",
        anchor: anchor || undefined
      });
      return NextResponse.json(response.data);
    }
    if (action === "arrange") {
      const order = Array.isArray(body.order) ? body.order.filter((key): key is string => typeof key === "string" && key.length > 0) : [];
      if (order.length === 0) return NextResponse.json({ error: "A complete non-empty order is required.", details: null }, { status: 400 });
      const response = await mutateWorkQueue({ action, requestId, revision, apply, order });
      return NextResponse.json(response.data);
    }
    if (action === "undo") {
      const receiptId = text(body.receiptId);
      if (!receiptId) return NextResponse.json({ error: "An applied receipt id is required.", details: null }, { status: 400 });
      const response = await mutateWorkQueue({ action, requestId, revision, apply, receiptId });
      return NextResponse.json(response.data);
    }
    if (action === "make-next") {
      const actionKey = text(body.actionKey);
      if (!actionKey) return NextResponse.json({ error: "An Action key is required.", details: null }, { status: 400 });
      const response = await makeWorkQueueActionNext({
        actionKey, requestId, revision, apply,
        previewFingerprint: text(body.previewFingerprint) || undefined
      });
      return NextResponse.json(response.data);
    }
    return NextResponse.json({ error: "Action must be move, arrange, undo, or make-next.", details: null }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function failure(error: unknown) {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : String(error),
      details: error instanceof ArcadiaCliError ? error.details : null
    },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
