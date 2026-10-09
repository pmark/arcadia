import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindCheckDefinitions, PRESERVATION_CHECK_MODIFIED_CODE } from "../src/sessions/preservationCheckBinding.js";

// A minimal disposable repo with two commits: base (authorized) and candidate
// (what the worktree currently has). Tests pass each commit's own tree sha,
// exactly as bindCheckDefinitions receives base_revision and a snapshotted
// candidate tree in production.
const repos: string[] = [];
function repo(files: Record<string, string>, links: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arcadia-check-binding-"));
  repos.push(dir);
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@arcadia.local"]);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  for (const [file, target] of Object.entries(links)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    symlinkSync(target, path.join(dir, file));
  }
  git(["add", "."]); git(["commit", "-qm", "base"]);
  const baseCommit = git(["rev-parse", "HEAD"]);
  const base = git(["rev-parse", "HEAD^{tree}"]);
  return { dir, git, base, baseCommit };
}
// Every candidate scenario starts fresh from the base commit, never stacked
// on a previous candidateTree() call in the same test, so independent
// "what if only this one file changed" cases cannot leak into each other.
function candidateTree(f: ReturnType<typeof repo>, changes: Record<string, string>) {
  if (Object.keys(changes).length === 0) return f.base;
  f.git(["reset", "-q", "--hard", f.baseCommit]);
  for (const [file, content] of Object.entries(changes)) {
    mkdirSync(path.dirname(path.join(f.dir, file)), { recursive: true });
    writeFileSync(path.join(f.dir, file), content);
  }
  f.git(["add", "."]); f.git(["commit", "-qm", "candidate"]);
  return f.git(["rev-parse", "HEAD^{tree}"]);
}
afterEach(() => { for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("preservation check-definition binding — review follow-up (PR #552)", () => {
  it("resolves the check script through a launcher wrapper (env) and refuses a rewrite", () => {
    const f = repo({ "check.mjs": "console.log('ok');\n" });
    const unchanged = candidateTree(f, {});
    expect(() => bindCheckDefinitions(f.dir, f.base, unchanged, ["env node check.mjs"])).not.toThrow();
    const neutered = candidateTree(f, { "check.mjs": "process.exit(0);\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, neutered, ["env node check.mjs"]))
      .toThrow(expect.objectContaining({ message: expect.stringMatching(/cannot rewrite the check/), details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "check.mjs" }) }));
  });

  it("binds a directory require's index.json, not just index.js", () => {
    const f = repo({ "check.mjs": "require('./rules');\n", "rules/index.json": '{"ok":true}' });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["node check.mjs"]);
    expect(bound.files.some(file => file.path === "rules/index.json")).toBe(true);
    const rewritten = candidateTree(f, { "rules/index.json": '{"ok":false}' });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["node check.mjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "rules/index.json" }) }));
  });

  it("recognizes a relative require whose specifier is preceded by a comment", () => {
    const f = repo({ "check.cjs": "require(/* note */ \"./judge.cjs\");\n", "judge.cjs": "module.exports = true;\n" });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["node check.cjs"]);
    expect(bound.files.some(file => file.path === "judge.cjs")).toBe(true);
    const rewritten = candidateTree(f, { "judge.cjs": "module.exports = false;\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["node check.cjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "judge.cjs" }) }));
  });

  it("binds a directly invoked Python check's same-directory import closure", () => {
    const f = repo({ "check.py": "import helper\nhelper.run()\n", "helper.py": "def run():\n    pass\n" });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["python3 check.py"]);
    expect(bound.files.some(file => file.path === "helper.py")).toBe(true);
    const rewritten = candidateTree(f, { "helper.py": "def run():\n    raise SystemExit(0)\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["python3 check.py"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "helper.py" }) }));
  });

  it("binds every module in a comma-separated Python import list", () => {
    const f = repo({ "check.py": "import verifier, bypass\n", "verifier.py": "\n", "bypass.py": "\n" });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["python3 check.py"]);
    expect(bound.files.some(file => file.path === "verifier.py")).toBe(true);
    expect(bound.files.some(file => file.path === "bypass.py")).toBe(true);
    const rewritten = candidateTree(f, { "bypass.py": "raise SystemExit(0)\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["python3 check.py"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "bypass.py" }) }));
  });

  it("binds a directory require's package.json main entry, not just index files", () => {
    const f = repo({
      "check.mjs": "require('./rules');\n",
      "rules/package.json": '{"main":"lib/judge.js"}',
      "rules/lib/judge.js": "module.exports = true;\n"
    });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["node check.mjs"]);
    expect(bound.files.some(file => file.path === "rules/package.json")).toBe(true);
    expect(bound.files.some(file => file.path === "rules/lib/judge.js")).toBe(true);
    const rewrittenMain = candidateTree(f, { "rules/lib/judge.js": "module.exports = false;\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewrittenMain, ["node check.mjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "rules/lib/judge.js" }) }));
    const rewrittenManifest = candidateTree(f, { "rules/package.json": '{"main":"lib/other.js"}' });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewrittenManifest, ["node check.mjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "rules/package.json" }) }));
  });

  it("binds every entry of a comma-separated Python import list even with an alias before the comma", () => {
    const f = repo({ "check.py": "import verifier as v, bypass\n", "verifier.py": "\n", "bypass.py": "\n" });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["python3 check.py"]);
    expect(bound.files.some(file => file.path === "verifier.py")).toBe(true);
    expect(bound.files.some(file => file.path === "bypass.py")).toBe(true);
    const rewritten = candidateTree(f, { "bypass.py": "raise SystemExit(0)\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["python3 check.py"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "bypass.py" }) }));
  });

  it("refuses a Python import line it cannot fully parse instead of partially binding it", () => {
    const f = repo({ "check.py": "import verifier, \\\n    bypass\n", "verifier.py": "\n", "bypass.py": "\n" });
    const unchanged = candidateTree(f, {});
    expect(() => bindCheckDefinitions(f.dir, f.base, unchanged, ["python3 check.py"]))
      .toThrow(expect.objectContaining({ message: expect.stringMatching(/cannot establish the python import closure/i) }));
  });

  it("binds a same-directory Python package's __init__.py, not just a same-named module", () => {
    const f = repo({ "check.py": "from helper import run\n", "helper/__init__.py": "def run():\n    pass\n" });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["python3 check.py"]);
    expect(bound.files.some(file => file.path === "helper/__init__.py")).toBe(true);
    const rewritten = candidateTree(f, { "helper/__init__.py": "def run():\n    raise SystemExit(0)\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["python3 check.py"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "helper/__init__.py" }) }));
  });

  it.each([
    ["from helper.rule import verify\n"],
    ["import helper.rule\n"]
  ])("binds a dotted local Python submodule and its parent initializer (%j)", (line) => {
    const f = repo({ "check.py": line, "helper/__init__.py": "\n", "helper/rule.py": "def verify():\n    pass\n" });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["python3 check.py"]);
    expect(bound.files.some(file => file.path === "helper/rule.py")).toBe(true);
    expect(bound.files.some(file => file.path === "helper/__init__.py")).toBe(true);
    for (const target of ["helper/rule.py", "helper/__init__.py"]) {
      const rewritten = candidateTree(f, { [target]: "raise SystemExit(0)\n" });
      expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["python3 check.py"]))
        .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: target }) }));
    }
  });

  it("binds a require target that resolves to a native .node addon", () => {
    const f = repo({ "check.mjs": "require('./rules');\n", "rules.node": "binary" });
    const unchanged = candidateTree(f, {});
    const bound = bindCheckDefinitions(f.dir, f.base, unchanged, ["node check.mjs"]);
    expect(bound.files.some(file => file.path === "rules.node")).toBe(true);
    const rewritten = candidateTree(f, { "rules.node": "altered" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["node check.mjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "rules.node" }) }));
  });
});


describe("preservation check-definition binding — executable symlinks (#1041)", () => {
  it("allows an unchanged regular check and its regular dependency while binding both", () => {
    const f = repo({ "check.mjs": "import './judge.mjs';\n", "judge.mjs": "process.exit(7);\n", "skills/README.md": "baseline skill\n" }, { "skill-link": "skills/README.md" });
    const binding = bindCheckDefinitions(f.dir, f.base, f.base, ["node check.mjs"]);
    expect(binding.files.filter(file => file.blob !== null).map(file => file.path))
      .toEqual(["check.mjs", "judge.mjs"]);
  });

  it.each(["node check.mjs", "./check.mjs"])("refuses an unchanged declared symlink before executing its rewritten target (%s)", (command) => {
    const f = repo({ "judge.mjs": "process.exit(7);\n" }, { "check.mjs": "judge.mjs" });
    const candidate = candidateTree(f, { "judge.mjs": "process.exit(0);\n" });
    expect(f.git(["ls-tree", f.base, "check.mjs"]))
      .toBe(f.git(["ls-tree", candidate, "check.mjs"]));
    let executed = false;
    expect(() => {
      bindCheckDefinitions(f.dir, f.base, candidate, [command]);
      executed = true;
      execFileSync(process.execPath, ["check.mjs"], { cwd: f.dir });
    }).toThrow(expect.objectContaining({
      message: expect.stringMatching(/cannot execute symlink/),
      details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "check.mjs" })
    }));
    expect(executed).toBe(false);
  });

  it.each([
    { command: "node check.mjs", source: "import './helper.mjs';\n", link: "helper.mjs", target: "judge.mjs" },
    { command: "node check.cjs", source: "require('./helper');\n", link: "helper.js", target: "judge.mjs" },
    { command: "python3 check.py", source: "import helper\n", link: "helper.py", target: "judge.py" },
    { command: "node check.mjs", source: "import './linked/judge.mjs';\n", link: "linked", target: "rules" }
  ])("refuses a symlink in the discovered executable closure ($link)", ({ command, source, link, target }) => {
    const check = command.split(" ")[1];
    const judge = target === "rules" ? "rules/judge.mjs" : target;
    const f = repo({ [check]: source, [judge]: "original judge\n" }, { [link]: target });
    const candidate = candidateTree(f, { [judge]: "rewritten judge\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, [command]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: link }) }));
  });

  it("refuses a declared check reached through a linked directory", () => {
    const f = repo({ "rules/check.mjs": "process.exit(7);\n" }, { "linked": "rules" });
    const candidate = candidateTree(f, { "rules/check.mjs": "process.exit(0);\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["node linked/check.mjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "linked" }) }));
  });

  it("refuses a symlink reached through a directory manifest's main entry", () => {
    const f = repo({
      "check.cjs": "require('./rules');\n",
      "rules/package.json": '{"main":"helper.cjs"}',
      "judge.cjs": "process.exit(7);\n"
    }, { "rules/helper.cjs": "../judge.cjs" });
    const candidate = candidateTree(f, { "judge.cjs": "process.exit(0);\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["node check.cjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "rules/helper.cjs" }) }));
  });

  it("refuses a candidate symlink even when its link text has the authorized regular file's blob", () => {
    const f = repo({ "check.mjs": "judge.mjs", "judge.mjs": "process.exit(0);\n" });
    rmSync(path.join(f.dir, "check.mjs"));
    symlinkSync("judge.mjs", path.join(f.dir, "check.mjs"));
    f.git(["add", "."]);
    const candidate = f.git(["write-tree"]);
    const blob = (tree: string) => f.git(["ls-tree", tree, "check.mjs"]).split(/\s+/)[2];
    expect(blob(candidate)).toBe(blob(f.base));
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["node check.mjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "check.mjs" }) }));
  });
});

