import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ArcadiaJsonSuccess,
  AskResponse,
  DashboardSnapshotResponse,
  FeedbackListResponse,
  FeedbackRecordResponse
} from "./types";
import type {
  MissionControlFits,
  MissionControlNodeDetail,
  MissionControlOverview,
  OrientationEffort,
  TimelineResponse
} from "./mission-control-types";

export type MissionControlOverviewResponse = MissionControlOverview;
export type MissionControlNodeResponse = MissionControlNodeDetail;
export type MissionControlFitsResponse = MissionControlFits;
export interface MissionControlReplyResponse {
  routedTo: "orientation" | "project";
  echo: string;
  confidence: number;
  applied: boolean;
}

const execFileAsync = promisify(execFile);

export async function loadDashboardSnapshot(): Promise<ArcadiaJsonSuccess<DashboardSnapshotResponse>> {
  return runArcadiaCliJson<DashboardSnapshotResponse>(["dashboard", "snapshot"]);
}

export interface DailyAdvantagePreparationResponse {
  plan: { id: string; work_item_id: string; status: string };
  planningDecision: { id: string; slug: string | null; status: string } | null;
  codexInvocation: { id: string; status: string } | null;
  packetArtifact: { id: string; path: string | null } | null;
  reused: boolean;
}

export async function prepareDailyAdvantage(
  actionId: string
): Promise<ArcadiaJsonSuccess<DailyAdvantagePreparationResponse>> {
  return runArcadiaCliJson<DailyAdvantagePreparationResponse>(["work", "plan", actionId]);
}

export interface IntelligenceListJobsResponse {
  jobs: unknown[];
}

export interface IntelligenceUsageResponse {
  summary: unknown;
}

export async function listIntelligenceTestJobs(
  clientApp: string,
  limit = 20
): Promise<ArcadiaJsonSuccess<IntelligenceListJobsResponse>> {
  return runArcadiaCliJson<IntelligenceListJobsResponse>([
    "intelligence",
    "list-jobs",
    "--client-app",
    clientApp,
    "--limit",
    String(limit)
  ]);
}

export async function getIntelligenceUsage(options: { refresh?: boolean } = {}): Promise<ArcadiaJsonSuccess<IntelligenceUsageResponse>> {
  const args = ["intelligence", "usage"];
  if (options.refresh) args.push("--refresh");
  return runArcadiaCliJson<IntelligenceUsageResponse>(args);
}

export async function resolveDashboardWorkspace(): Promise<string> {
  const response = await runArcadiaCliJson<{ workspacePath: string | null }>(["workspace", "resolve"]);
  if (!response.data.workspacePath) {
    throw new ArcadiaCliError("Arcadia workspace is not configured.", 503, response.data);
  }

  return response.data.workspacePath;
}

export async function runAsk(input: {
  request: string;
}): Promise<ArcadiaJsonSuccess<AskResponse>> {
  return runArcadiaCliJson<AskResponse>([
    "ask",
    input.request,
    "--source-ingress",
    "dashboard.ask",
    "--run-safe"
  ]);
}

export async function recordAskFeedback(input: {
  askRequestId: string;
  decision: "up" | "down";
  note?: string;
}): Promise<ArcadiaJsonSuccess<FeedbackRecordResponse>> {
  const args = [
    "feedback",
    "record",
    input.askRequestId,
    "--decision",
    input.decision,
    "--source-ingress",
    "dashboard.feedback"
  ];
  if (input.note) {
    args.push("--note", input.note);
  }
  return runArcadiaCliJson<FeedbackRecordResponse>(args);
}

export async function listAskFeedback(limit = 50): Promise<ArcadiaJsonSuccess<FeedbackListResponse>> {
  return runArcadiaCliJson<FeedbackListResponse>(["feedback", "list", "--limit", String(limit)]);
}

export interface ReviewExecutionResponse {
  executor: string;
  followUpReviewItemId: string;
  followUpReviewSlug: string;
  exitStatus: number | null;
  changedFiles: string[];
  validation: Array<{ command: string; exitStatus: number | null; error: string | null }>;
  finalOutput: string | null;
}

export interface ReviewActionResponse {
  item: {
    id: string;
    slug: string;
  };
  result: {
    status: "approved" | "rejected" | "deferred" | "pending_execution";
    summary: string;
  };
  approval: unknown | null;
  execution: ReviewExecutionResponse | null;
  run: { id: string } | null;
}

export interface ExecutionContextJson {
  originalReviewId?: string;
  runId?: string;
  executor?: string;
  repoPath?: string;
  exitStatus?: number | null;
  changedFiles?: string[];
  validation?: Array<{ command: string; exitStatus: number | null; error: string | null }>;
  finalOutput?: string | null;
  artifactPaths?: string[];
}

export interface FollowUpReview {
  id: string;
  slug: string;
  resolvedIntent: string;
  decisionNeeded: string;
  proposedAction: string;
  recommendation: string | null;
  contextJson: string | null;
  status: string;
}

