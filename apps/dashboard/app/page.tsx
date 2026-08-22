import { redirect } from "next/navigation";

// Now (app/now/page.tsx) is the landing view: one target, one distance, one
// next move. Mission Control remains a tap away in the menu, and the previous
// root dashboard is preserved, unlinked from nav, at /dashboard.
export default function RootPage() {
  redirect("/now");
}
