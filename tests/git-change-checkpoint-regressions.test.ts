import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const procedure = readFileSync(path.resolve(import.meta.dirname, "../docs/agent-guidance/native-mail-checkpoints.md"), "utf8");
const script = procedure.split("## Git changes on main — every session")[1].match(/```sh\n([\s\S]*?)```/)![1];
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }).trim();
}
function put(cwd: string, name: string, value: string): void {
  mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
  writeFileSync(path.join(cwd, name), value);
}
function commit(cwd: string, subject: string): string { git(cwd, "add", "."); git(cwd, "commit", "-qm", subject); return git(cwd, "rev-parse", "HEAD"); }
function fixture(): { root: string; writer: string; observer: string; base: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-checkpoint-regression-")); roots.push(root);
  const writer = path.join(root, "writer"); const observer = path.join(root, "observer");
  git(root, "init", "--bare", "--initial-branch=main", "origin.git");
  git(root, "init", "--initial-branch=main", "writer");
  put(writer, "docs/decisions/0001.md", "answer: pending\n");
  const base = commit(writer, "baseline");
  git(writer, "remote", "add", "origin", path.join(root, "origin.git")); git(writer, "push", "-u", "origin", "main");
  git(root, "clone", path.join(root, "origin.git"), "observer");
  return { root, writer, observer, base };
}
function checkpoint(observer: string, cursor: string) {
  const result = spawnSync("sh", ["-c", script], { cwd: observer, env: { ...env, cursor }, encoding: "utf8", timeout: 10000 });
  console.info(JSON.stringify({ command: ["sh", "-c", script], cwd: observer, cursor, main: git(observer, "rev-parse", "origin/main"), status: result.status, stdout: result.stdout, stderr: result.stderr }));
  return result;
}

describe("shared checkpoint review regressions", () => {
  it("lists a governed edit introduced only by a merge commit", () => {
    const { writer, observer, base } = fixture();
    git(writer, "checkout", "-b", "side"); put(writer, "side.txt", "side\n"); commit(writer, "side work");
    git(writer, "checkout", "main"); put(writer, "main.txt", "main\n"); commit(writer, "main work");
    git(writer, "merge", "--no-ff", "--no-commit", "side");
    put(writer, "docs/decisions/0001.md", "answer: approved at merge\n");
    const merge = commit(writer, "merge-resolution decision (#fixture)"); git(writer, "push", "origin", "main");
    const result = checkpoint(observer, base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("docs/decisions/0001.md");
    expect(git(observer, "show", `${merge}:docs/decisions/0001.md`)).toBe("answer: approved at merge");
  });

  it("rejects an ancestor cursor from a merged side branch rather than skipping unread main", () => {
    const { writer, observer, base } = fixture();
    put(writer, "docs/decisions/0001.md", "answer: unread main change\n"); commit(writer, "unread decision");
    git(writer, "checkout", "-b", "side", base); put(writer, "side.txt", "side\n"); commit(writer, "side work");
    git(writer, "merge", "--no-ff", "main", "-m", "side includes unread main");
    const sideCursor = git(writer, "rev-parse", "HEAD");
    git(writer, "checkout", "main"); git(writer, "merge", "--no-ff", "side", "-m", "merge side"); git(writer, "push", "origin", "main");
    git(writer, "merge-base", "--is-ancestor", sideCursor, "main");
    const result = checkpoint(observer, sideCursor);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("CHECKPOINT_CURSOR_NOT_MAIN");
  });

  it("retains change-then-revert history even when the governed tip bytes match the cursor", () => {
    const { writer, observer, base } = fixture();
    put(writer, "docs/decisions/0001.md", "answer: transient approval\n"); const changed = commit(writer, "transient decision");
    put(writer, "docs/decisions/0001.md", "answer: pending\n"); const reverted = commit(writer, "reverted decision"); git(writer, "push", "origin", "main");
    expect(git(writer, "diff", base, reverted, "--", "docs/decisions/0001.md")).toBe("");
    const result = checkpoint(observer, base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(changed);
    expect(result.stdout).toContain(reverted);
    expect(result.stdout).toContain("docs/decisions/0001.md");
  });
});
