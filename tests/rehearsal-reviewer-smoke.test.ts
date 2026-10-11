import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSmokeCandidate, completionRequestId, main, makeStubbedRunner, parseArgs, runReviewerCalls, snapshotLive, SmokeRefusal,
  type SmokeCandidate, type SmokeOptions
} from "../scripts/rehearsal-reviewer-smoke.js";
import type { SelectedCodingAgentConfiguration } from "../src/codingAgents/providerAdapters.js";
import { CHAIN_FIXTURE } from "../src/operatorActions/rehearsalChain.js";

const root = mkdtempSync(path.join(tmpdir(), "rehearsal-reviewer-smoke-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const REPOSITORY = "test-owner/synthetic-rehearsal-fixture";
const TAG = "t1-20261011";
const ID = "first-step";
const CRITERIA = [
  'MARKER.md exists and contains exactly the line "synthetic start" followed by a trailing newline.',
  "The genesis check node scripts/check-rehearsal.mjs passes."
];

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }
  }).trim();

function plan(nextAction: string, status = "open"): string {
  return [
    "---", "arcadia: v1", "type: plan", "slug: autonomous-three-action-rehearsal", "project: synthetic-rehearsal", "status: active",
    "milestone: Synthetic rehearsal", "token_impact: small", "token_budget: Two trivial Actions.", "updated: 2026-10-11", "actions:",
    `  - id: ${ID}`, "    title: Implement MARKER.md.", `    status: ${status}`, "    responsibility: agent", "    effort: session",
    `    next_action: ${nextAction}`, "    expected_artifact: MARKER.md", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", ...CRITERIA.map((criterion) => `      - ${JSON.stringify(criterion)}`),
    "    depends_on: []", "    decisions: []",
    "  - id: second-step", "    title: Append a line.", "    status: open", "    responsibility: agent", "    effort: session",
    "    next_action: Append the second line (untouched sibling instruction).", "    expected_artifact: MARKER.md", "    clarification: clarified",
    "    confidence: high", "    acceptance_criteria:", '      - "MARKER.md has two lines."', `    depends_on: [${ID}]`, "    decisions: []",
    "questions: []", "decisions: []", "recommended_model: claude-sonnet-5", "recommended_reasoning_effort: medium", `current_action: ${ID}`,
    "---", "", "# Synthetic rehearsal plan", ""
  ].join("\n");
}

/** A tiny fixture shaped like the real one: bootstrap, a Reopen base commit, then a merged candidate commit. */
function syntheticFixture(name: string, options: { candidate?: boolean; noRequestId?: boolean } = {}): string {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, "docs/plans"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "PROJECT.md"), [
    "---", "arcadia: v1", "type: project", "slug: synthetic-rehearsal", "name: Synthetic Rehearsal", "status: active",
    "goal: Prove the reviewer smoke.", "milestone: Synthetic rehearsal", "active_plan: autonomous-three-action-rehearsal",
    `current_action: ${ID}`, "updated: 2026-10-11", "---", "", "# Synthetic Rehearsal", ""
  ].join("\n"));
  writeFileSync(path.join(dir, CHAIN_FIXTURE.planFile), plan("Implement MARKER.md (an earlier run)."));
  writeFileSync(path.join(dir, ".arcadia-three-action-rehearsal.json"), JSON.stringify({
    githubRepository: REPOSITORY, validationCommand: "node scripts/check-rehearsal.mjs"
  }));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "Bootstrap the synthetic fixture");
  writeFileSync(path.join(dir, CHAIN_FIXTURE.planFile), plan(
    options.noRequestId
      ? "Implement MARKER.md with no request id named."
      : `Implement MARKER.md (single-Action rehearsal, run tag ${TAG}; record completion under the unused Agent Ask request id complete-${ID}-${TAG}; leave git status clean).`
  ));
  git(dir, "commit", "-qam", `Reopen ${ID} for single-Action rehearsal ${TAG}`);
  if (options.candidate !== false) {
    writeFileSync(path.join(dir, "MARKER.md"), "synthetic start\n");
    writeFileSync(path.join(dir, "MISSION_LOG.md"), "# governed record that the replay must exclude\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", `Candidate: ${ID} (#7)`);
  }
  return dir;
}

function options(fixture: string, extra: Partial<SmokeOptions> & { live?: string } = {}): SmokeOptions {
  const { live, ...rest } = extra;
  return {
    fixture, qa: 1, codeReview: 1, dry: true, spendApproved: false,
    out: path.join(root, `out-${Math.random().toString(36).slice(2)}`),
    liveWorkspace: live ?? path.join(root, "no-live-workspace"), ...rest
  };
}

