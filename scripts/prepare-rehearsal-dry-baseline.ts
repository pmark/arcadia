import { readFileSync } from "node:fs";
import path from "node:path";
import { stageDryPreparation, validateDryPrepParams } from "../src/operatorActions/rehearsalDryPreparation.js";

/**
 * The N-neutral rehearsal dry-preparation command. Reads one reviewed
 * parameter file, renders a fresh step-01..step-NN baseline, checks it with
 * the coherence guard and Arcadia's own discovery, and writes a hash-bound
 * receipt into `--output-dir` (required; this script never writes into
 * artifacts/generated/operator-scripts, the live workspace, the live fixture
 * at the parameter file's pinned path, or GitHub). Dry-only: it runs no Git,
 * GitHub, workspace, model or network call.
 *
 * Usage:
 *   node --import tsx scripts/prepare-rehearsal-dry-baseline.ts <params.json> --reset-date YYYY-MM-DD --output-dir <path>
 */
const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : null;
};
const paramsFile = args[0]?.startsWith("--") ? undefined : args[0];
const resetDate = flag("--reset-date");
const outputDir = flag("--output-dir");
const repoRoot = path.resolve(import.meta.dirname, "..");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!paramsFile) fail("Usage: prepare-rehearsal-dry-baseline.ts <params.json> --reset-date YYYY-MM-DD --output-dir <path>");
if (!resetDate) fail("--reset-date YYYY-MM-DD is required.");
if (!outputDir) fail("--output-dir <path> is required; this command never defaults into the main operator-scripts library.");

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(paramsFile, "utf8"));
} catch (error) {
  fail(`${paramsFile} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const { params, problems, unfilled } = validateDryPrepParams(raw);
if (!params) fail(`${paramsFile} is not a valid dry-preparation parameter file:\n${problems.join("\n")}`);
if (unfilled.length > 0) fail(`${paramsFile} has unfilled bindings, so this command refuses:\n${unfilled.join("\n")}`);

const result = stageDryPreparation(params, resetDate, path.resolve(outputDir), repoRoot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status === "refused") process.exitCode = 1;
