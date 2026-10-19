import { ArcadiaCliError, loadJourney } from "../../../../lib/arcadia-cli";
import { JOURNEY_STYLES } from "../../../../components/journey-map";
import { JourneyLive } from "./journey-live";

export const dynamic = "force-dynamic";

/** Seconds between refreshes, live (fetch) and with JavaScript off (meta refresh). */
const REFRESH_SECONDS = 30;

/**
 * `/journey/<project>/<action>` — one Action's rover journey: past, now and
 * the way ahead, rendered on the server from `arcadia journey --json` so the
 * map is complete with JavaScript off, then refreshed every 30 seconds. Pure
 * projection: nothing here writes, and no agent runs per update.
 * `/journey/<project>/current` follows the Project's current Action.
 */
export default async function JourneyPage({ params }: { params: Promise<{ project: string; action: string }> }) {
  const { project, action } = await params;
  const loaded = await loadJourney(project, action).then(
    (response) => ({ journey: response.data, error: null }),
    (error: unknown) => ({ journey: null, error: error instanceof ArcadiaCliError || error instanceof Error ? error.message : String(error) })
  );
  const content = loaded.journey ? (
    <JourneyLive initial={loaded.journey} follow={action} refreshSeconds={REFRESH_SECONDS} />
  ) : (
    <>
      <h1 className="text-base font-semibold">{action}</h1>
      <p className="mt-2 text-sm text-clay">The journey could not be read: {loaded.error}</p>
    </>
  );
  return (
    <div data-theme-scope="auto" className="min-h-dvh w-full bg-canvas text-ink">
      <noscript><meta httpEquiv="refresh" content={`${REFRESH_SECONDS}`} /></noscript>
      <style>{JOURNEY_STYLES}</style>
      <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-7">{content}</main>
    </div>
  );
}
