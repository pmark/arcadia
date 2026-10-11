import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertNoStrayAskFiles, nonCanonicalAskPaths, strayAskFilesChangedSince } from "../src/sessions/strayAskFiles.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("nonCanonicalAskPaths (Issue #1177)", () => {
  it("accepts only agent-ask-<slug>.(yaml|yml|json), in the Asks directory or its archive", () => {
    expect(nonCanonicalAskPaths([
      ".arcadia/asks/agent-ask-complete-x-2026-10-10.yaml",
      ".arcadia/asks/agent-ask-a.yml",
      ".arcadia/asks/agent-ask-a.b_c-1.json",
      ".arcadia/asks/archive/agent-ask-complete-x.yaml",
      "docs/notes.md",
      "src/asks/foo.json"
    ])).toEqual([]);
  });

  it("flags another prefix, another extension, extra segments and a leading dot or dash", () => {
    const bad = [
      ".arcadia/asks/foo.json",
      ".arcadia/asks/complete-write-start-marker-run8-2026-10-06.json",
      ".arcadia/asks/agent-ask-ok.txt",
      ".arcadia/asks/agent-ask-ok.yaml.bak",
      ".arcadia/asks/agent-ask-.yaml",
      ".arcadia/asks/agent-ask-.hidden.yaml",
      ".arcadia/asks/.agent-ask-x.yaml",
      ".arcadia/asks/agent-ask-x/y.yaml",
      ".arcadia/asks/sub/agent-ask-x.yaml",
      ".arcadia/asks/archive/foo.yaml",
      ".arcadia/asks/archive/sub/agent-ask-x.yaml",
      ".arcadia/asks/archive/archive/agent-ask-x.yaml",
      ".arcadia/asks"
    ];
    expect(nonCanonicalAskPaths(bad)).toEqual(bad);
  });

  it("is case sensitive: an upper-case slug or directory is not canonical", () => {
    const bad = [".arcadia/asks/agent-ask-X.yaml", ".arcadia/asks/Agent-Ask-x.yaml", ".arcadia/ASKS/agent-ask-x.yaml", ".Arcadia/asks/agent-ask-x.yaml"];
    expect(nonCanonicalAskPaths(bad)).toEqual(bad);
  });

  it("flags dot-dot, absolute and backslash spellings of the Asks directory", () => {
    const bad = [
      ".arcadia/asks/../asks/foo.json",
      ".arcadia/asks/..",
      "../.arcadia/asks/agent-ask-x.yaml",
      "/repo/.arcadia/asks/agent-ask-x.yaml",
      ".arcadia\\asks\\agent-ask-x.yaml",
      ".arcadia/asks\\agent-ask-x.yaml",
      ".arcadia/asks/archive\\agent-ask-x.yaml"
    ];
    expect(nonCanonicalAskPaths(bad)).toEqual(bad);
  });

  it("keeps the order of the input and ignores paths elsewhere", () => {
    expect(nonCanonicalAskPaths(["b/.arcadia-asks/x.json", ".arcadia/asks/z.json", "docs/a.md", ".arcadia/asks/a.json"]))
      .toEqual([".arcadia/asks/z.json", ".arcadia/asks/a.json"]);
  });
});

