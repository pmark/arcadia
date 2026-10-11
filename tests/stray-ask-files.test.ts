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
  function repository(files: Record<string, string>) {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-stray-asks-"));
    roots.push(root);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
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
});
