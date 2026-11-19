/**
 * `pnpm pre-pr`: the CI-equivalent checks that have turned production
 * candidates red, run locally, in order, stopping at the first failure. Each
 * failure prints one fix line (the command or edit that clears it).
 *
 * Order: agent guidance (fingerprints, instruction caps), eslint on the files
 * changed against origin/main, tsc --noEmit, the authority-classifier
 * coverage test, check:operator-scripts, check:plan-close-outs,
 * check:frozen-records.
 *
 * Library use (tests): runPrePr(root, { run }) with an injected command runner.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classifyAuthorityPaths } from "../src/decisions/batchMerge.js";
import { GUIDANCE_FINGERPRINTS, GUIDANCE_INDEX, INSTRUCTION_BUDGET } from "../src/projects/agentGuidance.js";
import { staleGuidancePaths } from "../src/production/mechanicalRepair.js";
// @ts-expect-error plain-node script without type declarations
import { listSourceFiles } from "./discover-gate-modules.mjs";

export interface CommandResult { status: number; stdout: string; stderr: string }
export type CommandRunner = (command: string, args: string[], cwd: string) => CommandResult;

export interface PreprFailure {
  step: string;
  /** What is wrong, one line per problem. */
  problems: string[];
  /** The exact command or edit that fixes it, one line per problem. */
  fixes: string[];
}

export interface PrePrOptions {
  run?: CommandRunner;
  /** Ref the changed-file list is taken against. */
  base?: string;
  /** Files eslint covers; default is `git diff --name-only <base>` plus untracked files. */
  changedFiles?: string[];
}

