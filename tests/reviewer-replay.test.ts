/**
 * The real-reviewer replay, with a stub `claude` on PATH: the real route's code
 * runs, and no model does. The stub reuses the production replay's simulated
 * reviewer where it fits.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGuards } from "../scripts/production-replay.js";
import { parseReplayArguments } from "../scripts/reviewer-replay.js";
import { loadIdentityModelTierRegistry, renderReviewerIdentityBlock } from "../src/codingAgents/agentIdentity.js";
import type { SelectedCodingAgentConfiguration } from "../src/codingAgents/providerAdapters.js";
import { assemblePrReviewPrompt, CLAUDE_REVIEWER_ROUTE, parsePersistedQaContext, QA_PR_REVIEW_CRITERIA, type QaPrCandidate, type QaSandboxProof, type RawPullRequest } from "../src/qa/prReview.js";
import {
  applySubstitutions,
  parseRenderedOperatorQaPlan,
  REPLAY_FIDELITY_LIMITS,
  renderReplayReport,
  replayExitCode,
  ReplayInputError,
  runReviewerReplay,
  splitPullRequestBody,
  type ReviewerReplayOptions
} from "../src/qa/reviewerReplay.js";
import { renderOperatorQaPlan, type OperatorQaPlanSource } from "../src/sessions/operatorQaPlan.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const BOUNDARY_FLAGS = "--tools --json-schema --setting-sources --strict-mcp-config --no-session-persistence";
const SUBSCRIPTION_AUTH = '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max","email":"replay-test-account@example.invalid"}';
const INIT = JSON.stringify({ type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], apiKeySource: "none" });
const IDENTITY = ["Identity:", "You are a fixture critic."];

const PLAN_SOURCE: OperatorQaPlanSource = {
  kind: "action-acceptance",
  actionKey: "arcadia/pin-example",
  actionTitle: "Pin the *example* with `tests/example.test.ts` for @someone",
  acceptanceCriteria: [
    "tests/example.test.ts gains a test that asserts the [fallback] path.",
    "The change touches only tests/example.test.ts, and `pnpm test` passes."
  ],
  validationCommands: ["node scripts/preservation-self-check.mjs", "echo `date`"]
};

let root: string;
let originalPath: string | undefined;
let originalApiKey: string | undefined;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-reviewer-replay-")));
  originalPath = process.env.PATH;
  originalApiKey = process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const ran = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** A real repository, so the plan renderer's Git reads are real. */
function createRepository(): { repository: string; baseRevision: string; commitSha: string } {
  const repository = path.join(root, "repository");
  mkdirSync(path.join(repository, "tests"), { recursive: true });
  git(repository, "init", "--quiet", "--initial-branch=main");
  writeFileSync(path.join(repository, "README.md"), "base\n");
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", "base");
  const baseRevision = git(repository, "rev-parse", "HEAD");
  writeFileSync(path.join(repository, "tests", "example.test.ts"), "// the test\n");
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", "candidate");
  return { repository, baseRevision, commitSha: git(repository, "rev-parse", "HEAD") };
}

