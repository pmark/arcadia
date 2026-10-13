import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";
import { invalidateApprovalsCache } from "../../../lib/approvals-feed";
import { ArcadiaCliError, approveDecision } from "../../../lib/arcadia-cli";
import { loadCurrentCards, scriptStillMatches, startOperatorScript } from "../../../lib/decision-cards-server";
import {
  CARD_PRESS_LIMITS,
  evaluatePress,
  executableOptions,
  hasDuplicateOptionLabels,
  notExecutableMessage,
  parsePressBody,
  toCardViews,
  type CardPressRefusal,
  type CardPressRefusalReason
} from "../../../lib/decision-cards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Decision cards on /todo and /actions. GET regenerates the current cards from current source state and returns them
 * with one pinned fingerprint per pressable option. POST takes ONLY `{cardId, fingerprint}`: it regenerates the card
 * again server side, refuses with a named reason when the pin no longer matches, and otherwise performs the card's
 * one verb through its existing writer (`answer`: `decision approve` with status/updated preconditions; `run`: the
 * operator-script entry). It grants no authority, accepts no free text and writes nothing else.
 */

// A second press of the same card (any option) while the first is still executing is refused, not queued. This set is
// per process and only closes the in-process race; cross-process and cross-tab safety comes from the writer's
// precondition (answer) and the operator-script entry's launch lock (run), never from this set.
const inFlight = new Set<string>();

function refusal(r: CardPressRefusal): NextResponse {
  return NextResponse.json({ error: r.message, reason: r.reason }, { status: r.status });
}

function refuseWith(status: number, reason: CardPressRefusalReason, message: string): NextResponse {
  return refusal({ ok: false, status, reason, message });
}

function tooLarge(): NextResponse {
  return NextResponse.json({ error: "The request body is too large.", reason: "body_too_large" }, { status: 413 });
}

/** Read at most `limit` bytes; the stream is cancelled the moment it exceeds the cap. Null means over the cap. */
async function readBounded(request: Request, limit: number): Promise<string | null> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin decision-card requests are refused.", reason: "cross_origin" }, { status: 403 });
  }
  try {
    const loaded = await loadCurrentCards();
    return NextResponse.json({ cards: toCardViews(loaded.cards, loaded.targets), refused: loaded.refused });
  } catch {
    return NextResponse.json({ error: "Decision cards are unavailable.", reason: "cards_unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin decision-card requests are refused.", reason: "cross_origin" }, { status: 403 });
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "The request must be application/json.", reason: "bad_content_type" }, { status: 415 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > CARD_PRESS_LIMITS.body) return tooLarge();
  let text: string | null;
  try {
    text = await readBounded(request, CARD_PRESS_LIMITS.body);
  } catch {
    return refuseWith(400, "malformed_body", "The request body could not be read.");
  }
  if (text === null) return tooLarge();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuseWith(400, "malformed_body", "A valid JSON body is required.");
  }
  const parsed = parsePressBody(raw);
  if (!parsed.ok) return refusal(parsed);
  const { cardId, fingerprint } = parsed.body;

  if (inFlight.has(cardId)) {
    return refuseWith(409, "already_in_progress", "That card is already being executed; nothing further was written.");
  }
  inFlight.add(cardId);
  try {
    let loaded;
    try {
      loaded = await loadCurrentCards();
    } catch {
      return refuseWith(503, "source_unavailable", "Current card state could not be read, so nothing was written.");
    }
    const verdict = evaluatePress(loaded.cards, { cardId, fingerprint }, new Date());
    if (!verdict.ok) {
      const refusedSource = loaded.refused.find((entry) => entry.id === cardId);
      if (verdict.reason === "card_not_open" && refusedSource !== undefined) {
        return refuseWith(409, refusedSource.reason as CardPressRefusalReason, refusedSource.message);
      }
      return refusal(verdict);
    }
    const { card, optionId } = verdict;
    const target = loaded.targets.get(card.id);
    // Re-checked against the card regenerated just now, not against anything the browser held.
    if (target?.kind === "decision" && hasDuplicateOptionLabels(target.labels)) {
      return refuseWith(409, "duplicate_option_labels", notExecutableMessage(card, target));
    }
    if (target?.kind === "script" && !target.eligible && card.verb === "run") {
      return refuseWith(409, "off_path_requires_confirmation", notExecutableMessage(card, target));
    }
    if (!executableOptions(card, target).includes(optionId)) {
      const reason: CardPressRefusalReason =
        card.verb === "run" && optionId === "run" ? "run_not_executable_here"
        : card.verb === "merge" ? "merge_not_executable_here"
        : card.verb === "veto" ? "veto_not_executable_here"
        : "option_not_executable_here";
      return refuseWith(422, reason, notExecutableMessage(card, target));
    }
    if (card.verb === "answer" && target?.kind === "decision") {
      const index = card.options.findIndex((option) => option.id === optionId);
      const answer = target.labels[index];
      if (answer === undefined) return refuseWith(409, "option_not_offered", "The option no longer maps to a Decision answer.");
      try {
        const response = await approveDecision({
          projectSlug: target.projectSlug,
          decisionId: target.decisionId,
          answer,
          // The writer re-checks these against the file on disk: answered or edited since the card was read.
          expectStatus: target.status,
          expectUpdated: target.updated
        });
        return NextResponse.json({ ok: true, cardId: card.id, verb: "answer", optionId, message: `Answered ${card.id}: ${answer}.`, receipt: response.data });
      } catch (error) {
        const precondition =
          error instanceof ArcadiaCliError &&
          (/^DECISION_PRECONDITION_FAILED\b/.test(error.message) ||
            (typeof error.details === "object" && error.details !== null && (error.details as { reason?: unknown }).reason === "decision_precondition_failed"));
        if (precondition) {
          return refuseWith(409, "decision_precondition_failed", "The Decision was answered or edited after you were shown it. Nothing was written; reload and read it again.");
        }
        return NextResponse.json(
          { error: error instanceof Error ? error.message : String(error), reason: "write_refused", details: error instanceof ArcadiaCliError ? error.details : null },
          { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
        );
      }
    }
    if (card.verb === "run" && target?.kind === "script") {
      const pinned = card.pins.previewFingerprint;
      if (pinned === undefined || !(await scriptStillMatches(target.scriptId, pinned))) {
        return refuseWith(409, "descriptor_changed", "The script or its run state changed after you were shown it. Nothing was started; reload and read it again.");
      }
      const result = await startOperatorScript(target.scriptId);
      if (result.status >= 200 && result.status < 300) {
        return NextResponse.json({ ok: true, cardId: card.id, verb: "run", optionId, message: result.message });
      }
      return NextResponse.json({ error: result.message, reason: "write_refused" }, { status: result.status });
    }
    return refuseWith(422, "option_not_executable_here", notExecutableMessage(card, target));
  } finally {
    inFlight.delete(cardId);
    // An answered Decision or a started script changes the to-do list; rebuild rather than serve the old one.
    invalidateApprovalsCache();
  }
}
