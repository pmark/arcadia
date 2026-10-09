import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIXTURE_ACTION,
  brokerRefusalInLog,
  classifyLeakChanges,
  codexTrustOverrideArgs,
  commitState,
  withCodexTrustOverrides,
  buildPath,
  formatTable,
  opencodeSessionConfig,
  parseProviderList,
  preservationBlockedEvidence,
  type HostPreserve,
  renderFixtureFiles,
  runHeadlessProviderTest,
  sanitizedEnv,
  type HeadlessTestOptions,
  type ProviderResult
} from "../src/operatorActions/headlessProviderTest.js";
import { claudePreservationDenied, describeClaudeResult, extractDiagnosis, parseClaudeStream } from "../src/operatorActions/headlessProviderDiagnosis.js";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";

/**
 * The /runs action test-headless-provider-single-action. No case reaches a
 * model: `codex` and `opencode` are stubs (tests/helpers/fakeHeadlessProvider.mjs)
 * on PATH. Arcadia itself is real: each case creates a real experiment
 * workspace, registers a real fixture, prepares the Action with `go --apply`
 * and builds the unattended argv with the shipped launch builder.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const ID = "test-headless-provider-single-action";
const TITLE = "Test headless Codex, OpenCode and Claude single-Action runs (experiment fixture)";
const stubSource = path.join(repoRoot, "tests", "helpers", "fakeHeadlessProvider.mjs");

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  directories.push(directory);
  return directory;
};

function stubBin(): string {
  const bin = temp("headless-stubs-");
  for (const name of ["codex", "opencode", "claude"]) {
    copyFileSync(stubSource, path.join(bin, name));
    chmodSync(path.join(bin, name), 0o755);
  }
  return bin;
}

const calls = (file: string): Array<{ name: string; args: string[]; cwd: string; arcadiaWorkspace: string | null; operatorId: string | null; author: string | null; pwd: string | null; opencodeConfig: string | null; allow?: string[]; settingSources?: string | null }> =>
  existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

type Call = ReturnType<typeof calls>[number];
/** A real headless provider run (not a --help or login probe, and not the posture record the claude stub writes). */
const headlessRun = (call: Call, name?: string): boolean =>
  Array.isArray(call.args) && !call.args.includes("--help") && (name === undefined || call.name === name) &&
  ((call.name === "codex" && call.args[0] === "exec") || (call.name === "opencode" && call.args[0] === "run") || (call.name === "claude" && call.args.includes("--print")));

function harness(extra: Record<string, string> = {}) {
  const bin = stubBin();
  const base = temp("headless-base-");
  const runDirectory = path.join(temp("headless-run-"), "runs", "run-1");
  const callLog = path.join(base, "calls.log");
  const env: NodeJS.ProcessEnv = {
    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_PROVIDER_CALLS: callLog,
    // A /runs launch carries these; the test must strip them from everything it starts.
    ARCADIA_OPERATOR_SCRIPT_ID: ID, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(library, `${ID}.json`),
    ...extra
  };
  const run = (options: Partial<Pick<HeadlessTestOptions, "keep" | "providers" | "models" | "providerTimeoutMs" | "now" | "signalSource" | "hostPreserve">> = {}) =>
    runHeadlessProviderTest({
      repoRoot, runDirectory, runId: "run-1", scriptId: ID, keep: options.keep ?? false, env, tempBase: base, liveLeakCheck: false,
      killGraceMs: 200, out: () => {}, ...options
    });
  return { run, runDirectory, base, callLog, env };
}

/** A host that cannot preserve (an experiment workspace holds no production validation authority; CI is not macOS). */
const hostRefuses: HostPreserve = () => ({ ok: false, ran: true, commit: null, detail: "Declared preservation validation failed or was skipped." });
/** A host step that cannot run here at all (no Seatbelt host, no production authority). */
const hostCannotRun: HostPreserve = () => ({ ok: false, ran: false, commit: null, detail: "Preservation validation requires current scoped production validation authority." });
/** A host that commits the candidate the way a successful preservation would. */
const hostCommits: HostPreserve = ({ worktree }) => {
  const identity = { ...process.env, GIT_AUTHOR_NAME: "Host", GIT_AUTHOR_EMAIL: "host@example.invalid", GIT_COMMITTER_NAME: "Host", GIT_COMMITTER_EMAIL: "host@example.invalid" };
  execFileSync("git", ["-C", worktree, "add", "MARKER.md"], { env: identity });
  execFileSync("git", ["-C", worktree, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "Preserve candidate"], { env: identity });
  return { ok: true, ran: true, commit: execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), detail: "fake host preserved the candidate" };
};
/** A host that commits the candidate and then reports an error (a crash after the commit, e.g. while writing its receipt). */
const hostCommitsThenFails: HostPreserve = (input) => ({ ...hostCommits(input), ok: false, detail: "receipt write failed after the commit" });

const leftoverRoots = (base: string) => readdirSync(base).filter((entry) => entry.startsWith("arcadia-headless-provider-test-"));
const criterion = (result: ProviderResult, id: string) => result.criteria.find((entry) => entry.id === id)!;

describe("test-headless-provider-single-action library entry", () => {
  const descriptor = JSON.parse(readFileSync(path.join(library, `${ID}.json`), "utf8"));
  const script = readFileSync(path.join(library, `${ID}.sh`), "utf8");

  it("passes the library contract with the exact human title and states its scope", () => {
    expect(validateOperatorScriptContract(descriptor, ID, script).title).toBe(TITLE);
    expect(descriptor.repeatable).toBe(true);
    const text = JSON.stringify(descriptor);
    for (const required of ["experiment workspace", "never_does", "15 minutes", "existing Codex", "live martianrover workspace", "provider global configuration",
      "account/rateLimits/read", "~/.arcadia/telemetry", "OpenCode runs unsandboxed", "own normal session and state directories",
      "$TMPDIR, not workspaces/exp-*", "attribute before any further experiment",
      "Codex trust entry (operator ruled 2026-10-09: not a stop condition)", "possible Decision 0082 stop condition", "per-invocation --config trust override",
      "--setting-sources", "failureDetails", "SKIPPED", "--providers", "--model-claude", "haiku", "node scripts/check-fixture.mjs", "arcadia agent-ask draft"]) {
      expect(text).toContain(required);
    }
    expect(text).not.toContain("provider's own write");
    expect(text).not.toContain("never pre-attributed");
    for (const required of ["codex login status", "claude auth status", "opencode auth list"]) expect(descriptor.preconditions.join(" ")).toContain(required);
    expect(descriptor.expected_duration).toMatch(/minutes/);
    expect(descriptor.cost_note).toMatch(/existing/);
  });

  it("is executable and exposes only run and --describe", () => {
    const describeRun = spawnSync(path.join(library, `${ID}.sh`), ["--describe"], { encoding: "utf8" });
    expect(describeRun.status).toBe(0);
    expect(JSON.parse(describeRun.stdout)).toEqual(descriptor);
    const refused = spawnSync(path.join(library, `${ID}.sh`), ["frobnicate"], { encoding: "utf8" });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("usage");
    expect(spawnSync(path.join(library, `${ID}.sh`), ["run", "--nonsense"], { encoding: "utf8" }).status).toBe(2);
    // An option that needs a value but has none is a usage error from the launcher itself (nothing is started).
    const missing = spawnSync(path.join(library, `${ID}.sh`), ["run", "--providers"], { encoding: "utf8" });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("--providers needs a value");
  });

  it("never names the live workspace as a target or exports ARCADIA_WORKSPACE", () => {
    expect(script).not.toMatch(/martianrover/);
    expect(script).not.toMatch(/export\s+ARCADIA_WORKSPACE/);
    expect(script).not.toMatch(/ARCADIA_WORKSPACE=/);
  });
});

