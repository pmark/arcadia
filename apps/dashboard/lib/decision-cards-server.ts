import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateCardsFromSources, type CardSourceInput } from "../../../src/decisions/cardSources";
import type { DecisionCard } from "../../../src/decisions/card";
import type { DecisionOptionEffect } from "../../../src/docs/types";
import { LIBRARY_PATH, GET as listOperatorScripts, POST as launchOperatorScript, SAFE_ID } from "../app/api/operator-script/route";
import { GET as readProductionControl } from "../app/api/production-control/route";
import { loadOpenDecisions, type OpenDecisionItem } from "./arcadia-cli";
import { decisionOptionsDigest } from "../../../src/decisions/optionsDigest";
import { decisionCardKey, hasDuplicateOptionLabels, type CardTarget, type DecisionCardRefusalView } from "./decision-cards";
import { deriveNextOperatorAction, offPathConfirmation, productionObservation, type NextOperatorAction, type SequencedScript } from "./nextOperatorAction";

/** A rendered card lives this long; the pins, not the clock, decide whether a press is still valid. */
const CARD_TTL_MS = 10 * 60 * 1000;

export interface LoadedCards {
  cards: DecisionCard[];
  targets: Map<string, CardTarget>;
  /** Sources that produced no pressable card, with a fixed reason code; shown, never silently dropped. */
  refused: DecisionCardRefusalView[];
}

interface ListedScript extends SequencedScript {
  kind?: string;
  success?: { effect?: string };
  state: SequencedScript["state"] & { runId?: string };
}

/**
 * The digest a script card pins. It folds the descriptor and script bytes together with the script's current run
 * state (status, run id, start and finish), so a fingerprint captured before a run is stale after it, even for a
 * repeatable script whose bytes never change.
 */
async function scriptDigest(script: ListedScript): Promise<string> {
  const descriptorBytes = await readFile(path.join(LIBRARY_PATH, `${script.id}.json`));
  const scriptBytes = await readFile(path.join(LIBRARY_PATH, `${script.id}.sh`));
  const runState = JSON.stringify({
    status: script.state?.status ?? null,
    runId: script.state?.runId ?? null,
    startedAt: script.state?.startedAt ?? null,
    finishedAt: script.state?.finishedAt ?? null,
    lastRun: script.lastRunReceipt ?? null
  });
  return createHash("sha256").update(descriptorBytes).update("\0").update(scriptBytes).update("\0").update(runState).digest("hex");
}

async function listScripts(): Promise<ListedScript[]> {
  const response = await listOperatorScripts();
  if (!response.ok) throw new Error("operator-script listing unavailable");
  const body = (await response.json()) as { scripts?: ListedScript[] };
  return body.scripts ?? [];
}

/**
 * The same derivation /actions uses: the next operator action from the listing and, only when a published rule
 * needs it, the live production observation (unreadable is unknown, never Off).
 */
async function deriveNext(scripts: ListedScript[], now: number): Promise<NextOperatorAction> {
  const needsProduction = scripts.some((script) => script.nextAfter?.when_production === "inactive");
  let production = null;
  if (needsProduction) {
    try {
      const response = await readProductionControl(new Request("http://localhost/api/production-control?part=core"));
      production = productionObservation(response.ok, await response.json());
    } catch {
      production = null;
    }
  }
  return deriveNextOperatorAction(scripts, production, now);
}

/**
 * Turn open Decisions into card sources. The one place a Decision becomes a card, so the single-Decision read below
 * cannot pin anything different from what a press regenerates.
 */
