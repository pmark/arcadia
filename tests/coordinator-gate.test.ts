import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCapsule, writeLiveCapsule, type CapsuleSources } from "../src/coordinator/capsule.js";
import { deriveGate, type GateInput } from "../src/coordinator/gate.js";
import { coordinatorPaths } from "../src/coordinator/paths.js";
import { defaultCapsuleSources, readPrFromGh } from "../src/coordinator/sources.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
let n = 0;
const url = () => `https://github.com/o/r/pull/9#issuecomment-${++n}`;
const marker = (sha: string, verdict = "PASS", tail = "— Loosens a gate: no. Changes agent authority: no.") => ({ body: `Independent review, head ${sha}: ${verdict} ${tail}`, html_url: url() });
const worker = (sha: string) => ({ body: `Arcadia worker: the independent code-review verdict on \`${sha}\` is **FAIL**, so this candidate never integrates.\n\n**Do not merge: escalated to the operator.**`, html_url: url() });
const gate = (over: Partial<GateInput> = {}) => deriveGate({ head: HEAD, isDraft: false, comments: [marker(HEAD)], checks: "pass", mergeState: "CLEAN", freeze: null, ...over });

describe("deriveGate", () => {
  it("is ready on an exact-head full-sha PASS with passing checks, CLEAN and both authority words no, naming the marker URL", () => {
    const m = marker(HEAD);
    expect(gate({ comments: [m] })).toBe(`ready: ${m.html_url}`);
  });

  it("unknown when the PR is unreadable", () => {
    expect(gate({ head: null })).toMatch(/^unknown: /);
  });

  it("R1: a 12-character marker sha that names the head is waiting, not ready; a draft is waiting: draft", () => {
    expect(gate({ comments: [marker(HEAD.slice(0, 12))] })).toBe("waiting: marker sha not full");
    expect(gate({ isDraft: true })).toBe("waiting: draft");
  });

  it("a marker on an older head is waiting and names that head", () => {
    expect(gate({ comments: [marker(OLD)] })).toBe(`waiting: no review marker for head ${HEAD.slice(0, 12)} (newest marker names ${OLD.slice(0, 12)})`);
    expect(gate({ comments: [] })).toBe(`waiting: no review marker for head ${HEAD.slice(0, 12)}`);
  });

  it("R2: PASS WITH FIXES, a bare verdict and an unknown word are waiting; FAIL blocks", () => {
    expect(gate({ comments: [marker(HEAD, "PASS WITH FIXES")] })).toMatch(/^waiting: verdict/);
    expect(gate({ comments: [{ body: `Independent review, head ${HEAD}:`, html_url: url() }] })).toMatch(/^waiting: verdict/);
    expect(gate({ comments: [marker(HEAD, "MAYBE")] })).toMatch(/^waiting: verdict/);
    expect(gate({ comments: [marker(HEAD, "FAIL")] })).toMatch(/^blocked: review FAIL/);
  });

  it("R2: a PASS with a Blocking line blocks, but none, 0, no, 'No blocking findings' and 'Non-blocking' do not", () => {
    const withBody = (line: string) => gate({ comments: [{ body: `${marker(HEAD).body}\n\n${line}`, html_url: url() }] });
    expect(withBody("**Blocking finding:** the lock leaks")).toMatch(/^blocked: /);
    expect(withBody("> - Blocking: the lock leaks")).toMatch(/^blocked: /);
    for (const ok of ["Blocking findings: none", "Blocking finding: 0", "Blocking: no", "No blocking findings", "Non-blocking: nit"]) {
      expect(withBody(ok)).toMatch(/^ready: /);
    }
  });

  it("R3: the newest marker for the exact head wins, in both directions", () => {
    expect(gate({ comments: [marker(HEAD, "FAIL"), marker(HEAD)] })).toMatch(/^ready: /);
    expect(gate({ comments: [marker(HEAD), marker(HEAD, "FAIL")] })).toMatch(/^blocked: /);
  });

  it("R4: a worker FAIL naming the head wins over any marker order; one naming another head is ignored", () => {
    expect(gate({ comments: [worker(HEAD), marker(HEAD)] })).toMatch(/^blocked: worker FAIL/);
    expect(gate({ comments: [marker(HEAD), worker(HEAD.slice(0, 9))] })).toMatch(/^blocked: worker FAIL/);
    expect(gate({ comments: [worker(OLD), marker(HEAD)] })).toMatch(/^ready: /);
    expect(gate({ comments: [{ body: `Quoting: Arcadia worker: \`${HEAD}\` **Do not merge`, html_url: url() }, marker(HEAD)] })).toMatch(/^ready: /);
  });

  it("R5: authority words are anchored; prose, a missing phrase or yes makes it the operator's merge", () => {
    expect(gate({ comments: [marker(HEAD, "PASS", "— Loosens a gate: no. Changes agent authority: yes.")] })).toMatch(/^operator: /);
    expect(gate({ comments: [marker(HEAD, "PASS", "— Loosens a gate: yes. Changes agent authority: no.")] })).toMatch(/^operator: /);
    expect(gate({ comments: [marker(HEAD, "PASS", "")] })).toMatch(/^operator: /);
    expect(gate({ comments: [marker(HEAD, "PASS", "The reviewer wrote that it Loosens a gate: no and Changes agent authority: no.")] })).toMatch(/^operator: /);
    const anchored = `Independent review, head ${HEAD}: PASS\n\n- Loosens a gate: no\n**Changes agent authority: no**`;
    expect(gate({ comments: [{ body: anchored, html_url: url() }] })).toMatch(/^ready: /);
  });

  it("R0: a marker quoted mid-text is ignored", () => {
    const quoted = { body: `As noted earlier, Independent review, head ${HEAD}: PASS — Loosens a gate: no. Changes agent authority: no.`, html_url: url() };
    expect(gate({ comments: [quoted] })).toMatch(/^waiting: no review marker/);
    const quotedBlock = { body: `> Independent review, head ${HEAD}: FAIL`, html_url: url() };
    expect(gate({ comments: [quotedBlock, marker(HEAD)] })).toMatch(/^ready: /);
  });

  it("CRLF bodies (the GitHub web UI) are read like LF ones", () => {
    const crlf = (text: string) => ({ body: text.replace(/\n/g, "\r\n"), html_url: url() });
    const pass = `Independent review, head ${HEAD}: PASS — Loosens a gate: no. Changes agent authority: no.`;
    expect(gate({ comments: [marker(HEAD), crlf(`Independent review, head ${HEAD}: FAIL\n\nBlocking finding: x`)] })).toMatch(/^blocked: review FAIL/);
    expect(gate({ comments: [crlf(pass)] })).toMatch(/^ready: /);
    expect(gate({ comments: [crlf(`${pass}\n\nBlocking finding: x`)] })).toMatch(/^blocked: review names a blocking finding/);
  });

  it("checks: fail blocks; pending, none and unknown wait; a merge state other than CLEAN waits", () => {
    expect(gate({ checks: "fail" })).toMatch(/^blocked: checks/);
    for (const checks of ["pending", "none", "unknown"] as const) expect(gate({ checks })).toMatch(/^waiting: checks/);
    expect(gate({ mergeState: "BEHIND" })).toBe("waiting: merge state BEHIND");
    expect(gate({ mergeState: null })).toMatch(/^waiting: merge state/);
  });

  it("precedence: a worker FAIL plus a newer PASS blocks; waiting beats frozen; frozen beats operator and ready", () => {
    expect(gate({ comments: [worker(HEAD), marker(HEAD)], checks: "pending", freeze: "merge freeze: x" })).toMatch(/^blocked: worker FAIL/);
    expect(gate({ comments: [marker(HEAD, "FAIL")], checks: "fail" })).toMatch(/^blocked: review FAIL/);
    expect(gate({ isDraft: true, freeze: "merge freeze: card c" })).toBe("waiting: draft");
    expect(gate({ checks: "pending", freeze: "merge freeze: card c" })).toMatch(/^waiting: checks/);
    expect(gate({ freeze: "merge freeze: card c" })).toBe("frozen: merge freeze: card c");
    expect(gate({ comments: [marker(HEAD, "PASS", "")], freeze: "merge freeze: card c" })).toBe("frozen: merge freeze: card c");
  });

  it("a run_window_unknown refusal gives frozen", () => {
    const message = "merge freeze: the run window could not be read (library missing), so a waiting START card may be hidden.";
    expect(gate({ freeze: message })).toBe(`frozen: ${message}`);
  });
});