describe("fixture and environment helpers", () => {
  it("renders a one-Action fixture whose check passes only for the exact marker", () => {
    const files = renderFixtureFiles("2026-10-09", "some-model");
    expect(Object.keys(files).sort()).toEqual(["AGENTS.md", "CONSTITUTION.md", "PROJECT.md", "docs/plans/headless-marker.md", "scripts/check-fixture.mjs"]);
    expect(files["docs/plans/headless-marker.md"]).toContain("recommended_model: some-model");
    expect(files["docs/plans/headless-marker.md"].match(/^ {2}- id: /gm)).toHaveLength(1);
    expect(files["docs/plans/headless-marker.md"]).toContain(`id: ${FIXTURE_ACTION}`);
  });

  it("strips the operator-script context and any inherited workspace, and keeps the caller's PATH first", () => {
    const env = sanitizedEnv({ HOME: "/h", ARCADIA_OPERATOR_SCRIPT_ID: "x", ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY: "y", ARCADIA_WORKSPACE: "/live", ARCADIA_REQUIRE_INLINE_WORKSPACE: "1" });
    expect(env).toEqual({ HOME: "/h" });
    const searchPath = buildPath("/stubs:/usr/bin", ["/shim"]).split(path.delimiter);
    expect(searchPath.slice(0, 3)).toEqual(["/shim", "/stubs", "/usr/bin"]);
    expect(new Set(searchPath).size).toBe(searchPath.length);
  });
});

