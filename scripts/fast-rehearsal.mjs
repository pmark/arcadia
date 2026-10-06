#!/usr/bin/env node
// `pnpm fast-rehearsal`: run the fast scenario harness (tests/fast-rehearsal)
// over the real production lifecycle, then print its report.
//
// Each scenario writes a JSON report into a fresh temporary directory (never
// the repository) named by FAST_REHEARSAL_REPORT_DIR; this script collects
// them, prints a per-phase timing table and every recorded error, and writes
// the combined report.json next to them. The exit status is vitest's.
//
// On macOS, when `sandbox-exec` can run (an unsandboxed shell), preservation
// validation runs under the real Seatbelt validator
// (ARCADIA_PRESERVATION_HOST_TEST=1, as tests/manual-preservation.test.ts);
// otherwise the harness's unsandboxed binding of the same checks. Pass
// --unsandboxed-validator to force the latter. Any other argument goes to
// vitest (for example a test-name filter: -t "Issue #987").
//
// See tests/fast-rehearsal/README.md.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PHASES = ["queueWait", "agentExecution", "validation", "gitFinalization", "review", "integration", "advancement"];
const HEADINGS = ["queue", "agent", "valid.", "git fin.", "review", "integr.", "advance"];

const args = process.argv.slice(2);
const forceUnsandboxed = args.includes("--unsandboxed-validator");
const vitestArgs = args.filter((arg) => arg !== "--unsandboxed-validator");

const reportDir = mkdtempSync(path.join(tmpdir(), "arcadia-fast-rehearsal-report-"));
const env = { ...process.env, FAST_REHEARSAL_REPORT_DIR: reportDir };
if (forceUnsandboxed) delete env.ARCADIA_PRESERVATION_HOST_TEST;
else if (env.ARCADIA_PRESERVATION_HOST_TEST === undefined && seatbeltAvailable()) env.ARCADIA_PRESERVATION_HOST_TEST = "1";

const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitest)) {
  console.error(`fast-rehearsal: ${vitest} is missing; install dependencies first (in a worktree: node scripts/bridge-worktree-deps.mjs).`);
  process.exit(2);
}
const started = Date.now();
const run = spawnSync(process.execPath, [vitest, "run", "tests/fast-rehearsal", ...vitestArgs], { cwd: root, env, stdio: "inherit" });
const wallMs = Date.now() - started;

const reports = readdirSync(reportDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(path.join(reportDir, file), "utf8")))
  .sort((a, b) => `${a.file}/${a.scenario}`.localeCompare(`${b.file}/${b.scenario}`));
const combined = { wallMs, vitestStatus: run.status, reportDir, scenarios: reports };
writeFileSync(path.join(reportDir, "report.json"), `${JSON.stringify(combined, null, 2)}\n`);

console.log("");
console.log(`Fast rehearsal report: ${reports.length} scenario(s), ${seconds(wallMs)} wall (vitest exit ${String(run.status)})`);
console.log(`Validator: ${[...new Set(reports.map((report) => report.validator))].join(", ") || "n/a"}. Phase times are wall seconds (worker ticks in brackets).`);
console.log("");
const rows = [["scenario / Action", "outcome", ...HEADINGS, "ticks", "wall"]];
for (const report of reports) {
  rows.push([`${report.scenario} (${report.file})`, "", ...PHASES.map(() => ""), String(report.ticks), seconds(report.wallMs)]);
  for (const action of report.actions) {
    rows.push([`  ${action.actionId}`, action.outcome, ...PHASES.map((phase) => cell(action.phases[phase])), "", ""]);
  }
}
printTable(rows);

const errors = reports.flatMap((report) => report.errors.map((error) => ({ scenario: report.scenario, ...error })));
const unexpected = errors.filter((error) => !error.expected);
console.log("");
console.log(`Errors: ${errors.length} recorded, ${unexpected.length} unexpected.`);
for (const error of [...unexpected, ...errors.filter((entry) => entry.expected)]) {
  console.log(`- [${error.expected ? "expected" : "UNEXPECTED"}] ${error.scenario}: ${error.kind} \`${error.command}\` (cwd ${error.cwd}, exit ${error.exitCode ?? "n/a"})`);
  console.log(`    ${error.stderr.split("\n").join("\n    ")}`);
}
const notes = reports.flatMap((report) => report.notes.map((note) => `${report.scenario}: ${note}`));
if (notes.length) {
  console.log("");
  console.log("Notes:");
  for (const note of notes) console.log(`- ${note}`);
}
console.log("");
console.log(`Full report (per-tick log, worker log): ${path.join(reportDir, "report.json")}`);
if (wallMs > 5 * 60_000) console.log(`WARNING: the harness took ${seconds(wallMs)}, over its five-minute target.`);
process.exit(run.status ?? 1);

function cell(phase) {
  if (!phase || (phase.ms === 0 && phase.ticks === 0)) return "-";
  return `${(phase.ms / 1000).toFixed(1)}${phase.ticks ? ` [${phase.ticks}]` : ""}`;
}

function seconds(ms) {
  return ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s` : `${(ms / 1000).toFixed(1)}s`;
}

function printTable(table) {
  const widths = table[0].map((_, column) => Math.max(...table.map((row) => row[column].length)));
  for (const row of table) console.log(row.map((value, column) => (column < 2 ? value.padEnd(widths[column]) : value.padStart(widths[column]))).join("  ").trimEnd());
}

function seatbeltAvailable() {
  if (process.platform !== "darwin") return false;
  const probe = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"], { stdio: "ignore", timeout: 10_000 });
  return probe.status === 0;
}
