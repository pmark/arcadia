import { execFileSync, spawnSync, type ExecFileSyncOptions, type SpawnSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPatchEquivalent } from "../src/git/worktrees.js";
import { snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { validateCompletionCandidate } from "../src/sessions/completionValidation.js";
import { systemTmux } from "../src/sessions/index.js";
import { preservationStage, withPreservationProgress } from "../src/sessions/preservationStages.js";
import { installTimeoutFixtureHooks, observeCandidate, plainFixture } from "./preservationTimeoutFixture.js";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync), spawnSync: vi.fn(actual.spawnSync) };
});

const READER = "/usr/bin/python3";
const READER_BOUND_MS = 700;

installTimeoutFixtureHooks();
let realExec: typeof execFileSync;
let realSpawn: typeof spawnSync;
beforeEach(async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  realExec = actual.execFileSync;
  realSpawn = actual.spawnSync;
  vi.mocked(execFileSync).mockImplementation(realExec);
  vi.mocked(spawnSync).mockImplementation(realSpawn);
});

describe("candidate snapshot subprocess input", () => {
  it("captures exact immutable bytes even when pipe input cannot deliver EOF", () => {
    const f = plainFixture();
    const bytes = Buffer.from([0, 255, 13, 10, 65]);
    writeFileSync(path.join(f.candidate, "binary-input"), bytes);
    writeFileSync(path.join(f.candidate, "empty-input"), "");
    const before = observeCandidate(f.candidate);
    // Fault injection, not a claim about the live Node root cause: replace a
    // Buffer-fed pipe with a real FIFO whose writer stays open. Git consumes
    // its bytes, then blocks on EOF exactly as the captured live stack did.
    // Descriptor-fed regular files run unmodified through the real subprocess.
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions = {}) => {
      const input = options.input;
      if (command !== "git" || !args.some(arg => arg === "--stdin" || arg === "--stdin-paths") || (typeof input !== "string" && !Buffer.isBuffer(input))) {
        return realExec(command, args, options);
      }
      const fifo = path.join(f.root, "withheld-eof");
      realExec("mkfifo", [fifo]);
      const fd = openSync(fifo, constants.O_RDWR);
      try {
        writeSync(fd, typeof input === "string" ? Buffer.from(input) : input);
        return realExec(command, args, { ...options, input: undefined, stdio: [fd, "pipe", "pipe"] });
      } finally {
        closeSync(fd);
        rmSync(fifo);
      }
    }) as typeof execFileSync);
    // Exercise the fault injector itself with both transports: --stdin-paths
    // uses text, whereas the former per-blob --stdin path used a Buffer.
    const request = JSON.stringify(path.join(f.candidate, "binary-input")) + "\n";
    for (const input of [request, Buffer.from(request)]) {
      expect(() => execFileSync("git", ["hash-object", "-w", "--no-filters", "--stdin-paths"], {
        cwd: f.candidate, input, timeout: 800, killSignal: "SIGKILL"
      })).toThrow(expect.objectContaining({ code: "ETIMEDOUT" }));
    }
    const capture = () => withPreservationProgress(() => undefined, () => {
      preservationStage("validation.binding");
      return snapshotCandidate(f.candidate);
    }, { gitTimeoutMs: ({ command, args }) => command === "git" && args[0] === "hash-object" ? 800 : 15_000 });
    const tree = capture();
    for (const [file, expected] of [["binary-input", bytes], ["empty-input", Buffer.alloc(0)]] as const) {
      const hash = createHash("sha1").update(`blob ${expected.length}\0`).update(expected).digest("hex");
      expect(realExec("git", ["rev-parse", `${tree}:${file}`], { cwd: f.candidate, encoding: "utf8" }).trim()).toBe(hash);
      expect(readFileSync(path.join(f.candidate, file))).toEqual(expected);
    }
    expect(capture()).toBe(tree);
    expect(observeCandidate(f.candidate)).toEqual(before);
  }, 15_000);

  it.each([false, true])("keeps input private and read-only, then closes and removes it (timeout: %s)", timeout => {
    const f = plainFixture();
    const before = observeCandidate(f.candidate);
    const common = realExec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: f.candidate, encoding: "utf8"
    }).trim();
    const scratchBefore = readdirSync(common).filter(name => name.startsWith("arcadia-index-"));
    const descriptors = new Set<number>();
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions = {}) => {
      if (command === "git" && args.some(arg => arg === "--stdin" || arg === "--stdin-paths")) {
        const fd = Array.isArray(options.stdio) ? options.stdio[0] : undefined;
        expect(typeof fd).toBe("number");
        const stat = fstatSync(fd as number);
        expect(stat.isFile()).toBe(true);
        expect(stat.mode & 0o777).toBe(0o600);
        expect(stat.nlink).toBe(0);
        expect(() => writeSync(fd as number, Buffer.from("forbidden"))).toThrow(/EBADF/);
        descriptors.add(fd as number);
        expect(options.input).toBeUndefined();
        if (timeout) {
          // A real child that reads through EOF, then deliberately remains
          // alive: descriptor input must not weaken the existing native bound.
          return realExec(process.execPath, ["-e", "require('node:fs').readFileSync(0);setInterval(()=>{},1000)"], options);
        }
      }
      return realExec(command, args, options);
    }) as typeof execFileSync);
    const capture = () => withPreservationProgress(() => undefined, () => {
      preservationStage("validation.binding");
      return snapshotCandidate(f.candidate);
    }, { gitTimeoutMs: ({ command, args }) => command === "git" && args[0] === "hash-object" ? 800 : 15_000 });
    if (timeout) {
      expect(capture).toThrow(expect.objectContaining({
        code: "PRESERVATION_GIT_TIMEOUT", details: expect.objectContaining({ stage: "validation.binding", timeoutMs: 800 })
      }));
    } else {
      expect(capture()).toMatch(/^[a-f0-9]{40}$/);
    }
    expect(descriptors.size).toBeGreaterThan(0);
    for (const fd of descriptors) expect(() => fstatSync(fd)).toThrow(/EBADF/);
    expect(readdirSync(common).filter(name => name.startsWith("arcadia-index-"))).toEqual(scratchBefore);
    expect(observeCandidate(f.candidate)).toEqual(before);
  }, 15_000);
});

