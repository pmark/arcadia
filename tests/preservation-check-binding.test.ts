import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindCheckDefinitions, PRESERVATION_CHECK_MODIFIED_CODE } from "../src/sessions/preservationCheckBinding.js";

// A minimal disposable repo with two commits: base (authorized) and candidate
// (what the worktree currently has). Tests pass each commit's own tree sha,
// exactly as bindCheckDefinitions receives base_revision and a snapshotted
// candidate tree in production.
const repos: string[] = [];
function repo(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "arcadia-check-binding-"));
  repos.push(dir);
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@arcadia.local"]);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
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
});