/** A saved attempt directory in the shape `arcadia qa pr` writes, with the prompt its builder assembles. */
function createAttempt(role: "qa" | "code-review" = "qa", options: { planBody?: string } = {}) {
  const { repository, baseRevision, commitSha } = createRepository();
  const facts = { branch: "claude/pin-example", baseBranch: "main", baseRevision, commitSha };
  const rendered = renderOperatorQaPlan(PLAN_SOURCE, { ...facts, changedFiles: [{ status: "A", path: "tests/example.test.ts" }] });
  const candidate: QaPrCandidate = {
    projectId: "proj_fixture", projectName: "Arcadia", repository: "pmark/arcadia", number: 2062, title: "Candidate: pin-example",
    url: "https://github.com/pmark/arcadia/pull/2062", headSha: commitSha, headBranch: facts.branch, baseSha: baseRevision, baseBranch: "main", isDraft: false, mergeStateStatus: "CLEAN"
  };
  const pullRequest = {
    baseRefName: "main", baseRefOid: baseRevision,
    body: `${options.planBody ?? rendered.body}\n\n### Validation evidence\n\nSaved host evidence.`,
    files: [{ path: "tests/example.test.ts", additions: 1, deletions: 0, changeType: "ADDED" }],
    headRefName: facts.branch, headRefOid: commitSha, isDraft: false, mergeStateStatus: "CLEAN", number: 2062, state: "OPEN",
    statusCheckRollup: [{ name: "unit", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/unit", workflowName: "CI" }],
    title: candidate.title, url: candidate.url
  } as unknown as RawPullRequest;
  const patch = "diff --git a/tests/example.test.ts b/tests/example.test.ts\n+// the test\n";
  const sandboxProof: QaSandboxProof = { passed: true, status: 0, output: "reviewer-boundary: saved proof", error: null };
  const identity = renderReviewerIdentityBlock({ agent: "claude", model: "opus", effort: "e2_standard", registry: loadIdentityModelTierRegistry(createReadyWorkspace()) });
  const prompt = assemblePrReviewPrompt({ role, candidate, pullRequest, patch, sandboxProof, identity, settlementRecords: ["MISSION_LOG.md", "PROJECT.md"], settled: { preservedCommit: commitSha, head: commitSha } });
  const attempt = path.join(root, "attempts", "saved");
  mkdirSync(attempt, { recursive: true });
  writeFileSync(path.join(attempt, "evidence.json"), `${JSON.stringify(pullRequest, null, 2)}\n`);
  writeFileSync(path.join(attempt, "candidate.patch"), patch);
  writeFileSync(path.join(attempt, "prompt.md"), prompt);
  writeFileSync(path.join(attempt, "verdict-schema.json"), `${JSON.stringify(CLAUDE_REVIEWER_ROUTE.schema(CLAUDE_REVIEWER_ROUTE.roles[role]), null, 2)}\n`);
  writeFileSync(path.join(attempt, "model-verdict.json"), JSON.stringify({ findings: [{ title: "The original finding" }] }));
  writeFileSync(path.join(attempt, "metadata.json"), JSON.stringify({
    candidate, verdict: "fail", patchSha256: createHash("sha256").update(patch).digest("hex"), initialEvidenceFingerprint: "f".repeat(64), sandboxProof,
    effectiveness: { role, projectSlug: "arcadia", actionId: "pin-example" }
  }));
  return { attempt, repository, candidate, pullRequest, patch, sandboxProof, prompt };
}

function createReadyWorkspace(): string {
  const workspace = path.join(root, "workspace");
  if (!existsSync(workspace)) initWorkspace(workspace);
  return workspace;
}

function claudeReviewer(overrides: Partial<SelectedCodingAgentConfiguration> = {}): SelectedCodingAgentConfiguration {
  return {
    mappingId: "test-mapping",
    bindingId: "claude-review",
    profile: { name: "claude_planning", provider: "claude-code-cli", package: "fake", command: "claude", purpose: "planning", sandbox: "read-only", args: ["--print"] },
    provider: "claude-code-cli",
    model: "opus",
    capability: "c2_integrated",
    effort: "e2_standard",
    args: ["--model", "opus", "--effort", "medium"],
    costRank: 0,
    ...overrides
  };
}

/**
 * Puts stubs first on PATH. `claude` logs every call and its API-key
 * environment to `calls.log`; any `gh` or `codex` call is logged as a violation.
 */
function installStubs(claudeBody: string): { calls: string; violations: string } {
  const bin = path.join(root, "stub-bin");
  mkdirSync(bin, { recursive: true });
  const calls = path.join(root, "stub-logs", "calls.log");
  const violations = path.join(root, "stub-logs", "violations.log");
  mkdirSync(path.dirname(calls), { recursive: true });
  writeFileSync(calls, "");
  writeFileSync(violations, "");
  const executable = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  executable("claude", `printf '%s key=%s\\n' "$1" "\${ANTHROPIC_API_KEY:-absent}" >> '${calls}'\n${claudeBody}`);
  for (const name of ["gh", "codex", "opencode"]) executable(name, `echo "${name} $*" >> '${violations}'\nexit 97`);
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  return { calls, violations };
}

const helpAndAuth = (help = BOUNDARY_FLAGS, auth = SUBSCRIPTION_AUTH) => `case "$1" in
  --help) echo "${help}"; exit 0 ;;
  auth) echo '${auth}'; exit 0 ;;
esac`;

/** The production replay's own claude guard, simulating `verdict`; only sign-in is answered here, because the guard's sign-in is not a subscription. */
function installGuardedClaude(verdict: "pass" | "fail-always") {
  const guardRoot = path.join(root, "guard");
  const effects = path.join(root, "stub-logs", "effects.jsonl");
  mkdirSync(path.dirname(effects), { recursive: true });
  writeFileSync(effects, "");
  installGuards(guardRoot, effects, verdict);
  return { ...installStubs(`case "$1" in auth) echo '${SUBSCRIPTION_AUTH}'; exit 0 ;; esac\nexec '${path.join(guardRoot, "bin", "claude")}' "$@"`), effects };
}

function modelVerdict(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "fail",
    summary: "One plan step cannot show its criterion.",
    findings: [{ severity: "medium", title: "Operator QA plan Step 4 cannot show that tests pass", evidence: "Step 4 reads a diff.", recommendation: "Run the test." }],
    checks: QA_PR_REVIEW_CRITERIA.map((criterion) => ({
      criterion: criterion.id, name: criterion.name, status: criterion.id === "operator-qa-plan" ? "fail" : "pass",
      evidence: criterion.id === "operator-qa-plan" ? "Step 4 reads a diff, which cannot show a test passing." : "Supplied evidence holds."
    })),
    residualRisks: [],
    ...overrides
  };
}

function reviewerAnswers(verdict: unknown, init = INIT): string {
  const result = JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: verdict, usage: { input_tokens: 7, cache_creation_input_tokens: 11, output_tokens: 5 } });
  const events = path.join(root, "stub-logs", `events-${createHash("sha256").update(init + result).digest("hex").slice(0, 8)}.jsonl`);
  mkdirSync(path.dirname(events), { recursive: true });
  writeFileSync(events, `${init}\n${result}\n`);
  return `${helpAndAuth()}\ncat > /dev/null\ncat '${events}'`;
}

function replay(attempt: string, workspace: string, repository: string, options: Partial<ReviewerReplayOptions> = {}) {
  return runReviewerReplay({
    attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), runs: 2, ...options
  }, { selectReviewer: () => claudeReviewer() });
}