describe("headless provider run (real Arcadia experiment workspace, stub providers)", () => {
  it("runs a chosen provider through the entry script with an explicit model, keeps the fixture on --keep, and starts no other provider", () => {
    const { env, callLog, base, runDirectory } = harness();
    // The same entry point the launcher runs under mise, run here with node directly so the case needs no mise trust write.
    const launched = spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "scripts", "headless-provider-test.ts"), runDirectory, "run-1", ID, "--keep", "--providers", "codex", "--model-codex=gpt-5.6-terra"], {
      encoding: "utf8", cwd: repoRoot, timeout: 240_000,
      env: { ...env, ARCADIA_HEADLESS_TEST_LEAK_CHECK: "0", TMPDIR: base }
    });
    expect(launched.status, launched.stdout + launched.stderr).toBe(0);

    const receipt = JSON.parse(readFileSync(path.join(runDirectory, "receipt.json"), "utf8"));
    expect(receipt).toMatchObject({ schema: "arcadia-operator-run-receipt-v1", id: ID, outcome: "succeeded", liveWorkspaceAddressed: false, keep: true });
    expect(receipt.providers).toHaveLength(1);
    const [codex] = receipt.providers as ProviderResult[];
    expect(codex).toMatchObject({ provider: "codex", outcome: "PASS", model: "gpt-5.6-terra", modelSource: "override", exitCode: 0, timedOut: false, failureDetails: [] });
    expect(receipt.models).toEqual({ codex: "gpt-5.6-terra" });
    expect(codex.criteria.map((entry) => [entry.id, entry.pass])).toEqual([["exit", true], ["file", true], ["validation", true], ["commit", true], ["ask", true]]);
    expect(codex.gitdir).toMatchObject({ worktreeGitDirInsideWritableRoots: true });
    expect(codex.command).toContain("codex exec --json --model gpt-5.6-terra");
    expect(codex.command).toContain("--sandbox workspace-write");
    expect(existsSync(codex.logPath!)).toBe(true);
    expect(readFileSync(path.join(runDirectory, "run.log"), "utf8")).toContain("PASS  provider exited 0 within the 15-minute cap");
    expect(existsSync(path.join(runDirectory, "failure-handoff.md"))).toBe(false);

    // --keep keeps the experiment workspace and candidate worktree.
    expect(leftoverRoots(base)).toHaveLength(1);
    expect(codex.workspaceKept && existsSync(codex.workspaceKept)).toBe(true);
    expect(codex.candidateWorktree && existsSync(path.join(codex.candidateWorktree, "MARKER.md"))).toBe(true);

    const made = calls(callLog);
    expect(made.some((call) => headlessRun(call) && call.name !== "codex")).toBe(false);
    const exec = made.find((call) => headlessRun(call, "codex"))!;
    // The provider resolves the experiment workspace, never the live default, carries no operator-script context, and signs as the resolved agent.
    expect(exec.arcadiaWorkspace).toBe(path.join(leftoverRoots(base).map((entry) => path.join(base, entry))[0], "codex", "exp-headless-codex"));
    expect(exec.operatorId).toBeNull();
    expect(exec.author).toBeTruthy();
    expect(exec.args).toEqual(expect.arrayContaining(["--model", "gpt-5.6-terra", "--sandbox", "workspace-write", "--cd"]));
    expect(exec.cwd).toBe(codex.candidateWorktree);
    // The experiment tries not to touch ~/.codex/config.toml: trust for exactly this fixture's paths is declared per invocation.
    const overrides = exec.args.filter((arg) => arg.startsWith("projects."));
    expect(overrides).toHaveLength(2);
    expect(overrides.every((arg) => arg.endsWith('.trust_level="trusted"'))).toBe(true);
    expect(overrides.some((arg) => arg.includes(`"${codex.candidateWorktree}"`))).toBe(true);
    expect(overrides.some((arg) => arg.includes("/projects/headless-fixture\""))).toBe(true);
    expect(exec.args.at(-1)).toMatch(/^Arcadia managed-production Action brief/);
    expect(codex.command).toContain("trust_level");
    // A stub never acts outside the temporary directory (Arcadia's own `codex app-server` probe once ran one in the checkout).
    expect(made.filter((call) => headlessRun(call)).every((call) => call.cwd.startsWith(base))).toBe(true);

    // The candidate worktree lives inside the experiment workspace, and the provider's `arcadia` shim pins that workspace itself,
    // so a provider shell that drops its environment still cannot resolve the live default.
    const attemptRoot = path.join(base, leftoverRoots(base)[0], "codex");
    const experiment = path.join(attemptRoot, "exp-headless-codex");
    expect(codex.candidateWorktree!.startsWith(path.join(experiment, "projects") + path.sep)).toBe(true);
    const shim = readFileSync(path.join(attemptRoot, "bin", "arcadia"), "utf8");
    expect(shim).toContain(`ARCADIA_WORKSPACE='${experiment}'`);
    expect(shim).toContain("ARCADIA_REQUIRE_INLINE_WORKSPACE=1");
    // Reconcile ran against the finished Session (information only).
    expect(receipt.providers[0].sessionReconcile).toBeTruthy();
  }, 300_000);

  it("rejects a bad option from the entry script before starting anything", () => {
    const { env, base, runDirectory } = harness();
    const entry = (...flags: string[]) => spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "scripts", "headless-provider-test.ts"), runDirectory, "run-1", ID, ...flags], {
      encoding: "utf8", cwd: repoRoot, timeout: 120_000, env: { ...env, ARCADIA_HEADLESS_TEST_LEAK_CHECK: "0", TMPDIR: base }
    });
    for (const flags of [["--providers", "codex,gemini"], ["--providers", "codex,codex"], ["--providers"], ["--model-claude"], ["--wat"]]) {
      const refused = entry(...flags);
      expect(refused.status, flags.join(" ")).toBe(2);
      expect(refused.stderr).toContain("usage");
    }
    expect(leftoverRoots(base)).toEqual([]);
  }, 300_000);

  it("tries all three providers in order on fresh fixtures, each on its start-tier model with its exact headless argv, and passes only when each does", async () => {
    const { run, runDirectory, base, callLog } = harness({ FAKE_PROVIDER_MODE_codex: "success", FAKE_PROVIDER_MODE_opencode: "success", FAKE_PROVIDER_MODE_claude: "commit" });
    const outcome = await run({ keep: true });
    expect(outcome.outcome).toBe("succeeded");
    expect(outcome.reason).toBe("codex, opencode, claude completed the fixture Action headlessly");
    const [codex, opencode, claude] = outcome.providers as [ProviderResult, ProviderResult, ProviderResult];
    expect(outcome.providers.map((entry) => [entry.provider, entry.outcome])).toEqual([["codex", "PASS"], ["opencode", "PASS"], ["claude", "PASS"]]);
    // Each provider's light-tier (start-tier) model, not the packet's standard-tier one.
    expect([codex.model, opencode.model, claude.model]).toEqual(["gpt-6-luna", "opencode-go/glm-5.3-flash", "haiku"]);
    expect([codex.modelSource, opencode.modelSource, claude.modelSource]).toEqual(["start-tier", "start-tier", "start-tier"]);
    expect(new Set(outcome.providers.map((entry) => entry.candidateWorktree)).size).toBe(3);
    expect(claude.command).toContain("claude --print --output-format stream-json --verbose --permission-mode acceptEdits --settings");
    expect(claude.command).toContain("--setting-sources  --model haiku");
    expect(claude.command).not.toContain("--cd");
    expect(claude.effort).toBe("e1_brief");
    // The per-session allow list covers the fixture check (through the Project's registered validation command) and the Ask draft.
    expect(claude.permissionAllowList).toEqual(expect.arrayContaining(["Bash(node scripts/check-fixture.mjs)", "Bash(arcadia agent-ask draft:*)", "Bash(pnpm arcadia agent-ask draft:*)"]));
    const made = calls(callLog);
    const posture = made.find((call) => call.name === "claude-posture")!;
    expect(posture.settingSources).toBe("");
    expect(posture.allow).toEqual(claude.permissionAllowList);
    // Sequential, in order, one headless run each.
    expect(made.filter((call) => headlessRun(call)).map((call) => call.name))
      .toEqual(["codex", "opencode", "claude"]);
    const claudeRun = made.find((call) => headlessRun(call, "claude"))!;
    expect(claudeRun.args).toEqual(expect.arrayContaining(["--output-format", "stream-json", "--permission-mode", "acceptEdits", "--model", "haiku"]));
    expect(claudeRun.arcadiaWorkspace).toBe(path.join(base, leftoverRoots(base)[0], "claude", "exp-headless-claude"));
    expect(claudeRun.cwd).toBe(claude.candidateWorktree);
    const receipt = JSON.parse(readFileSync(outcome.receiptPath, "utf8"));
    expect(receipt.models).toEqual({ codex: "gpt-6-luna", opencode: "opencode-go/glm-5.3-flash", claude: "haiku" });
    expect(readFileSync(path.join(runDirectory, "run.log"), "utf8")).toContain("models: codex: PASS, model gpt-6-luna; opencode: PASS, model opencode-go/glm-5.3-flash; claude: PASS, model haiku");
    expect(existsSync(path.join(runDirectory, "failure-handoff.md"))).toBe(false);
    expect(outcome.providers.every((entry) => entry.failureDetails.length === 0)).toBe(true);
  }, 600_000);

  it("reports each provider independently: one fails with diagnosis lines while the others pass, and the run still succeeds", async () => {
    // Codex exits non-zero; OpenCode passes; Claude (which cannot commit under its allow list) passes through the host's preservation.
    const { run, runDirectory, callLog } = harness({ FAKE_PROVIDER_MODE_codex: "fail", FAKE_PROVIDER_MODE_opencode: "auth-broken", FAKE_PROVIDER_MODE_claude: "success" });
    const outcome = await run({ hostPreserve: hostCommits });
    expect(readFileSync(path.join(runDirectory, "run.log"), "utf8")).toContain("could not confirm a sign-in");
    expect(outcome.outcome).toBe("succeeded");
    expect(outcome.reason).toBe("opencode, claude completed the fixture Action headlessly; codex failed");
    const [codex, opencode, claude] = outcome.providers as [ProviderResult, ProviderResult, ProviderResult];
    expect([codex.outcome, opencode.outcome, claude.outcome]).toEqual(["FAIL", "PASS", "PASS"]);
    expect(criterion(codex, "exit")).toMatchObject({ pass: false });
    expect(criterion(codex, "file").pass).toBe(false);
    // The receipt alone says why: each failed criterion carries the first relevant lines of the provider's log.
    expect(codex.failureDetails.map((entry) => entry.criterion)).toEqual(["exit", "file", "validation", "commit", "ask"]);
    expect(codex.failureDetails[0].logLines.join("\n")).toContain("simulated provider failure");
    expect(codex.failureDetails.every((entry) => entry.logLines.length > 0 && entry.detail.length > 0)).toBe(true);
    expect(opencode.failureDetails).toEqual([]);
    // Claude could not commit under its headless allow list: the host's step did, and the agent part is reported apart from it.
    expect(claude).toMatchObject({ passKind: "agent_and_host", agentPart: { pass: true }, hostPart: { outcome: "preserved" } });
    expect(criterion(claude, "commit").detail).toContain("committed by host preservation, not by the agent");
    // OpenCode's non-interactive run auto-rejects an external_directory prompt (operator run 20261009T135444Z-90379): it gets a
    // per-process grant for the tree this test created, through OPENCODE_CONFIG_CONTENT, and the others get none.
    expect(opencode.model).toBe("opencode-go/glm-5.3-flash");
    expect(opencode.command).toContain("opencode run --model opencode-go/glm-5.3-flash");
    expect(opencode.candidateWorktree).not.toBe(codex.candidateWorktree);
    const ocCall = calls(callLog).find((call) => headlessRun(call, "opencode"))!;
    const grant = JSON.parse(ocCall.opencodeConfig!) as { permission: { external_directory: Record<string, string> } };
    expect(Object.values(grant.permission.external_directory).every((value) => value === "allow")).toBe(true);
    expect(Object.keys(grant.permission.external_directory)).toEqual(expect.arrayContaining([`${opencode.candidateWorktree}/**`]));
    const attemptRoot = [1, 2, 3, 4, 5].reduce((dir) => path.dirname(dir), opencode.candidateWorktree!);
    expect(Object.keys(grant.permission.external_directory)).toEqual(expect.arrayContaining([`${attemptRoot}/**`]));
    expect(Object.keys(grant.permission.external_directory).every((key) => key.endsWith("/**") && !key.endsWith("//**"))).toBe(true);
    expect(ocCall.pwd).toBe(ocCall.cwd);
    expect(calls(callLog).find((call) => headlessRun(call, "codex"))!.opencodeConfig).toBeNull();
    expect(calls(callLog).find((call) => headlessRun(call, "claude"))!.opencodeConfig).toBeNull();
    const receipt = JSON.parse(readFileSync(outcome.receiptPath, "utf8"));
    expect(receipt.providers.map((entry: ProviderResult) => entry.provider)).toEqual(["codex", "opencode", "claude"]);
    expect(receipt.providers.every((entry: ProviderResult) => existsSync(entry.logPath!))).toBe(true);
    expect(receipt.providers[0].failureDetails[0].logLines.join("\n")).toContain("simulated provider failure");
    // The failed provider's lines also appear in the printed table, and a passing run writes no failure handoff.
    expect(formatTable([codex])).toMatch(/FAIL {2}provider exited 0[^\n]*\n\s+log> .*simulated provider failure/);
    expect(existsSync(path.join(runDirectory, "failure-handoff.md"))).toBe(false);
  }, 600_000);

  it("skips only the provider whose precondition is missing, with the reason, and runs the others", async () => {
    const { run, base, callLog, runDirectory } = harness({ FAKE_PROVIDER_MODE_codex: "not-logged-in", FAKE_PROVIDER_MODE_claude: "commit" });
    const outcome = await run({ providers: ["codex", "claude"] });
    expect(outcome.outcome).toBe("succeeded");
    expect(outcome.reason).toBe("claude completed the fixture Action headlessly; codex skipped");
    const [codex, claude] = outcome.providers as [ProviderResult, ProviderResult];
    expect(codex).toMatchObject({ provider: "codex", outcome: "SKIPPED", model: null, candidateWorktree: null });
    expect(codex.reason).toMatch(/codex login status failed/);
    expect(claude.outcome).toBe("PASS");
    expect(calls(callLog).some((call) => headlessRun(call, "codex"))).toBe(false);
    expect(formatTable([codex, claude])).toMatch(/^codex: SKIPPED - codex login status failed/);
    expect(readFileSync(path.join(runDirectory, "run.log"), "utf8")).toContain("precondition (codex): SKIPPED");
    expect(JSON.parse(readFileSync(outcome.receiptPath, "utf8")).providers.map((entry: ProviderResult) => [entry.provider, entry.outcome])).toEqual([["codex", "SKIPPED"], ["claude", "PASS"]]);
    expect(leftoverRoots(base)).toEqual([]);
  }, 300_000);

  it("skips Claude when it is not logged in or lacks the headless flags, naming which", async () => {
    const loggedOut = harness({ FAKE_PROVIDER_MODE_claude: "not-logged-in" });
    const out = await loggedOut.run({ providers: ["claude"] });
    expect(out.outcome).toBe("refused");
    expect(out.providers[0]).toMatchObject({ provider: "claude", outcome: "SKIPPED" });
    expect(out.providers[0].reason).toMatch(/reports not logged in/);
    expect(out.reason).toMatch(/no selected provider can run: claude: .*not logged in/);

    // A claude whose --help omits the flags the headless posture needs is skipped by Arcadia's own launch preflight.
    const bin = temp("headless-oldclaude-");
    writeFileSync(path.join(bin, "claude"), `#!/bin/sh
case "$1" in
  auth) echo '{"loggedIn":true}' ;;
  --help) echo 'Usage: claude --print --model' ;;
esac
`);
    chmodSync(path.join(bin, "claude"), 0o755);
    const base = temp("headless-base-");
    const runDirectory = path.join(temp("headless-run-"), "runs", "run-1");
    const old = await runHeadlessProviderTest({
      repoRoot, runDirectory, runId: "run-1", scriptId: ID, keep: false, tempBase: base, liveLeakCheck: false, out: () => {},
      env: { PATH: bin, HOME: temp("headless-home-") }, toolDirectories: [], providers: ["claude"]
    });
    expect(old.outcome).toBe("refused");
    expect(old.providers[0].reason).toMatch(/permission posture is missing.*does not support --output-format, --permission-mode, --settings, --setting-sources, --verbose/);
  }, 300_000);

  it("fails Claude on an is_error result event with the error in the receipt", async () => {
    const { run } = harness({ FAKE_PROVIDER_MODE_claude: "claude-error" });
    const outcome = await run({ providers: ["claude"] });
    expect(outcome.outcome).toBe("failed");
    const [claude] = outcome.providers as [ProviderResult];
    expect(claude.outcome).toBe("FAIL");
    expect(criterion(claude, "exit").pass).toBe(false);
    expect(criterion(claude, "exit").detail).toMatch(/exit 1 after \d+s; result event is_error=true \(error_during_execution\)/);
    expect(claude.failureDetails[0]).toMatchObject({ criterion: "exit" });
    expect(claude.failureDetails[0].logLines[0]).toBe("claude result is_error=true (error_during_execution): API Error: 401 Invalid authentication credentials");
    expect(formatTable([claude])).toContain("log> claude result is_error=true (error_during_execution): API Error: 401");
  }, 300_000);

  it("passes Claude on its own part when it could not commit and the host step cannot run, citing the permission denials", async () => {
    const { run } = harness({ FAKE_PROVIDER_MODE_claude: "success" });
    const cannot = await run({ providers: ["claude"], hostPreserve: hostCannotRun });
    const [claude] = cannot.providers as [ProviderResult];
    expect(claude).toMatchObject({ outcome: "PASS", passKind: "agent_only" });
    expect(criterion(claude, "commit").detail).toMatch(/^PASS \(agent\); host preservation not exercised.*refused by the headless permission posture \(`arcadia-preserve-broker-claude`\)/);
    expect(formatTable([claude])).toContain("claude (haiku): PASS (agent); host preservation not exercised");
    const refused = await run({ providers: ["claude"], hostPreserve: hostRefuses });
    expect(refused.providers[0].passKind).toBe("agent_host_failed");
  }, 300_000);

  it("starts a provider on an operator-chosen model through the experiment workspace's own start-tier config", async () => {
    const { run, callLog } = harness({ FAKE_PROVIDER_MODE_claude: "commit", FAKE_PROVIDER_MODE_opencode: "success" });
    const outcome = await run({ providers: ["claude", "opencode"], models: { claude: "sonnet" } });
    const [claude, opencode] = outcome.providers as [ProviderResult, ProviderResult];
    expect(claude).toMatchObject({ outcome: "PASS", model: "sonnet", modelSource: "override" });
    expect(claude.command).toContain("--model sonnet");
    expect(opencode).toMatchObject({ model: "opencode-go/glm-5.3-flash", modelSource: "start-tier" });
    expect(calls(callLog).find((call) => headlessRun(call, "claude"))!.args).toEqual(expect.arrayContaining(["--model", "sonnet"]));
  }, 300_000);

  it("accepts a completion the agent settled itself (the brief's first choice), though settlement moved HEAD, and is not fooled by a descendant holding the output pipes", async () => {
    // FAKE_ORPHAN leaves a descendant in the provider's process group with its output pipes open after the provider exits.
    const { run } = harness({ FAKE_PROVIDER_MODE_codex: "settle", FAKE_ORPHAN: "1" });
    const outcome = await run({ providers: ["codex"], providerTimeoutMs: 120_000 });
    expect(outcome.outcome).toBe("succeeded");
    const [codex] = outcome.providers as [ProviderResult];
    expect(codex.outcome).toBe("PASS");
    expect(codex.timedOut).toBe(false);
    expect(codex.durationMs!).toBeLessThan(60_000);
    expect(criterion(codex, "commit").detail).toMatch(/2 commit\(s\) beyond the base/);
    expect(criterion(codex, "ask").detail).toMatch(/settled .*archive.*ancestor of HEAD.*Action status in the experiment database: done; tree clean/);
  }, 300_000);

  it("stops the provider's process group on SIGTERM, skips the fallback and still writes the receipt", async () => {
    const { run, runDirectory, callLog } = harness({ FAKE_PROVIDER_MODE_codex: "timeout" });
    const source = new EventEmitter();
    const finished = run({ providerTimeoutMs: 600_000, signalSource: source });
    const started = Date.now();
    while (!calls(callLog).some((call) => headlessRun(call, "codex"))) {
      if (Date.now() - started > 120_000) throw new Error("the stub provider never started");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    source.emit("SIGTERM");
    const outcome = await finished;
    expect(outcome.outcome).toBe("failed");
    expect(outcome.stage).toBe("interrupted");
    expect(outcome.reason).toBe("interrupted by SIGTERM");
    expect(outcome.providers.map((entry) => entry.provider)).toEqual(["codex"]);
    expect(outcome.providers[0].timedOut).toBe(false);
    expect(calls(callLog).some((call) => headlessRun(call) && call.name !== "codex")).toBe(false);
    expect(readFileSync(path.join(runDirectory, "codex.log"), "utf8")).toContain("SIGTERM received by the test");
    expect(JSON.parse(readFileSync(outcome.receiptPath, "utf8")).stage).toBe("interrupted");
  }, 300_000);

  it("kills a provider that outlives the cap, fails the table, and writes a failure handoff", async () => {
    const { run, runDirectory } = harness({ FAKE_PROVIDER_MODE_codex: "timeout" });
    const outcome = await run({ providers: ["codex"], providerTimeoutMs: 4_000 });
    expect(outcome.outcome).toBe("failed");
    const [codex] = outcome.providers as [ProviderResult];
    expect(codex).toMatchObject({ outcome: "FAIL", timedOut: true });
    expect(criterion(codex, "exit")).toMatchObject({ pass: false });
    expect(criterion(codex, "exit").detail).toContain("timed out");
    expect(readFileSync(codex.logPath!, "utf8")).toContain("timeout after 4000 ms");
    expect(codex.failureDetails.find((entry) => entry.criterion === "exit")!.logLines.join(" ")).toContain("timeout after 4000 ms");
    const handoff = readFileSync(path.join(runDirectory, "failure-handoff.md"), "utf8");
    expect(handoff).toContain("codex");
    expect(handoff).toContain("FAIL  provider exited 0");
    expect(JSON.parse(readFileSync(outcome.receiptPath, "utf8")).outcome).toBe("failed");
  }, 300_000);

  it("fails a provider whose Ask is not criterion-complete, and one that drafts no Ask, though everything else passed", async () => {
    const { run } = harness({ FAKE_PROVIDER_MODE_codex: "partial-ask", FAKE_PROVIDER_MODE_opencode: "no-ask" });
    const outcome = await run({ providers: ["codex", "opencode"] });
    expect(outcome.outcome).toBe("failed");
    const [codex, opencode] = outcome.providers as [ProviderResult, ProviderResult];
    expect(codex.outcome).toBe("FAIL");
    for (const id of ["exit", "file", "validation"]) expect(criterion(codex, id).pass).toBe(true);
    // The agent committed, but its unaccepted draft is still an untracked file: only an accepted Ask may sit there.
    expect(criterion(codex, "commit").pass).toBe(false);
    expect(criterion(codex, "commit").detail).toContain(".arcadia/asks/agent-ask-complete-write-headless-marker-fake.yaml");
    expect(criterion(codex, "ask").pass).toBe(false);
    expect(criterion(codex, "ask").detail).toMatch(/does not match the 2 declared criteria/);
    expect(opencode.outcome).toBe("FAIL");
    for (const id of ["exit", "file", "validation", "commit"]) expect(criterion(opencode, id).pass).toBe(true);
    expect(criterion(opencode, "ask")).toMatchObject({ pass: false, detail: "no Agent Ask file under .arcadia/asks/" });
  }, 300_000);

  it("fails a provider that writes the wrong marker, and one that never commits it when the host cannot preserve", async () => {
    const { run } = harness({ FAKE_PROVIDER_MODE_codex: "bad-marker", FAKE_PROVIDER_MODE_opencode: "uncommitted" });
    const outcome = await run({ providers: ["codex", "opencode"], hostPreserve: hostRefuses });
    expect(outcome.outcome).toBe("failed");
    const [wrong, uncommitted] = outcome.providers as [ProviderResult, ProviderResult];
    expect(wrong.outcome).toBe("FAIL");
    expect(criterion(wrong, "file")).toMatchObject({ pass: false });
    expect(criterion(wrong, "validation").pass).toBe(false);
    expect(criterion(wrong, "commit").pass).toBe(false);
    expect(criterion(wrong, "commit").detail).toContain("carries a different MARKER.md");
    expect(wrong.hostPart).toMatchObject({ needed: false, outcome: "not_needed" });
    expect(uncommitted.outcome).toBe("FAIL");
    expect(criterion(uncommitted, "file").pass).toBe(true);
    expect(criterion(uncommitted, "validation").pass).toBe(true);
    // No broker refusal in its log: an uncommitted candidate alone is not the sandboxed-agent case.
    expect(criterion(uncommitted, "commit").pass).toBe(false);
    expect(criterion(uncommitted, "commit").detail).toMatch(/0 commit\(s\) beyond the base.*uncommitted changes/);
    expect(uncommitted.hostPart).toMatchObject({ needed: true, attempted: true, outcome: "host_failed" });
    expect(uncommitted.passKind).toBeNull();
  }, 300_000);

  it("plays the host's role when the sandboxed agent cannot commit: agent part and host part are reported separately", async () => {
    // Codex's workspace-write sandbox denied Git's index.lock on the operator's run; the agent drafted the Ask and its broker call was refused.
    const { run } = harness({ FAKE_PROVIDER_MODE_codex: "sandboxed" });
    // The fake host commits and then reports an error: what is on the branch decides, so passKind reflects the commit.
    const outcome = await run({ providers: ["codex"], hostPreserve: hostCommitsThenFails });
    expect(outcome.outcome).toBe("succeeded");
    const [codex] = outcome.providers as [ProviderResult];
    expect(codex).toMatchObject({ outcome: "PASS", passKind: "agent_and_host" });
    expect(codex.hostPart!.detail).toContain("the candidate was committed but the step then reported: receipt write failed after the commit");
    expect(codex.agentPart).toEqual({ pass: true });
    expect(codex.hostPart).toMatchObject({ needed: true, attempted: true, outcome: "preserved" });
    expect(codex.hostPart!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(criterion(codex, "ask").detail).toContain("candidate_revision equals HEAD");
    expect(criterion(codex, "commit").detail).toContain("committed by host preservation, not by the agent");
    expect(formatTable([codex])).toContain("codex (gpt-6-luna): PASS (agent + host preservation)");
    const receipt = JSON.parse(readFileSync(outcome.receiptPath, "utf8"));
    expect(receipt.providers[0]).toMatchObject({ passKind: "agent_and_host", hostPart: { outcome: "preserved" }, agentPart: { pass: true } });
  }, 300_000);

  it("keeps a host step that could not run distinct from one that ran and refused", async () => {
    const { run } = harness({ FAKE_PROVIDER_MODE_codex: "sandboxed" });
    const cannot = await run({ providers: ["codex"], hostPreserve: hostCannotRun });
    expect(cannot.outcome).toBe("succeeded");
    const [codex] = cannot.providers as [ProviderResult];
    expect(codex).toMatchObject({ outcome: "PASS", passKind: "agent_only" });
    expect(codex.hostPart).toMatchObject({ needed: true, attempted: true, outcome: "not_exercised" });
    expect(criterion(codex, "commit")).toMatchObject({ pass: true });
    expect(criterion(codex, "commit").label).toContain("host preservation not exercised");
    expect(criterion(codex, "commit").detail).toMatch(/^PASS \(agent\); host preservation not exercised/);
    const table = formatTable([codex]);
    expect(table).toContain("codex (gpt-6-luna): PASS (agent); host preservation not exercised");
    expect(table).toContain("agent part: PASS   host part: not exercised");
  }, 300_000);

  it("reports a host step that ran and refused as host_failed, not as unexercised", async () => {
    const { run } = harness({ FAKE_PROVIDER_MODE_codex: "sandboxed" });
    const outcome = await run({ providers: ["codex"], hostPreserve: hostRefuses });
    expect(outcome.outcome).toBe("succeeded");
    const [codex] = outcome.providers as [ProviderResult];
    expect(codex).toMatchObject({ outcome: "PASS", passKind: "agent_host_failed" });
    expect(codex.hostPart).toMatchObject({ needed: true, attempted: true, outcome: "host_failed" });
    expect(criterion(codex, "commit").label).toContain("host preservation attempted and refused");
    expect(formatTable([codex])).toContain("codex (gpt-6-luna): PASS (agent); host preservation attempted and refused");
    expect(JSON.parse(readFileSync(outcome.receiptPath, "utf8")).providers[0]).toMatchObject({ passKind: "agent_host_failed", hostPart: { outcome: "host_failed" } });
  }, 300_000);
});

