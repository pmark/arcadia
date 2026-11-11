import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { snapshotCandidate } from "../src/sessions/candidateSnapshot.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const identity = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const LIMIT = 4096;

/** A repository whose committed baseline alone is several times the test limit. */
function fixture() {
  const repo = mkdtempSync(path.join(tmpdir(), "capture-limit-"));
  roots.push(repo);
  const git = (args: string[]) => execFileSync("git", args, { cwd: repo, env: identity }).toString().trim();
  git(["init", "-q"]);
  mkdirSync(path.join(repo, "big"));
  for (let index = 0; index < 4; index++) writeFileSync(path.join(repo, "big", `base-${index}`), Buffer.alloc(3000, index + 1));
  writeFileSync(path.join(repo, "run.sh"), "#!/bin/sh\n" + "x".repeat(3000)); chmodSync(path.join(repo, "run.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "baseline"]);
  return { repo, git, base: git(["rev-parse", "HEAD"]) };
}
const blob = (f: ReturnType<typeof fixture>, tree: string, name: string) => execFileSync("git", ["cat-file", "blob", `${tree}:${name}`], { cwd: f.repo, maxBuffer: 1 << 20 });

describe("candidate capture limit", () => {
  it("applies the limit to changed files only and reuses base blobs for the rest (#2488)", () => {
    const f = fixture();
    const changed = Buffer.from("small diff\n");
    writeFileSync(path.join(f.repo, "big", "base-2"), changed);
    writeFileSync(path.join(f.repo, "added.txt"), "added\n");
    const tree = snapshotCandidate(f.repo, f.base, { captureLimitBytes: LIMIT });
    expect(blob(f, tree, "big/base-2").equals(changed)).toBe(true);
    expect(blob(f, tree, "added.txt").toString()).toBe("added\n");
    expect(blob(f, tree, "big/base-0").equals(Buffer.alloc(3000, 1))).toBe(true);
    expect(f.git(["ls-tree", tree, "run.sh"]).split(" ")[0]).toBe("100755");
    expect(f.git(["ls-tree", "-r", "-z", tree]).split("\0").filter(Boolean).length).toBe(6);
  });

  it("keeps the candidate's mode for a mode-only change", () => {
    const f = fixture();
    chmodSync(path.join(f.repo, "run.sh"), 0o644);
    const tree = snapshotCandidate(f.repo, f.base, { captureLimitBytes: LIMIT });
    expect(f.git(["ls-tree", tree, "run.sh"]).split(" ")[0]).toBe("100644");
  });

  it("still refuses a candidate whose changed files alone exceed the limit", () => {
    const f = fixture();
    writeFileSync(path.join(f.repo, "big", "base-0"), Buffer.alloc(3000, 9));
    writeFileSync(path.join(f.repo, "big", "base-1"), Buffer.alloc(3000, 8));
    expect(() => snapshotCandidate(f.repo, f.base, { captureLimitBytes: LIMIT })).toThrow(/Candidate capture refused/);
  });

  it("without a base revision counts every file, as before", () => {
    const f = fixture();
    expect(() => snapshotCandidate(f.repo, undefined, { captureLimitBytes: LIMIT })).toThrow(/Candidate capture refused/);
  });
});