/** Every file under `directory`, by content and modification time, except `excluded`. */
function snapshotTree(directory: string, excluded: readonly string[] = []): Record<string, string> {
  const tree: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (excluded.includes(full)) continue;
      if (entry.isDirectory()) walk(full);
      else tree[full] = `${createHash("sha256").update(readFileSync(full)).digest("hex")}:${statSync(full).mtimeMs}`;
    }
  };
  walk(directory);
  return tree;
}

function stubCalls(calls: string): string[] {
  return readFileSync(calls, "utf8").split("\n").filter(Boolean);
}

describe("replaying a saved attempt through the real reviewer route", () => {
  it("runs N times and reports each run's verdict, on the production replay's simulated pass", () => {
    const { attempt, repository, prompt } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const { calls, violations, effects } = installGuardedClaude("pass");
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 3 });
    expect(report.stopped).toBeNull();
    expect(report.runs.map((run) => run.verdict)).toEqual(["pass", "pass", "pass"]);
    expect(report.runs.every((run) => run.pass)).toBe(true);
    expect(replayExitCode(report)).toBe(0);
    expect(readFileSync(effects, "utf8").split("\n").filter((line) => line.includes("simulated:reviewer"))).toHaveLength(3);
    expect(readFileSync(report.prompt.path, "utf8")).toBe(prompt);
    expect(report.prompt.savedComparison?.identical).toBe(true);
    expect(stubCalls(calls).filter((call) => call.startsWith("--help"))).toHaveLength(1);
    expect(readFileSync(violations, "utf8")).toBe("");
    const table = renderReplayReport(report).join("\n");
    expect(table).toContain("passes: 3 of 3");
    expect(table).toContain("original finding: The original finding");
    expect(table).toContain("no authority");
  });

  it("reports the failed check and the finding title on the production replay's simulated fail", () => {
    const { attempt, repository } = createAttempt("code-review");
    const workspace = createReadyWorkspace();
    installGuardedClaude("fail-always");
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 1 });
    expect(report.evidence.role).toBe("code-review");
    expect(report.runs[0]).toMatchObject({ verdict: "fail", pass: false, modelVerdict: "fail" });
    expect(report.runs[0].failedChecks).toEqual([{ name: "Correctness", status: "fail" }]);
    expect(report.runs[0].findings).toEqual([{ severity: "medium", title: "SIMULATED repairable defect" }]);
    expect(replayExitCode(report)).toBe(1);
    const table = renderReplayReport(report).join("\n");
    expect(table).toContain("failed check: Correctness (fail)");
    expect(table).toContain("finding [medium]: SIMULATED repairable defect");
  });

  it("launches exactly as the real route does: no tools, no settings, no API key, the prompt on stdin", () => {
    const { attempt, repository, prompt } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    process.env.ANTHROPIC_API_KEY = "fixture-not-a-real-key";
    const seen: Array<{ args: string[]; stdin?: string; environment?: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }> = [];
    const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), runs: 1, prompt: "saved", timeoutMs: 60_000 }, {
      selectReviewer: () => claudeReviewer(),
      runCommand: (input) => {
        seen.push(input);
        if (input.args[0] === "--help") return { status: 0, stdout: BOUNDARY_FLAGS, stderr: "", error: null };
        if (input.args[0] === "auth") return { status: 0, stdout: SUBSCRIPTION_AUTH, stderr: "", error: null };
        return { status: 0, stdout: `${INIT}\n${JSON.stringify({ type: "result", is_error: false, structured_output: modelVerdict() })}\n`, stderr: "", error: null };
      }
    });
    expect(report.runs[0].verdict).toBe("fail");
    const launch = seen.find((call) => call.args.includes("--print"))!;
    expect(launch.args[launch.args.indexOf("--tools") + 1]).toBe("");
    expect(launch.args[launch.args.indexOf("--setting-sources") + 1]).toBe("");
    expect(launch.args).toContain("--strict-mcp-config");
    expect(launch.args).toContain("--no-session-persistence");
    expect(launch.args[launch.args.indexOf("--model") + 1]).toBe("opus");
    expect(launch.args[launch.args.indexOf("--effort") + 1]).toBe("medium");
    expect(launch.args[launch.args.indexOf("--system-prompt") + 1]).toContain("untrusted evidence");
    expect(launch.stdin).toBe(prompt);
    expect(launch.timeoutMs).toBe(60_000);
    expect(launch.cwd.startsWith(report.scratch)).toBe(true);
    for (const call of seen) {
      expect(call.environment?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(call.environment?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    }
  });

  it("reads the worker's plan waiver over each failed run, and token use where the output reports it", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    installStubs(reviewerAnswers(modelVerdict()));
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 1 });
    expect(report.runs[0].planWaiver).toEqual({ eligible: true, detail: "one plan step: 4" });
    expect(report.runs[0].usage).toMatchObject({ outputTokens: 5 });
    expect(renderReplayReport(report).join("\n")).toContain("plan waiver, report half: eligible");
  });

  it("applies the deterministic gate to the saved evidence: red checks are not a pass", () => {
    const { attempt, repository, pullRequest } = createAttempt("qa");
    const red = { ...pullRequest, statusCheckRollup: [{ name: "unit", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci/unit", workflowName: "CI" }] };
    writeFileSync(path.join(attempt, "evidence.json"), `${JSON.stringify(red, null, 2)}\n`);
    const workspace = createReadyWorkspace();
    installGuardedClaude("pass");
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 1 });
    expect(report.runs[0]).toMatchObject({ verdict: "fail", modelVerdict: "pass", gateVerdict: "fail" });
    expect(report.runs[0].gateReasons).toContain("unit validation failed");
  });
});

