import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateCardsFromSources, type CardSourceInput } from "../../../src/decisions/cardSources";
import type { DecisionCard } from "../../../src/decisions/card";
import { LIBRARY_PATH, GET as listOperatorScripts, POST as launchOperatorScript, SAFE_ID } from "../app/api/operator-script/route";
import { loadOpenDecisions } from "./arcadia-cli";
import type { CardTarget } from "./decision-cards";

/** A rendered card lives this long; the pins, not the clock, decide whether a press is still valid. */
const CARD_TTL_MS = 10 * 60 * 1000;

export interface LoadedCards {
  cards: DecisionCard[];
  targets: Map<string, CardTarget>;
  /** One line per source that produced no card; shown, never silently dropped. */
  unavailable: string[];
}

interface ListedScript {
  id: string;
  kind?: string;
  title: string;
  success?: { effect?: string };
  repeatable?: boolean;
  state?: { status?: string };
}

/**
 * Regenerate the current cards from current source state: open Decisions through the CLI read the dashboard already
 * uses, and the operator-script library through the existing listing. Pull-request cards are not built here (their
 * facts need `gh`; the merge verb is the batch-merge script's), so a PR card is never offered a button by this page.
 */
export async function loadCurrentCards(now: Date = new Date()): Promise<LoadedCards> {
  const sources: CardSourceInput[] = [];
  const targets = new Map<string, CardTarget>();
  const unavailable: string[] = [];
  const idsByCard = new Map<string, CardTarget>();

  try {
    const { data } = await loadOpenDecisions();
    for (const decision of data.decisions) {
      const factId = `${decision.projectSlug}-${decision.id}`;
      sources.push({
        kind: "decision",
        decision: {
          id: factId,
          status: decision.status,
          question: decision.question,
          options: decision.options.map((option) => ({ label: option.label, consequence: option.consequence, recommended: option.recommended })),
          updated: decision.updated
        }
      });
      idsByCard.set(`decision-${factId}`, {
        kind: "decision",
        projectSlug: decision.projectSlug,
        decisionId: decision.id,
        labels: decision.options.map((option) => option.label)
      });
    }
  } catch (error) {
    unavailable.push(`Open Decisions could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const response = await listOperatorScripts();
    const body = (await response.json()) as { scripts?: ListedScript[] };
    for (const script of body.scripts ?? []) {
      // A grant moves authority and has its own confirmations on the actions page; never a one-press card.
      if (script.kind === "grant" || !SAFE_ID.test(script.id)) continue;
      const status = script.state?.status;
      if (status === "running" || (status === "succeeded" && script.repeatable !== true)) continue;
      const descriptorBytes = await readFile(path.join(LIBRARY_PATH, `${script.id}.json`));
      const scriptBytes = await readFile(path.join(LIBRARY_PATH, `${script.id}.sh`));
      const descriptorSha256 = createHash("sha256").update(descriptorBytes).update("\0").update(scriptBytes).digest("hex");
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
      idsByCard.set(`script-${script.id}`, { kind: "script", scriptId: script.id });
    }
  } catch (error) {
    unavailable.push(`The operator-script library could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  const generation = generateCardsFromSources({ sources, now, expires: new Date(now.getTime() + CARD_TTL_MS).toISOString() });
  for (const generated of generation.cards) {
    const target = idsByCard.get(generated.card.id);
    if (target !== undefined) targets.set(generated.card.id, target);
  }
  for (const refusal of generation.refusals) {
    unavailable.push(`${refusal.sourceId ?? "a source"} produced no card (${refusal.code}): ${refusal.message}`);
  }
  return { cards: generation.cards.map((generated) => generated.card), targets, unavailable };
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
