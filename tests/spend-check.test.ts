import { afterEach, describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";
import { runSpendCheckCommand } from "../src/commands/spend.js";
import { collectHostProbes, type SpendCommandResult, type SpendRunner } from "../src/spend/hostProbes.js";
import {
  assessSpendRisk, BILLING_ENV_NAMES, spendExitCode, stripBillingEnv,
  type SpendProbes, type SpendRiskCode, type SpendReport
} from "../src/spend/spendCheck.js";

const SECRET = "sk-ant-SENTINEL-do-not-print-0123456789";
const NOW = new Date("2026-11-10T00:00:00Z");

const clearClaude = (): NonNullable<SpendProbes["claude"]> => ({
  auth: { status: "ok", value: { kind: "subscription" } },
  apiKeyHelper: { status: "ok", value: false },
  extraUsage: { status: "ok", value: { enabled: false, profileFetchedAt: "2026-11-09T00:00:00Z" } },
  customApiKeyApproved: { status: "ok", value: false }
});
const clearCodex = (): NonNullable<SpendProbes["codex"]> => ({
  loginStatus: { status: "ok", value: "Logged in using ChatGPT" },
  credits: { status: "ok", value: false }
});
const clearOpenCode = (): NonNullable<SpendProbes["opencode"]> => ({ paidIntelligenceRoute: { status: "ok", value: false } });
const allClear = (): SpendProbes => ({ claude: clearClaude(), codex: clearCodex(), opencode: clearOpenCode() });
const assess = (env: NodeJS.ProcessEnv, probes: SpendProbes, model?: string): SpendReport => assessSpendRisk(env, probes, { now: NOW, model });
const codesOf = (report: SpendReport, id: string) => report.providers.find((p) => p.id === id)!.codes;

describe("assessSpendRisk risk codes (table)", () => {
  const cases: Array<{ code: SpendRiskCode; provider: string; env?: NodeJS.ProcessEnv; probes?: () => SpendProbes; model?: string }> = [
    { code: "api_key_in_launch_env", provider: "claude", env: { ANTHROPIC_API_KEY: SECRET } },
    { code: "api_key_in_launch_env", provider: "claude", env: { ANTHROPIC_AUTH_TOKEN: SECRET } },
    { code: "api_key_in_launch_env", provider: "codex", env: { OPENAI_API_KEY: SECRET } },
    { code: "api_key_in_launch_env", provider: "codex", env: { CODEX_API_KEY: SECRET } },
    { code: "third_party_provider", provider: "claude", env: { CLAUDE_CODE_USE_BEDROCK: "1" } },
    { code: "third_party_provider", provider: "claude", env: { CLAUDE_CODE_USE_VERTEX: "true" } },
    { code: "third_party_provider", provider: "claude", env: { CLAUDE_CODE_USE_FOUNDRY: "1" } },
    { code: "third_party_provider", provider: "claude", env: { ANTHROPIC_BASE_URL: "https://gateway.example.com" } },
    { code: "api_key_helper", provider: "claude", probes: () => ({ ...allClear(), claude: { ...clearClaude(), apiKeyHelper: { status: "ok", value: true } } }) },
    { code: "not_subscription_auth", provider: "claude", probes: () => ({ ...allClear(), claude: { ...clearClaude(), auth: { status: "ok", value: { kind: "not_subscription" } } } }) },
    { code: "not_subscription_auth", provider: "claude", probes: () => ({ ...allClear(), claude: { ...clearClaude(), auth: { status: "ok", value: { kind: "signed_out" } } } }) },
    { code: "not_subscription_auth", provider: "codex", probes: () => ({ ...allClear(), codex: { ...clearCodex(), loginStatus: { status: "ok", value: "Logged in using an API key" } } }) },
    { code: "extra_usage_enabled", provider: "claude", probes: () => ({ ...allClear(), claude: { ...clearClaude(), extraUsage: { status: "ok", value: { enabled: true, profileFetchedAt: null } } } }) },
    { code: "purchased_credits_available", provider: "codex", probes: () => ({ ...allClear(), codex: { ...clearCodex(), credits: { status: "ok", value: true } } }) },
    { code: "paid_model_route", provider: "opencode", model: "anthropic/claude-sonnet" },
    { code: "paid_model_route", provider: "opencode", probes: () => ({ ...allClear(), opencode: { paidIntelligenceRoute: { status: "ok", value: true } } }) }
  ];
  it.each(cases)("$code ($provider) gives a risk verdict naming that code", ({ code, provider, env, probes, model }) => {
    const report = assess(env ?? {}, probes?.() ?? allClear(), model);
    expect(report.verdict).toBe("risk");
    expect(report.providers.find((p) => p.id === provider)!.verdict).toBe("risk");
    expect(codesOf(report, provider)).toContain(code);
    expect(spendExitCode(report.verdict)).toBe(3);
  });
});

describe("assessSpendRisk clear and unknown", () => {
  it("false-alarm regression: claude.ai/firstParty, no billing variables, extra usage off, banner text present is clear", () => {
    const env = { PATH: "/usr/bin", CLAUDE_BANNER: "Claude API", ANTHROPIC_BASE_URL: "" };
    const report = assess(env, { claude: clearClaude() });
    expect(report.providers.length).toBe(3);
    const only = assessSpendRisk(env, { claude: clearClaude() }, { providers: ["claude"], now: NOW });
    expect(only.verdict).toBe("clear");
    expect(only.providers[0].codes).toEqual([]);
    expect(spendExitCode(only.verdict)).toBe(0);
  });

  it("all providers clear gives clear and notional_cost_only is a warning, not a code", () => {
    const report = assess({}, allClear());
    expect(report.verdict).toBe("clear");
    expect(report.warnings).toContain("notional_cost_only");
  });

  it("a missing claude binary gives unknown (exit 4)", () => {
    const report = assessSpendRisk({}, { claude: { ...clearClaude(), auth: { status: "unavailable", reason: "binary_missing" } } }, { providers: ["claude"], now: NOW });
    expect(report.verdict).toBe("unknown");
    expect(spendExitCode(report.verdict)).toBe(4);
    expect(report.providers[0].probes.find((p) => p.id === "not_subscription_auth")).toMatchObject({ status: "unknown", reason: "binary_missing" });
  });

  it("risk outranks unknown", () => {
    const probes = { claude: { ...clearClaude(), auth: { status: "unavailable" as const, reason: "probe_failed" as const } } };
    expect(assessSpendRisk({ ANTHROPIC_API_KEY: SECRET }, probes, { providers: ["claude"], now: NOW }).verdict).toBe("risk");
  });

  it("an uncollected provider probe is unknown, never clear", () => {
    expect(assessSpendRisk({}, {}, { providers: ["codex"], now: NOW }).verdict).toBe("unknown");
  });

  it("approved_custom_api_key is a warning only", () => {
    const probes = { claude: { ...clearClaude(), customApiKeyApproved: { status: "ok" as const, value: true } } };
    const report = assessSpendRisk({}, probes, { providers: ["claude"], now: NOW });
    expect(report.verdict).toBe("clear");
    expect(report.warnings).toContain("approved_custom_api_key");
  });

  it("reports the cached profile age", () => {
    const report = assessSpendRisk({}, { claude: clearClaude() }, { providers: ["claude"], now: NOW });
    expect(report.providers[0].probes.find((p) => p.id === "extra_usage_enabled")!.profileAgeHours).toBe(24);
  });
});

describe("adversarial environment handling", () => {
  const claudeCodes = (env: NodeJS.ProcessEnv) => assessSpendRisk(env, { claude: clearClaude() }, { providers: ["claude"], now: NOW }).providers[0].codes;

  it("empty and whitespace-only values are absent", () => {
    expect(claudeCodes({ ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "   \t", ANTHROPIC_BASE_URL: "  ", CLAUDE_CODE_USE_BEDROCK: "" })).toEqual([]);
  });
  it("a non-empty value counts even when padded", () => {
    expect(claudeCodes({ ANTHROPIC_API_KEY: `  ${SECRET} ` })).toEqual(["api_key_in_launch_env"]);
  });
  it("name case variants are counted", () => {
    expect(claudeCodes({ anthropic_api_key: SECRET })).toEqual(["api_key_in_launch_env"]);
    expect(claudeCodes({ Claude_Code_Use_Bedrock: "1" })).toEqual(["third_party_provider"]);
  });
  it("USE_* switches explicitly off are not a provider", () => {
    expect(claudeCodes({ CLAUDE_CODE_USE_BEDROCK: "0", CLAUDE_CODE_USE_VERTEX: "false" })).toEqual([]);
  });
  it("ANTHROPIC_BASE_URL: first party with or without a trailing slash is fine; other hosts and shapes are not", () => {
    expect(claudeCodes({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" })).toEqual([]);
    expect(claudeCodes({ ANTHROPIC_BASE_URL: "https://api.anthropic.com/" })).toEqual([]);
    expect(claudeCodes({ ANTHROPIC_BASE_URL: "https://API.anthropic.com//" })).toEqual([]);
    for (const url of ["https://api.anthropic.com.evil.example", "https://evil.example/https://api.anthropic.com", "http://api.anthropic.com", "https://api.anthropic.com/v1", "https://user:pw@api.anthropic.com", "https://api.anthropic.com?x=1", "not a url", "https://example.com"]) {
      expect(claudeCodes({ ANTHROPIC_BASE_URL: url }), url).toEqual(["third_party_provider"]);
    }
  });
  it("opencode model prefix must be exactly opencode-go/", () => {
    const report = (model: string) => assessSpendRisk({}, { opencode: clearOpenCode() }, { providers: ["opencode"], model, now: NOW });
    expect(report("opencode-go/glm-5").verdict).toBe("clear");
    expect(report("opencode/glm-5").verdict).toBe("risk");
    expect(report("xopencode-go/glm-5").verdict).toBe("risk");
  });
  it("no --model skips the model test and says so", () => {
    const entry = assessSpendRisk({}, { opencode: clearOpenCode() }, { providers: ["opencode"], now: NOW }).providers[0].probes.find((p) => p.id === "paid_model_route.model");
    expect(entry!.status).toBe("skipped");
  });
  it("stripBillingEnv removes every billing variable in any case and nothing else", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/bin", KEEP: "1" };
    for (const name of BILLING_ENV_NAMES) { env[name] = SECRET; env[name.toLowerCase()] = SECRET; }
    expect(stripBillingEnv(env)).toEqual({ PATH: "/bin", KEEP: "1" });
  });
});

describe("secret sentinel never leaves", () => {
  it("is absent from every field of a risk report with the sentinel in every env slot and as model", () => {
    const env: NodeJS.ProcessEnv = { SENTINEL_FIELD: SECRET };
    for (const name of BILLING_ENV_NAMES) env[name] = SECRET;
    const probes: SpendProbes = {
      claude: { ...clearClaude(), auth: { status: "ok", value: { kind: "not_subscription" } } },
      codex: { loginStatus: { status: "ok", value: `Logged in using an API key ${SECRET}` }, credits: { status: "ok", value: true } },
      opencode: clearOpenCode()
    };
    const report = assessSpendRisk(env, probes, { now: NOW, model: `provider/${SECRET}` });
    expect(report.verdict).toBe("risk");
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(JSON.stringify(report)).not.toContain("SENTINEL");
  });
});

describe("collectHostProbes and the command", () => {
  const ok = (stdout: string): SpendCommandResult => ({ status: 0, stdout, stderr: "", error: null });
  const files = (map: Record<string, string>) => (file: string) => (file in map ? map[file] : null);
  const home = "/home/fixture";
  const goodFiles = files({
    [`${home}/.claude.json`]: JSON.stringify({ oauthAccount: { hasExtraUsageEnabled: false, profileFetchedAt: "2026-11-09T00:00:00Z", emailAddress: SECRET } }),
    [`${home}/.arcadia/telemetry/coding-agent-usage.json`]: JSON.stringify({ providers: { "codex-cli": { capturedAt: "2026-11-09T07:00:00.000Z", credits: { hasCredits: false } } } })
  });
  const subscriptionRunner: SpendRunner = ({ command }) => command === "claude"
    ? ok(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: SECRET }))
    : ok("Logged in using ChatGPT");
  const deps = { runner: subscriptionRunner, readText: goodFiles, homeDir: home, cwd: "/work", now: NOW };

  it("a fixture subscription host is clear across all providers, with banner text in the environment", () => {
    const run = runSpendCheckCommand({}, { ...deps, env: { PATH: "/bin", BANNER: "Claude API" } });
    expect(run.data.verdict).toBe("clear");
  });

  it("a missing claude binary is unknown and the output has no sentinel", () => {
    const runner: SpendRunner = ({ command }) => command === "claude"
      ? { status: null, stdout: "", stderr: `spawn claude ENOENT ${SECRET}`, error: "ENOENT" }
      : ok("Logged in using ChatGPT");
    const run = runSpendCheckCommand({ provider: "claude" }, { ...deps, runner, env: { SOME: SECRET } });
    expect(run.data.verdict).toBe("unknown");
    expect(JSON.stringify(run)).not.toContain(SECRET);
  });

  it("an api-key auth status is risk and its account fields are not echoed", () => {
    const runner: SpendRunner = () => ok(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty", email: SECRET }));
    const run = runSpendCheckCommand({ provider: "claude" }, { ...deps, runner, env: {} });
    expect(run.data.providers[0].codes).toEqual(["not_subscription_auth"]);
    expect(JSON.stringify(run)).not.toContain(SECRET);
  });

  it("an apiKeyHelper in a project settings file is risk, and unreadable settings are unknown", () => {
    const withHelper = files({ ...Object.fromEntries([[`${home}/.claude.json`, goodFiles(`${home}/.claude.json`)!]]), "/work/.claude/settings.local.json": JSON.stringify({ apiKeyHelper: `echo ${SECRET}` }) });
    const run = runSpendCheckCommand({ provider: "claude" }, { ...deps, readText: withHelper, env: {} });
    expect(run.data.providers[0].codes).toEqual(["api_key_helper"]);
    expect(JSON.stringify(run)).not.toContain(SECRET);
    const broken = files({ [`${home}/.claude.json`]: goodFiles(`${home}/.claude.json`)!, [`${home}/.claude/settings.json`]: "{not json" });
    expect(runSpendCheckCommand({ provider: "claude" }, { ...deps, readText: broken, env: {} }).data.verdict).toBe("unknown");
  });

  it("--launch-env stripped removes billing variables before any probe runs", () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const runner: SpendRunner = (input) => { seen.push(input.env); return subscriptionRunner(input); };
    const env: NodeJS.ProcessEnv = { PATH: "/bin" };
    for (const name of BILLING_ENV_NAMES) env[name] = SECRET;
    const current = runSpendCheckCommand({ launchEnv: "current" }, { ...deps, runner, env });
    expect(current.data.verdict).toBe("risk");
    const callsBefore = seen.length;
    const stripped = runSpendCheckCommand({ launchEnv: "stripped" }, { ...deps, runner, env });
    expect(stripped.data.verdict).toBe("clear");
    expect(seen.length).toBeGreaterThan(callsBefore);
    for (const probeEnv of seen.slice(callsBefore)) {
      for (const name of BILLING_ENV_NAMES) expect(probeEnv[name]).toBeUndefined();
      expect(probeEnv.PATH).toBe("/bin");
    }
    expect(JSON.stringify(stripped)).not.toContain(SECRET);
  });

  const codexOnly = (runner: SpendRunner, readText = goodFiles) => runSpendCheckCommand({ provider: "codex" }, { ...deps, runner, readText, env: {} });
  const codexLogin = (text: { stdout?: string; stderr?: string; status?: number | null; error?: string | null }): SpendRunner =>
    () => ({ status: 0, stdout: "", stderr: "", error: null, ...text });
  const loginEntry = (run: ReturnType<typeof codexOnly>) => run.data.providers[0].probes.find((p) => p.id === "not_subscription_auth")!;

  it("codex login: empty output, a spawn error and a failure with garbage are unknown, never risk", () => {
    expect(codexOnly(codexLogin({})).data.verdict).toBe("unknown");
    expect(loginEntry(codexOnly(codexLogin({}))).status).toBe("unknown");
    expect(loginEntry(codexOnly(codexLogin({ status: null, error: "ENOENT" }))).status).toBe("unknown");
    expect(loginEntry(codexOnly(codexLogin({ status: 1, stderr: "sandbox: operation not permitted" }))).status).toBe("unknown");
  });
  it("codex login: an API-key or not-logged-in result is risk; ChatGPT on stderr only is clear", () => {
    expect(codexOnly(codexLogin({ stderr: "Logged in using an API key - sk-xxx" })).data.providers[0].codes).toContain("not_subscription_auth");
    expect(codexOnly(codexLogin({ status: 1, stderr: "Not logged in" })).data.providers[0].codes).toContain("not_subscription_auth");
    const clear = codexOnly(codexLogin({ stderr: "Logged in using ChatGPT\n" }));
    expect(clear.data.verdict).toBe("clear");
  });
  it("apiKeyHelper in a managed-settings.d drop-in is risk; an unreadable or malformed drop-in is unknown", () => {
    const dir = "/Library/Application Support/ClaudeCode/managed-settings.d";
    const base = { [`${home}/.claude.json`]: goodFiles(`${home}/.claude.json`)! };
    const run = (map: Record<string, string>, throwing = false) => runSpendCheckCommand({ provider: "claude" }, {
      ...deps, env: {}, listDir: (d) => (d === dir ? ["10-a.json", "notes.txt"] : null),
      readText: throwing ? (f) => { if (f.startsWith(dir)) throw new Error("denied"); return files(base)(f); } : files({ ...base, ...map })
    });
    const found = run({ [`${dir}/10-a.json`]: JSON.stringify({ apiKeyHelper: `echo ${SECRET}` }) });
    expect(found.data.providers[0].codes).toEqual(["api_key_helper"]);
    expect(JSON.stringify(found)).not.toContain(SECRET);
    expect(run({ [`${dir}/10-a.json`]: "{broken" }).data.verdict).toBe("unknown");
    expect(run({}, true).data.verdict).toBe("unknown");
    expect(run({ [`${dir}/10-a.json`]: "{}" }).data.verdict).toBe("clear");
  });
  it("codex credits: stale or undated telemetry is unknown, fresh is clear", () => {
    const telemetry = (codex: object) => files({ [`${home}/.claude.json`]: goodFiles(`${home}/.claude.json`)!, [`${home}/.arcadia/telemetry/coding-agent-usage.json`]: JSON.stringify({ providers: { "codex-cli": codex } }) });
    const creditsEntry = (run: ReturnType<typeof codexOnly>) => run.data.providers[0].probes.find((p) => p.id === "purchased_credits_available")!.status;
    const login = codexLogin({ stderr: "Logged in using ChatGPT" });
    expect(creditsEntry(codexOnly(login, telemetry({ capturedAt: "2026-11-08T00:00:00Z", credits: { hasCredits: false } })))).toBe("unknown");
    expect(creditsEntry(codexOnly(login, telemetry({ credits: { hasCredits: false } })))).toBe("unknown");
    expect(creditsEntry(codexOnly(login, telemetry({ capturedAt: "2026-11-09T12:00:00Z", credits: { hasCredits: false } })))).toBe("clear");
  });
  it("without --model the opencode model probe is reported as skipped in the JSON", () => {
    const run = runSpendCheckCommand({ provider: "opencode" }, { ...deps, env: {} });
    expect(run.data.providers[0].probes).toContainEqual({ id: "paid_model_route.model", status: "skipped" });
  });

  it("validates --provider and --launch-env", () => {
    expect(() => runSpendCheckCommand({ provider: "gemini" }, deps)).toThrow(/--provider/);
    expect(() => runSpendCheckCommand({ launchEnv: "x" }, deps)).toThrow(/--launch-env/);
  });

  it("collects only requested providers' probes", () => {
    const ran: string[] = [];
    collectHostProbes({}, ["codex"], { ...deps, runner: (input) => { ran.push(input.command); return ok("Logged in using ChatGPT"); } });
    expect(ran).toEqual(["codex"]);
  });
});

describe("CLI registration", () => {
  afterEach(() => { process.exitCode = undefined; });
  it("registers spend check with the documented options", () => {
    const check = buildProgram().commands.find((c) => c.name() === "spend")!.commands.find((c) => c.name() === "check")!;
    expect(check.options.map((o) => o.long)).toEqual(expect.arrayContaining(["--provider", "--launch-env", "--model", "--json"]));
  });
  it("--json prints the verdict and sets exit code 3 on a risk fixture (opencode, no probes run)", async () => {
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = SECRET;
    try {
      await buildProgram().parseAsync(["node", "arcadia", "spend", "check", "--provider", "opencode", "--model", "opencode-go/x", "--launch-env", "current", "--json"]);
    } finally {
      process.stdout.write = write;
      if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
    }
    const output = lines.join("");
    const parsed = JSON.parse(output) as { data: SpendReport };
    expect(parsed.data.verdict).toBe("risk");
    expect(parsed.data.providers[0].codes).toEqual(["api_key_in_launch_env"]);
    expect(process.exitCode).toBe(3);
    expect(output).not.toContain(SECRET);
  });
  it("maps verdicts to exit codes 0, 3, 4", () => {
    expect([spendExitCode("clear"), spendExitCode("risk"), spendExitCode("unknown")]).toEqual([0, 3, 4]);
  });
});
