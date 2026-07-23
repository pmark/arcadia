import { MissionControlNodePage } from "../page";

export default async function MissionControlNodeRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MissionControlNodePage nodeId={id} />;
}
