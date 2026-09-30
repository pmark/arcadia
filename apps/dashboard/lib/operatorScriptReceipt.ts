import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlanAmendmentResult } from "../../../src/operatorActions/planAmendment.js";

/** The dashboard projects a runner-owned receipt; it never reinterprets settlement. */
export async function loadOperatorScriptReceipt(library: string, id: string): Promise<PlanAmendmentResult | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid operator action id.");
  try {
    const value = JSON.parse(await readFile(path.join(library, "runs/receipts", `${id}.json`), "utf8")) as PlanAmendmentResult;
    if (value.schema !== "arcadia-plan-amendment-receipt-v1" || value.id !== id ||
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
