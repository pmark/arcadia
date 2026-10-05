import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { OperatorScriptContractError, validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { matchRetirement, parseRetirementManifest } from "../src/operatorActions/libraryRetirements.js";

// Reads only library pairs and the tracked retirement manifest. Never executes an action or opens a workspace.
const args = process.argv.slice(2);
const flag = args.indexOf("--retirements");
const manifestPath = flag >= 0 ? args.splice(flag, 2)[1] : path.resolve(import.meta.dirname, "../src/operatorActions/legacyRetirements.json");
const library = realpathSync(args[0] ?? path.resolve(import.meta.dirname, "../artifacts/generated/operator-scripts"));
let retirements;
try {
  if (!manifestPath) throw new Error("--retirements needs a manifest path.");
  retirements = parseRetirementManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
} catch (error) {
  process.stderr.write(JSON.stringify({ reason: "INVALID_RETIREMENT_MANIFEST", manifest: manifestPath ?? null, message: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exit(1);
}
let count = 0;
let failures = 0;
const retired: string[] = [];
for (const entry of readdirSync(library).filter(file => file.endsWith(".json")).sort()) {
  const id = entry.slice(0, -5);
  try {
    const script = realpathSync(path.join(library, `${id}.sh`));
    if (path.dirname(script) !== library) throw new Error("Executable resolves outside the library.");
    accessSync(script, constants.X_OK);
    const descriptorBytes = readFileSync(path.join(library, entry));
    const scriptBytes = readFileSync(script);
    // Exact-hash pin only: any changed, renamed or new file falls through to full validation.
    if (matchRetirement(retirements, id, descriptorBytes, scriptBytes)) { retired.push(id); continue; }
    const descriptor = validateOperatorScriptContract(JSON.parse(descriptorBytes.toString("utf8")), id, scriptBytes.toString("utf8"));
    // A "Do this next" hint must name a published prerequisite; voided_by may name host-local entries.
    if (descriptor.next_after && !existsSync(path.join(library, `${descriptor.next_after.id}.json`))) {
      throw new OperatorScriptContractError("UNKNOWN_NEXT_AFTER_PREREQUISITE", `next_after names ${descriptor.next_after.id}, which is not in this library.`);
    }
    count++;
  } catch (error) {
    failures++;
    process.stderr.write(JSON.stringify({ id, reason: error instanceof OperatorScriptContractError ? error.reason : "INVALID_OPERATOR_CONTRACT", message: error instanceof Error ? error.message : String(error) }) + "\n");
  }
}
process.stdout.write(JSON.stringify({ checked: count, retired: retired.length, retiredIds: retired, failures }) + "\n");
process.exitCode = failures ? 1 : 0;
