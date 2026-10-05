import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** The fields of a script-written `runs/<timestamp-pid>/receipt.json` the next-action panel reads. */
export interface RunReceiptSummary {
  runDirectory: string;
  outcome: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** finishedAt (or startedAt) of the latest succeeded receipt for this id, from any run. */
  succeededAt: string | null;
}

const RUN_DIRECTORY = /^\d{8}T[0-9A-Za-z-]+$/;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;

/**
 * Latest receipt per action id, chosen exactly as the scripts choose it: the
 * last matching `runs/<timestamp-pid>/receipt.json` in name order. Read-only;
 * an unreadable or foreign receipt is skipped, never repaired.
 */
export async function loadLatestRunReceipts(library: string): Promise<Map<string, RunReceiptSummary>> {
  const latest = new Map<string, RunReceiptSummary>();
  let entries: string[];
  try {
    entries = (await readdir(path.join(library, "runs"))).filter((entry) => RUN_DIRECTORY.test(entry)).sort();
  } catch (error) {
    // Receipts only inform the next-action panel; an unreadable runs/ must never fail the listing.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Could not read operator run receipts; listing without them.", error);
    return latest;
  }
  const receipts = await Promise.all(entries.map(async (entry) => {
    try {
      return { entry, value: JSON.parse(await readFile(path.join(library, "runs", entry, "receipt.json"), "utf8")) as Record<string, unknown> };
    } catch {
      return null;
    }
  }));
  for (const receipt of receipts) {
    if (!receipt) continue;
    const id = text(receipt.value.id);
    const outcome = text(receipt.value.outcome);
    if (!id || !outcome) continue;
    const startedAt = text(receipt.value.startedAt);
    const finishedAt = text(receipt.value.finishedAt);
    const succeededAt = outcome === "succeeded" ? finishedAt ?? startedAt ?? receipt.entry : latest.get(id)?.succeededAt ?? null;
    latest.set(id, { runDirectory: `runs/${receipt.entry}`, outcome, startedAt, finishedAt, succeededAt });
  }
  return latest;
}
