import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { workKindFor } from "../classify.js";
import { UNKNOWN_ACTOR, inWindow, normalizeTime, timelineEvent, type TimelineEvent } from "../schema.js";
import type { Collector, CollectorContext, TimelineRepository } from "./context.js";

/**
 * Operator-script run receipts written by the `/runs` runner under
 * `artifacts/generated/operator-scripts/runs/<run id>/receipt.json` in a
 * repository's main checkout. Only the receipt's identifying fields are read.
 */

export const OPERATOR_RUNS_DIR = path.join("artifacts", "generated", "operator-scripts", "runs");

interface Receipt {
  schema?: unknown;
  id?: unknown;
  runId?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  outcome?: unknown;
  stage?: unknown;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function collectOperatorScripts(repository: TimelineRepository, context: CollectorContext): TimelineEvent[] {
  const runs = path.join(repository.path, OPERATOR_RUNS_DIR);
  if (!existsSync(runs)) return [];
  const events: TimelineEvent[] = [];
  const entries = readdirSync(runs).sort().reverse().slice(0, context.maxPerSource);
  for (const entry of entries) {
    const file = path.join(runs, entry, "receipt.json");
    if (!existsSync(file)) continue;
    let receipt: Receipt;
    try {
      receipt = JSON.parse(readFileSync(file, "utf8")) as Receipt;
    } catch {
      continue;
    }
    const fileTime = statSync(file).mtime;
    const recorded = normalizeTime(str(receipt.finishedAt) ?? str(receipt.startedAt));
    const time = recorded ?? fileTime.toISOString();
    if (!inWindow(time, context.window)) continue;
    const id = str(receipt.id) ?? entry;
    const outcome = str(receipt.outcome) ?? "unknown outcome";
    const stage = str(receipt.stage);
    const event = timelineEvent({
      id: `operator-scripts:${repository.projectSlug}:${str(receipt.runId) ?? entry}`,
      time,
      clock: recorded ? "receipt-file" : "file-mtime",
      source: "operator-scripts",
      kind: "operator-script.run",
      workKind: workKindFor("operator-script.run"),
      summary: `Operator script ${id}: ${outcome}${stage && stage !== "complete" ? ` at ${stage}` : ""}`,
      subjects: { project: repository.projectSlug, repository: repository.path },
      actor: { ...UNKNOWN_ACTOR, tool: "operator", confidence: "medium" },
      attention: outcome !== "succeeded" && outcome !== "unknown outcome",
      evidence: [{ kind: "receipt", value: path.relative(repository.path, file) }],
      provenance: {
        event: `${str(receipt.schema) ?? "receipt"} ${recorded ? "finishedAt/startedAt" : "file modification time"}`,
        actor: "the /runs runner executes a script only when the operator presses its button"
      },
      dedupeKeys: [`operator-run:${id}`]
    });
    if (event) events.push(event);
  }
  return events;
}

export function operatorScriptCollectors(repositories: TimelineRepository[]): Collector[] {
  return repositories.map((repository) => ({
    source: "operator-scripts" as const,
    describe: `operator-script receipts ${repository.projectSlug}`,
    collect: (context: CollectorContext) => collectOperatorScripts(repository, context)
  }));
}
