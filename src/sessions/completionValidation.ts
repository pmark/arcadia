import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { normalizeError } from "../cli/errors.js";
import { materializeCandidateTree, snapshotCandidate } from "./candidateSnapshot.js";
import { bindCheckDefinitions } from "./preservationCheckBinding.js";

/**
 * Issue #1599: a Session's drafted completion was accepted while the test
 * file its own acceptance criteria named failed -- the tests never ran before
 * acceptance. This is the host's check that runs, before a drafted `complete`
 * Ask is settled, the Action's declared validation against the candidate's
 * exact tree: the Project's configured validation commands and every test
 * file the Action's acceptance criteria name, through the Project's own test
 * runner (vitest), under the same macOS Seatbelt confinement preservation
 * uses (immutable source tree, private scratch, no network). The only
 * additional read it grants is the Project checkout's installed dependency
 * trees, so the named tests can resolve their imports.
 *
 * It runs only when the criteria name a test file: the configured commands
 * alone are already preservation's gate. Anything that is not a clean pass --
 * a failing test or command, a missing runner, a timeout, an unsupported
 * host, a named file the candidate does not carry -- is a refusal with a
 * named reason, never a pass.
 */

export const COMPLETION_TEST_TIMEOUT_MS = 300_000;
export const COMPLETION_COMMAND_TIMEOUT_MS = 120_000;
export const MAX_NAMED_TEST_FILES = 10;
const MAX_REPORTED_FAILURES = 10;
const MAX_NAME_CHARS = 200;
const MAX_REASON_CHARS = 1_500;

/** Whether spawnSync stopped a process at its own timeout (`checkTimedOut` in preservationValidation.ts; not imported, that module imports this one's caller). */
function spawnTimedOut(error: Error | undefined): boolean {
  return error !== undefined && "code" in error && error.code === "ETIMEDOUT";
}

export interface CompletionValidationOptions {
  /** The checkout whose installed `node_modules` trees the named tests resolve against. Defaults to the Session's repository. */
  dependencyRoot?: string;
  /** Bound on the named-test run. */
  testTimeoutMs?: number;
}

export interface CompletionValidationCandidate {
  repository: string;
  worktree: string;
  base: string;
  /** The Project's configured validation commands (host-managed metadata). */
  commands: string[];
  acceptanceCriteria: string[];
}

export type CompletionValidationResult =
  | { status: "not_required" }
  | { status: "passed"; namedTests: string[]; commands: string[]; durationMs: number }
  | { status: "refused"; namedTests: string[]; reason: string; failures: string[] };

// A repository-relative test file path: under `tests/`, `test/` or a
// workspace package's `tests/`, ending `.test.<ts|tsx|mts|js|mjs>`, made only
// of plain path characters. Anything looser is not treated as a named file.
const NAMED_TEST_FILE = /(?<![\w./-])((?:tests?|apps\/[A-Za-z0-9._-]+\/tests?|packages\/[A-Za-z0-9._-]+\/tests?)\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.test\.(?:ts|tsx|mts|js|mjs))(?![\w/-])/g;

/** The test files an Action's acceptance criteria name explicitly, in first-mention order. */
export function namedTestFiles(criteria: readonly string[]): string[] {
  const found: string[] = [];
  for (const criterion of criteria) {
    for (const match of criterion.matchAll(NAMED_TEST_FILE)) {
      const file = match[1];
      if (file.split("/").some((segment) => segment === "." || segment === "..")) continue;
      if (!found.includes(file)) found.push(file);
    }
  }
  return found;
}

/**
 * Untrusted text (test names and messages are whatever the candidate's code
 * chose) is bounded and neutralized before it reaches a receipt or a resumed
 * brief, by the same rules as `neutralizeCiText` (#1598, not imported: that
 * module depends on this one's caller): no control characters, no code-span
 * backticks, no mentions.
 */
