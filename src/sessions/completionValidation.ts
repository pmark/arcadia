import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
 * runner (vitest when its package.json declares it, otherwise `node --test`
 * for plain JavaScript test files), under the same macOS Seatbelt
 * confinement preservation uses (immutable source tree, private scratch, no
 * network, the workspace, repository and worktree unreadable). The only
 * additional read it grants is the installed `node_modules` trees, so the
 * named tests can resolve their imports.
 *
 * It runs only when the criteria name a test file: the configured commands
 * alone are already preservation's gate. Anything that is not a clean pass --
 * a failing test or command, a missing or unsupported runner, a timeout, an
 * unsupported host, a named file the candidate does not carry -- is a refusal
 * with a named reason, never a pass.
 *
 * Trust boundary: this catches a candidate whose named tests honestly fail
 * (the live #1595 shape). It does not defend against a candidate that rigs
 * its own runner configuration, which it controls just as it controls the
 * named test file; the independent review gate remains that defense.
 */

/**
 * Bound on the whole validation. One named file runs in one vitest worker
 * however many are allowed, so the bound must exceed the slowest single file
 * an Action names: tests/review-repair-loop.test.ts took 360s on the host
 * (2026-10-20 pre-mortem), so 300s refused every honest completion of an
 * Action naming it. It stays well under the worker's tick ceiling
 * (MAX_TICK_DURATION_MS, 30 minutes), which this synchronous step counts toward.
 */
export const COMPLETION_VALIDATION_TIMEOUT_MS = 900_000;
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
  /** Bound on the whole validation (configured commands and named tests together). */
  timeoutMs?: number;
  /**
   * Tests only, never production: run the identical checks against the
   * identical materialized tree without the Seatbelt profile around them, for
   * hosts where `sandbox-exec` is unavailable or cannot nest -- the same seam
   * the rehearsal harness's `unsandboxedValidator` gives preservation.
   */
  unconfinedForTests?: boolean;
}

export interface CompletionValidationCandidate {
  repository: string;
  worktree: string;
  base: string;
  /** The workspace; candidate code must never read it. */
  workspace: string | undefined;
  /** The Project's configured validation commands (host-managed metadata). */
  commands: string[];
  acceptanceCriteria: string[];
}

export type CompletionValidationResult =
  | { status: "not_required" }
  | { status: "passed"; namedTests: string[]; commands: string[]; durationMs: number }
  | {
      status: "refused"; namedTests: string[]; reason: string; failures: string[];
      /** Issue #1613: the validation could not run here (timeout, unsupported host, missing runner, unlinkable dependencies); the candidate may be fine, so only the operator can fix it. */
      hostFault: boolean;
    };

// A repository-relative test file path: under `tests/`, `test/` or a
// workspace package's `tests/`, ending `.test.<ts|tsx|mts|js|mjs|cjs>`, made
// only of plain path characters. Anything looser is not treated as a named file.
const NAMED_TEST_FILE = /(?<![\w./-])((?:tests?|apps\/[A-Za-z0-9._-]+\/tests?|packages\/[A-Za-z0-9._-]+\/tests?)\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.test\.(?:ts|tsx|mts|js|mjs|cjs))(?![\w/-])/g;
const REMOVAL_VERB = String.raw`(?:remov(?:e|es|ed|ing|al)|delet(?:e|es|ed|ing|ion))`;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether the criterion removes this very file ("removes tests/x.test.ts", "tests/x.test.ts is deleted"), which names it without requiring it to pass. */
function removes(criterion: string, file: string): boolean {
  const name = escapeRegExp(file);
  return new RegExp(String.raw`\b${REMOVAL_VERB}\s+(?:of\s+)?(?:the\s+)?(?:file\s+)?['"\x60]?${name}`, "i").test(criterion)
    || new RegExp(String.raw`${name}['"\x60]?\s+(?:is|are|was|were|gets|will\s+be)\s+${REMOVAL_VERB}\b`, "i").test(criterion);
}

