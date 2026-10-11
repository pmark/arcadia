import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSmokeCandidate, completionRequestId, completionRequestIds, main, makeStubbedRunner, parseArgs, runReviewerCalls, snapshotLive,
  SmokeRefusal, type SmokeCandidate, type SmokeOptions
} from "../scripts/rehearsal-reviewer-smoke.js";
import type { SelectedCodingAgentConfiguration } from "../src/codingAgents/providerAdapters.js";
import { CHAIN_FIXTURE } from "../src/operatorActions/rehearsalChain.js";

const root = mkdtempSync(path.join(tmpdir(), "rehearsal-reviewer-smoke-test-"));
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
afterAll(() => { rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const REPOSITORY = "test-owner/synthetic-rehearsal-fixture";
const TAG = "t1-20261011";
const ID = "first-step";
const CRITERIA = [
  'MARKER.md exists and contains exactly the line "synthetic start" followed by a trailing newline.',
  "The genesis check node scripts/check-rehearsal.mjs passes."
];
const BASELINE = "host-home-readable\nhost-repository-readable\nhost-network-reachable";
const SANDBOX = "sandbox-evidence-readable\nsandbox-home-denied\nsandbox-repository-denied\nsandbox-network-denied";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }
  }).trim();

function plan(nextAction: string, status = "open", secondNext = "Append the second line (untouched sibling instruction)."): string {
  return [
    "---", "arcadia: v1", "type: plan", "slug: autonomous-three-action-rehearsal", "project: synthetic-rehearsal", "status: active",
    "milestone: Synthetic rehearsal", "token_impact: small", "token_budget: Two trivial Actions.", "updated: 2026-10-11", "actions:",
    `  - id: ${ID}`, "    title: Implement MARKER.md.", `    status: ${status}`, "    responsibility: agent", "    effort: session",
    `    next_action: ${nextAction}`, "    expected_artifact: MARKER.md", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", ...CRITERIA.map((criterion) => `      - ${JSON.stringify(criterion)}`),
    "    depends_on: []", "    decisions: []",
    "  - id: second-step", "    title: Append a line.", "    status: open", "    responsibility: agent", "    effort: session",
    `    next_action: ${secondNext}`, "    expected_artifact: MARKER.md", "    clarification: clarified",
    "    confidence: high", "    acceptance_criteria:", '      - "MARKER.md has two lines."', `    depends_on: [${ID}]`, "    decisions: []",
    "questions: []", "decisions: []", "recommended_model: claude-sonnet-5", "recommended_reasoning_effort: medium", `current_action: ${ID}`,
    "---", "", "# Synthetic rehearsal plan", ""
  ].join("\n");
}

