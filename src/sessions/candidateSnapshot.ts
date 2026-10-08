import { boundedExec as bounded, preservationProcessLimits, preservationTimeout } from "./preservationStages.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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

/**
 * Baseline symlink blobs: every mode-120000 entry in the immutable
 * `baseRevision` tree whose path is among `selected`, keyed by path. This
 * reads only the immutable base tree -- never the worktree's own (mutable)
 * index state or an arbitrary candidate HEAD, which may carry
 * candidate-authored commits a compromised candidate could use to launder a
 * changed or newly added symlink as "unchanged". Membership here is only a
 * candidate for trust: {@link snapshotCandidate} still confirms each one's
 * literal on-disk content against this same blob before trusting it.
 */
function baselineSymlinkBlobs(
  git: (args: string[], input?: Buffer | string) => Buffer | string,
  baseRevision: string,
  selected: readonly string[]
): Map<string, string> {
  const selectedSet = new Set(selected);
  const entries = git(["ls-tree", "-rz", baseRevision]).toString().split("\0").filter(Boolean);
  const blobs = new Map<string, string>();
  for (const entry of entries) {
    const match = /^120000 blob ([0-9a-f]{4,64})\t([\s\S]+)$/.exec(entry);
    if (match && selectedSet.has(match[2])) blobs.set(match[2], match[1]);
  }
  return blobs;
}

/**
 * The real candidate index (never the scratch one `snapshotCandidate` builds)
 * restricting, but never granting, baseline-symlink trust: exactly one
 * stage-0 `120000` entry whose blob is this same path's immutable baseline
 * blob. A merge conflict (more than one stage entry), a retarget staged but
 * not yet committed (a different blob at stage 0), or the path removed from
 * the index entirely (no entry at all, including when `--others` still lists
 * it as untracked and its on-disk link is still byte-identical to history)
 * all fail this and are excluded here; {@link snapshotCandidate} still
 * confirms the fresh on-disk link text against the same blob before actually
 * trusting one that passes.
 */
