import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlanAmendmentResult } from "../../../src/operatorActions/planAmendment.js";
import type { PinnedAskSettlementResult } from "../../../src/operatorActions/pinnedAskSettlement.js";

/** The shared runners that keep a durable per-action receipt under `runs/receipts/`. */
const RECEIPT_SCHEMAS = new Set(["arcadia-plan-amendment-receipt-v1", "arcadia-agent-ask-settlement-receipt-v1"]);

/** The dashboard projects a runner-owned receipt; it never reinterprets settlement. */
export async function loadOperatorScriptReceipt(library: string, id: string): Promise<PlanAmendmentResult | PinnedAskSettlementResult | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid operator action id.");
  try {
    const value = JSON.parse(await readFile(path.join(library, "runs/receipts", `${id}.json`), "utf8")) as PlanAmendmentResult | PinnedAskSettlementResult;
    if (!RECEIPT_SCHEMAS.has(value.schema) || value.id !== id ||
        !["running", "failed", "succeeded"].includes(value.status) ||
        ![value.reason, value.message, value.next, value.runDirectory].every(item => typeof item === "string" && item.trim())) {
      throw new Error("Invalid durable operator action receipt.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