// ---- sources: a fake `gh` on PATH, the real run window over a temp workspace, library and git repository ----

const roots: string[] = [];
const restore: Array<() => void> = [];
afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const hasJq = spawnSync("jq", ["--version"]).status === 0;

describe.skipIf(!hasJq)("defaultCapsuleSources().prs() gate", () => {
  it("keeps comment bodies out of the cache and live.json, and applies a freeze minted after the cache entry", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-gate-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    initWorkspace(workspace);
    const library = path.join(root, "library");
    mkdirSync(library);
    // A repository whose origin/main is a known revision, so a START card can be pinned to it.
    const repo = path.join(root, "repo");
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "base");
    const origin = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", origin);

    const secret = "SECRET-BODY-TEXT-the-reviewer-wrote-this";
    const comments = [
      { body: `Independent review, head ${HEAD}: PASS — Loosens a gate: no. Changes agent authority: no.\n${secret}`, html_url: "https://github.com/o/r/pull/9#issuecomment-1" },
      { body: "an unrelated chat comment that must not even be read", html_url: "https://github.com/o/r/pull/9#issuecomment-2" }
    ];
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(root, "comments.json"), JSON.stringify(comments));
    writeFileSync(path.join(root, "view.json"), JSON.stringify({ headRefOid: HEAD, isDraft: false, mergeStateStatus: "CLEAN", statusCheckRollup: [{ conclusion: "SUCCESS" }] }));
    // `gh pr view` prints the canned view; `gh api ... --jq <expr>` runs the expression it was given through jq, as gh does.
    const fake = `#!/usr/bin/env bash
if [ "$1" = pr ]; then echo "$*" > "${root}/view-args"; cat "${root}/view.json"; exit 0; fi
if [ "$1" = api ]; then
  while [ $# -gt 0 ]; do if [ "$1" = --jq ]; then expr="$2"; fi; shift; done
  jq -r "$expr" "${root}/comments.json"; exit 0
fi
exit 1
`;
    writeFileSync(path.join(bin, "gh"), fake);
    chmodSync(path.join(bin, "gh"), 0o755);
    for (const [key, value] of [["PATH", `${bin}:${process.env.PATH}`], ["ARCADIA_OPERATOR_SCRIPT_LIBRARY", library]] as const) {
      const before = process.env[key];
      process.env[key] = value;
      restore.push(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
    }

    const paths = coordinatorPaths(workspace, "arcadia", "rowan");
    const now = new Date("2026-11-22T20:00:00.000Z");
    const prs = () => withDatabase(workspace, (db) => defaultCapsuleSources({ db, repoRoot: repo, project: "arcadia", paths, now }).prs([9]));

    const first = prs();
    expect(first[0].gate).toBe("ready: https://github.com/o/r/pull/9#issuecomment-1");
    expect(readFileSync(path.join(root, "view-args"), "utf8")).toContain("isDraft");

    // A START card pinned to origin/main appears after the cache entry was written: the cached entry must now show it.
    writeFileSync(path.join(library, "card.json"), JSON.stringify({ schema: "arcadia-operator-script-v1", id: "card", expires_at: "2099-01-01T00:00:00.000Z", startRun: { schema: "arcadia-start-run-v1", reviewedRevision: origin } }));
    writeFileSync(path.join(bin, "gh"), "#!/usr/bin/env bash\nexit 1\n"); // a cache hit must not call gh at all
    const second = prs();
    expect(second[0].gate).toMatch(/^frozen: merge freeze: card card pinned to /);

    const cache = readFileSync(paths.prCache, "utf8");
    expect(cache).toContain("ready: https://github.com/o/r/pull/9#issuecomment-1");
    expect(cache).not.toContain("frozen:");
    expect(cache).not.toContain(secret);
    expect(cache).not.toContain("unrelated chat comment");

    const unchanged = { plan: () => ({ activePlan: null, currentAction: null, mainSha: null }), production: () => ({ status: "off", revision: null, epoch: null, openEscalations: [], redAlerts: [] }), sessions: () => [], decisions: () => ({ open: [], recentlyAnswered: [], pendingMerge: [] }), pings: () => ({ pending: [], recent: [] }), budget: () => null };
    const sources: CapsuleSources = { ...unchanged, prs: () => second };
    const capsule = buildCapsule({ project: "arcadia", role: "rowan", generation: null, custodian: null, assignment: { briefPath: null, briefSha: null, directives: [] }, state: { journal: [], nextMove: null, subscriptions: [], chatOnlyApprovals: [], prs: [9] }, sources, now });
    writeLiveCapsule(paths, capsule);
    expect(readFileSync(paths.live, "utf8")).not.toContain(secret);
  });

  /** A fake `gh` whose comments call runs the given expression through jq over `comments`, or fails when `comments` is null. */
  function readWithFakeGh(comments: unknown[] | null): string | null {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-gate-gh-"));
    roots.push(root);
    writeFileSync(path.join(root, "comments.json"), JSON.stringify(comments ?? []));
    writeFileSync(path.join(root, "view.json"), JSON.stringify({ headRefOid: HEAD, isDraft: false, mergeStateStatus: "CLEAN", statusCheckRollup: [{ conclusion: "SUCCESS" }] }));
    writeFileSync(path.join(root, "gh"), `#!/usr/bin/env bash
if [ "$1" = pr ]; then cat "${root}/view.json"; exit 0; fi
${comments === null ? "exit 1" : `while [ $# -gt 0 ]; do if [ "$1" = --jq ]; then expr="$2"; fi; shift; done; jq -r "$expr" "${root}/comments.json"`}
`);
    chmodSync(path.join(root, "gh"), 0o755);
    const before = process.env.PATH;
    process.env.PATH = `${root}:${before}`;
    restore.push(() => { process.env.PATH = before; });
    return readPrFromGh(root, 9).gate;
  }

  it("a lowercase or CRLF FAIL marker survives the jq prefilter and beats an older PASS", () => {
    const pass = { body: `Independent review, head ${HEAD}: PASS — Loosens a gate: no. Changes agent authority: no.`, html_url: "https://github.com/o/r/pull/9#issuecomment-1" };
    const fail = { body: `independent review, head ${HEAD}: FAIL\r\n\r\nBlocking finding: x`, html_url: "https://github.com/o/r/pull/9#issuecomment-2" };
    expect(readWithFakeGh([pass])).toMatch(/^ready: /);
    expect(readWithFakeGh([pass, fail])).toMatch(/^blocked: review FAIL/);
  });

  it("reads unknown, not waiting, when the comments cannot be read", () => {
    expect(readWithFakeGh(null)).toBe("unknown: the PR comments are unreadable");
  });
});
