import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIXTURE_ACTION,
  buildPath,
  renderFixtureFiles,
  runHeadlessProviderTest,
  sanitizedEnv,
  type HeadlessTestOptions,
  type ProviderResult
} from "../src/operatorActions/headlessProviderTest.js";
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
const TITLE = "Test headless Codex single-Action run, OpenCode on failure (experiment fixture)";
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
  for (const name of ["codex", "opencode"]) {
    copyFileSync(stubSource, path.join(bin, name));
    chmodSync(path.join(bin, name), 0o755);
  }
  return bin;
}

const calls = (file: string): Array<{ name: string; args: string[]; cwd: string; arcadiaWorkspace: string | null; operatorId: string | null; author: string | null }> =>
  existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

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
  const run = (options: Partial<Pick<HeadlessTestOptions, "keep" | "providers" | "providerTimeoutMs" | "now" | "signalSource">> = {}) =>
    runHeadlessProviderTest({
      repoRoot, runDirectory, runId: "run-1", scriptId: ID, keep: options.keep ?? false, env, tempBase: base, liveLeakCheck: false,
      killGraceMs: 200, out: () => {}, ...options
    });
  return { run, runDirectory, base, callLog, env };
}

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
      "$TMPDIR, not workspaces/exp-*", "attribute before any further experiment"]) {
      expect(text).toContain(required);
    }
    expect(descriptor.preconditions.join(" ")).toContain("codex login status");
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
  it("passes on Codex through the entry script, keeps the fixture on --keep, and never starts OpenCode", () => {
    const { env, callLog, base, runDirectory } = harness();
    // The same entry point the launcher runs under mise, run here with node directly so the case needs no mise trust write.
    const launched = spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "scripts", "headless-provider-test.ts"), runDirectory, "run-1", ID, "--keep"], {
      encoding: "utf8", cwd: repoRoot, timeout: 240_000,
      env: { ...env, ARCADIA_HEADLESS_TEST_LEAK_CHECK: "0", TMPDIR: base }
    });
    expect(launched.status, launched.stdout + launched.stderr).toBe(0);

    const receipt = JSON.parse(readFileSync(path.join(runDirectory, "receipt.json"), "utf8"));
    expect(receipt).toMatchObject({ schema: "arcadia-operator-run-receipt-v1", id: ID, outcome: "succeeded", liveWorkspaceAddressed: false, keep: true });
    expect(receipt.providers).toHaveLength(1);
    const [codex] = receipt.providers as ProviderResult[];
    expect(codex).toMatchObject({ provider: "codex", outcome: "PASS", model: "gpt-5.6-terra", exitCode: 0, timedOut: false });
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
    expect(made.some((call) => call.name === "opencode" && call.args[0] === "run")).toBe(false);
    const exec = made.find((call) => call.name === "codex" && call.args[0] === "exec")!;
    // The provider resolves the experiment workspace, never the live default, carries no operator-script context, and signs as the resolved agent.
    expect(exec.arcadiaWorkspace).toBe(path.join(leftoverRoots(base).map((entry) => path.join(base, entry))[0], "codex", "exp-headless-codex"));
    expect(exec.operatorId).toBeNull();
    expect(exec.author).toBeTruthy();
    expect(exec.args).toEqual(expect.arrayContaining(["--model", "gpt-5.6-terra", "--sandbox", "workspace-write", "--cd"]));
    expect(exec.cwd).toBe(codex.candidateWorktree);
    // A stub never acts outside the temporary directory (Arcadia's own `codex app-server` probe once ran one in the checkout).
    expect(made.filter((call) => ["exec", "run"].includes(call.args[0])).every((call) => call.cwd.startsWith(base))).toBe(true);

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
    while (!calls(callLog).some((call) => call.name === "codex" && call.args[0] === "exec")) {
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
    expect(calls(callLog).some((call) => call.name === "opencode" && call.args[0] === "run")).toBe(false);
    expect(readFileSync(path.join(runDirectory, "codex.log"), "utf8")).toContain("SIGTERM received by the test");
    expect(JSON.parse(readFileSync(outcome.receiptPath, "utf8")).stage).toBe("interrupted");
  }, 300_000);

  it("falls back to OpenCode on a fresh fixture only after Codex fails, and cleans up", async () => {
    // OpenCode's credential listing is not a contract: an uncertain answer warns and proceeds instead of refusing.
    const { run, runDirectory, base, callLog } = harness({ FAKE_PROVIDER_MODE_codex: "fail", FAKE_PROVIDER_MODE_opencode: "auth-broken" });
    const outcome = await run();
    expect(readFileSync(path.join(runDirectory, "run.log"), "utf8")).toContain("could not confirm a sign-in");
    expect(outcome.outcome).toBe("succeeded");
    expect(outcome.providers.map((entry) => [entry.provider, entry.outcome])).toEqual([["codex", "FAIL"], ["opencode", "PASS"]]);
    const [codex, opencode] = outcome.providers as [ProviderResult, ProviderResult];
    expect(criterion(codex, "exit")).toMatchObject({ pass: false });
    expect(criterion(codex, "file").pass).toBe(false);
    expect(opencode.model).toBe("opencode-go/deepseek-v4.1-flash");
    expect(opencode.command).toContain("opencode run --model opencode-go/deepseek-v4.1-flash");
    expect(opencode.candidateWorktree).not.toBe(codex.candidateWorktree);
    const receipt = JSON.parse(readFileSync(outcome.receiptPath, "utf8"));
    expect(receipt.providers.map((entry: ProviderResult) => entry.provider)).toEqual(["codex", "opencode"]);
    expect(receipt.providers.every((entry: ProviderResult) => existsSync(entry.logPath!))).toBe(true);
    expect(existsSync(path.join(runDirectory, "failure-handoff.md"))).toBe(false);
    expect(calls(callLog).filter((call) => call.args[0] === "run" || call.args[0] === "exec").map((call) => call.name)).toEqual(["codex", "opencode"]);
    // Without --keep the temporary workspaces and fixtures go; the run directory stays.
    expect(leftoverRoots(base)).toEqual([]);
    expect(existsSync(opencode.candidateWorktree!)).toBe(false);
    expect(existsSync(path.join(runDirectory, "run.log"))).toBe(true);
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
    const handoff = readFileSync(path.join(runDirectory, "failure-handoff.md"), "utf8");
    expect(handoff).toContain("codex");
    expect(handoff).toContain("FAIL  provider exited 0");
    expect(JSON.parse(readFileSync(outcome.receiptPath, "utf8")).outcome).toBe("failed");
  }, 300_000);

  it("fails a provider whose Ask is not criterion-complete, and one that drafts no Ask, though everything else passed", async () => {
    const { run } = harness({ FAKE_PROVIDER_MODE_codex: "partial-ask", FAKE_PROVIDER_MODE_opencode: "no-ask" });
    const outcome = await run();
    expect(outcome.outcome).toBe("failed");
    const [codex, opencode] = outcome.providers as [ProviderResult, ProviderResult];
    expect(codex.outcome).toBe("FAIL");
    for (const id of ["exit", "file", "validation", "commit"]) expect(criterion(codex, id).pass).toBe(true);
    expect(criterion(codex, "ask").pass).toBe(false);
    expect(criterion(codex, "ask").detail).toMatch(/does not match the 2 declared criteria/);
    expect(opencode.outcome).toBe("FAIL");
    for (const id of ["exit", "file", "validation", "commit"]) expect(criterion(opencode, id).pass).toBe(true);
    expect(criterion(opencode, "ask")).toMatchObject({ pass: false, detail: "no Agent Ask file under .arcadia/asks/" });
  }, 300_000);

  it("fails a provider that writes the wrong marker, and one that never commits it", async () => {
    const { run } = harness({ FAKE_PROVIDER_MODE_codex: "bad-marker", FAKE_PROVIDER_MODE_opencode: "uncommitted" });
    const outcome = await run();
    expect(outcome.outcome).toBe("failed");
    const [wrong, uncommitted] = outcome.providers as [ProviderResult, ProviderResult];
    expect(wrong.outcome).toBe("FAIL");
    expect(criterion(wrong, "file")).toMatchObject({ pass: false });
    expect(criterion(wrong, "validation").pass).toBe(false);
    expect(criterion(wrong, "commit").pass).toBe(false);
    expect(criterion(wrong, "commit").detail).toContain("carries a different MARKER.md");
    expect(uncommitted.outcome).toBe("FAIL");
    expect(criterion(uncommitted, "file").pass).toBe(true);
    expect(criterion(uncommitted, "validation").pass).toBe(true);
    expect(criterion(uncommitted, "commit").pass).toBe(false);
    expect(criterion(uncommitted, "commit").detail).toMatch(/0 commit\(s\) beyond the base.*uncommitted changes/);
  }, 300_000);
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
  it("refuses when Codex is not signed in, before any workspace exists", async () => {
    const { run, base, runDirectory, callLog } = harness({ FAKE_PROVIDER_MODE_codex: "not-logged-in" });
    const outcome = await run();
    expect(outcome.outcome).toBe("refused");
    expect(outcome.reason).toMatch(/codex login status failed/);
    expect(outcome.providers).toEqual([]);
    expect(leftoverRoots(base)).toEqual([]);
    expect(calls(callLog).every((call) => call.args[0] === "login")).toBe(true);
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