describe("pure helpers for the host step and the OpenCode grant", () => {
  it("recognises the broker's exact refusal only as command output, never as wording", () => {
    const refusal = "Protected preservation request path is unavailable. The preservation route heartbeat is stale";
    const event = (item: Record<string, unknown>) => JSON.stringify({ type: "item.completed", item });
    expect(brokerRefusalInLog(event({ type: "command_execution", command: "/bin/zsh -lc /x/arcadia-preserve-broker-codex", aggregated_output: refusal }))).toBe(true);
    // The agent merely talking about it, or the brief's own wording, is not command output.
    expect(brokerRefusalInLog(event({ type: "agent_message", text: `The broker said: ${refusal}` }))).toBe(false);
    expect(brokerRefusalInLog(event({ type: "command_execution", command: "echo hi", aggregated_output: refusal }))).toBe(false);
    // Case-sensitive, exact text.
    expect(brokerRefusalInLog(event({ type: "command_execution", command: "arcadia-preserve-broker-codex", aggregated_output: refusal.toLowerCase() }))).toBe(false);
    expect(brokerRefusalInLog(event({ type: "command_execution", command: "arcadia-preserve-broker-codex", aggregated_output: "heartbeat is a word here" }))).toBe(false);
    // OpenCode's plain log: the broker's name and the exact text on one line.
    expect(brokerRefusalInLog(`arcadia-preserve-broker-opencode: ${refusal}`)).toBe(true);
    expect(brokerRefusalInLog(refusal)).toBe(false);
  });

  it("allows only the accepted drafted Ask to be untracked", () => {
    const repo = temp("headless-commitstate-");
    const identity = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { env: identity, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    writeFileSync(path.join(repo, "README.md"), "x\n");
    git("add", "-A");
    git("-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();
    writeFileSync(path.join(repo, "MARKER.md"), "headless provider marker\n");
    git("add", "MARKER.md");
    git("-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "marker");
    mkdirSync(path.join(repo, ".arcadia", "asks"), { recursive: true });
    writeFileSync(path.join(repo, ".arcadia", "asks", "agent-ask-accepted.yaml"), "a\n");
    expect(commitState(repo, base, "main", ".arcadia/asks/agent-ask-accepted.yaml").pass).toBe(true);
    expect(commitState(repo, base, "main", null).pass).toBe(false);
    // A second, unaccepted file under the same directory is not tolerated.
    writeFileSync(path.join(repo, ".arcadia", "asks", "agent-ask-other.yaml"), "b\n");
    const state = commitState(repo, base, "main", ".arcadia/asks/agent-ask-accepted.yaml");
    expect(state.pass).toBe(false);
    expect(state.detail).toContain("agent-ask-other.yaml");
  });

  it("adds the per-invocation Codex trust override for exactly the named paths, before the brief", () => {
    const args = ["exec", "--json", "--model", "m", "--cd", "/w", "the brief"];
    const next = withCodexTrustOverrides(args, ["/private/var/x/fixture", "/private/var/x/worktree", "/private/var/x/fixture"]);
    expect(next).toEqual(["exec", "--json", "--model", "m", "--cd", "/w",
      "--config", 'projects."/private/var/x/fixture".trust_level="trusted"',
      "--config", 'projects."/private/var/x/worktree".trust_level="trusted"',
      "the brief"]);
    expect(codexTrustOverrideArgs([])).toEqual([]);
  });

  it("grants OpenCode both spellings of the temporary tree, nothing broader", () => {
    const grant = JSON.parse(opencodeSessionConfig("/private/var/folders/x/T/arcadia-headless-provider-test-1/opencode", "/private/var/folders/x/T/arcadia-headless-provider-test-1/opencode/exp/projects/worktrees/w/headless-fixture")) as { permission: { external_directory: Record<string, string> } };
    expect(grant.permission.external_directory).toEqual({
      "/private/var/folders/x/T/arcadia-headless-provider-test-1/opencode/**": "allow",
      "/var/folders/x/T/arcadia-headless-provider-test-1/opencode/**": "allow",
      "/private/var/folders/x/T/arcadia-headless-provider-test-1/opencode/exp/projects/worktrees/w/headless-fixture/**": "allow",
      "/var/folders/x/T/arcadia-headless-provider-test-1/opencode/exp/projects/worktrees/w/headless-fixture/**": "allow"
    });
    expect(Object.keys(grant.permission)).toEqual(["external_directory"]);
  });
});

/** One stream-json log the way `claude --print --output-format stream-json --verbose` writes it. */
const streamLog = (...events: Array<Record<string, unknown>>) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";
const initEvent = { type: "system", subtype: "init", model: "haiku" };
const toolUse = (id: string, command: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "I will run it. There was an error before, ignore it." }, { type: "tool_use", id, name: "Bash", input: { command } }] } });
const toolError = (id: string, content: string) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content }] } });