describe("candidate capture reader outside any preservation attempt (#2084)", () => {
  /** Withhold EOF from the reader whatever stdin it was given: a real FIFO whose
   * writer stays open, as in the suite above. Refuses to run a reader with no
   * bound, because that would hang this worker rather than fail the test. Every
   * other call keeps a long bound, so only the reader can time out under load. */
  function withholdReaderEof(root: string, observed: { timeout?: unknown; killSignal?: unknown }) {
    vi.stubEnv("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS", String(READER_BOUND_MS));
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions = {}) => {
      if (command !== READER) return realExec(command, args, { ...options, timeout: 15_000 });
      Object.assign(observed, { timeout: options.timeout, killSignal: options.killSignal });
      if (options.timeout === undefined) throw new Error("The reader ran with no bound; injecting the fault would hang the suite.");
      const fifo = path.join(root, "withheld-eof");
      realExec("mkfifo", [fifo]);
      const fd = openSync(fifo, constants.O_RDWR);
      try {
        writeSync(fd, "[]");
        return realExec(command, args, { ...options, input: undefined, stdio: [fd, "pipe", "pipe"] });
      } finally {
        closeSync(fd);
        rmSync(fifo);
      }
    }) as typeof execFileSync);
  }

  it("bounds capture with no progress store, and reports the bound it used", () => {
    const f = plainFixture();
    const before = observeCandidate(f.candidate);
    const observed = {};
    withholdReaderEof(f.root, observed);
    expect(() => snapshotCandidate(f.candidate)).toThrow(expect.objectContaining({
      code: "PRESERVATION_GIT_TIMEOUT",
      message: expect.stringContaining(`exceeded its ${READER_BOUND_MS} ms bound`),
      details: expect.objectContaining({ retryable: true, command: READER, stage: null, timeoutMs: READER_BOUND_MS })
    }));
    expect(observed).toEqual({ timeout: READER_BOUND_MS, killSignal: "SIGKILL" });
    expect(observeCandidate(f.candidate)).toEqual(before);
  }, 15_000);

  const candidate = (f: ReturnType<typeof plainFixture>) => ({
    repository: f.candidate, worktree: f.candidate, base: "HEAD", workspace: f.root, commands: ["true"], acceptanceCriteria: ["tests/x.test.ts passes."]
  });

  it("makes a hung capture a counted host timeout, not a refusal blaming the candidate's files", () => {
    const f = plainFixture();
    withholdReaderEof(f.root, {});
    const result = validateCompletionCandidate(candidate(f), { unconfinedForTests: true });
    expect(result).toMatchObject({ status: "refused", timedOut: true, hostFault: true });
    const { reason } = result as { reason: string };
    expect(reason).toContain("not a refusal of the candidate's files");
    expect(reason).not.toMatch(/symlink|regular candidate files only|is available|protected launcher/);
  }, 15_000);

  it("treats a reader killed by a signal the same way (the 2026-11-05 operator kill)", () => {
    const f = plainFixture();
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions = {}) =>
      command === READER ? realExec("/bin/sh", ["-c", "kill -KILL $$"], options) : realExec(command, args, options)) as typeof execFileSync);
    expect(() => snapshotCandidate(f.candidate)).toThrow(expect.objectContaining({
      code: "PRESERVATION_GIT_TIMEOUT", details: expect.objectContaining({ retryable: true, reason: "killed", signal: "SIGKILL" })
    }));
    const result = validateCompletionCandidate(candidate(f), { unconfinedForTests: true });
    expect(result).toMatchObject({ status: "refused", timedOut: true, hostFault: true });
    expect((result as { reason: string }).reason).not.toMatch(/symlink|regular candidate files only/);
  }, 15_000);

  it("still refuses what a reader that finished refuses, without blaming python3", () => {
    const f = plainFixture();
    symlinkSync("outside", path.join(f.candidate, "new-link"));
    expect(() => snapshotCandidate(f.candidate)).toThrow(/Candidate capture refused: regular candidate files only/);
    const result = validateCompletionCandidate(candidate(f), { unconfinedForTests: true });
    expect(result).toMatchObject({ status: "refused", hostFault: false });
    expect(result).not.toHaveProperty("timedOut");
    expect((result as { reason: string }).reason).not.toContain("python3");
  }, 15_000);

  it("gives the reader private regular-file stdin, seen from the child, so no socket or writer can withhold EOF", () => {
    const f = plainFixture();
    writeFileSync(path.join(f.candidate, "b.txt"), "bytes\n");
    const views: Array<{ regular: boolean; socket: boolean; fifo: boolean; links: number; mode: number; eofAfterRead: boolean }> = [];
    // The child reports on its own descriptor 0 without moving its offset, then
    // the real reader runs on the same options.
    const probe = "import json, os, stat\n" +
      "s = os.fstat(0); regular = stat.S_ISREG(s.st_mode)\n" +
      "print(json.dumps(dict(regular=regular, socket=stat.S_ISSOCK(s.st_mode), fifo=stat.S_ISFIFO(s.st_mode), links=s.st_nlink, mode=s.st_mode & 0o777, eofAfterRead=regular and os.pread(0, 1, s.st_size) == b'')))";
    vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options: ExecFileSyncOptions = {}) => {
      if (command !== READER) return realExec(command, args, options);
      expect(options.input).toBeUndefined();
      views.push(JSON.parse(realExec(READER, ["-I", "-c", probe], options).toString()));
      return realExec(command, args, options);
    }) as typeof execFileSync);
    expect(snapshotCandidate(f.candidate)).toMatch(/^[a-f0-9]{40}$/);
    expect(views).toEqual([{ regular: true, socket: false, fifo: false, links: 0, mode: 0o600, eofAfterRead: true }]);
    // The control: the pipe transport this replaced is a socket with a writer on the other end.
    const piped = JSON.parse(realExec(READER, ["-I", "-c", probe], { input: "[]", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).toString());
    expect(piped).toMatchObject({ regular: false, socket: true });
  }, 15_000);

  it("bounds tmux queries, and a timed-out query is not an answer about the Session", () => {
    const seen: ExecFileSyncOptions[] = [];
    const hung = Object.assign(new Error("spawnSync tmux ETIMEDOUT"), { code: "ETIMEDOUT" });
    vi.mocked(execFileSync).mockImplementation(((_command: string, _args: string[], options: ExecFileSyncOptions = {}) => {
      seen.push(options);
      throw hung;
    }) as typeof execFileSync);
    expect(() => systemTmux.hasSession("s")).toThrow(hung);
    expect(() => systemTmux.available()).toThrow(hung);
    expect(systemTmux.capturePane("s")).toBeNull();
    expect(() => systemTmux.killSession("s")).not.toThrow();
    expect(seen.map(options => [options.killSignal, typeof options.timeout])).toEqual(Array(4).fill(["SIGKILL", "number"]));
  });
});

