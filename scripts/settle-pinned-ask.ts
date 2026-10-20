// The shared runner behind every pinned Agent Ask settlement button. The
// generated launcher passes only its own descriptor and `run` or `--describe`.
import { readFileSync } from "node:fs";
import { runPinnedAskSettlement } from "../src/operatorActions/pinnedAskSettlement.js";

const [descriptor, mode] = process.argv.slice(2);
if (process.argv.length !== 4 || !descriptor || !["run", "--describe"].includes(mode ?? "")) {
  process.stderr.write("Usage: settle-pinned-ask.ts <descriptor.json> run|--describe\n");
  process.exit(64);
}
if (mode === "--describe") {
  process.stdout.write(readFileSync(descriptor));
} else {
  const result = runPinnedAskSettlement(descriptor);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.status === "succeeded" ? 0 : 1;
}