const defaultRun: CommandRunner = (command, args, cwd) => {
  const r = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

const LINTABLE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const IGNORED_FOR_LINT = /^(?:config|database|artifacts|mission_logs|projects|tmp)\/|(?:^|\/)(?:node_modules|dist|\.next|coverage)\//;

function tail(text: string, lines = 15): string[] {
  return text.trim().split("\n").slice(-lines);
}

/** Step 1: fingerprints and instruction caps. */
export function checkGuidance(root: string, run: CommandRunner): PreprFailure | null {
  const problems: string[] = [];
  const fixes: string[] = [];
  if (existsSync(path.join(root, GUIDANCE_INDEX)) && existsSync(path.join(root, GUIDANCE_FINGERPRINTS))) {
    for (const doc of staleGuidancePaths(root)) {
      problems.push(`Stale guidance fingerprint: ${doc}`);
      fixes.push(`pnpm guidance:refresh ${doc}`);
    }
  }
  const measure = (file: string, cap: number, label: string): void => {
    const full = path.join(root, file);
    if (!existsSync(full)) return;
    const bytes = Buffer.byteLength(readFileSync(full, "utf8"));
    if (bytes > cap) {
      problems.push(`${label} over its cap: ${file} is ${bytes} bytes, cap ${cap}`);
      fixes.push(`Shrink ${file} from ${bytes} to at most ${cap} bytes (cap ${cap}); move procedure text behind docs/agent-guidance/index.json`);
    }
  };
  measure("docs/agents-context.md", INSTRUCTION_BUDGET.bootstrap, "Bootstrap");
  measure("AGENTS.md", INSTRUCTION_BUDGET.root, "Root instructions");
  if (problems.length > 0) return { step: "check:agent-guidance", problems, fixes };
  const r = run("pnpm", ["check:agent-guidance"], root);
  if (r.status === 0) return null;
  const text = `${r.stdout}\n${r.stderr}`;
  for (const m of text.matchAll(/Stale mandatory guidance: (\S+?)\./g)) {
    problems.push(`Stale guidance fingerprint: ${m[1]}`);
    fixes.push(`pnpm guidance:refresh ${m[1]}`);
  }
  for (const m of text.matchAll(/((?:Root|Project) instructions exceed \d+ bytes[^"\n]*|Combined guidance exceeds[^"\n]*|Agent bootstrap exceeds[^"\n]*)/g)) {
    const cap = /(\d+)(?:-byte| UTF-8 bytes| bytes)/.exec(m[1])?.[1] ?? "?";
    const measured = /\((\d+)\)/.exec(m[1])?.[1] ?? "see output";
    problems.push(m[1].trim());
    fixes.push(`Shrink the instruction file(s) named in the output: cap ${cap}, measured ${measured} bytes (AGENTS.md, CLAUDE.md or docs/agents-context.md)`);
  }
  if (problems.length === 0) {
    problems.push(...tail(text, 5));
    fixes.push("pnpm check:agent-guidance (read the problems list in its output)");
  }
  return { step: "check:agent-guidance", problems, fixes };
}

/** Files changed against the base plus untracked ones, lintable and not ignored by the eslint config. */
export function changedLintFiles(root: string, run: CommandRunner, base: string): string[] {
  const diff = run("git", ["diff", "--name-only", "--diff-filter=d", base], root);
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], root);
  const names = `${diff.stdout}\n${untracked.stdout}`.split("\n").map((s) => s.trim()).filter(Boolean);
  return [...new Set(names)].filter((f) => LINTABLE.test(f) && !IGNORED_FOR_LINT.test(f) && existsSync(path.join(root, f)));
}

export function checkLint(root: string, run: CommandRunner, files: string[]): PreprFailure | null {
  if (files.length === 0) return null;
  const r = run("pnpm", ["exec", "eslint", "--format", "json", ...files], root);
  if (r.status === 0) return null;
  let results: Array<{ filePath: string; errorCount: number; fixableErrorCount: number; fixableWarningCount?: number; messages: Array<{ line: number; ruleId: string | null; message: string; fix?: unknown; severity: number }> }> = [];
  try { results = JSON.parse(r.stdout); } catch { /* fall through to raw output */ }
  const failing = results.filter((f) => f.errorCount > 0);
  if (failing.length === 0) {
    return { step: "eslint", problems: tail(`${r.stdout}\n${r.stderr}`, 5), fixes: [`pnpm exec eslint ${files.join(" ")}`] };
  }
  const problems: string[] = [];
  const fixes: string[] = [];
  const fixable: string[] = [];
  for (const f of failing) {
    const rel = path.isAbsolute(f.filePath) ? path.relative(root, f.filePath) : f.filePath;
    const errors = f.messages.filter((m) => m.severity === 2);
    for (const m of errors) problems.push(`${rel}:${m.line} ${m.ruleId ?? "error"}: ${m.message}`);
    if (f.fixableErrorCount > 0) fixable.push(rel);
    if (errors.some((m) => !m.fix)) fixes.push(`Edit ${rel}: ${errors.filter((m) => !m.fix).map((m) => `line ${m.line} (${m.ruleId ?? "error"})`).join(", ")} is not auto-fixable`);
  }
  if (fixable.length > 0) fixes.unshift(`pnpm exec eslint --fix ${fixable.join(" ")}`);
  return { step: "eslint", problems, fixes };
}

export function checkTsc(root: string, run: CommandRunner): PreprFailure | null {
  const r = run("pnpm", ["exec", "tsc", "--noEmit"], root);
  if (r.status === 0) return null;
  const problems: string[] = [];
  const fixes: string[] = [];
  for (const m of `${r.stdout}\n${r.stderr}`.matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/gm)) {
    problems.push(`${m[3]}: ${m[4]}`);
    fixes.push(`Fix the type error at ${m[1]}:${m[2]}`);
  }
  if (problems.length === 0) {
    problems.push(...tail(`${r.stdout}\n${r.stderr}`, 5));
    fixes.push("pnpm exec tsc --noEmit");
  }
  return { step: "tsc", problems, fixes };
}

/** New src files the classifier leaves unclassified and the default-deny inventory does not list. */
export function unclassifiedNewSrc(root: string): string[] {
  const inventoryPath = path.join(root, "tests/fixtures/authority-unclassified-src-inventory.json");
  const inventory: Record<string, unknown> = existsSync(inventoryPath) ? JSON.parse(readFileSync(inventoryPath, "utf8")).entries ?? {} : {};
  return (listSourceFiles(root) as string[]).filter((p) => classifyAuthorityPaths([p]).length === 0 && !inventory[p]);
}

export function checkClassification(root: string, run: CommandRunner): PreprFailure | null {
  const missing = unclassifiedNewSrc(root);
  if (missing.length > 0) {
    return {
      step: "tests/authority-classifier-coverage.test.ts",
      problems: missing.map((f) => `${f} is not classified in src/decisions/batchMerge.ts`),
      fixes: missing.map((f) => `Add to EXACT in src/decisions/batchMerge.ts (most restrictive): "${f}": "operator_authority",`),
    };
  }
  const r = run("pnpm", ["exec", "vitest", "run", "tests/authority-classifier-coverage.test.ts"], root);
  if (r.status === 0) return null;
  return {
    step: "tests/authority-classifier-coverage.test.ts",
    problems: tail(`${r.stdout}\n${r.stderr}`, 8),
    fixes: ["pnpm exec vitest run tests/authority-classifier-coverage.test.ts (classify the named file in src/decisions/batchMerge.ts, or run node scripts/discover-gate-modules.mjs --inventory)"],
  };
}

function checkScript(root: string, run: CommandRunner, script: string, fix: string): PreprFailure | null {
  const r = run("pnpm", [script], root);
  if (r.status === 0) return null;
  return { step: script, problems: tail(`${r.stdout}\n${r.stderr}`, 8), fixes: [fix] };
}

/** Runs the steps in order and returns the first failure, or null when all pass. */
export function runPrePr(root: string, options: PrePrOptions = {}): PreprFailure | null {
  const run = options.run ?? defaultRun;
  const base = options.base ?? "origin/main";
  const steps: Array<() => PreprFailure | null> = [
    () => checkGuidance(root, run),
    () => checkLint(root, run, options.changedFiles ?? changedLintFiles(root, run, base)),
    () => checkTsc(root, run),
    () => checkClassification(root, run),
    () => checkScript(root, run, "check:operator-scripts", "Regenerate or fix the operator script named in the output, then rerun pnpm check:operator-scripts"),
    () => checkScript(root, run, "check:plan-close-outs", "Add or correct the close-out for the plan named in the output, then rerun pnpm check:plan-close-outs"),
    () => checkScript(root, run, "check:frozen-records", "Revert the edit to the frozen record named in the output (frozen records are append-only), then rerun pnpm check:frozen-records"),
  ];
  for (const step of steps) {
    const failure = step();
    if (failure) return failure;
  }
  return null;
}

export function renderFailure(failure: PreprFailure): string {
  const lines = [`pre-pr FAILED at ${failure.step}`];
  for (const p of failure.problems) lines.push(`  problem: ${p}`);
  for (const f of failure.fixes) lines.push(`  fix: ${f}`);
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failure = runPrePr(process.cwd());
  if (failure) {
    process.stderr.write(renderFailure(failure));
    process.exitCode = 1;
  } else {
    process.stdout.write("pre-pr passed\n");
  }
}
