/**
 * Stacked pull-request bases (Issue #987; the operator's decision: stack the
 * PRs). Host preservation opens a serial candidate's draft PR on the remote
 * candidate branch whose tip is the candidate's base revision, so GitHub's
 * diff and the host Operator QA plan describe the same change; every other
 * candidate opens on the Project base exactly as before. Temp repositories
 * and fake PR writes only; the lifecycle-level proof is tests/fast-rehearsal/.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { withDatabase } from "../src/db/connection.js";
import {
  preserveCandidate,
  renderPreservedOperatorQaPlan,
  selectPullRequestBase,
  STACKED_BASE_UNAVAILABLE,
  systemPreservationRemote,
  type CandidatePreservationRemote,
  type CandidatePreservationRequest
} from "../src/sessions/candidatePreservation.js";
import { snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { reserveAgentWorktree } from "../src/sessions/index.js";
import type { OperatorQaPlanSource } from "../src/sessions/operatorQaPlan.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { stackedBaseRefusal } from "../src/production/sessionHandoff.js";
import type { AgentSession } from "../src/sessions/index.js";

const roots: string[] = [];
const NOW = new Date("2026-10-06T00:00:00.000Z");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function g(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

interface Serial {
  root: string;
  repo: string;
  origin: string;
  workspace: string;
  candidate: string;
  branch: string;
  /** The remote's main, never advanced. */
  m0: string;
  /** The previous candidate's settled head: the local main after its integration, and this candidate's base revision. */
  previousHead: string;
  previous: string;
}