describe("Claude stream-json parsing and provider-log diagnosis", () => {
  it("reads a successful stream: model, result event and the permission denials Claude lists", () => {
    const log = streamLog(initEvent, toolUse("t1", "git commit -m x"),
      { type: "result", subtype: "success", is_error: false, num_turns: 5, duration_ms: 4100, total_cost_usd: 0.01, result: "done",
        permission_denials: [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "git commit -m x" } }, { tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "arcadia-preserve-broker-claude" } }] });
    const summary = parseClaudeStream(`plain preamble line\n${log}`);
    expect(summary).toMatchObject({ events: 3, model: "haiku", result: { subtype: "success", isError: false, numTurns: 5, durationMs: 4100, result: "done" } });
    expect(summary.permissionDenials).toEqual([{ tool: "Bash", command: "git commit -m x" }, { tool: "Bash", command: "arcadia-preserve-broker-claude" }]);
    expect(describeClaudeResult(summary)).toBe("result event ok (success), 5 turns, 2 permission denial(s)");
    // A success stream is not an error: no diagnosis lines (the model's chatter about "an error" is never picked up).
    expect(extractDiagnosis(log.replace(/"permission_denials":\[[^\]]*\]/, '"permission_denials":[]'))).toEqual([]);
    expect(claudePreservationDenied(log)).toBe("git commit -m x");
    expect(preservationBlockedEvidence("claude", log)).toMatch(/refused by the headless permission posture \(`git commit -m x`\)/);
    expect(preservationBlockedEvidence("codex", log)).toBeNull();
  });

  it("reads an error stream: the is_error result, denied tools and tool errors become the first diagnosis lines", () => {
    const log = streamLog(initEvent, toolUse("t1", "node scripts/check-fixture.mjs"),
      toolError("t1", "Claude requested permissions to use Bash, but you haven't granted it yet."),
      { type: "system", subtype: "api_retry", error: "overloaded", error_status: 529 },
      { type: "result", subtype: "error_during_execution", is_error: true, result: "API Error: 401 Invalid authentication credentials", num_turns: 2,
        permission_denials: [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "node scripts/check-fixture.mjs" } }] });
    const summary = parseClaudeStream(log);
    expect(summary.result).toMatchObject({ isError: true, subtype: "error_during_execution" });
    expect(summary.toolErrors).toEqual([{ tool: "Bash", command: "node scripts/check-fixture.mjs", message: "Claude requested permissions to use Bash, but you haven't granted it yet." }]);
    expect(describeClaudeResult(summary)).toBe("result event is_error=true (error_during_execution), 2 turns, 1 permission denial(s)");
    const lines = extractDiagnosis(log);
    expect(lines).toEqual([
      "claude result is_error=true (error_during_execution): API Error: 401 Invalid authentication credentials",
      "permission denied: Bash `node scripts/check-fixture.mjs`",
      "tool error: Bash `node scripts/check-fixture.mjs` -> Claude requested permissions to use Bash, but you haven't granted it yet.",
      "api retry: overloaded (status 529)"
    ]);
    expect(describeClaudeResult(parseClaudeStream("no events\n"))).toBe("no stream-json events in the log");
    expect(describeClaudeResult(parseClaudeStream(streamLog(initEvent)))).toBe("1 stream-json events but no result event");
  });

  it("extracts the first relevant lines from Codex JSON events and OpenCode plain text, strongest signals first, capped", () => {
    const codex = streamLog(
      { type: "thread.started", thread_id: "x" },
      { type: "item.completed", item: { type: "agent_message", text: "There was an error in my plan but I fixed it" } },
      { type: "item.completed", item: { type: "command_execution", command: "/bin/zsh -lc 'git commit -m x'", aggregated_output: "fatal: Unable to create '/tmp/r/.git/worktrees/w/index.lock': Operation not permitted", exit_code: 128 } },
      { type: "item.completed", item: { type: "command_execution", command: "ls", aggregated_output: "MARKER.md", exit_code: 0 } },
      { type: "error", message: "sandbox denied write" },
      { type: "turn.failed", error: { message: "stream disconnected" } });
    expect(extractDiagnosis(codex)).toEqual([
      "command failed (exit 128): /bin/zsh -lc 'git commit -m x' -> fatal: Unable to create '/tmp/r/.git/worktrees/w/index.lock': Operation not permitted",
      "error event: sandbox denied write",
      "turn failed: stream disconnected"
    ]);
    expect(extractDiagnosis(codex, 2)).toHaveLength(2);

    const opencode = [
      "\u001b[0m> build · glm-5.3-flash",
      "I will now write MARKER.md",
      "\u001b[33mpermission requested: external_directory (/private/var/folders/x/*); auto-rejecting\u001b[0m",
      "Error: The user rejected permission to use this specific tool call.",
      "something merely failed to be pretty",
      "permission requested: external_directory (/private/var/folders/x/*); auto-rejecting"
    ].join("\n");
    expect(extractDiagnosis(opencode)).toEqual([
      "permission requested: external_directory (/private/var/folders/x/*); auto-rejecting",
      "Error: The user rejected permission to use this specific tool call.",
      "something merely failed to be pretty"
    ]);
    expect(extractDiagnosis("")).toEqual([]);
  });
});

