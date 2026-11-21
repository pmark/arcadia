import { RoadmapLive } from "../../../../components/workspace/roadmap/roadmap-live";
import { cliMessage } from "../../../../lib/plans-server";
import { loadRoadmap } from "../../../../lib/roadmap-server";
import type { RoadmapView } from "../../../../../../src/roadmap/derive";

export const metadata = { title: "Roadmap" };
export const dynamic = "force-dynamic";

/** `/workspace/roadmap/<project>`: the Project's route to its North Star, rendered on the server from checked-in records. */
export default async function RoadmapPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  let initial: RoadmapView | null = null;
  let error: string | null = null;
  try {
    initial = await loadRoadmap(project);
  } catch (caught) {
    error = cliMessage(caught);
  }
  return <RoadmapLive project={project} initial={initial} initialError={error} />;
}