describe("a reviewer that cannot be used stops the replay with no fallback", () => {
  it("stops at the first unavailable run", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const errored = JSON.stringify({ type: "result", is_error: true, result: "API Error: overloaded" });
    const events = path.join(root, "unavailable.jsonl");
    writeFileSync(events, `${INIT}\n${errored}\n`);
    const { calls, violations } = installStubs(`${helpAndAuth()}\ncat > /dev/null\ncat '${events}'`);
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 3 });
    expect(report.stopped?.reason).toBe("unavailable");
    expect(report.stopped?.message).toContain("API Error: overloaded");
    expect(report.stopped?.message).toContain("No fallback");
    expect(report.runs).toHaveLength(0);
    expect(stubCalls(calls).filter((call) => call.startsWith("--print"))).toHaveLength(1);
    expect(readFileSync(violations, "utf8")).toBe("");
    expect(replayExitCode(report)).toBe(3);
  });

  it("bounds each run's time", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    installStubs(`${helpAndAuth()}\nexec sleep 30`);
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 2, timeoutMs: 400 });
    expect(report.stopped?.reason).toBe("unavailable");
    expect(report.stopped?.message).toContain("-second limit");
    expect(report.runs).toHaveLength(0);
  });

  it("stops at a failed preflight before any reviewer runs", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const { calls } = installStubs(`${helpAndAuth("--tools --json-schema")}\nexit 0`);
    const report = replay(attempt, workspace, repository, { prompt: "saved" });
    expect(report.stopped?.reason).toBe("preflight");
    expect(report.stopped?.message).toContain("claude-flag-missing: --setting-sources");
    expect(stubCalls(calls).map((call) => call.split(" ")[0])).toEqual(["--help"]);
    expect(report.runs).toHaveLength(0);
  });

  it("stops when no claude CLI exists at all", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    process.env.PATH = path.join(root, "empty-bin");
    const report = replay(attempt, workspace, repository, { prompt: "saved" });
    expect(report.stopped?.reason).toBe("preflight");
    expect(report.runs).toHaveLength(0);
  });

  it.each([
    ["an API key login", '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty"}', "auth method api_key"],
    ["a cloud provider", '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"bedrock"}', "provider bedrock"],
    ["no sign-in", '{"loggedIn":false}', "not signed in"],
    ["unreadable status", "not json", "unproven"]
  ])("stops before any reviewer runs on %s", (_label, auth, message) => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const { calls } = installStubs(`${helpAndAuth(BOUNDARY_FLAGS, auth)}\nexit 0`);
    const report = replay(attempt, workspace, repository, { prompt: "saved" });
    expect(report.stopped?.reason).toBe("auth");
    expect(report.stopped?.message).toContain(message);
    expect(stubCalls(calls).some((call) => call.startsWith("--print"))).toBe(false);
  });

  it.each([
    ["a non-subscription key source", JSON.stringify({ type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], apiKeySource: "ANTHROPIC_API_KEY" }), "reported API key source ANTHROPIC_API_KEY"],
    ["no reported key source", JSON.stringify({ type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [] }), "did not report its API key source"]
  ])("discards a run's verdict on %s", (_label, init, message) => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const { calls } = installStubs(reviewerAnswers(modelVerdict(), init));
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 3 });
    expect(report.stopped?.reason).toBe("auth");
    expect(report.stopped?.message).toContain(message);
    expect(report.runs).toHaveLength(0);
    expect(stubCalls(calls).filter((call) => call.startsWith("--print"))).toHaveLength(1);
  });

  it("refuses a run that reported tools, through the real route's boundary check", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    installStubs(reviewerAnswers(modelVerdict(), JSON.stringify({ type: "system", subtype: "init", tools: ["Bash"], mcp_servers: [], apiKeySource: "none" })));
    const report = replay(attempt, workspace, repository, { prompt: "saved" });
    expect(report.stopped?.reason).toBe("unavailable");
    expect(report.stopped?.message).toContain("boundary failed");
  });

  it("never prints or keeps the sign-in status's account details", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    installGuardedClaude("pass");
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 1 });
    expect(report.reviewer?.authMethod).toBe("claude.ai");
    const kept = Object.keys(snapshotTree(report.scratch)).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(`${kept}${renderReplayReport(report).join("\n")}`).not.toContain("replay-test-account");
  });

  it("stops on a selection that is not the review-only Claude binding, and never falls back", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const { calls } = installStubs(helpAndAuth());
    for (const reviewer of [
      claudeReviewer({ bindingId: "codex-standard", provider: "codex-cli" }),
      claudeReviewer({ bindingId: "claude-planning" }),
      claudeReviewer({ profile: { ...claudeReviewer().profile, sandbox: "workspace-write" } })
    ]) {
      const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), prompt: "saved" }, { selectReviewer: () => reviewer });
      expect(report.stopped?.reason).toBe("binding");
      expect(report.stopped?.message).toContain("claude-review");
    }
    expect(stubCalls(calls)).toEqual([]);
  });

  it("stops on a workspace config that lacks the binding, through the real selection", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const { calls } = installStubs(helpAndAuth());
    const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), prompt: "saved" });
    expect(report.stopped?.reason).toBe("binding");
    expect(stubCalls(calls)).toEqual([]);
  });
});

