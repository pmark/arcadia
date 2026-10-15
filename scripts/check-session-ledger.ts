import path from "node:path";
import { readFrictionFiles, readHandoffFiles, readSessionLedger, validateFrictionFiles, validateHandoffFiles } from "../src/reports/sessionLedgerSource.js";

// Deterministic, read-only: validates the legacy ledger plus docs/reports/session-ledger/*.json,
// friction files and hand-off file names. An optional argument is the repository root.
const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
const errors = [
  ...readSessionLedger(root).errors,
  ...validateFrictionFiles(readFrictionFiles(root)),
  ...validateHandoffFiles(readHandoffFiles(root)),
];
if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`session ledger valid: ${root}\n`);
