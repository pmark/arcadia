import { accessSync, constants, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { OperatorScriptContractError, validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";

// Reads only library pairs. Never executes an action or opens a workspace.
const library = realpathSync(process.argv[2] ?? path.resolve(import.meta.dirname, "../artifacts/generated/operator-scripts"));
let count = 0;
let failures = 0;
for (const entry of readdirSync(library).filter(file => file.endsWith(".json")).sort()) {
  const id = entry.slice(0, -5);
  try {
    const script = realpathSync(path.join(library, `${id}.sh`));
    if (path.dirname(script) !== library) throw new Error("Executable resolves outside the library.");
    accessSync(script, constants.X_OK);
    validateOperatorScriptContract(JSON.parse(readFileSync(path.join(library, entry), "utf8")), id, readFileSync(script, "utf8"));
    count++;
  } catch (error) {
    failures++;
    process.stderr.write(JSON.stringify({ id, reason: error instanceof OperatorScriptContractError ? error.reason : "INVALID_OPERATOR_CONTRACT", message: error instanceof Error ? error.message : String(error) }) + "\n");
  }
}
process.stdout.write(JSON.stringify({ checked: count, failures }) + "\n");
process.exitCode = failures ? 1 : 0;
