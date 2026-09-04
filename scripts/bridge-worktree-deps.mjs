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
// Idempotent, and refuses to run anywhere but a worktree. Uses no dependencies,
// because in a fresh worktree there are none to use.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
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

const linked = [];
const skipped = [];
for (const tree of trees) {
  const relative = path.relative(mainCheckout, tree);
  const target = path.join(worktree, relative);
  if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
    skipped.push(relative);
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  symlinkSync(tree, target);
  linked.push(relative);
}

console.log(`Worktree:      ${worktree}`);
console.log(`Main checkout: ${mainCheckout}`);
for (const relative of linked) console.log(`  linked  ${relative}`);
for (const relative of skipped) console.log(`  present ${relative}`);
console.log(
  linked.length === 0
    ? "Already bridged; nothing to do."
    : `Bridged ${linked.length} dependency tree${linked.length === 1 ? "" : "s"}.`
);
console.log(
  "\nNote: `@pmark/arcadia` resolves to the MAIN checkout's dist/, so a test\n" +
    "importing it exercises that build rather than this worktree's source."
);
