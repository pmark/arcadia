import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Issue #1956: `arcadia go-broker ensure --json` printed the host probe's children (git worktree, the dependency bridge,
 * the dashboard's Next.js build) on stdout ahead of its JSON envelope, so the START card could not parse it. Every child
 * of the install/ensure path must write to stderr; stdout carries exactly one JSON document.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("go-broker install/ensure --json stdout", () => {
  it("keeps stdout to the single JSON envelope while a noisy build child runs", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "arcadia-json-stdout-"));
    directories.push(cwd);
    // The same runner the host probe uses for git worktree, the bridge and the build; a child noisy on both streams.
    const program = `import { runProbeCommand } from ${JSON.stringify(path.join(repoRoot, "src", "sessions", "worktreeRuntimeProbe.ts"))};
runProbeCommand("sh", ["-c", "echo 'HEAD is now at 9b9711ad2'; echo 'Bridged 4 dependency trees.'; echo '   ▲ Next.js 15.5.19'; echo 'build warning' >&2"], ${JSON.stringify(cwd)});
process.stdout.write(JSON.stringify({ ok: true, command: "go-broker.ensure", data: { action: "installed" } }, null, 2) + "\\n");`;
    const env = { ...process.env };
    delete env.VITEST;
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], { cwd: repoRoot, env, encoding: "utf8", timeout: 60_000 });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ ok: true, command: "go-broker.ensure", data: { action: "installed" } });
    expect(run.stderr).toContain("Bridged 4 dependency trees.");
    expect(run.stderr).toContain("Next.js");
    expect(run.stderr).toContain("build warning");
  });

  it("parseJsonEnvelope takes the whole document, or the trailing envelope after child noise, and refuses when there is none", async () => {
    const { parseJsonEnvelope } = await import("../src/commands/startRun.js");
    const envelope = { ok: true, data: { receipt: { applied: true } } };
    expect(parseJsonEnvelope(JSON.stringify(envelope, null, 2))).toEqual(envelope);
    expect(parseJsonEnvelope(`HEAD is now at abc\n{ not json\nBridged 4 dependency trees.\n${JSON.stringify(envelope, null, 2)}\n`)).toEqual(envelope);
    expect(() => parseJsonEnvelope("Bridged 4 dependency trees.\n")).toThrow(/no JSON envelope/);
  });

  it("the sign-in CLI refuses a non-zero exit even when stdout holds an ok envelope, and accepts noise ahead of a clean one", async () => {
    const { realStartRunSignInDeps } = await import("../src/commands/startRun.js");
    const home = mkdtempSync(path.join(os.tmpdir(), "arcadia-signin-cli-"));
    directories.push(home);
    const release = "a".repeat(40);
    const directory = path.join(home, ".local", "share", "arcadia", "go-broker", "releases", release);
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.join(directory, "dist", "src"), { recursive: true });
    writeFileSync(path.join(directory, "broker-manifest.json"), JSON.stringify({ schema: "arcadia-go-broker-install-v1", revision: release, runtimeExecutable: "/bin/sh" }));
    const cli = path.join(directory, "dist", "src", "cli.js");
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      writeFileSync(cli, `echo 'Bridged 4 dependency trees.'\nprintf '{\\n  "ok": true,\\n  "data": {}\\n}\\n'\nexit "\${EXIT:-0}"\n`);
      expect(realStartRunSignInDeps(home, release, home).cli(["review"], 10_000)).toEqual({ ok: true, data: {} });
      writeFileSync(cli, `printf '{\\n  "ok": true,\\n  "data": {}\\n}\\n'\nexit 3\n`);
      expect(realStartRunSignInDeps(home, release, home).cli(["review"], 10_000)).toMatchObject({ ok: false, error: expect.stringMatching(/^exit 3/) });
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("leaves no child of the install/ensure path writing to the inherited stdout", () => {
    for (const file of ["src/commands/goBrokerInstall.ts", "src/sessions/worktreeRuntimeProbe.ts"]) {
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      expect(source, file).not.toMatch(/stdio:\s*"inherit"/);
      expect(source, file).not.toMatch(/stdio:\s*\[[^\]]*,\s*"inherit"\s*,/);
    }
  });
});
