import path from "node:path";
import { checkFrozenRecords } from "../src/reports/frozenRecords.js";

// Deterministic, read-only: fails when a file listed in docs/reports/frozen-records.json changed.
const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
const errors = checkFrozenRecords(root);
if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`frozen records unchanged: ${root}\n`);
