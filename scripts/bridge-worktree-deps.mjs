#!/usr/bin/env node
// Bridge the main checkout's installed dependencies into an agent worktree.
//
// A git worktree gets no `node_modules` of its own, and a full `pnpm install`
// per worktree is slow and fragile (the better-sqlite3 ABI rebuild). The cheap
// answer is to symlink the main checkout's trees in.
//
// The trap this script exists for: bridging the ROOT tree alone looks like it
// worked -- most of the suite passes -- while every pnpm workspace package
// still has no dependencies, so `discord.js` and `@pmark/arcadia/...` fail to
// resolve. Those failures read exactly like a broken change, and on 2026-09-04
// they were reported as one. So this discovers every tree the main checkout
// actually has rather than naming them, which is the part that went stale.
//
// A second trap once the first is fixed: pnpm points a workspace dependency
// (`"@pmark/arcadia": "workspace:*"` in apps/dashboard/package.json) straight
// at the sibling package directory with a *relative* symlink, e.g.
// `apps/dashboard/node_modules/@pmark/arcadia -> ../../../..`. Bridging that
// tree with one top-level symlink preserves the relative target as-is, so it
// still resolves four levels up from its *physical* location in the main
// checkout, landing back on the main checkout's root and its stale dist --
// silently, since the import succeeds. Every tree is therefore bridged one
// level deeper, so that kind of entry can be retargeted at the worktree.
//
// A third trap: a bare top-level symlink for `node_modules` also means the
// directory a build tool thinks it owns is physically the main checkout's --
// so anything that writes a cache or temp file straight under `node_modules/`
// (Vite bundles `vitest.config.ts` into `node_modules/.vite-temp/` on every
// run) is writing outside the worktree, which a worktree-scoped sandbox
// denies with EPERM. That is why every tree is bridged one level deep rather
// than most trees taking the cheap single-symlink path: `node_modules` itself
// must be a real directory inside the worktree, even though everything in it
// is a symlink, so tools can create real subdirectories under it.
//
// A fourth trap, hiding inside the third: bridging one level deep still walks
// every entry the main checkout's node_modules happens to have, including
// tool-owned cache directories the main checkout accumulated from its own
// runs -- `.vite`, `.vite-temp`. Symlinking one of those back in reproduces
// exactly the trap the one-level bridge exists to fix, just one dotfile at a
// time: Vite finds `.vite-temp` "already there" and writes through the
// symlink into the main checkout again. Only the entries pnpm itself needs for
// module resolution are bridged; every other dotfile is left for the
// worktree's own tools to create fresh.
//
// Idempotent, and refuses to run anywhere but a worktree. Uses no dependencies,
// because in a fresh worktree there are none to use.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";