describe("preservation check-definition binding — declared path walked before `..` removal (#1041 round 2)", () => {
  // `linked` -> rules/subdir, so the shell opens `linked/../check.sh` as
  // rules/check.sh, while lexical normalization would bind the root check.sh.
  const linkedFixture = () => repo(
    { "check.sh": "exit 7\n", "rules/check.sh": "exit 7\n", "rules/subdir/README": "directory\n" },
    { "linked": "rules/subdir" }
  );

  it.each(["sh linked/../check.sh", "./linked/../check.sh", "env sh ./linked//../check.sh"])(
    "refuses an unchanged symlinked ancestor erased by `..` (%s)", (command) => {
      const f = linkedFixture();
      const candidate = candidateTree(f, { "rules/check.sh": "exit 0\n" });
      // The hazard is real: the shell executes the rewritten rules/check.sh.
      expect(spawnSync("sh", ["linked/../check.sh"], { cwd: f.dir }).status).toBe(0);
      expect(() => bindCheckDefinitions(f.dir, f.base, candidate, [command]))
        .toThrow(expect.objectContaining({
          message: expect.stringMatching(/cannot execute symlink `linked`/),
          details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "linked" })
        }));
    });

  it("refuses a symlinked ancestor present only in the candidate tree", () => {
    const f = repo({ "check.sh": "exit 7\n", "rules/check.sh": "exit 7\n", "rules/subdir/README": "directory\n", "linked/README": "real directory\n" });
    f.git(["rm", "-rq", "linked"]);
    writeFileSync(path.join(f.dir, "rules/check.sh"), "exit 0\n");
    symlinkSync("rules/subdir", path.join(f.dir, "linked"));
    f.git(["add", "."]);
    const candidate = f.git(["write-tree"]);
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["sh linked/../check.sh"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "linked" }) }));
  });

  it("refuses a symlinked ancestor present only in the base tree", () => {
    const f = linkedFixture();
    f.git(["rm", "-q", "linked"]);
    mkdirSync(path.join(f.dir, "linked"));
    writeFileSync(path.join(f.dir, "linked/README"), "real directory\n");
    f.git(["add", "."]);
    const candidate = f.git(["write-tree"]);
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["sh linked/../check.sh"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "linked" }) }));
  });

  it("keeps binding a regular `subdir/../check.sh` with no symlink components", () => {
    const f = repo({ "check.sh": "exit 7\n", "subdir/README": "directory\n" });
    const binding = bindCheckDefinitions(f.dir, f.base, f.base, ["sh subdir/../check.sh"]);
    expect(binding.files.filter(file => file.blob !== null).map(file => file.path)).toEqual(["check.sh"]);
    const rewritten = candidateTree(f, { "check.sh": "exit 0\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["sh subdir/../check.sh"]))
      .toThrow(expect.objectContaining({
        message: expect.stringMatching(/cannot rewrite the check/),
        details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "check.sh" })
      }));
  });
});

