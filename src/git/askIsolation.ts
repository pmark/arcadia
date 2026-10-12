import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { parseWorktrees } from "./worktrees.js";
import { preservationProcessLimits } from "../sessions/preservationStages.js";

import { isolatedGitEnvironment } from "./isolatedGitEnvironment.js";
export { isolatedGitEnvironment as askGitEnvironment } from "./isolatedGitEnvironment.js";

export function askGit(root: string, args: string[], index?: string, trim = true): string {
  const env = isolatedGitEnvironment();
  // core.worktree must name the physical checkout, not an invocation subdirectory.
  let checkout = path.resolve(root);
  for (let current = checkout; ; current = path.dirname(current)) {
    if (existsSync(path.join(current, ".git"))) { checkout = current; break; }
    if (path.dirname(current) === current) break;
  }
  if (index) env.GIT_INDEX_FILE = index;
  const filterOverrides: string[] = [];
  if (args.includes("status") || args.includes("worktree")) {
    // Status may invoke clean filters while refreshing stat data; checkout may invoke smudge.
    // Reading configured keys is inert, and overrides prevent all external filter processes.
    let keys = "";
    try {
      keys = execFileSync("git", ["config", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"], {
        ...preservationProcessLimits("git", args), cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      if ((error as { status?: number }).status !== 1) throw error; // Only exit 1 means no configured filters.
    }
    for (const key of keys.split("\n").filter(Boolean)) filterOverrides.push("-c", `${key}=${key.endsWith(".required") ? "false" : ""}`);
  }
  const output = execFileSync("git", ["-c", `core.worktree=${checkout}`, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...filterOverrides, ...args], {
    ...preservationProcessLimits("git", args), cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
  return trim ? output.trim() : output;
}

export function tryAskGit(root: string, args: string[]): string | null {
  try { return askGit(root, args); } catch { return null; }
}

/** Only candidates may hold drafts. Non-Git input directories remain supported. */
export function assertAskDraftCheckout(root: string): void {
  const top = tryAskGit(root, ["rev-parse", "--show-toplevel"]);
  if (!top) {
    // Distinguish a non-Git directory from a failed query in a Git checkout.
    for (let current = path.resolve(root); ; current = path.dirname(current)) {
      if (existsSync(path.join(current, ".git"))) throw validationError("Cannot establish Agent Ask checkout isolation; Git query failed.", { repository: root });
      if (path.dirname(current) === current) break;
    }
    return;
  }
  const branch = tryAskGit(root, ["symbolic-ref", "--short", "HEAD"]);
  const remoteHead = tryAskGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const base = remoteHead?.replace(/^origin\//, "");
  const gitDir = askGit(root, ["rev-parse", "--absolute-git-dir"]);
  const common = askGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  // The primary checkout is shared even when temporarily checked out to a feature branch.
  if (gitDir === common || branch === "main" || branch === "master" || (base && branch === base)) {
    throw validationError("Agent Ask drafts require an isolated candidate checkout; the shared primary/base checkout cannot hold scratch files.", {
      repository: root, remedy: "Use agent-ask preview '<json>' inline to register without a draft, or run draft in your own isolated candidate worktree."
    });
  }
}

/** Reserve the real index before document writes; never steal or remove another operation's lock. */
export function reserveAskGitIndex(root: string): { commit: (paths: string[], message: string) => string | null; release: () => void } {
  const index = askGit(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  if (existsSync(index) && !lstatSync(index).isFile()) throw validationError("Agent Ask Git index must be a regular file.", { index });
  const initialRef = tryAskGit(root, ["symbolic-ref", "HEAD"]);
  if (!initialRef) throw validationError("Agent Ask writes require a named candidate branch; detached HEAD was preserved.", { repository: root, remedy: "Use the Session's named candidate branch before applying settlement or recovering an Ask." });
  const sourceRoot = realpathSync(askGit(root, ["rev-parse", "--show-toplevel"]));
  const peer = parseWorktrees(askGit(root, ["worktree", "list", "--porcelain"]))
    .find(worktree => worktree.branch === initialRef && (existsSync(worktree.path) ? realpathSync(worktree.path) : path.resolve(worktree.path)) !== sourceRoot);
  if (peer) throw validationError("Agent Ask branch is checked out in another worktree; shared branch ownership was preserved.", { repository: root, branch: initialRef, peer: peer.path, remedy: "Use your Session's uniquely owned candidate branch before applying this Ask." });
  const headPath = askGit(root, ["rev-parse", "--path-format=absolute", "--git-path", "HEAD"]);
  if (!lstatSync(headPath).isFile()) throw validationError("Agent Ask HEAD must be a regular file.", { headPath });
  const locks: { path: string; fd: number; dev: number; ino: number }[] = [];
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const owned of locks.reverse()) {
      closeSync(owned.fd);
      try {
        const current = lstatSync(owned.path);
        if (current.dev === owned.dev && current.ino === owned.ino) rmSync(owned.path);
      } catch { /* Never touch a missing or replacement lock. */ }
    }
  };
  try {
    for (const lockedPath of [`${headPath}.lock`, `${index}.lock`]) {
      const fd = openSync(lockedPath, "wx", 0o600);
      const stat = fstatSync(fd);
      locks.push({ path: lockedPath, fd, dev: stat.dev, ino: stat.ino });
    }
  } catch {
    release();
    throw validationError("Agent Ask settlement refused: Git index is locked or HEAD is locked; existing work and locks were preserved.", { index, headPath, remedy: "Wait for the owning Git operation to finish, then retry the same settlement. Do not remove its lock." });
  }
  let initialHead: string;
  try { initialHead = askGit(root, ["rev-parse", "HEAD"]); } catch (error) { release(); throw error; }
  return {
    release,
    commit: (paths, message) => {
      const scratch = mkdtempSync(path.join(tmpdir(), "arcadia-ask-index-"));
      let publishedCommit: string | null = null;
      const refContext = path.join(scratch, "ref-context");
      // An unregistered private admin context avoids Git taking our already-held source HEAD.lock.
      // Its detached HEAD cannot redirect the pinned named-ref update to any live checkout.
      const updateRef = (...args: string[]): void => { askGit(root, ["--git-dir", refContext, "update-ref", "--no-deref", ...args]); };
      let publicationDir: string | null = null;
      try {
        mkdirSync(refContext);
        writeFileSync(path.join(refContext, "HEAD"), `${initialHead}\n`);
        writeFileSync(path.join(refContext, "commondir"), askGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) + "\n");
        const head = initialHead;
        if (askGit(root, ["rev-parse", "HEAD"]) !== head || (tryAskGit(root, ["symbolic-ref", "HEAD"]) ?? "HEAD") !== initialRef) throw new Error("Agent Ask checkout changed during settlement; refused commit.");
        const build = path.join(scratch, "build-index");
        const reconcile = path.join(scratch, "reconcile-index");
        askGit(root, ["read-tree", head], build);
        const entries: { relative: string; mode: string; blob: string | null }[] = [];
        for (const relative of paths) {
          const file = path.resolve(root, relative);
          if (relative === "" || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Invalid governed Git path.");
          if (!existsSync(file)) { askGit(root, ["update-index", "--force-remove", "--", relative], build); entries.push({ relative, mode: "100644", blob: null }); continue; }
          const stat = lstatSync(file);
          if (!stat.isFile() || !realpathSync(file).startsWith(`${realpathSync(root)}${path.sep}`)) throw new Error("Governed Git path escaped the checkout.");
          // Never execute clean filters supplied by repository configuration/attributes.
          const blob = askGit(root, ["hash-object", "-w", "--no-filters", "--", file]);
          const mode = stat.mode & 0o111 ? "100755" : "100644";
          askGit(root, ["update-index", "--add", "--cacheinfo", mode, blob, relative], build);
          entries.push({ relative, mode, blob });
        }
        const tree = askGit(root, ["write-tree"], build);
        if (tree === askGit(root, ["rev-parse", `${head}^{tree}`])) return null;
        // Plumbing intentionally invokes no user hooks: hooks can mutate arbitrary peer checkouts.
        // Author/committer identity remains inherited from Arcadia's resolved identity environment.
        const commit = askGit(root, ["commit-tree", tree, "-p", head, "-m", message], build);
        if (existsSync(index)) copyFileSync(index, reconcile);
        else askGit(root, ["read-tree", head], reconcile);
        for (const entry of entries) {
          askGit(root, entry.blob ? ["update-index", "--add", "--cacheinfo", entry.mode, entry.blob, entry.relative] : ["update-index", "--force-remove", "--", entry.relative], reconcile);
        }
        for (const held of locks) {
          const current = lstatSync(held.path);
          if (current.dev !== held.dev || current.ino !== held.ino) throw new Error("Agent Ask Git lock ownership changed; refused publication.");
        }
        if (askGit(root, ["symbolic-ref", "HEAD"]) !== initialRef || tryAskGit(root, ["symbolic-ref", initialRef]) !== null) throw new Error("Agent Ask branch identity changed; refused publication.");
        // Only the final publication file must share the real index filesystem.
        // This unique, owned metadata directory is outside the tracked checkout.
        publicationDir = mkdtempSync(path.join(path.dirname(index), "arcadia-ask-publication-"));
        const publication = path.join(publicationDir, "index");
        copyFileSync(reconcile, publication);
        // CAS binds the named branch, never a symbolic ref that could redirect to a peer.
        updateRef(initialRef, commit, head);
        publishedCommit = commit;
        for (const held of locks) {
          const current = lstatSync(held.path);
          if (current.dev !== held.dev || current.ino !== held.ino) throw new Error("Agent Ask Git lock ownership changed after ref update; refused index publication.");
        }
        // Publish only our private reconciled bytes, never a replaceable lock pathname.
        renameSync(publication, index);
        return null;
      } catch (error) {
        const failure = error as { stderr?: Buffer | string; message?: string };
        let recovery = "";
        if (publishedCommit) {
          try { updateRef(initialRef, initialHead, publishedCommit); }
          catch { recovery = ` Commit ${publishedCommit} landed, but index publication failed; preserve this commit and reconcile manually.`; }
        }
        return String(failure.stderr ?? failure.message ?? error).trim() + recovery;
      } finally {
        if (publicationDir) rmSync(publicationDir, { recursive: true, force: true });
        rmSync(scratch, { recursive: true, force: true });
      }
    }
  };
}
