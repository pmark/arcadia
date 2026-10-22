import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, chmodSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { preservationStage, withPreservationProgress } from "../src/sessions/preservationStages.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materializeCandidateTree, snapshotCandidate } from "../src/sessions/candidateSnapshot.js";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});
let realExec: typeof execFileSync;
const roots: string[] = [];
beforeEach(async () => {
  realExec = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).execFileSync;
  vi.mocked(execFileSync).mockImplementation(realExec);
});
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const identity = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'snapshot-"雪\\\n-'));
  roots.push(root);
  const repo = path.join(root, "repo");
  realExec("git", ["init", "--object-format=sha1", "-q", repo]);
  const git = (args: string[], input?: string | Buffer, env = identity) => realExec("git", args, { cwd: repo, input, env }).toString().trim();
  writeFileSync(path.join(repo, "tracked.ignored"), "tracked despite ignore\n");
  writeFileSync(path.join(repo, "deleted"), "remove me");
  mkdirSync(path.join(repo, "dir"));
  writeFileSync(path.join(repo, "dir", "target"), "baseline target");
  symlinkSync("dir", path.join(repo, "link"));
  git(["add", "-A"]); git(["commit", "-qm", "baseline"]);
  const base = git(["rev-parse", "HEAD"]);
  const state = () => ({ head: git(["rev-parse", "HEAD"]), index: readFileSync(path.join(repo, ".git", "index")).toString("hex"), status: git(["--no-optional-locks", "status", "--porcelain=v1", "-z"]) });
  return { root, repo, git, base, state };
}

