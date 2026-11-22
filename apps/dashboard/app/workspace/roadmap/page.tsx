import { redirect } from "next/navigation";
import { roadmapProjectSlugs } from "../../../lib/roadmap-server";

export const dynamic = "force-dynamic";

/** `/workspace/roadmap` opens the Arcadia Project's Roadmap, or the first Project that has a repository. */
export default function RoadmapIndexPage() {
  let slugs: string[];
  try {
    slugs = roadmapProjectSlugs();
  } catch (error) {
    return <main className="workspace-main route-main"><p className="route-empty" role="alert">{error instanceof Error ? error.message : "The Roadmap could not be opened."}</p></main>;
  }
  const slug = slugs.includes("arcadia") ? "arcadia" : slugs[0];
  if (!slug) return <main className="workspace-main route-main"><p className="route-empty">No Project with a repository is in this workspace.</p></main>;
  redirect(`/workspace/roadmap/${encodeURIComponent(slug)}`);
}