/** The test files an Action's acceptance criteria name explicitly (and do not remove), in first-mention order. */
export function namedTestFiles(criteria: readonly string[]): string[] {
  const found: string[] = [];
  for (const criterion of criteria) {
    for (const match of criterion.matchAll(NAMED_TEST_FILE)) {
      const file = match[1];
      if (file.split("/").some((segment) => segment === "." || segment === "..")) continue;
      if (removes(criterion, file)) continue;
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
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replaceAll("`", "'").replaceAll("@", "@​").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function refused(namedTests: string[], why: string, failures: string[] = [], hostFault = false): CompletionValidationResult {
  const listed = failures.slice(0, MAX_REPORTED_FAILURES).map((failure) => untrusted(failure));
  const more = failures.length > listed.length ? ` (and ${failures.length - listed.length} more)` : "";
  const detail = listed.length ? ` Failing: ${listed.map((failure) => `"${failure}"`).join("; ")}${more}.` : "";
  const reason = `${why}${detail}`;
  return { status: "refused", namedTests, failures: listed, hostFault,
    reason: reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS - 1)}…` : reason };
}

function inside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/** Refuse a path below `source` that passes through a symlink: the candidate chose every symlink in its tree. */
function assertNoSymlinkBelow(source: string, relative: string): void {
  let current = source;
  for (const segment of relative.split("/").filter(Boolean)) {
    current = path.join(current, segment);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`the candidate's ${relative} passes through a symlink`);
  }
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
 * candidate's own package code is what resolves. Only entries that resolve
 * inside a `node_modules` tree (never into the workspace) are linked. Returns
 * the real paths the sandbox may read.
 */
function bridgeDependencies(dependencyRoot: string, source: string, scratch: string, forbidden: string[]): string[] {
  const root = realpathSync(dependencyRoot);
  const members = workspaceMembers(root);
  const memberRoots = new Map(members.map((member) => [path.join(root, member), member]));
  const readable = new Set<string>();
  const allowed = (resolved: string) => resolved.split(path.sep).includes("node_modules") && !forbidden.some((dir) => inside(dir, resolved));
  for (const member of members) {
    const installed = path.join(root, member, "node_modules");
    if (!existsSync(installed)) continue;
    // These writes run outside the sandbox: never through a candidate symlink.
    assertNoSymlinkBelow(source, path.posix.join(member, "node_modules"));
    const sourceMember = path.join(source, member);
    if (member && !existsSync(sourceMember)) continue;
    if (!inside(source, realpathSync(sourceMember))) throw new Error(`the candidate's ${member} resolves outside its tree`);
    const linkPath = path.join(sourceMember, "node_modules");
    if (lstatSync(linkPath, { throwIfNoEntry: false })) throw new Error(`the candidate tracks ${path.posix.join(member, "node_modules")}`);
    const bridged = path.join(scratch, "dependencies", member, "node_modules");
    mkdirSync(bridged, { recursive: true });
    const installedReal = realpathSync(installed);
    if (allowed(installedReal)) readable.add(installedReal);
    const link = (from: string, to: string) => {
      let resolved: string;
      try { resolved = realpathSync(from); } catch { return; }
      const self = memberRoots.get(resolved);
      if (self !== undefined) { symlinkSync(path.join(source, self), to); return; }
      if (!allowed(resolved)) return;
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

/** Whether the candidate's own manifest declares vitest. */
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

// Runs the command in its own process group, output discarded so no
// descendant holds the host's pipes, and kills the whole group at the bound.
const WATCHDOG = String.raw`
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const [marker, timeoutMs, ...argv] = process.argv.slice(1);
const child = spawn(argv[0], argv.slice(1), { stdio: "ignore", detached: true });
const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} };
const timer = setTimeout(() => { writeFileSync(marker, "timeout"); kill(); }, Number(timeoutMs));
child.on("error", (error) => { clearTimeout(timer); process.stderr.write(String(error && error.message)); process.exit(127); });
child.on("exit", (code) => { clearTimeout(timer); kill(); process.exit(code === null ? 128 : code); });
`;

/** Run the Action's declared validation against the candidate's exact tree. Synchronous, bounded by `timeoutMs` in total. */
export function validateCompletionCandidate(candidate: CompletionValidationCandidate, given: CompletionValidationOptions = {}): CompletionValidationResult {
  // The unconfined seam exists for test runs only; anywhere else it is ignored.
  const options = given.unconfinedForTests && !process.env.VITEST ? { ...given, unconfinedForTests: false } : given;
  const namedTests = namedTestFiles(candidate.acceptanceCriteria);
  if (namedTests.length === 0) return { status: "not_required" };
  const deny = (why: string, failures: string[] = []) => refused(namedTests, `Pre-acceptance validation refused the completion: ${why}`, failures);
  // A refusal the candidate cannot fix: the validation could not run on this host (Issue #1613).
  const unavailable = (why: string, failures: string[] = []) => refused(namedTests, `Pre-acceptance validation refused the completion: ${why}`, failures, true);
  if (namedTests.length > MAX_NAMED_TEST_FILES) return deny(`the acceptance criteria name ${namedTests.length} test files; at most ${MAX_NAMED_TEST_FILES} run before acceptance.`);
  if (process.platform !== "darwin" && !options.unconfinedForTests) return unavailable("protected candidate validation requires the macOS Seatbelt host.");
  if (!candidate.workspace) return unavailable("the workspace was not given, so candidate code could not be kept from reading it.");
  if (!candidate.commands.length) return unavailable("the Project declares no validation commands.");
  const timeoutMs = options.timeoutMs ?? COMPLETION_VALIDATION_TIMEOUT_MS;
  const deadline = performance.now() + timeoutMs;

  let tree: string;
  try {
    tree = snapshotCandidate(candidate.worktree, candidate.base);
    // A check the candidate rewrote cannot judge it.
    bindCheckDefinitions(candidate.repository, candidate.base, tree, candidate.commands);
  } catch (error) {
    return unavailable(`the candidate could not be captured for validation (${untrusted(normalizeError(error).message, 300)}).`);
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
      return unavailable(`the candidate tree could not be materialized (${untrusted(normalizeError(error).message, 300)}).`);
    }
    const missing = namedTests.filter((file) => !lstatSync(path.join(source, file), { throwIfNoEntry: false })?.isFile());
    if (missing.length) return deny("the candidate does not contain every test file its acceptance criteria name.", missing.map((file) => `${file} (missing)`));
    const vitest = declaresVitest(source);
    if (!vitest && !namedTests.every((file) => /\.(?:js|mjs|cjs)$/.test(file))) {
      return unavailable("the Project's package.json declares no supported test runner for its named TypeScript tests (vitest).");
    }
    const forbidden = [candidate.workspace, candidate.repository, candidate.worktree].map((dir) => realpathSync(dir));
    let readable: string[] = [];
    if (vitest) {
      try {
        readable = bridgeDependencies(options.dependencyRoot ?? candidate.repository, source, scratch, [forbidden[0]]);
      } catch (error) {
        return unavailable(`the Project's installed dependencies could not be linked (${untrusted(normalizeError(error).message, 300)}).`);
      }
    }
    const runner = path.join(source, "node_modules", "vitest", "vitest.mjs");
    if (vitest && !existsSync(runner)) return unavailable("the Project's test runner (vitest) is not installed in its checkout; install its dependencies there.");

    const quote = (value: string) => JSON.stringify(value);
    // Unreadable: the workspace, repository, worktree, dependency checkout and
    // the host user's whole home directory (other checkouts, ~/.arcadia,
    // credentials). Re-allowed below only: the installed dependency trees and
    // the running Node installation, should it live under the home.
    const home = realpathSync(homedir());
    const denied = [...forbidden, realpathSync(options.dependencyRoot ?? candidate.repository), home]
      .map((dir) => `(require-not (subpath ${quote(dir)}))`).join(" ");
    const nodePrefix = path.dirname(path.dirname(realpathSync(process.execPath)));
    // Only a Node-specific prefix (a version manager's `.../node/<version>` or
    // a `node`/`nodejs` directory), never a general one such as `~/.local`.
    if (inside(home, nodePrefix) && /^(?:node|nodejs|v?\d+(?:\.\d+){0,2})$/.test(path.basename(nodePrefix))) readable.push(nodePrefix);
    if (readable.some((dir) => forbidden.slice(0, 1).some((workspace) => inside(workspace, dir)))) return unavailable("a dependency tree resolves inside the workspace.");
    // `signal (target same-sandbox)`: a runner terminates its own workers;
    // nothing outside this sandbox (the watchdog included) is reachable.
    const profile = `(version 1) (deny default) (allow file-read-metadata) (allow file-read* (subpath ${quote(source)}) (subpath ${quote(scratch)}) (require-all ${denied})) `
      + (readable.length ? `(allow file-read* ${readable.map((dir) => `(subpath ${quote(dir)})`).join(" ")}) ` : "")
      + `(allow process-exec) (allow process-fork) (allow sysctl-read) (allow signal (target same-sandbox)) (allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null"))`;
    const env: NodeJS.ProcessEnv = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch, TMPDIR: scratch, NODE_ENV: "test", CI: "1" };
    const run = (argv: string[], bound: number) => {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) return { status: null, timedOut: true, error: null };
      const limit = Math.min(bound, remaining);
      rmSync(marker, { force: true });
      const confined = options.unconfinedForTests ? argv : ["/usr/bin/sandbox-exec", "-p", profile, ...argv];
      const result = spawnSync(process.execPath, ["-e", WATCHDOG, marker, String(limit), ...confined], {
        cwd: source, env, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: limit + 30_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024
      });
      const timedOut = existsSync(marker) || spawnTimedOut(result.error);
      const error = result.error && !timedOut ? normalizeError(result.error).message : result.status === 127 ? (result.stderr || "the command could not start") : null;
      return { status: result.status, timedOut, error };
    };
    const timedOutWhy = `the validation did not finish within ${Math.round(timeoutMs / 1000)}s.`;

    for (const command of candidate.commands) {
      const result = run(["/bin/sh", "-c", command], COMPLETION_COMMAND_TIMEOUT_MS);
      if (result.timedOut) return unavailable(timedOutWhy, [`${command} (timed out)`]);
      if (result.error) return unavailable(`the configured validation command could not run (${untrusted(result.error, 200)}).`, [command]);
      if (result.status !== 0) return deny(`the configured validation command exited ${result.status}.`, [command]);
    }

    if (!vitest) {
      // Plain JavaScript tests: Node's own runner, one file at a time so each
      // proves it ran and passed at least one test.
      for (const file of namedTests) {
        const report = path.join(scratch, `completion-node-test-${namedTests.indexOf(file)}.tap`);
        const result = run([process.execPath, "--test", "--test-reporter=tap", `--test-reporter-destination=${report}`, file], COMPLETION_VALIDATION_TIMEOUT_MS);
        if (result.timedOut) return unavailable(timedOutWhy, [`${file} (timed out)`]);
        if (result.error) return unavailable(`the named tests could not run (${untrusted(result.error, 200)}).`);
        let tap = "";
        try { tap = readFileSync(report, "utf8"); } catch { tap = ""; }
        const failing = [...tap.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => `${file} > ${match[1]}`);
        if (result.status !== 0) return deny(`the named tests failed (node --test exited ${result.status}).`, failing.length ? failing : [file]);
        if (!/^# pass [1-9]\d*$/m.test(tap) || !/^# fail 0$/m.test(tap)) return deny("node --test exited 0 but did not report a passing test for every named file.", [file]);
      }
      return { status: "passed", namedTests, commands: candidate.commands, durationMs: Math.round(performance.now() - startedAt) };
    }

    const report = path.join(scratch, "completion-vitest-report.json");
    const result = run([process.execPath, runner, "run", ...namedTests, "--maxWorkers=2", "--reporter=json", `--outputFile.json=${report}`], COMPLETION_VALIDATION_TIMEOUT_MS);
    if (result.timedOut) return unavailable(timedOutWhy, namedTests.map((file) => `${file} (timed out)`));
    if (result.error) return unavailable(`the named tests could not run (${untrusted(result.error, 200)}).`);
    let parsed: VitestReport | null = null;
    try { parsed = JSON.parse(readFileSync(report, "utf8")) as VitestReport; } catch { parsed = null; }
    const relativeName = (name: string | undefined) => name ? path.relative(source, name).split(path.sep).join("/") : "(unknown file)";
    const failures: string[] = [];
    for (const file of parsed?.testResults ?? []) {
      const failed = (file.assertionResults ?? []).filter((test) => test.status === "failed");
      for (const test of failed) failures.push(`${relativeName(file.name)} > ${test.fullName ?? test.title ?? "(unnamed test)"}`);
      if (!failed.length && file.status === "failed") failures.push(`${relativeName(file.name)} (${file.message ? untrusted(file.message, 120) : "failed to run"})`);
    }
    if (result.status !== 0) return deny(`the named tests failed (vitest exited ${result.status}).`, failures.length ? failures : namedTests);
    // A zero exit proves only that nothing failed: every named file must
    // also have run and passed at least one test.
    const ran = new Map((parsed?.testResults ?? []).map((file) => [relativeName(file.name), file]));
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