const MAX_DEPTH = 3;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message, hint) {
  console.error(`bridge-worktree-deps: ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

let worktree;
let mainCheckout;
try {
  worktree = git("rev-parse", "--show-toplevel");
  // --git-common-dir is the ONE directory every worktree shares: the main
  // checkout's `.git`. Its parent is the checkout holding the real install.
  mainCheckout = path.dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir"));
} catch {
  fail("not inside a git repository.");
}

if (path.resolve(worktree) === path.resolve(mainCheckout)) {
  fail(
    "this is the main checkout, not a worktree.",
    "Nothing to bridge here -- run `mise exec -- pnpm install` instead."
  );
}

/** Every `node_modules` the main checkout has, without descending into one. */
function findTrees(directory, depth = 0) {
  const found = [];
  if (depth > MAX_DEPTH) return found;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.name === "node_modules") {
      found.push(absolute);
      continue; // never walk inside one
    }
    found.push(...findTrees(absolute, depth + 1));
  }
  return found;
}

const trees = findTrees(mainCheckout);
if (trees.length === 0) {
  fail(
    `the main checkout at ${mainCheckout} has no node_modules to bridge.`,
    "Run `mise exec -- pnpm install` there first."
  );
}

/** Every workspace member's absolute directory in the main checkout: the root plus every `packages:` glob target in pnpm-workspace.yaml, read without a YAML parser since only plain `- path` entries are used here. */
function workspaceMemberPaths(root) {
  const members = [root];
  const workspaceFile = path.join(root, "pnpm-workspace.yaml");
  let text;
  try {
    text = readFileSync(workspaceFile, "utf8");
  } catch {
    return members;
  }
  const section = text.match(/^packages:\n((?:[ \t]+-.*\n?)*)/m);
  if (!section) return members;
  for (const line of section[1].split("\n")) {
    const match = line.match(/^\s*-\s*(\S+)/);
    if (match) members.push(path.resolve(root, match[1]));
  }
  return members;
}

/**
 * The workspace member `absoluteEntry` points straight at, or null if it
 * resolves anywhere else. A pnpm workspace self-reference symlink resolves to
 * exactly a member's root directory; an ordinary dependency always resolves
 * one or more levels deeper, into `.pnpm/<name>@<version>/node_modules/<name>`
 * -- which the main checkout's own node_modules physically contains, so
 * anything looser than exact equality here would also match every ordinary
 * dependency and defeat the point of the check.
 */
function workspaceSelfReferenceTarget(absoluteEntry, memberPaths) {
  let resolved;
  try {
    resolved = realpathSync(absoluteEntry);
  } catch {
    return null;
  }
  return memberPaths.find((member) => resolved === member) ?? null;
}

/** Symlink `mainEntry` into the worktree, retargeting it at the worktree's own copy of whichever workspace member it resolves to instead of the main checkout's. */
function linkOrRetarget(mainEntry, worktreeEntry, memberPaths, mainCheckout, worktree, retargeted) {
  const member = workspaceSelfReferenceTarget(mainEntry, memberPaths);
  if (member) {
    const relativeToRoot = path.relative(mainCheckout, member);
    symlinkSync(relativeToRoot === "" ? worktree : path.join(worktree, relativeToRoot), worktreeEntry);
    retargeted.push(path.relative(worktree, worktreeEntry));
  } else {
    symlinkSync(mainEntry, worktreeEntry);
  }
}

/** pnpm's own module-resolution metadata inside a `node_modules` tree -- the only dotfiles safe to bridge. Anything else starting with `.` is a tool-owned cache (`.vite`, `.vite-temp`, ...) that must be left for the worktree's own tools to create fresh, never inherited from the main checkout. */
const PNPM_METADATA_ENTRIES = new Set([".bin", ".pnpm", ".modules.yaml", ".pnpm-workspace-state-v1.json"]);

/** Bridge one tree one level deeper (and one level into each `@scope` directory) so a workspace self-reference inside it can be retargeted at the worktree instead of inherited from the main checkout. */
function bridgeTreeWorkspaceAware(tree, target, memberPaths, mainCheckout, worktree, retargeted) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(tree, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && !PNPM_METADATA_ENTRIES.has(entry.name)) continue;
    const mainEntry = path.join(tree, entry.name);
    const worktreeEntry = path.join(target, entry.name);
    if (entry.name.startsWith("@")) {
      mkdirSync(worktreeEntry, { recursive: true });
      for (const scoped of readdirSync(mainEntry, { withFileTypes: true })) {
        linkOrRetarget(path.join(mainEntry, scoped.name), path.join(worktreeEntry, scoped.name), memberPaths, mainCheckout, worktree, retargeted);
      }
    } else {
      linkOrRetarget(mainEntry, worktreeEntry, memberPaths, mainCheckout, worktree, retargeted);
    }
  }
}

const memberPaths = workspaceMemberPaths(mainCheckout);
const linked = [];
const skipped = [];
const retargeted = [];
for (const tree of trees) {
  const relative = path.relative(mainCheckout, tree);
  const target = path.join(worktree, relative);
  if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
    skipped.push(relative);
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  bridgeTreeWorkspaceAware(tree, target, memberPaths, mainCheckout, worktree, retargeted);
  linked.push(relative);
}

console.log(`Worktree:      ${worktree}`);
console.log(`Main checkout: ${mainCheckout}`);
for (const relative of linked) console.log(`  linked  ${relative}`);
for (const relative of skipped) console.log(`  present ${relative}`);
for (const relative of retargeted) console.log(`  retargeted at worktree  ${relative}`);
console.log(
  linked.length === 0
    ? "Already bridged; nothing to do."
    : `Bridged ${linked.length} dependency tree${linked.length === 1 ? "" : "s"}.`
);
