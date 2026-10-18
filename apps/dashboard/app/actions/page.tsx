import { redirect } from "next/navigation";
import { singleActionPath } from "../../lib/actionRedirect";
import { ActionsList } from "./actions-list";

export const dynamic = "force-dynamic";

/** `/actions?q=<script id>` (every existing ping link) lands on the one-action page; other q values search the list. */
export default async function OperatorActionsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const target = await singleActionPath((await searchParams).q);
  if (target) redirect(target);
  return <ActionsList />;
}
