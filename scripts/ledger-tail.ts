import path from "node:path";
import { readSessionLedger, tailLedger } from "../src/reports/sessionLedgerSource.js";

// Read-only: prints the last n combined ledger rows (default 3) as compact JSON lines.
const n = Number(process.argv[2] ?? 3);
if (!Number.isInteger(n) || n < 0) {
  process.stderr.write("usage: pnpm ledger:tail [n]\n");
  process.exit(2);
}
const root = process.argv[3] ?? path.resolve(import.meta.dirname, "..");
const combined = readSessionLedger(root);
for (const warning of combined.errors) process.stderr.write(`warning: ${warning}\n`);
for (const line of tailLedger(combined.rows, n)) process.stdout.write(`${line}\n`);
