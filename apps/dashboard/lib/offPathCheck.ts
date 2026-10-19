import { deriveNextOperatorAction, offPathConfirmation, productionObservation, shortName, type ProductionObservation, type SequencedScript } from "./nextOperatorAction";

/**
 * The single-action page loads one card, so it cannot know the operator's next action up front.
 * At press time it reads the library once (and live production status only when a published
 * next_after needs it) and returns the same off-path confirmation text the list page shows.
 * It throws when the library cannot be read (the caller then launches nothing), and returns a
 * "could not confirm" text when production status is needed but unreadable, so the operator must
 * choose to run anyway.
 */
export async function resolveOffPathConfirmation(pressed: SequencedScript, fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<string | null> {
  const response = await fetchImpl("/api/operator-script", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await response.json() as { scripts?: SequencedScript[]; error?: string };
  if (!response.ok || !body.scripts) throw new Error(body.error ?? "Operator actions are unavailable.");
  const scripts = body.scripts;
  const needsProduction = scripts.some((script) => script.nextAfter?.when_production === "inactive");
  let production: ProductionObservation = null;
  if (needsProduction) {
    try {
      const status = await fetchImpl("/api/production-control?part=core", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      production = productionObservation(status.ok, await status.json());
    } catch {
      production = null; // unreadable is shown as such, never treated as Off
    }
  }
  const next = deriveNextOperatorAction(scripts, production, now);
  if (next.status === "none" && next.unknown) {
    return `Could not confirm this is your next action: production status could not be read. ${shortName(pressed.title)} will only start if you run it anyway.`;
  }
  return offPathConfirmation(next, pressed, scripts);
}
