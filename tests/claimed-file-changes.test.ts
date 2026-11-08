import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimedChangedFiles, claimedFileChangeRefusal } from "../src/sessions/claimedFileChanges.js";

// Issue #2261: a repair round's `complete` Ask claimed a change to a test file
// that the candidate's commit (only the Ask file) did not contain.
const notes = (...texts: string[]) => texts.map((note) => ({ note }));

describe("claimedChangedFiles", () => {
  it("finds the incident's claim: a git status line saying the test file was modified", () => {
    expect(claimedChangedFiles(notes(
      "No src/ file touched; git status shows only tests/pin-ci-text-neutralization.test.ts modified. The unchanged src behaviour matches the assertion (test passed), so no mismatch to report."
    ))).toEqual(["tests/pin-ci-text-neutralization.test.ts"]);
  });

  it("finds a verb before the path, a verb after it, and a list covered by one verb", () => {
    expect(claimedChangedFiles(notes(
      "Edited tests/a.test.ts to cover the case.",
      "Added a new test file tests/b.test.ts.",
      "I updated the file in src/sessions/c.ts and ran the suite.",
      "src/d.ts was replaced wholesale.",
      "Changed tests/e.test.ts, tests/f.test.ts and src/g.ts.",
      "Created `tests/h.test.ts`."
    ))).toEqual(["src/d.ts", "src/g.ts", "src/sessions/c.ts", "tests/a.test.ts", "tests/b.test.ts", "tests/e.test.ts", "tests/f.test.ts", "tests/h.test.ts"]);
  });

  it("does not treat a mention, an argument or an import as a claim", () => {
    expect(claimedChangedFiles(notes(
      "Repair round 1: replaced the invisible literal in the expected string with the escape. Ran pnpm exec vitest run tests/x.test.ts: 1 file, 1 test passed.",
      "Inspected tests/y.test.ts: it imports ../src/production/reviewRepair.js and uses no network.",
      "The tests in tests/z.test.ts pass; src/q.ts is unchanged behaviourally.",
      "Updated the Plan and ran tests/w.test.ts.",
      "Added a case, then ran the file tests/v.test.ts."
    ))).toEqual([]);
  });

  it("does not judge a sentence that negates, plans or dates the change", () => {
    expect(claimedChangedFiles(notes(
      "tests/a.test.ts was not modified.",
      "Did not edit src/b.ts.",
      "No change to tests/c.test.ts was needed; it was already updated.",
      "A follow-up should add tests/d.test.ts.",
      "tests/e.test.ts needs to be updated later.",
      "src/f.ts was changed by the original candidate.",
      "If tests/g.test.ts is edited, rerun.",
      "tests/h.test.ts wasn't modified"
    ))).toEqual([]);
  });

  it("counts only plain tests/ or src/ repository paths", () => {
    expect(claimedChangedFiles(notes(
      "Modified docs/guide.md and scripts/run.mjs and PROJECT.md.",
      "Modified ../src/a.ts and ./tests/b.test.ts and /abs/src/c.ts and foo/src/d.ts.",
      "Modified src/ and tests/ broadly."
    ))).toEqual([]);
  });

  it("ignores a missing note", () => {
    expect(claimedChangedFiles([{ note: null }])).toEqual([]);
  });
});

describe("claimedFileChangeRefusal", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  const write = (file: string, body: string) => { mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); writeFileSync(path.join(repo, file), body); };
  const commit = (message: string) => { git("add", "-A"); git("commit", "-qm", message); return git("rev-parse", "HEAD"); };

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "claimed-change-"));
    git("init", "-q", "-b", "main");
    write("tests/x.test.ts", "old\n");
    write("README.md", "r\n");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const incident = notes("git status shows only tests/x.test.ts modified.");

  it("(1) refuses the incident shape: a claimed change while only the Ask file is in the diff", () => {
    const base = commit("base");
    write(".arcadia/asks/agent-ask-complete.yaml", "{}\n");
    const head = commit("chore(candidate): preserve candidate for handoff");
    const reason = claimedFileChangeRefusal(repo, base, head, incident, "the base revision");
    expect(reason).toContain("Claimed-change check refused the completion");
    expect(reason).toContain("tests/x.test.ts");
    expect(reason).toContain("since the base revision");
  });

  it("(2) passes the same claim when the file is in the diff", () => {
    const base = commit("base");
    write("tests/x.test.ts", "new\n");
    write(".arcadia/asks/agent-ask-complete.yaml", "{}\n");
    const head = commit("candidate");
    expect(claimedFileChangeRefusal(repo, base, head, incident, "the base revision")).toBeNull();
  });

  it("(3) passes a note that only mentions the file, and a path only in prose about a future change", () => {
    const base = commit("base");
    write(".arcadia/asks/agent-ask-complete.yaml", "{}\n");
    const head = commit("candidate");
    expect(claimedFileChangeRefusal(repo, base, head, notes(
      "Ran pnpm exec vitest run tests/x.test.ts: 1 passed.",
      "A follow-up will update tests/x.test.ts to cover more cases.",
      "No change to tests/x.test.ts was needed."
    ), "the base revision")).toBeNull();
  });

  it("(4) gives a byte-identical reason for the same claim regardless of the note's wording, revisions or draft, so a repeat is an identical refusal", () => {
    const base = commit("base");
    write(".arcadia/asks/agent-ask-complete-a.yaml", "{}\n");
    const first = commit("candidate one");
    write(".arcadia/asks/agent-ask-complete-b.yaml", "{}\n");
    const second = commit("candidate two");
    const a = claimedFileChangeRefusal(repo, base, first, notes("git status shows only tests/x.test.ts modified."), "the base revision");
    const b = claimedFileChangeRefusal(repo, base, second, notes("Round 2: tests/x.test.ts edited as required."), "the base revision");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).not.toContain(first);
    expect(a).not.toContain(base);
  });

  it("measures a repair from its start revision: a change already in the base diff does not satisfy a repair's claim", () => {
    const base = commit("base");
    write("tests/x.test.ts", "failed candidate's change\n");
    const start = commit("failed candidate work");
    write(".arcadia/asks/agent-ask-complete.yaml", "{}\n");
    const head = commit("chore(candidate): preserve repair candidate");
    expect(claimedFileChangeRefusal(repo, base, head, incident, "the base revision")).toBeNull();
    expect(claimedFileChangeRefusal(repo, start, head, incident, "the repair's start revision")).toContain("since the repair's start revision");
  });

  it("refuses rather than passes when a claim exists and the diff cannot be read", () => {
    commit("base");
    expect(claimedFileChangeRefusal(repo, "0".repeat(40), "HEAD", incident, "the base revision")).toContain("could not be read");
  });

  it("does not read the diff when no note claims a change", () => {
    expect(claimedFileChangeRefusal(repo, "0".repeat(40), "HEAD", notes("Ran tests/x.test.ts."), "the base revision")).toBeNull();
  });
});
