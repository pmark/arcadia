import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateCardsFromSources, type CardSourceInput } from "../../../src/decisions/cardSources";
import type { DecisionCard } from "../../../src/decisions/card";
import { LIBRARY_PATH, GET as listOperatorScripts, POST as launchOperatorScript, SAFE_ID } from "../app/api/operator-script/route";
import { GET as readProductionControl } from "../app/api/production-control/route";
import { loadOpenDecisions } from "./arcadia-cli";
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
    for (const decision of data.decisions) {
      const key = decisionCardKey(decision.projectSlug, decision.id);
      const cardId = `decision-${key}`;
      const labels = decision.options.map((option) => option.label);
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
          options: decision.options.map((option) => ({ label: option.label, consequence: option.consequence, recommended: option.recommended })),
          updated: decision.updated
        }
      });
      claim(cardId, { kind: "decision", projectSlug: decision.projectSlug, decisionId: decision.id, labels, status: decision.status, updated: String(decision.updated) });
    }
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
      // Allowlist for one-press execution: not a grant, not running, not consumed, and no off-path confirmation
      // would be shown for it on /actions. Anything else still gets its card, but only a link to /actions.
      const confirmation = offPathConfirmation(next, script, scripts);
      const eligible = script.kind === undefined && confirmation === null;
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
        confirmation: eligible ? null : confirmation ?? "This is a grant; confirm and run it from the Actions page."
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
    refused.push({ id: refusal.sourceId ?? "source", reason: refusal.code, message: "This source produced no card." });
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
