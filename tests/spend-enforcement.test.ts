import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.fn();
const spawnSyncMock = vi.fn();
const spawnMock = vi.fn();
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

import { checkProviderSignIn } from "../src/codingAgents/signIn.js";
import { createClaudeCodeCliTextExecutor } from "../src/intelligence/claudeCode/textExecutor.js";
import { createCodexCliImageExecutor } from "../src/intelligence/codex/imageExecutor.js";
import { createCodexCliTextExecutor } from "../src/intelligence/codex/textExecutor.js";
import type { IntelligenceV01Config } from "../src/intelligence/config/types.js";
import type { IntelligenceJob } from "../src/intelligence/types.js";
import { refuseUnlessSignedIn } from "../src/sessions/launchPreflight.js";
import type { SpendCommandResult, SpendRunner } from "../src/spend/hostProbes.js";
import { hasBillingVariable } from "../src/spend/billingEnv.js";
import { BILLING_ENV_NAMES, type SpendReport } from "../src/spend/spendCheck.js";
import { billingUnsetArgs, evaluateLaunchSpend, spendRefusalMessage } from "../src/spend/spendGuard.js";

const SECRET = "sk-ant-SENTINEL-do-not-print-0123456789";
const NOW = new Date("2026-11-10T00:00:00Z");
const ENV = { PATH: "/usr/bin" } as NodeJS.ProcessEnv;

const ok = (stdout: string, stderr = ""): SpendCommandResult => ({ status: 0, stdout, stderr, error: null });
const claudeHome = JSON.stringify({ oauthAccount: { hasExtraUsageEnabled: false, profileFetchedAt: "2026-11-09T00:00:00Z" } });
/** A fixture host: `claude auth status` and `codex login status` answer as given; files are absent except the claude account. */
function host(answers: { claude?: SpendCommandResult; codex?: SpendCommandResult }) {
  const runner: SpendRunner = ({ command }) => (command === "claude" ? answers.claude : answers.codex) ?? { status: null, stdout: "", stderr: "", error: "ENOENT" };
  return {
    env: ENV, runner, now: NOW, homeDir: "/home/fixture", cwd: "/cwd/fixture",
    listDir: () => null,
    readText: (file: string) => (file.endsWith(".claude.json") ? claudeHome : null)
  };
}
const subscription = ok(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }));
const apiKeyAuth = ok(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" }));

afterEach(() => {
  execFileSyncMock.mockReset();
  spawnSyncMock.mockReset();
  spawnMock.mockReset();
});

describe("checkProviderSignIn uses assessSpendRisk", () => {
  it("refuses a Claude launch whose auth method is not a subscription (api_key)", () => {
    execFileSyncMock.mockReturnValue(JSON.stringify({ loggedIn: true }));
    const status = checkProviderSignIn("claude-code-cli", undefined, ENV, { spend: host({ claude: apiKeyAuth }), readCredentialState: () => ({ status: "unknown" }) });
    expect(status).toMatchObject({ signedIn: true, spend: { provider: "claude", verdict: "risk", codes: expect.arrayContaining(["not_subscription_auth"]) } });
    expect(() => refuseUnlessSignedIn("claude-code-cli", status)).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "spend_risk" }) }));
  });

  it("a subscription Claude launch with extra usage off is clear", () => {
    execFileSyncMock.mockReturnValue(JSON.stringify({ loggedIn: true }));
    const status = checkProviderSignIn("claude-code-cli", undefined, ENV, { spend: host({ claude: subscription }), readCredentialState: () => ({ status: "unknown" }) });
    expect(status).toMatchObject({ signedIn: true });
    expect(status?.spend).toBeUndefined();
  });

  it("refuses a Codex launch whose login is not ChatGPT", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "", error: undefined });
    const status = checkProviderSignIn("codex-cli", undefined, ENV, { spend: host({ codex: ok("", "Logged in using an API key") }) });
    expect(status).toMatchObject({ signedIn: true, spend: { provider: "codex", verdict: "risk", codes: expect.arrayContaining(["not_subscription_auth"]) } });
    expect(() => refuseUnlessSignedIn("codex-cli", status)).toThrow(/spend check for codex could spend money \(not_subscription_auth/);
  });

  it("refuses an OpenCode launch whose model is not opencode-go/", () => {
    for (const model of ["opencode/big-pickle", "huggingface/some-model", "anthropic/claude-sonnet", "OPENCODE-GO/x", " other/x"]) {
      const status = checkProviderSignIn("opencode-cli", undefined, ENV, { model, spend: host({}) });
      expect(status, model).toMatchObject({ signedIn: true, spend: { provider: "opencode", verdict: "risk", codes: expect.arrayContaining(["paid_model_route"]) } });
      expect(() => refuseUnlessSignedIn("opencode-cli", status), model).toThrow(/spend_risk|could spend money/);
    }
  });

  it("an opencode-go/ model with no paid route is not refused on the model", () => {
    const status = checkProviderSignIn("opencode-cli", undefined, ENV, { model: "opencode-go/glm-5.3-flash", spend: { ...host({}), report: (id) => ({ verdict: "clear", providers: [{ id, verdict: "clear", codes: [], probes: [] }], warnings: [], checkedAt: NOW.toISOString() }) } });
    expect(status).toBeNull();
  });

  it("an unknown verdict refuses exactly like risk, with its own code", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "", error: undefined });
    // `codex` missing from the fixture host: the login probe is unavailable, so unknown.
    const status = checkProviderSignIn("codex-cli", undefined, ENV, { spend: host({}) });
    expect(status).toMatchObject({ signedIn: true, spend: { provider: "codex", verdict: "unknown" } });
    expect(() => refuseUnlessSignedIn("codex-cli", status)).toThrow(expect.objectContaining({
      details: expect.objectContaining({ code: "spend_unknown", conflict: true })
    }));
  });

  it("a clear Codex verdict leaves sign-in untouched", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "", error: undefined });
    const clearHost = { ...host({ codex: ok("", "Logged in using ChatGPT") }), readText: (file: string) => (file.endsWith("coding-agent-usage.json")
      ? JSON.stringify({ providers: { "codex-cli": { capturedAt: NOW.toISOString(), credits: { hasCredits: false } } } }) : null) };
    const status = checkProviderSignIn("codex-cli", undefined, ENV, { spend: clearHost });
    expect(status).toMatchObject({ signedIn: true });
    expect(status?.spend).toBeUndefined();
  });

  it("a signed-out provider is reported as signed out first, without a spend verdict", () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "", error: undefined });
    const status = checkProviderSignIn("codex-cli", undefined, ENV, { spend: host({ codex: ok("", "Logged in using an API key") }) });
    expect(status).toMatchObject({ signedIn: false });
    expect(status?.spend).toBeUndefined();
  });
});

