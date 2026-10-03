import { boundedExec as bounded, preservationProcessLimits, preservationTimeout } from "./preservationStages.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ArcadiaError, validationError } from "../cli/errors.js";
import { GO_REQUEST_FILE } from "./goRequestProtocol.js";

// This transport file is never candidate content. Capture also honors Git ignore
// rules for untracked files, including the candidate's .gitignore.
export const PRESERVATION_REQUEST_FILE = ".arcadia-preserve-request";

/** A scratch index older than any bounded attempt was orphaned by a killed one. */
const STALE_SCRATCH_INDEX_MS = 60 * 60 * 1000;

function removeStaleScratchIndexes(common: string): void {
  try {
    for (const entry of readdirSync(common)) {
      if (!entry.startsWith("arcadia-index-")) continue;
      const scratch = path.join(common, entry);
      if (Date.now() - statSync(scratch).mtimeMs > STALE_SCRATCH_INDEX_MS) rmSync(scratch, { recursive: true, force: true });
    }
  } catch { /* best effort: a stale scratch index never affects a snapshot */ }
}

/** Capture raw bytes into Git's existing immutable object store, without running
 * candidate hooks, clean filters, export attributes or sharing a worktree index.
 * The candidate's own index is only read, never written. */
export function snapshotCandidate(candidate: string): string {
  const root = realpathSync(candidate);
  const common = path.resolve(root, bounded("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).toString().trim());
  removeStaleScratchIndexes(common);
  const scratch = mkdtempSync(path.join(common, "arcadia-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, "index") };
  const git = (args: string[], input?: Buffer | string) => bounded("git", args, { cwd: root, env, input, maxBuffer: 64 * 1024 * 1024 });
  try {
    const tracked = bounded("git", ["ls-files", "-z"], { cwd: root }).toString().split("\0");
    if (tracked.includes(PRESERVATION_REQUEST_FILE)) throw validationError("The preservation transport file must not be tracked.");
    if (tracked.includes(GO_REQUEST_FILE)) throw validationError("The go transport file must not be tracked.");
    const files = [...new Set(bounded("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root })
      .toString().split("\0").filter(Boolean))].sort();
    const selected = files.filter(file => file !== PRESERVATION_REQUEST_FILE && file !== GO_REQUEST_FILE);
    // Node has no openat API. The system Python helper uses only stdlib and
    // anchored O_NOFOLLOW descriptors, so racing a parent symlink cannot make
    // the privileged reader follow it outside the selected candidate.
    let captured: Array<{ path: string; mode: number; bytes: string }>;
    try {
      captured = JSON.parse(bounded("/usr/bin/python3", ["-I", "-c", CAPTURE_FILES, root], {
        input: JSON.stringify(selected), encoding: "utf8", maxBuffer: 96 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"]
      }, { displayArgs: ["-I", "-c", "<candidate capture>", root] }).toString());
    } catch (error) {
      if (error instanceof ArcadiaError && error.code === "PRESERVATION_GIT_TIMEOUT") throw error;
      // Never include stdout: successful capture output contains file bytes.
      // Python's diagnostic names the refused operation instead of hiding every
      // environmental failure behind the same regular-files message.
      const stderr = (error as { stderr?: Buffer | string }).stderr;
      throw validationError("Candidate capture refused: regular candidate files only, no symlink/path escapes, at most 64 MiB total; verify /usr/bin/python3 is available.",
        { captureDiagnostic: stderr ? String(stderr).slice(-4000) : "Capture returned invalid output." });
    }
    const entries: string[] = [];
    for (const file of captured) {
      const hash = git(["hash-object", "-w", "--stdin"], Buffer.from(file.bytes, "base64")).toString().trim();
      entries.push(`${file.mode & 0o111 ? "100755" : "100644"} ${hash}\t${file.path}\0`);
    }
    git(["read-tree", "--empty"]);
    git(["update-index", "-z", "--index-info"], entries.join(""));
    return git(["write-tree"]).toString().trim();
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/**
 * Wrap an already-known tree into a commit rooted at `parent`, under the
 * standing Arcadia Controller identity, without advancing any ref.
 *
 * Shared by every caller that needs a real commit object built from a tree
 * that was never (or not yet) reachable from a branch: a base-advance merge
 * simulation (`mergesCleanly` only ever sees committed history, since
 * `git merge-tree` takes two commits) and the real preservation commit
 * (`commitCandidate` in candidatePreservation.ts) alike.
 */
export function commitTreeAt(repository: string, tree: string, parent: string, options?: {
  message?: string;
  env?: Record<string, string>;
}): string {
  const message = options?.message ?? "arcadia preservation base-advance check";
  const args = [
    "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false",
    "commit-tree", tree, "-p", parent, "-m", message
  ];
  const result = spawnSync("git", args, {
    ...preservationProcessLimits("git", args), cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Arcadia Controller",
      GIT_AUTHOR_EMAIL: "controller@arcadia.local",
      GIT_COMMITTER_NAME: "Arcadia Controller",
      GIT_COMMITTER_EMAIL: "controller@arcadia.local",
      ...options?.env
    }
  });
  const timeout = preservationTimeout(result.error, "git", args, repository);
  if (timeout) throw timeout;
  if (result.status !== 0) {
    throw validationError("Git could not wrap a candidate tree into a commit.", {
      repository,
      tree,
      parent,
      status: result.status,
      cause: (result.stderr || result.error?.message || "").toString().trim()
    });
  }
  return result.stdout.trim();
}

/**
 * Snapshot the candidate's current on-disk content — including uncommitted
 * changes — and wrap it into a floating commit rooted at `parent`.
 *
 * Used only where no already-validated fingerprint exists to reuse (manual
 * preservation binds no separate validation step). A caller that already
 * holds a validated `candidateFingerprint` — protected preservation does —
 * must pass that tree to `commitTreeAt` directly instead of calling this and
 * re-snapshotting: two independent snapshot calls can observe different
 * on-disk content if anything touches the worktree in between, which would
 * silently decouple the base-advance check from the tree actually preserved.
 */
export function snapshotCandidateCommit(repository: string, candidate: string, parent: string): string {
  return commitTreeAt(repository, snapshotCandidate(candidate), parent);
}

/** Export the tree's blobs exactly; git archive's export-ignore/subst are not used. */
export function materializeCandidateTree(repository: string, tree: string, destination: string): void {
  const entries = bounded("git", ["ls-tree", "-rz", tree], { cwd: repository }).toString().split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw validationError("Validated snapshot contains an unsupported Git entry.");
    const [, mode, hash, name] = match;
    const target = path.resolve(destination, name);
    if (!target.startsWith(`${destination}${path.sep}`)) throw validationError("Snapshot path escaped its root.");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bounded("git", ["cat-file", "blob", hash], { cwd: repository, maxBuffer: 64 * 1024 * 1024 }), { mode: mode === "100755" ? 0o555 : 0o444 });
  }
}

// Isolated system interpreter; neither PYTHONPATH nor candidate modules load.
const CAPTURE_FILES = String.raw`
import os, sys, json, stat, base64
flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
root = os.open("/", flags | os.O_DIRECTORY)
for component in sys.argv[1].split("/"):
    if component:
        child = os.open(component, flags | os.O_DIRECTORY, dir_fd=root)
        os.close(root)
        root = child
results, total = [], 0
for name in json.load(sys.stdin):
    parts = name.split("/")
    if any(p in ("", ".", "..") for p in parts): raise ValueError("Invalid candidate path")
    fd = os.dup(root)
    try:
        for i, part in enumerate(parts):
            child = os.open(part, flags | (os.O_DIRECTORY if i < len(parts)-1 else 0), dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode): raise ValueError("Preservation supports regular candidate files only")
        with os.fdopen(os.dup(fd), "rb") as stream: data = stream.read(64*1024*1024+1)
        total += len(data)
        if total > 64*1024*1024: raise ValueError("Candidate exceeds the 64 MiB preservation capture limit")
        results.append(dict(path=name, mode=info.st_mode, bytes=base64.b64encode(data).decode("ascii")))
    except FileNotFoundError:
        pass
    except OSError as error:
        raise ValueError("Preservation supports regular candidate files only; symlinks and path escapes are refused") from error
    finally:
        os.close(fd)
os.close(root)
print(json.dumps(results))
`;
