import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveAskGitIndex, askGit } from "../src/git/askIsolation.js";
import { runAgentAskDraftCommand } from "../src/commands/agentAsk.js";
import { recoverLegacyAgentAskDrift } from "../src/sessions/legacyAskRecovery.js";
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-ask-isolation-")); roots.push(root);
  const main = path.join(root, "main"); const candidate = path.join(root, "candidate");
  mkdirSync(main); git(main, "init", "-q", "-b", "main"); git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.invalid");
  writeFileSync(path.join(main, "record.md"), "before\n"); writeFileSync(path.join(main, "peer.md"), "before\n"); git(main, "add", "."); git(main, "commit", "-qm", "initial");
  git(main, "worktree", "add", "-qb", "candidate", candidate);
  return { root, main, candidate };
}
function git(root: string, ...args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function snapshot(root: string) {
  return { head: git(root, "rev-parse", "HEAD"), branch: git(root, "symbolic-ref", "HEAD"), index: readFileSync(git(root, "rev-parse", "--path-format=absolute", "--git-path", "index")), files: ["record.md", "peer.md"].map(file => readFileSync(path.join(root, file), "utf8")) };
}
const ask = 'agent_ask: v1\nrequest_id: isolated\nproject: unknown\nintent: log\ndesired_result: test\n';
describe("Agent Ask isolation", () => {
  it.each(["main", "master", "trunk"])("refuses shared primary checkout on %s from subdirectories", branch => {
    const f = fixture(); git(f.main, "branch", "-m", branch); mkdirSync(path.join(f.main, "sub")); const before = snapshot(f.main);
    expect(() => runAgentAskDraftCommand({ request: ask, dir: path.join(f.main, "sub"), workspace: "missing" })).toThrow(/shared primary/);
    expect(snapshot(f.main)).toEqual(before); expect(existsSync(path.join(f.main, ".arcadia"))).toBe(false);
  });
  it("refuses a linked checkout of the remote default branch", () => {
    const f = fixture(); git(f.main, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/candidate");
    expect(() => runAgentAskDraftCommand({ request: ask, dir: f.candidate, workspace: "missing" })).toThrow(/shared primary/);
  });
  it.each([".arcadia", ".arcadia/asks", ".arcadia/asks/agent-ask-isolated.yaml"])("refuses symlink escape at %s", target => {
    const f = fixture(); const outside = path.join(f.root, "outside"); mkdirSync(outside);
    mkdirSync(path.dirname(path.join(f.candidate, target)), { recursive: true }); symlinkSync(outside, path.join(f.candidate, target));
    expect(() => runAgentAskDraftCommand({ request: ask, dir: f.candidate, workspace: "missing" })).toThrow(/symlink/);
    expect(existsSync(path.join(outside, "agent-ask-isolated.yaml"))).toBe(false);
  });
  it("ignores inherited repository/index/config relocation for drafts and commits", () => {
    const f = fixture(); const before = snapshot(f.main);
    vi.stubEnv("GIT_DIR", path.join(f.main, ".git")); vi.stubEnv("GIT_WORK_TREE", f.main); vi.stubEnv("GIT_INDEX_FILE", path.join(f.main, ".git", "index"));
    vi.stubEnv("GIT_CONFIG_COUNT", "1"); vi.stubEnv("GIT_CONFIG_KEY_0", "core.worktree"); vi.stubEnv("GIT_CONFIG_VALUE_0", f.main);
    runAgentAskDraftCommand({ request: ask, dir: f.candidate, workspace: "missing" });
    writeFileSync(path.join(f.candidate, "record.md"), "after\n"); const held = reserveAskGitIndex(f.candidate);
    try { expect(held.commit(["record.md"], "record")).toBeNull(); } finally { held.release(); }
    vi.unstubAllEnvs(); expect(snapshot(f.main)).toEqual(before); expect(git(f.candidate, "show", "HEAD:record.md")).toBe("after");
  });
  it("preserves real index, staged peer changes and HEAD on commit failure", () => {
    const f = fixture(); writeFileSync(path.join(f.candidate, "peer.md"), "peer staged\n"); git(f.candidate, "add", "peer.md");
    writeFileSync(path.join(f.candidate, "record.md"), "record\n"); git(f.candidate, "config", "user.name", ""); const before = snapshot(f.candidate); const held = reserveAskGitIndex(f.candidate);
    try { expect(held.commit(["record.md"], "record")).toMatch(/ident/); } finally { held.release(); }
    expect(snapshot(f.candidate)).toEqual(before);
  });
  it("preserves foreign index locks exactly and refuses before work", () => {
    const f = fixture(); const lock = git(f.candidate, "rev-parse", "--path-format=absolute", "--git-path", "index") + ".lock"; writeFileSync(lock, "peer lock"); const before = snapshot(f.candidate);
    expect(() => reserveAskGitIndex(f.candidate)).toThrow(/index is locked/); expect(readFileSync(lock, "utf8")).toBe("peer lock"); expect(snapshot(f.candidate)).toEqual(before);
  });
  it("commits only governed paths, preserves staged peer entries, and invokes no hooks or filters", () => {
    const f = fixture(); const marker = path.join(f.root, "HOOK-RAN"); const hooks = path.join(f.root, "hooks"); mkdirSync(hooks);
    for (const name of ["pre-commit", "reference-transaction"]) writeFileSync(path.join(hooks, name), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 }); git(f.candidate, "config", "core.hooksPath", hooks);
    git(f.candidate, "config", "filter.evil.clean", `touch '${marker}'; cat`); writeFileSync(path.join(f.candidate, ".gitattributes"), "record.md filter=evil\n");
    writeFileSync(path.join(f.candidate, "peer.md"), "peer staged\n"); git(f.candidate, "add", "peer.md"); writeFileSync(path.join(f.candidate, "record.md"), "record\n");
    const main = snapshot(f.main); rmSync(marker, { force: true }); const held = reserveAskGitIndex(f.candidate); try { expect(held.commit(["record.md"], "record")).toBeNull(); } finally { held.release(); }
    expect(existsSync(marker)).toBe(false); expect(git(f.candidate, "show", "HEAD:peer.md")).toBe("before"); expect(git(f.candidate, "show", ":peer.md")).toBe("peer staged"); expect(snapshot(f.main)).toEqual(main);
  });
  it("read-only cleanliness checks do not execute clean filters", () => {
    const f = fixture(); const marker = path.join(f.root, "FILTER-RAN");
    git(f.candidate, "config", "filter.evil.clean", `touch '${marker}'; cat`);
    writeFileSync(path.join(f.candidate, ".gitattributes"), "record.md filter=evil\n");
    writeFileSync(path.join(f.candidate, "record.md"), "changed\n");
    expect(askGit(f.candidate, ["status", "--porcelain=v1"])).toContain("record.md");
    expect(existsSync(marker)).toBe(false);
  });
  it("refuses ref changes after reservation rather than committing another branch", () => {
    const f = fixture(); const held = reserveAskGitIndex(f.candidate); git(f.candidate, "symbolic-ref", "HEAD", "refs/heads/main"); const before = snapshot(f.main);
    try { expect(held.commit(["record.md"], "record")).toMatch(/checkout changed/); } finally { held.release(); }
    expect(snapshot(f.main)).toEqual(before);
  });
  it("recovers a tracked dirty Ask without modifying the source index or HEAD", () => {
    const f = fixture(); const file = path.join(f.main, "agent-ask.yaml"); writeFileSync(file, "original without newline"); git(f.main, "add", "agent-ask.yaml"); git(f.main, "commit", "-qm", "tracked Ask");
    writeFileSync(file, ask); const before = snapshot(f.main); const recovered = recoverLegacyAgentAskDrift(f.main, f.main);
    expect(recovered.recovered).toBe(true); expect(readFileSync(file, "utf8")).toBe("original without newline"); expect(snapshot(f.main)).toEqual(before);
    expect(git(f.main, "show", `${recovered.branch}:${recovered.askFile}`)).toBe(ask.trim());
  });
  it("does not reserve the real index for a no-op recovery", () => {
    const f = fixture(); const lock = git(f.main, "rev-parse", "--path-format=absolute", "--git-path", "index") + ".lock"; writeFileSync(lock, "peer lock");
    expect(recoverLegacyAgentAskDrift(f.main, f.main).recovered).toBe(false); expect(readFileSync(lock, "utf8")).toBe("peer lock");
  });
  it("leaves staged Ask content and the source index untouched", () => {
    const f = fixture(); writeFileSync(path.join(f.main, "agent-ask.yaml"), ask); git(f.main, "add", "agent-ask.yaml"); const before = snapshot(f.main);
    expect(recoverLegacyAgentAskDrift(f.main, f.main).recovered).toBe(false); expect(snapshot(f.main)).toEqual(before); expect(readFileSync(path.join(f.main, "agent-ask.yaml"), "utf8")).toBe(ask);
  });
  it("preserves an existing contentless recovery branch and peer checkout", () => {
    const f = fixture(); writeFileSync(path.join(f.main, "agent-ask.yaml"), ask);
    const hash = createHash("sha256").update(ask).digest("hex").slice(0, 8); const branch = `ask/recover-isolated-${hash}`;
    git(f.main, "branch", branch); const before = snapshot(f.main);
    expect(() => recoverLegacyAgentAskDrift(f.main, f.main)).toThrow(/different or missing content/); expect(snapshot(f.main)).toEqual(before); expect(git(f.main, "rev-parse", branch)).toBe(before.head);
  });
});
