import { SessionDetail } from "../../../components/session-detail";
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionDetail key={id} id={id} />;
}
