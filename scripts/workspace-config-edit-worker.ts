// One bounded invocation owns the pinned checks, the edit and the receipt (src/operatorActions/workspaceConfigEdit.ts).
import { readFileSync } from "node:fs";
import { runWorkspaceConfigEdit } from "../src/operatorActions/workspaceConfigEdit.js";

const [descriptor, mode] = process.argv.slice(2);
if (process.argv.length !== 4 || !descriptor || !["run", "--describe"].includes(mode ?? "")) {
  process.stderr.write("Usage: workspace-config-edit-worker.ts <descriptor> run|--describe\n");
  process.exit(64);
}
if (mode === "--describe") {
  process.stdout.write(readFileSync(descriptor));
} else {
  const result = runWorkspaceConfigEdit(descriptor);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.status === "succeeded" ? 0 : 1;
}
