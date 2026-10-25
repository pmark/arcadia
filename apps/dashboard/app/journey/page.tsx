import Link from "next/link";
import { loadScheduleSummary } from "../../lib/arcadia-cli";

export const dynamic = "force-dynamic";

/** `/journey` — each Project's active Plan journey and current Action journey. */
export default async function JourneyIndexPage() {
  const loaded = await loadScheduleSummary(0).then(
    (response) => ({ projects: response.data.projects, error: null }),
    (error: unknown) => ({ projects: [], error: error instanceof Error ? error.message : String(error) })
  );
  return (
    <div data-theme-scope="auto" className="min-h-dvh w-full bg-canvas text-ink">
      <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-7">
        <h1 className="text-[15px] font-semibold">Journey</h1>
        <p className="mb-4 mt-0.5 text-[13px] text-muted">Where each Project&apos;s rover is, by Plan and by Action.</p>
        {loaded.error ? <p className="text-sm text-clay">Projects could not be read: {loaded.error}</p> : null}
        <ul className="divide-y divide-line rounded-md border border-line bg-panel">
          {loaded.projects.map((project) => (
            <li key={project.projectSlug} className="px-3 py-2.5 text-sm">
              <span className="block font-semibold">{project.projectName}</span>
              <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <Link className="text-steel underline" href={`/journey/${encodeURIComponent(project.projectSlug)}/plan/current`}>Active Plan</Link>
                {project.currentAction ? (
                  <Link className="break-all text-steel underline" href={`/journey/${encodeURIComponent(project.projectSlug)}/current#now`}>Current Action: {project.currentAction}</Link>
                ) : (
                  <span className="text-muted">No current Action</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