describe("patch-equivalence proof on the worker's thread (#2084)", () => {
  /** A branch whose only commit base carries as a cherry-pick: equivalent, never an ancestor. */
  function equivalentBranch(root: string): string {
    const repo = path.join(root, "equivalent");
    mkdirSync(repo);
    const git = (...args: string[]) => realExec("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdio: "ignore" });
    git("init", "-q", "-b", "base");
    writeFileSync(path.join(repo, "a.txt"), "a\n");
    git("add", ".");
    git("commit", "-qm", "start");
    git("switch", "-qc", "side");
    writeFileSync(path.join(repo, "picked.txt"), "picked\n");
    git("add", ".");
    git("commit", "-qm", "picked");
    git("switch", "-q", "base");
    writeFileSync(path.join(repo, "other.txt"), "other\n");
    git("add", ".");
    git("commit", "-qm", "other");
    git("cherry-pick", "side");
    return repo;
  }

  /** Stall one Git subcommand under the bound it was given; every other call keeps a long bound. */
  function stallGit(subcommand: string, stall: (options: SpawnSyncOptions) => ReturnType<typeof spawnSync>) {
    vi.stubEnv("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS", "700");
    // Recorded, not asserted here: the function under test catches what this throws.
    const stalled: Array<{ timeout?: number; killSignal?: unknown; status: number | null; input: unknown }> = [];
    vi.mocked(spawnSync).mockImplementation(((command: string, args: string[], options: SpawnSyncOptions = {}) => {
      if (command !== "git" || args[0] !== subcommand) return realSpawn(command, args, { ...options, timeout: 15_000 });
      if (options.timeout === undefined) throw new Error("A Git call ran with no bound; injecting the stall would hang the suite.");
      const result = stall(options);
      stalled.push({ timeout: options.timeout, killSignal: options.killSignal, status: result.status, input: options.input });
      return result;
    }) as typeof spawnSync);
    return stalled;
  }
  const killedAtBound = [{ timeout: 700, killSignal: "SIGKILL", status: null, input: undefined }];

  it("proves real equivalence through private regular-file stdin", () => {
    const repo = equivalentBranch(plainFixture().root);
    const stdins: Array<{ regular: boolean; links: number }> = [];
    vi.mocked(spawnSync).mockImplementation(((command: string, args: string[], options: SpawnSyncOptions = {}) => {
      if (command === "git" && args[0] === "apply") {
        expect(options.input).toBeUndefined();
        const stat = fstatSync((options.stdio as unknown[])[0] as number);
        stdins.push({ regular: stat.isFile(), links: stat.nlink });
      }
      return realSpawn(command, args, options);
    }) as typeof spawnSync);
    expect(isPatchEquivalent(repo, "base", "side")).toBe(true);
    expect(stdins).toEqual([{ regular: true, links: 0 }]);
  }, 15_000);

  it("reads withheld EOF on the proof as not proven, without hanging or throwing", () => {
    const f = plainFixture();
    const repo = equivalentBranch(f.root);
    const stalled = stallGit("apply", options => {
      const fifo = path.join(f.root, "withheld-apply-eof");
      realExec("mkfifo", [fifo]);
      const fd = openSync(fifo, constants.O_RDWR);
      try {
        return realSpawn("git", ["apply", "--cached", "--reverse", "--check", "--whitespace=nowarn", "-"], { ...options, input: undefined, stdio: [fd, "ignore", "ignore"] });
      } finally {
        closeSync(fd);
        rmSync(fifo);
      }
    });
    expect(isPatchEquivalent(repo, "base", "side")).toBe(false);
    expect(stalled).toEqual(killedAtBound);
  }, 15_000);

  it.each(["cherry", "merge-base", "diff", "read-tree"])("reads a hung git %s as not proven, without throwing into the tick", subcommand => {
    const repo = equivalentBranch(plainFixture().root);
    const stalled = stallGit(subcommand, options => realSpawn("/bin/sh", ["-c", "exec sleep 30"], options));
    expect(isPatchEquivalent(repo, "base", "side")).toBe(false);
    expect(stalled).toEqual(killedAtBound);
  }, 15_000);
});
