import { WorkspaceView } from "../../../components/workspace/workspace-view";

export const metadata = { title: "Workspace" };
export default async function WorkspacePage({ params }: { params: Promise<{ scope?: string[] }> }) {
  const { scope } = await params;
  return <WorkspaceView parts={scope ?? []} />;
}