describe("provider selection, leak classification and the printed table", () => {
  it("parses a provider list strictly", () => {
    expect(parseProviderList("claude, codex")).toEqual(["claude", "codex"]);
    expect(() => parseProviderList("")).toThrow(/at least one/);
    expect(() => parseProviderList("codex,gemini")).toThrow(/unknown provider gemini/);
    expect(() => parseProviderList("codex,codex")).toThrow(/twice/);
  });

  it("treats only the Codex trust entry as ruled on; any other leak-check change is still a possible stop condition", () => {
    expect(classifyLeakChanges(false, null)).toEqual({ codexTrustEntry: false, otherChanges: [] });
    expect(classifyLeakChanges(true, ["hashes.codexConfig"])).toEqual({ codexTrustEntry: true, otherChanges: [] });
    expect(classifyLeakChanges(true, ["hashes.codexConfig", "hashes.claudeTrust", "liveWorkspace.queueRevision"])).toEqual({ codexTrustEntry: true, otherChanges: ["hashes.claudeTrust", "liveWorkspace.queueRevision"] });
    expect(classifyLeakChanges(true, ["hashes.claudeSettings"])).toEqual({ codexTrustEntry: false, otherChanges: ["hashes.claudeSettings"] });
    // A change whose fields cannot be read is never waved through.
    expect(classifyLeakChanges(true, null).otherChanges).toHaveLength(1);
    expect(classifyLeakChanges(true, []).otherChanges).toHaveLength(1);
  });
});