describe("preservation check-definition binding — case-insensitive path components (#1041 round 3)", () => {
  // Validation runs only on macOS, in a case-insensitive checkout, so `subdir`
  // and `SUBDIR` name the same directory there.
  const files = { "check.sh": "exit 7\n", "rules/check.sh": "exit 7\n", "rules/subdir/README": "directory\n" };

  it("refuses a case-variant symlinked ancestor present only in the candidate tree", () => {
    const f = repo({ ...files, "subdir/README": "real directory\n" });
    f.git(["rm", "-rq", "subdir"]);
    writeFileSync(path.join(f.dir, "rules/check.sh"), "exit 0\n");
    symlinkSync("rules/subdir", path.join(f.dir, "SUBDIR"));
    f.git(["add", "."]);
    const candidate = f.git(["write-tree"]);
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["sh subdir/../check.sh"]))
      .toThrow(expect.objectContaining({
        message: expect.stringMatching(/cannot execute symlink `SUBDIR`/),
        details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "SUBDIR" })
      }));
  });

  it("refuses a case-variant symlinked ancestor present only in the base tree", () => {
    const f = repo(files, { "SUBDIR": "rules/subdir" });
    f.git(["rm", "-q", "SUBDIR"]);
    mkdirSync(path.join(f.dir, "subdir"));
    writeFileSync(path.join(f.dir, "subdir/README"), "real directory\n");
    f.git(["add", "."]);
    const candidate = f.git(["write-tree"]);
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["sh subdir/../check.sh"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "SUBDIR" }) }));
  });

  it("keeps binding a regular mixed-case path written in its exact case", () => {
    const f = repo({ "Tools/Check.sh": "exit 7\n", "Tools/Sub/README": "directory\n" });
    const command = "sh Tools/Sub/../Check.sh";
    const binding = bindCheckDefinitions(f.dir, f.base, f.base, [command]);
    expect(binding.files.filter(file => file.blob !== null).map(file => file.path)).toEqual(["Tools/Check.sh"]);
    const rewritten = candidateTree(f, { "Tools/Check.sh": "exit 0\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, [command]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "Tools/Check.sh" }) }));
  });

  it("refuses a declared path whose tree entry differs only by case", () => {
    const f = repo({ "check.sh": "exit 7\n" });
    const candidate = candidateTree(f, { "check.sh": "exit 0\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["sh CHECK.sh"]))
      .toThrow(expect.objectContaining({
        message: expect.stringMatching(/only by letter case/),
        details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "check.sh" })
      }));
  });

  it("refuses a candidate case-variant sibling of a bound import", () => {
    const f = repo({ "check.mjs": "import './judge.mjs';\n", "judge.mjs": "process.exit(7);\n" });
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.dir, input: "process.exit(0);\n", encoding: "utf8" }).trim();
    f.git(["update-index", "--add", "--cacheinfo", `100644,${blob},JUDGE.mjs`]);
    const candidate = f.git(["write-tree"]);
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["node check.mjs"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: "JUDGE.mjs" }) }));
  });
});

