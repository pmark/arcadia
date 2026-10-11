import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("MISSION_LOG.md merge attribute (#1254)", () => {
  it("is declared merge=union in the checked-in .gitattributes", () => {
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    expect(attributes).toMatch(/^MISSION_LOG\.md\s+merge=union$/m);
  });

  it("lets two branches append to the log end without a conflict", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mission-log-union-"));
    const run = (...args: string[]) => git(dir, ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
    run("init", "-q", "-b", "main");
    writeFileSync(path.join(dir, ".gitattributes"), readFileSync(path.join(repoRoot, ".gitattributes")));
    writeFileSync(path.join(dir, "MISSION_LOG.md"), "# Log\n");
    run("add", ".");
    run("commit", "-qm", "base");
    run("checkout", "-qb", "pr");
    writeFileSync(path.join(dir, "MISSION_LOG.md"), "# Log\npr entry\n");
    run("commit", "-qam", "pr");
    run("checkout", "-q", "main");
    writeFileSync(path.join(dir, "MISSION_LOG.md"), "# Log\nmain entry\n");
    run("commit", "-qam", "main");
    run("checkout", "-q", "pr");
    const tree = run("merge-tree", "--write-tree", "pr", "main");
    const merged = run("show", `${tree}:MISSION_LOG.md`);
    expect(merged).toContain("pr entry");
    expect(merged).toContain("main entry");
  });
});
