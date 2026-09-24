import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readClaudeCodeTokenFile } from "../src/codingAgents/claudeCodeToken.js";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function setup(): { configDir: string; tokenFile: string } {
  root = mkdtempSync(path.join(tmpdir(), "arcadia-claude-code-token-"));
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  return { configDir, tokenFile: path.join(configDir, "claude-code-oauth-token") };
}

describe("readClaudeCodeTokenFile", () => {
  it("reports absent when nothing exists at the documented path", () => {
    const { configDir, tokenFile } = setup();
    expect(readClaudeCodeTokenFile(tokenFile, configDir)).toEqual({ status: "absent" });
  });

  it("reads a valid 0600 token file, stripped of trailing newlines only", () => {
    const { configDir, tokenFile } = setup();
    writeFileSync(tokenFile, "sk-ant-oat-example\n\n");
    chmodSync(tokenFile, 0o600);
    expect(readClaudeCodeTokenFile(tokenFile, configDir)).toEqual({ status: "ok", token: "sk-ant-oat-example" });
  });

  it("refuses a token file with a trailing carriage return, which the launch shell would not strip", () => {
    const { configDir, tokenFile } = setup();
    writeFileSync(tokenFile, "sk-ant-oat-example\r\n");
    chmodSync(tokenFile, 0o600);
    const result = readClaudeCodeTokenFile(tokenFile, configDir);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toContain("whitespace");
  });

  it("refuses a token file with leading whitespace", () => {
    const { configDir, tokenFile } = setup();
    writeFileSync(tokenFile, "  sk-ant-oat-example");
    chmodSync(tokenFile, 0o600);
    expect(readClaudeCodeTokenFile(tokenFile, configDir).status).toBe("refused");
  });

  it("refuses a file readable by group", () => {
    const { configDir, tokenFile } = setup();
    writeFileSync(tokenFile, "sk-ant-oat-example");
    chmodSync(tokenFile, 0o640);
    const result = readClaudeCodeTokenFile(tokenFile, configDir);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toContain("group or others");
    expect((result as { remedy: string }).remedy).toContain("chmod 600");
  });

  it("refuses a file readable by others", () => {
    const { configDir, tokenFile } = setup();
    writeFileSync(tokenFile, "sk-ant-oat-example");
    chmodSync(tokenFile, 0o604);
    expect(readClaudeCodeTokenFile(tokenFile, configDir).status).toBe("refused");
  });

  it("refuses an empty file", () => {
    const { configDir, tokenFile } = setup();
    writeFileSync(tokenFile, "");
    chmodSync(tokenFile, 0o600);
    const result = readClaudeCodeTokenFile(tokenFile, configDir);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toContain("empty");
  });

  it("refuses a file containing only whitespace", () => {
    const { configDir, tokenFile } = setup();
    writeFileSync(tokenFile, "   \n\n");
    chmodSync(tokenFile, 0o600);
    expect(readClaudeCodeTokenFile(tokenFile, configDir).status).toBe("refused");
  });

  it("refuses a symlink pointing outside the workspace config directory", () => {
    const { configDir, tokenFile } = setup();
    const outside = path.join(root!, "outside-token");
    writeFileSync(outside, "sk-ant-oat-example");
    chmodSync(outside, 0o600);
    symlinkSync(outside, tokenFile);
    const result = readClaudeCodeTokenFile(tokenFile, configDir);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toContain("symlink");
    expect((result as { reason: string }).reason).toContain("outside");
  });

  it("accepts a symlink that resolves inside the workspace config directory", () => {
    const { configDir, tokenFile } = setup();
    const real = path.join(configDir, "real-token");
    writeFileSync(real, "sk-ant-oat-example");
    chmodSync(real, 0o600);
    symlinkSync(real, tokenFile);
    expect(readClaudeCodeTokenFile(tokenFile, configDir)).toEqual({ status: "ok", token: "sk-ant-oat-example" });
  });

  it("refuses a directory at the documented path", () => {
    const { configDir, tokenFile } = setup();
    mkdirSync(tokenFile);
    const result = readClaudeCodeTokenFile(tokenFile, configDir);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toContain("not a regular file");
  });
});
