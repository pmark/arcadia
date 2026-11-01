import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startRunLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import type { StartRunPins } from "../src/operatorActions/startRunPins.js";

/**
 * Hermetic cases for scripts/start-run.sh, the shared executor of every per-run START card. Each case copies the real
 * executor and a real thin launcher into a throwaway checkout whose origin is a local bare repository, and puts fake
 * `mise` (the Arcadia CLI and the plan-activation runner), `launchctl`, `timeout`, `sleep` and `tmux` shims first on
 * PATH. No case reaches the live workspace, production, launchd, GitHub or a provider.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtures = path.join(repoRoot, "tests", "fixtures", "start-run");
const EXECUTOR_SOURCE = readFileSync(path.join(repoRoot, "scripts", "start-run.sh"), "utf8");
const ID = "start-run-fixture-20261101";
const PLAN = "arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider";
const PREVIOUS = "enable-bounded-local-native-release-manager-coordination-with-durable-addressed";
const ACTIONS = ["claude-worker-launch-replay", "claude-capacity-evidence", "first-supervised-claude-run"];
const SCOPED = ACTIONS.map((a) => `arcadia/${a}`);
const LABEL = "com.arcadia.local.1.worker";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

const GIT_ENV = { GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "f@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "f@example.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}
function commitFile(dir: string, file: string, content: string, message: string): string {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
  git(dir, "add", "-A");
  git(dir, "commit", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

const planDocument = (status: "active" | "draft", done: string[] = []) => [
  "---", `slug: ${PLAN}`, "project: arcadia", `status: ${status}`, "actions:",
  ...ACTIONS.flatMap((id) => [`  - id: ${id}`, `    status: ${done.includes(id) ? "done" : "open"}`]), "---", "body", ""
].join("\n");
const projectDocument = (activePlan: string) => `---\nslug: arcadia\nactive_plan: ${activePlan}\n---\n`;
const decisionDocument = (id: string, status = "approved", answer = "Yes") => `---\nid: "${id}"\nstatus: ${status}\n${answer ? `answer: ${answer}\n` : ""}---\n`;
const DECISIONS = ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161"];

type Scenario = "same" | "behind" | "pin-unfetched" | "origin-moved" | "diverged" | "ahead";
interface BoxOptions {
  scenario?: Scenario;
  planStatus?: "active" | "draft";
  /** Embed the real pinned planActivation block (required for a draft Plan to be startable). */
  activation?: boolean;
  projectPointer?: string;
  done?: string[];
  decisions?: Record<string, string | null>;
  withoutFile?: string;
  expiresAt?: string;
  executorPin?: string;
  tamper?: "descriptor" | "script" | "executor";
  historyDrift?: boolean;
  /** The dashboard's run record for this press: absent, stale, for another card, not running, or already claimed. */
  press?: "none" | "stale" | "other-card" | "not-running" | "claimed" | "other-parent";
  /** The pre-restart worker: fresh and unbound by default (a source-run worker), or stale, or not the launchd PID. */
  preWorker?: "stale" | "pid-mismatch" | "source-child";
  /** Today's Decision 0141 sequence already recorded in the daily ledger. */
  dayUsed?: boolean;
  plist?: boolean;
  tmuxSessions?: boolean;
  config?: unknown;
  state?: (state: Record<string, any>) => void;
}

