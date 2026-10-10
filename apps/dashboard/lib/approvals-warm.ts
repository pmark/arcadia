import { getApprovals } from "./approvals-feed";

/** Start the shared to-do list build in the background; never throws and never waits. */
export function warmApprovals(): void {
  void getApprovals().catch(() => undefined);
}
