/**
 * Real-reviewer replay: run the real Claude reviewer, offline and repeatedly,
 * against one saved attempt's evidence, so a change to a judgement surface (a
 * reviewer prompt, the QA plan renderer, verdict parsing, a classifier) can be
 * tried without spending a live attempt. `scripts/production-replay.ts
 * --simulate-verdict` stubs the reviewer by construction; this is the opposite
 * half: the real reviewer, and no worker.
 *
 * It uses the real route's own code (CLAUDE_REVIEWER_ROUTE and
 * withClaudeCodeToken): the same binding, launch, no-tools preflight, boundary
 * check, verdict parsing and deterministic gate.
 *
 * It holds no authority. It opens no database, calls no GitHub, and writes only
 * under a new scratch directory outside the workspace. Its result is not a
 * verdict, a receipt or evidence of record, and nothing reads it.
 *
 * What a saved attempt lets it rebuild, and what it cannot, is in
 * REPLAY_FIDELITY_LIMITS; each report repeats it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
// First on purpose: independentReview.js below enters an import cycle through production/tick.ts that only initializes when prReview.js loads ahead of it.
import {
  assemblePrReviewPrompt,
  CLAUDE_REVIEWER_ROUTE,
  runHostCommand,
  type PrReviewRole,
  type QaPrCandidate,
  type QaPrFinding,
  type QaPrReviewDependencies,
  type QaPrVerdict,
  type QaSandboxProof,
  type RawPullRequest
} from "./prReview.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { loadIdentityModelTierRegistry, renderReviewerIdentityBlock } from "../codingAgents/agentIdentity.js";
import { codexReasoningEffort } from "../codingAgents/reasoningEffort.js";
import type { SelectedCodingAgentConfiguration } from "../codingAgents/providerAdapters.js";
import { judgeQaPlanReport } from "../production/independentReview.js";
import { sessionTokensFromLog } from "../production/sessionCapability.js";
import { renderPreservedOperatorQaPlan } from "../sessions/candidatePreservation.js";
import { sessionAgentForProvider, withClaudeCodeToken } from "../sessions/index.js";
import { code, inlineText, renderOperatorQaPlan, type OperatorQaPlanFacts, type OperatorQaPlanResult, type OperatorQaPlanSource } from "../sessions/operatorQaPlan.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export const REVIEWER_REPLAY_SCHEMA = "arcadia-reviewer-replay-v1";
/** The review-only binding the live reviewer runs under. Any other selection stops: this tool never falls back. */
export const REPLAY_REVIEWER_BINDING = "claude-review";
export const DEFAULT_REPLAY_RUNS = 3;
export const MAX_REPLAY_RUNS = 20;
/** A real review has taken about 80 seconds; the live route allows 30 minutes, the most a replay may ask for. */
export const DEFAULT_REPLAY_TIMEOUT_MS = 10 * 60_000;
export const MAX_REPLAY_TIMEOUT_MS = 30 * 60_000;
const AUTH_PROBE_TIMEOUT_MS = 15_000;
/** Claude Code's auth methods that spend a subscription: a stored login, or the setup-token route `withClaudeCodeToken` reads. */
const SUBSCRIPTION_AUTH_METHODS = new Set(["claude.ai", "oauth_token"]);
const CLAUDE_PROVIDER = "claude-code-cli";
/** The renderer's last line, on its own: quoted criterion text is always inside a longer line. */
const PLAN_LAST_LINE = /^Merge, deployment and publication remain separate operator gates\.$/m;
const RENDERER_TRUNCATION_MARK = "… (truncated;";

/** Printed with every report, so a table is never read as more than it is. */
export const REPLAY_FIDELITY_LIMITS: readonly string[] = [
  "No live read: the PR body, CI results and merge state are the saved snapshot, so the stale-evidence gate cannot fire.",
  "Not run: lineage, the production-On check, attempt limits, and everything after the verdict (persistence, repair, integration).",
  "Reused verbatim, not rebuilt, because they need the database or host receipts: completionExecutionEvidence and the body's Validation evidence section.",
  "Read back from the saved prompt, so this checkout's settlement code is not re-run: the settlement records and the preserved commit.",
  "Plan inputs are read back from the rendered plan (whitespace collapsed); a truncated criterion or command refuses unless --plan-source supplies it.",
  "Declared commits come from local Git, not GitHub, and only for a not-applicable claim.",
  "Not run: classifyReviewerVariance, which the live route runs on the verdict and gate, so no table shows a variance reason: a needs-follow-up row here may be one the live route records as reviewer variance.",
  "The system prompt is this checkout's on every run, --prompt saved included: a saved attempt records neither it nor its hash, so a saved run is the old user message under today's system prompt, not the old reviewer. Each run states the sha256; compare tables as old and new only where it matches, or run each side from its own checkout.",
  "The model and CLI are today's: the `opus` alias and Claude Code may have moved since the attempt ran, and the working directory differs.",
  "The reviewer varies run to run: compare distributions across runs, never one run against one run."
];

export type ReplayPromptSource = "saved" | "rebuild" | "rebuild-plan";

export interface ReplaySubstitution {
  find: string;
  replace: string;
  /** How many occurrences must exist; a different count refuses. Defaults to 1. */
  count?: number;
}

export interface ReviewerReplayOptions {
  /** A saved attempt directory, or a fixture file; exactly one. */
  attempt?: string;
  fixture?: string;
  /** Which prompt to judge with; `promptFile` overrides it. Defaults to `rebuild-plan`. */
  prompt?: ReplayPromptSource;
  promptFile?: string;
  planSource?: OperatorQaPlanSource;
  substitutions?: readonly ReplaySubstitution[];
  role?: PrReviewRole;
  runs?: number;
  timeoutMs?: number;
  /** Parent of the new scratch directory; defaults to the system temporary directory. */
  scratchParent?: string;
  workspace?: string;
  /** Where the plan renderer reads Git facts; only read. */
  repositoryPath: string;
  label?: string;
  /** Build and report the prompt only: no `claude` process of any kind. */
  promptOnly?: boolean;
}