describe("the replay holds no authority", () => {
  it("writes nothing outside its scratch directory, and touches no database, GitHub or saved attempt", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const { violations } = installGuardedClaude("pass");
    const logs = path.join(root, "stub-logs");
    const scratchParent = path.join(root, "scratch");
    const guard = path.join(root, "guard");
    const before = snapshotTree(root, [logs, scratchParent, guard]);
    const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent, runs: 2 }, { selectReviewer: () => claudeReviewer() });
    expect(report.runs).toHaveLength(2);
    expect(snapshotTree(root, [logs, scratchParent, guard])).toEqual(before);
    expect(realpathSync(path.dirname(report.scratch))).toBe(realpathSync(scratchParent));
    expect(readFileSync(violations, "utf8")).toBe("");
  });

  it("refuses a scratch directory under the workspace or the saved attempt, and creates nothing there", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const select = { selectReviewer: () => claudeReviewer() };
    const base = { attempt, workspace, repositoryPath: repository, prompt: "saved" as const };
    expect(() => runReviewerReplay({ ...base, scratchParent: path.join(workspace, "artifacts") }, select)).toThrow(/outside .*workspace/);
    expect(() => runReviewerReplay({ ...base, scratchParent: path.join(attempt) }, select)).toThrow(/outside .*saved/);
    expect(readdirSync(attempt).filter((name) => name.startsWith("reviewer-replay"))).toEqual([]);
  });

  it("produces nothing a real verdict reader accepts", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    installGuardedClaude("pass");
    const report = replay(attempt, workspace, repository, { prompt: "saved", runs: 1 });
    expect(report.authority).toBe("none");
    expect(parsePersistedQaContext(JSON.stringify(report), "qa")).toBeNull();
    expect(parsePersistedQaContext(readFileSync(path.join(report.scratch, "replay-report.json"), "utf8"), "qa")).toBeNull();
    expect(parsePersistedQaContext(readFileSync(path.join(report.runs[0].directory, "replay-run.json"), "utf8"), "qa")).toBeNull();
    // The real route finds a receipt by these names, under the workspace's artifacts.
    const written = Object.keys(snapshotTree(report.scratch)).map((file) => path.basename(file));
    for (const receiptName of ["result.json", "metadata.json", "qa-report.md"]) expect(written).not.toContain(receiptName);
  });

  it("has no route to a database, GitHub or a recorded verdict in its source", () => {
    for (const file of ["../src/qa/reviewerReplay.ts", "../scripts/reviewer-replay.ts"]) {
      const source = readFileSync(path.resolve(import.meta.dirname, file), "utf8");
      for (const forbidden of ["withDatabase", "withReadOnlyDatabase", "db/connection", "db/repositories", "better-sqlite3", "runQaPrReviewCommand", "beginIndependentVerdict", "finishIndependentVerdict", "persistQaResult", "\"gh\"", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "observeCodingAgentAvailability"]) {
        expect(source, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("comparing old and new prompts on the same evidence", () => {
  it("rebuilds the saved prompt byte for byte when the builder and renderer have not changed", () => {
    const { attempt, repository, prompt } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), promptOnly: true }, { selectReviewer: () => claudeReviewer() });
    expect(report.prompt.source).toBe("rebuild-plan");
    expect(report.prompt.planRebuild?.identicalToSaved).toBe(true);
    expect(readFileSync(report.prompt.path, "utf8")).toBe(prompt);
    expect(report.prompt.savedComparison?.identical).toBe(true);
  });

  it("shows where a change to the prompt or plan text differs from the saved attempt", () => {
    const { attempt, repository, prompt } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    writeFileSync(path.join(attempt, "prompt.md"), prompt.replace("You are a separate, read-only QA reviewer.", "You were an older QA reviewer."));
    const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), promptOnly: true }, { selectReviewer: () => claudeReviewer() });
    expect(report.prompt.savedComparison).toMatchObject({ identical: false, firstDifferenceLine: 3 });
    expect(renderReplayReport(report).join("\n")).toContain("differs from the saved prompt from line 3");
  });

  it("runs no claude process for --prompt-only", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const { calls } = installStubs("exit 0");
    const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), promptOnly: true }, { selectReviewer: () => claudeReviewer() });
    expect(report.prompt.bytes).toBeGreaterThan(0);
    expect(report.runs).toEqual([]);
    expect(stubCalls(calls)).toEqual([]);
    expect(replayExitCode(report)).toBe(0);
  });

  it("reads the plan renderer's inputs back out of its output", () => {
    const facts = { branch: "claude/x", baseBranch: "main", baseRevision: "a".repeat(40), commitSha: "b".repeat(40) };
    const rendered = renderOperatorQaPlan(PLAN_SOURCE, { ...facts, changedFiles: [{ status: "A", path: "tests/example.test.ts" }] });
    const parsed = parseRenderedOperatorQaPlan(rendered.body);
    expect(parsed.facts).toEqual(facts);
    expect(parsed.source).toEqual(PLAN_SOURCE);
    expect(renderOperatorQaPlan(parsed.source, { ...parsed.facts, changedFiles: [{ status: "A", path: "tests/example.test.ts" }] }).body).toBe(rendered.body);
  });

  it("reads a Project that declares no validation commands", () => {
    const facts = { branch: "b", baseBranch: "main", baseRevision: "a".repeat(40), commitSha: "b".repeat(40), changedFiles: [] };
    const source = { ...PLAN_SOURCE, actionTitle: null, validationCommands: [] };
    expect(parseRenderedOperatorQaPlan(renderOperatorQaPlan(source, facts).body).source).toEqual(source);
  });

  it.each([
    ["a truncated criterion", { ...PLAN_SOURCE, acceptanceCriteria: ["x".repeat(1_200)] }, "truncated"],
    ["a truncated command", { ...PLAN_SOURCE, validationCommands: [`node ${"x".repeat(300)}`] }, "truncated"]
  ])("refuses to guess at %s, and takes the inputs from --plan-source instead", (_label, source, message) => {
    const facts = { branch: "b", baseBranch: "main", baseRevision: "a".repeat(40), commitSha: "b".repeat(40), changedFiles: [] };
    const body = renderOperatorQaPlan(source, facts).body;
    expect(() => parseRenderedOperatorQaPlan(body)).toThrow(message);
    expect(() => parseRenderedOperatorQaPlan(body)).toThrow(ReplayInputError);
    expect(parseRenderedOperatorQaPlan(body, source).source).toBe(source);
  });

  it("refuses a body with a refused or placeholder plan rather than rendering one", () => {
    const { attempt, repository } = createAttempt("qa", { planBody: "## QA plan\nReview the managed documents." });
    const workspace = createReadyWorkspace();
    expect(() => runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), promptOnly: true }, { selectReviewer: () => claudeReviewer() })).toThrow(ReplayInputError);
    const kept = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), promptOnly: true, prompt: "rebuild" }, { selectReviewer: () => claudeReviewer() });
    expect(readFileSync(kept.prompt.path, "utf8")).toContain("Review the managed documents.");
  });

  it("keeps every section after the plan verbatim, whichever comes first", () => {
    const plan = `## Operator QA plan\n\nSteps.\n\nMerge, deployment and publication remain separate operator gates.`;
    const tail = "\n\n### Completion execution evidence\n\n```json\n{}\n```\n\n### Validation evidence\n\nSaved.";
    expect(splitPullRequestBody(`${plan}${tail}`)).toEqual({ plan, tail });
    // A criterion quoting the last line is never its own line.
    const quoting = `## Operator QA plan\n\n- **Expected:** exactly as worded: “Merge, deployment and publication remain separate operator gates.”\n\nMerge, deployment and publication remain separate operator gates.`;
    expect(splitPullRequestBody(`${quoting}${tail}`)).toEqual({ plan: quoting, tail });
  });

  it("uses a prepared prompt verbatim, on the attempt's evidence", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const file = path.join(root, "prepared.md");
    writeFileSync(file, "A prepared prompt.\n");
    installGuardedClaude("pass");
    const report = replay(attempt, workspace, repository, { promptFile: file, runs: 1 });
    expect(report.prompt.source).toBe("file");
    expect(readFileSync(report.prompt.path, "utf8")).toBe("A prepared prompt.\n");
    expect(report.prompt.savedComparison?.identical).toBe(false);
    expect(report.runs[0].verdict).toBe("pass");
  });

  it("makes each textual substitution explicit, counted and refused when it does not match", () => {
    expect(applySubstitutions("one two two", [{ find: "two", replace: "2", count: 2 }, { find: "one", replace: "1" }])).toEqual({
      prompt: "1 2 2",
      applied: [{ find: "two", replace: "2", occurrences: 2 }, { find: "one", replace: "1", occurrences: 1 }]
    });
    expect(() => applySubstitutions("one two two", [{ find: "two", replace: "2" }])).toThrow("expected 1 occurrence(s) and found 2");
    expect(() => applySubstitutions("one", [{ find: "absent", replace: "x" }])).toThrow(ReplayInputError);
    const { attempt, repository, candidate } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const report = runReviewerReplay({
      attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), prompt: "saved", promptOnly: true,
      substitutions: [{ find: "# Arcadia Independent Pull-Request QA", replace: "# Changed heading" }]
    }, { selectReviewer: () => claudeReviewer() });
    expect(readFileSync(report.prompt.path, "utf8").startsWith("# Changed heading")).toBe(true);
    expect(JSON.parse(readFileSync(path.join(report.scratch, "substitutions.json"), "utf8"))).toEqual([{ find: "# Arcadia Independent Pull-Request QA", replace: "# Changed heading", occurrences: 1 }]);
    expect(renderReplayReport(report).join("\n")).toContain("substituted 1x");
    expect(candidate.number).toBe(2062);
  });

  it("refuses a substitution that changes nothing, rather than reporting a change the prompt does not have", () => {
    expect(() => applySubstitutions("one two", [{ find: "two", replace: "two" }])).toThrow(ReplayInputError);
    expect(() => applySubstitutions("one two", [{ find: "one", replace: "1" }, { find: "two", replace: "two" }])).toThrow("Substitution 2 replaces its text with the same text");
    expect(applySubstitutions("one two", [{ find: "two", replace: "Two" }]).prompt).toBe("one Two");
  });

  it("runs from a fixture of real prompt inputs, re-rendering its plan from the inputs it carries", () => {
    const { candidate, pullRequest, patch, sandboxProof } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const facts = { branch: candidate.headBranch, baseBranch: "main", baseRevision: candidate.baseSha, commitSha: candidate.headSha, changedFiles: [{ status: "A", path: "tests/example.test.ts" }], testRun: { setup: "bridge", runner: "pnpm exec vitest run" } };
    const fixture = path.join(root, "fixture.json");
    const body = `${renderOperatorQaPlan(PLAN_SOURCE, facts).body}\n\n### Validation evidence\n\nSaved host evidence.`;
    writeFileSync(fixture, JSON.stringify({ source: "fixture", candidate, pullRequest: { ...pullRequest, body }, patch, sandboxProof, identity: IDENTITY, settlementRecords: ["PROJECT.md"], settled: { preservedCommit: "c".repeat(40), head: candidate.headSha }, planSource: PLAN_SOURCE, planFacts: facts }));
    const report = runReviewerReplay({ fixture, workspace, repositoryPath: root, scratchParent: path.join(root, "scratch"), promptOnly: true }, { selectReviewer: () => claudeReviewer() });
    expect(report.evidence.kind).toBe("fixture");
    expect(report.prompt.planRebuild?.identicalToSaved).toBe(true);
    const prompt = readFileSync(report.prompt.path, "utf8");
    expect(prompt).toContain("You are a fixture critic.");
    expect(prompt).toContain('- "PROJECT.md"');
    expect(() => runReviewerReplay({ fixture, workspace, repositoryPath: root, scratchParent: path.join(root, "scratch"), prompt: "saved", promptOnly: true }, { selectReviewer: () => claudeReviewer() })).toThrow("--prompt saved needs a saved attempt");
  });

  it("refuses evidence that does not hang together, and bad arguments", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const base = { workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch") };
    const select = { selectReviewer: () => claudeReviewer() };
    expect(() => runReviewerReplay({ ...base }, select)).toThrow("exactly one");
    expect(() => runReviewerReplay({ ...base, attempt, fixture: "x" }, select)).toThrow("exactly one");
    expect(() => runReviewerReplay({ ...base, attempt, runs: 0 }, select)).toThrow("--runs");
    expect(() => runReviewerReplay({ ...base, attempt, timeoutMs: 31 * 60_000 }, select)).toThrow("time limit");
    expect(() => runReviewerReplay({ ...base, attempt, role: "code-review" }, select)).toThrow("other role's criteria");
    writeFileSync(path.join(attempt, "candidate.patch"), "changed\n");
    expect(() => runReviewerReplay({ ...base, attempt }, select)).toThrow("does not match the sha256");
    expect(existsSync(path.join(root, "missing"))).toBe(false);
    expect(() => runReviewerReplay({ ...base, attempt: path.join(root, "missing") }, select)).toThrow("Cannot read");
  });
});