describe("preservation check-definition binding — non-ASCII path components (#1041 round 4)", () => {
  // APFS folds `ſ`/`s`, `ß`/`ss`, `ﬁ`/`fi` and final sigma together, so
  // these names cannot coexist in a working copy. Build each tree through
  // the index instead: start from the base tree, drop and add entries.
  function indexTree(f: ReturnType<typeof repo>, remove: string[], add: Record<string, { content: string; link?: boolean }>) {
    f.git(["read-tree", f.base]);
    if (remove.length) f.git(["rm", "-rq", "--cached", ...remove]);
    for (const [file, { content, link }] of Object.entries(add)) {
      const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.dir, input: content, encoding: "utf8" }).trim();
      f.git(["update-index", "--add", "--cacheinfo", `${link ? "120000" : "100644"},${blob},${file}`]);
    }
    return f.git(["write-tree"]);
  }
  const refusesNonAscii = (entry: string) => expect.objectContaining({
    message: expect.stringMatching(/non-ASCII name/),
    details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: entry })
  });

  it("refuses a long-s `ſubdir` symlink standing in for an erased `subdir` (candidate only)", () => {
    const f = repo({ "check.sh": "exit 7\n", "rules/check.sh": "exit 7\n", "rules/subdir/README": "directory\n", "subdir/README": "real directory\n" });
    const candidate = indexTree(f, ["subdir"], {
      "\u017fubdir": { content: "rules/subdir", link: true },
      "rules/check.sh": { content: "exit 0\n" }
    });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["sh subdir/../check.sh"])).toThrow(refusesNonAscii("\u017fubdir"));
  });

  it("refuses a sharp-s `claß` sibling of a declared `class` directory, in either tree", () => {
    const f = repo({ "class/check.sh": "exit 7\n" });
    const candidateOnly = indexTree(f, [], { "cla\u00df/check.sh": { content: "exit 0\n" } });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidateOnly, ["sh class/check.sh"])).toThrow(refusesNonAscii("cla\u00df"));
    // Base-only: the authorized tree held `claß`, the candidate drops it.
    const baseWithSharpS = indexTree(f, [], { "cla\u00df/check.sh": { content: "exit 7\n" } });
    expect(() => bindCheckDefinitions(f.dir, baseWithSharpS, f.base, ["sh class/check.sh"])).toThrow(refusesNonAscii("cla\u00df"));
  });

  it("refuses a ligature `ﬁxtures` sibling of a directory in the import closure", () => {
    const f = repo({ "check.mjs": "import './fixtures/judge.mjs';\n", "fixtures/judge.mjs": "process.exit(7);\n" });
    const candidate = indexTree(f, [], { "\ufb01xtures/judge.mjs": { content: "process.exit(0);\n" } });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["node check.mjs"])).toThrow(refusesNonAscii("\ufb01xtures"));
  });

  it("refuses a declared path with a sigma component even when unchanged", () => {
    const f = repo({ "\u03c3/check.sh": "exit 7\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["sh \u03c3/check.sh"])).toThrow(refusesNonAscii("\u03c3"));
    const candidate = indexTree(f, [], { "\u03c2/check.sh": { content: "exit 0\n" } });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["sh \u03c3/check.sh"])).toThrow(refusesNonAscii("\u03c3"));
  });
});