export interface RunShowResponse {
  run: {
    id: string;
    status: string;
    summary: string;
    executor_name: string | null;
    review_item_id: string | null;
    work_item_title: string;
    project_name: string | null;
    created_at: string;
    updated_at: string;
    pid: number | null;
  };
  needsOperator: string[];
  executorOutputPath: string | null;
  artifactRoot: string | null;
  followUpReview: FollowUpReview | null;
}

export interface ReviewResolveReplyResponse {
  item: {
    id: string;
    slug: string;
  };
  action: "approved" | "rejected" | "deferred" | "feedback_captured";
  selectedOption: string | null;
  feedback: unknown | null;
  result: ReviewActionResponse["result"] | null;
  approval: unknown | null;
  execution: ReviewExecutionResponse | null;
  confirmation: string;
}

export async function runReviewAction(input: {
  id: string;
  action: "approve" | "reject" | "defer";
}): Promise<ArcadiaJsonSuccess<ReviewActionResponse>> {
  return runArcadiaCliJson<ReviewActionResponse>(["review", input.action, input.id]);
}

export async function reviewApproveWithExecute(input: {
  id: string;
  executor?: string;
}): Promise<ArcadiaJsonSuccess<ReviewActionResponse>> {
  return runArcadiaCliJson<ReviewActionResponse>(
    ["review", "approve", input.id, "--execute", "--executor", input.executor ?? "codex"],
    { timeoutMs: 35 * 60 * 1000 }
  );
}

export async function resolveReviewReply(input: {
  id: string;
  reply: string;
}): Promise<ArcadiaJsonSuccess<ReviewResolveReplyResponse>> {
  return runArcadiaCliJson<ReviewResolveReplyResponse>([
    "review",
    "resolve-reply",
    input.reply,
    "--id",
    input.id
  ]);
}

export interface BackBurnerActionResponse {
  item: {
    id: string;
    status: string;
  };
  workItem?: unknown;
  result: {
    status: "promoted" | "archived";
    summary: string;
  };
}

export async function getRunDetails(id: string): Promise<ArcadiaJsonSuccess<RunShowResponse>> {
  return runArcadiaCliJson<RunShowResponse>(["run", "show", id]);
}

export async function requestRunRetry(id: string): Promise<ArcadiaJsonSuccess<{
  run: { id: string };
  decision: { id: string; slug: string };
}>> {
  return runArcadiaCliJson(["run", "retry", id]);
}

export async function runBackBurnerAction(input: {
  id: string;
  action: "promote" | "archive";
}): Promise<ArcadiaJsonSuccess<BackBurnerActionResponse>> {
  return runArcadiaCliJson<BackBurnerActionResponse>(["back-burner", input.action, input.id]);
}

export async function loadMissionControlOverview(): Promise<ArcadiaJsonSuccess<MissionControlOverviewResponse>> {
  return runArcadiaCliJson<MissionControlOverviewResponse>(["mission-control", "overview"]);
}

export async function loadMissionControlNode(
  nodeId: string
): Promise<ArcadiaJsonSuccess<MissionControlNodeResponse>> {
  return runArcadiaCliJson<MissionControlNodeResponse>(["mission-control", "node", nodeId]);
}

/**
 * "I have N minutes — what fits?". Deterministic on the CLI side, so unlike
 * the reply channel this needs no generous timeout: there is no model call.
 */
export async function loadMissionControlFits(
  minutes: number,
  limit?: number
): Promise<ArcadiaJsonSuccess<MissionControlFitsResponse>> {
  const args = ["mission-control", "fits", "--minutes", String(minutes)];
  if (limit !== undefined) {
    args.push("--limit", String(limit));
  }
  return runArcadiaCliJson<MissionControlFitsResponse>(args);
}

/**
 * Sizing an entry from the UI goes straight to the deterministic update
 * command — a UI edit is already unambiguous, so routing it through the
 * reply interpreter would spend a model call to re-derive what was clicked.
 */
export async function setOrientationEntryEffort(input: {
  entryId: string;
  effort: OrientationEffort | null;
}): Promise<ArcadiaJsonSuccess<{ entry: { id: string; effort: string | null } }>> {
  return runArcadiaCliJson<{ entry: { id: string; effort: string | null } }>([
    "orientation",
    "entry",
    "update",
    input.entryId,
    "--effort",
    input.effort ?? "none"
  ]);
}

/** The scale-of-time picture. Deterministic arithmetic on the CLI side. */
export async function loadTimeline(): Promise<ArcadiaJsonSuccess<TimelineResponse>> {
  return runArcadiaCliJson<TimelineResponse>(["orientation", "timeline"]);
}

export interface ActivityReportResponse {
  kind: "daily" | "weekly";
  startLocalDate: string;
  endLocalDate: string;
  headline: string;
  engagement: { totalMinutes: number };
  logged: { totalMinutes: number; byFocus: Array<{ focus: string; minutes: number }> };
  progressed: Array<{ title: string; what: string; why: string }>;
  urgent: Array<{ title: string; why: string }>;
  becomingUrgent: Array<{ title: string; why: string }>;
  backlog: { totalMinutes: number; daysAtCapacity: number | null } | null;
  encouragement: { mood: string; line: string; attribution?: string };
  lines: string[];
}

