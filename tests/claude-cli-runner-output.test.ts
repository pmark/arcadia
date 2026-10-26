import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runClaudeCliHeadless } from "../src/production/capacityPreAdmission.js";

// Every subprocess is our disposable fake executable; no installed CLI/provider/credentials.
let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "arcadia-runner-output-"));
  vi.stubEnv("HOME", root);
  vi.stubEnv("TMPDIR", root);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
function fakeClaude(body: string): string {
  const bin = path.join(root, "bin"), record = path.join(root, "cwd.json");
  mkdirSync(bin);
  const executable = path.join(bin, "claude");
  writeFileSync(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.cwd()));\n${body}\n`);
  chmodSync(executable, 0o755);
  vi.stubEnv("PATH", bin);
  return record;
}
function cleaned(record: string): void { expect(existsSync(JSON.parse(readFileSync(record, "utf8")))).toBe(false); }

describe.runIf(process.platform !== "win32")("bounded Claude CLI output receipts (#1804)", () => {
  it("retains a stdout-only failure and removes its private cwd", async () => {
    const record = fakeClaude("process.stdout.write('stdout-only diagnostic'); process.exitCode = 1;");
    const result = await runClaudeCliHeadless([], 2000);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("exit 1");
    expect(result.detail).toContain("stdout-only diagnostic");
    cleaned(record);
  });
  it("retains separate stderr and stdout diagnostics", async () => {
    const record = fakeClaude("process.stderr.write('stderr reason'); process.stdout.write('stdout reason'); process.exitCode = 2;");
    const result = await runClaudeCliHeadless([], 2000);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("stderr reason");
    expect(result.detail).toContain("stdout reason");
    cleaned(record);
  });
  it("redacts secrets and terminal controls before returning persistable detail", async () => {
    const record = fakeClaude("process.stderr.write('\\u001b[31mfailure\\u001b[0m token=fixture-secret-value Bearer abcdefghijklmnopqrstuvwxyz'); process.exitCode = 1;");
    const result = await runClaudeCliHeadless([], 2000);
    expect(result.detail).toContain("failure");
    expect(result.detail).not.toMatch(/fixture-secret-value|abcdefghijklmnopqrstuvwxyz/);
    expect(result.detail).not.toContain(String.fromCharCode(27));
    cleaned(record);
  });
  it("drains output arriving after direct-child exit before reporting failure", async () => {
    const record = fakeClaude("require('node:child_process').spawn(process.execPath, ['-e', \"setTimeout(() => process.stdout.write('late stdout diagnostic'), 40)\"], {stdio:['ignore','inherit','inherit']}).unref(); process.exit(1);");
    const result = await runClaudeCliHeadless([], 2000);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("late stdout diagnostic");
    cleaned(record);
  });
  it("bounds a post-exit inherited pipe instead of hanging or treating exit0 as success", async () => {
    const record = fakeClaude("require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 800)'], {stdio:['ignore','inherit','inherit']}).unref(); process.exit(0);");
    const result = await runClaudeCliHeadless([], 2000);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("stdio drain");
    cleaned(record);
  });
  it("kills at the bound, retains the diagnostic once, and cleans the cwd", async () => {
    const record = fakeClaude("process.stdout.write('waiting diagnostic'); setInterval(() => {}, 1000);");
    const result = await runClaudeCliHeadless([], 2000);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("SIGKILL");
    expect(result.detail).toContain("waiting diagnostic");
    cleaned(record);
  });
  it("bounds both output streams without deadlocking large writes", async () => {
    const record = fakeClaude("process.stderr.write('stderr reason ' + 's'.repeat(200000)); process.stdout.write('stdout reason ' + 'o'.repeat(200000)); process.exitCode = 1;");
    const result = await runClaudeCliHeadless([], 2000);
    expect(result.ok).toBe(false);
    expect(result.detail.length).toBeLessThanOrEqual(300);
    expect(result.detail).toContain("stderr reason");
    expect(result.detail).toContain("stdout reason");
    cleaned(record);
  });
  it("reports spawn errors and cleans the private directory without a second completion", async () => {
    vi.stubEnv("PATH", path.join(root, "missing-bin"));
    const result = await runClaudeCliHeadless([], 2000);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("ENOENT");
    expect(readdirSync(root).filter(name => name.startsWith("arcadia-claude-refresh-"))).toEqual([]);
  });
});
