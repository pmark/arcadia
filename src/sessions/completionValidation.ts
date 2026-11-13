import { writeCompletionEvidence, completionEvidenceText, type CompletionEvidenceBinding, type CompletionEvidenceReference, type CompletionEvidenceRecord, type CompletionExecution } from "./completionValidationEvidence.js";
import { runOwnedValidation } from "./preservationProcessLifecycle.js";
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
 * exact tree: the Project's configured validation commands, exact criteria-required
 * lint/TypeScript checks, and every test
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

/** Exact extra checks required by named-test criteria, never shell text copied from a criterion. */
export function criteriaValidationCommands(criteria: readonly string[]): string[] {
  if (!namedTestFiles(criteria).length) return [];
  const required = criteria.filter((criterion) =>
    /\bpass(?:es)?\b/i.test(criterion)
    && !/\b(?:not|never|without|optional|skip(?:ped)?|omit(?:ted)?|avoid|example|document|mention|echo|printf)\b/i.test(criterion));
  const commands: string[] = [];
  if (required.some((criterion) => /\bpnpm[ \t]+lint(?=[ \t,]+(?:and[ \t]+)?(?:(?:pnpm[ \t]+exec[ \t]+)?tsc(?:[ \t]+--noEmit)?[ \t]+)?pass(?:es)?\b)/i.test(criterion))) commands.push("pnpm lint");
  if (required.some((criterion) => /(?:^|[\s,;])(?:pnpm[ \t]+exec[ \t]+)?tsc(?:[ \t]+--noEmit)?[ \t]+pass(?:es)?\b/i.test(criterion))) commands.push("pnpm exec tsc --noEmit");
  return commands;
}

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
/**
 * Own bound for each criteria-required command, by its command text (Issue
 * #1765). Lint gets 240s: the separately bounded, independently reviewed C-only
 * run passed `pnpm lint` in 127452ms under that limit, after an earlier
 * attempt at the 120s per-command bound timed out (docs/managed-production-readiness.md).
 * tsc keeps the 120s bound it passed in 9803ms under. Any other command keeps
 * COMPLETION_COMMAND_TIMEOUT_MS.
 */
export const COMPLETION_REQUIRED_COMMAND_TIMEOUT_MS: Readonly<Record<string, number>> = {
  "pnpm lint": 240_000,
  "pnpm exec tsc --noEmit": COMPLETION_COMMAND_TIMEOUT_MS,
};
export const MAX_NAMED_TEST_FILES = 10;
const MAX_REPORTED_FAILURES = 10;
const MAX_NAME_CHARS = 200;
const MAX_REASON_CHARS = 1_500;

export interface CompletionValidationOptions {
  /** The checkout whose installed `node_modules` trees the named tests resolve against. Defaults to the Session's repository. */
  dependencyRoot?: string;
  /** Host receipt propagation only; never passed into candidate processes. */
  onEvidence?: (reference: CompletionEvidenceReference) => void;
  /** Bound on the whole validation (configured commands and named tests together). */
  timeoutMs?: number;
  /** Bound per criteria-required command, overriding COMPLETION_REQUIRED_COMMAND_TIMEOUT_MS by command text (tests inject a short one). */
  requiredCommandTimeoutMs?: Readonly<Record<string, number>>;
  /**
   * Tests only, never production: run the identical checks against the
   * identical materialized tree without the Seatbelt profile around them, for
   * hosts where `sandbox-exec` is unavailable or cannot nest -- the same seam
   * the rehearsal harness's `unsandboxedValidator` gives preservation.
   */
  unconfinedForTests?: boolean;
}