describe("preservation check-definition binding \u2014 bare PATH commands and non-ASCII root entries (#1053)", () => {
  it("does not refuse a bare PATH command because the root holds a non-ASCII entry, in either tree", () => {
    const f = repo({ "caf\u00e9.md": "notes\n", "check.sh": "exit 0\n" });
    for (const command of ["echo hi", "pnpm test", "env FOO=1 echo hi", "true && echo hi"]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command).not.toThrow();
    }
    const candidateOnly = repo({ "check.sh": "exit 0\n" });
    const withAccent = candidateTree(candidateOnly, { "caf\u00e9.md": "notes\n" });
    expect(() => bindCheckDefinitions(candidateOnly.dir, candidateOnly.base, withAccent, ["echo hi"])).not.toThrow();
  });

  it("still refuses a script target beside a non-ASCII root entry", () => {
    const f = repo({ "caf\u00e9.md": "notes\n", "check.sh": "exit 0\n" });
    for (const command of ["sh check.sh", "./check.sh", "env sh check.sh"]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command)
        .toThrow(expect.objectContaining({ message: expect.stringMatching(/non-ASCII name/) }));
    }
  });

  it("still binds a root file that shares a bare command's name", () => {
    const f = repo({ "echo": "#!/bin/sh\n" });
    const rewritten = candidateTree(f, { "echo": "#!/bin/sh\nexit 0\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["echo hi"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "echo" }) }));
  });
});

describe("preservation check-definition binding \u2014 executable-path gaps (#1047)", () => {
  const modified = (file: string) => expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: file }) });

  it("refuses a case-mismatched declared script (CHECK.sh vs check.sh)", () => {
    const f = repo({ "check.sh": "exit 7\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["sh CHECK.sh"]))
      .toThrow(expect.objectContaining({ message: expect.stringMatching(/only by letter case/) }));
  });

  it("refuses a script run after `cd`, however the cd is spelled", () => {
    const f = repo({ "check.sh": "exit 7\n", "rules/check.sh": "exit 7\n", "linked/README": "x\n" });
    for (const command of [
      "cd rules && sh check.sh",
      "cd linked && sh ../check.sh",
      "(cd rules; sh check.sh)",
      "pushd rules; sh check.sh",
      "if true; then cd rules; fi; sh check.sh",
      "{ cd rules; sh check.sh; }"
    ]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command)
        .toThrow(expect.objectContaining({ message: expect.stringMatching(/changes directory/), details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE }) }));
    }
  });

  it("refuses a launcher-level directory change (env -C, env --chdir, sudo -D)", () => {
    const f = repo({ "check.sh": "exit 7\n", "rules/check.sh": "exit 7\n" });
    for (const command of ["env -C rules sh check.sh", "env --chdir=rules sh check.sh", "sudo -D rules sh check.sh"]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command)
        .toThrow(expect.objectContaining({ message: expect.stringMatching(/changes directory/) }));
    }
  });

  it("allows a `cd` that precedes only bare PATH commands", () => {
    const f = repo({ "check.sh": "exit 0\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["cd /tmp && echo hi"])).not.toThrow();
  });

  it("binds the script through chained launchers", () => {
    const f = repo({ "rules/check.sh": "exit 7\n" });
    const rewritten = candidateTree(f, { "rules/check.sh": "exit 0\n" });
    for (const command of ["nohup nice -n 5 sh rules/check.sh", "env nice time sh rules/check.sh", "env FOO=1 nice -n 5 sh rules/check.sh", "sudo -u root nohup sh rules/check.sh"]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command).not.toThrow();
      expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, [command]), command).toThrow(modified("rules/check.sh"));
    }
  });

  it("binds the script after a leading shell keyword and through `source`", () => {
    const f = repo({ "check.sh": "exit 7\n" });
    const rewritten = candidateTree(f, { "check.sh": "exit 0\n" });
    for (const command of ["if true; then sh check.sh; fi", "source check.sh", ". ./check.sh"]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, [command]), command).toThrow(modified("check.sh"));
    }
  });

  it("refuses a declared script path the shell expands at run time", () => {
    const f = repo({ "check.sh": "exit 7\n" });
    for (const command of ["sh $PWD/check.sh", "sh ${PWD}/check.sh", "sh ch*.sh", "sh ~/check.sh", "$PWD/check.sh", "sh check.{sh,x}"]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command)
        .toThrow(expect.objectContaining({ message: expect.stringMatching(/expanded by the shell/) }));
    }
  });

  it("does not refuse an absolute interpreter path, and keeps binding the script", () => {
    const f = repo({ "check.sh": "exit 7\n" });
    const rewritten = candidateTree(f, { "check.sh": "exit 0\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["/bin/sh check.sh"])).not.toThrow();
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, ["/bin/sh check.sh"])).toThrow(modified("check.sh"));
  });
});

