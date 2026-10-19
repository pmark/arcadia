import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveAskGitIndex, askGit } from "../src/git/askIsolation.js";
import { runAgentAskDraftCommand, runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { projectCheckoutFor } from "../src/git/worktrees.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { isolatedGitEnvironment } from "../src/git/isolatedGitEnvironment.js";
import { recoverLegacyAgentAskDrift } from "../src/sessions/legacyAskRecovery.js";
const commandHooks = vi.hoisted(() => ({ afterUpdate: undefined as (() => void) | undefined, afterBuild: undefined as (() => void) | undefined, beforeUpdate: undefined as (() => void) | undefined, crossDevice: false }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const wrapped = (...args: Parameters<typeof actual.execFileSync>) => {
    if (args[0] === "git" && Array.isArray(args[1]) && args[1].includes("update-ref") && args[1].includes("--no-deref")) {
      const hook = commandHooks.beforeUpdate; commandHooks.beforeUpdate = undefined; hook?.();
    }
    const result = actual.execFileSync(...args);
    if (args[0] === "git" && Array.isArray(args[1]) && args[1].includes("update-ref") && args[1].includes("--no-deref")) {
      const hook = commandHooks.afterUpdate; commandHooks.afterUpdate = undefined; hook?.();
    }
    if (args[0] === "git" && Array.isArray(args[1]) && args[1].includes("write-tree")) {
      const hook = commandHooks.afterBuild; commandHooks.afterBuild = undefined; hook?.();
    }
    return result;
  };
  return { ...actual, execFileSync: wrapped as typeof actual.execFileSync };
});
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: (source: string, target: string) => {
    if (commandHooks.crossDevice && path.basename(target) === "index" && !path.resolve(source).startsWith(path.dirname(path.resolve(target)) + path.sep)) throw Object.assign(new Error("cross-device rename"), { code: "EXDEV" });
    return actual.renameSync(source, target);
  } };
});
const roots: string[] = [];
afterEach(() => { commandHooks.afterUpdate = undefined; commandHooks.afterBuild = undefined; commandHooks.beforeUpdate = undefined; commandHooks.crossDevice = false; vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
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
  it.each([
    { traceKeys: ["GIT_TRACE", "GIT_TRACE_PERFORMANCE", "GIT_TRACE_SETUP"] },
    { traceKeys: ["GIT_TRACE2", "GIT_TRACE2_EVENT", "GIT_TRACE2_PERF"] }
  ])("prevents inherited trace output %j from modifying peer files during draft, preview, and ownership queries", ({ traceKeys }) => {
    const f = fixture(); const workspace = path.join(f.root, "workspace"); initWorkspace(workspace);
    const peer = path.join(f.root, "peer-important.txt"); const bytes = "peer original bytes\n"; writeFileSync(peer, bytes);
    for (const key of traceKeys) vi.stubEnv(key, peer);
    vi.stubEnv("GIT_AUTHOR_NAME", "Resolved Agent"); expect(isolatedGitEnvironment().GIT_AUTHOR_NAME).toBe("Resolved Agent");
    for (const key of traceKeys) expect(isolatedGitEnvironment()[key]).toBe(key.startsWith("GIT_TRACE2") ? "0" : undefined);
    runAgentAskDraftCommand({ request: ask, dir: f.candidate, workspace: "missing" });
    const preview = runAgentAskPreviewCommand({ request: ask, dir: f.candidate, workspace });
    expect(preview.data.proposal.id).toBeTruthy();
    expect(realpathSync(projectCheckoutFor(f.main, f.candidate))).toBe(realpathSync(f.candidate));
    // Status's filter-key lookup is another Git invocation and must also suppress traces.
    expect(askGit(f.candidate, ["status", "--porcelain=v1", "--untracked-files=all"])).toContain(".arcadia/asks/");
    expect(readFileSync(peer, "utf8")).toBe(bytes);
  });
  it.each(["trace2.normalTarget", "trace2.eventTarget", "trace2.perfTarget"])("disables configured %s output during all Ask and ownership queries", key => {
    const f = fixture(); const workspace = path.join(f.root, "workspace"); initWorkspace(workspace);
    const peer = path.join(f.root, "peer-important.txt"); const bytes = "peer original bytes\n";
    const configHome = path.join(f.root, "xdg-config"); mkdirSync(path.join(configHome, "git"), { recursive: true });
    writeFileSync(path.join(configHome, "git", "config"), `[trace2]\n  ${key.split(".")[1]} = ${peer}\n`);
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    writeFileSync(peer, bytes);
    // Positive control proves this is a real global trace target on the host Git version.
    git(f.candidate, "rev-parse", "HEAD"); expect(readFileSync(peer, "utf8")).not.toBe(bytes);
    writeFileSync(peer, bytes);
    runAgentAskDraftCommand({ request: ask, dir: f.candidate, workspace: "missing" });
    expect(runAgentAskPreviewCommand({ request: ask, dir: f.candidate, workspace }).data.proposal.id).toBeTruthy();
    expect(realpathSync(projectCheckoutFor(f.main, f.candidate))).toBe(realpathSync(f.candidate));
    expect(askGit(f.candidate, ["status", "--porcelain=v1", "--untracked-files=all"])).toContain(".arcadia/asks/");
    expect(readFileSync(peer, "utf8")).toBe(bytes);
  });
  it("preserves real index, staged peer changes and HEAD on commit failure", () => {
    const f = fixture(); writeFileSync(path.join(f.candidate, "peer.md"), "peer staged\n"); git(f.candidate, "add", "peer.md");
    writeFileSync(path.join(f.candidate, "record.md"), "record\n"); git(f.candidate, "config", "user.name", ""); vi.stubEnv("GIT_AUTHOR_NAME", ""); const before = snapshot(f.candidate); const held = reserveAskGitIndex(f.candidate);
    try { expect(held.commit(["record.md"], "record")).toMatch(/ident/); } finally { held.release(); }
    expect(snapshot(f.candidate)).toEqual(before);
  });
  it("commits a governed record as the Arcadia Controller when no identity is resolved, never host git config (#1557)", () => {
    const f = fixture(); for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) vi.stubEnv(key, undefined as unknown as string);
    writeFileSync(path.join(f.candidate, "record.md"), "record\n");
    const held = reserveAskGitIndex(f.candidate); try { expect(held.commit(["record.md"], "record")).toBeNull(); } finally { held.release(); }
    expect(git(f.candidate, "log", "-1", "--format=%an <%ae>|%cn <%ce>")).toBe("Arcadia Controller <controller@arcadia.local>|Arcadia Controller <controller@arcadia.local>");
  });
  it("keeps a resolved agent identity on a governed record commit", () => {
    const f = fixture(); vi.stubEnv("GIT_AUTHOR_NAME", "Claudia Atlas"); vi.stubEnv("GIT_AUTHOR_EMAIL", "claudia.atlas@agents.arcadia.local");
    vi.stubEnv("GIT_COMMITTER_NAME", "Claudia Atlas"); vi.stubEnv("GIT_COMMITTER_EMAIL", "claudia.atlas@agents.arcadia.local");
    writeFileSync(path.join(f.candidate, "record.md"), "record\n");
    const held = reserveAskGitIndex(f.candidate); try { expect(held.commit(["record.md"], "record")).toBeNull(); } finally { held.release(); }
    expect(git(f.candidate, "log", "-1", "--format=%an|%cn")).toBe("Claudia Atlas|Claudia Atlas");
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
  it("holds HEAD identity against ordinary symbolic-ref movement throughout a write", () => {
    const f = fixture(); const held = reserveAskGitIndex(f.candidate); const before = snapshot(f.main);
    writeFileSync(path.join(f.candidate, "record.md"), "changed\n");
    commandHooks.afterBuild = () => { expect(() => git(f.candidate, "symbolic-ref", "HEAD", "refs/heads/main")).toThrow(); };
    try { expect(held.commit(["record.md"], "record")).toBeNull(); } finally { held.release(); }
    expect(snapshot(f.main)).toEqual(before);
  });
  it("refuses a candidate already pointing at the primary's branch before creating Git locks", () => {
    const f = fixture(); const before = snapshot(f.main); git(f.candidate, "symbolic-ref", "HEAD", "refs/heads/main");
    const index = git(f.candidate, "rev-parse", "--path-format=absolute", "--git-path", "index"); const head = git(f.candidate, "rev-parse", "--path-format=absolute", "--git-path", "HEAD");
    expect(() => reserveAskGitIndex(f.candidate)).toThrow(/checked out in another worktree/);
    expect(snapshot(f.main)).toEqual(before); expect(existsSync(index + ".lock")).toBe(false); expect(existsSync(head + ".lock")).toBe(false);
  });
  it("refuses detached writes and foreign HEAD locks before mutation", () => {
    const f = fixture(); git(f.candidate, "checkout", "--detach", "-q");
    expect(() => reserveAskGitIndex(f.candidate)).toThrow(/named candidate branch/);
    git(f.candidate, "checkout", "candidate", "-q"); const headPath = git(f.candidate, "rev-parse", "--path-format=absolute", "--git-path", "HEAD"); writeFileSync(headPath + ".lock", "peer HEAD lock");
    expect(() => reserveAskGitIndex(f.candidate)).toThrow(/HEAD is locked/); expect(readFileSync(headPath + ".lock", "utf8")).toBe("peer HEAD lock");
  });
  it("refuses a candidate branch converted into a symbolic ref to main", () => {
    const f = fixture(); const held = reserveAskGitIndex(f.candidate); const before = snapshot(f.main);
    expect(() => git(f.candidate, "symbolic-ref", "refs/heads/candidate", "refs/heads/main")).toThrow();
    const candidateRef = git(f.candidate, "rev-parse", "--path-format=absolute", "--git-path", "refs/heads/candidate");
    writeFileSync(candidateRef, "ref: refs/heads/main\n");
    writeFileSync(path.join(f.candidate, "record.md"), "changed\n");
    try { expect(held.commit(["record.md"], "record")).toMatch(/branch identity changed|checkout changed/); } finally { held.release(); }
    expect(snapshot(f.main)).toEqual(before);
  });

  it("never dereferences a pinned branch converted to a symref at the publication boundary", () => {
    const f = fixture(); writeFileSync(path.join(f.candidate, "record.md"), "changed\n"); const main = snapshot(f.main);
    const ref = git(f.candidate, "rev-parse", "--path-format=absolute", "--git-path", "refs/heads/candidate");
    const held = reserveAskGitIndex(f.candidate); commandHooks.beforeUpdate = () => writeFileSync(ref, "ref: refs/heads/main\n");
    try { expect(held.commit(["record.md"], "record")).toBeNull(); } finally { held.release(); }
    expect(snapshot(f.main)).toEqual(main); expect(git(f.candidate, "show", "HEAD:record.md")).toBe("changed");
  });
  it("preserves a foreign lock replacing ours after ref update and rolls back only our commit", () => {
    const f = fixture(); writeFileSync(path.join(f.candidate, "record.md"), "changed\n"); const before = snapshot(f.candidate);
    const lock = git(f.candidate, "rev-parse", "--path-format=absolute", "--git-path", "index") + ".lock";
    const held = reserveAskGitIndex(f.candidate);
    commandHooks.afterUpdate = () => { rmSync(lock); writeFileSync(lock, "foreign-peer-index"); };
    try { expect(held.commit(["record.md"], "record")).toMatch(/ownership changed after ref update/); } finally { held.release(); }
    expect(readFileSync(lock, "utf8")).toBe("foreign-peer-index"); expect(snapshot(f.candidate)).toEqual(before);
  });
  it("publishes from the index filesystem even when OS temporary storage is on another device", () => {
    const f = fixture(); writeFileSync(path.join(f.candidate, "record.md"), "changed\n"); commandHooks.crossDevice = true;
    const held = reserveAskGitIndex(f.candidate); try { expect(held.commit(["record.md"], "record")).toBeNull(); } finally { held.release(); }
    expect(git(f.candidate, "show", "HEAD:record.md")).toBe("changed");
  });
  it("recovers a tracked dirty Ask without modifying the source index or HEAD", () => {
    const f = fixture(); const file = path.join(f.main, "agent-ask.yaml"); writeFileSync(file, "original without newline"); git(f.main, "add", "agent-ask.yaml"); git(f.main, "commit", "-qm", "tracked Ask");
    writeFileSync(file, ask); const before = snapshot(f.main); const recovered = recoverLegacyAgentAskDrift(f.main, f.main);
    expect(recovered.recovered).toBe(true); expect(readFileSync(file, "utf8")).toBe("original without newline"); expect(snapshot(f.main)).toEqual(before);
    expect(git(f.main, "show", `${recovered.branch}:${recovered.askFile}`)).toBe(ask.trim());
  });
  it("restores tracked Ask executable mode through the bound original file descriptor", () => {
    const f = fixture(); const source = path.join(f.main, "agent-ask.yaml"); writeFileSync(source, ask);
    git(f.main, "add", "agent-ask.yaml"); git(f.main, "commit", "-qm", "tracked Ask"); const before = snapshot(f.main);
    chmodSync(source, 0o755); expect(recoverLegacyAgentAskDrift(f.main, f.main).recovered).toBe(true);
    expect(statSync(source).mode & 0o111).toBe(0); expect(git(f.main, "--no-optional-locks", "status", "--porcelain")).toBe(""); expect(snapshot(f.main)).toEqual(before);
  });
  it.each([true, false])("preserves a replacement cleanup symlink and its peer target (tracked=%s)", tracked => {
    const f = fixture(); const source = path.join(f.main, "agent-ask.yaml"); const peer = path.join(f.root, "peer-important.yaml");
    if (tracked) { writeFileSync(source, "original\n"); git(f.main, "add", "agent-ask.yaml"); git(f.main, "commit", "-qm", "tracked"); }
    writeFileSync(source, ask); writeFileSync(peer, ask);
    expect(() => recoverLegacyAgentAskDrift(f.main, f.main, { afterCommitBeforeCleanup: () => { rmSync(source); symlinkSync(peer, source); } })).toThrow();
    expect(readFileSync(peer, "utf8")).toBe(ask); expect(readFileSync(source, "utf8")).toBe(ask);
  });
  it("refuses a hardlinked source rather than overwriting a peer inode", () => {
    const f = fixture(); const peer = path.join(f.root, "important.yaml"); const source = path.join(f.main, "agent-ask.yaml");
    writeFileSync(peer, ask); linkSync(peer, source); const before = snapshot(f.main);
    expect(() => recoverLegacyAgentAskDrift(f.main, f.main)).toThrow(/regular file/); expect(readFileSync(peer, "utf8")).toBe(ask); expect(snapshot(f.main)).toEqual(before);
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
