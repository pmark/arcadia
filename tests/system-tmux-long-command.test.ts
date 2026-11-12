import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemTmux, tmuxNewSessionArgs } from "../src/sessions/index.js";
import { declaredMiseNodeVersion, miseNodeDirectory } from "../src/runtime/mise.js";
import { writeSessionLauncher } from "../src/sessions/tmuxLauncher.js";

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

describe("the Node a Session's launcher resolves (Issue #1993)", () => {
  function withScratch(body: (scratch: string) => void): void {
    const scratch = mkdtempSync(path.join(tmpdir(), "arcadia-launcher-node-"));
    try {
      body(scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  function fakeNode(directory: string, name: string): void {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "node"), `#!/bin/sh\necho ${name}\n`, { mode: 0o755 });
  }

  it("puts the given Node ahead of another node on PATH, for bash and sh Session shells", () => {
    withScratch((scratch) => {
      const other = path.join(scratch, "other");
      const pinned = path.join(scratch, "pinned");
      fakeNode(other, "other");
      fakeNode(pinned, "pinned");
      for (const shell of ["/bin/bash", "/bin/sh"]) {
        const launcher = writeSessionLauncher({ command: shell, args: ["-c", "node"] }, scratch, pinned);
        const output = execFileSync("/bin/sh", [launcher.file], { encoding: "utf8", env: { PATH: `${other}:/usr/bin:/bin` } });
        expect(output.trim()).toBe("pinned");
      }
    });
  });

  it("leaves PATH as it was when no pinned Node is known", () => {
    withScratch((scratch) => {
      const other = path.join(scratch, "other");
      fakeNode(other, "other");
      const launcher = writeSessionLauncher({ command: "/bin/sh", args: ["-c", "node"] }, scratch, null);
      const output = execFileSync("/bin/sh", [launcher.file], { encoding: "utf8", env: { PATH: `${other}:/usr/bin:/bin` } });
      expect(output.trim()).toBe("other");
    });
  });

  it("reads only a plain [tools] node pin as data, never a symlink or another table's value", () => {
    withScratch((scratch) => {
      const pin = (text: string) => { writeFileSync(path.join(scratch, "mise.toml"), text); return declaredMiseNodeVersion(scratch); };
      expect(declaredMiseNodeVersion(scratch)).toBeNull();
      expect(pin('[tools]\nnode = "22.23.1"\ntmux = "3.7c"\n')).toBe("22.23.1");
      expect(pin('min_version = "1"\n\n[tools]\nnode = "24" # pinned\n')).toBe("24");
      expect(pin('[env]\nnode = "20"\n[tools]\ntmux = "3"\n')).toBeNull();
      expect(pin('[tools]\nnode = "lts"\n')).toBeNull();
      expect(pin('[tools\nnot toml')).toBeNull();
      expect(pin('[tools]\nnode = "{{ exec(command=\'touch /tmp/x\') }}"\n')).toBeNull();
      rmSync(path.join(scratch, "mise.toml"));
      const target = path.join(scratch, "target.toml");
      writeFileSync(target, '[tools]\nnode = "22"\n');
      symlinkSync(target, path.join(scratch, "mise.toml"));
      expect(declaredMiseNodeVersion(scratch)).toBeNull();
    });
  });

  it("asks mise for the declared version from a neutral directory, and never evaluates the checkout's config", () => {
    withScratch((scratch) => {
      const checkout = path.join(scratch, "checkout");
      mkdirSync(checkout);
      const marker = path.join(scratch, "evaluated");
      writeFileSync(path.join(checkout, "mise.toml"), `[env]\n_.source = "${marker}"\n[tools]\nnode = "24.21.0"\n`);
      const install = path.join(scratch, "installs", "24.21.0");
      fakeNode(path.join(install, "bin"), "pinned");
      const seen = path.join(scratch, "seen");
      const mise = path.join(scratch, "mise");
      writeFileSync(mise, `#!/bin/sh\n{ pwd; echo "$@"; } > ${seen}\necho ${install}\n`, { mode: 0o755 });
      expect(miseNodeDirectory(checkout, mise)).toBe(path.join(install, "bin"));
      expect(readFileSync(seen, "utf8").trim().split("\n")).toEqual(["/", "where node@24.21.0"]);
      expect(existsSync(marker)).toBe(false);
      writeFileSync(mise, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      expect(miseNodeDirectory(checkout, mise)).toBeNull();
      writeFileSync(mise, `#!/bin/sh\necho ${path.join(scratch, "not-installed")}\n`, { mode: 0o755 });
      expect(miseNodeDirectory(checkout, mise)).toBeNull();
      expect(miseNodeDirectory(checkout, path.join(scratch, "missing"))).toBeNull();
      expect(miseNodeDirectory(path.join(scratch, "no-pin"), mise)).toBeNull();
    });
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
    const outTemp = `${out}.tmp`;
    const runDir = path.join(root, "run");
    const provider = path.join(root, "provider.mjs");
    writeFileSync(provider, `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(outTemp)}, JSON.stringify(process.argv.slice(2)));\nfs.renameSync(${JSON.stringify(outTemp)}, ${JSON.stringify(out)});\n`);
    systemTmux.launch({
      name,
      cwd: root,
      command: process.execPath,
      args: [provider, "--print", LONG_BRIEF],
      launcherDirectory: runDir,
      hostHome: path.join(root, "home")
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
        launcherDirectory: runDir,
        hostHome: path.join(root, "home")
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
    const outTemp = `${out}.tmp`;
    writeFileSync(provider, `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(outTemp)}, JSON.stringify(process.argv.slice(2)));\nfs.renameSync(${JSON.stringify(outTemp)}, ${JSON.stringify(out)});\n`);
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
        args: [provider, "--print", LONG_BRIEF],
        hostHome: path.join(root, "home")
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