/** A stand-in live workspace holding one preserved attempt's evidence, plus other files that must never change. */
function liveWorkspace(): string {
  const live = path.join(root, "live");
  const attempt = path.join(live, "artifacts/qa/pull-requests", REPOSITORY.replace("/", "-"), "9", "a".repeat(40), "attempts", "2026-10-06T17-46-14-630Z-abc");
  mkdirSync(attempt, { recursive: true });
  writeFileSync(path.join(attempt, "evidence.json"), JSON.stringify({
    number: 9, state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN", isDraft: false,
    statusCheckRollup: [{ __typename: "CheckRun", conclusion: "SUCCESS", name: "check", status: "COMPLETED", workflowName: "CI" }],
    body: [
      "## Operator QA plan", "", "old plan", "", "", "### Validation evidence", "",
      `- **Record:** \`artifacts/preservation/x/validation.json\`, bound to candidate tree \`${"b".repeat(40)}\`, which is the tree of candidate commit \`${"a".repeat(40)}\``,
      "", "#### Command 1 of 1 — passed", "", "- **Command:** `node scripts/check-rehearsal.mjs`", "- **Exit code:** `0`", ""
    ].join("\n")
  }));
  writeFileSync(path.join(live, "artifacts/qa/other.txt"), "untouched\n");
  return live;
}

