import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { materializeCandidateTree, snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { preserveCandidate, type CandidatePreservationRequest } from "../src/sessions/candidatePreservation.js";
import { reserveAgentWorktree } from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * Regressions for the baseline-symlink trust path in `snapshotCandidate`
 * (Action: preserve-unchanged-baseline-skill-symlinks). Every fixture here
 * carries one tracked baseline symlink, `skill-link -> shared-skill`, and a
 * nested one, `nested/skill-link -> ../shared-skill`, committed identically
 * into the base revision and the candidate worktree cut from it -- the exact
 * shape of a tracked skill symlink that preservation must retain unchanged
 * without ever dereferencing it, and must refuse the moment it changes.
 */

const roots: string[] = [];
const NOW = new Date("2026-10-06T00:00:00.000Z");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function g(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com"
    }
  }).trim();
}

/** The real index file's exact bytes (never `ls-files --stage`'s derived,
 * re-parsed view of it), resolved through `git rev-parse --git-path index`
 * so a worktree's own private index is read. */
function indexBytes(candidate: string): string {
  return readFileSync(path.resolve(candidate, g(candidate, ["rev-parse", "--git-path", "index"]))).toString("hex");
}

interface Fixture {
  root: string;
  repo: string;
  candidate: string;
  workspace: string;
  branch: string;
  baseRevision: string;
}

function makeFixture(): Fixture {
  const branch = "claude/symlink-task";
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-preserve-symlink-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  g(repo, ["config", "user.name", "Test"]);
  g(repo, ["config", "user.email", "test@example.com"]);
  mkdirSync(path.join(repo, "shared-skill"), { recursive: true });
  writeFileSync(path.join(repo, "shared-skill", "README.md"), "shared skill\n");
  symlinkSync("shared-skill", path.join(repo, "skill-link"));
  mkdirSync(path.join(repo, "nested"), { recursive: true });
  symlinkSync("../shared-skill", path.join(repo, "nested", "skill-link"));
  writeFileSync(path.join(repo, "marker.txt"), "ready\n");
  g(repo, ["add", "-A"]);
  g(repo, ["commit", "-m", "base"]);
  const baseRevision = g(repo, ["rev-parse", "main"]);

  const candidate = path.join(root, "candidate");
  g(repo, ["worktree", "add", "-b", branch, candidate, "main"]);

  const workspace = path.join(root, "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) =>
    reserveAgentWorktree(db, { repositoryPath: repo, worktreePath: candidate, branch, now: NOW })
  );

  return { root, repo, candidate, workspace, branch, baseRevision };
}

function request(
  fixture: Fixture,
  validation: CandidatePreservationRequest["validation"],
  overrides: Partial<CandidatePreservationRequest> = {}
): CandidatePreservationRequest {
  return {
    requestId: "req-1",
    repositoryPath: fixture.repo,
    candidateWorktreePath: fixture.candidate,
    branch: fixture.branch,
    baseBranch: "main",
    baseRevision: fixture.baseRevision,
    actionId: "some-action",
    packetSha256: "packet-sha",
    policyEpoch: 1,
    policyRevision: 1,
    validation,
    remotePreservation: { authorized: false, reason: "test default" },
    now: NOW,
    ...overrides
  };
}