export interface CompletionValidationCandidate {
  evidenceBinding?: CompletionEvidenceBinding;
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
      /** With `hostFault`: the validation ran out of time rather than failing to start. */
      timedOut?: boolean;
      /** Issue #2519: every failing named test reported only a loopback EPERM denial. The classification comes from a report the candidate can influence, so only the required CI checks on the PR head can prove the completion. */
      loopbackDenied?: boolean;
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

// "returns true for <a>, <b> and <c>", "is false for each of <a> and <b>": the
// items that follow list values an assertion is made about.
const VALUE_LIST = /\b(?:true|false)\s+for\s+(?:each\s+of\s+|all\s+of\s+|every\s+one\s+of\s+)?/gi;
// Only single-token items and their separators may stand between the list's start and the mention...
const LIST_ITEMS_BEFORE = /^(?:[^\s,;]+(?:,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+))*$/;
// ...and the mention must end its item: a separator, or the end of the sentence.
const LIST_ITEM_END = /^(?:,|\s+(?:and|or)\s|[.;](?:\s|$)|$)/;

/**
 * Whether the mention at `index` is data a criterion asserts about rather than
 * a file the change must contain (2026-11-07: "asserts it is false for each of
 * ..., tests/x.test.ts and ./PROJECT.md" refused 26 relaunches as missing): a
 * source location (`tests/a.test.ts:3`, `"at tests/a.test.ts:3:1"`), or an
 * item of a true/false value list. A mention in prose after the list ("true
 * for staged files, so tests/hook.test.ts passes") and a quoted command stay
 * required.
 */
function namedAsData(criterion: string, index: number, file: string): boolean {
  const after = criterion.slice(index + file.length);
  if (/^:\d/.test(after)) return true;
  if (!LIST_ITEM_END.test(after)) return false;
  for (const list of criterion.matchAll(VALUE_LIST)) {
    const start = list.index + list[0].length;
    if (start > index) break;
    if (LIST_ITEMS_BEFORE.test(criterion.slice(start, index))) return true;
  }
  return false;
}

/** The test files an Action's acceptance criteria name explicitly as files (not as data, and not removed), in first-mention order. */
export function namedTestFiles(criteria: readonly string[]): string[] {
  const found: string[] = [];
  for (const criterion of criteria) {
    for (const match of criterion.matchAll(NAMED_TEST_FILE)) {
      const file = match[1];
      if (file.split("/").some((segment) => segment === "." || segment === "..")) continue;
      if (namedAsData(criterion, match.index, file)) continue;
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
export function bridgeCompletionDependencies(dependencyRoot: string, source: string, scratch: string, forbidden: string[]): string[] {
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
    assertionResults?: Array<{ fullName?: string; title?: string; status?: string; failureMessages?: string[] }> }>;
}

/** A failure message whose first line is a non-assertion error for a loopback bind or connect denied by the Seatbelt profile (Issue #2519). An assertion quoting EPERM does not match. */
const LOOPBACK_DENIED = /^(?!AssertionError)\w*Error: (?:listen|connect|bind) EPERM\b/;

/** True when every failing test (or, for a file that failed without a test, its file message) is a loopback denial, so no real assertion failed. */
function failuresAreLoopbackDenials(report: VitestReport | null): boolean {
  const failedFiles = (report?.testResults ?? []).filter((file) => file.status === "failed" || (file.assertionResults ?? []).some((test) => test.status === "failed"));
  if (!failedFiles.length) return false;
  // Only the first line of each message counts: a multi-line message cannot smuggle a denial in below its real error.
  const firstLine = (message: string | undefined) => (message ?? "").split("\n")[0] ?? "";
  return failedFiles.every((file) => {
    const failedTests = (file.assertionResults ?? []).filter((test) => test.status === "failed");
    if (!failedTests.length) return LOOPBACK_DENIED.test(firstLine(file.message));
    return failedTests.every((test) => (test.failureMessages ?? []).length > 0 && (test.failureMessages ?? []).every((message) => LOOPBACK_DENIED.test(firstLine(message))));
  });
}

// Runs the command in its own process group, output discarded so no
// descendant holds the host's pipes, and kills the whole group at the bound.
/** Run the Action's declared validation against the candidate's exact tree. Synchronous, bounded by `timeoutMs` in total. */
function runCompletionValidation(candidate: CompletionValidationCandidate, given: CompletionValidationOptions = {}): CompletionValidationResult {
  // The unconfined seam exists for test runs only; anywhere else it is ignored.
  const options = given.unconfinedForTests && !process.env.VITEST ? { ...given, unconfinedForTests: false } : given;
  const namedTests = namedTestFiles(candidate.acceptanceCriteria);
  const requiredChecks = criteriaValidationCommands(candidate.acceptanceCriteria);
  const commands = [...new Set([...candidate.commands, ...requiredChecks])];
  if (namedTests.length === 0) return { status: "not_required" };
  let outcome: CompletionValidationResult | undefined;
  const finish = (result: CompletionValidationResult) => { outcome = result; return result; };
  const deny = (why: string, failures: string[] = []) => finish(refused(namedTests, `Pre-acceptance validation refused the completion: ${why}`, failures));
  // A timeout is host load or a hung test: counted on its own small budget before it holds (Issue #1613).
  const timeout = (why: string, failures: string[] = []): CompletionValidationResult => ({ ...unavailable(why, failures) as Extract<CompletionValidationResult, { status: "refused" }>, timedOut: true });
  // Host-side only (no workspace or commands, non-darwin, runner not installed, spawn error): the candidate cannot fix it (Issue #1613). Errors from the candidate's own content stay ordinary resumable denials.
  const unavailable = (why: string, failures: string[] = []) => finish(refused(namedTests, `Pre-acceptance validation refused the completion: ${why}`, failures, true));
  if (namedTests.length > MAX_NAMED_TEST_FILES) return deny(`the acceptance criteria name ${namedTests.length} test files; at most ${MAX_NAMED_TEST_FILES} run before acceptance.`);
  if (process.platform !== "darwin" && !options.unconfinedForTests) return unavailable("protected candidate validation requires the macOS Seatbelt host.");
  if (!candidate.workspace) return unavailable("the workspace was not given, so candidate code could not be kept from reading it.");
  if (!candidate.commands.length) return unavailable("the Project declares no validation commands.");
  const timeoutMs = options.timeoutMs ?? COMPLETION_VALIDATION_TIMEOUT_MS;
  const deadline = performance.now() + timeoutMs;
  // A killed capture child is a host stall, never a verdict on the candidate's files (Issue #2084).
  const stopped = (step: string, error: unknown): CompletionValidationResult | null => {
    const failure = normalizeError(error);
    return failure.code === "PRESERVATION_GIT_TIMEOUT"
      ? timeout(`the candidate could not be ${step} because a host process did not finish (${untrusted(failure.message, 300)}). This is a host stall or a hung reader, not a refusal of the candidate's files.`)
      : null;
  };

  let tree: string;
  try {
    tree = snapshotCandidate(candidate.worktree, candidate.base);
    // A check the candidate rewrote cannot judge it.
    // A required lint script is owned by the authorized base, never by its candidate.
    bindCheckDefinitions(candidate.repository, candidate.base, tree, [...commands, ...(requiredChecks.length ? ["node package.json"] : [])]);
  } catch (error) {
    return stopped("captured for validation", error) ?? deny(`the candidate could not be captured for validation (${untrusted(normalizeError(error).message, 300)}).`);
  }
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-completion-")));
  const source = path.join(root, "source");
  const scratch = path.join(root, "scratch");
  const marker = path.join(root, "timeout");
  mkdirSync(source); mkdirSync(scratch);
  const startedAt = performance.now();
  let terminalProven = true;
  const executions: CompletionExecution[] = [];
  const reports: CompletionEvidenceRecord["reports"] = [];
  try {
    try {
      materializeCandidateTree(candidate.repository, tree, source);
    } catch (error) {
      return stopped("materialized", error) ?? deny(`the candidate tree could not be materialized (${untrusted(normalizeError(error).message, 300)}).`);
    }
    const missing = namedTests.filter((file) => !lstatSync(path.join(source, file), { throwIfNoEntry: false })?.isFile());
    if (missing.length) return deny("the candidate does not contain every test file its acceptance criteria name.", missing.map((file) => `${file} (missing)`));
    const vitest = declaresVitest(source);
    if (!vitest && !namedTests.every((file) => /\.(?:js|mjs|cjs)$/.test(file))) {
      return deny("the Project's package.json declares no supported test runner for its named TypeScript tests (vitest).");
    }
    const forbidden = [candidate.workspace, candidate.repository, candidate.worktree].map((dir) => realpathSync(dir));
    let readable: string[] = [];
    if (vitest || requiredChecks.length) {
      try {
        readable = bridgeCompletionDependencies(options.dependencyRoot ?? candidate.repository, source, scratch, [forbidden[0]]);
      } catch (error) {
        return deny(`the Project's installed dependencies could not be linked (${untrusted(normalizeError(error).message, 300)}).`);
      }
    }
    const runner = path.join(source, "node_modules", "vitest", "vitest.mjs");
    if (vitest && !existsSync(runner)) return unavailable("the Project's test runner (vitest) is not installed in its checkout; install its dependencies there.");

    // Corepack in a private HOME may try to download pnpm. Run only the frozen
    // lint script and installed TypeScript entrypoint, with the same dependency
    // tree the named tests use; never grant access to the operator's tool cache.
    const requiredInvocations = new Map<string, string[]>();
    try {
      if (requiredChecks.includes("pnpm lint")) {
        const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
        const lint = manifest.scripts?.lint;
        if (typeof lint !== "string" || !lint.trim()) throw new Error("the authorized manifest declares no lint script");
        if (manifest.scripts?.prelint || manifest.scripts?.postlint) throw new Error("lint lifecycle hooks require a separately supported validation binding");
        requiredInvocations.set("pnpm lint", ["/bin/sh", "-c", lint]);
      }
      if (requiredChecks.includes("pnpm exec tsc --noEmit")) {
        const compiler = path.join(source, "node_modules", "typescript", "bin", "tsc");
        if (!existsSync(compiler)) throw new Error("the Project's TypeScript compiler is not installed");
        requiredInvocations.set("pnpm exec tsc --noEmit", [process.execPath, compiler, "--noEmit"]);
      }
    } catch (error) {
      return unavailable(`the required checks could not be prepared (${untrusted(error instanceof Error ? error.message : normalizeError(error).message, 200)}).`);
    }

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
    if (readable.some((dir) => forbidden.slice(0, 1).some((workspace) => inside(workspace, dir)))) return deny("a dependency tree resolves inside the workspace.");
    // `signal (target same-sandbox)`: a runner terminates its own workers;
    // nothing outside this sandbox (the watchdog included) is reachable.
    const profile = `(version 1) (deny default) (allow file-read-metadata) (allow file-read* (subpath ${quote(source)}) (subpath ${quote(scratch)}) (require-all ${denied})) `
      + (readable.length ? `(allow file-read* ${readable.map((dir) => `(subpath ${quote(dir)})`).join(" ")}) ` : "")
      + `(allow process-exec) (allow process-fork) (allow sysctl-read) (allow signal (target same-sandbox)) (allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null"))`;
    const env: NodeJS.ProcessEnv = { PATH: `${path.join(source, "node_modules", ".bin")}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch, TMPDIR: scratch, NODE_ENV: "test", CI: "1", COREPACK_ENABLE_NETWORK: "0" };
    // The bound a run actually hit: its own command bound, or the whole-validation bound when that is shorter.
    type AppliedBound = { ms: number; kind: "command" | "total"; command: string };
    const run = (argv: string[], bound: number, command: string) => {
      const remaining = Math.floor(deadline - performance.now());
      const applied: AppliedBound = remaining < bound
        ? { ms: timeoutMs, kind: "total", command }
        : { ms: bound, kind: "command", command };
      if (remaining <= 0) return { status: null, timedOut: true, error: null, output: "", bound: applied };
      const limit = Math.min(bound, remaining);
      rmSync(marker, { force: true });
      const confined = options.unconfinedForTests ? argv : ["/usr/bin/sandbox-exec", "-p", profile, ...argv];
      terminalProven = false;
      const commandStarted = performance.now();
      const result = runOwnedValidation({ argv: confined, cwd: source, env, timeoutMs: limit, executionRoot: root, workspace: candidate.workspace });
      terminalProven = result.terminalProven;
      const timedOut = result.timedOut;
      const error = !terminalProven ? "validation descendants have no terminal proof; execution root retained" : result.error ?? null;
      const clean = (text: string) => completionEvidenceText(text.replaceAll(source, "[candidate]").replaceAll(scratch, "[scratch]").replaceAll(root, "[execution]").replaceAll(home, "[home]"));
      executions.push({ command: clean(command), argv: argv.map(clean), exitStatus: result.status, signal: result.signal, timedOut, terminalProven,
        durationMs: Math.round(performance.now() - commandStarted), error: error === null ? null : clean(error), stdout: clean(result.stdout), stderr: clean(result.stderr) });
      return { status: result.status, timedOut, error, output: untrusted(result.stderr || result.stdout, 600), bound: applied };
    };
    // Names the bound the timed-out run actually hit, never the other one.
    const seconds = (ms: number) => Math.round(ms / 1000);
    const timedOutWhy = (bound: AppliedBound) => bound.kind === "total"
      ? `the validation did not finish within ${seconds(bound.ms)}s, the bound on the whole validation.`
      : `${bound.command} did not finish within ${seconds(bound.ms)}s, its own per-command bound.`;

    for (const command of commands) {
      const bound = requiredChecks.includes(command)
        ? options.requiredCommandTimeoutMs?.[command] ?? COMPLETION_REQUIRED_COMMAND_TIMEOUT_MS[command] ?? COMPLETION_COMMAND_TIMEOUT_MS
        : COMPLETION_COMMAND_TIMEOUT_MS;
      const result = run(requiredInvocations.get(command) ?? ["/bin/sh", "-c", command], bound, command);
      if (result.timedOut) return timeout(timedOutWhy(result.bound), [`${command} (timed out)`]);
      if (result.error) return unavailable(`the configured validation command could not run (${untrusted(result.error, 200)}).`, [command]);
      if (result.status !== 0) return deny(`the configured validation command exited ${result.status}.${result.output ? ` ${result.output}` : ""}`, [command]);
    }

    if (!vitest) {
      // Plain JavaScript tests: Node's own runner, one file at a time so each
      // proves it ran and passed at least one test.
      for (const file of namedTests) {
        const report = path.join(scratch, `completion-node-test-${namedTests.indexOf(file)}.tap`);
        const result = run([process.execPath, "--test", "--test-reporter=tap", `--test-reporter-destination=${report}`, file], COMPLETION_VALIDATION_TIMEOUT_MS, `node --test ${file}`);
        if (result.timedOut) return timeout(timedOutWhy(result.bound), [`${file} (timed out)`]);
        if (result.error) return unavailable(`the named tests could not run (${untrusted(result.error, 200)}).`);
        let tap = "";
        try { tap = readFileSync(report, "utf8"); } catch { tap = ""; }
        reports.push({ file, tests: [...tap.matchAll(/^\s*(ok|not ok) \d+ - (.+)$/gm)].slice(0, 2000).map(match => ({ name: completionEvidenceText(match[2], 300), status: match[1] === "ok" ? "passed" : "failed" })) });
        const failing = [...tap.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => `${file} > ${match[1]}`);
        if (result.status !== 0) return deny(`the named tests failed (node --test exited ${result.status}).`, failing.length ? failing : [file]);
        if (!/^# pass [1-9]\d*$/m.test(tap) || !/^# fail 0$/m.test(tap)) return deny("node --test exited 0 but did not report a passing test for every named file.", [file]);
      }
      return finish({ status: "passed", namedTests, commands, durationMs: Math.round(performance.now() - startedAt) });
    }

    const report = path.join(scratch, "completion-vitest-report.json");
    const result = run([process.execPath, runner, "run", ...namedTests, "--maxWorkers=2", "--reporter=json", `--outputFile.json=${report}`], COMPLETION_VALIDATION_TIMEOUT_MS, `vitest run ${namedTests.join(" ")}`);
    if (result.timedOut) return timeout(timedOutWhy(result.bound), namedTests.map((file) => `${file} (timed out)`));
    if (result.error) return unavailable(`the named tests could not run (${untrusted(result.error, 200)}).`);
    let parsed: VitestReport | null = null;
    try { parsed = JSON.parse(readFileSync(report, "utf8")) as VitestReport; } catch { parsed = null; }
    const relativeName = (name: string | undefined) => name ? path.relative(source, name).split(path.sep).join("/") : "(unknown file)";
    const failures: string[] = [];
    for (const file of parsed?.testResults ?? []) {
      reports.push({ file: completionEvidenceText(relativeName(file.name), 500), tests: (file.assertionResults ?? []).slice(0, 2000).map(test => ({ name: completionEvidenceText(test.fullName ?? test.title ?? "(unnamed test)", 300), status: completionEvidenceText(test.status ?? "unknown", 30) })) });
      const failed = (file.assertionResults ?? []).filter((test) => test.status === "failed");
      for (const test of failed) failures.push(`${relativeName(file.name)} > ${test.fullName ?? test.title ?? "(unnamed test)"}`);
      if (!failed.length && file.status === "failed") failures.push(`${relativeName(file.name)} (${file.message ? untrusted(file.message, 120) : "failed to run"})`);
    }
    if (result.status !== 0 && failuresAreLoopbackDenials(parsed)) {
      return { ...unavailable("the named tests reported only loopback networking denials (Issue #2519); the validation confinement denies loopback, so proof must come from the required CI checks on the pull request head.", failures) as Extract<CompletionValidationResult, { status: "refused" }>, loopbackDenied: true };
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
    return finish({ status: "passed", namedTests, commands, durationMs: Math.round(performance.now() - startedAt) });
  } finally {
    if (candidate.evidenceBinding && candidate.workspace) {
      {
        const reference = retainCompletionEvidence(candidate.workspace, { version: 1, producer: "arcadia-completion-validation-v1", binding: candidate.evidenceBinding,
          tree, commands, namedTests, executions, reports, outcome: outcome?.status === "passed" ? "passed" : "refused",
          reason: outcome?.status === "refused" ? outcome.reason : outcome ? null : "validation interrupted without terminal result",
          durationMs: Math.round(performance.now() - startedAt) });
        options.onEvidence?.(reference);
      }
    }
    if (terminalProven) rmSync(root, { recursive: true, force: true });
  }
}

class CompletionEvidenceWriteError extends Error {}
function retainCompletionEvidence(workspace: string, record: CompletionEvidenceRecord): CompletionEvidenceReference {
  try { return writeCompletionEvidence(workspace, record); }
  catch { throw new CompletionEvidenceWriteError(); }
}
/** An execution without durable evidence cannot authorize completion. Scratch is retained on write failure. */
export function validateCompletionCandidate(candidate: CompletionValidationCandidate, options: CompletionValidationOptions = {}): CompletionValidationResult {
  try { return runCompletionValidation(candidate, options); }
  catch (error) {
    if (!(error instanceof CompletionEvidenceWriteError)) throw error;
    return { status: "refused", namedTests: namedTestFiles(candidate.acceptanceCriteria), failures: [], hostFault: true,
      reason: "Pre-acceptance validation evidence could not be retained; completion refused and execution scratch retained." };
  }
}