describe("rehearsal reviewer smoke", () => {
  let candidate: SmokeCandidate;
  let fixture: string;
  let live: string;
  let before: ReturnType<typeof snapshotLive>;

  beforeAll(() => {
    fixture = syntheticFixture("fixture");
    live = liveWorkspace();
    before = snapshotLive({ fixture, liveWorkspace: live });
    candidate = buildSmokeCandidate(options(fixture, { live }));
  }, 120_000);

  it("replays the candidate's product files, settles through the real Agent Ask, and holds every deterministic assertion", () => {
    expect(candidate.actionId).toBe(ID);
    expect(candidate.requestId).toBe(`complete-${ID}-${TAG}`);
    expect(candidate.assertions.filter((entry) => !entry.pass)).toEqual([]);
    expect(candidate.assertions.map((entry) => entry.name)).toEqual([
      "action-done", "next-action-completed-form", "pending-siblings-unchanged", "settlement-commit-governed-only", "settled-checkout-clean"
    ]);
    // Work commit: product file only (the candidate's MISSION_LOG.md is excluded); settlement commit: governed records only.
    const work = git(candidate.repo, "show", "--name-only", "--format=", candidate.workCommit).split("\n");
    expect(work).toEqual(["MARKER.md"]);
    const settlement = git(candidate.repo, "diff", "--name-only", candidate.workCommit, candidate.headCommit).split("\n").sort();
    expect(settlement).toEqual([
      `.arcadia/asks/archive/agent-ask-complete-${ID}-${TAG}.yaml`, "MISSION_LOG.md", "PROJECT.md", CHAIN_FIXTURE.planFile
    ].sort());
    expect(git(candidate.repo, "status", "--porcelain")).toBe("");
  });

  it("renders the real Operator QA plan and replaces the preserved tail's head and tree", () => {
    const body = String(candidate.pullRequest.body);
    expect(candidate.evidenceSource).toContain("preserved attempt evidence");
    expect(body.startsWith("## Operator QA plan")).toBe(true);
    expect(body).toContain("### Validation evidence");
    expect(body).toContain(`bound to candidate tree \`${candidate.headTree}\``);
    expect(body).toContain(candidate.headCommit);
    expect(body).not.toContain("b".repeat(40));
    expect(candidate.pullRequest.url).toBe(`https://github.com/${REPOSITORY}/pull/9`);
    expect(candidate.validationCommands).toEqual(["node scripts/check-rehearsal.mjs"]);
  });

  it("never writes the fixture or the live workspace", () => {
    expect(snapshotLive({ fixture, liveWorkspace: live })).toEqual(before);
    expect(git(fixture, "status", "--porcelain")).toBe("");
    expect(existsSync(path.join(fixture, ".arcadia"))).toBe(false);
    expect(candidate.out.startsWith(root)).toBe(true);
  });

  it("serves only the three gh calls the reviewer path needs and refuses the rest", () => {
    const log = path.join(candidate.out, "stub.log");
    const stub = makeStubbedRunner(candidate, { dry: true, log });
    const repo = `${REPOSITORY}`;
    const view = stub.runCommand({
      command: "gh", cwd: root,
      args: ["pr", "view", "9", "--repo", repo, "--json", "number,title,url,state,isDraft,mergeStateStatus,headRefName,headRefOid,baseRefName,baseRefOid,body,files,statusCheckRollup"]
    });
    expect(JSON.parse(view.stdout).headRefOid).toBe(candidate.headCommit);
    const commits = stub.runCommand({ command: "gh", cwd: root, args: ["pr", "view", "9", "--repo", repo, "--json", "commits"] });
    expect(JSON.parse(commits.stdout).commits.map((c: { oid: string }) => c.oid)).toEqual(candidate.commitOids);
    const compare = stub.runCommand({
      command: "gh", cwd: root,
      args: ["api", "--method", "GET", `repos/${repo}/compare/${candidate.baseRevision}...${candidate.headCommit}`, "-H", "Accept: application/vnd.github.patch"]
    });
    expect(compare.stdout).toBe(candidate.patch);
    expect(stub.refused()).toBe(0);
    const refused = stub.runCommand({ command: "gh", cwd: root, args: ["pr", "merge", "9", "--repo", repo] });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("refused gh call");
    expect(stub.refused()).toBe(1);
    // The reviewer model process is intercepted in dry mode, not run.
    const exec = stub.runCommand({ command: "codex", cwd: root, args: ["exec", "--json"] });
    expect(exec.error).toBe("dry run");
  });

  it("runs the real reviewer path over the stubbed gh in a throwaway workspace without any live write", () => {
    const hostCalls: string[] = [];
    const reviewer = {
      provider: "codex-cli", mappingId: "m", bindingId: "b", model: "gpt-test", effort: "e2_standard", capability: "c2_integrated", args: [], costRank: 1,
      profile: { name: "codex_planning", command: "codex", sandbox: "read-only" }
    } as unknown as SelectedCodingAgentConfiguration;
    const result = runReviewerCalls(candidate, { dry: true, qa: 1, codeReview: 1, liveWorkspace: live }, {
      copyLiveConfig: false,
      selectReviewer: () => reviewer,
      // Every host command (the sandbox preflight) fails closed so no process runs; the reviewer is then "unavailable".
      host: (input) => { hostCalls.push(input.command); return { status: 1, stdout: "", stderr: "no host commands in the test", error: null }; }
    });
    expect(result.refusedGhCalls).toBe(0);
    expect(result.calls.map((call) => `${call.kind}:${call.attempt}`)).toEqual(["qa:1", "code-review:1"]);
    expect(result.calls.every((call) => call.verdict !== "pass" && !call.dry && /unavailable|error/.test(call.note ?? ""))).toBe(true);
    expect(hostCalls).not.toContain("gh");
    const log = readFileSync(result.logPath, "utf8");
    expect(log).toContain("stub:pr-view");
    expect(log).toContain("stub:compare");
    expect(snapshotLive({ fixture, liveWorkspace: live })).toEqual(before);
  }, 120_000);

  it("falls back to a clearly labelled synthetic tail when no preserved evidence exists", () => {
    const built = buildSmokeCandidate(options(fixture));
    expect(built.assertions.every((entry) => entry.pass)).toBe(true);
    expect(built.evidenceSource).toContain("SYNTHETIC");
    expect(String(built.pullRequest.body)).toContain("SYNTHETIC STAND-IN");
  }, 120_000);

  it("refuses a live run without --spend-approved before cloning or writing anything", () => {
    const out = path.join(root, "refused-out");
    expect(() => buildSmokeCandidate(options(fixture, { dry: false, spendApproved: false, out }))).toThrow(SmokeRefusal);
    expect(() => buildSmokeCandidate(options(fixture, { dry: false, spendApproved: false, out }))).toThrow(/operator's own yes/);
    expect(existsSync(out)).toBe(false);
    const stderr: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
    try {
      expect(main(["--fixture", fixture, "--out", out, "--live-workspace", live])).toBe(2);
    } finally {
      spy.mockRestore();
    }
    expect(stderr.join("")).toContain("SMOKE REFUSED");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses with a named reason when no merged candidate, no request id or an unknown Action", () => {
    expect(() => buildSmokeCandidate(options(syntheticFixture("no-candidate", { candidate: false })))).toThrow(/no merged candidate commit "Candidate: first-step"/);
    expect(() => buildSmokeCandidate(options(syntheticFixture("no-request-id", { noRequestId: true })))).toThrow(/names no completion request id/);
    expect(() => buildSmokeCandidate(options(fixture, { action: "missing-step" }))).toThrow(/Action missing-step is not in/);
  });

  it("parses flags and the completion request id", () => {
    expect(parseArgs(["--dry", "--qa", "2", "--code-review", "0", "--action", "x"], {})).toMatchObject({ dry: true, qa: 2, codeReview: 0, action: "x", spendApproved: false });
    expect(parseArgs([], { SMOKE_DRY: "1" }).dry).toBe(true);
    expect(parseArgs(["--spend-approved"], {})).toMatchObject({ dry: false, spendApproved: true, qa: 3, codeReview: 3 });
    expect(() => parseArgs(["--nope"], {})).toThrow(SmokeRefusal);
    expect(completionRequestId("chain-step-05", "record under the unused Agent Ask request id complete-chain-step-05-run8-2026-10-06; leave clean")).toBe("complete-chain-step-05-run8-2026-10-06");
    expect(completionRequestId("a", "no id here")).toBeNull();
  });
});