describe("snapshotCandidate: unchanged baseline symlink trust", () => {
  it("captures an unchanged baseline symlink from its immutable blob without dereferencing it, and replays identically", () => {
    const f = makeFixture();
    const tree1 = snapshotCandidate(f.candidate, f.baseRevision);
    expect(g(f.candidate, ["ls-tree", tree1, "skill-link"])).toMatch(/^120000 blob/);
    expect(snapshotCandidate(f.candidate, f.baseRevision)).toBe(tree1);

    const destination = mkdtempSync(path.join(f.root, "materialize-"));
    materializeCandidateTree(f.repo, tree1, destination);
    expect(lstatSync(path.join(destination, "skill-link")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(destination, "skill-link"))).toBe("shared-skill");
    expect(readFileSync(path.join(destination, "skill-link", "README.md"), "utf8")).toBe("shared skill\n");
  });

  it("keeps the baseline symlink's own tree entry byte-identical while an unrelated change still changes the tree (changed-tree receipt identity)", () => {
    const f = makeFixture();
    const tree1 = snapshotCandidate(f.candidate, f.baseRevision);
    const linkEntry = (tree: string) => g(f.candidate, ["ls-tree", tree, "skill-link"]);
    writeFileSync(path.join(f.candidate, "marker.txt"), "changed by the candidate\n");
    const tree2 = snapshotCandidate(f.candidate, f.baseRevision);
    expect(tree2).not.toBe(tree1);
    expect(linkEntry(tree2)).toBe(linkEntry(tree1));
  });

  it("refuses an unstaged on-disk symlink retarget even though the real index and HEAD still match the base, and leaves them untouched", () => {
    const f = makeFixture();
    rmSync(path.join(f.candidate, "skill-link"));
    symlinkSync("/tmp", path.join(f.candidate, "skill-link"));
    // Pre-attempt state is captured AFTER this test's own mutation, so the
    // assertion below proves only that the refused attempt itself touched
    // nothing further -- not that the mutation never happened.
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    const statusBefore = g(f.candidate, ["status", "--porcelain"]);
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
    expect(g(f.candidate, ["status", "--porcelain"])).toBe(statusBefore);
  });

  it("refuses a symlink retarget the candidate committed on its own HEAD; trust comes only from the given baseRevision, never a mutable HEAD", () => {
    const f = makeFixture();
    rmSync(path.join(f.candidate, "skill-link"));
    mkdirSync(path.join(f.candidate, "other-skill"), { recursive: true });
    writeFileSync(path.join(f.candidate, "other-skill", "README.md"), "other skill\n");
    symlinkSync("other-skill", path.join(f.candidate, "skill-link"));
    g(f.candidate, ["add", "-A"]);
    g(f.candidate, ["commit", "-m", "candidate retargets skill-link"]);
    // HEAD advanced and the real index agrees with the new on-disk target,
    // but baseRevision -- the candidate's canonical launch base -- still
    // names the old one; a compromised candidate's own commit must not
    // launder this as "unchanged". Pre-attempt state is captured after that
    // commit, so the assertion below proves the refused attempt itself
    // advanced nothing further.
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
  });

  it("treats a deleted baseline symlink as a deletion, not as unchanged", () => {
    const f = makeFixture();
    rmSync(path.join(f.candidate, "skill-link"));
    const tree = snapshotCandidate(f.candidate, f.baseRevision);
    expect(g(f.candidate, ["ls-tree", tree, "skill-link"])).toBe("");
    const destination = mkdtempSync(path.join(f.root, "materialize-"));
    materializeCandidateTree(f.repo, tree, destination);
    expect(existsSync(path.join(destination, "skill-link"))).toBe(false);
  });

  it("captures a baseline symlink replaced by a regular file as that file's real content", () => {
    const f = makeFixture();
    rmSync(path.join(f.candidate, "skill-link"));
    writeFileSync(path.join(f.candidate, "skill-link"), "now a plain file\n");
    const tree = snapshotCandidate(f.candidate, f.baseRevision);
    expect(g(f.candidate, ["ls-tree", tree, "skill-link"])).toMatch(/^100644 blob/);
    const destination = mkdtempSync(path.join(f.root, "materialize-"));
    materializeCandidateTree(f.repo, tree, destination);
    expect(lstatSync(path.join(destination, "skill-link")).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(destination, "skill-link"), "utf8")).toBe("now a plain file\n");
  });

  it("refuses an ancestor-directory escape for a baseline symlink's own path, exactly as for a regular file", () => {
    const f = makeFixture();
    rmSync(path.join(f.candidate, "nested"), { recursive: true, force: true });
    symlinkSync("/tmp", path.join(f.candidate, "nested"));
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
  });

  it("catches an on-disk retarget between two independent snapshotCandidate calls (the validate/recheck race)", () => {
    const f = makeFixture();
    expect(snapshotCandidate(f.candidate, f.baseRevision)).toBeTruthy();
    rmSync(path.join(f.candidate, "skill-link"));
    symlinkSync("/tmp", path.join(f.candidate, "skill-link"));
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
  });

  it("still refuses an ordinary (non-baseline) symlink masquerading as candidate content", () => {
    const f = makeFixture();
    symlinkSync(f.workspace, path.join(f.candidate, "escape"));
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
  });
});

describe("preserveCandidate: unchanged baseline symlink end to end", () => {
  it("preserves a candidate carrying an unchanged baseline symlink, producing a receipt whose fingerprint is the exact committed tree", () => {
    const f = makeFixture();
    writeFileSync(path.join(f.candidate, "marker.txt"), "ready and changed\n");
    const fingerprint = snapshotCandidate(f.candidate, f.baseRevision);
    const receipt = withDatabase(f.workspace, (db) =>
      preserveCandidate(db, request(f, { passed: true, evidenceRef: "tests green", candidateFingerprint: fingerprint }))
    );
    expect(receipt.candidateFingerprint).toBe(fingerprint);
    expect(g(f.candidate, ["rev-parse", "HEAD^{tree}"])).toBe(fingerprint);
    expect(g(f.candidate, ["ls-tree", "-r", "HEAD", "skill-link"])).toMatch(/^120000 blob/);
  });

  it("refuses preservation when the baseline symlink is retargeted on disk after the candidate was validated, and leaves the real HEAD and index untouched", () => {
    const f = makeFixture();
    const validatedFingerprint = snapshotCandidate(f.candidate, f.baseRevision);
    rmSync(path.join(f.candidate, "skill-link"));
    symlinkSync("/tmp", path.join(f.candidate, "skill-link"));
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    // The retargeted symlink is no longer a trusted baseline link, so capture
    // itself refuses it (an actual symlink reaching the privileged reader)
    // before preserveCandidate ever compares fingerprints.
    expect(() =>
      withDatabase(f.workspace, (db) =>
        preserveCandidate(db, request(f, { passed: true, evidenceRef: "tests green", candidateFingerprint: validatedFingerprint }))
      )
    ).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
  });
});

