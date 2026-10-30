import { resolveDashboardWorkspace } from "./arcadia-cli";
import type { DashboardAgentSession } from "./types";

export interface SessionObservation { observedAt: string; projectSlug?: string | null; known: boolean; session: DashboardAgentSession | null }

/** Server-only adapter: use the canonical read-only projection, never browser storage. */
export async function readSessionObservation(target: { id: string } | { projectId: string; plan: string; action: string }): Promise<SessionObservation> {
  const { observeDashboardSession } = await import("../../../src/dashboard/sessionObservation.js");
  return observeDashboardSession(await resolveDashboardWorkspace(), target);
}