describe("strayAskFilesChangedSince", () => {
  function repository(files: Record<string, string>, initialBranch = "main") {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-stray-asks-"));
    roots.push(root);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q", "-b", initialBranch);
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "T");
    const write = (rel: string, content = "x\n") => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content);
    };
    for (const [rel, content] of Object.entries(files)) write(rel, content);
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    return { root, git, write, base: git("rev-parse", "HEAD") };
  }
  const treeOfWorkingState = (r: ReturnType<typeof repository>) => { r.git("add", "-A"); return r.git("write-tree"); };

  it("reports added and modified strays, never untouched ones or deletions", () => {
    const r = repository({ ".arcadia/asks/old-stray.json": "1\n", ".arcadia/asks/other-stray.json": "1\n", ".arcadia/asks/agent-ask-keep.yaml": "1\n" });
    r.write(".arcadia/asks/new.json");
    r.write(".arcadia/asks/other-stray.json", "2\n");
    r.write(".arcadia/asks/agent-ask-new.yaml");
    r.write(".arcadia/asks/archive/agent-ask-new.yaml");
    rmSync(path.join(r.root, ".arcadia/asks/old-stray.json"));
    rmSync(path.join(r.root, ".arcadia/asks/agent-ask-keep.yaml"));

    expect(strayAskFilesChangedSince(r.root, r.base, treeOfWorkingState(r))).toEqual([".arcadia/asks/new.json", ".arcadia/asks/other-stray.json"]);
  });

  it("counts a rename into a non-canonical name, not out of one", () => {
    const r = repository({ ".arcadia/asks/old-stray.json": "same content\n", ".arcadia/asks/agent-ask-a.yaml": "other content\n" });
    r.git("mv", ".arcadia/asks/old-stray.json", ".arcadia/asks/agent-ask-old.yaml");
    r.git("mv", ".arcadia/asks/agent-ask-a.yaml", ".arcadia/asks/renamed.json");
    expect(strayAskFilesChangedSince(r.root, r.base, treeOfWorkingState(r))).toEqual([".arcadia/asks/renamed.json"]);
  });

  it("assertNoStrayAskFiles names every offender and passes a clean tree", () => {
    const r = repository({ "README.md": "x\n" });
    expect(() => assertNoStrayAskFiles(r.root, r.base, treeOfWorkingState(r))).not.toThrow();
    r.write(".arcadia/asks/a.json");
    r.write(".arcadia/asks/b.json");
    const tree = treeOfWorkingState(r);
    expect(() => assertNoStrayAskFiles(r.root, r.base, tree)).toThrow(/\.arcadia\/asks\/a\.json, \.arcadia\/asks\/b\.json/);
  });

  describe("a recorded base that is itself a candidate-branch commit", () => {
    const STRAY = ".arcadia/asks/complete-x.json";
    const commitAll = (r: ReturnType<typeof repository>, message: string) => {
      r.git("add", "-A");
      r.git("commit", "-q", "-m", message);
      return r.git("rev-parse", "HEAD");
    };

    it("refuses a stray committed on the candidate branch at the recorded base, though the tree is unchanged since", () => {
      const r = repository({ "README.md": "x\n" });
      r.git("checkout", "-q", "-b", "candidate");
      r.write(STRAY);
      const strayCommit = commitAll(r, "host-committed stray");

      // Against the recorded base alone the stray is invisible; against where it forks from main it is not.
      expect(strayAskFilesChangedSince(r.root, strayCommit, r.git("rev-parse", `${strayCommit}^{tree}`))).toEqual([STRAY]);
      expect(() => assertNoStrayAskFiles(r.root, strayCommit, r.git("rev-parse", `${strayCommit}^{tree}`))).toThrow(STRAY);
    });

    it("still refuses it when the candidate has since added other work above that base", () => {
      const r = repository({ "README.md": "x\n" });
      r.git("checkout", "-q", "-b", "candidate");
      r.write(STRAY);
      const strayCommit = commitAll(r, "host-committed stray");
      r.write("docs/work.md");

      expect(strayAskFilesChangedSince(r.root, strayCommit, treeOfWorkingState(r))).toEqual([STRAY]);
    });

    it("does not refuse a stray the project base branch itself carries, untouched by the candidate", () => {
      const r = repository({ "README.md": "x\n", [STRAY]: "{}\n" });
      r.git("checkout", "-q", "-b", "candidate");
      r.write("docs/work.md");
      const candidateCommit = commitAll(r, "candidate work");
      const tree = r.git("rev-parse", `${candidateCommit}^{tree}`);

      expect(strayAskFilesChangedSince(r.root, r.base, tree)).toEqual([]);
      expect(strayAskFilesChangedSince(r.root, candidateCommit, tree)).toEqual([]);
      expect(() => assertNoStrayAskFiles(r.root, candidateCommit, tree)).not.toThrow();
    });

    it("falls back to the recorded base alone, without throwing, when no base branch resolves", () => {
      const r = repository({ "README.md": "x\n" }, "trunk");
      r.git("checkout", "-q", "-b", "candidate");
      r.write(STRAY);
      const strayCommit = commitAll(r, "host-committed stray");
      const tree = r.git("rev-parse", `${strayCommit}^{tree}`);

      // No origin/HEAD, no local main or master: nothing to fork from, so only the recorded base is compared.
      expect(() => strayAskFilesChangedSince(r.root, strayCommit, tree)).not.toThrow();
      expect(strayAskFilesChangedSince(r.root, strayCommit, tree)).toEqual([]);
      // A stray introduced above the recorded base is still found by that single comparison.
      expect(strayAskFilesChangedSince(r.root, r.base, tree)).toEqual([STRAY]);
    });
  });
});
