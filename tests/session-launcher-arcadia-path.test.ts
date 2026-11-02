import { execFileSync } from "node:child_process";
import { chmodSync, statSync, existsSync, mkdirSync, readdirSync, readlinkSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHostArcadiaDirectory } from "../src/runtime/hostArcadiaCli.js";
import { systemTmux } from "../src/sessions/index.js";
import { writeSessionLauncher } from "../src/sessions/tmuxLauncher.js";

const run = { command: "/bin/echo", args: ["hi"] };
let scratch: string;

beforeEach(() => { scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-cli-path-"))); });
afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

function render(node: string | null, cli?: string | null): string {
  const launcher = writeSessionLauncher(run, path.join(scratch, "run"), node, cli);
  return readFileSync(launcher.file, "utf8");
}

function installCli(directory: string): void {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "arcadia");
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, 0o755);
}

describe("Session launcher arcadia directory", () => {
  it("puts the host CLI directory on PATH after the pinned Node directory", () => {
    const text = render("/mise/node/bin", "/host/bin");
    expect(text).toContain(`PATH='/mise/node/bin':'/host/bin':"$PATH"`);
    expect(text.indexOf("/mise/node/bin")).toBeLessThan(text.indexOf("/host/bin"));
  });

  it("adds the CLI directory without a Node pin, and leaves the launcher unchanged when the host resolves none", () => {
    expect(render(null, "/host/bin")).toContain(`PATH='/host/bin':"$PATH"`);
    const strip = (t: string) => t.replace(/launch-[0-9a-f-]+\.sh/g, "F");
    expect(strip(render("/mise/node/bin", null))).toBe(strip(render("/mise/node/bin", undefined)));
    expect(render("/mise/node/bin", null)).toContain(`PATH='/mise/node/bin':"$PATH"`);
    expect(render(null, null)).not.toContain("PATH=");
  });

  it("refuses a CLI directory containing a PATH separator", () => {
    expect(render(null, "/a:/worktree")).not.toContain("PATH=");
  });

  it("takes the CLI from the host PATH and never from a file in the worktree", () => {
    const worktree = path.join(scratch, "worktree");
    const host = path.join(scratch, "host-bin");
    const home = path.join(scratch, "home");
    installCli(host);
    mkdirSync(worktree, { recursive: true });
    writeFileSync(path.join(worktree, ".arcadia-cli-dir"), host);
    writeFileSync(path.join(worktree, "mise.toml"), `[env]\n_.path = ["${worktree}"]\n`);
    expect(resolveHostArcadiaDirectory(worktree, "/nonexistent", path.join(scratch, "nohome"))).toBeNull();
    expect(resolveHostArcadiaDirectory(worktree, host, home)).not.toBeNull();
  });

  it("exposes only arcadia: a sibling tool in the source directory is unreachable", () => {
    const worktree = path.join(scratch, "worktree");
    const source = path.join(scratch, "home", ".local", "bin");
    const home = path.join(scratch, "home");
    mkdirSync(worktree, { recursive: true });
    installCli(source);
    writeFileSync(path.join(source, "codex"), "#!/bin/sh\n");
    chmodSync(path.join(source, "codex"), 0o755);
    const dir = resolveHostArcadiaDirectory(worktree, "", home)!;
    expect(dir).toBe(path.join(home, ".local", "share", "arcadia", "session-bin"));
    expect(readdirSync(dir)).toEqual(["arcadia"]);
    expect(existsSync(path.join(dir, "codex"))).toBe(false);
    expect(readlinkSync(path.join(dir, "arcadia"))).toBe(path.join(source, "arcadia"));
    expect(dir.startsWith(worktree)).toBe(false);
  });

  it("is idempotent, refreshes a stale link, and leaves no staging file", () => {
    const worktree = path.join(scratch, "worktree");
    const home = path.join(scratch, "home");
    mkdirSync(worktree, { recursive: true });
    installCli(path.join(scratch, "a"));
    installCli(path.join(scratch, "b"));
    const first = resolveHostArcadiaDirectory(worktree, path.join(scratch, "a"), home);
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "a"), home)).toBe(first);
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "b"), home)).toBe(first);
    expect(readlinkSync(path.join(first!, "arcadia"))).toBe(path.join(scratch, "b", "arcadia"));
    expect(readdirSync(first!)).toEqual(["arcadia"]);
  });

  it("returns null and leaves the launcher unchanged when the directory cannot be created", () => {
    const worktree = path.join(scratch, "worktree");
    mkdirSync(worktree, { recursive: true });
    installCli(path.join(scratch, "a"));
    const home = path.join(scratch, "home");
    mkdirSync(home);
    writeFileSync(path.join(home, ".local"), "a file, not a directory");
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "a"), home)).toBeNull();
  });

  it("refuses worktree-writable, relative and symlinked-into-worktree commands", () => {
    const worktree = path.join(scratch, "worktree");
    installCli(path.join(worktree, "bin"));
    installCli(worktree);
    const home = path.join(scratch, "nohome");
    expect(resolveHostArcadiaDirectory(worktree, path.join(worktree, "bin"), home)).toBeNull();
    expect(resolveHostArcadiaDirectory(worktree, worktree, home)).toBeNull();
    expect(resolveHostArcadiaDirectory(worktree, "bin:.:", home)).toBeNull();
    symlinkSync(path.join(worktree, "bin"), path.join(scratch, "link"));
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "link"), home)).toBeNull();
    const host = path.join(scratch, "host-bin");
    installCli(host);
    expect(resolveHostArcadiaDirectory(worktree, `${path.join(worktree, "bin")}:${host}`, home)).not.toBeNull();
  });

  it("requires an executable arcadia", () => {
    const worktree = path.join(scratch, "worktree");
    mkdirSync(worktree, { recursive: true });
    const home = path.join(scratch, "home");
    installCli(path.join(home, ".local", "bin"));
    chmodSync(path.join(home, ".local", "bin", "arcadia"), 0o644);
    expect(resolveHostArcadiaDirectory(worktree, "", home)).toBeNull();
  });

  it("surfaces a preparation failure and a leftover staging file does not block the refresh", () => {
    const worktree = path.join(scratch, "worktree");
    mkdirSync(worktree, { recursive: true });
    installCli(path.join(scratch, "a"));
    const home = path.join(scratch, "home");
    const first = resolveHostArcadiaDirectory(worktree, path.join(scratch, "a"), home)!;
    writeFileSync(path.join(first, `arcadia.${process.pid}.tmp`), "stale");
    installCli(path.join(scratch, "b"));
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "b"), home)).toBe(first);
    expect(readdirSync(first)).toEqual(["arcadia"]);
    const messages: string[] = [];
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "b"), home, { uid: process.getuid!() + 1, onFailure: (m) => messages.push(m) })).toBeNull();
    expect(messages).toHaveLength(1);
  });

  it("creates the directory 0700 and refuses a group- or world-writable one", () => {
    const worktree = path.join(scratch, "worktree");
    mkdirSync(worktree, { recursive: true });
    installCli(path.join(scratch, "a"));
    const home = path.join(scratch, "home");
    const dir = resolveHostArcadiaDirectory(worktree, path.join(scratch, "a"), home)!;
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    chmodSync(dir, 0o770);
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "a"), home)).toBeNull();
    chmodSync(dir, 0o707);
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "a"), home)).toBeNull();
  });

  it("refuses a non-file arcadia, a relative PATH entry and a writable target", () => {
    const worktree = path.join(scratch, "worktree");
    mkdirSync(worktree, { recursive: true });
    const home = path.join(scratch, "home");
    mkdirSync(path.join(scratch, "dirbin", "arcadia"), { recursive: true });
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "dirbin"), home)).toBeNull();
    installCli(path.join(scratch, "rel"));
    const previous = process.cwd();
    process.chdir(scratch);
    try {
      expect(resolveHostArcadiaDirectory(worktree, "rel", home)).toBeNull();
    } finally {
      process.chdir(previous);
    }
    installCli(path.join(scratch, "w"));
    chmodSync(path.join(scratch, "w", "arcadia"), 0o775);
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "w"), home)).toBeNull();
    chmodSync(path.join(scratch, "w", "arcadia"), 0o757);
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "w"), home)).toBeNull();
  });

  describe("the real launch path", () => {
    function launchWithFakeTmux(hostHome: string, cwd: string): string {
      const bin = path.join(scratch, "tmuxbin");
      mkdirSync(bin, { recursive: true });
      const captured = path.join(scratch, "captured.sh");
      writeFileSync(path.join(bin, "tmux"), `#!/bin/sh\nfor a; do last="$a"; done\ncp "$last" '${captured}'\n`);
      chmodSync(path.join(bin, "tmux"), 0o755);
      const original = process.env.PATH;
      process.env.PATH = `${bin}:/usr/bin:/bin`;
      try {
        systemTmux.launch({ name: "arcadia-wiring", cwd, command: "/bin/echo", args: ["hi"], launcherDirectory: path.join(scratch, "run"), hostHome });
      } finally {
        process.env.PATH = original;
      }
      return readFileSync(captured, "utf8");
    }

    it("renders the private directory into the launcher systemTmux.launch writes, and runs fake arcadia in a plain shell", () => {
      const home = path.join(scratch, "home");
      const cwd = path.join(scratch, "worktree");
      mkdirSync(cwd, { recursive: true });
      const source = path.join(home, ".local", "bin");
      installCli(source);
      writeFileSync(path.join(source, "arcadia"), "#!/bin/sh\necho fake-arcadia-ran\n");
      writeFileSync(path.join(source, "codex"), "#!/bin/sh\necho codex\n", { mode: 0o755 });
      const text = launchWithFakeTmux(home, cwd);
      const privateDir = path.join(realpathSync(home), ".local", "share", "arcadia", "session-bin");
      expect(text).toContain(`'${privateDir}'`);
      // Execute the launcher in a plain non-login shell with a minimal environment.
      const script = path.join(scratch, "captured.sh");
      const probe = writeFileSync(path.join(scratch, "probe.sh"), "#!/bin/sh\ncommand -v arcadia\narcadia\ncommand -v codex || echo no-codex\n", { mode: 0o755 });
      void probe;
      const patched = readFileSync(script, "utf8").replace(/exec .*\n$/, `exec /bin/sh '${path.join(scratch, "probe.sh")}'\n`);
      writeFileSync(script, patched);
      const out = execFileSync("/bin/sh", [script], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: path.join(scratch, "elsewhere") } });
      expect(out.split("\n")).toEqual([path.join(privateDir, "arcadia"), "fake-arcadia-ran", "no-codex", ""]);
    });

    it("leaves the launcher without a PATH line when the host resolves no CLI", () => {
      const cwd = path.join(scratch, "worktree");
      mkdirSync(cwd, { recursive: true });
      const text = launchWithFakeTmux(path.join(scratch, "emptyhome"), cwd);
      expect(text).not.toContain("session-bin");
    });
  });
});
