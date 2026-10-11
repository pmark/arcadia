/**
 * Warm the operator's to-do list once when the server starts, so the first
 * phone load after a restart reads a cached copy instead of waiting for the
 * three CLI reads behind it. Best effort: a failure is ignored, and the first
 * request then builds the list itself exactly as before.
 */
export async function register() {
  // The runtime check must wrap the import: the edge bundle cannot load node:child_process.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { warmApprovals } = await import("./lib/approvals-warm");
    warmApprovals();
  }
}