/** A tiny fixture shaped like the real one: bootstrap, a Reopen base commit, then a merged candidate commit. */
function syntheticFixture(name: string, options: { candidate?: boolean; noRequestId?: boolean; secondCandidate?: boolean } = {}): string {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, "docs/plans"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "PROJECT.md"), [
    "---", "arcadia: v1", "type: project", "slug: synthetic-rehearsal", "name: Synthetic Rehearsal", "status: active",
    "goal: Prove the reviewer smoke.", "milestone: Synthetic rehearsal", "active_plan: autonomous-three-action-rehearsal",
    `current_action: ${ID}`, "updated: 2026-10-11", "---", "", "# Synthetic Rehearsal", ""
  ].join("\n"));
  const secondNext = options.secondCandidate ? `Append the second line; record completion under the unused Agent Ask request id complete-second-step-${TAG}.` : undefined;
  writeFileSync(path.join(dir, CHAIN_FIXTURE.planFile), plan("Implement MARKER.md (an earlier run).", "open", secondNext));
  writeFileSync(path.join(dir, ".arcadia-three-action-rehearsal.json"), JSON.stringify({
    githubRepository: REPOSITORY, validationCommand: "node scripts/check-rehearsal.mjs"
  }));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "Bootstrap the synthetic fixture");
  writeFileSync(path.join(dir, CHAIN_FIXTURE.planFile), plan(
    options.noRequestId
      ? "Implement MARKER.md with no request id named."
      : `Implement MARKER.md (single-Action rehearsal, run tag ${TAG}; record completion under the unused Agent Ask request id complete-${ID}-${TAG}; leave git status clean).`,
    "open", secondNext
  ));
  git(dir, "commit", "-qam", `Reopen ${ID} for single-Action rehearsal ${TAG}`);
  if (options.candidate !== false) {
    writeFileSync(path.join(dir, "MARKER.md"), "synthetic start\n");
    writeFileSync(path.join(dir, "MISSION_LOG.md"), "# governed record that the replay must exclude\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", `Candidate: ${ID} (#7)`);
  }
  if (options.secondCandidate) {
    writeFileSync(path.join(dir, "SECOND.md"), "second\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "Candidate: second-step (#8)");
  }
  return dir;
}

function options(fixture: string, extra: Partial<SmokeOptions> & { live?: string } = {}): SmokeOptions {
  const { live, ...rest } = extra;
  return {
    fixture, qa: 1, codeReview: 1, dry: true, spendApproved: false, keepGoing: false,
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

const fakeReviewer = {
  provider: "codex-cli", mappingId: "m", bindingId: "b", model: "gpt-test", effort: "e2_standard", capability: "c2_integrated", args: [], costRank: 1,
  profile: { name: "codex_planning", command: "codex", sandbox: "read-only" }
} as unknown as SelectedCodingAgentConfiguration;

type HostInput = { command: string; args: string[] };
/** A host that passes the sandbox preflight (so the reviewer path reaches `exec`) and records every command it was handed. */
function passingHost(seen: string[]) {
  return (input: HostInput) => {
    seen.push([input.command, ...input.args.slice(0, 2)].join(" "));
    if (input.args[0] === "-c") return { status: 0, stdout: `${BASELINE}\n`, stderr: "", error: null };
    if (input.args[0] === "sandbox") return { status: 0, stdout: `${SANDBOX}\n`, stderr: "", error: null };
    return { status: 1, stdout: "", stderr: "unexpected host command in the test", error: null };
  };
}
/** A host that fails every command it is handed, so no reviewer process can ever run. */
function failingHost(seen: string[]) {
  return (input: HostInput) => {
    seen.push([input.command, ...input.args.slice(0, 2)].join(" "));
    return { status: 1, stdout: "", stderr: "no host commands in the test", error: null };
  };
}

describe("rehearsal reviewer smoke", () => {
  let candidate: SmokeCandidate;
  let fixture: string;
  let live: string;
  let before: ReturnType<typeof snapshotLive>;
  let cachePath: string;
  let claudePath: string;

  beforeAll(() => {
    vi.stubEnv("SMOKE_DRY", "");
    cachePath = path.join(root, "global-usage-cache.json");
    claudePath = path.join(root, "global-claude-usage.json");
    writeFileSync(cachePath, '{"version":1,"providers":{}}\n');
    vi.stubEnv("ARCADIA_CODING_AGENT_USAGE_CACHE_PATH", cachePath);
    vi.stubEnv("ARCADIA_CLAUDE_USAGE_PATH", claudePath);
    fixture = syntheticFixture("fixture");
    live = liveWorkspace();
    before = snapshotLive({ fixture, liveWorkspace: live });
    candidate = buildSmokeCandidate(options(fixture, { live }));
  }, 120_000);

  it("replays the candidate's product files, settles through the real Agent Ask, and holds every deterministic assertion", () => {
    expect(candidate.mode).toBe("dry");
    expect(candidate.actionId).toBe(ID);
    expect(candidate.requestId).toBe(`complete-${ID}-${TAG}`);
    expect(candidate.assertions.filter((entry) => !entry.pass)).toEqual([]);
    expect(candidate.assertions.map((entry) => entry.name)).toEqual([
      "settlement", "action-done", "next-action-completed-form", "pending-siblings-unchanged", "settlement-commit-governed-only", "settled-checkout-clean"
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

  it("never writes the fixture, the live workspace or the global telemetry files", () => {
    expect(snapshotLive({ fixture, liveWorkspace: live })).toEqual(before);
    expect(git(fixture, "status", "--porcelain")).toBe("");
    expect(existsSync(path.join(fixture, ".arcadia"))).toBe(false);
    expect(candidate.out.startsWith(root)).toBe(true);
  });

  it("serves only the three gh calls the reviewer path needs and refuses the rest; dry mode allows only the sandbox preflight", () => {
    const log = path.join(candidate.out, "stub.log");
    const hostSeen: string[] = [];
    const stub = makeStubbedRunner(candidate, { dry: true, log, host: failingHost(hostSeen) });
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
    const remote = stub.runCommand({ command: "git", cwd: root, args: ["remote", "get-url", "origin"] });
    expect(remote.stdout).toBe(`https://github.com/${REPOSITORY}.git\n`);
    expect(stub.refused()).toBe(0);
    const refused = stub.runCommand({ command: "gh", cwd: root, args: ["pr", "merge", "9", "--repo", repo] });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("refused gh call");
    expect(stub.refused()).toBe(1);
    // The reviewer model process is intercepted in dry mode, not run, and is not counted as a refusal.
    let intercepted = 0;
    const dry = makeStubbedRunner(candidate, { dry: true, log, host: failingHost(hostSeen), onModelIntercept: () => { intercepted += 1; } });
    expect(dry.runCommand({ command: "codex", cwd: root, args: ["exec", "--json"] }).error).toBe("dry run");
    expect(intercepted).toBe(1);
    expect(dry.refused()).toBe(0);
    // Only the two preflight commands reach the host; anything else, including other codex subcommands and git, fails closed.
    dry.runCommand({ command: "/bin/zsh", cwd: root, args: ["-c", "probe", "arcadia-qa-host-baseline", "a", "b"] });
    dry.runCommand({ command: "/opt/bin/codex", cwd: root, args: ["sandbox", "--", "x"] });
    expect(hostSeen).toHaveLength(2);
    for (const other of [["codex", ["login"]], ["codex", ["app-server"]], ["git", ["status"]], ["/bin/zsh", ["-c", "rm -rf /", "other"]], ["curl", ["https://example.invalid"]]] as const) {
      const result = dry.runCommand({ command: other[0], cwd: root, args: [...other[1]] });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("refused host command");
    }
    expect(dry.refused()).toBe(5);
    expect(hostSeen).toHaveLength(2);
  });

  it("runs the real reviewer path over the stubbed gh in a throwaway workspace, redirecting the global telemetry writes", () => {
    const observed: Array<Record<string, string | undefined>> = [];
    const result = runReviewerCalls(candidate, { dry: true, qa: 1, codeReview: 1, liveWorkspace: live }, {
      copyLiveConfig: false,
      selectReviewer: () => {
        observed.push({ cache: process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH, claude: process.env.ARCADIA_CLAUDE_USAGE_PATH });
        return fakeReviewer;
      },
      // Every host command (the sandbox preflight) fails closed so no process runs; the reviewer is then "unavailable".
      host: failingHost([])
    });
    expect(result.refusedCalls).toBe(0);
    expect(result.calls.map((call) => `${call.kind}:${call.attempt}`)).toEqual(["qa:1", "code-review:1"]);
    expect(result.calls.every((call) => call.verdict !== "pass" && !call.dry && /unavailable|error/.test(call.note ?? ""))).toBe(true);
    const log = readFileSync(result.logPath, "utf8");
    expect(log).toContain("stub:pr-view");
    expect(log).toContain("stub:compare");
    // During the reviewer phase both global paths pointed under --out (seeded with the current cache), and they are restored after.
    expect(observed).toHaveLength(2);
    for (const seen of observed) {
      expect(seen.cache).toBe(path.join(candidate.out, "telemetry", path.basename(cachePath)));
      expect(seen.claude).toBe(path.join(candidate.out, "telemetry", path.basename(claudePath)));
    }
    expect(readFileSync(path.join(candidate.out, "telemetry", path.basename(cachePath)), "utf8")).toBe('{"version":1,"providers":{}}\n');
    expect(process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH).toBe(cachePath);
    expect(process.env.ARCADIA_CLAUDE_USAGE_PATH).toBe(claudePath);
    expect(snapshotLive({ fixture, liveWorkspace: live })).toEqual(before);
  }, 120_000);

  it("runs the whole script in dry mode through the host stubs: exec is never handed to the host, the gate is DRY-OK, exit 0", () => {
    const hostSeen: string[] = [];
    const lines: string[] = [];
    const out = path.join(root, "integrated-out");
    const code = main(["--dry", "--qa", "1", "--code-review", "1", "--fixture", fixture, "--out", out, "--live-workspace", live], {
      env: {}, host: passingHost(hostSeen), selectReviewer: () => fakeReviewer, copyLiveConfig: false, out: (line) => lines.push(line), err: (line) => lines.push(line)
    });
    const text = lines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain("SMOKE GATE: DRY-OK");
    expect(text).toContain("PASS read-only-inputs-unchanged");
    expect(text).toContain("PASS reviewer-calls-allowed");
    expect(hostSeen.length).toBeGreaterThanOrEqual(4);
    expect(hostSeen.filter((entry) => /\bexec\b/.test(entry))).toEqual([]);
    expect(hostSeen.filter((entry) => entry.startsWith("git"))).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(out, "smoke-result.json"), "utf8")).gate).toBe("DRY-OK");
    expect(snapshotLive({ fixture, liveWorkspace: live })).toEqual(before);
  }, 120_000);

  it("exits 1 with a FAIL gate when a deterministic assertion fails, and when the reviewer is unreachable", () => {
    const lines: string[] = [];
    // The live reviewer configuration is missing: the reviewer phase cannot run, which is a failed assertion, not a stack trace.
    const missing = main(["--dry", "--qa", "1", "--code-review", "0", "--fixture", fixture, "--out", path.join(root, "fail-config"), "--live-workspace", path.join(root, "absent-live")], {
      env: {}, host: failingHost([]), selectReviewer: () => fakeReviewer, out: (line) => lines.push(line), err: (line) => lines.push(line)
    });
    expect(missing).toBe(1);
    expect(lines.join("\n")).toContain("FAIL reviewer-phase-ran");
    expect(lines.join("\n")).toContain("SMOKE GATE: FAIL");
    // The preflight fails: in dry mode that is a FAIL, never a DRY-OK.
    const unreachable: string[] = [];
    const code = main(["--dry", "--qa", "1", "--code-review", "0", "--fixture", fixture, "--out", path.join(root, "fail-preflight"), "--live-workspace", live], {
      env: {}, host: failingHost([]), selectReviewer: () => fakeReviewer, copyLiveConfig: false, out: (line) => unreachable.push(line), err: (line) => unreachable.push(line)
    });
    expect(code).toBe(1);
    expect(unreachable.join("\n")).toContain("SMOKE GATE: FAIL");
    expect(unreachable.join("\n")).not.toContain("DRY-OK");
  }, 120_000);

  it("reports a settlement failure as a failed `settlement` assertion with a FAIL gate, a result file and exit 1", () => {
    const blocked = syntheticFixture("settlement-failure", { secondCandidate: true });
    const lines: string[] = [];
    const out = path.join(root, "settlement-failure-out");
    // second-step depends on first-step, which is still open at the base: the real settlement refuses it.
    const code = main(["--dry", "--qa", "1", "--code-review", "0", "--action", "second-step", "--fixture", blocked, "--out", out, "--live-workspace", live], {
      env: {}, host: failingHost([]), selectReviewer: () => fakeReviewer, copyLiveConfig: false, out: (line) => lines.push(line), err: (line) => lines.push(line)
    });
    expect(code).toBe(1);
    const text = lines.join("\n");
    expect(text).toContain("FAIL settlement:");
    expect(text).toContain("SMOKE GATE: FAIL");
    const result = JSON.parse(readFileSync(path.join(out, "smoke-result.json"), "utf8"));
    expect(result.gate).toBe("FAIL");
    expect(result.assertions[0]).toMatchObject({ name: "settlement", pass: false });
  }, 120_000);

  it("stops buying live calls after the first non-pass unless --keep-going, and says which were skipped", () => {
    const liveCandidate = buildSmokeCandidate(options(fixture, { live, dry: false, spendApproved: true }));
    expect(liveCandidate.mode).toBe("live");
    const seen: string[] = [];
    const reviewerOptions = { dry: false, qa: 2, codeReview: 1, liveWorkspace: live };
    const stopped = runReviewerCalls(liveCandidate, reviewerOptions, { copyLiveConfig: false, selectReviewer: () => fakeReviewer, host: failingHost(seen) });
    expect(stopped.calls.map((call) => `${call.kind}:${call.attempt}`)).toEqual(["qa:1"]);
    expect(stopped.skipped).toEqual([{ kind: "qa", attempt: 2 }, { kind: "code-review", attempt: 1 }]);
    expect(stopped.calls[0].verdict).not.toBe("pass");
    const keepGoing = runReviewerCalls(liveCandidate, { ...reviewerOptions, keepGoing: true }, { copyLiveConfig: false, selectReviewer: () => fakeReviewer, host: failingHost(seen) });
    expect(keepGoing.calls).toHaveLength(3);
    expect(keepGoing.skipped).toEqual([]);
    // No host command was ever `exec`: the injected host failed every preflight, so no reviewer process could run.
    expect(seen.filter((entry) => /\bexec\b/.test(entry))).toEqual([]);
  }, 120_000);

  it("refuses a live reviewer phase for a candidate that was built dry", () => {
    expect(candidate.mode).toBe("dry");
    const reviewerOptions = { dry: false, qa: 1, codeReview: 0, liveWorkspace: live };
    expect(() => runReviewerCalls(candidate, reviewerOptions, { copyLiveConfig: false })).toThrow(SmokeRefusal);
    expect(() => makeStubbedRunner(candidate, { dry: false, log: path.join(candidate.out, "x.log") })).toThrow(/built in dry mode/);
  });

  it("falls back to a clearly labelled synthetic tail when no preserved evidence exists", () => {
    const built = buildSmokeCandidate(options(fixture));
    expect(built.assertions.every((entry) => entry.pass)).toBe(true);
    expect(built.evidenceSource).toContain("SYNTHETIC");
    expect(String(built.pullRequest.body)).toContain("SYNTHETIC STAND-IN");
  }, 120_000);

  it("refuses a live run without --spend-approved before cloning or writing anything (even with SMOKE_DRY exported empty)", () => {
    const out = path.join(root, "refused-out");
    expect(() => buildSmokeCandidate(options(fixture, { dry: false, spendApproved: false, out }))).toThrow(SmokeRefusal);
    expect(() => buildSmokeCandidate(options(fixture, { dry: false, spendApproved: false, out }))).toThrow(/operator's own yes/);
    expect(existsSync(out)).toBe(false);
    const stderr: string[] = [];
    expect(main(["--fixture", fixture, "--out", out, "--live-workspace", live], { env: {}, err: (line) => stderr.push(line) })).toBe(2);
    expect(stderr.join("")).toContain("SMOKE REFUSED");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses zero total calls in dry mode too (exit 2), and an --out inside the fixture or the live workspace", () => {
    const stderr: string[] = [];
    expect(main(["--dry", "--qa", "0", "--code-review", "0", "--fixture", fixture], { env: {}, err: (line) => stderr.push(line) })).toBe(2);
    expect(stderr.join("")).toContain("reviews nothing");
    expect(() => buildSmokeCandidate(options(fixture, { out: path.join(fixture, "smoke-out") }))).toThrow(/inside the fixture/);
    expect(() => buildSmokeCandidate(options(fixture, { live, out: path.join(live, "smoke-out") }))).toThrow(/inside the live workspace/);
    expect(existsSync(path.join(fixture, "smoke-out"))).toBe(false);
    expect(existsSync(path.join(live, "smoke-out"))).toBe(false);
  });

  it("refuses with a named reason when no merged candidate, no request id, an unknown Action or an option-shaped --base", () => {
    expect(() => buildSmokeCandidate(options(syntheticFixture("no-candidate", { candidate: false })))).toThrow(/no merged candidate commit "Candidate: first-step"/);
    expect(() => buildSmokeCandidate(options(syntheticFixture("no-request-id", { noRequestId: true })))).toThrow(/names no completion request id/);
    expect(() => buildSmokeCandidate(options(fixture, { action: "missing-step" }))).toThrow(/Action missing-step is not in/);
    expect(() => buildSmokeCandidate(options(fixture, { base: "--output=/tmp/should-not-exist" }))).toThrow(/is not a commit in the fixture/);
  });

  it("parses flags and the completion request ids", () => {
    expect(parseArgs(["--dry", "--qa", "2", "--code-review", "0", "--action", "x", "--keep-going"], {})).toMatchObject({ dry: true, qa: 2, codeReview: 0, action: "x", keepGoing: true, spendApproved: false });
    expect(parseArgs([], { SMOKE_DRY: "1" }).dry).toBe(true);
    expect(parseArgs([], { SMOKE_DRY: "" }).dry).toBe(false);
    expect(parseArgs(["--spend-approved"], {})).toMatchObject({ dry: false, spendApproved: true, qa: 3, codeReview: 3, keepGoing: false });
    expect(() => parseArgs(["--nope"], {})).toThrow(SmokeRefusal);
    expect(() => parseArgs(["--qa", "0", "--code-review", "0"], {})).toThrow(/reviews nothing/);
    expect(completionRequestId("chain-step-05", "record under the unused Agent Ask request id complete-chain-step-05-run8-2026-10-06; leave clean")).toBe("complete-chain-step-05-run8-2026-10-06");
    expect(completionRequestId("a", "no id here")).toBeNull();
    expect(completionRequestIds("a", "old complete-a-run1, new complete-a-run2; again complete-a-run2.")).toEqual(["complete-a-run1", "complete-a-run2"]);
  });

  it("runs as a CLI through a symlinked path (the entry guard compares real paths)", () => {
    const link = path.join(root, "linked-smoke.ts");
    symlinkSync(path.join(REPO_ROOT, "scripts/rehearsal-reviewer-smoke.ts"), link);
    const run = spawnSync(process.execPath, ["--import", "tsx", link, "--dry", "--qa", "0", "--code-review", "0"], {
      cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, SMOKE_DRY: "" }
    });
    expect(run.stderr).toContain("SMOKE REFUSED");
    expect(run.status).toBe(2);
  }, 60_000);
});
