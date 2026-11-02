import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("takes the directory from the host PATH and never from a file in the worktree", () => {
    const worktree = path.join(scratch, "worktree");
    const host = path.join(scratch, "host-bin");
    installCli(host);
    mkdirSync(worktree, { recursive: true });
    writeFileSync(path.join(worktree, ".arcadia-cli-dir"), host);
    writeFileSync(path.join(worktree, "mise.toml"), `[env]\n_.path = ["${worktree}"]\n`);
    // A file in the worktree naming a directory does nothing.
    expect(resolveHostArcadiaDirectory(worktree, "/nonexistent", path.join(scratch, "nohome"))).toBeNull();
    expect(resolveHostArcadiaDirectory(worktree, host, path.join(scratch, "nohome"))).toBe(path.resolve(host));
  });

  it("refuses worktree-writable, relative and symlinked-into-worktree directories", () => {
    const worktree = path.join(scratch, "worktree");
    installCli(path.join(worktree, "bin"));
    installCli(worktree);
    const home = path.join(scratch, "nohome");
    expect(resolveHostArcadiaDirectory(worktree, path.join(worktree, "bin"), home)).toBeNull();
    expect(resolveHostArcadiaDirectory(worktree, worktree, home)).toBeNull();
    expect(resolveHostArcadiaDirectory(worktree, "bin:.:", home)).toBeNull();
    symlinkSync(path.join(worktree, "bin"), path.join(scratch, "link"));
    expect(resolveHostArcadiaDirectory(worktree, path.join(scratch, "link"), home)).toBeNull();
    // A hostile entry is skipped and a later safe host entry still wins.
    const host = path.join(scratch, "host-bin");
    installCli(host);
    expect(resolveHostArcadiaDirectory(worktree, `${path.join(worktree, "bin")}:${host}`, home)).toBe(path.resolve(host));
  });

  it("falls back to the user's ~/.local/bin and requires an executable arcadia", () => {
    const worktree = path.join(scratch, "worktree");
    mkdirSync(worktree, { recursive: true });
    const home = path.join(scratch, "home");
    installCli(path.join(home, ".local", "bin"));
    expect(resolveHostArcadiaDirectory(worktree, "", home)).toBe(path.resolve(home, ".local", "bin"));
    chmodSync(path.join(home, ".local", "bin", "arcadia"), 0o644);
    expect(resolveHostArcadiaDirectory(worktree, "", home)).toBeNull();
  });
});