function box(options: BoxOptions = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-start-run-")));
  directories.push(root);
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "arcadia");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const workspace = path.join(root, "martianrover");
  const library = path.join(repo, "artifacts", "generated", "operator-scripts");
  git(root, "init", "--bare", "-b", "main", origin);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "remote", "add", "origin", origin);
  writeFileSync(path.join(repo, ".gitignore"), "artifacts/generated/\nnode_modules\n");
  const installed = commitFile(repo, "README.md", "base\n", "base");

  const planStatus = options.planStatus ?? "active";
  const files: Record<string, string> = {
    "scripts/start-run.sh": EXECUTOR_SOURCE,
    "src/sessions/tmuxLauncher.ts": "export {};\n",
    "src/production/workerMerge.ts": "export {};\n",
    "PROJECT.md": projectDocument(options.projectPointer ?? (planStatus === "draft" ? PREVIOUS : PLAN)),
    [`docs/plans/${PLAN}.md`]: planDocument(planStatus, options.done),
    [`docs/plans/${PREVIOUS}.md`]: `---\nslug: ${PREVIOUS}\nproject: arcadia\nstatus: ${planStatus === "draft" ? "active" : "draft"}\nactions: []\n---\n`
  };
  for (const id of DECISIONS) {
    const body = options.decisions?.[id];
    if (body === null) continue;
    files[`docs/decisions/${id}-fixture.md`] = body ?? decisionDocument(id);
  }
  if (options.withoutFile) delete files[options.withoutFile];
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
  }
  chmodSync(path.join(repo, "scripts", "start-run.sh"), 0o755);
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "reviewed main");
  const c0 = git(repo, "rev-parse", "HEAD");
  git(repo, "push", "-u", "origin", "main");
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(repo, "node_modules"));

  let pin = c0;
  const scenario = options.scenario ?? "same";
  if (scenario === "behind" || scenario === "diverged") {
    pin = commitFile(repo, "docs/note.md", "docs only\n", "docs-only move");
    git(repo, "push", "origin", "main");
    git(repo, "reset", "--hard", c0);
    if (scenario === "diverged") commitFile(repo, "docs/local.md", "local only\n", "local-only commit");
  } else if (scenario === "pin-unfetched") {
    const other = path.join(root, "other");
    git(root, "clone", origin, other);
    pin = commitFile(other, "docs/note.md", "docs only\n", "docs-only move");
    git(other, "push", "origin", "main");
  } else if (scenario === "origin-moved") {
    const other = path.join(root, "other");
    git(root, "clone", origin, other);
    commitFile(other, "docs/note.md", "moved\n", "origin moved");
    git(other, "push", "origin", "main");
  } else if (scenario === "ahead") {
    commitFile(repo, "docs/local.md", "local only\n", "local ahead of the pin");
  }

  const activationSource = JSON.parse(readFileSync(path.join(repoRoot, "artifacts/generated/operator-scripts/activate-production-claude-plan-20261017.json"), "utf8")) as OperatorScriptDescriptor;
  mkdirSync(library, { recursive: true });
  const history = path.join(library, "earlier.consumed.json");
  writeFileSync(history, '{"state":"CONSUMED"}\n');
  const pins: StartRunPins = {
    schema: "arcadia-start-run-v1", reviewedRevision: pin, executorSha256: options.executorPin ?? sha(EXECUTOR_SOURCE),
    workspace: "martianrover", project: "arcadia", plan: PLAN, actions: ACTIONS, provider: "claude-code-cli",
    transitions: ["validation", "acceptance", "pointer", "packet_approval"], concurrency: 1, packetApprovalHours: 24, intent: "A fixture run on the claude-code provider.",
    spendDecision: "0130", integrationDecision: "0058", requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161"],
    requiredFiles: ["scripts/start-run.sh", "src/sessions/tmuxLauncher.ts", "src/production/workerMerge.ts"],
    production: { revision: 83, epoch: 46 }, queueRevision: 290, workerLabel: LABEL, gateCardId: "enable-capacity-gate-20261017", offId: "restore-off-production",
    grantedBy: "P. Mark Anderson, by pressing this per-run START card from /actions under Decisions 0156 and 0157", consumedHistory: [{ path: history, sha256: sha('{"state":"CONSUMED"}\n') }]
  };
  const descriptor: OperatorScriptDescriptor = {
    schema: "arcadia-operator-script-v1", id: ID, kind: "grant", title: "START: fixture", script: `${ID}.sh`, repeatable: false,
    problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" },
    expires_at: options.expiresAt ?? new Date(Date.now() + 6 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    startRun: pins, ...(options.activation ? { planActivation: structuredClone(activationSource.planActivation!) } : {})
  };
  const script = startRunLauncher(ID);
  validateOperatorScriptContract(descriptor, ID, script);
  const scriptPath = path.join(library, `${ID}.sh`);
  const descriptorPath = path.join(library, `${ID}.json`);
  writeFileSync(scriptPath, script, { mode: 0o755 });
  writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2) + "\n");
  // Fixture-only wait shortening, honoured by the executor only because this marker sits in the fake library.
  writeFileSync(path.join(library, ".start-run-test-fixture"), "4");
  mkdirSync(path.join(library, "reviewed"));
  writeFileSync(path.join(library, "reviewed", `${ID}.json`), JSON.stringify({ sh: sha(readFileSync(scriptPath)), json: sha(readFileSync(descriptorPath)), executor: sha(EXECUTOR_SOURCE) }));
  if (options.tamper === "descriptor") writeFileSync(descriptorPath, readFileSync(descriptorPath, "utf8") + "\n");
  if (options.tamper === "script") writeFileSync(scriptPath, script + "# tampered\n");
  if (options.tamper === "executor") writeFileSync(path.join(repo, "scripts", "start-run.sh"), EXECUTOR_SOURCE + "\n# tampered\n");
  if (options.historyDrift) writeFileSync(history, '{"state":"EDITED"}\n');

  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(workspace, "config"), { recursive: true });
  mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
  writeFileSync(path.join(workspace, "config", "arcadia.json"), JSON.stringify(options.config ?? {}));
  // The live pre-restart worker runs from source, so its heartbeat carries no protected-release binding (Issue #1950).
  writeFileSync(path.join(workspace, ".arcadia", "worker-claude-usage-heartbeat.json"), JSON.stringify({ at: Date.now() - (options.preWorker === "stale" ? 600_000 : 0), binding: null }));
  writeFileSync(path.join(workspace, ".arcadia", "worker.pid"), JSON.stringify({ pid: options.preWorker === "pid-mismatch" ? 2222 : options.preWorker === "source-child" ? 3333 : 1111, owner: "owner-1111" }));
  if (options.dayUsed) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    mkdirSync(path.join(workspace, ".arcadia", "claude-renewal-days"), { recursive: true });
    writeFileSync(path.join(workspace, ".arcadia", "claude-renewal-days", `${today}.json`), '{"status":"consumed-before-renewal"}');
  }
  if (options.plist !== false) {
    mkdirSync(path.join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`), "<plist/>");
  }
  const shim = (name: string, body: string) => writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  shim("mise", `exec "${path.join(fixtures, "fake-mise")}" "$@"`);
  shim("launchctl", `exec node "${path.join(fixtures, "fake-launchctl.mjs")}" "$@"`);
  shim("fake-release-node", `exec node "${path.join(fixtures, "fake-release-node.mjs")}" "$@"`);
  shim("timeout", 'shift; exec "$@"');
  shim("sleep", "exit 0");
  // `ps -o ppid= -p <pid>`: 3333 is the source-run worker the tsx CLI (launchd PID 1111) runs as its direct child.
  shim("ps", 'case "$4" in 3333) echo " 1111" ;; *) echo " 1" ;; esac');
  shim("tmux", options.tmuxSessions ? 'echo "0: 1 windows (created Sat Nov  1 00:00:00 2026)"' : "exit 1");
  writeFileSync(path.join(bin, "fake-arcadia.mjs"), readFileSync(path.join(fixtures, "fake-arcadia.mjs")));
  writeFileSync(path.join(bin, "fake-plan-runner.mjs"), readFileSync(path.join(fixtures, "fake-plan-runner.mjs")));

  const state: Record<string, any> = {
    workspace, repository: repo, plan: PLAN,
    production: { desiredState: "inactive", revision: 83, epoch: 46, liveAdmissions: 0, authority: null },
    queue: { revision: 290, orderValid: true, unpositionedCount: 0, ordered: SCOPED.map((orderKey) => ({ orderKey })) },
    capacity: { observation: { providers: [{ providerId: "claude-code-cli", admitted: true, code: null, reason: "5-hour 20%", receipt: { source: "claude_status_line" } }] } },
    freeze: "allow", broker: { revision: installed, ready: true, transports: true },
    ensure: { fail: false }, activate: { mode: "ok" }, planRunner: { mode: "ok" },
    worker: { pid: 1111, alive: true, heartbeat: options.preWorker === "stale" ? "frozen" : "fresh", newPid: process.pid }
  };
  options.state?.(state);
  writeFileSync(path.join(root, "state.json"), JSON.stringify(state, null, 2));

  const marker = path.join(library, `${ID}.consumed.json`);
  /** Write the run record the dashboard writes before the runner execs the card; the runner adds its own pid (this process). */
  const pressEnv = (): Record<string, string> => {
    const kind = options.press;
    if (kind === "none") return {};
    const runId = `20261101000000000-${randomUUID()}`;
    const dir = path.join(library, "runs", "operator", ID, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "descriptor.json"), readFileSync(descriptorPath));
    writeFileSync(path.join(dir, "run.json"), JSON.stringify({
      schema: "arcadia-operator-script-run-v1", runId, scriptId: kind === "other-card" ? "some-other-card" : ID,
      status: kind === "not-running" ? "failed" : "running", pid: kind === "other-parent" ? 1 : process.pid,
      startedAt: new Date(Date.now() - (kind === "stale" ? 10 * 60_000 : 1000)).toISOString()
    }));
    if (kind === "claimed") writeFileSync(path.join(dir, "start-run.claimed"), "x\n");
    return { ARCADIA_OPERATOR_SCRIPT_RUN_ID: runId, ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY: dir, ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR: path.join(dir, "descriptor.json") };
  };
  const env = (overrides: Record<string, string | undefined> = {}, actions = true): NodeJS.ProcessEnv => {
    const base: NodeJS.ProcessEnv = {
      ...process.env, ...GIT_ENV, PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_ROOT: root, FAKE_BIN: bin, FAKE_ARCADIA_ROOT: repoRoot,
      ...(actions ? { ARCADIA_OPERATOR_SCRIPT_ID: ID, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: descriptorPath, ...pressEnv() } : {})
    };
    delete base.ANTHROPIC_API_KEY; delete base.CODEX_SANDBOX; delete base.ARCADIA_WORKSPACE; delete base.VITEST;
    for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete base[key]; else base[key] = value; }
    return base;
  };
  const calls = () => (existsSync(path.join(root, "calls.log")) ? readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { tool: string; args: string[]; cwd?: string; operatorId?: string | null }) : []);
  const readState = () => JSON.parse(readFileSync(path.join(root, "state.json"), "utf8")) as Record<string, any>;
  const runDirs = () => (existsSync(path.join(library, "runs", ID)) ? readdirSync(path.join(library, "runs", ID)).sort() : []);
  function run(mode: "run" | "preflight" | "--describe" = "run", overrides: Record<string, string | undefined> = {}, actions = mode === "run") {
    const before = new Set(runDirs());
    const result = spawnSync(scriptPath, [mode], { env: env(overrides, actions), encoding: "utf8", timeout: 200_000 });
    const created = runDirs().filter((name) => !before.has(name));
    const dir = created.length ? path.join(library, "runs", ID, created[created.length - 1]) : null;
    const read = (name: string) => (dir && existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : null);
    return {
      status: result.status, stdout: result.stdout, stderr: result.stderr, dir,
      receipt: read("receipt.json") ? JSON.parse(read("receipt.json")!) as Record<string, any> : null,
      handoff: read("failure-handoff.md"), read
    };
  }
  /** Calls that change the host, the runtime, Plan state or production. */
  const mutating = () => calls().filter((call) =>
    (call.tool === "launchctl" && call.args[0] === "kickstart") || call.tool === "plan-runner" || call.tool === "worker-install" ||
    (call.tool === "arcadia" && call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only")) ||
    (call.tool === "arcadia" && (["go-broker ensure", "production activate", "production deactivate"].includes(call.args.slice(0, 2).join(" ")))));
  /** The mutating calls as short names, in order. */
  const sequence = () => mutating().map((call) => call.tool === "arcadia" ? call.args.slice(0, 2).join(" ") : call.tool);
  return { root, repo, origin, library, marker, pin, installed, descriptorPath, scriptPath, env, run, calls, mutating, sequence, readState, workspace, head: () => git(repo, "rev-parse", "HEAD"), status: () => git(repo, "status", "--porcelain"), state };
}
type Box = ReturnType<typeof box>;

/** A refusal before the first mutation: the pinned phase, nothing consumed, nothing changed. */
function expectRefusedClean(b: Box, result: ReturnType<Box["run"]>, phase: string, reason: RegExp | string, headBefore: string) {
  expect(result.status).not.toBe(0);
  expect(result.receipt).toMatchObject({ outcome: "refused", phase, allowanceConsumed: false, mutations: [] });
  expect(result.receipt!.reason).toMatch(reason);
  expect(result.handoff).toContain("nothing was consumed");
  expect(existsSync(b.marker)).toBe(false);
  expect(b.mutating()).toEqual([]);
  expect(b.head()).toBe(headBefore);
}

describe("start-run executor: shape", () => {
  it("is executable, parses, and keeps its whole body inside functions ending in `main`", () => {
    const syntax = spawnSync("bash", ["-n", path.join(repoRoot, "scripts", "start-run.sh")], { encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
    expect(EXECUTOR_SOURCE.trimEnd().split("\n").pop()).toBe('main "$@"; exit $?');
    expect(EXECUTOR_SOURCE).not.toMatch(/\b[0-9a-f]{40}\b/);
  });
  it("describes its descriptor and refuses unknown modes", () => {
    const b = box();
    expect(spawnSync(b.scriptPath, ["--describe"], { env: { ...process.env, PATH: `${process.env.PATH}` }, encoding: "utf8" }).stdout).toContain(ID);
    const bad = spawnSync(b.scriptPath, ["bogus"], { encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("usage");
  });
});

describe("start-run executor: P0 context refusals consume nothing", () => {
  it.each<[string, BoxOptions, Record<string, string | undefined>, boolean, RegExp]>([
    ["not launched from /actions", {}, {}, false, /\/actions operator-action library/],
    ["a descriptor that is not this card's", {}, { ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: "/nonexistent.json" }, true, /\/actions operator-action library/],
    ["the right env but no operator press record", { press: "none" }, {}, true, /no operator press record/],
    ["a stale operator press record", { press: "stale" }, {}, true, /not fresh/],
    ["an operator press record for another card", { press: "other-card" }, {}, true, /another card/],
    ["an operator press record that is not running", { press: "not-running" }, {}, true, /not in running state/],
    ["an operator press record parented by another process", { press: "other-parent" }, {}, true, /not parented/],
    ["an already claimed operator press record", { press: "claimed" }, {}, true, /already claimed/],
    ["an agent sandbox", {}, { CODEX_SANDBOX: "seatbelt" }, true, /host-only/],
    ["ANTHROPIC_API_KEY set", {}, { ANTHROPIC_API_KEY: "sk-fixture" }, true, /ANTHROPIC_API_KEY is set/],
    ["ARCADIA_WORKSPACE set", {}, { ARCADIA_WORKSPACE: "/elsewhere" }, true, /ARCADIA_WORKSPACE is set/],
    ["a changed descriptor", { tamper: "descriptor" }, {}, true, /independently reviewed hashes/],
    ["a changed launcher", { tamper: "script" }, {}, true, /independently reviewed hashes/],
    ["a changed executor", { tamper: "executor" }, {}, true, /independently reviewed hashes/],
    ["an executor other than the pinned one", { executorPin: "e".repeat(64) }, {}, true, /not the one the card pins/],
    ["an expired card", { expiresAt: "2020-01-01T00:00:00Z" }, {}, true, /expired/],
    ["preserved receipt drift", { historyDrift: true }, {}, true, /consumed history or authority receipt changed/]
  ])("refuses %s", (_label, options, env, actions, reason) => {
    const b = box(options);
    const headBefore = b.head();
    const result = b.run("run", env, actions);
    // The not-from-/actions case runs without the operator context; the others carry it.
    expectRefusedClean(b, result, "P0", reason, headBefore);
  });
  it("refuses a pressed-twice card from its consumed marker", () => {
    const b = box();
    writeFileSync(b.marker, '{"state":"CONSUMED"}\n');
    const result = b.run();
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P0", allowanceConsumed: false });
    expect(result.receipt!.reason).toMatch(/allowance is consumed/);
    expect(b.mutating()).toEqual([]);
  });
});

describe("start-run executor: P1 repo refusals consume nothing", () => {
  it.each<[string, BoxOptions, RegExp, (b: Box) => void]>([
    ["a dirty checkout", {}, /must be clean/, (b) => writeFileSync(path.join(b.repo, "stray.txt"), "x")],
    ["a checkout that is not on main", {}, /must be on main/, (b) => git(b.repo, "checkout", "-b", "side")],
    ["origin main that moved past the pin", { scenario: "origin-moved" }, /origin main is .* not the reviewed revision/, () => undefined],
    ["a local main ahead of the pin", { scenario: "ahead" }, /diverged from, or ahead of/, () => undefined],
    ["a local main diverged from the pin", { scenario: "diverged" }, /diverged from, or ahead of/, (b) => git(b.repo, "fetch", "origin")],
    ["a pin that is not present locally (preflight does not fetch)", { scenario: "pin-unfetched" }, /not present locally/, () => undefined],
    ["a Decision that is not approved", { decisions: { "0156": decisionDocument("0156", "proposed", "") } }, /Decision 0156 is not approved/, () => undefined],
    ["a Decision with no recorded answer", { decisions: { "0130": decisionDocument("0130", "approved", "") } }, /Decision 0130 has no recorded answer/, () => undefined],
    ["a missing Decision", { decisions: { "0097": null } }, /Decision 0097 is not in docs\/decisions/, () => undefined],
    ["a required file missing at the pin", { withoutFile: "src/production/workerMerge.ts" }, /workerMerge\.ts is missing at the reviewed revision/, () => undefined],
    ["a pinned Action that is already done", { done: [ACTIONS[1]] }, /still open/, () => undefined],
    ["a draft Plan with no embedded activation", { planStatus: "draft" }, /carries no planActivation/, () => undefined],
    ["a draft Plan whose Project pointer is not the previous Plan", { planStatus: "draft", activation: true, projectPointer: "something-else" }, /previous Plan/, () => undefined],
    ["an active Plan the Project does not point at", { projectPointer: "something-else" }, /does not point at it/, () => undefined]
  ])("refuses %s", (_label, options, reason, setup) => {
    const b = box(options);
    setup(b);
    const headBefore = b.head();
    const result = b.run("preflight");
    expectRefusedClean(b, result, "P1", reason, headBefore);
  });
  it("refuses a workspace that resolves to another directory name", () => {
    const b = box({ state: (s) => { s.workspace = s.workspace.replace("martianrover", "elsewhere"); } });
    const result = b.run("preflight");
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P1", allowanceConsumed: false });
    expect(result.receipt!.reason).toMatch(/not martianrover/);
  });
});

describe("start-run executor: P2 state refusals consume nothing", () => {
  const status = (patch: Record<string, unknown>) => (s: Record<string, any>) => { Object.assign(s.production, patch); };
  it.each<[string, BoxOptions, RegExp]>([
    ["production Active", { state: status({ desiredState: "active" }) }, /must be Inactive at policy revision 83/],
    ["a moved policy revision", { state: status({ revision: 84 }) }, /revision 83 \/ epoch 46/],
    ["a moved policy epoch", { state: status({ epoch: 47 }) }, /revision 83 \/ epoch 46/],
    ["a live admission", { state: status({ liveAdmissions: 1 }) }, /zero live admissions/],
    ["this card's request id already in policy", { state: status({ authority: { requestId: ID } }) }, /already recorded in production policy/],
    ["a live tmux Session", { tmuxSessions: true }, /live sessions/],
    ["a missing worker launch agent", { plist: false }, /launch agent .* is missing/],
    ["a worker with no running PID", { state: (s) => { s.worker.pid = null; } }, /no running PID/],
    ["the capacity gate switched off", { config: { codingAgent: { capacityGateEnabled: false } } }, /capacity gate is OFF/],
    ["an unmetered capacity source", { state: (s) => { s.capacity.observation.providers[0].receipt.source = "operator_config"; } }, /capacity gate is off/],
    ["a capacity read that refuses", { state: (s) => { Object.assign(s.capacity.observation.providers[0], { admitted: false, code: "capacity_exhausted" }); } }, /refuses claude-code-cli/],
    ["a moved queue revision", { state: (s) => { s.queue.revision = 291; } }, /queue revision changed/],
    ["pinned Actions out of order in the queue", { state: (s) => { s.queue.ordered.reverse(); } }, /pinned order/],
    ["an invalid queue", { state: (s) => { s.queue.orderValid = false; } }, /invalid/],
    ["a rehearsal freeze", { state: (s) => { s.freeze = "refuse"; } }, /rehearsal freeze/],
    // Decision 0161: the pre-restart worker need only be live and fresh; the day must be unused; the sequence's slots must be free.
    ["a stale pre-restart worker heartbeat", { preWorker: "stale" }, /stale or mismatched pre-restart worker heartbeat/],
    ["a pre-restart worker whose pidfile is not the launchd PID", { preWorker: "pid-mismatch" }, /stale or mismatched pre-restart worker heartbeat/],
    ["today's Decision 0141 sequence already used", { dayUsed: true }, /sign-in sequence for today .* is already used .* cannot be pressed until the next day/],
    ["sign-in sequence preconditions that fail", { state: (s) => { s.signin = { check: "refuse" }; } }, /sign-in sequence preconditions fail: .*not a terminal request.*\[code REQUEST_SLOT_BUSY; dayClaimed false\]/]
  ])("refuses %s", (_label, options, reason) => {
    const b = box(options);
    const headBefore = b.head();
    const result = b.run("preflight");
    expectRefusedClean(b, result, "P2", reason, headBefore);
  });
});

describe("start-run executor: preflight", () => {
  it("passes P0 to P2 with no mutation, no /actions context and only a run directory written", () => {
    const b = box({ scenario: "behind" });
    const headBefore = b.head();
    const result = b.run("preflight");
    expect(result.status, result.stderr).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "preflight_ok", phase: "P2", allowanceConsumed: false, mutations: [], mode: "preflight" });
    expect(result.receipt!.record.needsPlanActivation).toBe(false);
    expect(result.handoff).toContain("Preflight only");
    expect(b.mutating()).toEqual([]);
    expect(b.head()).toBe(headBefore);
    expect(b.status()).toBe("");
    expect(existsSync(b.marker)).toBe(false);
    expect(readdirSync(path.join(b.library, "runs"))).toEqual([ID]);
    // The pre-restart worker is unbound (source-run) and that no longer refuses; the ledger and slots were only read.
    expect(result.receipt!.record.preRestartWorkerPid).toBe(1111);
    expect(result.receipt!.record.preRestartBinding).toBeNull();
    expect(result.receipt!.record.signInDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "start-run sign-in" && call.args.includes("--check-only"))).toBe(true);
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
  });
});

describe("start-run executor: a source-run pre-restart worker", () => {
  it("accepts a pidfile naming the launchd PID's direct child (the tsx CLI runs the worker as its child)", () => {
    const b = box({ preWorker: "source-child" });
    const result = b.run("preflight");
    expect(result.status, result.stderr).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "preflight_ok", allowanceConsumed: false, mutations: [] });
    expect(result.receipt!.record).toMatchObject({ oldWorkerPid: 1111, preRestartWorkerPid: 3333 });
  });
});

describe("start-run executor: P3 consume", () => {
  it("refuses at P3 when another press consumed the allowance after the preflight, still before any mutation", () => {
    const b = box();
    // The freeze check runs in P2; a concurrent press lands its marker right after it.
    const fakePath = path.join(b.root, "bin", "fake-arcadia.mjs");
    writeFileSync(fakePath, readFileSync(fakePath, "utf8").replace("ok({ operation: args[2]", `writeFileSync(${JSON.stringify(b.marker)}, "{}"); ok({ operation: args[2]`));
    const result = b.run();
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P3", allowanceConsumed: false });
    expect(result.receipt!.reason).toMatch(/allowance is consumed/);
    expect(b.mutating()).toEqual([]);
  });
});

describe("start-run executor: the START itself", () => {
  it("installs, restarts, binds the worker and starts production on an active Plan already at the pin", () => {
    const b = box();
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("START GRANTED");
    expect(result.receipt).toMatchObject({ outcome: "succeeded", phase: "P6", allowanceConsumed: true, productionActivated: true, planActivatedByThisCard: false });
    expect(result.receipt!.record.planActivation).toContain("skipped");
    expect(JSON.parse(readFileSync(b.marker, "utf8"))).toMatchObject({ state: "CONSUMED", requestId: ID, reviewedRevision: b.pin });
    // Order: ensure, then the protected install and restart, then the sign-in sequence, then activation; each exactly once.
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in", "production activate"]);
    expect(b.calls().some((call) => call.tool === "launchctl" && call.args[0] === "kickstart")).toBe(false);
    // The install runs the pinned release's own compiled CLI, replacing exactly the pinned label for the live workspace.
    const install = b.calls().find((call) => call.tool === "worker-install")!;
    const release = path.join(b.root, "home", ".local", "share", "arcadia", "go-broker", "releases", b.pin);
    expect(install.args).toEqual([path.join(release, "dist", "src", "cli.js"), "worker", "install", "--replace-label", LABEL, "--workspace", b.workspace]);
    expect(install.cwd).toBe(release);
    const signIn = b.calls().find((call) => call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only"))!;
    expect(signIn.args).toEqual(expect.arrayContaining(["--release", b.pin, "--card", ID, "--policy-revision", "83", "--policy-epoch", "46", "--repository", b.repo, "--workspace", b.workspace]));
    const activate = b.calls().find((call) => call.args.slice(0, 2).join(" ") === "production activate")!;
    expect(activate.args).toEqual(expect.arrayContaining(["--require-current-runtime", "--repository", b.repo, "--request-id", ID, "--expected-revision", "83"]));
    // The worker binding is read live after the restart and recorded.
    const binding = JSON.parse(result.read("worker-binding.json")!);
    expect(binding).toMatchObject({ oldPid: 1111, workerLabel: LABEL, binding: { pid: process.pid, release: b.pin, handlerHash: `handler-${process.pid}` } });
    expect(result.receipt!.record.workerBinding).toMatchObject({ pid: process.pid, release: b.pin });
    // The sequence ran once: the day is claimed, two Decision-only commits are on main and origin, and the receipt gated START.
    expect(result.receipt!.record.signIn).toMatchObject({ outcome: "checked", dayClaimed: true });
    expect(result.receipt!.record.signInReceipt).toMatchObject({ release: b.pin, handlerHash: `handler-${process.pid}` });
    expect(git(b.repo, "rev-parse", "HEAD~2")).toBe(b.pin);
    expect(git(b.repo, "diff", "--name-only", b.pin, "HEAD")).toBe(`docs/decisions/${result.receipt!.record.signIn.decision}.md`);
    expect(git(b.origin, "rev-parse", "main")).toBe(b.head());
    expect(result.receipt!.mutations.join("\n")).toContain("today's Decision 0141 sequence consumed");
    expect(result.receipt!.record.runtimeCheck.current).toBe(true);
    expect(b.readState().production).toMatchObject({ desiredState: "active", authority: { requestId: ID } });
    expect(result.handoff).toContain("No failure");
    expect(readFileSync(path.join(result.dir!, "receipt.md"), "utf8")).toContain(`reviewed revision installed: ${b.pin}`);
    // A second press refuses from P0 and touches nothing.
    const before = b.calls().length;
    const second = b.run();
    expect(second.receipt).toMatchObject({ outcome: "refused", phase: "P0", allowanceConsumed: false });
    expect(b.calls().length).toBe(before);
  }, 120_000);

  it("fetches an unfetched pin, fast-forwards only to it, activates the draft Plan through the shared runner, then starts", () => {
    const b = box({ scenario: "pin-unfetched", planStatus: "draft", activation: true, state: (s) => { s.queue.ordered = [{ orderKey: "arcadia/other" }, ...s.queue.ordered]; } });
    // Before activation the pinned Actions are not queued; the fake queue shows them after the runner commits.
    const fakePath = path.join(b.root, "bin", "fake-plan-runner.mjs");
    writeFileSync(fakePath, readFileSync(fakePath, "utf8").replace('git("add", "-A");', `const s = JSON.parse(readFileSync(path.join(root, "state.json"), "utf8")); s.queue.ordered = s.queue.ordered.filter((e) => e.orderKey !== "arcadia/other"); writeFileSync(path.join(root, "state.json"), JSON.stringify(s)); git("add", "-A");`));
    const headBefore = b.head();
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", allowanceConsumed: true, planActivatedByThisCard: true });
    expect(result.receipt!.record.needsPlanActivation).toBe(true);
    expect(result.receipt!.mutations.join(" ")).toContain("fast-forward");
    // The checkout moved to the pin, then the two diagnostic Decision commits, then one governance commit (the activation).
    expect(git(b.repo, "rev-parse", "HEAD~3")).toBe(b.pin);
    expect(git(b.repo, "merge-base", "--is-ancestor", headBefore, b.pin)).toBe("");
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in", "plan-runner", "production activate"]);
    const runner = b.calls().find((call) => call.tool === "plan-runner")!;
    expect(runner.args).toEqual([b.descriptorPath, "run"]);
    expect(runner.operatorId).toBe(ID);
    expect(result.receipt!.record.arcadiaHeadAfterPlanActivation).toBe(b.head());
    expect(result.receipt!.record.runtimeCheck.current).toBe(true);
  }, 120_000);

  it("reuses a fresh receipt of the bound worker: no renewal, no day claimed, no Decision, then starts", () => {
    const b = box({ state: (s) => { s.signin = { mode: "reused" }; } });
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", allowanceConsumed: true, productionActivated: true });
    expect(result.receipt!.record.signIn).toMatchObject({ outcome: "reused", dayClaimed: false });
    expect(b.head()).toBe(b.pin);
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
    expect(result.receipt!.mutations.join("\n")).toContain("fresh usage receipt of the bound worker was reused");
  }, 120_000);
});

describe("start-run executor: failures after the first mutation", () => {
  function consumed(b: Box, result: ReturnType<Box["run"]>, phase: string, reason: RegExp) {
    expect(result.status).not.toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "refused", phase, allowanceConsumed: true });
    expect(result.receipt!.reason).toMatch(reason);
    expect(existsSync(b.marker)).toBe(true);
    expect(result.handoff).toContain("one-shot allowance is consumed forever");
    expect(result.receipt!.mutations[0]).toContain("allowance consumed");
    // A second press never repeats: it refuses from the marker before touching anything.
    const before = b.calls().length;
    const second = b.run();
    expect(second.receipt).toMatchObject({ outcome: "refused", phase: "P0", allowanceConsumed: false });
    expect(b.calls().length).toBe(before);
  }

  it("keeps the fast-forward and refuses with no restart when go-broker ensure fails", () => {
    const b = box({ scenario: "behind", state: (s) => { s.ensure.fail = true; } });
    const result = b.run();
    consumed(b, result, "P4", /go-broker ensure failed; no worker restart was attempted/);
    expect(b.sequence()).toEqual(["go-broker ensure"]);
    expect(b.head()).toBe(b.pin);
    expect(result.handoff).toContain("fast-forwarded to the pinned revision");
    expect(result.handoff).toContain("The runtime stays upgraded; there is no rollback");
    expect(result.handoff).not.toContain("restart was attempted: the worker");
    expect(result.handoff).toContain("No sign-in renewal ran");
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 60_000);

  it("does not restart when the installed broker is not the reviewed revision", () => {
    const b = box({ state: (s) => { s.ensure.noop = true; } });
    // ensure succeeds but leaves the old release installed
    const fakePath = path.join(b.root, "bin", "fake-arcadia.mjs");
    writeFileSync(fakePath, readFileSync(fakePath, "utf8").replace('state.broker.revision = git("rev-parse", "HEAD");', 'if (!state.ensure.noop) state.broker.revision = git("rev-parse", "HEAD");'));
    const result = b.run();
    consumed(b, result, "P4", /not the reviewed revision .* no worker restart was attempted/);
    expect(b.sequence()).toEqual(["go-broker ensure"]);
  }, 60_000);

  it("keeps production Off and runs no renewal when the protected install or restart fails", () => {
    const b = box({ state: (s) => { s.install = { fail: true }; } });
    const result = b.run();
    consumed(b, result, "P4", /protected worker install or restart failed: the worker may be down or still source-run; production stays Off and no renewal ran/);
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install"]);
    expect(result.read("worker-install.log")).toContain("launchctl bootstrap failed");
    expect(result.handoff).toContain("protected worker install and restart was attempted");
    expect(result.handoff).toContain("No sign-in renewal ran");
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 60_000);

  it.each<[string, (s: Record<string, any>) => void, RegExp]>([
    ["no new PID", (s) => { s.worker.noRestart = true; }, /did not come back with a new PID/],
    ["a stale heartbeat", (s) => { s.worker.heartbeat = "stale"; }, /no fresh worker heartbeat/],
    ["a heartbeat bound to the wrong release", (s) => { s.worker.heartbeat = "wrong_release"; }, /no fresh worker heartbeat bound to the new pid .* and release/],
    ["a heartbeat with no binding (still source-run)", (s) => { s.worker.heartbeat = "unbound"; }, /no fresh worker heartbeat bound to the new pid .* and release/],
    ["no heartbeat after the restart", (s) => { s.worker.heartbeat = "none"; }, /no fresh worker heartbeat/],
    ["transports that never become ready", (s) => { s.broker.transports = false; }, /no fresh worker heartbeat/]
  ])("refuses %s after the restart, before any renewal", (_label, mutate, reason) => {
    const b = box({ state: mutate });
    const result = b.run();
    consumed(b, result, "P4", reason);
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install"]);
    expect(result.handoff).toContain("protected worker install and restart was attempted");
    expect(existsSync(path.join(result.dir!, "worker-binding.json"))).toBe(false);
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
  }, 60_000);

  it("passes the real press check against the shell-made press layout, and refuses a press claimed by another run", () => {
    const ok = box();
    const good = ok.run();
    expect(good.status, good.stderr).toBe(0);
    expect(ok.calls().filter((call) => call.tool === "press-check").map((call) => call.args[0])).toEqual(["0"]);
    const bad = box({ state: (s) => { s.tamperClaimed = true; } });
    const result = bad.run();
    consumed(bad, result, "P4", /start-run sign-in runs only inside a pressed START card: the press record's start-run\.claimed marker is not this run.*\[code NOT_A_CARD_PRESS; dayClaimed false\]/);
    expect(existsSync(path.join(bad.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
  }, 180_000);

  it("re-checks capacity and production Off in the sign-in phase and refuses before the day is claimed", () => {
    const b = box({ state: (s) => { s.exhaustCapacityAfterInstall = true; } });
    const result = b.run();
    consumed(b, result, "P4", /refuses claude-code-cli/);
    expect(result.receipt!.phaseName).toBe("sign_in");
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install"]);
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
    expect(result.handoff).toContain("No sign-in renewal ran");
  }, 60_000);

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["the renewal fails", { mode: "renewal_failed" }, /sign-in sequence did not succeed, so there is no START: the Haiku sign-in renewal failed.*\[code RENEWAL_FAILED; dayClaimed true\]/],
    ["the worker usage check fails", { mode: "check_failed" }, /sign-in sequence did not succeed, so there is no START: the worker usage check does not allow START.*\[code CHECK_FAILED; dayClaimed true\]/],
    ["the check succeeds but the credential expires within 5 minutes", { expiresInMs: 120_000 }, /credential expiry: the sign-in has expired or expires within 5 minutes/],
    ["a usage window is at 100%", { windowPercent: 100 }, /usage window unknown or at 100%/]
  ])("consumes the card and the day with no START or retry when %s", (_label, signin, reason) => {
    const b = box({ state: (s) => { s.signin = signin; } });
    const result = b.run();
    consumed(b, result, "P4", reason);
    expect(result.receipt!.phaseName).toBe("sign_in");
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in"]);
    expect(b.calls().filter((call) => call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only"))).toHaveLength(1);
    expect(result.handoff).toContain("that day is consumed");
    expect(result.receipt!.runtimeUpgraded).toBe(true);
    expect(b.readState().production.desiredState).toBe("inactive");
    // The day is recorded, so even a fresh card refuses in preflight today.
    expect(readdirSync(path.join(b.workspace, ".arcadia", "claude-renewal-days")).length).toBeGreaterThan(0);
  }, 60_000);

  it("keeps the Plan activation allowance consumed and production Off when the activation runner fails", () => {
    const b = box({ planStatus: "draft", activation: true, state: (s) => { s.planRunner.mode = "fail"; } });
    const result = b.run();
    consumed(b, result, "P5", /Plan-activation runner did not succeed|runner failed/);
    expect(result.handoff).toContain("Plan-activation runner was invoked. It is replay-safe");
    expect(result.receipt!.planActivatedByThisCard).toBe(false);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 60_000);

  it("refuses without activating when the preview differs from the expected fingerprint", () => {
    const b = box({ state: (s) => { s.preview = { fingerprint: "0".repeat(32) }; } });
    const result = b.run();
    consumed(b, result, "P6", /preview differs from the exact 3-Action/);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
    expect(result.receipt!.offCleanup).toBe("not_attempted");
    expect(result.handoff).toContain("No production activation was attempted");
  }, 120_000);

  it("returns only this Grant to Off when activation commits but the command fails", () => {
    const b = box({ state: (s) => { s.activate.mode = "committed_then_crash"; } });
    const result = b.run();
    consumed(b, result, "P6", /activate command failed or timed out/);
    expect(result.receipt).toMatchObject({ offCleanup: "returned_off", productionActivated: true });
    expect(b.calls().filter((call) => call.args.slice(0, 2).join(" ") === "production deactivate")).toHaveLength(1);
    expect(b.readState().production.desiredState).toBe("inactive");
    expect(result.handoff).toContain("returned only this Grant to Off");
    expect(result.handoff).toContain("The runtime stays upgraded; there is no rollback");
  }, 120_000);

  it("returns Off when the active policy is not the previewed fingerprint", () => {
    const b = box({ state: (s) => { s.activate.mode = "wrong_fingerprint"; } });
    const result = b.run();
    consumed(b, result, "P6", /not the previewed fingerprint/);
    expect(result.receipt!.offCleanup).toBe("returned_off");
  }, 120_000);

  it("reports an activation that never took effect without issuing an Off", () => {
    const b = box({ state: (s) => { s.activate.mode = "unconfirmed"; } });
    const result = b.run();
    consumed(b, result, "P6", /did not confirm Active/);
    expect(result.receipt!.offCleanup).toBe("not_active");
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production deactivate")).toBe(false);
  }, 120_000);

  it("tells the operator to press STOP when the Off cannot be confirmed", () => {
    const b = box({ state: (s) => { s.activate.mode = "committed_then_crash"; s.deactivate = { fail: true }; } });
    const result = b.run();
    consumed(b, result, "P6", /activate command failed/);
    expect(result.receipt!.offCleanup).toBe("OFF_FAILED");
    expect(result.handoff).toContain("Press the STOP button (restore-off-production) NOW");
  }, 120_000);

  it("refuses when runtime-check reports the installed runtime is not current, after the restart", () => {
    const b = box({ state: (s) => { s.runtimeStale = true; } });
    const result = b.run();
    consumed(b, result, "P4", /installed runtime is not current/);
    expect(result.receipt!.runtimeUpgraded).toBe(true);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
  }, 60_000);

  it.each([["owner"], ["handler"]])("refuses with no activation when the worker %s changes between the previews", (kind) => {
    const b = box({ state: (s) => { s.breakOnPreview = kind; } });
    const result = b.run();
    consumed(b, result, "P6", /worker changed after preview; no activation/);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
    expect(result.receipt!.offCleanup).toBe("not_attempted");
  }, 120_000);

  it("binds the operator run id into the receipt and claims the press record once", () => {
    const b = box();
    const result = b.run();
    expect(result.status, result.stderr).toBe(0);
    const runId = readdirSync(path.join(b.library, "runs", "operator", ID))[0];
    expect(result.receipt!.record.operatorRunId).toBe(runId);
    expect(existsSync(path.join(b.library, "runs", "operator", ID, runId, "start-run.claimed"))).toBe(true);
  }, 120_000);

  it("records the unbound pre-restart worker, the bound handler and a runtimeUpgraded flag on success", () => {
    const b = box();
    const result = b.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.receipt!.runtimeUpgraded).toBe(true);
    expect(result.receipt!.record).toMatchObject({ preRestartBinding: null, postRestartHandlerHash: `handler-${process.pid}` });
    expect(result.receipt!.record.signInReceipt.windows).toHaveLength(2);
  }, 120_000);

  it("refuses the START when the retained usage receipt changes after the sequence", () => {
    // The fake appends to every retained receipt at each runtime-check made after the sequence passed its own gate.
    const b = box({ state: (s) => { s.tamperReceiptsOnRuntimeCheck = true; } });
    const result = b.run();
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P6", allowanceConsumed: true });
    expect(result.receipt!.reason).toMatch(/worker usage receipt drift/);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
  }, 120_000);

  it("forwards a TERM to the stage so an in-flight activation is returned to Off", async () => {
    const b = box({ state: (s) => { s.activate.mode = "slow"; } });
    const child = spawn(b.scriptPath, ["run"], { env: b.env() });
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 100_000;
    while (!b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    child.kill("SIGTERM");
    const code = await exited;
    expect(code).not.toBe(0);
    const dir = path.join(b.library, "runs", ID);
    const run = path.join(dir, readdirSync(dir)[0]);
    const receipt = JSON.parse(readFileSync(path.join(run, "receipt.json"), "utf8"));
    expect(receipt).toMatchObject({ outcome: "refused", allowanceConsumed: true, offCleanup: "returned_off" });
    expect(receipt.reason).toMatch(/interrupted by a signal/);
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 150_000);
});
