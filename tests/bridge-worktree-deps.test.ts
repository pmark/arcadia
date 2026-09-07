import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/bridge-worktree-deps.mjs");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bridge-worktree-deps", () => {
  it("retargets a workspace self-reference at the worktree instead of the main checkout's stale dist", () => {
    const { mainCheckout, worktree } = createFixture();

    const output = run(worktree);

    expect(output).toContain("retargeted at worktree");
    const resolved = realpathSync(path.join(worktree, "apps/dashboard/node_modules/@pmark/arcadia"));
    expect(resolved).toBe(path.resolve(worktree));
    expect(resolved).not.toBe(path.resolve(mainCheckout));

    // A plain (non-self-referencing) dependency in the same tree still
    // resolves into the main checkout's real install, not a worktree copy --
    // only the workspace self-reference should ever be retargeted.
    expect(realpathSync(path.join(worktree, "apps/dashboard/node_modules/left-pad"))).toBe(
      path.resolve(mainCheckout, "apps/dashboard/node_modules/left-pad")
    );
  });

  it("is idempotent: a second run relinks nothing and reports the trees as already present", () => {
    const { worktree } = createFixture();
    run(worktree);

    const second = run(worktree);

    expect(second).toContain("Already bridged; nothing to do.");
    expect(second).not.toContain("retargeted at worktree");
    expect(realpathSync(path.join(worktree, "apps/dashboard/node_modules/@pmark/arcadia"))).toBe(path.resolve(worktree));
  });

  it("bridges every tree one level deep, even with no workspace self-reference, so node_modules is a real directory", () => {
    const { mainCheckout, worktree } = createFixture();

    run(worktree);

    // node_modules itself must be a real directory in the worktree -- not a
    // symlink straight into the main checkout -- so a tool that writes a
    // cache or temp file directly under it (Vite's `.vite-temp`, for example)
    // writes inside the worktree instead of outside a worktree-scoped sandbox.
    expect(lstatSync(path.join(worktree, "node_modules")).isSymbolicLink()).toBe(false);
    expect(readlinkSync(path.join(worktree, "node_modules", "left-pad"))).toBe(
      path.join(mainCheckout, "node_modules", "left-pad")
    );
  });
});

function run(worktree: string): string {
  return execFileSync(process.execPath, [SCRIPT], { cwd: worktree, encoding: "utf8" });
}

function createFixture(): { mainCheckout: string; worktree: string } {
  // realpathSync normalizes macOS's /tmp -> /private/tmp symlink so later
  // comparisons against realpathSync() results on the bridged output agree.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-bridge-")));
  roots.push(root);
  const mainCheckout = path.join(root, "main");
  const worktreeParent = path.join(root, "worktrees");
  mkdirSync(mainCheckout, { recursive: true });
  mkdirSync(worktreeParent, { recursive: true });

  git(mainCheckout, ["init", "--initial-branch=main"]);
  git(mainCheckout, ["config", "user.email", "test@example.com"]);
  git(mainCheckout, ["config", "user.name", "Test"]);
  writeFileSync(path.join(mainCheckout, "package.json"), JSON.stringify({ name: "@pmark/arcadia" }));
  writeFileSync(path.join(mainCheckout, "pnpm-workspace.yaml"), "packages:\n  - apps/dashboard\n");
  git(mainCheckout, ["add", "-A"]);
  git(mainCheckout, ["commit", "-m", "init"]);

  // Root node_modules: an ordinary dependency, no self-reference.
  mkdirSync(path.join(mainCheckout, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(path.join(mainCheckout, "node_modules", "left-pad", "index.js"), "module.exports = {};");

  // apps/dashboard/node_modules: an ordinary dependency plus the workspace
  // self-reference pnpm creates for `"@pmark/arcadia": "workspace:*"` -- a
  // *relative* symlink pointing back up at the main checkout's root.
  mkdirSync(path.join(mainCheckout, "apps", "dashboard", "node_modules", "@pmark"), { recursive: true });
  mkdirSync(path.join(mainCheckout, "apps", "dashboard", "node_modules", "left-pad"), { recursive: true });
  writeFileSync(path.join(mainCheckout, "apps", "dashboard", "node_modules", "left-pad", "index.js"), "module.exports = {};");
  symlinkSync(
    path.relative(
      path.join(mainCheckout, "apps", "dashboard", "node_modules", "@pmark"),
      mainCheckout
    ),
    path.join(mainCheckout, "apps", "dashboard", "node_modules", "@pmark", "arcadia")
  );

  const worktree = path.join(worktreeParent, "arcadia");
  git(mainCheckout, ["worktree", "add", "-b", "candidate", worktree]);

  return { mainCheckout, worktree };
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
