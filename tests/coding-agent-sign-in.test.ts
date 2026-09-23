import { afterEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args)
}));

import { checkProviderSignIn } from "../src/codingAgents/signIn.js";

/**
 * `checkProviderSignIn`'s claude-code-cli probe is a no-op under `VITEST`
 * (tests must never depend on the host's real Claude Code sign-in state),
 * so exercising the probe itself here needs that guard lifted around the
 * mocked `execFileSync` call.
 */
function withoutVitestGuard<T>(run: () => T): T {
  const original = process.env.VITEST;
  delete process.env.VITEST;
  try {
    return run();
  } finally {
    if (original !== undefined) process.env.VITEST = original;
  }
}

describe("checkProviderSignIn", () => {
  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  it("returns null for a provider with no documented check, leaving launch unchecked", () => {
    expect(checkProviderSignIn("codex-cli")).toBeNull();
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("reports a confirmed signed-in provider from claude auth status --json", () => {
    execFileSyncMock.mockReturnValue(JSON.stringify({ loggedIn: true }));
    const result = withoutVitestGuard(() => checkProviderSignIn("claude-code-cli"));
    expect(result).toMatchObject({ signedIn: true });
  });

  it("reports a confirmed signed-out provider with a remedy", () => {
    execFileSyncMock.mockReturnValue(JSON.stringify({ loggedIn: false }));
    const result = withoutVitestGuard(() => checkProviderSignIn("claude-code-cli"));
    expect(result).toMatchObject({ signedIn: false });
    expect(result?.remedy).toContain("claude auth login");
  });

  it("reports a confirmed signed-out provider even when the CLI exits nonzero, as it does with no sign-in", () => {
    // `claude auth status` exits nonzero on a confirmed "no sign-in" result
    // while still printing its JSON verdict; execFileSync throws in that case
    // but attaches the captured stdout to the error.
    const nonzeroExit = Object.assign(new Error("Command failed"), {
      status: 1,
      stdout: JSON.stringify({ loggedIn: false })
    });
    execFileSyncMock.mockImplementation(() => {
      throw nonzeroExit;
    });
    const result = withoutVitestGuard(() => checkProviderSignIn("claude-code-cli"));
    expect(result).toMatchObject({ signedIn: false });
  });

  it("throws, rather than reporting a confirmed sign-out, when the claude executable is missing", () => {
    const spawnError = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    execFileSyncMock.mockImplementation(() => {
      throw spawnError;
    });
    expect(() => withoutVitestGuard(() => checkProviderSignIn("claude-code-cli"))).toThrow(
      /executable was not found/
    );
  });

  it("throws, rather than reporting a confirmed sign-out, on unparsable probe output", () => {
    execFileSyncMock.mockReturnValue("not json");
    expect(() => withoutVitestGuard(() => checkProviderSignIn("claude-code-cli"))).toThrow(/could not parse/);
  });
});