describe("snapshotCandidate: real index restricts baseline symlink trust", () => {
  it("refuses a baseline symlink whose real index was staged to a different target, even though the on-disk link still matches the stale staged content", () => {
    const f = makeFixture();
    rmSync(path.join(f.candidate, "skill-link"));
    mkdirSync(path.join(f.candidate, "other-skill"), { recursive: true });
    writeFileSync(path.join(f.candidate, "other-skill", "README.md"), "other skill\n");
    symlinkSync("other-skill", path.join(f.candidate, "skill-link"));
    g(f.candidate, ["add", "skill-link", "other-skill"]);
    // On disk and in the real index, skill-link now agrees with itself (both
    // retargeted) -- the on-disk check alone would wrongly call this
    // consistent. Only the real index's blob, which no longer matches
    // baseRevision's immutable blob for this path, catches it. Pre-attempt
    // state is captured after this staging, so the assertion below proves
    // the refused attempt itself staged nothing further.
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
  });

  it("refuses a staged-only retarget even with the on-disk link restored to the original baseline target, isolating the real-index restriction from the on-disk check", () => {
    const f = makeFixture();
    rmSync(path.join(f.candidate, "skill-link"));
    mkdirSync(path.join(f.candidate, "other-skill"), { recursive: true });
    writeFileSync(path.join(f.candidate, "other-skill", "README.md"), "other skill\n");
    symlinkSync("other-skill", path.join(f.candidate, "skill-link"));
    g(f.candidate, ["add", "skill-link", "other-skill"]);
    // Restore the on-disk link to the exact original baseline target before
    // capture: disk now agrees with baseRevision's blob, but the real index's
    // stage-0 entry still names other-skill's blob. Unlike the test above,
    // the on-disk check alone would here wrongly call this unchanged; only
    // the real-index restriction excludes it from trust before the on-disk
    // check ever runs.
    rmSync(path.join(f.candidate, "skill-link"));
    symlinkSync("shared-skill", path.join(f.candidate, "skill-link"));
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
  });

  it("refuses a baseline symlink removed from the real index, even though its on-disk content is still byte-identical to history", () => {
    const f = makeFixture();
    g(f.candidate, ["rm", "--cached", "skill-link"]);
    // skill-link is now untracked, but its on-disk bytes are exactly the
    // original base blob's: a check that only reads the baseline tree plus
    // the disk would wrongly trust it. The real index no longer carries it.
    // Pre-attempt state is captured after that removal.
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
  });

  it("refuses a baseline symlink with a real index merge conflict (multiple stages, none at stage 0), rather than trusting either side", () => {
    const f = makeFixture();
    const baseBlob = g(f.candidate, ["rev-parse", `${f.baseRevision}:skill-link`]);
    const otherBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.candidate, input: "other-skill", encoding: "utf8" }).trim();
    // Leaves the on-disk symlink exactly as committed (still -> shared-skill):
    // only the real index is put into the exact unresolved-conflict shape a
    // real `git merge` leaves on a symlink it cannot auto-resolve -- stages
    // 1 (ours), 2 (theirs) and 3 (base), no stage 0 at all.
    g(f.candidate, ["rm", "--cached", "-q", "skill-link"]);
    execFileSync("git", ["update-index", "--index-info"], {
      cwd: f.candidate,
      input: [`120000 ${baseBlob} 1\tskill-link`, `120000 ${otherBlob} 2\tskill-link`, `120000 ${baseBlob} 3\tskill-link`, ""].join("\n"),
      encoding: "utf8"
    });
    expect(g(f.candidate, ["ls-files", "--stage", "skill-link"]).split("\n")).toHaveLength(3);
    // Pre-attempt state is captured after that conflict is staged, so the
    // assertion below proves the refused attempt itself resolved nothing.
    const headBefore = g(f.candidate, ["rev-parse", "HEAD"]);
    const indexBefore = indexBytes(f.candidate);
    expect(() => snapshotCandidate(f.candidate, f.baseRevision)).toThrow(/regular candidate files/);
    expect(g(f.candidate, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(indexBytes(f.candidate)).toBe(indexBefore);
  });
});