describe("the stub provider is safe by construction", () => {
  it("does nothing for Arcadia's own capacity probe and fails loudly without a workspace", () => {
    const bin = stubBin();
    const cwd = temp("headless-stub-cwd-");
    const base = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
    delete base.ARCADIA_WORKSPACE;
    const probe = spawnSync(path.join(bin, "codex"), ["app-server", "--listen", "stdio://"], { cwd, env: base, encoding: "utf8" });
    expect(probe.status).toBe(0);
    expect(readdirSync(cwd)).toEqual([]);
    const unpinned = spawnSync(path.join(bin, "codex"), ["exec", "--cd", cwd, "brief"], { cwd, env: base, encoding: "utf8" });
    expect(unpinned.status).toBe(97);
    expect(unpinned.stderr).toContain("ARCADIA_WORKSPACE is not set");
    expect(readdirSync(cwd)).toEqual([]);
  });
});

describe("refusals create nothing", () => {
  it("refuses when no selected provider is signed in, listing each one as skipped, before any workspace exists", async () => {
    const { run, base, runDirectory, callLog } = harness({ FAKE_PROVIDER_MODE_codex: "not-logged-in", FAKE_PROVIDER_MODE_opencode: "no-credentials", FAKE_PROVIDER_MODE_claude: "not-logged-in" });
    const outcome = await run();
    expect(outcome.outcome).toBe("refused");
    expect(outcome.reason).toMatch(/codex: codex login status failed/);
    expect(outcome.reason).toMatch(/claude: claude auth status --json reports not logged in/);
    expect(outcome.providers.map((entry) => [entry.provider, entry.outcome])).toEqual([["codex", "SKIPPED"], ["opencode", "SKIPPED"], ["claude", "SKIPPED"]]);
    expect(leftoverRoots(base)).toEqual([]);
    expect(calls(callLog).every((call) => ["login", "auth"].includes(call.args[0]))).toBe(true);
    expect(JSON.parse(readFileSync(outcome.receiptPath, "utf8"))).toMatchObject({ outcome: "refused", stage: "preconditions", liveWorkspaceAddressed: false });
    expect(existsSync(path.join(runDirectory, "failure-handoff.md"))).toBe(true);
  }, 60_000);

  it("refuses when the codex binary is missing", async () => {
    const base = temp("headless-base-");
    const runDirectory = path.join(temp("headless-run-"), "runs", "run-1");
    const outcome = await runHeadlessProviderTest({
      repoRoot, runDirectory, runId: "run-1", scriptId: ID, keep: false, tempBase: base, liveLeakCheck: false, out: () => {},
      // No stub and no operator tool directory: an empty directory is the whole PATH, so no real codex can be reached.
      env: { PATH: temp("headless-empty-"), HOME: temp("headless-home-") }, toolDirectories: [], providers: ["codex"]
    });
    expect(outcome.outcome).toBe("refused");
    expect(outcome.reason).toMatch(/codex was not found on PATH/);
    expect(leftoverRoots(base)).toEqual([]);
  }, 60_000);

  it("refuses after Decision 0082's experiment window", async () => {
    const { run, base } = harness();
    const outcome = await run({ now: () => new Date("2026-10-19T12:00:00Z") });
    expect(outcome.outcome).toBe("refused");
    expect(outcome.reason).toMatch(/Decision 0082's experiment window ended 2026-10-18/);
    expect(leftoverRoots(base)).toEqual([]);
  }, 60_000);
});

describe("launcher fallbacks (fake mise)", () => {
  function copiedLibrary(fakeMise: string) {
    const root = temp("headless-launcher-");
    const copy = path.join(root, "artifacts", "generated", "operator-scripts");
    mkdirSync(copy, { recursive: true });
    for (const file of [`${ID}.sh`, `${ID}.json`]) copyFileSync(path.join(library, file), path.join(copy, file));
    chmodSync(path.join(copy, `${ID}.sh`), 0o755);
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "mise"), fakeMise);
    chmodSync(path.join(bin, "mise"), 0o755);
    return { root, copy, bin };
  }
  const launch = (fixture: ReturnType<typeof copiedLibrary>, args: string[]) =>
    spawnSync(path.join(fixture.copy, `${ID}.sh`), args, { encoding: "utf8", env: { ...process.env, PATH: `${fixture.bin}${path.delimiter}${process.env.PATH}` } });
  const runDirs = (fixture: ReturnType<typeof copiedLibrary>) => readdirSync(path.join(fixture.copy, "runs")).map((entry) => path.join(fixture.copy, "runs", entry));

  it("writes a fallback receipt and handoff when the helper dies before it can, and passes --keep through", () => {
    const fixture = copiedLibrary(`#!/usr/bin/env node\nrequire("fs").writeFileSync(require("path").join(process.cwd(), "mise-args.json"), JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n`);
    const result = launch(fixture, ["run", "--keep"]);
    expect(result.status).toBe(7);
    const [runDir] = runDirs(fixture) as [string];
    const receipt = JSON.parse(readFileSync(path.join(runDir, "receipt.json"), "utf8"));
    expect(receipt).toMatchObject({ outcome: "failed", stage: "launcher", id: ID, liveWorkspaceAddressed: false });
    expect(receipt.reason).toContain("exited 7");
    expect(readFileSync(path.join(runDir, "failure-handoff.md"), "utf8")).toContain("helper exit code: 7");
    const args = JSON.parse(readFileSync(path.join(fixture.root, "mise-args.json"), "utf8")) as string[];
    expect(args.slice(0, 5)).toEqual(["exec", "--", "node", "--import", "tsx"]);
    expect(args[5]).toBe("scripts/headless-provider-test.ts");
    expect(args[6]).toBe(runDir);
    expect(args.at(-1)).toBe("--keep");
  });

  it("forwards SIGTERM to the helper and still finishes with a receipt and handoff", async () => {
    const fixture = copiedLibrary(`#!/usr/bin/env node
const fs = require("fs"), path = require("path");
process.on("SIGTERM", () => { fs.writeFileSync(path.join(process.cwd(), "got-sigterm"), "yes"); process.exit(143); });
fs.writeFileSync(path.join(process.cwd(), "helper-started"), "yes");
setInterval(() => {}, 1000);
`);
    const child = spawn(path.join(fixture.copy, `${ID}.sh`), ["run"], { env: { ...process.env, PATH: `${fixture.bin}${path.delimiter}${process.env.PATH}` }, stdio: "ignore" });
    const closed = new Promise<number | null>((resolve) => child.once("close", (code) => resolve(code)));
    const started = Date.now();
    while (!existsSync(path.join(fixture.root, "helper-started"))) {
      if (Date.now() - started > 30_000) throw new Error("the fake helper never started");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill("SIGTERM");
    const code = await closed;
    expect(code).toBe(143);
    expect(existsSync(path.join(fixture.root, "got-sigterm"))).toBe(true);
    const [runDir] = runDirs(fixture) as [string];
    expect(JSON.parse(readFileSync(path.join(runDir, "receipt.json"), "utf8"))).toMatchObject({ outcome: "failed", stage: "launcher" });
    expect(existsSync(path.join(runDir, "failure-handoff.md"))).toBe(true);
  }, 60_000);

  it("trusts a receipt the helper wrote and exits 0 when it succeeded", () => {
    const fixture = copiedLibrary(`#!/usr/bin/env node\nconst a = process.argv.slice(2);\nrequire("fs").writeFileSync(require("path").join(a[6], "receipt.json"), JSON.stringify({ schema: "arcadia-operator-run-receipt-v1", id: a[8], outcome: "succeeded" }));\n`);
    const result = launch(fixture, ["run"]);
    expect(result.status).toBe(0);
    const [runDir] = runDirs(fixture) as [string];
    expect(JSON.parse(readFileSync(path.join(runDir, "receipt.json"), "utf8")).outcome).toBe("succeeded");
    expect(existsSync(path.join(runDir, "failure-handoff.md"))).toBe(false);
  });
});