describe("the system prompt a replay runs under", () => {
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
  const answering = (seen: Array<{ args: string[] }>) => (input: { args: string[] }) => {
    seen.push(input);
    if (input.args[0] === "--help") return { status: 0, stdout: BOUNDARY_FLAGS, stderr: "", error: null };
    if (input.args[0] === "auth") return { status: 0, stdout: SUBSCRIPTION_AUTH, stderr: "", error: null };
    return { status: 0, stdout: `${INIT}\n${JSON.stringify({ type: "result", is_error: false, structured_output: modelVerdict() })}\n`, stderr: "", error: null };
  };

  it("states the sha256 of what each launch actually passed, in the report and the table", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const seen: Array<{ args: string[] }> = [];
    const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), runs: 2, prompt: "saved" }, { selectReviewer: () => claudeReviewer(), runCommand: answering(seen) });
    const launches = seen.filter((call) => call.args.includes("--print"));
    expect(launches).toHaveLength(2);
    const expected = launches.map((launch) => sha256(launch.args[launch.args.indexOf("--system-prompt") + 1]));
    expect(report.runs.map((run) => run.systemPromptSha256)).toEqual(expected);
    expect(report.systemPrompt).toEqual({ source: "this-checkout", sha256: expected[0], bytes: Buffer.byteLength(CLAUDE_REVIEWER_ROUTE.systemPrompt) });
    const table = renderReplayReport(report);
    expect(table.join("\n")).toContain(`sha256 ${expected[0]}`);
    expect(table.filter((line) => /^\d+\s+(?:yes|NO)\s/.test(line) && line.includes(expected[0].slice(0, 12)))).toHaveLength(2);
    expect(JSON.parse(readFileSync(path.join(report.runs[1].directory, "replay-run.json"), "utf8"))).toMatchObject({ systemPromptSha256: expected[0] });
  });

  it("changes the stated hash when the route's system prompt changes, on the same saved prompt", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const launch = CLAUDE_REVIEWER_ROUTE.launch;
    const spy = vi.spyOn(CLAUDE_REVIEWER_ROUTE, "launch").mockImplementation((reviewer, schemaPath) => {
      const real = launch(reviewer, schemaPath);
      return { ...real, args: real.args.map((arg) => arg === CLAUDE_REVIEWER_ROUTE.systemPrompt ? "A changed system prompt." : arg) };
    });
    try {
      const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), runs: 1, prompt: "saved" }, { selectReviewer: () => claudeReviewer(), runCommand: answering([]) });
      expect(report.runs[0].systemPromptSha256).toBe(sha256("A changed system prompt."));
      expect(report.prompt.savedComparison?.identical).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("stops before any reviewer runs when the launch names no system prompt", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const seen: Array<{ args: string[] }> = [];
    const spy = vi.spyOn(CLAUDE_REVIEWER_ROUTE, "launch").mockReturnValue({ command: "claude", args: ["--print"] });
    try {
      const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), runs: 1, prompt: "saved" }, { selectReviewer: () => claudeReviewer(), runCommand: answering(seen) });
      expect(report.stopped?.reason).toBe("preflight");
      expect(report.stopped?.message).toContain("--system-prompt");
      expect(seen.some((call) => call.args.includes("--print"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("says a saved prompt runs under this checkout's system prompt, and never labels another source that way", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const select = { selectReviewer: () => claudeReviewer() };
    const base = { attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), promptOnly: true };
    const saved = renderReplayReport(runReviewerReplay({ ...base, prompt: "saved" }, select)).join("\n");
    expect(saved).toContain("prompt: saved user message, under this checkout's system prompt (not the attempt's)");
    expect(saved).toContain("a saved attempt records neither the one it ran under nor its hash");
    const rebuilt = renderReplayReport(runReviewerReplay({ ...base, prompt: "rebuild" }, select)).join("\n");
    expect(rebuilt).toContain("prompt: rebuild,");
    expect(rebuilt).toContain("system prompt: this checkout's");
  });

  it("states the hash on a report that stopped before any run", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const report = runReviewerReplay({ attempt, workspace, repositoryPath: repository, scratchParent: path.join(root, "scratch"), prompt: "saved" }, { selectReviewer: () => claudeReviewer({ bindingId: "claude-planning" }) });
    expect(report.stopped?.reason).toBe("binding");
    expect(renderReplayReport(report).join("\n")).toContain(`sha256 ${sha256(CLAUDE_REVIEWER_ROUTE.systemPrompt)}`);
  });

  it("names both limits in what every report repeats", () => {
    const limits = REPLAY_FIDELITY_LIMITS.join("\n");
    expect(limits).toContain("system prompt is this checkout's on every run");
    expect(limits).toContain("classifyReviewerVariance");
  });
});

