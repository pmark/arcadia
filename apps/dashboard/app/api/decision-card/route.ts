import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";
import { invalidateApprovalsCache } from "../../../lib/approvals-feed";
import { ArcadiaCliError, approveDecision } from "../../../lib/arcadia-cli";
import { loadCurrentCards, startOperatorScript } from "../../../lib/decision-cards-server";
import {
  CARD_PRESS_LIMITS,
  evaluatePress,
  executableOptions,
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
 * one verb through its existing writer (`answer`: `decision approve`; `run`: the operator-script entry). It grants no
 * authority, accepts no free text and writes nothing else.
 */

// A second press of the same card while the first is still executing is refused, not queued.
const inFlight = new Set<string>();

function refusal(r: CardPressRefusal): NextResponse {
  return NextResponse.json({ error: r.message, reason: r.reason }, { status: r.status });
}

function refuseWith(status: number, reason: CardPressRefusalReason, message: string): NextResponse {
  return refusal({ ok: false, status, reason, message });
}

export async function GET() {
  try {
    const loaded = await loadCurrentCards();
    return NextResponse.json({ cards: toCardViews(loaded.cards, loaded.targets), unavailable: loaded.unavailable });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), reason: "source_unavailable" }, { status: 500 });
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
  if (Number.isFinite(declared) && declared > CARD_PRESS_LIMITS.body) {
    return NextResponse.json({ error: "The request body is too large.", reason: "body_too_large" }, { status: 413 });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return refuseWith(400, "malformed_body", "The request body could not be read.");
  }
  if (text.length > CARD_PRESS_LIMITS.body) {
    return NextResponse.json({ error: "The request body is too large.", reason: "body_too_large" }, { status: 413 });
  }
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
    } catch (error) {
      return refuseWith(503, "source_unavailable", `Current card state could not be read, so nothing was written: ${error instanceof Error ? error.message : String(error)}`);
    }
    const verdict = evaluatePress(loaded.cards, { cardId, fingerprint }, new Date());
    if (!verdict.ok) return refusal(verdict);
    const { card, optionId } = verdict;
    const target = loaded.targets.get(card.id);
    if (!executableOptions(card, target).includes(optionId)) {
      const reason = (card.verb === "run" ? "run_not_executable_here" : card.verb === "merge" ? "merge_not_executable_here" : card.verb === "veto" ? "veto_not_executable_here" : "option_not_executable_here") satisfies CardPressRefusalReason;
      return refuseWith(422, card.verb === "run" && optionId !== "run" ? "option_not_executable_here" : reason, notExecutableMessage(card));
    }
    if (card.verb === "answer" && target?.kind === "decision") {
      const index = card.options.findIndex((option) => option.id === optionId);
      const answer = target.labels[index];
      if (answer === undefined) return refuseWith(409, "option_not_offered", "The option no longer maps to a Decision answer.");
      try {
        const response = await approveDecision({ projectSlug: target.projectSlug, decisionId: target.decisionId, answer });
        return NextResponse.json({ ok: true, cardId: card.id, verb: "answer", optionId, message: `Answered ${card.id}: ${answer}.`, receipt: response.data });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : String(error), reason: "write_refused", details: error instanceof ArcadiaCliError ? error.details : null },
          { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
        );
      }
    }
    if (card.verb === "run" && target?.kind === "script") {
      const result = await startOperatorScript(target.scriptId);
      if (result.status >= 200 && result.status < 300) {
        return NextResponse.json({ ok: true, cardId: card.id, verb: "run", optionId, message: result.message });
      }
      return NextResponse.json({ error: result.message, reason: "write_refused" }, { status: result.status });
    }
    return refuseWith(422, "option_not_executable_here", notExecutableMessage(card));
  } finally {
    inFlight.delete(cardId);
    // An answered Decision or a started script changes the to-do list; rebuild rather than serve the old one.
    invalidateApprovalsCache();
  }
}
