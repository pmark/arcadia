import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemTmux, tmuxNewSessionArgs } from "../src/sessions/index.js";

/**
 * The 2026-10-17 supervised Claude run failed twice with "tmux new-session
 * failed (1). Cause: command too long": the worker handed tmux the whole
 * Session brief as argv, and tmux refuses a command larger than its client
 * message limit. A short fixture brief never reached that limit.
 *
 * The real launch below runs on this file's own tmux server socket (a `tmux`
 * first on PATH execs the real binary with `-S`), never the host's.
 */
const tmuxBinary = (() => {
  try { return execFileSync("/bin/sh", ["-c", "command -v tmux"], { encoding: "utf8" }).trim(); } catch { return ""; }
})();

const LONG_BRIEF = `# Action brief\n${"Realistic brief text with 'quotes', \"doubles\", $dollars, `ticks` and \\ backslashes.\n".repeat(800)}`.slice(0, 64 * 1024);

describe("tmuxNewSessionArgs", () => {
  it("keeps the tmux command line bounded regardless of the provider argv size", () => {
    const short = tmuxNewSessionArgs("arcadia-x", "/work", "/runs/x.launch.sh");
    expect(short).toEqual(["new-session", "-d", "-s", "arcadia-x", "-c", "/work", "sh", "/runs/x.launch.sh"]);
    // The prompt never appears: only the session name, cwd and launcher path.
    expect(short.join(" ").length).toBeLessThan(200);
  });
});

describe.skipIf(!tmuxBinary)("systemTmux.launch with a long Session brief (real tmux, private socket)", () => {
  let root = "";
  let socketDir = "";
  let socket = "";
  let originalPath = "";
  const name = `arcadia-long-brief-${process.pid}-${Date.now()}`;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "arcadia-tmux-long-"));
    // A Unix socket path is limited to 104 bytes on macOS.
    socketDir = mkdtempSync("/tmp/arcadia-long-tmux-");
    socket = path.join(socketDir, "s");
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "tmux"), `#!/bin/sh\nexec '${tmuxBinary}' -f /dev/null -S '${socket}' "$@"\n`);
    chmodSync(path.join(bin, "tmux"), 0o755);
    originalPath = process.env.PATH ?? "";
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    try { execFileSync(tmuxBinary, ["-S", socket, "kill-server"], { stdio: "ignore" }); } catch { /* no server left */ }
    rmSync(socketDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("starts the Session and hands the provider the exact 64 KiB brief, leaving no launcher file behind", async () => {
    const out = path.join(root, "argv.json");
    const runDir = path.join(root, "run");
    const provider = path.join(root, "provider.mjs");
    writeFileSync(provider, `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`);
    systemTmux.launch({
      name,
      cwd: root,
      command: process.execPath,
      args: [provider, "--print", LONG_BRIEF],
      launcherDirectory: runDir
    });
    const deadline = Date.now() + 10_000;
    while (!existsSync(out) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const argv = JSON.parse(readFileSync(out, "utf8")) as string[];
    expect(argv).toEqual(["--print", LONG_BRIEF]);
    // The launcher held the brief; it removes itself before the provider runs.
    expect(existsSync(runDir) ? readdirSync(runDir) : []).toEqual([]);
  });

  it("discards the launcher file when tmux new-session fails", () => {
    const failingTmuxName = `arcadia-failing-${process.pid}-${Date.now()}`;
    const runDir = path.join(root, "failing-run");
    const failingBin = path.join(root, "failing-bin");
    mkdirSync(failingBin);
    // A shim that fails with exit code 42
    writeFileSync(path.join(failingBin, "tmux"), `#!/bin/sh\nexit 42\n`);
    chmodSync(path.join(failingBin, "tmux"), 0o755);
    const originalPath = process.env.PATH ?? "";
    process.env.PATH = `${failingBin}${path.delimiter}${originalPath}`;
    try {
      systemTmux.launch({
        name: failingTmuxName,
        cwd: root,
        command: process.execPath,
        args: ["--version"],
        launcherDirectory: runDir
      });
      expect.fail("Expected systemTmux.launch to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("tmux new-session failed");
    } finally {
      process.env.PATH = originalPath;
    }
    // Verify no launcher file is left behind
    expect(existsSync(runDir) ? readdirSync(runDir) : []).toEqual([]);
  });

  it("delivers the brief byte-identical with no launcherDirectory (temporary directory removed)", async () => {
    const out = path.join(root, "argv-temp.json");
    const provider = path.join(root, "provider-temp.mjs");
    writeFileSync(provider, `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`);
    const name = `arcadia-temp-brief-${process.pid}-${Date.now()}`;
    // The launcher's private temporary directory is created under TMPDIR, so point it at one this test owns.
    const tempDir = mkdtempSync(path.join(root, "tmpdir-"));
    const originalTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = tempDir;
    try {
      systemTmux.launch({
        name,
        cwd: root,
        command: process.execPath,
        args: [provider, "--print", LONG_BRIEF]
        // No launcherDirectory specified - should use temporary directory that is cleaned up
      });
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
    }
    const deadline = Date.now() + 10_000;
    while (!existsSync(out) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const argv = JSON.parse(readFileSync(out, "utf8")) as string[];
    expect(argv).toEqual(["--print", LONG_BRIEF]);
    // The launcher removes its own arcadia-launch- directory before the provider runs.
    expect(readdirSync(tempDir).filter((entry) => entry.startsWith("arcadia-launch-"))).toEqual([]);
  });
});
