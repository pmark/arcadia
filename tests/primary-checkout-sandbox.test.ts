import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRIMARY_CHECKOUT_SANDBOX_EXEC,
  guardPrimaryCheckoutLaunch,
  primaryCheckoutSandboxProfile
} from "../src/sessions/primaryCheckoutSandbox.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), "arcadia-primary-guard-"));
  roots.push(value);
  return value;
}

describe("primary checkout launch guard", () => {
  it("refuses overlapping primary and candidate paths", () => {
    const fixture = root();
    const primary = path.join(fixture, "primary");
    const candidate = path.join(primary, "candidate");
    mkdirSync(candidate, { recursive: true });
    expect(() => primaryCheckoutSandboxProfile(primary, candidate)).toThrow("must be separate paths");
  });

  it("fails closed where the macOS Seatbelt boundary is unavailable", () => {
    const fixture = root();
    const primary = path.join(fixture, "primary");
    const candidate = path.join(fixture, "candidate");
    mkdirSync(primary); mkdirSync(candidate);
    expect(() => guardPrimaryCheckoutLaunch({
      repositoryPath: primary, worktreePath: candidate, launch: { command: "agent", args: [] }, platform: "linux"
    })).toThrow("Seatbelt boundary is required");
  });

  const hostDescribe = process.platform === "darwin" && !process.env.CODEX_SANDBOX ? describe : describe.skip;
  hostDescribe("macOS Seatbelt enforcement", () => {
    it("permits candidate mutations but denies direct, patch, symlink, and shared-Git writes to primary", () => {
      const fixture = root();
      const primary = path.join(fixture, "primary");
      const candidate = path.join(fixture, "candidate");
      mkdirSync(path.join(primary, ".git"), { recursive: true });
      mkdirSync(candidate);
      const sentinel = path.join(primary, "sentinel.txt");
      const gitSentinel = path.join(primary, ".git", "controller.txt");
      writeFileSync(sentinel, "unchanged\n");
      writeFileSync(gitSentinel, "controller\n");
      symlinkSync(primary, path.join(candidate, "primary-escape"));
      symlinkSync(path.join(primary, ".git"), path.join(candidate, "shared-git"));
      writeFileSync(path.join(candidate, "change.patch"), "--- ../primary/sentinel.txt\n+++ ../primary/sentinel.txt\n@@ -1 +1 @@\n-unchanged\n+patched\n");

      // The fixture proves this is a write that normally succeeds, rather
      // than merely a patch-tool path-validation refusal.
      const unguardedPatch = spawnSync("/bin/sh", ["-c", "patch -p0 < change.patch"], { cwd: candidate, encoding: "utf8" });
      expect(unguardedPatch.status, unguardedPatch.stderr).toBe(0);
      expect(readFileSync(sentinel, "utf8")).toBe("patched\n");
      writeFileSync(sentinel, "unchanged\n");

      const profile = primaryCheckoutSandboxProfile(primary, candidate);
      const run = (command: string) => spawnSync(PRIMARY_CHECKOUT_SANDBOX_EXEC, ["-p", profile, "/bin/sh", "-c", command], {
        cwd: candidate, encoding: "utf8"
      });
      const allowed = run("printf candidate > created && printf edit >> created && mv created renamed && chmod 600 renamed && rm renamed");
      expect(allowed.status, `${allowed.stderr}`).toBe(0);

      for (const command of [
        "printf direct > ../primary/sentinel.txt",
        "perl -0pi -e 's/unchanged/edited/' ../primary/sentinel.txt",
        "chmod 600 ../primary/sentinel.txt",
        "mv ../primary/sentinel.txt ../primary/renamed.txt",
        "rm ../primary/sentinel.txt",
        "patch -p0 -o ../primary/patched.txt < change.patch",
        "printf escape > primary-escape/sentinel.txt",
        "printf git > shared-git/controller.txt"
      ]) {
        const denied = run(command);
        // Some POSIX tools (notably perl's in-place editor) report their
        // Seatbelt failure on stderr yet retain a zero process status.
        const denial = `${denied.stdout}${denied.stderr}`;
        expect(
          denied.status !== 0 || /operation not permitted|permission denied|denied/i.test(denial),
          `${command}: ${denial}`
        ).toBe(true);
        expect(readFileSync(sentinel, "utf8")).toBe("unchanged\n");
        expect(readFileSync(gitSentinel, "utf8")).toBe("controller\n");
      }
      const readOnlyComparison = run("cmp ../primary/sentinel.txt ../primary/sentinel.txt");
      expect(readOnlyComparison.status, readOnlyComparison.stderr).toBe(0);
    });
  });
});
