import path from "node:path";
import { runHeadlessProviderTest } from "../src/operatorActions/headlessProviderTest.js";

// Entry point for the operator action test-headless-provider-single-action.
// Arguments: <run-directory> <run-id> <script-id> [--keep]. Exit 0 only when a provider passed.
const [runDirectory, runId, scriptId, ...flags] = process.argv.slice(2);
if (!runDirectory || !runId || !scriptId) {
  process.stderr.write("usage: headless-provider-test.ts <run-directory> <run-id> <script-id> [--keep]\n");
  process.exit(2);
}
const timeout = Number(process.env.ARCADIA_HEADLESS_TEST_TIMEOUT_MS);
const outcome = await runHeadlessProviderTest({
  repoRoot: path.resolve(import.meta.dirname, ".."),
  runDirectory, runId, scriptId,
  keep: flags.includes("--keep") || ["1", "true", "yes"].includes((process.env.ARCADIA_HEADLESS_TEST_KEEP ?? "").toLowerCase()),
  // The live-workspace snapshot is information only; tests turn it off so they never read a developer's live workspace.
  ...(process.env.ARCADIA_HEADLESS_TEST_LEAK_CHECK === "0" ? { liveLeakCheck: false } : {}),
  ...(Number.isFinite(timeout) && timeout > 0 ? { providerTimeoutMs: timeout } : {})
});
process.stdout.write(`Receipt: ${outcome.receiptPath}\n`);
process.exitCode = outcome.outcome === "succeeded" ? 0 : 1;
