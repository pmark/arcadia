import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { preservationStage, withPreservationProgress } from "../src/sessions/preservationStages.js";
import { installTimeoutFixtureHooks, observeCandidate, plainFixture } from "./preservationTimeoutFixture.js";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

installTimeoutFixtureHooks();
let realExec: typeof execFileSync;
beforeEach(async () => {
  realExec = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).execFileSync;
  vi.mocked(execFileSync).mockImplementation(realExec);
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
      if (command !== "git" || !args.includes("--stdin") || !Buffer.isBuffer(options.input)) {
        return realExec(command, args, options);
      }
      const fifo = path.join(f.root, "withheld-eof");
      realExec("mkfifo", [fifo]);
      const fd = openSync(fifo, constants.O_RDWR);
      try {
        writeSync(fd, options.input);
        return realExec(command, args, { ...options, input: undefined, stdio: [fd, "pipe", "pipe"] });
      } finally {
        closeSync(fd);
        rmSync(fifo);
      }
    }) as typeof execFileSync);
    const capture = () => withPreservationProgress(() => undefined, () => {
      preservationStage("validation.binding");
      return snapshotCandidate(f.candidate);
    }, { gitTimeoutMs: 800 });
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
      if (command === "git" && args.includes("--stdin")) {
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
    }, { gitTimeoutMs: 800 });
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
