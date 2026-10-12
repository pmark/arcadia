import { readFileSync } from "node:fs";
import path from "node:path";
import { validateSessionLedger } from "../src/reports/sessionLedger.js";

// Deterministic, read-only: validates docs/reports/session-ledger.jsonl (or the path given).
const file = process.argv[2] ?? path.resolve(import.meta.dirname, "../docs/reports/session-ledger.jsonl");
const errors = validateSessionLedger(readFileSync(file, "utf8"));
if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`session ledger valid: ${file}\n`);
