import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * What a pressed START card (scripts/start-run.sh) is doing, from the executor's own receipt.json. The executor claims the
 * dashboard's press record by writing its run id to `start-run.claimed` in the press directory, and rewrites
 * `<library>/runs/<card id>/<executor run id>/receipt.json` at every phase. Read-only; anything missing or foreign is null.
 */
export interface StartRunProgress {
  phase: string;
  phaseName: string;
  outcome: string;
  reason: string;
  /** One plain line for the operator, or null when this phase has none. */
  statusLine: string | null;
}

const EXECUTOR_RUN_ID = /^\d{8}T\d{6}Z-\d+$/;
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Issue #3189: the in-card quiet-host check, while it samples and when it refuses. */
export function startRunStatusLine(receipt: { phaseName?: unknown; outcome?: unknown; reason?: unknown }): string | null {
  const phaseName = text(receipt.phaseName);
  const outcome = text(receipt.outcome);
  if (phaseName === "quiet_host" && outcome === "in_progress") {
    return "Checking host: the card is watching the worker's heartbeat and the load for about 90 seconds before it uses anything up.";
  }
  if (outcome === "refused" && text(receipt.reason).startsWith("host not quiet")) {
    return "Host not quiet: nothing was used up. Press this same card again later, once the host is quieter.";
  }
  return null;
}

export async function loadStartRunProgress(library: string, scriptId: string, pressDirectory: string): Promise<StartRunProgress | null> {
  try {
    const executorRunId = (await readFile(path.join(pressDirectory, "start-run.claimed"), "utf8")).trim();
    if (!EXECUTOR_RUN_ID.test(executorRunId)) return null;
    const root = await realpath(library);
    const file = await realpath(path.join(root, "runs", scriptId, executorRunId, "receipt.json"));
    if (!file.startsWith(`${root}${path.sep}runs${path.sep}${scriptId}${path.sep}`)) return null;
    const receipt = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    if (receipt.schema !== "arcadia-start-run-receipt-v1" || receipt.id !== scriptId || receipt.runId !== executorRunId) return null;
    return { phase: text(receipt.phase), phaseName: text(receipt.phaseName), outcome: text(receipt.outcome), reason: text(receipt.reason), statusLine: startRunStatusLine(receipt) };
  } catch {
    return null;
  }
}