function untrusted(text: string, max = MAX_NAME_CHARS): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replaceAll("`", "'").replaceAll("@", "@\u200b").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function refused(namedTests: string[], why: string, failures: string[] = []): CompletionValidationResult {
  const listed = failures.slice(0, MAX_REPORTED_FAILURES).map((failure) => untrusted(failure));
  const more = failures.length > listed.length ? ` (and ${failures.length - listed.length} more)` : "";
  const detail = listed.length ? ` Failing: ${listed.map((failure) => `"${failure}"`).join("; ")}${more}.` : "";
  const reason = `${why}${detail}`;
  return { status: "refused", namedTests, failures: listed,
    reason: reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS - 1)}…` : reason };
}

/** pnpm's own module-resolution metadata: the only dotfiles bridged (a tool cache such as `.vite-temp` stays private to the run). */
const PNPM_METADATA_ENTRIES = new Set([".bin", ".pnpm", ".modules.yaml", ".pnpm-workspace-state-v1.json"]);

/** Workspace member directories (relative, "" for the root) from `pnpm-workspace.yaml`'s plain `- path` entries. */
function workspaceMembers(root: string): string[] {
  const members = [""];
  try {
    const section = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8").match(/^packages:\n((?:[ \t]+-.*\n?)*)/m);
    for (const line of section?.[1].split("\n") ?? []) {
      const member = /^\s*-\s*["']?([A-Za-z0-9._/-]+?)["']?\s*$/.exec(line)?.[1];
      if (member && !member.includes("*") && !member.split("/").includes("..")) members.push(member);
    }
  } catch { /* no workspace file: the root alone */ }
  return members;
}

/**
 * Link the dependency root's installed trees into the run: each
 * `<member>/node_modules` becomes a real directory in the writable scratch
 * (so a runner's cache lands there, never in the Project checkout), linked
 * from the materialized source, holding symlinks to the installed entries. A
 * workspace self-reference is retargeted at the materialized member, so the
 * candidate's own package code is what resolves. Returns the real paths the
 * sandbox may read.
 */
function bridgeDependencies(dependencyRoot: string, source: string, scratch: string): string[] {
  const root = realpathSync(dependencyRoot);
  const members = workspaceMembers(root);
  const memberRoots = new Map(members.map((member) => [path.join(root, member), member]));
  const readable = new Set<string>();
  for (const member of members) {
    const installed = path.join(root, member, "node_modules");
    if (!existsSync(installed)) continue;
    const sourceMember = path.join(source, member);
    if (member && !existsSync(sourceMember)) continue;
    const linkPath = path.join(sourceMember, "node_modules");
    if (lstatSync(linkPath, { throwIfNoEntry: false })) throw new Error(`the candidate tracks ${path.join(member, "node_modules")}`);
    const bridged = path.join(scratch, "dependencies", member, "node_modules");
    mkdirSync(bridged, { recursive: true });
    readable.add(realpathSync(installed));
    const link = (from: string, to: string) => {
      let resolved: string;
      try { resolved = realpathSync(from); } catch { return; }
      const self = memberRoots.get(resolved);
      if (self !== undefined) { symlinkSync(path.join(source, self), to); return; }
      symlinkSync(resolved, to);
      // pnpm's virtual store holds every resolved package; allow it whole.
      const store = resolved.lastIndexOf(`${path.sep}.pnpm${path.sep}`);
      readable.add(store >= 0 ? resolved.slice(0, store + "/.pnpm".length) : resolved);
    };
    for (const entry of readdirSync(installed, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && !PNPM_METADATA_ENTRIES.has(entry.name)) continue;
      const from = path.join(installed, entry.name);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        mkdirSync(path.join(bridged, entry.name), { recursive: true });
        for (const scoped of readdirSync(from)) link(path.join(from, scoped), path.join(bridged, entry.name, scoped));
      } else {
        link(from, path.join(bridged, entry.name));
      }
    }
    symlinkSync(bridged, linkPath);
  }
  return [...readable];
}

/** Whether the candidate's own manifest declares vitest, the one test runner this check supports. */
function declaresVitest(source: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")) as Record<string, unknown>;
    return ["devDependencies", "dependencies"].some((field) => {
      const deps = manifest[field];
      return typeof deps === "object" && deps !== null && "vitest" in deps;
    });
  } catch {
    return false;
  }
}

interface VitestReport {
  testResults?: Array<{ name?: string; status?: string; message?: string;
    assertionResults?: Array<{ fullName?: string; title?: string; status?: string }> }>;
}

// Runs the sandboxed command in its own process group and kills the whole
// group at the bound, so a runner's worker processes cannot outlive it.
const WATCHDOG = String.raw`
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const [marker, timeoutMs, ...argv] = process.argv.slice(1);
const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", detached: true });
const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} };
const timer = setTimeout(() => { writeFileSync(marker, "timeout"); kill(); }, Number(timeoutMs));
child.on("error", (error) => { clearTimeout(timer); process.stderr.write(String(error && error.message)); process.exit(127); });
child.on("exit", (code, signal) => { clearTimeout(timer); kill(); process.exit(code === null ? 128 : code); });
`;

/**
 * Run the Action's declared validation against the candidate's exact tree.
 * Synchronous and bounded: the configured commands at preservation's own
 * per-command bound, the named tests at `testTimeoutMs`.
 */
export function validateCompletionCandidate(candidate: CompletionValidationCandidate, options: CompletionValidationOptions = {}): CompletionValidationResult {
  const namedTests = namedTestFiles(candidate.acceptanceCriteria);
  if (namedTests.length === 0) return { status: "not_required" };
  const deny = (why: string, failures: string[] = []) => refused(namedTests, `Pre-acceptance validation refused the completion: ${why}`, failures);
  if (namedTests.length > MAX_NAMED_TEST_FILES) return deny(`the acceptance criteria name ${namedTests.length} test files; at most ${MAX_NAMED_TEST_FILES} run before acceptance.`);
  if (process.platform !== "darwin") return deny("protected candidate validation requires the macOS Seatbelt host.");
  if (!candidate.commands.length) return deny("the Project declares no validation commands.");
  const testTimeoutMs = options.testTimeoutMs ?? COMPLETION_TEST_TIMEOUT_MS;

  let tree: string;
  try {
    tree = snapshotCandidate(candidate.worktree, candidate.base);
    // A check the candidate rewrote cannot judge it.
    bindCheckDefinitions(candidate.repository, candidate.base, tree, candidate.commands);
  } catch (error) {
    return deny(`the candidate could not be captured for validation (${untrusted(normalizeError(error).message, 300)}).`);
  }
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-completion-")));
  const source = path.join(root, "source");
  const scratch = path.join(root, "scratch");
  const marker = path.join(root, "timeout");
  mkdirSync(source); mkdirSync(scratch);
  const startedAt = performance.now();
  try {
    try {
      materializeCandidateTree(candidate.repository, tree, source);
    } catch (error) {
      return deny(`the candidate tree could not be materialized (${untrusted(normalizeError(error).message, 300)}).`);
    }
    const missing = namedTests.filter((file) => !lstatSync(path.join(source, file), { throwIfNoEntry: false })?.isFile());
    if (missing.length) return deny("the candidate does not contain every test file its acceptance criteria name.", missing.map((file) => `${file} (missing)`));
    if (!declaresVitest(source)) return deny("the Project's package.json declares no supported test runner (vitest).");
    let readable: string[];
    try {
      readable = bridgeDependencies(options.dependencyRoot ?? candidate.repository, source, scratch);
    } catch (error) {
      return deny(`the Project's installed dependencies could not be linked (${untrusted(normalizeError(error).message, 300)}).`);
    }
    const runner = path.join(source, "node_modules", "vitest", "vitest.mjs");
    if (!existsSync(runner)) return deny("the Project's test runner (vitest) is not installed in its checkout; install its dependencies there.");

    const quote = (value: string) => JSON.stringify(value);
    const denied = [candidate.repository, candidate.worktree, options.dependencyRoot ?? candidate.repository]
      .map((dir) => `(require-not (subpath ${quote(realpathSync(dir))}))`).join(" ");
    const profile = `(version 1) (deny default) (allow file-read-metadata) (allow file-read* (subpath ${quote(source)}) (subpath ${quote(scratch)}) (require-all ${denied})) `
      + `(allow file-read* ${readable.map((dir) => `(subpath ${quote(dir)})`).join(" ")}) `
      + `(allow process-exec) (allow process-fork) (allow sysctl-read) (allow signal (target same-sandbox)) (allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null"))`;
    const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch, TMPDIR: scratch, NODE_ENV: "test", CI: "1" };
    const run = (argv: string[], timeoutMs: number) => {
      rmSync(marker, { force: true });
      const result = spawnSync(process.execPath, ["-e", WATCHDOG, marker, String(timeoutMs), "/usr/bin/sandbox-exec", "-p", profile, ...argv], {
        cwd: source, env, encoding: "utf8", timeout: timeoutMs + 30_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024
      });
      return { status: result.status, timedOut: existsSync(marker) || spawnTimedOut(result.error), error: result.error ? normalizeError(result.error).message : null };
    };

    for (const command of candidate.commands) {
      const result = run(["/bin/sh", "-c", command], COMPLETION_COMMAND_TIMEOUT_MS);
      if (result.timedOut) return deny(`the configured validation command timed out after ${COMPLETION_COMMAND_TIMEOUT_MS / 1000}s.`, [command]);
      if (result.error) return deny(`the configured validation command could not run (${untrusted(result.error, 200)}).`, [command]);
      if (result.status !== 0) return deny(`the configured validation command exited ${result.status}.`, [command]);
    }

    const report = path.join(scratch, "completion-vitest-report.json");
    const result = run([process.execPath, runner, "run", ...namedTests, "--maxWorkers=2", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`], testTimeoutMs);
    if (result.error && !result.timedOut) return deny(`the named tests could not run (${untrusted(result.error, 200)}).`);
    if (result.timedOut) return deny(`the named tests did not finish within ${Math.round(testTimeoutMs / 1000)}s.`, namedTests.map((file) => `${file} (timed out)`));
    let parsed: VitestReport | null = null;
    try { parsed = JSON.parse(readFileSync(report, "utf8")) as VitestReport; } catch { parsed = null; }
    const failures: string[] = [];
    for (const file of parsed?.testResults ?? []) {
      const relative = file.name ? path.relative(source, file.name).split(path.sep).join("/") : "(unknown file)";
      const failed = (file.assertionResults ?? []).filter((test) => test.status === "failed");
      for (const test of failed) failures.push(`${relative} > ${test.fullName ?? test.title ?? "(unnamed test)"}`);
      if (!failed.length && file.status === "failed") failures.push(`${relative} (${file.message ? untrusted(file.message, 120) : "failed to run"})`);
    }
    if (result.status !== 0) {
      return deny(`the named tests failed (vitest exited ${result.status}).`, failures.length ? failures : namedTests);
    }
    // A zero exit proves only that nothing failed: every named file must
    // also have run and passed at least one test.
    const ran = new Map((parsed?.testResults ?? []).map((file) => [file.name ? path.relative(source, file.name).split(path.sep).join("/") : "", file]));
    const unproven = namedTests.filter((file) => {
      const entry = ran.get(file);
      return !entry || entry.status !== "passed" || !(entry.assertionResults ?? []).some((test) => test.status === "passed");
    });
    if (unproven.length) return deny("vitest exited 0 but did not report a passing test for every named file.", unproven);
    return { status: "passed", namedTests, commands: candidate.commands, durationMs: Math.round(performance.now() - startedAt) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
