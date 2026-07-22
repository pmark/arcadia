import { redirect } from "next/navigation";

// Mission Control (app/mission-control/page.tsx) is the default view.
// The previous root dashboard is preserved, unlinked from nav, at /dashboard.
export default function RootPage() {
  redirect("/mission-control");
}
