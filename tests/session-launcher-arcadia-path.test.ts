import { chmodSync, existsSync, mkdirSync, readdirSync, readlinkSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHostArcadiaDirectory } from "../src/runtime/hostArcadiaCli.js";
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
});
