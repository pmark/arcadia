import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { WorkItemSummary } from "../domain/types.js";

/**
 * The Action input a build packet is written from, as one digest: the
 * acceptance criteria the packet quotes to the coding agent, the
 * responsibility, the execution requirement and the declared route. It
 * follows `requirementIdentity`'s input revision but reads the synced work
 * item, which is exactly what `createCodexPacket` writes from and all a
 * DB-only reader such as the packet lifecycle has. A governed amendment of any
 * of these changes the digest.
 *
 * `next_action` is deliberately left out: completion settlement rewrites it
 * ("Completed via Agent Ask ..."), and a review-repair Session relaunches the
 * same packet after that, so including it would make every repaired Action's
 * packet stale. The criteria, not the next-step wording, are what a packet
 * commits the work to.
 */
export type PacketInputFields = Pick<
  WorkItemSummary,
  "acceptance_criteria_json" | "work_classification" | "execution_requirement_json" | "execution_route"
>;

export function workItemInputRevision(workItem: PacketInputFields): string {
  return createHash("sha256").update(JSON.stringify({
    acceptanceCriteria: parseOrRaw(workItem.acceptance_criteria_json),
    responsibility: workItem.work_classification,
    execution: parseOrRaw(workItem.execution_requirement_json),
    executionRoute: workItem.execution_route ?? null
  })).digest("hex");
}

/**
 * The input revision a prepared packet recorded in its metadata
 * (`actionInputRevision`), or null when it cannot be read: missing or
 * unreadable metadata, or a packet prepared before the revision was recorded.
 */
export function recordedPacketInputRevision(workspace: string, promptPath: string): string | null {
  try {
    const metadata = JSON.parse(readFileSync(path.join(workspace, path.dirname(promptPath), "metadata.json"), "utf8")) as { actionInputRevision?: unknown };
    return typeof metadata.actionInputRevision === "string" && metadata.actionInputRevision ? metadata.actionInputRevision : null;
  } catch {
    return null;
  }
}

/**
 * True only when the packet provably was prepared for the Action's current
 * input. Fails closed: a packet whose revision cannot be determined is not
 * current, so a fresh packet is prepared rather than launching on criteria
 * the packet may never have seen.
 */
export function packetIsForCurrentInput(workspace: string, promptPath: string, workItem: PacketInputFields): boolean {
  const recorded = recordedPacketInputRevision(workspace, promptPath);
  return recorded !== null && recorded === workItemInputRevision(workItem);
}

function parseOrRaw(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