describe("preservation check-definition binding \u2014 Python bytecode and extension shadowing (#1052)", () => {
  const shadowed = (entry: string) => expect.objectContaining({
    message: expect.stringMatching(/compiled Python/),
    details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, path: entry })
  });

  it("refuses a candidate `json.pyc` beside a check that imports the absent stdlib `json`", () => {
    const f = repo({ "check.py": "import json\nprint(json.dumps(1))\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 check.py"])).not.toThrow();
    const candidate = candidateTree(f, { "json.pyc": "REWRITTEN" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["python3 check.py"])).toThrow(shadowed("json.pyc"));
  });

  it("refuses native-extension and bytecode siblings of a bound module, in either tree", () => {
    const f = repo({ "check.py": "from helper import run\nrun()\n", "helper.py": "def run():\n    pass\n" });
    for (const entry of ["helper.so", "helper.cpython-312-darwin.so", "helper.abi3.so", "helper.pyd", "helper.pyc", "HELPER.so", "__pycache__/helper.cpython-312.pyc"]) {
      const candidate = candidateTree(f, { [entry]: "x" });
      expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["python3 check.py"]), entry).toThrow(shadowed(entry));
    }
    const baseWithShadow = repo({ "check.py": "import helper\n", "helper.py": "x = 1\n", "helper.so": "x" });
    expect(() => bindCheckDefinitions(baseWithShadow.dir, baseWithShadow.base, baseWithShadow.base, ["python3 check.py"])).toThrow(shadowed("helper.so"));
  });

  it("refuses shadowing of a package initializer and of each dotted prefix", () => {
    const f = repo({ "check.py": "import pkg.sub\n", "pkg/__init__.py": "", "pkg/sub.py": "x = 1\n" });
    for (const entry of ["pkg/__init__.pyc", "pkg/__init__.cpython-312-darwin.so", "pkg/__pycache__/__init__.cpython-312.pyc", "pkg/sub.so", "pkg/__pycache__/sub.cpython-312.pyc", "pkg.so"]) {
      const candidate = candidateTree(f, { [entry]: "x" });
      expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["python3 check.py"]), entry).toThrow(shadowed(entry));
    }
  });

  it("does not refuse compiled files that cannot shadow a bound module", () => {
    const f = repo({ "check.py": "import helper\n", "helper.py": "x = 1\n", "other.pyc": "x", "helper_extra.so": "x", "sub/helper.so": "x", "helper.pyi": "x" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 check.py"])).not.toThrow();
  });
});

describe("preservation check-definition binding — Python importable-set changes (#1100)", () => {
  const run = ["python3 check.py"];
  const refused = expect.objectContaining({
    message: expect.stringMatching(/importable Python entry/),
    details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, importable: true })
  });

  it("refuses indirect stdlib shadowing: a candidate selectors module beside a check importing subprocess", () => {
    const f = repo({ "check.py": "import subprocess\nsubprocess.run(['true'])\n", "README.md": "docs\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, run)).not.toThrow();
    for (const entry of ["selectors.py", "selectors.pyc", "selectors.so", "selectors.cpython-312-darwin.so", "__pycache__/selectors.cpython-312.pyc", "selectors/__init__.py"]) {
      const candidate = candidateTree(f, { [entry]: "print('PWNED')\n" });
      expect(() => bindCheckDefinitions(f.dir, f.base, candidate, run), entry).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, importable: true }) }));
    }
    const candidate = candidateTree(f, { "selectors.py": "print('PWNED')\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, run)).toThrow(refused);
  });

  it("refuses removal or change of an importable entry in the script directory", () => {
    const f = repo({ "check.py": "import json\n", "unused.py": "x = 1\n", "pkg/__init__.py": "", "pkg/inner.py": "x = 1\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidateTree(f, { "unused.py": "x = 2\n" }), run)).toThrow(refused);
    expect(() => bindCheckDefinitions(f.dir, f.base, candidateTree(f, { "pkg/inner.py": "x = 2\n" }), run)).toThrow(refused);
    expect(() => bindCheckDefinitions(f.dir, f.base, candidateTree(f, { "pkg/new.so": "x" }), run)).toThrow(refused);
    f.git(["reset", "-q", "--hard", f.baseCommit]); f.git(["rm", "-q", "unused.py"]); f.git(["commit", "-qm", "remove"]);
    const removed = f.git(["rev-parse", "HEAD^{tree}"]);
    expect(() => bindCheckDefinitions(f.dir, f.base, removed, run)).toThrow(expect.objectContaining({ message: expect.stringMatching(/removed `unused.py`/) }));
  });

  it("refuses an unbound package submodule rewrite under `from helper import rule`", () => {
    const f = repo({ "check.py": "from helper import rule\nrule.verify()\n", "helper/__init__.py": "", "helper/rule.py": "def verify():\n    pass\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, run)).not.toThrow();
    const rewritten = candidateTree(f, { "helper/rule.py": "def verify():\n    print('PWNED')\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, run)).toThrow(refused);
    const nested = repo({ "check.py": "from helper import rule\n", "helper/__init__.py": "", "helper/rule.py": "", "helper/deep/__init__.py": "", "helper/deep/x.py": "" });
    expect(() => bindCheckDefinitions(nested.dir, nested.base, candidateTree(nested, { "helper/deep/x.py": "y = 1\n" }), run)).toThrow(refused);
    expect(() => bindCheckDefinitions(nested.dir, nested.base, candidateTree(nested, { "helper/deep/__pycache__/x.cpython-312.pyc": "y" }), run)).toThrow(refused);
  });

  it("refuses changes for a script in a subdirectory, including a namespace package import", () => {
    const f = repo({ "tools/check.py": "from ns import rule\nimport os\n", "tools/ns/rule.py": "x = 1\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 tools/check.py"])).not.toThrow();
    for (const changes of [{ "tools/ns/rule.py": "x = 2\n" }, { "tools/selectors.py": "x = 2\n" }]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, candidateTree(f, changes), ["python3 tools/check.py"])).toThrow(refused);
    }
  });


  it("still binds an unchanged directory and ignores changes outside an isolated checks/ directory", () => {
    const f = repo({
      "checks/check.py": "import subprocess\nfrom helper import rule\nrule.verify()\n",
      "checks/helper/__init__.py": "", "checks/helper/rule.py": "def verify():\n    pass\n", "checks/README.md": "docs\n",
      "README.md": "docs\n"
    });
    const run = ["python3 checks/check.py"];
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, run)).not.toThrow();
    const unrelated = candidateTree(f, {
      "README.md": "changed docs\n", "checks/README.md": "check docs\n", "checks/helper/README.md": "pkg docs\n",
      "data/fixture.json": "{}\n", "other/module.py": "x = 1\n", "other/deep/more.so": "x", "notes.txt": "n\n"
    });
    expect(() => bindCheckDefinitions(f.dir, f.base, unrelated, run)).not.toThrow();
  });
});

