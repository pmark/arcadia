import type { PlanActionDoc } from "../docs/types.js";
import { validationError } from "../cli/errors.js";

/** Explicit capability reference plus conservative recognition of existing
 * measurement criteria. This is a missing-capability guard, never a grant. */
export function localBrowserAuditBlocker(agent: string, action: Pick<PlanActionDoc, "acceptanceCriteria" | "references">): string | null {
  if (!["codex", "codex-cli"].includes(agent)) return null;
  const required = action.references.includes("capability/local-browser-audit") || action.acceptanceCriteria.some(criterion =>
    /\bLighthouse\b.*\b(?:results|scores|matrix)\b|\brendered audit\b|\bheadless browser audit\b/i.test(criterion));
  if (!required) return null;
  return "local_browser_audit_unavailable: this Action declares browser measurement, but the installed arcadia-unattended path has no proven loopback/headless capability. Run the fixture-only scripts/probe-local-browser-audit.mjs on the host and retain its receipt. An operator-approved bounded audit route is required; reinstalling the unchanged profile or escalating this Action is not a remedy (Issue #847).";
}

export function assertLocalBrowserAuditReady(agent: string, action: Pick<PlanActionDoc, "acceptanceCriteria" | "references">): void {
  const reason = localBrowserAuditBlocker(agent, action);
  if (reason) throw validationError(reason, { capability: "local-browser-audit", operatorDecisionRequired: true });
}
