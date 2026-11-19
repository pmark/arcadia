import { refreshStaleGuidance } from "../src/production/mechanicalRepair.js";

const result = refreshStaleGuidance(process.cwd(), process.argv.slice(2));
for (const file of result.refreshed) process.stdout.write(`refreshed ${file}\n`);
if (result.refreshed.length === 0 && result.refused.length === 0) process.stdout.write("No stale guidance fingerprints.\n");
for (const file of result.refused) process.stderr.write(`not refreshed (not an indexed guidance document): ${file}\n`);
if (result.refused.length > 0) process.exitCode = 1;