describe("the command line", () => {
  it("parses its flags and refuses unknown ones", () => {
    const parsed = parseReplayArguments(["--attempt", "a", "--prompt", "saved", "--runs", "5", "--timeout-minutes", "2", "--prompt-only", "--json"], "/repo");
    expect(parsed?.json).toBe(true);
    expect(parsed?.options).toMatchObject({ attempt: "a", prompt: "saved", runs: 5, timeoutMs: 120_000, promptOnly: true, repositoryPath: "/repo" });
    expect(parseReplayArguments(["--help"], "/repo")).toBeNull();
    expect(() => parseReplayArguments(["--paid-fallback"], "/repo")).toThrow("Unknown argument");
    expect(() => parseReplayArguments(["--prompt", "other"], "/repo")).toThrow("saved, rebuild or rebuild-plan");
    expect(() => parseReplayArguments(["--attempt"], "/repo")).toThrow("needs a value");
  });

  it("runs end to end from the script, selecting the binding from real workspace config", () => {
    const { attempt, repository } = createAttempt("qa");
    const workspace = createReadyWorkspace();
    const adaptersPath = path.join(workspace, "config", "provider-adapters.json");
    const adapters = JSON.parse(readFileSync(adaptersPath, "utf8")) as { bindings: Array<Record<string, unknown>> };
    const claude = adapters.bindings.find((binding) => binding.provider === "claude-code-cli")!;
    adapters.bindings.push({ ...claude, id: "claude-review", agentProfiles: ["claude_planning"], model: "opus", costRank: 0, reviewOnly: true });
    writeFileSync(adaptersPath, JSON.stringify(adapters));
    installGuardedClaude("pass");
    const scratch = path.join(root, "scratch");
    const script = path.resolve(import.meta.dirname, "../scripts/reviewer-replay.ts");
    const run = spawnSync(process.execPath, ["--import", "tsx", script, "--attempt", attempt, "--workspace", workspace, "--repo", repository, "--scratch", scratch, "--prompt", "saved", "--runs", "1"], {
      cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", env: { ...process.env, ARCADIA_WORKSPACE: workspace }
    });
    expect(run.stderr).not.toContain("STOPPED");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("binding claude-review, model opus");
    expect(run.stdout).toContain("passes: 1 of 1");
    const bad = spawnSync(process.execPath, ["--import", "tsx", script, "--runs", "1"], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("Usage: pnpm reviewer-replay");
  }, 120_000);
});