describe("preservation check-definition binding — Python review follow-ups to #1101", () => {
  // Like candidateTree, but also writes symlinks.
  function candidateWithLinks(f: ReturnType<typeof repo>, files: Record<string, string>, links: Record<string, string>) {
    f.git(["reset", "-q", "--hard", f.baseCommit]);
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(f.dir, file)), { recursive: true });
      writeFileSync(path.join(f.dir, file), content);
    }
    for (const [file, target] of Object.entries(links)) {
      mkdirSync(path.dirname(path.join(f.dir, file)), { recursive: true });
      symlinkSync(target, path.join(f.dir, file));
    }
    f.git(["add", "."]); f.git(["commit", "-qm", "candidate"]);
    return f.git(["rev-parse", "HEAD^{tree}"]);
  }
  const refusedImportable = expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE, importable: true }) });
  const refusedCode = expect.objectContaining({ details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE }) });

  it("B1: refuses a candidate symlinked directory that stands in for a stdlib module", () => {
    const f = repo({ "check.py": "import subprocess\n" });
    const candidate = candidateWithLinks(f, { "lib/sel/__init__.py": "print('PWNED')\n" }, { selectors: "lib/sel" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidate, ["python3 check.py"])).toThrow(refusedImportable);
    const isolated = repo({ "checks/check.py": "import subprocess\n" });
    const linked = candidateWithLinks(isolated, { "checks/lib/sel/__init__.py": "print('PWNED')\n" }, { "checks/selectors": "lib/sel" });
    expect(() => bindCheckDefinitions(isolated.dir, isolated.base, linked, ["python3 checks/check.py"])).toThrow(refusedImportable);
    const nonPython = candidateWithLinks(isolated, {}, { "checks/subprocess_data": "data.txt" });
    expect(() => bindCheckDefinitions(isolated.dir, isolated.base, nonPython, ["python3 checks/check.py"])).toThrow(refusedImportable);
  });

  it("B1: refuses a symlink that leaves the scanned directory even when unchanged", () => {
    const f = repo({ "checks/check.py": "import json\n", "shared/mod.py": "x = 1\n" }, { "checks/shared": "../shared" });
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 checks/check.py"]))
      .toThrow(expect.objectContaining({ message: expect.stringMatching(/points outside the scanned directory/) }));
    const inside = repo({ "checks/check.py": "import json\n", "checks/real/mod.py": "x = 1\n" }, { "checks/alias": "real" });
    expect(() => bindCheckDefinitions(inside.dir, inside.base, inside.base, ["python3 checks/check.py"])).not.toThrow();
  });

  it("B2: refuses a candidate namespace package an optional stdlib import would pick up", () => {
    const f = repo({ "checks/check.py": "import subprocess\n" });
    const run = ["python3 checks/check.py"];
    for (const changes of [
      { "checks/msvcrt/keep.txt": "x" },
      { "checks/_winapi/CREATE_NEW_CONSOLE.py": "CREATE_NEW_CONSOLE = 1\n" },
      { "checks/deep/er/new.py": "x = 1\n" }
    ]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, candidateTree(f, changes), run), Object.keys(changes)[0]).toThrow(refusedImportable);
    }
    const root = repo({ "check.py": "import subprocess\n" });
    expect(() => bindCheckDefinitions(root.dir, root.base, candidateTree(root, { "msvcrt/keep.txt": "x" }), ["python3 check.py"])).toThrow(refusedImportable);
  });

  it("B3: treats an extensionless script run by python, or with a python shebang, as Python", () => {
    const f = repo({ "checks/check": "import subprocess\n", "checks/direct": "#!/usr/bin/env python3\nimport subprocess\n" });
    for (const command of ["python3 checks/check", "python3.12 checks/check", "python -W ignore checks/check", "checks/direct"]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command).not.toThrow();
      const target = command.endsWith("direct") ? "direct" : "check";
      const shadowed = candidateTree(f, { "checks/selectors.py": "print('PWNED')\n" });
      expect(() => bindCheckDefinitions(f.dir, f.base, shadowed, [command]), command).toThrow(refusedImportable);
      const rewritten = candidateTree(f, { [`checks/${target}`]: "print('neutered')\n" });
      expect(() => bindCheckDefinitions(f.dir, f.base, rewritten, [command]), command).toThrow(expect.objectContaining({ details: expect.objectContaining({ path: `checks/${target}` }) }));
    }
    const lazy = repo({ "checks/check": "import helper\n", "checks/helper.py": "x = 1\n" });
    expect(() => bindCheckDefinitions(lazy.dir, lazy.base, candidateTree(lazy, { "checks/helper.py": "x = 2\n" }), ["python3 checks/check"]))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ path: "checks/helper.py" }) }));
  });

  it("refuses a Python check command that sets PYTHON*= or uses -m or -c", () => {
    const f = repo({ "checks/check.py": "import json\n", "checks/direct": "#!/usr/bin/python3\nimport json\n" });
    for (const command of [
      "PYTHONPATH=/tmp python3 checks/check.py", "env PYTHONHOME=/tmp python3 checks/check.py", "export PYTHONPATH=/tmp && python3 checks/check.py",
      "PYTHONPATH=/tmp checks/direct", "python3 -m checks.check", "python3 -c 'import json'", "python3 -Ic 'import json'"
    ]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command).toThrow(refusedCode);
    }
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 -m checks.check"]))
      .toThrow(expect.objectContaining({ message: expect.stringMatching(/-m/) }));
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["PYTHONPATH=/tmp python3 checks/check.py"]))
      .toThrow(expect.objectContaining({ message: expect.stringMatching(/PYTHON\*=/) }));
    // A non-Python command with an unrelated PYTHON-prefixed word is not a Python check.
    const js = repo({ "check.mjs": "console.log('ok');\n" });
    expect(() => bindCheckDefinitions(js.dir, js.base, js.base, ["PYTHONPATH=/tmp node check.mjs"])).not.toThrow();
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 checks/check.py"])).not.toThrow();
  });

  it("refuses a bound Python source that edits the import path or loads modules dynamically", () => {
    for (const body of ["import sys\nsys.path.insert(0, '/tmp')\n", "import importlib\n", "__import__('os')\n", "import runpy\n", "from sys import path\n"]) {
      const f = repo({ "checks/check.py": body });
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 checks/check.py"]), body)
        .toThrow(expect.objectContaining({ message: expect.stringMatching(/sys\.path.*importlib.*__import__.*runpy/), details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE }) }));
    }
    const helper = repo({ "checks/check.py": "import helper\n", "checks/helper.py": "import importlib\n" });
    expect(() => bindCheckDefinitions(helper.dir, helper.base, helper.base, ["python3 checks/check.py"])).toThrow(refusedCode);
  });

  it("refuses a Python interpreter with no script argument (program read from stdin) (#1103)", () => {
    const f = repo({ "checks/check.py": "import json\n" });
    for (const command of [
      "python3 - < checks/check.py", "cat checks/check.py | python3", "python3 < checks/check.py", "python3 <checks/check.py",
      "python3 -u - < checks/check.py", "env python3.13t - < checks/check.py", "python3 -"
    ]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [command]), command)
        .toThrow(expect.objectContaining({ message: expect.stringMatching(/no script file argument/), details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE }) }));
    }
    // A script argument with stdin data redirected is still a plain script check.
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 checks/check.py < checks/check.py"])).not.toThrow();
    expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 --version"])).not.toThrow();
  });

  it("refuses site, exec/eval/compile and aliased sys path mutation in a bound Python source (#1103)", () => {
    for (const body of [
      "import site\nsite.addsitedir('/tmp')\n", "from site import addsitedir\n", "import os, site\n",
      "exec(open('x').read())\n", "eval('1+1')\n", "code = compile('1', 'f', 'exec')\n", "import builtins\n",
      "import sys as s\ns.path.insert(0, '/tmp')\n", "import sys\ngetattr(sys, 'pa' + 'th').append('/tmp')\n",
      "from sys import modules\n", "import sys\nsys.meta_path.append(x)\n"
    ]) {
      const f = repo({ "checks/check.py": body });
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, ["python3 checks/check.py"]), body)
        .toThrow(expect.objectContaining({ message: expect.stringMatching(/cannot establish the python import closure/i), details: expect.objectContaining({ code: PRESERVATION_CHECK_MODIFIED_CODE }) }));
    }
  });

  it("still binds a clean checks/ Python check that uses sys, os.path and re.compile (#1103)", () => {
    const f = repo({ "checks/check.py": "import os\nimport re\nimport sys\nPATTERN = re.compile('x')\nprint(os.path.join('a', 'b'))\nsys.exit(0)\n" });
    const bound = bindCheckDefinitions(f.dir, f.base, f.base, ["python3 checks/check.py"]);
    expect(bound.files.map(file => file.path)).toContain("checks/check.py");
  });

  it("recognises free-threaded and versioned Python binaries as interpreters (#1103)", () => {
    const f = repo({ "checks/check": "import json\n", "checks/check.py": "import json\n" });
    for (const binary of ["python3.13t", "python3.13d", "python3.13td", "pypy3.10", "python3.12", "pythonw"]) {
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [`${binary} -c 'import json'`]), binary).toThrow(refusedCode);
      expect(() => bindCheckDefinitions(f.dir, f.base, f.base, [`${binary} -`]), binary).toThrow(refusedCode);
      const bound = bindCheckDefinitions(f.dir, f.base, f.base, [`${binary} checks/check`]);
      expect(bound.files.map(file => file.path), binary).toContain("checks/check");
    }
  });

  it("advises an isolated checks/ directory in the refusal text", () => {
    const f = repo({ "check.py": "import json\n" });
    expect(() => bindCheckDefinitions(f.dir, f.base, candidateTree(f, { "selectors.py": "x = 1\n" }), ["python3 check.py"]))
      .toThrow(expect.objectContaining({ message: expect.stringMatching(/isolated directory \(for example `checks\/`\)/) }));
  });
});
