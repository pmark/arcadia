import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";

// This transport file is never candidate content. Capture also honors Git ignore
// rules for untracked files, including the candidate's .gitignore.
export const PRESERVATION_REQUEST_FILE = ".arcadia-preserve-request";

/** Capture raw bytes into Git's existing immutable object store, without running
 * candidate hooks, clean filters, export attributes or sharing a worktree index. */
export function snapshotCandidate(candidate: string): string {
  const root = realpathSync(candidate);
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
  const scratch = mkdtempSync(path.join(path.resolve(root, common), "arcadia-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, "index") };
  const git = (args: string[], input?: Buffer | string) => execFileSync("git", args, {
    cwd: root, env, input, maxBuffer: 64 * 1024 * 1024
  });
  try {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString().split("\0");
    if (tracked.includes(PRESERVATION_REQUEST_FILE)) throw validationError("The preservation transport file must not be tracked.");
    const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root })
      .toString().split("\0").filter(Boolean))].sort();
    const selected = files.filter(file => file !== PRESERVATION_REQUEST_FILE);
    // Node has no openat API. The system Python helper uses only stdlib and
    // anchored O_NOFOLLOW descriptors, so racing a parent symlink cannot make
    // the privileged reader follow it outside the selected candidate.
    let captured: Array<{ path: string; mode: number; bytes: string }>;
    try {
      captured = JSON.parse(execFileSync("/usr/bin/python3", ["-I", "-c", CAPTURE_FILES, root], {
        input: JSON.stringify(selected), encoding: "utf8", maxBuffer: 96 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"]
      }));
    } catch {
      throw validationError("Candidate capture refused: regular candidate files only, no symlink/path escapes, at most 64 MiB total; verify /usr/bin/python3 is available.");
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

/** Export the tree's blobs exactly; git archive's export-ignore/subst are not used. */
export function materializeCandidateTree(repository: string, tree: string, destination: string): void {
  const entries = execFileSync("git", ["ls-tree", "-rz", tree], { cwd: repository }).toString().split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw validationError("Validated snapshot contains an unsupported Git entry.");
    const [, mode, hash, name] = match;
    const target = path.resolve(destination, name);
    if (!target.startsWith(`${destination}${path.sep}`)) throw validationError("Snapshot path escaped its root.");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, execFileSync("git", ["cat-file", "blob", hash], { cwd: repository, maxBuffer: 64 * 1024 * 1024 }), { mode: mode === "100755" ? 0o555 : 0o444 });
  }
}

// Isolated system interpreter; neither PYTHONPATH nor candidate modules load.
const CAPTURE_FILES = String.raw`
import os, sys, json, stat, base64
flags = os.O_RDONLY | os.O_NOFOLLOW
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