/** The daily or weekly story. Deterministic on the CLI side. */
export async function loadReport(kind: "daily" | "weekly"): Promise<ArcadiaJsonSuccess<ActivityReportResponse>> {
  return runArcadiaCliJson<ActivityReportResponse>(["report", kind]);
}

export interface LogTimeResponse {
  timeEntry: { id: string; minutes: number; description: string; startedAt: string | null };
}

/** Deterministic time logging from the UI — the description is the operator's own words. */
export async function logTime(input: {
  minutes: number;
  description: string;
  at?: string;
}): Promise<ArcadiaJsonSuccess<LogTimeResponse>> {
  const args = ["time", "log", "--minutes", String(input.minutes), "--description", input.description];
  if (input.at) {
    args.push("--at", input.at);
  }
  return runArcadiaCliJson<LogTimeResponse>(args);
}

export async function submitMissionControlReply(input: {
  nodeId: string;
  text: string;
}): Promise<ArcadiaJsonSuccess<MissionControlReplyResponse>> {
  return runArcadiaCliJson<MissionControlReplyResponse>(
    ["mission-control", "reply", input.nodeId, input.text, "--source", "dashboard"],
    { timeoutMs: 200_000 }
  );
}

export class ArcadiaCliError extends Error {
  readonly statusCode: number;
  readonly details: unknown;

  constructor(message: string, statusCode: number, details: unknown = null) {
    super(message);
    this.name = "ArcadiaCliError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function runArcadiaCliJson<TData>(
  args: string[],
  options: { timeoutMs?: number } = {}
): Promise<ArcadiaJsonSuccess<TData>> {
  const repoRoot = findRepoRoot(process.cwd());
  const sourceCli = path.join(repoRoot, "src", "cli.ts");
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
  const builtCli = path.join(repoRoot, "dist", "src", "cli.js");

  const command = existsSync(sourceCli) ? (existsSync(tsxBin) ? tsxBin : "tsx") : process.execPath;
  const cliArgs = existsSync(sourceCli)
    ? [sourceCli, ...args, "--json"]
    : [builtCli, ...args, "--json"];

  try {
    const result = await execFileAsync(command, cliArgs, {
      cwd: repoRoot,
      // Tells the activity log where the operator actually was; without it
      // every dashboard tap would be recorded as terminal use.
      env: { ...process.env, ARCADIA_SURFACE: "dashboard" },
      encoding: "utf8",
      timeout: options.timeoutMs ?? 60_000,
      maxBuffer: 16 * 1024 * 1024
    });

    const parsed = parseArcadiaJson<TData>(result.stdout);
    if (!parsed.ok) {
      throw failureFromParsed(parsed);
    }

    return parsed;
  } catch (error) {
    if (error instanceof ArcadiaCliError) {
      throw error;
    }
    throw failureFromExecError(error);
  }
}

function findRepoRoot(start: string): string {
  let current = path.resolve(start);

  while (true) {
    if (existsSync(path.join(current, "src", "cli.ts")) && existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate Arcadia repository root.");
    }

    current = parent;
  }
}

type ArcadiaJsonResult<TData> =
  | ArcadiaJsonSuccess<TData>
  | {
      ok: false;
      command: string;
      workspace?: string;
      error: {
        code: string;
        message: string;
        details: unknown;
      };
    };

function parseArcadiaJson<TData>(raw: string): ArcadiaJsonResult<TData> {
  return JSON.parse(raw) as ArcadiaJsonResult<TData>;
}

function failureFromParsed(parsed: ArcadiaJsonResult<unknown>): ArcadiaCliError {
  if (parsed.ok) {
    return new ArcadiaCliError("Arcadia CLI returned an unexpected successful response.", 500);
  }

  return new ArcadiaCliError(
    `${parsed.error.code}: ${parsed.error.message}`,
    statusForArcadiaError(parsed.error.code, parsed.error.details),
    parsed.error.details
  );
}

function failureFromExecError(error: unknown): ArcadiaCliError {
  const execError = error as { stdout?: string; stderr?: string; message?: string; code?: unknown };
  const raw = [execError.stderr, execError.stdout].find((value) => value?.trim());
  if (raw) {
    try {
      return failureFromParsed(parseArcadiaJson<unknown>(raw));
    } catch {
      return new ArcadiaCliError(raw.trim(), 500, {
        commandFailed: true,
        exitCode: execError.code ?? null
      });
    }
  }

  return new ArcadiaCliError(execError.message ?? String(error), 500, {
    commandFailed: true,
    exitCode: execError.code ?? null
  });
}

function statusForArcadiaError(code: string, details: unknown): number {
  if (
    code === "VALIDATION_ERROR" &&
    details &&
    typeof details === "object" &&
    "conflict" in details &&
    details.conflict === true
  ) {
    return 409;
  }
  if (code === "USAGE_ERROR" || code === "VALIDATION_ERROR") {
    return 400;
  }

  if (code === "WORKSPACE_NOT_FOUND" || code === "DATABASE_NOT_INITIALIZED") {
    return 503;
  }

  return 500;
}
