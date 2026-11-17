import { createHash } from "node:crypto";
import type { StartRunPins } from "./startRunPins.js";

/**
 * The one description of the production scope a START card activates. scripts/start-run.sh (P6) activates exactly this scope from the
 * card's pins, and the pre-press replay (`scripts/production-replay.ts --card`) builds its activation through this function, so the
 * scope, provider, transitions, concurrency and grant hours cannot be given to the replay differently from the executor.
 * `tests/start-run-scope.test.ts` holds P6's own fingerprint to this function's.
 */
export interface StartRunActivationScope {
  intent: string;
  projects: string[];
  plans: string[];
  actions: string[];
  providers: string[];
  maxConcurrentSessions: number;
  mechanicalTransitions: string[];
  remotePreservation: true;
  integrationGrant: { decisionRef: string; expiresAt: string; mergeThroughPullRequest: true };
  packetApprovalExpiresAt: string;
}

/** The scope a press at `now` activates: the packet approval and the integration grant both last the pinned hours. */
export function startRunActivationScope(pins: StartRunPins, now: Date): StartRunActivationScope {
  const expiresAt = new Date(now.getTime() + pins.packetApprovalHours * 3_600_000).toISOString();
  return {
    intent: pins.intent,
    projects: [pins.project],
    plans: [`${pins.project}/${pins.plan}`],
    actions: pins.actions.map((id) => `${pins.project}/${id}`),
    providers: [pins.provider],
    maxConcurrentSessions: pins.concurrency,
    mechanicalTransitions: [...pins.transitions],
    remotePreservation: true,
    integrationGrant: { decisionRef: pins.integrationDecision, expiresAt, mergeThroughPullRequest: true },
    packetApprovalExpiresAt: expiresAt
  };
}

/** The canonical-form fingerprint of a scope, in the form P6 and `fingerprintProductionScope` (src/production/policy.ts) share. */
export function startRunScopeFingerprint(scope: StartRunActivationScope): string {
  const canonical = JSON.stringify({
    intent: scope.intent, projects: scope.projects, plans: scope.plans, actions: scope.actions, providers: scope.providers,
    maxConcurrentSessions: scope.maxConcurrentSessions, mechanicalTransitions: [...new Set(scope.mechanicalTransitions)].sort(), remotePreservation: true,
    integrationGrant: { decisionRef: scope.integrationGrant.decisionRef, expiresAt: scope.integrationGrant.expiresAt, actions: [], mergeThroughPullRequest: true },
    packetApprovalExpiresAt: scope.packetApprovalExpiresAt
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
