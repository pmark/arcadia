import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { openReadOnlyDatabase } from "../src/db/connection.js";
import {
  SOAK_DEFAULT_CLEAN_TARGET,
  SOAK_DEFAULT_MAX_ITERATIONS,
  checkFixtureClean,
  emptySoakState,
  gateFilesTouched,
  parseVitestReport,
  runSoak,
  type SoakFailure,
  type SoakState
} from "../src/soak/rehearsalSoak.js";

/**
 * `soak-rehearsal.ts run` / `soak-rehearsal.ts guard-merge` -- see START_HERE.md.
 * Each iteration is a fresh `vitest run` of the rehearsal harness, which builds
 * its own throwaway fixture, so no iteration can inherit another's residue.
 */

const REPO = "pmark/arcadia";
const HARNESS_TEST = "tests/rehearsal-two-action.test.ts";
const STATE_FILE = path.join("artifacts", "generated", "soak", "rehearsal-soak.json");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "clean-target": { type: "string", default: String(SOAK_DEFAULT_CLEAN_TARGET) },
    "max-iterations": { type: "string", default: String(SOAK_DEFAULT_MAX_ITERATIONS) },
    "token-budget": { type: "string" },
    "spent-tokens": { type: "string", default: "0" },
    "non-blocking": { type: "string", multiple: true, default: [] },
    "fixture-workspace": { type: "string" },
    "fixture-repo": { type: "string" },
    "action-key": { type: "string", multiple: true, default: [] },
    "request-id": { type: "string", multiple: true, default: [] },
    reset: { type: "boolean", default: false },
    "no-issues": { type: "boolean", default: false },
    base: { type: "string", default: "origin/main" },
    head: { type: "string", default: "HEAD" }
  }
});

function positiveInt(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer, got "${raw}"`);
  return value;
}

function guardMerge(): number {
  const changed = execFileSync("git", ["diff", "--name-only", `${values.base}...${values.head}`], { encoding: "utf8" })
    .split("\n").map((line) => line.trim()).filter(Boolean);
  const gate = gateFilesTouched(changed);
  if (gate.length > 0) {
    console.error(`REFUSED: ${values.head} changes the concurrency gate, admission policy or approval boundaries. Leave the pull request open for the operator:\n  ${gate.join("\n  ")}`);
    return 2;
  }
  console.log(`ok: ${changed.length} changed path(s) between ${values.base} and ${values.head}; none is a gate file.`);
  return 0;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

/** One bug Issue per failure signature: an existing Issue is updated with a comment, never duplicated. */
function fileIssue(failure: SoakFailure, iteration: number): string {
  const marker = `soak-signature: ${failure.signature}`;
  const evidence = [
    `Rehearsal soak iteration ${iteration} failed \`${failure.testName}\` in \`${HARNESS_TEST}\`.`,
    "",
    `Location: ${failure.location ?? "no repository frame in the stack"}`,
    "",
    "```",
    failure.message.slice(0, 3000),
    "```",
    "",
    marker
  ].join("\n");
  if (values["no-issues"]) return `(issue filing disabled) ${marker}`;
  const existing = JSON.parse(gh(["issue", "list", "--repo", REPO, "--state", "all", "--search", `"${failure.signature}" in:body`, "--json", "number,url", "--limit", "1"])) as Array<{ number: number; url: string }>;
  if (existing[0]) {
    gh(["issue", "comment", String(existing[0].number), "--repo", REPO, "--body", evidence]);
    return existing[0].url;
  }
  return gh(["issue", "create", "--repo", REPO, "--label", "bug", "--title", `Rehearsal soak: ${failure.testName}`, "--body", evidence]);
}

function runIteration(): { failures: SoakFailure[] } {
  const dir = mkdtempSync(path.join(tmpdir(), "arcadia-soak-"));
  const report = path.join(dir, "report.json");
  try {
    const run = spawnSync("pnpm", ["exec", "vitest", "run", HARNESS_TEST, "--reporter=json", `--outputFile=${report}`], { stdio: ["ignore", "ignore", "inherit"], encoding: "utf8" });
    if (run.status === 0) return { failures: [] };
    return { failures: parseVitestReport(existsSync(report) ? readFileSync(report, "utf8") : null, run.status) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function preflight(): string[] {
  if (!values["fixture-workspace"]) return [];
  if (!values["fixture-repo"]) throw new Error("--fixture-workspace needs --fixture-repo");
  const db = openReadOnlyDatabase(values["fixture-workspace"]);
  try {
    return checkFixtureClean(db, { repositoryPath: values["fixture-repo"], actionKeys: values["action-key"], requestIds: values["request-id"], now: new Date() });
  } finally {
    db.close();
  }
}

function main(): number {
  const command = positionals[0] ?? "run";
  if (command === "guard-merge") return guardMerge();
  if (command !== "run") throw new Error(`unknown command "${command}"; use run or guard-merge`);

  const violations = preflight();
  if (violations.length > 0) {
    console.error(`REFUSED: the fixture is not clean; a soak result from it would not mean anything.\n  ${violations.join("\n  ")}`);
    return 2;
  }

  const state: SoakState = !values.reset && existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as SoakState) : emptySoakState();
  state.tokensSpent += positiveInt("spent-tokens", values["spent-tokens"]);
  const outcome = runSoak(
    state,
    {
      cleanTarget: positiveInt("clean-target", values["clean-target"]),
      maxIterations: positiveInt("max-iterations", values["max-iterations"]),
      tokenBudget: values["token-budget"] === undefined ? null : positiveInt("token-budget", values["token-budget"]),
      nonBlocking: values["non-blocking"]
    },
    {
      runIteration,
      fileIssue,
      save: (next) => {
        mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`);
      },
      now: () => new Date(),
      print: (line) => console.log(line)
    }
  );
  return outcome.reason === "clean_target_reached" ? 0 : 1;
}

try {
  process.exit(main());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