function indexAgreesWithBaseline(root: string, baselineSymlinks: ReadonlyMap<string, string>): Set<string> {
  const agree = new Set<string>();
  if (baselineSymlinks.size === 0) return agree;
  const stages = new Map<string, Array<{ stage: string; mode: string; hash: string }>>();
  const entries = bounded("git", ["ls-files", "--stage", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = /^([0-7]+) ([0-9a-f]{4,64}) ([0-3])\t([\s\S]+)$/.exec(entry);
    if (!match) continue;
    const [, mode, hash, stage, filePath] = match;
    if (!baselineSymlinks.has(filePath)) continue;
    const list = stages.get(filePath) ?? [];
    list.push({ stage, mode, hash });
    stages.set(filePath, list);
  }
  for (const [filePath, baseHash] of baselineSymlinks) {
    const entriesForPath = stages.get(filePath);
    if (entriesForPath?.length !== 1) continue;
    const [{ stage, mode, hash }] = entriesForPath;
    if (stage === "0" && mode === "120000" && hash === baseHash) agree.add(filePath);
  }
  return agree;
}

/** Run the anchored privileged reader and translate any failure (a timeout
 * aside) into the same refusal every capture failure already reports; never
 * include stdout, which carries file bytes on a successful capture. */
function privilegedRead<T>(script: string, root: string, input: unknown, label: string): T {
  try {
    return JSON.parse(bounded("/usr/bin/python3", ["-I", "-c", script, root], {
      input: JSON.stringify(input), encoding: "utf8", maxBuffer: 96 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"]
    }, { displayArgs: ["-I", "-c", label, root] }).toString()) as T;
  } catch (error) {
    if (error instanceof ArcadiaError && error.code === "PRESERVATION_GIT_TIMEOUT") throw error;
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    throw validationError("Candidate capture refused: regular candidate files only, no symlink/path escapes, at most 64 MiB total; verify /usr/bin/python3 is available.",
      { captureDiagnostic: stderr ? String(stderr).slice(-4000) : "Capture returned invalid output." });
  }
}

/** Capture raw bytes into Git's existing immutable object store, without running
 * candidate hooks, clean filters, export attributes or sharing a worktree index.
 * The candidate's own index is only read, never written.
 *
 * `baseRevision`, when given, is the candidate's immutable canonical launch
 * base. An unchanged tracked symlink -- one whose real (never the scratch)
 * index carries exactly one stage-0 `120000` entry for that path matching
 * `baseRevision`'s own blob there, AND whose literal on-disk link text, read
 * through the same anchored O_NOFOLLOW privileged reader used for regular
 * files, is byte-identical to that same blob -- is retained straight from
 * that immutable blob; its on-disk link is read (to prove it is unchanged)
 * but never dereferenced. Both checks run fresh on every call, including the
 * post-validation recheck, so a disk-only retarget between two calls is never
 * invisible to either one. Every other path -- missing, no longer a symlink,
 * a staged-only retarget, a merge conflict, removed from the index, or
 * changed on disk -- falls through to the privileged reader below and
 * refuses exactly as before for an actual symlink; a baseline symlink
 * replaced by a regular file captures its current regular content normally. */
export function snapshotCandidate(candidate: string, baseRevision?: string): string {
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
    const baselineSymlinks = baseRevision ? baselineSymlinkBlobs(git, baseRevision, selected) : new Map<string, string>();
    // Index membership only restricts trust candidates below; it never grants
    // it by itself. A conflict, a staged-only retarget or a path the real
    // index no longer carries are excluded here, before the on-disk check.
    const indexAgrees = indexAgreesWithBaseline(root, baselineSymlinks);
    const symlinkCandidates = [...indexAgrees];
    // Node has no openat API. The system Python helper uses only stdlib and
    // anchored O_NOFOLLOW descriptors, so racing a parent symlink cannot make
    // the privileged reader follow it outside the selected candidate.
    const onDiskLinks = symlinkCandidates.length
      ? privilegedRead<Record<string, string>>(VERIFY_SYMLINKS, root, symlinkCandidates, "<candidate symlink verify>")
      : {};
    const trustedSymlinks: Array<{ path: string; hash: string }> = [];
    for (const filePath of indexAgrees) {
      const hash = baselineSymlinks.get(filePath)!;
      const onDisk = onDiskLinks[filePath];
      if (onDisk === undefined) continue;
      if (onDisk === git(["cat-file", "blob", hash]).toString()) trustedSymlinks.push({ path: filePath, hash });
    }
    const trustedPaths = new Set(trustedSymlinks.map(entry => entry.path));
    const toCapture = trustedPaths.size ? selected.filter(file => !trustedPaths.has(file)) : selected;
    const captured = privilegedRead<Array<{ path: string; mode: number; bytes: string }>>(CAPTURE_FILES, root, toCapture, "<candidate capture>");
    const entries: string[] = [];
    for (const file of captured) {
      const hash = git(["hash-object", "-w", "--stdin"], Buffer.from(file.bytes, "base64")).toString().trim();
      entries.push(`${file.mode & 0o111 ? "100755" : "100644"} ${hash}\t${file.path}\0`);
    }
    for (const symlink of trustedSymlinks) entries.push(`120000 ${symlink.hash}\t${symlink.path}\0`);
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
 *
 * `baseRevision` is the canonical launch base `snapshotCandidate` trusts
 * unchanged baseline symlinks against. It is deliberately a separate
 * argument from `parent`: `parent` is often the candidate's own current
 * (mutable, possibly candidate-authored) HEAD, which is exactly the kind of
 * self-referential anchor trust must not be derived from.
 */
export function snapshotCandidateCommit(repository: string, candidate: string, baseRevision: string, parent: string): string {
  return commitTreeAt(repository, snapshotCandidate(candidate, baseRevision), parent);
}

/** Export the tree's blobs exactly; git archive's export-ignore/subst are not used.
 * A `120000` entry (an unchanged baseline symlink `snapshotCandidate` retained)
 * is materialized as a real symlink, but only once its literal link text is
 * confirmed to resolve inside `destination`: a fixture symlink that is already
 * self-contained in the preserved tree (such as the baseline skill symlink
 * pointing at its own tracked target directory) materializes as usual, while
 * one whose target would escape the restricted snapshot is refused before any
 * symlink is created, rather than left for a later cross-file write through it. */
export function materializeCandidateTree(repository: string, tree: string, destination: string): void {
  const entries = bounded("git", ["ls-tree", "-rz", tree], { cwd: repository }).toString().split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = /^(100644|100755|120000) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw validationError("Validated snapshot contains an unsupported Git entry.");
    const [, mode, hash, name] = match;
    const target = path.resolve(destination, name);
    if (!target.startsWith(`${destination}${path.sep}`)) throw validationError("Snapshot path escaped its root.");
    mkdirSync(path.dirname(target), { recursive: true });
    const blob = bounded("git", ["cat-file", "blob", hash], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
    if (mode === "120000") {
      const linkTarget = blob.toString();
      const resolvedTarget = path.resolve(path.dirname(target), linkTarget);
      if (resolvedTarget !== destination && !resolvedTarget.startsWith(`${destination}${path.sep}`)) {
        throw validationError("Snapshot symlink target escaped its root.");
      }
      symlinkSync(linkTarget, target);
    } else {
      writeFileSync(target, blob, { mode: mode === "100755" ? 0o555 : 0o444 });
    }
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

// Reads the literal link text of exactly the given paths, never following
// the final symlink and never opening it: every ancestor component is
// anchored with O_NOFOLLOW exactly as in CAPTURE_FILES, then the leaf is
// lstat/readlink'd by name through that anchored parent descriptor. A path
// that is missing, or that is no longer a symlink, is simply absent from
// the result.
const VERIFY_SYMLINKS = String.raw`
import os, sys, json, stat
flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
root = os.open("/", flags | os.O_DIRECTORY)
for component in sys.argv[1].split("/"):
    if component:
        child = os.open(component, flags | os.O_DIRECTORY, dir_fd=root)
        os.close(root)
        root = child
links = {}
for name in json.load(sys.stdin):
    parts = name.split("/")
    if any(p in ("", ".", "..") for p in parts): raise ValueError("Invalid candidate path")
    fd = os.dup(root)
    try:
        for part in parts[:-1]:
            child = os.open(part, flags | os.O_DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.lstat(parts[-1], dir_fd=fd)
        if stat.S_ISLNK(info.st_mode):
            links[name] = os.readlink(parts[-1], dir_fd=fd)
    except FileNotFoundError:
        pass
    except OSError as error:
        raise ValueError("Preservation supports regular candidate files only; symlinks and path escapes are refused") from error
    finally:
        os.close(fd)
os.close(root)
print(json.dumps(links))
`;
