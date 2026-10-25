import { ArcadiaCliError, loadPathBrief, loadPlanJourney } from "../../../../../lib/arcadia-cli";
import { PlanJourneyLive } from "./plan-journey-live";

export const dynamic = "force-dynamic";

const REFRESH_SECONDS = 30;
/** How long the first paint waits for the North Star before rendering without it. */
const PATH_WAIT_MS = 5_000;

/**
 * `/journey/<project>/plan/<plan>` — a Plan's rover journey as one row per
 * Action, rendered on the server from `arcadia journey <project>/plan:<plan>`
 * and refreshed every 30 seconds. `plan` may be `current` (the active Plan).
 */
export default async function PlanJourneyPage({ params }: { params: Promise<{ project: string; plan: string }> }) {
  const { project, plan } = await params;
  const pathRead = withinMs(loadPathBrief().then((response) => response.data, () => null), PATH_WAIT_MS);
  const loaded = await loadPlanJourney(project, plan).then(
    (response) => ({ journey: response.data, error: null }),
    (error: unknown) => ({ journey: null, error: error instanceof ArcadiaCliError || error instanceof Error ? error.message : String(error) })
  );
  const content = loaded.journey ? (
    <PlanJourneyLive initial={loaded.journey} path={await pathRead} follow={plan} refreshSeconds={REFRESH_SECONDS} />
  ) : (
    <>
      <h1 className="text-base font-semibold">{plan}</h1>
      <p className="mt-2 text-sm text-clay">The Plan journey could not be read: {loaded.error}</p>
    </>
  );
  return (
    <div data-theme-scope="auto" className="min-h-dvh w-full bg-canvas text-ink">
      <noscript><meta httpEquiv="refresh" content={`${REFRESH_SECONDS}`} /></noscript>
      <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-7">{content}</main>
    </div>
  );
}

function withinMs<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
