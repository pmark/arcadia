import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { preservationProcessLimits } from "../sessions/preservationStages.js";

/** Ask operations must address the caller's checkout, never inherited Git relocation/config. */
export function askGitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  for (const key of Object.keys(env)) {
    if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES|NAMESPACE|DISCOVERY_ACROSS_FILESYSTEM|CONFIG.*)$/.test(key)) delete env[key];
  }
  return env;
}

export function askGit(root: string, args: string[], index?: string, trim = true): string {
  const env = askGitEnvironment();
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
  const initialHead = askGit(root, ["rev-parse", "HEAD"]);
  const initialRef = tryAskGit(root, ["symbolic-ref", "HEAD"]) ?? "HEAD";
  const lock = `${index}.lock`;
  let fd: number;
  try { fd = openSync(lock, "wx", 0o600); } catch {
    throw validationError("Agent Ask settlement refused: Git index is locked; existing work and lock were preserved.", { index, lock, remedy: "Wait for the owning Git operation to finish, then retry the same settlement. Do not remove its lock." });
  }
  const owned = fstatSync(fd);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    closeSync(fd);
    try {
      const current = lstatSync(lock);
      if (current.dev === owned.dev && current.ino === owned.ino) rmSync(lock);
    } catch { /* The owned lock was published or removed; never touch a replacement. */ }
  };
  return {
    release,
    commit: (paths, message) => {
      const scratch = mkdtempSync(path.join(tmpdir(), "arcadia-ask-index-"));
      try {
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
        const current = lstatSync(lock);
        if (current.dev !== owned.dev || current.ino !== owned.ino) throw new Error("Agent Ask index lock ownership changed; refused publication.");
        // Prepare the reconciled index before changing HEAD; CAS refuses concurrent ref movement.
        writeFileSync(fd, readFileSync(reconcile));
        askGit(root, ["update-ref", initialRef, commit, head]);
        renameSync(lock, index);
        return null;
      } catch (error) {
        const failure = error as { stderr?: Buffer | string; message?: string };
        return String(failure.stderr ?? failure.message ?? error).trim();
      } finally { rmSync(scratch, { recursive: true, force: true }); }
    }
  };
}
