import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readOpenCodeUsage, reduceOpenCodeExport, type OpenCodeUsageDependencies } from "../src/codingAgents/opencodeUsage.js";
import { readProviderUsage } from "../src/codingAgents/providerUsage.js";
import { runProviderUsageCommand } from "../src/commands/providerUsage.js";

const now = new Date("2026-10-22T20:00:00Z");
const session = "ses_synthetic";
function fixture(count = 2) {
  return {
    info: { id: session, time: { updated: now.getTime() - 1000 }, title: "secret-title", directory: "/private/secret" },
    messages: [{
      info: { id: "msg_synthetic", sessionID: session, role: "assistant", providerID: "opencode-go", modelID: "deepseek-v4.1-flash", time: { completed: now.getTime() - 2000 }, cost: 9999, tokens: { input: 9999 }, secret: "secret-metadata" },
      parts: Array.from({ length: count }, (_, i) => ({
        id: `prt_${i}`, messageID: "msg_synthetic", sessionID: session, type: "step-finish", reason: "stop", cost: i === 0 ? 0 : 0.01,
        tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 0 } }, snapshot: "/secret-path", private: "secret-part",
      })),
    }],
  };
}
function read(data: unknown, options = { exportFile: "explicit.json" }) {
  return readOpenCodeUsage(options, now, { readExport: () => JSON.stringify(data) })!;
}
const dirs: string[] = [];
function temp() { const dir = mkdtempSync(path.join(tmpdir(), "arcadia-opencode-usage-")); dirs.push(dir); return dir; }
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("OpenCode safe local session telemetry", () => {
  it("reduces every one of 47 steps without message double-counting or claiming account allowance", () => {
    const result = read(fixture(47));
    expect(result).toMatchObject({ observation: "local_export", source: "export_file", accountQuota: null, accountBinding: "unknown", windows: [], cliVersion: null });
    expect(result.coverage).toEqual({ status: "complete", assistantMessages: 1, meteredMessages: 1,
      unmeteredMessages: 0, errorMessages: 0, incompleteMessages: 0, pendingUserMessage: false });
    expect(result.sessionIdSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.steps).toHaveLength(47);
    expect(result.steps.reduce((sum, step) => sum + step.tokens.input, 0)).toBe(470);
    expect(result.steps[0]).toMatchObject({ providerID: "opencode-go", modelID: "deepseek-v4.1-flash", reportedModelCost: 0 });
    expect(result.steps[0].tokens).toEqual({ input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 0 } });
    expect(result.sourceUpdatedAt).toBe("2026-10-22T19:59:59.000Z");
    const serialized = JSON.stringify(result);
    for (const secret of ["secret-", "/private", "msg_synthetic", "prt_0", session, "9999"]) expect(serialized).not.toContain(secret);
  });

  it("drops text, paths, tools, errors and unknown data even when an import was not sanitized", () => {
    const data = fixture();
    const payload = JSON.parse(JSON.stringify(data));
    payload.messages[0].parts.push({ type: "text", text: "secret-prompt", path: "/secret" }, { type: "tool", state: { input: "secret-token", output: "secret-tool-output" } });
    payload.messages.push({ info: { id: "msg_user", sessionID: session, role: "user", private: "secret-user" }, parts: [{ type: "text", text: "secret-user-prompt" }] });
    expect(JSON.stringify(read(payload))).not.toContain("secret");
  });

  it("reports 47 metered messages and four failed unmetered messages as partial coverage", () => {
    const data = JSON.parse(JSON.stringify(fixture())); data.messages = [];
    for (let i = 0; i < 51; i++) {
      const message = JSON.parse(JSON.stringify(fixture(1).messages[0]));
      message.info.id = `msg_${i}`;
      if (i >= 47) { message.info.error = { message: "secret-error" }; message.parts = []; }
      else { message.parts[0].id = `prt_${i}`; message.parts[0].messageID = message.info.id; }
      data.messages.push(message);
    }
    const result = read(data);
    expect(result).toMatchObject({ observation: "local_export", outcome: "partial_coverage", accountQuota: null,
      coverage: { status: "partial", assistantMessages: 51, meteredMessages: 47, unmeteredMessages: 4, errorMessages: 4 } });
    expect(result.steps).toHaveLength(47);
    expect(JSON.stringify(result)).not.toContain("secret-error");
    data.messages = data.messages.slice(47);
    expect(read(data)).toMatchObject({ observation: "unavailable", outcome: "missing_steps", coverage: null, steps: [] });
  });

  it("deduplicates identical steps and refuses conflicting ones", () => {
    const data = fixture();
    data.messages[0].parts.push(structuredClone(data.messages[0].parts[0]));
    expect(read(data).steps).toHaveLength(2);
    data.messages[0].parts[2].cost = 1;
    expect(read(data)).toMatchObject({ observation: "unavailable", outcome: "conflicting_step", steps: [] });
  });

  it.each([-1, NaN, Infinity, null, "10", undefined])("refuses invalid or missing metric %s without partial usage", value => {
    const data = JSON.parse(JSON.stringify(fixture()));
    data.messages[0].parts[1].tokens.input = value;
    expect(read(data)).toMatchObject({ observation: "unavailable", outcome: "invalid_metrics", steps: [] });
  });

  it("rejects nonfinite JSON exponents, missing buckets, negative cost and incomplete sessions", () => {
    const data = JSON.parse(JSON.stringify(fixture()));
    expect(readOpenCodeUsage({ exportFile: "explicit" }, now, { readExport: () => JSON.stringify(data).replace('"input":10', '"input":1e999') })).toMatchObject({ outcome: "invalid_metrics", steps: [] });
    delete data.messages[0].parts[1].tokens.cache;
    expect(read(data).observation).toBe("unavailable");
    const negative = fixture(); negative.messages[0].parts[0].cost = -0.1;
    expect(read(negative).outcome).toBe("invalid_metrics");
    const incomplete = JSON.parse(JSON.stringify(fixture())); delete incomplete.messages[0].info.time.completed;
    expect(read(incomplete)).toMatchObject({ outcome: "partial_coverage", coverage: { status: "partial", incompleteMessages: 1 } });
    incomplete.messages[0].info.time.completed = now.getTime() - 2000; incomplete.messages[0].info.error = { message: "secret-error" };
    expect(read(incomplete)).toMatchObject({ outcome: "partial_coverage", coverage: { errorMessages: 1 } });
  });

  it("does not interpret empty, wrong-session, duplicate-message or future data as zero current usage", () => {
    expect(read(fixture(0))).toMatchObject({ outcome: "missing_steps", steps: [] });
    const other = fixture(); other.messages[0].parts[0].sessionID = "ses_other";
    expect(read(other).outcome).toBe("session_mismatch");
    const duplicate = fixture(); duplicate.messages.push(structuredClone(duplicate.messages[0]));
    expect(read(duplicate).outcome).toBe("duplicate_message");
    const future = fixture(); future.info.time.updated = now.getTime() + 1;
    expect(read(future)).toMatchObject({ outcome: "future_source_timestamp", sourceUpdatedAt: null, steps: [] });
    const lagging = fixture(); lagging.info.time.updated = 0;
    expect(read(lagging)).toMatchObject({ observation: "local_export", sourceUpdatedAt: "1970-01-01T00:00:00.000Z", latestAssistantCompletedAt: "2026-10-22T19:59:58.000Z" });
    lagging.messages[0].info.time.completed = now.getTime() + 1;
    expect(read(lagging).outcome).toBe("future_source_timestamp");
  });

  it("rejects truncated 65536-byte exit-zero stdout and oversized exports", () => {
    const large = JSON.parse(JSON.stringify(fixture())); large.private = "secret".repeat(12000);
    const collectSession = vi.fn(() => ({ text: JSON.stringify(large).slice(0, 65536), cliVersion: "1.16.2" }));
    expect(readOpenCodeUsage({ session }, now, { collectSession })).toMatchObject({ outcome: "invalid_json", observation: "unavailable", steps: [] });
    expect(() => reduceOpenCodeExport(" ".repeat(8 * 1024 * 1024 + 1))).toThrow("export_too_large");
  });

  it("reads only an explicitly named file and never falls back after an explicit failure", () => {
    const dir = temp(); const file = path.join(dir, "export.json"); writeFileSync(file, JSON.stringify(fixture()));
    expect(readOpenCodeUsage({ exportFile: file }, now)?.steps).toHaveLength(2);
    expect(readOpenCodeUsage({ exportFile: path.join(dir, "missing") }, now)).toMatchObject({ outcome: "export_unavailable", steps: [] });
    const deps: OpenCodeUsageDependencies = { collectSession: vi.fn(() => { throw new Error("secret-error"); }), readExport: vi.fn() };
    expect(readOpenCodeUsage({ session }, now, deps)).toMatchObject({ outcome: "export_unavailable", steps: [] });
    expect(deps.collectSession).toHaveBeenCalledExactlyOnceWith(session);
    expect(deps.readExport).not.toHaveBeenCalled();
  });

  it("does no OpenCode collection absent an explicit option, including account refresh", async () => {
    const opencode = { collectSession: vi.fn(), readExport: vi.fn() };
    const d = { opencode, readClaudeCache: () => null, loadClaude: async () => null, readCodex: () => ({ ok: false as const, failure: { kind: "timeout" as const, exitStatus: null, signal: null, detail: "" } }) };
    const defaultRead = await readProviderUsage({ now }, d);
    const refresh = await readProviderUsage({ now, refresh: true }, d);
    expect(defaultRead.providers[2]).not.toHaveProperty("sessionUsage");
    expect(refresh.providers[2]).not.toHaveProperty("sessionUsage");
    expect(opencode.collectSession).not.toHaveBeenCalled(); expect(opencode.readExport).not.toHaveBeenCalled();
  });

  it("supports the CLI export option and safe JSON persistence without echoing its path", async () => {
    const dir = temp(); const file = path.join(dir, "secret-export.json");
    const data = fixture(); data.info.time.updated = 0; data.messages[0].info.time.completed = 0;
    writeFileSync(file, JSON.stringify(data));
    const response = await runProviderUsageCommand({ opencodeExport: file }, { readClaudeCache: () => null });
    const output = JSON.stringify(response);
    expect(output).toContain('"observation":"local_export"');
    expect(output).not.toContain(file); expect(output).not.toContain("secret-");
  });

  it("keeps explicit session telemetry separate from account status and other credentials", async () => {
    const loadClaude = vi.fn(); const readCodex = vi.fn();
    const result = await readProviderUsage({ now, opencodeSession: session }, { loadClaude, readCodex, readClaudeCache: () => null, opencode: { collectSession: () => ({ text: JSON.stringify(fixture()), cliVersion: "1.16.2" }) } });
    expect(result.providers[2]).toMatchObject({ observation: "unsupported", requestAttempted: false, windows: [], sessionUsage: { observation: "local_export", cliVersion: "1.16.2", accountQuota: null } });
    expect(loadClaude).not.toHaveBeenCalled(); expect(readCodex).not.toHaveBeenCalled();
    await expect(runProviderUsageCommand({ opencodeSession: session, opencodeExport: "other" })).rejects.toThrow("Choose either");
    expect(readOpenCodeUsage({ session: "--help" }, now)).toMatchObject({ outcome: "invalid_session_id" });
  });

  it.skipIf(process.platform === "win32")("drains a synthetic CLI export larger than a pipe buffer through the supported PTY", () => {
    const dir = temp();
    const data = JSON.parse(JSON.stringify(fixture(47))); data.private = "secret".repeat(12000);
    const file = path.join(dir, "fixture.json"); writeFileSync(file, JSON.stringify(data));
    const cli = path.join(dir, "opencode");
    writeFileSync(cli, `#!/usr/bin/env python3
import sys, json
if sys.argv[1:] == ["--version"]: print("1.16.2")
else: sys.stdout.write(open(${JSON.stringify(file)}).read())
`);
    chmodSync(cli, 0o700); vi.stubEnv("PATH", dir + path.delimiter + process.env.PATH);
    expect(readOpenCodeUsage({ session }, now)).toMatchObject({ observation: "local_export", cliVersion: "1.16.2", steps: expect.any(Array) });
    expect(readOpenCodeUsage({ session }, now)?.steps).toHaveLength(47);
  });

  it.skipIf(process.platform === "win32")("bounds an idle exporter deadline and kills its descendant process group", async () => {
    const dir = temp(); const marker = path.join(dir, "timed-out-child"); const cli = path.join(dir, "opencode");
    writeFileSync(cli, `#!/usr/bin/env python3\nimport subprocess,sys,time\nsubprocess.Popen([sys.executable,"-c",${JSON.stringify(`import time; time.sleep(16); open(${JSON.stringify(marker)}, "w").write("bad")`)}])\ntime.sleep(60)\n`);
    chmodSync(cli, 0o700); vi.stubEnv("PATH", dir + path.delimiter + process.env.PATH);
    const start = Date.now();
    expect(readOpenCodeUsage({ session }, now)).toMatchObject({ observation: "unavailable", outcome: "collector_failed", steps: [] });
    expect(Date.now() - start).toBeLessThan(20000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(existsSync(marker)).toBe(false);
  }, 25000);

  it.skipIf(process.platform === "win32")("kills the exporter process group on oversized output without persisting transcript bytes", async () => {
    const dir = temp(); const marker = path.join(dir, "unreaped-child"); const cli = path.join(dir, "opencode");
    writeFileSync(cli, `#!/usr/bin/env python3
import subprocess,sys,time
subprocess.Popen([sys.executable,"-c",${JSON.stringify(`import time; time.sleep(1); open(${JSON.stringify(marker)}, "w").write("bad")`)}])
sys.stdout.write("x" * 9000000)
sys.stdout.flush()
time.sleep(5)
`);
    chmodSync(cli, 0o700); vi.stubEnv("PATH", dir + path.delimiter + process.env.PATH);
    expect(readOpenCodeUsage({ session }, now)).toMatchObject({ observation: "unavailable", outcome: "collector_failed", steps: [] });
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect(existsSync(marker)).toBe(false);
  });
});