describe("batched candidate blobs", () => {
  it("matches the per-blob reference tree, bytes and modes without changing candidate state", () => {
    const f = fixture();
    const files = new Map<string, { bytes: Buffer; mode: string }>();
    const put = (name: string, bytes: Buffer | string, mode = "100644") => {
      const data = Buffer.from(bytes);
      writeFileSync(path.join(f.repo, name), data);
      if (mode === "100755") chmodSync(path.join(f.repo, name), 0o755);
      files.set(name, { bytes: data, mode });
    };
    put("tracked.ignored", "staged\n"); f.git(["add", "tracked.ignored"]);
    put("tracked.ignored", "unstaged\r\n");
    put("dir/target", "baseline target");
    put(".gitignore", "*.ignored\n");
    put(".gitattributes", "*.filtered filter=must-not-run\n* text eol=lf export-subst\n");
    put("raw.filtered", "raw\r\n");
    f.git(["config", "filter.must-not-run.clean", "false"]); f.git(["config", "filter.must-not-run.required", "true"]);
    rmSync(path.join(f.repo, "deleted"));
    for (const name of ["-option", 'quote"', "back\\slash", "line\nbreak", "tab\tname", "雪", "empty", "exec"]) {
      put(name, name === "empty" ? Buffer.alloc(0) : Buffer.from([0, 255, 10, 13, 65]), name === "exec" ? "100755" : "100644");
    }
    for (let index = 0; index < 270; index++) put(`tiny-${index}`, `blob ${index}\n`);
    put("large", Buffer.alloc(9 * 1024 * 1024, 255));
    put("second-large", Buffer.alloc(3 * 1024 * 1024, 10));
    writeFileSync(path.join(f.repo, "not-captured.ignored"), "ignored");
    writeFileSync(path.join(f.repo, ".arcadia-preserve-request"), "transport");
    writeFileSync(path.join(f.repo, ".arcadia-go-request"), "transport");
    // Independently compute raw Git blob identities, then build the reference
    // tree through a separate index after capture has stored those objects.
    // This oracle does not recreate the per-file subprocess cost in every test.
    const env = { ...identity, GIT_INDEX_FILE: path.join(f.root, "reference-index") };
    const sizeByHash = new Map<string, number>();
    const entries = [...files].map(([name, file]) => {
      const hash = createHash("sha1").update(`blob ${file.bytes.length}\0`).update(file.bytes).digest("hex");
      sizeByHash.set(hash, file.bytes.length);
      return `${file.mode} ${hash}\t${name}\0`;
    });
    const linkHash = f.git(["rev-parse", `${f.base}:link`]);
    entries.push(`120000 ${linkHash}\tlink\0`); sizeByHash.set(linkHash, 3);
    const before = f.state();
    vi.mocked(execFileSync).mockClear();
    const tree = snapshotCandidate(f.repo, f.base);
    f.git(["read-tree", "--empty"], undefined, env);
    f.git(["update-index", "-z", "--index-info"], entries.join(""), env);
    expect(tree).toBe(f.git(["write-tree"], undefined, env));
    expect(vi.mocked(execFileSync).mock.calls.filter(([command, args]) => command === "git" && args?.[0] === "hash-object")).toHaveLength(1);
    const destination = path.join(f.root, "destination"); mkdirSync(destination);
    vi.mocked(execFileSync).mockClear();
    const requests: string[][] = [];
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions) => {
      if (command === "git" && args[0] === "cat-file" && args.includes("--batch")) {
        const fd = (options.stdio as unknown[])[0] as number;
        const request = Buffer.alloc(fstatSync(fd).size);
        readSync(fd, request, 0, request.length, 0); // positional read leaves Git's offset at zero
        requests.push(request.toString().trim().split("\n"));
      }
      return realExec(command, args, options);
    }) as typeof execFileSync);
    materializeCandidateTree(f.repo, tree, destination);
    const batches = vi.mocked(execFileSync).mock.calls.filter(([command, args]) => command === "git" && args?.[0] === "cat-file");
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.length).toBeLessThan(6);
    expect(requests.flat()).toHaveLength(files.size + 1);
    for (const request of requests) {
      expect(request.length).toBeLessThanOrEqual(256);
      const bytes = request.reduce((sum, hash) => sum + sizeByHash.get(hash)!, 0);
      expect(request.length === 1 || bytes <= 8 * 1024 * 1024).toBe(true);
    }
    for (const [name, file] of files) {
      expect(readFileSync(path.join(destination, name)).equals(file.bytes), name).toBe(true);
      expect(lstatSync(path.join(destination, name)).mode & 0o777).toBe(file.mode === "100755" ? 0o555 : 0o444);
    }
    expect(readlinkSync(path.join(destination, "link"))).toBe("dir");
    expect(readdirSync(destination)).not.toContain("not-captured.ignored");
    expect(f.state()).toEqual(before);
    expect(readdirSync(path.join(f.repo, ".git")).filter(name => name.startsWith("arcadia-index-"))).toEqual([]);
  }, 30_000);

  it("materializes a real size-aware tree listing above Node's default output buffer", () => {
    const f = fixture();
    const count = 16_000;
    const empty = f.git(["hash-object", "-w", "--stdin"], "");
    const names = Array.from({ length: count }, (_, index) => `file-${String(index).padStart(5, "0")}`);
    const manifest = path.join(f.root, "tree-input");
    writeFileSync(manifest, names.map(name => `100644 blob ${empty}\t${name}\n`).join(""));
    const fd = openSync(manifest, "r");
    let tree: string;
    try {
      tree = realExec("git", ["mktree"], { cwd: f.repo, stdio: [fd, "pipe", "pipe"] }).toString().trim();
    } finally { closeSync(fd); }
    const listing = (flag: string) => realExec("git", ["ls-tree", flag, tree], { cwd: f.repo, maxBuffer: 64 * 1024 * 1024 });
    // Real Git output proves -l crosses the default 1 MiB bound for a tree
    // whose former listing still fits; no synthetic oversized stdout is used.
    expect(listing("-rz").byteLength).toBeLessThan(1024 * 1024);
    expect(listing("-rlz").byteLength).toBeGreaterThan(1024 * 1024);
    const before = f.state();
    const destination = path.join(f.root, "large-tree"); mkdirSync(destination);
    vi.mocked(execFileSync).mockClear();
    materializeCandidateTree(f.repo, tree, destination);
    expect(readdirSync(destination).sort()).toEqual(names);
    for (const name of names) {
      const entry = lstatSync(path.join(destination, name));
      expect(entry.isFile()).toBe(true);
      expect(entry.size).toBe(0);
      expect(entry.mode & 0o777).toBe(0o444);
    }
    expect(vi.mocked(execFileSync).mock.calls.filter(([command, args]) => command === "git" && args?.[0] === "cat-file")).toHaveLength(Math.ceil(count / 256));
    expect(f.state()).toEqual(before);
  }, 30_000);

  it("captures and materializes an empty tree without issuing blob calls", () => {
    const f = fixture();
    for (const name of ["tracked.ignored", "deleted", "dir", "link"]) rmSync(path.join(f.repo, name), { recursive: true });
    const before = f.state();
    const tree = snapshotCandidate(f.repo);
    expect(tree).toBe(f.git(["mktree"], ""));
    vi.mocked(execFileSync).mockClear();
    const destination = path.join(f.root, "empty"); mkdirSync(destination);
    materializeCandidateTree(f.repo, tree, destination);
    expect(readdirSync(destination)).toEqual([]);
    expect(vi.mocked(execFileSync).mock.calls.some(([command, args]) => command === "git" && args?.[0] === "cat-file")).toBe(false);
    expect(f.state()).toEqual(before);
  });

  it("bounds batch reads with finite unlinked regular-file stdin and retains typed timeout cleanup", () => {
    const f = fixture();
    const tree = snapshotCandidate(f.repo, f.base);
    const before = f.state();
    let descriptor: number | undefined;
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions) => {
      if (command === "git" && args[0] === "cat-file" && args.includes("--batch")) {
        descriptor = (options.stdio as unknown[])[0] as number;
        expect(fstatSync(descriptor).isFile()).toBe(true);
        expect(fstatSync(descriptor).nlink).toBe(0);
        expect(options.input).toBeUndefined();
        return realExec(process.execPath, ["-e", "require('node:fs').readFileSync(0);setInterval(()=>{},1000)"], options);
      }
      return realExec(command, args, options);
    }) as typeof execFileSync);
    const destination = path.join(f.root, "timed-out"); mkdirSync(destination);
    expect(() => withPreservationProgress(() => undefined, () => {
      preservationStage("validation.materialize");
      materializeCandidateTree(f.repo, tree, destination);
    }, { gitTimeoutMs: ({ command, args }) => command === "git" && args[0] === "cat-file" ? 300 : 15_000 }))
      .toThrow(expect.objectContaining({ code: "PRESERVATION_GIT_TIMEOUT", details: expect.objectContaining({ stage: "validation.materialize", timeoutMs: 300 }) }));
    expect(descriptor).toBeDefined();
    expect(() => fstatSync(descriptor!)).toThrow(/EBADF/);
    expect(f.state()).toEqual(before);
  });

  it.each(["empty", "extra", "invalid"])("refuses %s capture identities and cleans its private scratch", fault => {
    const f = fixture(); const before = f.state();
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions) => {
      const response = realExec(command, args, options);
      if (command !== "git" || args[0] !== "hash-object" || !args.includes("--stdin-paths")) return response;
      return Buffer.from(fault === "empty" ? "" : fault === "extra" ? response.toString() + "a".repeat(40) + "\n" : "invalid\n");
    }) as typeof execFileSync);
    expect(() => snapshotCandidate(f.repo, f.base)).toThrow(/invalid Git blob identities/);
    expect(f.state()).toEqual(before);
    expect(readdirSync(path.join(f.repo, ".git")).filter(name => name.startsWith("arcadia-index-"))).toEqual([]);
  });

  it.each(["hash", "high-bit", "missing", "type", "size", "truncated", "trailing"])("refuses corrupt %s batch output and preserves source state", fault => {
    const f = fixture();
    const tree = snapshotCandidate(f.repo, f.base);
    const before = f.state();
    const destination = path.join(f.root, "destination"); mkdirSync(destination);
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions) => {
      const response = realExec(command, args, options);
      if (command !== "git" || args[0] !== "cat-file" || !args.includes("--batch")) return response;
      const data = Buffer.from(response);
      if (fault === "hash") data[0] = data[0] === 97 ? 98 : 97;
      if (fault === "high-bit") data[0] |= 128;
      if (fault === "missing") return Buffer.from("deadbeef missing\n");
      if (fault === "type") return Buffer.from(data.toString("binary").replace(" blob ", " tree "), "binary");
      if (fault === "size") return Buffer.from(data.toString("binary").replace(/ blob [0-9]+\n/, " blob 999999999\n"), "binary");
      if (fault === "truncated") return data.subarray(0, data.length - 2);
      if (fault === "trailing") return Buffer.concat([data, Buffer.from("extra")]);
      return data;
    }) as typeof execFileSync);
    expect(() => materializeCandidateTree(f.repo, tree, destination)).toThrow(/batch returned/);
    expect(f.state()).toEqual(before);
  });
});