function addDecisionSources(
  decisions: ReadonlyArray<OpenDecisionItem>,
  { sources, refused, claim }: { sources: CardSourceInput[]; refused: DecisionCardRefusalView[]; claim: (cardId: string, target: CardTarget) => void }
): void {
  for (const decision of decisions) {
    const key = decisionCardKey(decision.projectSlug, decision.id);
    const cardId = `decision-${key}`;
    const labels = decision.options.map((option) => option.label);
    const hasDefer = decision.options.some((option) => option.effect === "defer");
    const actionId = typeof decision.action === "string" && decision.action.trim() !== "" ? decision.action : null;
    const deferProject = decision.project ?? decision.projectSlug;
    if (hasDefer && actionId === null) {
      // The writer would refuse this on press; never offer a defer option that has no Action to park.
      refused.push({
        id: cardId,
        reason: "defer_without_action",
        message: `Decision ${decision.projectSlug}/${decision.id} has a defer option but names no action, so no card button is offered.`
      });
      continue;
    }
    if (hasDuplicateOptionLabels(labels)) {
      // The writer answers with the FIRST label equal after trim and case-fold; a repeat could record the wrong option.
      refused.push({
        id: cardId,
        reason: "duplicate_option_labels",
        message: `Decision ${decision.projectSlug}/${decision.id} has options whose labels match after case-folding, so no card button is offered. Answer it from its to-do row.`
      });
      continue;
    }
    sources.push({
      kind: "decision",
      decision: {
        id: key,
        status: decision.status,
        question: decision.question,
        // The effect is passed through unchanged: the card renders and pins it, and the generator refuses unknown ones.
        options: decision.options.map((option) => ({
          label: option.label,
          // A defer option applies its effect to the Decision's own `action` in its own `project`; show that target
          // in the consequence (which is pinned). The generator refuses over-long text rather than truncating.
          consequence: option.effect === "defer" ? `${option.consequence} Parks ${deferProject}/${actionId}. Refused if this is the current Action; answer that case from the CLI.` : option.consequence,
          recommended: option.recommended,
          effect: (option.effect ?? null) as DecisionOptionEffect | null
        })),
        updated: decision.updated
      }
    });
    claim(cardId, {
      kind: "decision",
      projectSlug: decision.projectSlug,
      decisionId: decision.id,
      labels,
      status: decision.status,
      updated: String(decision.updated),
      // The same function the writer uses, over the question and options exactly as they were read for this card.
      optionsDigest: decisionOptionsDigest(
        decision.question,
        decision.options.map((option) => ({ label: option.label, consequence: option.consequence, effect: option.effect ?? null })),
        { action: decision.action ?? null, project: decision.project ?? null }
      )
    });
  }
}

/** What the short view shows beside a card: the record's own fields, read together with the card. */
export interface DecisionCardMeta {
  id: string;
  question: string;
  gateQuestion: string | null;
  recommendation: string | null;
  recommendedLabels: string[];
  relativePath: string;
  updated: string;
}

export interface LoadedDecisionCard {
  cards: DecisionCard[];
  targets: Map<string, CardTarget>;
  refused: DecisionCardRefusalView[];
  /** Null when no open Decision has this id or slug in this Project. */
  decision: DecisionCardMeta | null;
}

/**
 * One Decision's card, without the operator-script listing and the production read that the full list pays for. A
 * read for display only: a press still goes through `loadCurrentCards` and its pins, so nothing here can loosen one.
 * Every open Decision in the Project goes through the same steps, so two that share an id still refuse each other.
 */
export async function loadCurrentDecisionCard(projectSlug: string, decisionId: string, now: Date = new Date()): Promise<LoadedDecisionCard> {
  const { data } = await loadOpenDecisions(projectSlug);
  const decisions = data.decisions.filter((decision) => decision.projectSlug === projectSlug);
  const found = decisions.find((decision) => decision.id === decisionId) ?? decisions.find((decision) => decision.slug === decisionId) ?? null;
  if (found === null) return { cards: [], targets: new Map(), refused: [], decision: null };

  const sources: CardSourceInput[] = [];
  const refused: DecisionCardRefusalView[] = [];
  const byCard = new Map<string, CardTarget>();
  const ambiguous = new Set<string>();
  addDecisionSources(decisions, {
    sources,
    refused,
    claim: (cardId, target) => {
      if (byCard.has(cardId) || ambiguous.has(cardId)) {
        ambiguous.add(cardId);
        byCard.delete(cardId);
        refused.push({ id: cardId, reason: "conflicting_card_id", message: "Two sources map to one card id, so neither is offered." });
        return;
      }
      byCard.set(cardId, target);
    }
  });
  const generation = generateCardsFromSources({ sources, now, expires: new Date(now.getTime() + CARD_TTL_MS).toISOString() });
  for (const refusal of generation.refusals) {
    refused.push({ id: refusal.sourceId ?? "source", reason: refusal.code, message: refusal.message });
  }

  const cardId = `decision-${decisionCardKey(found.projectSlug, found.id)}`;
  const targets = new Map<string, CardTarget>();
  const cards: DecisionCard[] = [];
  for (const generated of generation.cards) {
    const target = byCard.get(generated.card.id);
    if (generated.card.id !== cardId || target === undefined) continue;
    targets.set(generated.card.id, target);
    cards.push(generated.card);
  }
  return {
    cards,
    targets,
    refused: refused.filter((entry) => entry.id === cardId),
    decision: {
      id: found.id,
      question: found.question,
      gateQuestion: found.gateQuestion,
      recommendation: found.recommendation,
      recommendedLabels: found.options.filter((option) => option.recommended).map((option) => option.label),
      relativePath: found.relativePath,
      updated: String(found.updated)
    }
  };
}