export interface ReviewerReplayDependencies {
  runCommand?: NonNullable<QaPrReviewDependencies["runCommand"]>;
  selectReviewer?: (workspace: string) => SelectedCodingAgentConfiguration;
  now?: () => Date;
}

export type ReplayStopReason = "workspace" | "binding" | "preflight" | "auth" | "unavailable";

export interface ReplayRunResult {
  run: number;
  verdict: QaPrVerdict;
  pass: boolean;
  /** Of the `--system-prompt` this run's launch actually passed. */
  systemPromptSha256: string;
  modelVerdict: QaPrVerdict;
  gateVerdict: QaPrVerdict | "pass";
  gateReasons: string[];
  failedChecks: Array<{ name: string; status: string }>;
  findings: Array<{ severity: QaPrFinding["severity"]; title: string }>;
  residualRisks: string[];
  summary: string;
  /** The report half of the worker's Decision 0169 waiver: its database half (gate list, plan refusal) is not replayed. Null when it does not apply. */
  planWaiver: { eligible: boolean; detail: string } | null;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number } | null;
  elapsedMs: number;
  directory: string;
}

export interface ReviewerReplayReport {
  schema: typeof REVIEWER_REPLAY_SCHEMA;
  /** What this file is: never a verdict, a receipt or evidence of record. */
  authority: "none";
  evidence: { kind: "attempt" | "fixture"; path: string; role: PrReviewRole; pullRequest: string; head: string; original: { verdict: string | null; findings: string[] } | null };
  prompt: {
    source: ReplayPromptSource | "file";
    sha256: string;
    bytes: number;
    /** Against the saved prompt; null when none is saved. */
    savedComparison: PromptComparison | null;
    planRebuild: { identicalToSaved: boolean; savedPath: string; rebuiltPath: string } | null;
    substitutions: Array<{ find: string; replace: string; occurrences: number }>;
    path: string;
  };
  reviewer: { bindingId: string; provider: string; model: string; effort: string; authMethod: string | null } | null;
  /** Always this checkout's: a saved attempt records neither the system prompt it ran under nor a hash of it. */
  systemPrompt: { source: "this-checkout"; sha256: string; bytes: number };
  scratch: string;
  runsRequested: number;
  runs: ReplayRunResult[];
  stopped: { reason: ReplayStopReason; message: string } | null;
  fidelityLimits: readonly string[];
}

export interface PromptComparison {
  identical: boolean;
  savedBytes: number;
  /** First differing line (1-based) and the text around the first difference; null when identical. */
  firstDifferenceLine: number | null;
  savedContext: string | null;
  promptContext: string | null;
}

/** Bad input: exit 2. Nothing ran. */
export class ReplayInputError extends Error {}

class ReplayStop extends Error {
  public constructor(public readonly reason: ReplayStopReason, message: string) {
    super(message);
  }
}

interface ReplayEvidence {
  kind: "attempt" | "fixture";
  path: string;
  role: PrReviewRole;
  candidate: QaPrCandidate;
  pullRequest: RawPullRequest;
  patch: string;
  savedPrompt: string | null;
  savedSchema: string | null;
  savedSandboxProof: QaSandboxProof | null;
  identity: string[] | null;
  /** A fixture's own; an attempt's are read from its saved prompt only when rebuilding. */
  settlementRecords: readonly string[];
  settled: { preservedCommit: string; head: string } | undefined;
  /** The Git-free plan inputs a fixture carries. */
  plan: { source: OperatorQaPlanSource; facts: OperatorQaPlanFacts } | null;
  fingerprint: string;
  actionKey: string;
  original: { verdict: string | null; findings: string[] } | null;
}

export function runReviewerReplay(options: ReviewerReplayOptions, dependencies: ReviewerReplayDependencies = {}): ReviewerReplayReport {
  const runs = options.runs ?? DEFAULT_REPLAY_RUNS;
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_REPLAY_RUNS) throw new ReplayInputError(`--runs must be a whole number from 1 to ${MAX_REPLAY_RUNS}.`);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_REPLAY_TIMEOUT_MS) throw new ReplayInputError(`The per-run time limit must be above zero and at most ${MAX_REPLAY_TIMEOUT_MS / 60_000} minutes.`);
  const evidence = loadReplayEvidence(options);
  const source = options.promptFile ? "file" as const : options.prompt ?? "rebuild-plan";
  if (source === "saved" && evidence.savedPrompt === null) throw new ReplayInputError("--prompt saved needs a saved attempt: a fixture carries inputs, not the prompt that was judged.");
  const runCommand = dependencies.runCommand ?? runHostCommand;
  const now = dependencies.now ?? (() => new Date());

  // Resolved before scratch exists, so a refused location leaves nothing behind.
  let workspacePath: string;
  try {
    workspacePath = resolveReadyWorkspace(options.workspace).workspacePath;
  } catch (error) {
    throw new ReplayStop("workspace", `No ready Arcadia workspace: ${messageOf(error)}`);
  }
  const scratch = createScratch(options, evidence, workspacePath);
  const report: ReviewerReplayReport = {
    schema: REVIEWER_REPLAY_SCHEMA,
    authority: "none",
    evidence: { kind: evidence.kind, path: evidence.path, role: evidence.role, pullRequest: `${evidence.candidate.repository}#${evidence.candidate.number}`, head: evidence.candidate.headSha, original: evidence.original },
    prompt: { source, sha256: "", bytes: 0, savedComparison: null, planRebuild: null, substitutions: [], path: "" },
    reviewer: null,
    systemPrompt: { source: "this-checkout", sha256: sha256Of(CLAUDE_REVIEWER_ROUTE.systemPrompt), bytes: Buffer.byteLength(CLAUDE_REVIEWER_ROUTE.systemPrompt) },
    scratch,
    runsRequested: runs,
    runs: [],
    stopped: null,
    fidelityLimits: REPLAY_FIDELITY_LIMITS
  };

  try {
    const reviewer = selectReplayReviewer(workspacePath, dependencies);
    report.reviewer = { bindingId: reviewer.bindingId, provider: reviewer.provider, model: reviewer.model, effort: codexReasoningEffort(reviewer.effort), authMethod: null };
    let sandboxProof = evidence.savedSandboxProof;
    if (!options.promptOnly) {
      sandboxProof = CLAUDE_REVIEWER_ROUTE.preflight({ command: reviewer.profile.command, attemptRoot: scratch, runCommand });
      writeFileSync(path.join(scratch, "sandbox-proof.txt"), `${sandboxProof.output}\n`, "utf8");
      if (!sandboxProof.passed) {
        throw new ReplayStop("preflight", `The real reviewer's no-tools preflight failed, so no reviewer ran.\n${sandboxProof.error ? `${sandboxProof.error}\n` : ""}${sandboxProof.output}`);
      }
      report.reviewer.authMethod = proveSubscriptionAuth(reviewer, workspacePath, scratch, runCommand);
    }

    const built = buildReplayPrompt({ options, evidence, source, reviewer, workspacePath, sandboxProof, scratch });
    const substituted = applySubstitutions(built.prompt, options.substitutions ?? []);
    const prompt = substituted.prompt;
    const promptPath = path.join(scratch, "prompt.md");
    writeFileSync(promptPath, prompt, "utf8");
    if (substituted.applied.length > 0) writeFileSync(path.join(scratch, "substitutions.json"), `${JSON.stringify(substituted.applied, null, 2)}\n`, "utf8");
    report.prompt = {
      source,
      sha256: sha256Of(prompt),
      bytes: Buffer.byteLength(prompt),
      savedComparison: evidence.savedPrompt === null ? null : comparePrompts(evidence.savedPrompt, prompt),
      planRebuild: built.planRebuild,
      substitutions: substituted.applied,
      path: promptPath
    };
    if (options.promptOnly) return finish(report);

    const schemaPath = path.join(scratch, "verdict-schema.json");
    writeFileSync(schemaPath, source === "saved" && evidence.savedSchema !== null
      ? evidence.savedSchema
      : `${JSON.stringify(CLAUDE_REVIEWER_ROUTE.schema(CLAUDE_REVIEWER_ROUTE.roles[evidence.role]), null, 2)}\n`, "utf8");

    for (let run = 1; run <= runs; run += 1) {
      report.runs.push(runOnce({ run, evidence, reviewer, workspacePath, scratch, schemaPath, prompt, sandboxProof: sandboxProof!, timeoutMs, runCommand, repositoryPath: options.repositoryPath, now }));
    }
    return finish(report);
  } catch (error) {
    if (!(error instanceof ReplayStop)) throw error;
    report.stopped = { reason: error.reason, message: error.message };
    return finish(report);
  }
}

