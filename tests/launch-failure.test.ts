import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validationError } from "../src/cli/errors.js";
import { systemTmux } from "../src/sessions/index.js";
import { formatLaunchFailure, LAUNCH_FAILURE_MAX_CHARS } from "../src/sessions/launchFailure.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("launch failure diagnostics", () => {
  it("retains provider exception causes through both native and Arcadia wrappers", () => {
    const failure = validationError("Provider launch failed.", {
      cause: new Error("Provider adapter refused.", { cause: new Error("known provider failure") }),
      argv: ["do not serialize arbitrary details"]
    });
    expect(formatLaunchFailure(failure)).toBe("Provider launch failed. Cause: Provider adapter refused. Cause: known provider failure");
  });

  it("uses child stderr instead of a message containing command arguments", () => {
    const error = Object.assign(new Error("Command failed: tmux PRIVATE_PROMPT"), {
      stderr: Buffer.from("known subprocess failure\n")
    });
    expect(formatLaunchFailure(error)).toBe("known subprocess failure");
    expect(formatLaunchFailure(Object.assign(error, { stderr: "", status: 7 }))).toBe("Subprocess launch failed (exit 7).");
  });

  it("bounds verbose diagnostics after redacting secrets and terminal controls", () => {
    const token = "sk-ant-" + "s".repeat(40);
    const output = formatLaunchFailure(new Error(`\u001b[31mknown cause\u001b[0m\nCLAUDE_CODE_OAUTH_TOKEN=${token}\n` + "noise".repeat(20_000)));
    expect(output).toContain("known cause");
    expect(output).not.toContain(token);
    expect(output).not.toContain("\u001b");
    expect(output).toContain("[redacted");
    expect(output).toHaveLength(LAUNCH_FAILURE_MAX_CHARS);
    expect(output).toMatch(/\[truncated\]$/);
  });

  it("terminates circular causes and retains non-Error exceptions", () => {
    const error = new Error("circular launch error");
    error.cause = error;
    expect(formatLaunchFailure(error)).toBe("circular launch error");
    expect(formatLaunchFailure("known string failure")).toBe("known string failure");
  });

  it.each([
    { label: "OSC", input: "\u001b]" + "x".repeat(65518) + "\u0007API_KEY=abcdefghijklmno" },
    { label: "CSI", input: "\u001b[" + "0;".repeat(32757) + "m" + "sk-" + "S".repeat(40) }
  ])("redacts a secret after a removable $label sequence at the input boundary", ({ input }) => {
    const output = formatLaunchFailure(new Error(input));
    expect(output).toContain("[redacted");
    expect(output).not.toContain("abcdefg");
    expect(output).not.toContain("sk-SSS");
  });
});

describe("system tmux launch failures", () => {
  function launchWith(script?: string) {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-launch-failure-"));
    roots.push(root);
    if (script !== undefined) {
      const executable = path.join(root, "tmux");
      writeFileSync(executable, `#!/bin/sh\n${script}\n`);
      chmodSync(executable, 0o755);
    }
    vi.stubEnv("PATH", root);
    return () => systemTmux.launch({ name: "fixture", cwd: root, command: "PRIVATE_PAYLOAD", args: ["PRIVATE_ARGUMENT"] });
  }

  it("keeps an unavailable-executable cause without a null-stderr failure", () => {
    const launch = launchWith();
    expect(launch).toThrow(/ENOENT/);
    expect(launch).toThrow(/^spawnSync tmux ENOENT$/);
  });

  it("reports a nonzero exit without stderr and never includes the provider payload", () => {
    const launch = launchWith("exit 7");
    expect(launch).toThrow("tmux new-session failed (7).");
  });

  it("keeps known stderr while discarding an unrelated stdout payload", () => {
    const launch = launchWith("printf 'PRIVATE_STDOUT'\nprintf 'known adapter stderr' >&2\nexit 1");
    expect(launch).toThrow("known adapter stderr");
    try { launch(); } catch (error) {
      expect(String(error)).not.toMatch(/PRIVATE_(PAYLOAD|ARGUMENT|STDOUT)/);
    }
  });

  it("withholds an incomplete credential line when real subprocess stderr exceeds the capture limit", () => {
    const launch = launchWith("printf '\\033]' >&2\nprintf '%65518s' x >&2\nprintf '\\007API_KEY=abcdefghijklmno' >&2\nexit 1");
    let caught: unknown;
    try { launch(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain("ENOBUFS");
    expect(String(caught)).toContain("incomplete stderr line withheld");
    expect(String(caught)).not.toContain("abcdefg");
  });
});