describe("strip by construction", () => {
  it("unsets every billing variable by name", () => {
    const args = billingUnsetArgs({});
    for (const name of BILLING_ENV_NAMES) expect(args.join(" ")).toContain(`-u ${name}`);
    expect(args.filter((_, index) => index % 2 === 0).every((flag) => flag === "-u")).toBe(true);
  });

  it("also unsets a lowercase or mixed-case spelling that is present, since env -u is case sensitive", () => {
    const args = billingUnsetArgs({ anthropic_api_key: SECRET, Openai_Api_Key: SECRET, PATH: "/usr/bin" });
    expect(args).toContain("anthropic_api_key");
    expect(args).toContain("Openai_Api_Key");
    expect(args).not.toContain("PATH");
    expect(args.join(" ")).not.toContain(SECRET);
  });

  it("an empty-string key counts as absent, like the spend check, but is still unset by name", () => {
    expect(hasBillingVariable({ ANTHROPIC_API_KEY: "" }, ["ANTHROPIC_API_KEY"])).toBe(false);
    expect(hasBillingVariable({ ANTHROPIC_API_KEY: "  " }, ["ANTHROPIC_API_KEY"])).toBe(false);
    expect(hasBillingVariable({ anthropic_api_key: "x" }, ["ANTHROPIC_API_KEY"])).toBe(true);
    expect(billingUnsetArgs({ ANTHROPIC_API_KEY: "" }).join(" ")).toContain("-u ANTHROPIC_API_KEY");
  });

  it("judges the stripped environment: a launcher's API key does not make the child's verdict risk", () => {
    const base = host({ claude: subscription });
    for (const env of [{ ...ENV, ANTHROPIC_API_KEY: SECRET }, { ...ENV, anthropic_api_key: SECRET }, { ...ENV, ANTHROPIC_API_KEY: "" }]) {
      const result = evaluateLaunchSpend("claude-code-cli", undefined, { ...base, env });
      expect(result.verdict).toBe("clear");
    }
  });

  it("a refusal message names codes and probe ids but never a variable's value or the model", () => {
    const result = evaluateLaunchSpend("opencode-cli", `anthropic/${SECRET}`, { ...host({}), env: { ...ENV, OPENAI_API_KEY: SECRET } });
    expect(result.verdict).toBe("risk");
    const message = spendRefusalMessage(result)!;
    expect(message).toContain("paid_model_route");
    expect(message).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("a provider the check does not cover is clear (nothing documented to refuse on)", () => {
    expect(evaluateLaunchSpend("gemini-cli", undefined, host({})).verdict).toBe("clear");
    expect(spendRefusalMessage(evaluateLaunchSpend("gemini-cli", undefined, host({})))).toBeNull();
  });
});

describe("the Intelligence CLI executors refuse on risk or unknown and strip billing variables", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  const root = () => { const dir = mkdtempSync(path.join(tmpdir(), "arcadia-exec-spend-")); roots.push(dir); return dir; };
  const config = { codexCli: { command: "codex", args: [], timeoutMs: 1000 }, claudeCodeCli: { command: "claude", args: [], timeoutMs: 1000 } } as unknown as IntelligenceV01Config;
  const job = { id: "job_spend", request: { type: "text.generate", input: {} } } as unknown as IntelligenceJob;
  const report = (verdict: "risk" | "unknown"): ((id: "claude" | "codex" | "opencode") => SpendReport) => (id) => ({
    verdict, providers: [{ id, verdict, codes: verdict === "risk" ? ["api_key_helper"] : [], probes: verdict === "unknown" ? [{ id: "not_subscription_auth", status: "unknown", reason: "binary_missing" }] : [] }],
    warnings: [], checkedAt: NOW.toISOString()
  });
  const executors: Array<[string, (spend: { report: ReturnType<typeof report> }) => { execute(job: IntelligenceJob): Promise<unknown> }]> = [
    ["claude code text", (spendCheck) => createClaudeCodeCliTextExecutor({ workspaceRoot: root(), config, spendCheck })],
    ["codex text", (spendCheck) => createCodexCliTextExecutor({ workspaceRoot: root(), config, spendCheck })],
    ["codex image", (spendCheck) => createCodexCliImageExecutor({ workspaceRoot: root(), config, artifactStore: {} as never, spendCheck })]
  ];

  it.each(executors)("%s refuses a risk verdict before spawning", async (_name, make) => {
    await expect(make({ report: report("risk") }).execute(job)).rejects.toMatchObject({ code: "SPEND_RISK", message: expect.stringContaining("api_key_helper") });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each(executors)("%s refuses an unknown verdict before spawning", async (_name, make) => {
    await expect(make({ report: report("unknown") }).execute(job)).rejects.toMatchObject({ code: "SPEND_UNKNOWN", message: expect.stringContaining("not_subscription_auth:binary_missing") });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("a clear verdict spawns the CLI with every billing variable stripped from its environment", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vi.stubEnv("OPENAI_API_KEY", SECRET);
    spawnMock.mockImplementation(() => { throw new Error("stop after spawn"); });
    const clear = (id: "claude" | "codex" | "opencode"): SpendReport => ({ verdict: "clear", providers: [{ id, verdict: "clear", codes: [], probes: [] }], warnings: [], checkedAt: NOW.toISOString() });
    for (const make of [
      () => createClaudeCodeCliTextExecutor({ workspaceRoot: root(), config, spendCheck: { report: clear } }),
      () => createCodexCliTextExecutor({ workspaceRoot: root(), config, spendCheck: { report: clear } })
    ]) await make().execute(job).catch(() => undefined);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    for (const call of spawnMock.mock.calls) {
      const env = (call[2] as { env: NodeJS.ProcessEnv }).env;
      expect(Object.keys(env).some((key) => BILLING_ENV_NAMES.includes(key.toUpperCase()))).toBe(false);
    }
    vi.unstubAllEnvs();
  });
});
