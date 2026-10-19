import { createHash } from "node:crypto";

/**
 * The content-addressed request id an auto-settle mints for a drafted
 * `complete` Ask (src/ask/autoSettleBeforeDispatch.ts): the Project, the
 * Action and the first 12 hex of the sha256 of the Ask content it settles. The
 * deterministic patch check (src/qa/patchApplicability.ts) derives the same id
 * from the archived Ask a settlement carries. A leaf module: no Arcadia imports.
 */
export function autoSettleRequestId(projectSlug: string, actionId: string, content: string): string {
  const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `auto-settle-${projectSlug}-${actionId}-${contentHash}`.slice(0, 120);
}