/** M0 on the remote; the previous candidate `claude/prev-…` pushed and fast-forwarded into the local main only; this candidate branched from it. */
function serial(options: { pushPrevious?: boolean } = {}): Serial {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-stacked-base-")));
  roots.push(root);
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  g(root, ["init", "-q", "--bare", "-b", "main", origin]);
  g(root, ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "base\n");
  g(repo, ["add", "-A"]);
  g(repo, ["commit", "-q", "-m", "M0"]);
  const m0 = g(repo, ["rev-parse", "HEAD"]);
  g(repo, ["remote", "add", "origin", origin]);
  g(repo, ["push", "-q", "origin", "main"]);
  const previous = "claude/prev-20261006T010000000Z";
  g(repo, ["checkout", "-q", "-b", previous]);
  writeFileSync(path.join(repo, "PREVIOUS.md"), "previous Action\n");
  g(repo, ["add", "-A"]);
  g(repo, ["commit", "-q", "-m", "previous Action"]);
  const previousHead = g(repo, ["rev-parse", "HEAD"]);
  if (options.pushPrevious !== false) g(repo, ["push", "-q", "origin", previous]);
  g(repo, ["checkout", "-q", "main"]);
  g(repo, ["merge", "-q", "--ff-only", previous]);

  const branch = "claude/next-20261006T020000000Z";
  const candidate = path.join(root, "candidate");
  g(repo, ["worktree", "add", "-q", "-b", branch, candidate, "main"]);
  writeFileSync(path.join(candidate, "NEXT.md"), "this Action\n");
  const workspace = path.join(root, "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => reserveAgentWorktree(db, { repositoryPath: repo, worktreePath: candidate, branch, now: NOW }));
  return { root, repo, origin, workspace, candidate, branch, m0, previousHead, previous };
}

const SOURCE: OperatorQaPlanSource = {
  kind: "action-acceptance", actionKey: "demo/next", actionTitle: "Write NEXT.md",
  acceptanceCriteria: ["NEXT.md contains \"this Action\"."], validationCommands: ["node --test"]
};

function request(f: Serial, overrides: Partial<CandidatePreservationRequest> = {}): CandidatePreservationRequest {
  return {
    requestId: "req-stacked",
    repositoryPath: f.repo,
    candidateWorktreePath: f.candidate,
    branch: f.branch,
    baseBranch: "main",
    baseRevision: f.previousHead,
    actionId: "next",
    packetSha256: "packet-sha",
    policyEpoch: 1,
    policyRevision: 1,
    validation: { passed: true, evidenceRef: "tests green", candidateFingerprint: snapshotCandidate(f.candidate) },
    remotePreservation: { authorized: true, qaPlan: SOURCE },
    now: NOW,
    ...overrides
  };
}

/** Real pushes and `git ls-remote` against the bare origin; PR writes recorded. */
class Remote implements CandidatePreservationRemote {
  pushes: string[] = [];
  created: Array<{ branch: string; baseBranch: string; body: string }> = [];
  updated: Array<{ number: number; body: string }> = [];
  existing: { number: number; url: string; baseRefName?: string } | null = null;
  constructor(readonly withTips = true) {}
  hasRemote() { return true; }
  push(input: { repositoryPath: string; branch: string; commitSha?: string }) {
    this.pushes.push(input.branch);
    g(input.repositoryPath, ["push", "-q", "origin", `${input.commitSha ?? `refs/heads/${input.branch}`}:refs/heads/${input.branch}`]);
    return { remote: "origin" };
  }
  get listBranchTips() {
    return this.withTips ? (input: { repositoryPath: string }) => systemPreservationRemote.listBranchTips!(input) : undefined;
  }
  findPullRequest() { return this.existing; }
  upsertDraftPullRequest(input: { branch: string; baseBranch: string; body: string; existing: { number: number; url: string } | null }) {
    if (input.existing) { this.updated.push({ number: input.existing.number, body: input.body }); return input.existing; }
    this.created.push({ branch: input.branch, baseBranch: input.baseBranch, body: input.body });
    this.existing = { number: 9, url: "https://example.test/pull/9", baseRefName: input.baseBranch };
    return this.existing;
  }
}

const tip = (branch: string, sha: string) => ({ branch, sha });

describe("selectPullRequestBase", () => {
  it("keeps the Project base when the remote base tip is the candidate's base revision", () => {
    const f = serial();
    const selection = selectPullRequestBase(null, { repositoryPath: f.repo, baseBranch: "main", baseRevision: f.m0, branch: f.branch },
      { listBranchTips: () => [tip("main", f.m0), tip(f.previous, f.previousHead)] });
    expect(selection).toEqual({ ok: true, base: { kind: "project", branch: "main", tip: f.m0, reason: `The candidate's base revision ${f.m0.slice(0, 12)} is the tip of main on the remote.` } });
  });

  it("stacks on the agent candidate branch whose remote tip is the base revision, never on a non-agent, own or base branch", () => {
    const f = serial();
    const selection = selectPullRequestBase(null, { repositoryPath: f.repo, baseBranch: "main", baseRevision: f.previousHead, branch: f.branch }, {
      listBranchTips: () => [tip("main", f.m0), tip("feature/human", f.previousHead), tip(f.branch, f.previousHead), tip(f.previous, f.previousHead)]
    });
    expect(selection).toMatchObject({ ok: true, base: { kind: "stacked", branch: f.previous, tip: f.previousHead } });
    expect(selection.ok && selection.base.reason).toBe(
      `The candidate's base revision ${f.previousHead.slice(0, 12)} is not the tip of the remote main (the remote main is at ${f.m0.slice(0, 12)}; the worker never pushes the base), `
        + `and ${f.previous} is the remote candidate branch whose tip is ${f.previousHead.slice(0, 12)}, so the PR is stacked on it.`
    );
  });

  it("chooses deterministically among several candidate branches at the base revision: most recently preserved, then greatest name", () => {
    const f = serial();
    const tips = () => [tip("main", f.m0), tip("codex/a-20261006T000000000Z", f.previousHead), tip(f.previous, f.previousHead), tip("opencode/z-20261005T000000000Z", f.previousHead)];
    const input = { repositoryPath: f.repo, baseBranch: "main", baseRevision: f.previousHead, branch: f.branch };
    const byName = selectPullRequestBase(null, input, { listBranchTips: tips });
    expect(byName).toMatchObject({ ok: true, base: { branch: "opencode/z-20261005T000000000Z" } });
    expect(byName.ok && byName.base.reason).toContain(`(also at ${f.previousHead.slice(0, 12)}: codex/a-20261006T000000000Z, ${f.previous}; the most recently preserved wins)`);
    const byReceipt = withDatabase(f.workspace, (db) => {
      db.prepare(`INSERT INTO candidate_preservation_receipts (id, request_id, repository_path, candidate_worktree_path, branch, base_branch, base_revision, action_id,
        packet_sha256, policy_epoch, policy_revision, candidate_fingerprint, commit_sha, preservation_state, receipt_json, created_at)
        VALUES ('r1', 'q1', ?, '/x', 'codex/a-20261006T000000000Z', 'main', ?, 'a', 'p', 1, 1, 'f', ?, 'IN PR', '{}', '2026-10-06T00:00:00.000Z')`)
        .run(path.resolve(f.repo), f.m0, f.previousHead);
      return selectPullRequestBase(db, input, { listBranchTips: tips });
    });
    expect(byReceipt).toMatchObject({ ok: true, base: { branch: "codex/a-20261006T000000000Z" } });
  });

  it("keeps the Project base when the remote base already contains the base revision (it advanced on its own)", () => {
    const f = serial();
    const selection = selectPullRequestBase(null, { repositoryPath: f.repo, baseBranch: "main", baseRevision: f.m0, branch: f.branch },
      { listBranchTips: () => [tip("main", f.previousHead)] });
    expect(selection).toMatchObject({ ok: true, base: { kind: "project", branch: "main", tip: f.previousHead } });
  });

  it("keeps the Project base where it cannot know better: no tip listing, no remote base, an unfetched remote tip", () => {
    const f = serial();
    const input = { repositoryPath: f.repo, baseBranch: "main", baseRevision: f.previousHead, branch: f.branch };
    expect(selectPullRequestBase(null, input, {})).toMatchObject({ ok: true, base: { kind: "project", branch: "main", tip: null } });
    expect(selectPullRequestBase(null, input, { listBranchTips: () => [] })).toMatchObject({ ok: true, base: { kind: "project", tip: null } });
    const unknown = "f".repeat(40);
    const selection = selectPullRequestBase(null, input, { listBranchTips: () => [tip("main", unknown)] });
    expect(selection).toMatchObject({ ok: true, base: { kind: "project", tip: unknown } });
    expect(selection.ok && selection.base.reason).toContain("(not fetched here)");
  });

  it("refuses when no remote branch is at the base revision, naming the local branch to push again", () => {
    const f = serial({ pushPrevious: false });
    const selection = selectPullRequestBase(null, { repositoryPath: f.repo, baseBranch: "main", baseRevision: f.previousHead, branch: f.branch },
      systemPreservationRemote);
    expect(selection.ok).toBe(false);
    if (selection.ok) return;
    expect(selection.reason).toContain(`its base revision ${f.previousHead} is not on the remote main (the remote main is at ${f.m0.slice(0, 12)}`);
    expect(selection.reason).toContain("(Issue #987), so nothing is pushed and no PR is opened");
    expect(selection.remedy).toContain(`push the previous candidate's branch again (\`git -C ${f.repo} push origin ${f.previous}\`;`);
    expect(selection.remedy).toContain(`push a fresh branch at that revision instead: \`git -C ${f.repo} push origin ${f.previousHead}:refs/heads/agent/stack-base-${f.previousHead.slice(0, 12)}\``);
    expect(selection.remedy).toContain("the worker never pushes the base");
  });
});

describe("systemPreservationRemote.listBranchTips", () => {
  it("reads every remote branch tip with git ls-remote", () => {
    const f = serial();
    expect(systemPreservationRemote.listBranchTips!({ repositoryPath: f.repo }).sort((a, b) => a.branch.localeCompare(b.branch)))
      .toEqual([tip(f.previous, f.previousHead), tip("main", f.m0)]);
  });
});

describe("preserveCandidate with stacked bases", () => {
  it("opens a serial candidate's PR on the previous candidate's branch, renders the plan against it and records why", () => {
    const f = serial();
    const remote = new Remote();
    const receipt = withDatabase(f.workspace, (db) => preserveCandidate(db, request(f), { remote }));
    expect(receipt).toMatchObject({ preservationState: "IN PR", baseBranch: "main", baseRevision: f.previousHead });
    expect(receipt.prBase).toMatchObject({ kind: "stacked", branch: f.previous, tip: f.previousHead });
    expect(remote.created).toHaveLength(1);
    expect(remote.created[0].baseBranch).toBe(f.previous);
    expect(remote.pushes).toEqual([f.branch]);
    const body = remote.created[0].body;
    expect(body).toContain(`- **Base:** \`${f.previous}\` at \`${f.previousHead}\``);
    expect(body).toContain("exactly 1 changed file:\n  - `A` `NEXT.md`");
    // The plan is today's renderer fed the PR's base branch, and only that changed.
    const expected = renderPreservedOperatorQaPlan(SOURCE, { repositoryPath: f.repo, branch: f.branch, baseBranch: f.previous, baseRevision: f.previousHead, commitSha: receipt.commitSha });
    expect(body.startsWith(`${expected.body}\n\n`)).toBe(true);
    const onMain = renderPreservedOperatorQaPlan(SOURCE, { repositoryPath: f.repo, branch: f.branch, baseBranch: "main", baseRevision: f.previousHead, commitSha: receipt.commitSha });
    expect(expected.body.replace(`\`${f.previous}\` at`, "`main` at")).toBe(onMain.body);
    expect(g(f.origin, ["rev-parse", "refs/heads/main"])).toBe(f.m0);
  });

  it("renders a non-stacked candidate's body byte-identically to an adapter without branch tips", () => {
    const one = serial();
    const withTips = new Remote(true);
    const withoutTips = new Remote(false);
    g(one.repo, ["push", "-q", "origin", "main"]);
    const stamped = withDatabase(one.workspace, (db) => preserveCandidate(db, request(one), { remote: withTips }));
    expect(stamped.prBase).toMatchObject({ kind: "project", branch: "main", tip: one.previousHead });
    expect(withTips.created[0].baseBranch).toBe("main");
    const legacy = renderPreservedOperatorQaPlan(SOURCE, { repositoryPath: one.repo, branch: one.branch, baseBranch: "main", baseRevision: one.previousHead, commitSha: stamped.commitSha });
    expect(withTips.created[0].body.startsWith(`${legacy.body}\n\n`)).toBe(true);
    // The same candidate through an adapter that lists no tips (the pre-stacking path): byte-identical body, no prBase.
    const legacyReceipt = withDatabase(one.workspace, (db) => preserveCandidate(db, request(one, { requestId: "req-legacy" }), { remote: withoutTips }));
    expect(legacyReceipt.commitSha).toBe(stamped.commitSha);
    expect(legacyReceipt.prBase).toBeUndefined();
    expect(withoutTips.created.map((entry) => entry.baseBranch)).toEqual(["main"]);
    expect(withoutTips.created[0].body).toBe(withTips.created[0].body);
  });

  it("refuses when the previous candidate's branch is not on the remote: nothing pushed, no PR, the commit kept locally; a retry after the push stacks", () => {
    const f = serial({ pushPrevious: false });
    const remote = new Remote();
    let refusal: unknown;
    try {
      withDatabase(f.workspace, (db) => preserveCandidate(db, request(f), { remote }));
    } catch (error) { refusal = error; }
    expect(refusal).toBeInstanceOf(ArcadiaError);
    expect((refusal as ArcadiaError).message).toContain("No remote branch can be this candidate's pull-request base");
    expect((refusal as ArcadiaError).message).toContain(`Remedy: push the previous candidate's branch again (\`git -C ${f.repo} push origin ${f.previous}\`;`);
    expect((refusal as ArcadiaError).details).toMatchObject({ code: STACKED_BASE_UNAVAILABLE, baseRevision: f.previousHead });
    expect(remote.pushes).toEqual([]);
    expect(remote.created).toEqual([]);
    const preserved = g(f.repo, ["log", "--format=%H", `main..${f.branch}`]).split("\n").filter(Boolean);
    expect(preserved).toHaveLength(1);
    expect(withDatabase(f.workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM candidate_preservation_receipts").get() as { n: number }).n).toBe(0);

    g(f.repo, ["push", "-q", "origin", f.previous]);
    const receipt = withDatabase(f.workspace, (db) => preserveCandidate(db, request(f), { remote }));
    expect(receipt.commitSha).toBe(preserved[0]);
    expect(receipt.prBase).toMatchObject({ kind: "stacked", branch: f.previous });
    expect(remote.created.map((entry) => entry.baseBranch)).toEqual([f.previous]);
    expect(g(f.origin, ["rev-parse", "refs/heads/main"])).toBe(f.m0);
  });

  it("keeps an existing PR's base: the same base updates it, a different one is refused with the retarget remedy", () => {
    const same = serial();
    const remote = new Remote();
    remote.existing = { number: 5, url: "https://example.test/pull/5", baseRefName: same.previous };
    withDatabase(same.workspace, (db) => preserveCandidate(db, request(same), { remote }));
    expect(remote.updated.map((entry) => entry.number)).toEqual([5]);

    const other = serial();
    const mismatched = new Remote();
    mismatched.existing = { number: 6, url: "https://example.test/pull/6", baseRefName: "main" };
    expect(() => withDatabase(other.workspace, (db) => preserveCandidate(db, request(other), { remote: mismatched })))
      .toThrow(`Remedy: retarget it with \`gh pr edit 6 --base ${other.previous}\``);
    expect(mismatched.updated).toEqual([]);
    expect(mismatched.created).toEqual([]);
    expect(mismatched.pushes).toEqual([]);

    // Still a valid base: an existing PR on main, once the remote main has moved past the base revision, is kept
    // (selection alone would stack it on the previous branch, whose tip is the base revision).
    const published = serial();
    g(published.repo, ["push", "-q", "origin", "main"]);
    const advanced = g(published.origin, ["commit-tree", `${published.previousHead}^{tree}`, "-p", published.previousHead, "-m", "advanced on GitHub"]);
    g(published.origin, ["update-ref", "refs/heads/main", advanced]);
    // The host has fetched it (the tick fetches origin every iteration).
    g(published.repo, ["fetch", "-q", "origin"]);
    const kept = new Remote();
    kept.existing = { number: 8, url: "https://example.test/pull/8", baseRefName: "main" };
    const receipt = withDatabase(published.workspace, (db) => preserveCandidate(db, request(published), { remote: kept }));
    expect(receipt.prBase).toMatchObject({ kind: "project", branch: "main", tip: advanced });
    expect(receipt.prBase?.reason).toContain("; kept.");
    expect(kept.updated.map((entry) => entry.number)).toEqual([8]);
    expect(kept.updated[0].body).toContain(`- **Base:** \`main\` at \`${published.previousHead}\``);
  });
});

describe("the managed tick's stacked-base pre-check", () => {
  it("refuses before validation, re-reads the remote at most once a minute while refused, and never caches a pass", () => {
    const f = serial({ pushPrevious: false });
    let reads = 0;
    const remote = { ...systemPreservationRemote, listBranchTips: (input: { repositoryPath: string }) => { reads += 1; return systemPreservationRemote.listBranchTips!(input); } };
    const session = { id: "session_precheck", base_revision: f.previousHead, branch: f.branch } as AgentSession;
    const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
    withDatabase(f.workspace, (db) => {
      const check = (seconds: number) => stackedBaseRefusal(db, { repoRoot: f.repo, session, baseBranch: "main", now: at(seconds) }, remote);
      const first = check(0);
      expect(first).toContain("No remote branch can be this candidate's pull-request base");
      expect(first).toContain("Remedy: ");
      expect([check(1), check(59)]).toEqual([first, first]);
      expect(reads).toBe(1);
      g(f.repo, ["push", "-q", "origin", f.previous]);
      expect(check(59)).toBe(first);
      expect(check(60)).toBeNull();
      expect(check(61)).toBeNull();
      expect(reads).toBe(3);
    });
  });
});