/**
 * Regenerate the current cards from current source state: open Decisions through the CLI read the dashboard already
 * uses, and the operator-script library through the existing listing. Pull-request cards are not built here (their
 * facts need `gh`; the merge verb is the batch-merge script's), so a PR card is never offered a button by this page.
 * Every failure becomes a fixed reason code; raw error text is never returned.
 */
export async function loadCurrentCards(now: Date = new Date()): Promise<LoadedCards> {
  const sources: CardSourceInput[] = [];
  const refused: DecisionCardRefusalView[] = [];
  const byCard = new Map<string, CardTarget>();
  const ambiguous = new Set<string>();

  const claim = (cardId: string, target: CardTarget): void => {
    if (byCard.has(cardId) || ambiguous.has(cardId)) {
      ambiguous.add(cardId);
      byCard.delete(cardId);
      refused.push({ id: cardId, reason: "conflicting_card_id", message: "Two sources map to one card id, so neither is offered." });
      return;
    }
    byCard.set(cardId, target);
  };

  try {
    const { data } = await loadOpenDecisions();
    addDecisionSources(data.decisions, { sources, refused, claim });
  } catch {
    refused.push({ id: "decisions", reason: "decisions_unreadable", message: "Open Decisions could not be read, so no Decision cards are shown." });
  }

  try {
    const scripts = await listScripts();
    const next = await deriveNext(scripts, now.getTime());
    for (const script of scripts) {
      if (!SAFE_ID.test(script.id)) continue;
      const status = script.state?.status;
      if (status === "running" || (status === "succeeded" && script.repeatable !== true)) continue;
      // Allowlist for one-press execution: not a grant, not running, not consumed, AND it is exactly the derived
      // next operator action. When the next action is none or unknown, nothing is eligible (fail closed). Anything
      // else still gets its card, but only a link to /actions where the confirmation flow lives.
      const isNext = next.status === "next" && next.scriptId === script.id;
      const eligible = script.kind === undefined && isNext;
      const unknown = next.status === "none" && next.unknown === true;
      const confirmation = isNext ? null : offPathConfirmation(next, script, scripts);
      const descriptorSha256 = await scriptDigest(script);
      sources.push({
        kind: "operator-script",
        script: {
          descriptor: {
            schema: "arcadia-operator-script-v1",
            id: script.id,
            title: script.title,
            script: `${script.id}.sh`,
            success: { effect: script.success?.effect ?? "" }
          },
          descriptorSha256
        }
      });
      claim(`script-${script.id}`, {
        kind: "script",
        scriptId: script.id,
        eligible,
        confirmation: eligible
          ? null
          : confirmation ??
            (script.kind !== undefined
              ? "This is a grant; confirm and run it from the Actions page."
              : unknown
                ? "Your next operator action cannot be determined right now, so nothing is run from a card; use the Actions page."
                : "No operator action is currently derived as next, so nothing is run from a card; use the Actions page."),
        refusal: unknown ? "next_action_unknown" : "off_path_requires_confirmation"
      });
    }
  } catch {
    refused.push({ id: "scripts", reason: "scripts_unreadable", message: "The operator-script library could not be read, so no run cards are shown." });
  }

  const generation = generateCardsFromSources({ sources, now, expires: new Date(now.getTime() + CARD_TTL_MS).toISOString() });
  const targets = new Map<string, CardTarget>();
  const cards: DecisionCard[] = [];
  for (const generated of generation.cards) {
    const target = byCard.get(generated.card.id);
    if (target === undefined) continue;
    targets.set(generated.card.id, target);
    cards.push(generated.card);
  }
  for (const refusal of generation.refusals) {
    refused.push({ id: refusal.sourceId ?? "source", reason: refusal.code, message: refusal.message });
  }
  return { cards, targets, refused };
}

/**
 * Re-read and re-hash the script immediately before launching: its descriptor and script bytes and its run state
 * must still produce the digest the card pinned. This narrows, but cannot close, the window between this check and
 * the operator-script entry's own read of the descriptor; that entry still validates the descriptor and holds the
 * launch lock, which is what prevents a double start.
 */
export async function scriptStillMatches(scriptId: string, pinnedDigest: string): Promise<boolean> {
  try {
    const script = (await listScripts()).find((candidate) => candidate.id === scriptId);
    if (script === undefined) return false;
    return (await scriptDigest(script)) === pinnedDigest;
  } catch {
    return false;
  }
}

/** Start one library script through the existing operator-script entry (descriptor validation, claim lock, bounded runner). */
export async function startOperatorScript(scriptId: string): Promise<{ status: number; message: string }> {
  const response = await launchOperatorScript(
    new Request("http://localhost/api/operator-script", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: scriptId })
    })
  );
  const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
  return { status: response.status, message: body.message ?? body.error ?? `The operator-script entry answered ${response.status}.` };
}
