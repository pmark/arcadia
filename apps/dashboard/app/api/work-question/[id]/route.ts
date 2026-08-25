import { NextResponse } from "next/server";
import { ArcadiaCliError, continueClarification, loadWorkQuestion, resolveWorkQuestion } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json((await loadWorkQuestion(id)).data);
  } catch (error) {
    return failure(error);
  }
}

/**
 * Answer and continue in one request.
 *
 * `/review` does this as two client-side calls (resolve, then a best-effort
 * continue) because a review item is guaranteed to exist there already. This
 * route also has to cover the case a review item was never opened — that gap
 * is exactly what sent the operator down this path in the first place — so
 * `resolveWorkQuestion` self-heals it before answering, and the continuation
 * attempt is folded in here rather than left for the page to chain.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { answer?: unknown };
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    if (!answer) {
      return NextResponse.json({ error: "An answer is required." }, { status: 400 });
    }

    const resolved = await resolveWorkQuestion(id, answer);

    if (resolved.data.workItem.clarification_status !== "unclarified") {
      // Approving marked it done or something else entirely; nothing left to
      // continue automatically.
      return NextResponse.json({
        message: "Answer recorded.",
        reviewItem: resolved.data.reviewItem,
        clarification: null
      });
    }

    try {
      const continued = await continueClarification(id);
      const evaluation = continued.data.evaluated[0];
      const message =
        evaluation?.verdict.verdict === "clarified"
          ? `Answer recorded. Arcadia clarified the Action — next: ${evaluation.verdict.nextAction}`
          : evaluation?.verdict.verdict === "question_open"
            ? "Answer recorded. Arcadia has one more focused question before this can proceed."
            : "Answer recorded. The Action is ready for clarification.";
      return NextResponse.json({
        message,
        reviewItem: resolved.data.reviewItem,
        clarification: evaluation?.verdict ?? null
      });
    } catch (continueError) {
      return NextResponse.json({
        message:
          "Answer recorded, but automatic clarification is unavailable right now. The Action is ready to continue.",
        reviewItem: resolved.data.reviewItem,
        clarification: null,
        clarifyError: continueError instanceof Error ? continueError.message : String(continueError)
      });
    }
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error), details: error instanceof ArcadiaCliError ? error.details : null },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