function finish(report: ReviewerReplayReport): ReviewerReplayReport {
  writeFileSync(path.join(report.scratch, "replay-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

/** 0: every run passed (or only the prompt was built). 1: a run did not pass. 3: stopped, so the runs are incomplete. */
export function replayExitCode(report: ReviewerReplayReport): number {
  if (report.stopped) return 3;
  return report.runs.every((run) => run.pass) ? 0 : 1;
}

/**
 * The real route's selection, minus its availability observation, which writes
 * a telemetry cache: a limited account surfaces here as the run's own failure.
 * Anything other than the review-only Claude binding stops, so no other model
 * or provider ever stands in.
 */
function selectReplayReviewer(workspacePath: string, dependencies: ReviewerReplayDependencies): SelectedCodingAgentConfiguration {
  let reviewer: SelectedCodingAgentConfiguration;
  try {
    reviewer = dependencies.selectReviewer
      ? dependencies.selectReviewer(workspacePath)
      : CLAUDE_REVIEWER_ROUTE.select(workspacePath, undefined, { generatedAt: new Date().toISOString(), agents: [] });
  } catch (error) {
    throw new ReplayStop("binding", `The workspace has no usable reviewer binding: ${messageOf(error)}`);
  }
  if (reviewer.bindingId !== REPLAY_REVIEWER_BINDING || reviewer.provider !== CLAUDE_PROVIDER || CLAUDE_REVIEWER_ROUTE.kind(reviewer) !== "claude") {
    throw new ReplayStop("binding", `The workspace selects reviewer binding ${reviewer.bindingId} (${reviewer.provider}, sandbox ${reviewer.profile.sandbox}), not the read-only Claude binding ${REPLAY_REVIEWER_BINDING}. This tool runs only that binding and does not fall back to another; restore it in the workspace's provider-adapters.json.`);
  }
  return reviewer;
}

/**
 * Before any spend: `claude auth status` must name a subscription login. Only
 * these three fields are read; the rest of its output (account details) is never
 * kept or printed. The token route is the real one, so no credential is read here.
 */
function proveSubscriptionAuth(
  reviewer: SelectedCodingAgentConfiguration,
  workspacePath: string,
  scratch: string,
  runCommand: NonNullable<ReviewerReplayDependencies["runCommand"]>
): string {
  let launch: { command: string; args: string[] };
  try {
    launch = withClaudeCodeToken({ command: reviewer.profile.command, args: ["auth", "status", "--json"] }, workspacePath);
  } catch (error) {
    throw new ReplayStop("auth", messageOf(error));
  }
  const result = runCommand({ ...launch, cwd: scratch, timeoutMs: AUTH_PROBE_TIMEOUT_MS, environment: CLAUDE_REVIEWER_ROUTE.environment() });
  let status: { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown };
  try {
    status = JSON.parse(result.stdout) as typeof status;
  } catch {
    throw new ReplayStop("auth", `Could not read \`claude auth status --json\` (exit ${String(result.status)}), so subscription sign-in is unproven and no reviewer ran.`);
  }
  if (status.loggedIn !== true) throw new ReplayStop("auth", "Claude Code is not signed in, and no reviewer ran. Sign in with `claude auth login`; this tool never uses an API key.");
  const method = typeof status.authMethod === "string" ? status.authMethod : "unknown";
  const provider = typeof status.apiProvider === "string" ? status.apiProvider : "unknown";
  if (!SUBSCRIPTION_AUTH_METHODS.has(method) || provider !== "firstParty") {
    throw new ReplayStop("auth", `Claude Code's sign-in is not a subscription (auth method ${method}, provider ${provider}), so no reviewer ran. This tool never runs on paid API usage or another provider.`);
  }
  return method;
}

function runOnce(input: {
  run: number;
  evidence: ReplayEvidence;
  reviewer: SelectedCodingAgentConfiguration;
  workspacePath: string;
  scratch: string;
  schemaPath: string;
  prompt: string;
  sandboxProof: QaSandboxProof;
  timeoutMs: number;
  runCommand: NonNullable<ReviewerReplayDependencies["runCommand"]>;
  repositoryPath: string;
  now: () => Date;
}): ReplayRunResult {
  const { evidence, reviewer, sandboxProof, runCommand } = input;
  const directory = path.join(input.scratch, `run-${input.run}`);
  mkdirSync(directory);
  const modelOutputPath = path.join(directory, "model-verdict.json");
  const profile = CLAUDE_REVIEWER_ROUTE.roles[evidence.role];
  const launch = CLAUDE_REVIEWER_ROUTE.launch(reviewer, input.schemaPath);
  const systemPromptFlag = launch.args.indexOf("--system-prompt");
  if (systemPromptFlag < 0) throw new ReplayStop("preflight", "The real route's launch names no --system-prompt, so what the reviewer would run under cannot be stated, and no reviewer ran.");
  const systemPromptSha256 = sha256Of(launch.args[systemPromptFlag + 1]);
  const startedAt = performance.now();
  const raw = runCommand({
    ...withClaudeCodeToken(launch, input.workspacePath),
    cwd: directory,
    stdin: input.prompt,
    timeoutMs: input.timeoutMs,
    environment: CLAUDE_REVIEWER_ROUTE.environment()
  });
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  const eventLog = [raw.stdout, raw.stderr].filter(Boolean).join("\n");
  writeFileSync(path.join(directory, "reviewer-events.jsonl"), eventLog, "utf8");
  const keySource = reportedApiKeySource(raw.stdout);
  if (keySource !== null && keySource !== "none") {
    throw new ReplayStop("auth", `Run ${input.run} reported API key source ${keySource}, not a subscription login. Its verdict is discarded and the remaining runs did not start.`);
  }
  const reviewRun = CLAUDE_REVIEWER_ROUTE.record(raw, modelOutputPath);
  if (reviewRun.status === 0 && keySource === null) {
    throw new ReplayStop("auth", `Run ${input.run} did not report its API key source, so subscription sign-in is unproven. Its verdict is discarded and the remaining runs did not start.`);
  }
  const parsed = CLAUDE_REVIEWER_ROUTE.parse(reviewRun, modelOutputPath, profile);
  const pullRequest = evidence.pullRequest;
  const gate = CLAUDE_REVIEWER_ROUTE.gate(pullRequest, evidence.fingerprint, pullRequest, evidence.fingerprint, parsed.verdict, reviewRun, sandboxProof, {
    profile,
    patch: evidence.patch,
    declaredCommits: profile.allowsNotApplicable && parsed.verdict.checks.some((check) => check.status === "not-applicable")
      ? localPullRequestCommits(input.repositoryPath, pullRequest, runCommand)
      : undefined
  });
  const verdict = CLAUDE_REVIEWER_ROUTE.combine(parsed.verdict, gate);
  const unavailable = verdict === "pass"
    ? null
    : CLAUDE_REVIEWER_ROUTE.unavailability({ sandboxProof, reviewRun, modelError: parsed.error, deterministicFindings: gate.findings });
  if (unavailable !== null) {
    const timedOut = /ETIMEDOUT/.test(raw.error ?? "");
    throw new ReplayStop("unavailable", `${timedOut ? `Run ${input.run} hit the ${Math.round(input.timeoutMs / 1000)}-second limit. ` : `Run ${input.run}: `}${unavailable}\nNo fallback was tried, and the remaining runs did not start. The events are in ${directory}.`);
  }
  const findings = [...gate.findings, ...parsed.verdict.findings];
  const checks = [...gate.checks, ...parsed.verdict.checks];
  const residualRisks = [...new Set([...gate.residualRisks, ...parsed.verdict.residualRisks])];
  const summary = CLAUDE_REVIEWER_ROUTE.summary(verdict, parsed.verdict.summary, gate.reasons);
  const result: ReplayRunResult = {
    run: input.run,
    verdict,
    pass: verdict === "pass",
    systemPromptSha256,
    modelVerdict: parsed.verdict.verdict,
    gateVerdict: gate.gate ?? "pass",
    gateReasons: gate.reasons,
    failedChecks: checks.filter((check) => check.status !== "pass" && check.status !== "not-applicable").map((check) => ({ name: check.name, status: check.status })),
    findings: findings.map((finding) => ({ severity: finding.severity, title: finding.title })),
    residualRisks,
    summary,
    planWaiver: planWaiver({ evidence, verdict, gate, findings, checks, residualRisks, summary, now: input.now() }),
    usage: sessionTokensFromLog(eventLog),
    elapsedMs,
    directory
  };
  writeFileSync(path.join(directory, "replay-run.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

/** The init event's `apiKeySource` ("none" is a subscription login); null when no init event reports one. */
function reportedApiKeySource(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "system" && event.subtype === "init") return typeof event.apiKeySource === "string" ? event.apiKeySource : null;
    } catch { /* a partial line is not an event */ }
  }
  return null;
}

/** `gh pr view --json commits` is GitHub's; base..head is the same set from local objects, merges included. Unreadable is null, which refuses the claim. */
function localPullRequestCommits(repositoryPath: string, pullRequest: RawPullRequest, runCommand: NonNullable<ReviewerReplayDependencies["runCommand"]>): string[] | null {
  const result = runCommand({ command: "git", args: ["rev-list", "--reverse", `${pullRequest.baseRefOid}..${pullRequest.headRefOid}`], cwd: repositoryPath, timeoutMs: 30_000 });
  if (result.status !== 0) return null;
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function planWaiver(input: {
  evidence: ReplayEvidence;
  verdict: QaPrVerdict;
  gate: ReturnType<typeof CLAUDE_REVIEWER_ROUTE.gate>;
  findings: QaPrFinding[];
  checks: unknown[];
  residualRisks: string[];
  summary: string;
  now: Date;
}): ReplayRunResult["planWaiver"] {
  if (input.evidence.role !== "qa" || input.verdict !== "fail") return null;
  const judged = judgeQaPlanReport({
    role: "qa",
    verdict: input.verdict,
    summary: input.summary,
    candidate: input.evidence.candidate,
    findings: input.findings,
    checks: input.checks,
    residualRisks: input.residualRisks,
    effectiveness: { deterministicGateVerdict: input.gate.gate ?? "pass", deterministicGateReasons: input.gate.reasons }
  }, { head: input.evidence.candidate.headSha, actionKey: input.evidence.actionKey, requestId: "reviewer-replay", at: input.now.toISOString() });
  return judged.ok ? { eligible: true, detail: `one plan step: ${judged.failure.step}` } : { eligible: false, detail: judged.reason };
}

function buildReplayPrompt(input: {
  options: ReviewerReplayOptions;
  evidence: ReplayEvidence;
  source: ReplayPromptSource | "file";
  reviewer: SelectedCodingAgentConfiguration;
  workspacePath: string;
  sandboxProof: QaSandboxProof | null;
  scratch: string;
}): { prompt: string; planRebuild: ReviewerReplayReport["prompt"]["planRebuild"] } {
  const { options, evidence, source, reviewer } = input;
  if (source === "file") return { prompt: readInput(options.promptFile!, "--prompt-file"), planRebuild: null };
  if (source === "saved") return { prompt: evidence.savedPrompt!, planRebuild: null };
  if (!input.sandboxProof) throw new ReplayInputError("--prompt-only on this evidence has no saved sandbox-proof.txt to build the prompt with.");
  const plan = source === "rebuild-plan" ? rebuildPlanBody(options, evidence, input.scratch) : null;
  const scope = evidence.kind === "attempt" ? readScopeSection(evidence.savedPrompt, evidence.pullRequest) : { records: evidence.settlementRecords, settled: evidence.settled };
  const prompt = assemblePrReviewPrompt({
    role: evidence.role,
    candidate: evidence.candidate,
    pullRequest: plan ? { ...evidence.pullRequest, body: plan.body } : evidence.pullRequest,
    patch: evidence.patch,
    sandboxProof: input.sandboxProof,
    identity: evidence.identity ?? renderReviewerIdentityBlock({
      agent: sessionAgentForProvider(reviewer.provider) ?? reviewer.provider,
      model: reviewer.model,
      effort: reviewer.effort,
      registry: loadIdentityModelTierRegistry(input.workspacePath)
    }),
    settlementRecords: scope.records,
    settled: scope.settled
  });
  return { prompt, planRebuild: plan?.report ?? null };
}

/** This checkout's plan renderer, on the saved attempt's inputs; the body's other sections stay as saved. */
function rebuildPlanBody(options: ReviewerReplayOptions, evidence: ReplayEvidence, scratch: string): { body: string; report: NonNullable<ReviewerReplayReport["prompt"]["planRebuild"]> } {
  const body = evidence.pullRequest.body ?? "";
  const { plan: savedPlan, tail } = splitPullRequestBody(body);
  let rendered: OperatorQaPlanResult;
  if (evidence.plan) {
    rendered = renderOperatorQaPlan(options.planSource ?? evidence.plan.source, evidence.plan.facts);
  } else {
    const parsed = parseRenderedOperatorQaPlan(savedPlan, options.planSource);
    rendered = renderPreservedOperatorQaPlan(parsed.source, { repositoryPath: options.repositoryPath, ...parsed.facts });
  }
  if (rendered.status !== "rendered") {
    throw new ReplayInputError(`This checkout's plan renderer refused the saved attempt's inputs: ${rendered.reason} The commit may need fetching into ${options.repositoryPath}; otherwise use --prompt saved or --prompt rebuild.`);
  }
  const savedPath = path.join(scratch, "plan-saved.md");
  const rebuiltPath = path.join(scratch, "plan-rebuilt.md");
  writeFileSync(savedPath, `${savedPlan}\n`, "utf8");
  writeFileSync(rebuiltPath, `${rendered.body}\n`, "utf8");
  return { body: `${rendered.body}${tail}`, report: { identicalToSaved: rendered.body === savedPlan, savedPath, rebuiltPath } };
}

/** The plan is the body's first part; what follows it needs host receipts to rebuild, so it stays verbatim. */
export function splitPullRequestBody(body: string): { plan: string; tail: string } {
  const lastLine = PLAN_LAST_LINE.exec(body);
  const next = /\n\n### (?:Completion execution evidence|Validation evidence)$/m.exec(body);
  const cut = lastLine ? lastLine.index + lastLine[0].length : next?.index;
  if (cut === undefined || !body.startsWith("## Operator QA plan")) {
    throw new ReplayInputError("The saved pull-request body has no rendered Operator QA plan to rebuild. Use --prompt saved or --prompt rebuild.");
  }
  return { plan: body.slice(0, cut), tail: body.slice(cut) };
}

/**
 * The plan renderer's inputs, read back out of its own output. Every value is
 * checked by re-escaping it to the exact saved text, so a plan this cannot read
 * faithfully refuses rather than rendering from a guess. Truncated values were
 * lost at render time: only `planSource` can supply them.
 */
export function parseRenderedOperatorQaPlan(plan: string, planSource?: OperatorQaPlanSource): {
  source: OperatorQaPlanSource;
  facts: { branch: string; baseBranch: string; baseRevision: string; commitSha: string };
} {
  const refuse = (what: string): never => {
    throw new ReplayInputError(`Cannot rebuild the Operator QA plan from what was saved: ${what}. Pass --plan-source <json> with the Action's governed inputs, or use --prompt rebuild to keep the saved plan text.`);
  };
  const line = (pattern: RegExp, what: string): RegExpExecArray => pattern.exec(plan) ?? refuse(`no ${what} line`);
  const span = (text: string, what: string): string => {
    const spans = readCodeSpans(text);
    return spans?.length === 1 ? spans[0] : refuse(`unreadable ${what}`);
  };
  const candidate = line(/^- \*\*Candidate:\*\* branch (.+) at commit (.+)$/m, "Candidate");
  const base = line(/^- \*\*Base:\*\* (.+) at (.+)$/m, "Base");
  const facts = {
    branch: span(candidate[1], "branch"),
    commitSha: span(candidate[2], "commit"),
    baseBranch: span(base[1], "base branch"),
    baseRevision: span(base[2], "base revision")
  };
  if (planSource) return { source: planSource, facts };

  const action = line(/^- \*\*Action:\*\* (`+[^`]+`+)(?: — (.*))?$/m, "Action");
  const actionKey = span(action[1], "Action key");
  const actionTitle = action[2] === undefined ? null : unescapeInline(action[2]) ?? refuse("an Action title that does not round-trip");

  const acceptanceCriteria: string[] = [];
  const sections = plan.split(/^(?=### Step )/m).slice(1);
  for (const section of sections) {
    const heading = /^### Step \d+ — Acceptance criterion (\d+) of (\d+)$/m.exec(section);
    if (!heading) continue;
    if (Number(heading[1]) !== acceptanceCriteria.length + 1) refuse(`criterion ${heading[1]} is out of order`);
    const quoted = /^- \*\*Expected:\*\* .*exactly as worded: “(.*)”$/m.exec(section);
    if (!quoted) refuse(`criterion ${heading[1]} has no quoted text`);
    if (quoted![1].includes(RENDERER_TRUNCATION_MARK)) refuse(`criterion ${heading[1]} was truncated when the plan was rendered`);
    acceptanceCriteria.push(unescapeInline(quoted![1]) ?? refuse(`criterion ${heading[1]} does not round-trip`));
  }
  if (acceptanceCriteria.length === 0) refuse("no acceptance criterion steps");

  const validation = sections.find((section) => /^### Step \d+ — Run the Project's declared validation$/m.test(section)) ?? refuse("no declared-validation step");
  const doLine = /^- \*\*Do:\*\* (.*)$/m.exec(validation) ?? refuse("no declared-validation command line");
  let validationCommands: string[] = [];
  if (!doLine[1].startsWith("nothing further")) {
    if (doLine[1].includes(RENDERER_TRUNCATION_MARK)) refuse("a declared validation command was truncated when the plan was rendered");
    const commands = /^run (.*)\.$/.exec(doLine[1]) ?? refuse("an unreadable declared-validation line");
    validationCommands = readCodeSpans(commands[1], "; then ") ?? refuse("unreadable declared validation commands");
  }
  return { source: { kind: "action-acceptance", actionKey, actionTitle, acceptanceCriteria, validationCommands }, facts };
}

/** `inlineText` undone, or null when re-escaping the result would not give exactly this text. */
function unescapeInline(text: string): string | null {
  const plain = text.replace(/\\([\\`*_[\]<>|~&])/g, "$1").replace(/@\u200b/g, "@");
  return inlineText(plain) === text ? plain : null;
}

/** The contents of `code()` spans joined by `separator`; null unless re-rendering each gives exactly this text. */
function readCodeSpans(text: string, separator = ""): string[] | null {
  const spans: string[] = [];
  let at = 0;
  while (at < text.length) {
    if (spans.length > 0) {
      if (!separator || !text.startsWith(separator, at)) return null;
      at += separator.length;
    }
    const fence = /^`+/.exec(text.slice(at))?.[0];
    if (!fence) return null;
    const contentStart = at + fence.length;
    let close = contentStart;
    for (;;) {
      close = text.indexOf(fence, close);
      if (close < 0) return null;
      // A closing fence is exactly this long: a longer run of backticks is content.
      if (text[close - 1] !== "`" && text[close + fence.length] !== "`") break;
      close += 1;
    }
    const content = text.slice(contentStart, close);
    const unpadded = content.length >= 2 && content.startsWith(" ") && content.endsWith(" ") ? content.slice(1, -1) : null;
    const rendered = text.slice(at, close + fence.length);
    if (code(content) === rendered) spans.push(content);
    else if (unpadded !== null && code(unpadded) === rendered) spans.push(unpadded);
    else return null;
    at = close + fence.length;
  }
  return spans;
}

/** Explicit, exact, and counted: a find that does not match as declared refuses rather than silently judging the old text. */
export function applySubstitutions(prompt: string, substitutions: readonly ReplaySubstitution[]): { prompt: string; applied: Array<{ find: string; replace: string; occurrences: number }> } {
  const applied: Array<{ find: string; replace: string; occurrences: number }> = [];
  let text = prompt;
  substitutions.forEach((substitution, index) => {
    if (typeof substitution.find !== "string" || !substitution.find || typeof substitution.replace !== "string") {
      throw new ReplayInputError(`Substitution ${index + 1} needs a non-empty find and a replace string.`);
    }
    if (substitution.find === substitution.replace) {
      throw new ReplayInputError(`Substitution ${index + 1} replaces its text with the same text, so it would report a change the prompt does not have. Text: ${JSON.stringify(substitution.find.slice(0, 120))}`);
    }
    const occurrences = text.split(substitution.find).length - 1;
    const expected = substitution.count ?? 1;
    if (occurrences !== expected) {
      throw new ReplayInputError(`Substitution ${index + 1} expected ${expected} occurrence(s) and found ${occurrences}. Pull-request text sits JSON-encoded in the prompt, so match it as it appears there. Text: ${JSON.stringify(substitution.find.slice(0, 120))}`);
    }
    text = text.split(substitution.find).join(substitution.replace);
    applied.push({ find: substitution.find, replace: substitution.replace, occurrences });
  });
  return { prompt: text, applied };
}

export function comparePrompts(saved: string, prompt: string): PromptComparison {
  const savedBytes = Buffer.byteLength(saved);
  if (saved === prompt) return { identical: true, savedBytes, firstDifferenceLine: null, savedContext: null, promptContext: null };
  let at = 0;
  while (at < saved.length && at < prompt.length && saved[at] === prompt[at]) at += 1;
  const around = (text: string) => text.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, " ");
  return { identical: false, savedBytes, firstDifferenceLine: saved.slice(0, at).split("\n").length, savedContext: around(saved), promptContext: around(prompt) };
}

function createScratch(options: ReviewerReplayOptions, evidence: ReplayEvidence, workspacePath: string): string {
  const parent = path.resolve(options.scratchParent ?? tmpdir());
  mkdirSync(parent, { recursive: true });
  const real = realpathSync(parent);
  const protectedRoots = [workspacePath, getWorkspacePaths(workspacePath).artifacts, ...(evidence.kind === "attempt" ? [evidence.path] : [])];
  for (const root of protectedRoots) {
    if (!existsSync(root)) continue;
    const protectedRoot = realpathSync(root);
    if (real === protectedRoot || real.startsWith(`${protectedRoot}${path.sep}`)) {
      throw new ReplayInputError(`Scratch must be outside ${protectedRoot}: this tool never writes under the workspace or the saved attempt.`);
    }
  }
  const label = (options.label ?? "").replace(/[^A-Za-z0-9._-]+/g, "-");
  return mkdtempSync(path.join(real, `reviewer-replay-${evidence.candidate.number}-${label ? `${label}-` : ""}`));
}

function loadReplayEvidence(options: ReviewerReplayOptions): ReplayEvidence {
  if (Boolean(options.attempt) === Boolean(options.fixture)) throw new ReplayInputError("Give exactly one of --attempt <saved attempt directory> or --fixture <json>.");
  return options.attempt ? loadSavedAttempt(path.resolve(options.attempt), options.role) : loadFixture(path.resolve(options.fixture!), options.role);
}

function loadSavedAttempt(directory: string, requestedRole?: PrReviewRole): ReplayEvidence {
  const read = (name: string) => readInput(path.join(directory, name), name);
  const optional = (name: string) => existsSync(path.join(directory, name)) ? read(name) : null;
  const metadata = parseJson<{
    candidate?: QaPrCandidate; verdict?: string; patchSha256?: string; initialEvidenceFingerprint?: string;
    sandboxProof?: QaSandboxProof; effectiveness?: { role?: PrReviewRole; projectSlug?: string; actionId?: string };
  }>(read("metadata.json"), "metadata.json");
  const pullRequest = parseJson<RawPullRequest>(read("evidence.json"), "evidence.json");
  const patch = read("candidate.patch");
  const savedPrompt = optional("prompt.md");
  const candidate = metadata.candidate;
  if (!candidate?.headSha) throw new ReplayInputError(`${directory}/metadata.json names no Candidate.`);
  if (pullRequest.headRefOid !== candidate.headSha) throw new ReplayInputError(`${directory}: evidence.json is for head ${pullRequest.headRefOid}, metadata.json for ${candidate.headSha}.`);
  if (metadata.patchSha256 && createHash("sha256").update(patch).digest("hex") !== metadata.patchSha256) {
    throw new ReplayInputError(`${directory}/candidate.patch does not match the sha256 metadata.json recorded.`);
  }
  const role = metadata.effectiveness?.role ?? (savedPrompt?.includes("Exact-Head Code Review") ? "code-review" : "qa");
  if (requestedRole && requestedRole !== role) throw new ReplayInputError(`This attempt's reviewer was ${role}; --role ${requestedRole} would judge its evidence under the other role's criteria.`);
  const savedVerdict = optional("model-verdict.json");
  let findings: string[] = [];
  if (savedVerdict !== null) {
    try {
      findings = ((JSON.parse(savedVerdict) as { findings?: Array<{ title?: string }> }).findings ?? []).map((finding) => String(finding.title));
    } catch { /* the original's findings are only a comparison line */ }
  }
  const slug = metadata.effectiveness?.projectSlug;
  const action = metadata.effectiveness?.actionId;
  return {
    kind: "attempt",
    path: directory,
    role,
    candidate,
    pullRequest,
    patch,
    savedPrompt,
    savedSchema: optional("verdict-schema.json"),
    savedSandboxProof: metadata.sandboxProof ?? null,
    identity: null,
    settlementRecords: [],
    settled: undefined,
    plan: null,
    fingerprint: metadata.initialEvidenceFingerprint ?? "saved-evidence",
    actionKey: slug && action ? `${slug}/${action}` : candidate.headBranch,
    original: { verdict: metadata.verdict ?? null, findings }
  };
}

/** The shape of tests/fixtures/qa-prompt-2062.json: the real inputs of one prompt, plus the plan renderer's own inputs. */
function loadFixture(file: string, requestedRole?: PrReviewRole): ReplayEvidence {
  const text = readInput(file, "--fixture");
  const fixture = parseJson<{
    candidate?: QaPrCandidate; pullRequest?: RawPullRequest; patch?: string; sandboxProof?: QaSandboxProof; identity?: string[];
    settlementRecords?: string[]; settled?: { preservedCommit: string; head: string };
    planSource?: OperatorQaPlanSource; planFacts?: OperatorQaPlanFacts;
  }>(text, "--fixture");
  if (!fixture.candidate?.headSha || !fixture.pullRequest || typeof fixture.patch !== "string" || !fixture.sandboxProof || !Array.isArray(fixture.identity)) {
    throw new ReplayInputError(`${file} needs candidate, pullRequest, patch, sandboxProof and identity.`);
  }
  return {
    kind: "fixture",
    path: file,
    role: requestedRole ?? "qa",
    candidate: fixture.candidate,
    pullRequest: fixture.pullRequest,
    patch: fixture.patch,
    savedPrompt: null,
    savedSchema: null,
    savedSandboxProof: fixture.sandboxProof,
    identity: fixture.identity,
    settlementRecords: fixture.settlementRecords ?? [],
    settled: fixture.settled,
    plan: fixture.planSource && fixture.planFacts ? { source: fixture.planSource, facts: fixture.planFacts } : null,
    fingerprint: createHash("sha256").update(text).digest("hex"),
    actionKey: fixture.planSource?.actionKey ?? fixture.candidate.headBranch,
    original: null
  };
}

/**
 * The settlement inputs, from the prompt the attempt judged. Only the text
 * between the JSON evidence and the patch is read, where the pull request cannot
 * write a line of its own (its body is JSON-encoded onto one line).
 */
function readScopeSection(prompt: string | null, pullRequest: RawPullRequest): { records: string[]; settled: { preservedCommit: string; head: string } | undefined } {
  if (prompt === null) throw new ReplayInputError("This attempt saved no prompt.md, so its settlement inputs are unknown and the prompt cannot be rebuilt honestly. Use --prompt-file.");
  const evidence = JSON.stringify(pullRequest, null, 2);
  const start = prompt.indexOf(evidence);
  if (start < 0) throw new ReplayInputError("The saved prompt does not contain the saved evidence.json, so its settlement inputs cannot be trusted. Use --prompt saved.");
  const from = start + evidence.length;
  const end = prompt.indexOf("\n## Complete patch\n", from);
  if (end < 0) throw new ReplayInputError("The saved prompt has no Complete patch section. Use --prompt saved.");
  const section = prompt.slice(from, end);
  if (!section.includes("## Scope judgement: governed settlement records")) return { records: [], settled: undefined };
  const records = [...section.matchAll(/^- ("(?:[^"\\]|\\.)*")$/gm)]
    .map((match) => parseJson<string>(match[1], "a settlement record"))
    .filter((record) => typeof record === "string");
  if (records.length === 0) throw new ReplayInputError("The saved prompt's Scope judgement section lists no records. Use --prompt saved.");
  const settled = /^The Candidate head ([a-f0-9]{40}) is the Session's preserved commit ([a-f0-9]{40}) plus/m.exec(section);
  return { records, settled: settled ? { head: settled[1], preservedCommit: settled[2] } : undefined };
}

function readInput(file: string, what: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    throw new ReplayInputError(`Cannot read ${what} at ${file}: ${messageOf(error)}`);
  }
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ReplayInputError(`${what} is not valid JSON: ${messageOf(error)}`);
  }
}

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The table. Findings are untrusted model text, so each is cut to one line. */
export function renderReplayReport(report: ReviewerReplayReport): string[] {
  const oneLine = (text: string, max = 110) => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  };
  const lines = [
    "Reviewer replay: no authority. Nothing here is a verdict, a receipt or evidence of record.",
    `evidence: ${report.evidence.pullRequest} head ${report.evidence.head.slice(0, 12)} (${report.evidence.role}, ${report.evidence.kind})`
  ];
  if (report.evidence.original) lines.push(`original attempt: ${report.evidence.original.verdict ?? "unknown"}${report.evidence.original.findings.length ? `; ${report.evidence.original.findings.length} model finding(s)` : ""}`);
  for (const title of report.evidence.original?.findings ?? []) lines.push(`  original finding: ${oneLine(title)}`);
  if (report.reviewer) lines.push(`reviewer: binding ${report.reviewer.bindingId}, model ${report.reviewer.model}, effort ${report.reviewer.effort}${report.reviewer.authMethod ? `, auth ${report.reviewer.authMethod}` : ""}`);
  lines.push(`system prompt: this checkout's, ${report.systemPrompt.bytes} bytes, sha256 ${report.systemPrompt.sha256}; a saved attempt records neither the one it ran under nor its hash`);
  if (report.prompt.sha256) {
    const comparison = report.prompt.savedComparison;
    const promptLabel = report.prompt.source === "saved" ? "saved user message, under this checkout's system prompt (not the attempt's)" : report.prompt.source;
    lines.push(`prompt: ${promptLabel}, ${report.prompt.bytes} bytes, sha256 ${report.prompt.sha256.slice(0, 12)}; ${comparison === null ? "no saved prompt to compare" : comparison.identical ? "identical to the saved prompt" : `differs from the saved prompt from line ${comparison.firstDifferenceLine}`}`);
    if (comparison && !comparison.identical) {
      lines.push(`  saved:   ...${oneLine(comparison.savedContext ?? "", 160)}`, `  this:    ...${oneLine(comparison.promptContext ?? "", 160)}`);
    }
    if (report.prompt.planRebuild) lines.push(`plan: ${report.prompt.planRebuild.identicalToSaved ? "re-rendered, identical to the saved plan" : `re-rendered, changed: diff ${report.prompt.planRebuild.savedPath} ${report.prompt.planRebuild.rebuiltPath}`}`);
    for (const applied of report.prompt.substitutions) lines.push(`substituted ${applied.occurrences}x: ${JSON.stringify(oneLine(applied.find, 60))} -> ${JSON.stringify(oneLine(applied.replace, 60))}`);
    lines.push(`prompt file: ${report.prompt.path}`);
  }
  lines.push(`scratch: ${report.scratch}`, "");
  if (report.runs.length > 0) {
    lines.push("run  pass  verdict          model            sec  system prompt  tokens in/cached/out");
    for (const run of report.runs) {
      const tokens = run.usage ? `${run.usage.inputTokens}/${run.usage.cachedInputTokens}/${run.usage.outputTokens}` : "not reported";
      lines.push(`${String(run.run).padEnd(4)} ${(run.pass ? "yes" : "NO").padEnd(5)} ${run.verdict.padEnd(16)} ${run.modelVerdict.padEnd(16)} ${String(Math.round(run.elapsedMs / 1000)).padEnd(4)} ${run.systemPromptSha256.slice(0, 12).padEnd(14)} ${tokens}`);
      for (const check of run.failedChecks) lines.push(`     failed check: ${check.name} (${check.status})`);
      for (const finding of run.findings) lines.push(`     finding [${finding.severity}]: ${oneLine(finding.title)}`);
      for (const reason of run.gateReasons) lines.push(`     gate: ${oneLine(reason)}`);
      if (run.planWaiver) lines.push(`     plan waiver, report half: ${run.planWaiver.eligible ? "eligible" : "refused"} (${oneLine(run.planWaiver.detail)})`);
    }
    lines.push("", `passes: ${report.runs.filter((run) => run.pass).length} of ${report.runs.length}${report.runs.length < report.runsRequested ? ` (${report.runsRequested} requested)` : ""}`);
  }
  if (report.stopped) lines.push(`STOPPED (${report.stopped.reason}): ${report.stopped.message}`);
  lines.push("", "What a replay does not reproduce:", ...report.fidelityLimits.map((limit) => `- ${limit}`));
  return lines;
}

/** A stop before scratch exists has no report to attach to. */
export function isReplayStop(error: unknown): error is Error & { reason: ReplayStopReason } {
  return error instanceof ReplayStop;
}
