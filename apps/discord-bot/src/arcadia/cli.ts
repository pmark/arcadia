import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AskCorrectData,
  AskData,
  AgentAskNotificationsData,
  OperatorPingsData,
  ArcadiaJsonFailure,
  ArcadiaJsonSuccess,
  ClarifyData,
  CodexListData,
  DigestMarkPostedData,
  DigestRunData,
  MilestoneListData,
  OrientationPacketComposeData,
  OrientationPacketMarkSentData,
  OrientationReplyData,
  QueueData,
  ReviewDecisionData,
  ReviewData,
  ReviewResolveReplyData,
  ReviewShowData,
  RunListData,
  RunShowData,
  StatusData
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface ExecFileOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  encoding: "utf8";
  timeout: number;
  maxBuffer: number;
}

/** Runs one CLI invocation. Injected by tests; the default wraps `execFile`. */
export type ExecFileLike = (
  file: string,
  args: string[],
  options: ExecFileOptions
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecFile: ExecFileLike = async (file, args, options) => {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: options.maxBuffer
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

/** Status is the first poll call and must not be killed by the 30 s default under load (Issue #2569). */
const STATUS_TIMEOUT_MS = 120_000;

/**
 * `ping pending` is what pages the operator, so it gets a longer budget than the
 * 30 s default: a kill under load only delays a page, and the next poll retries
 * (Issue #2581).
 */
const PING_POLL_TIMEOUT_MS = 120_000;

/**
 * `review --json` cold-starts tsx under load and was killed by the 30 s default
 * (Issue #2581), so the review snapshot gets 90 s.
 */
const REVIEW_TIMEOUT_MS = 90_000;

/** A CLI call killed by its timeout, typed so pollers can back off (Issue #2581). */
export class CliTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
    diagnostics: string,
    options?: { cause?: unknown }
  ) {
    super(`Arcadia CLI ${label} timed out after ${Math.round(timeoutMs / 1000)}s (${diagnostics})`, options);
    this.name = "CliTimeoutError";
  }
}

/**
 * Which surface the activity log should attribute a call to. This process is
 * mostly a daemon — schedulers and pollers — so "automation" is the safe
 * default; only calls the operator actually triggered say "discord", or the
 * report would show a night of polling as a night of engagement.
 */
type CliSurface = "discord" | "automation";

function surfaceEnv(surface: CliSurface = "automation"): NodeJS.ProcessEnv {
  return { ...process.env, ARCADIA_SURFACE: surface };
}

export interface ArcadiaCliOptions {
  workspace: string | null;
  cliPath: string | null;
  timeoutMs?: number;
  /** Test seam: replaces `execFile`. */
  exec?: ExecFileLike;
  /** Test seam: millisecond clock used to report elapsed time on failures. */
  clock?: () => number;
}

export interface CliInvocation {
  command: string;
  args: string[];
}

export interface AskCliOptions {
  runSafe?: boolean;
  sourceIngress?: string;
  replyReviewId?: string | null;
}

export class ArcadiaCli {
  constructor(private readonly options: ArcadiaCliOptions) {}

  status(): Promise<ArcadiaJsonSuccess<StatusData>> {
    return this.runJson<StatusData>(this.withWorkspace(["status", "--json"]), { timeoutMs: STATUS_TIMEOUT_MS });
  }

  queue(): Promise<ArcadiaJsonSuccess<QueueData>> {
    return this.runJson<QueueData>(this.withWorkspace(["queue", "--json"]));
  }

  agentAskNotifications(): Promise<ArcadiaJsonSuccess<AgentAskNotificationsData>> {
    return this.runJson<AgentAskNotificationsData>(this.withWorkspace(["agent-ask", "notifications", "--json"]));
  }

  agentAskNotificationSent(settlementId: string, messageId: string): Promise<ArcadiaJsonSuccess<{ settlementId: string; messageId: string }>> {
    return this.runJson(this.withWorkspace([
      "agent-ask", "notification-sent",
      "--settlement", settlementId,
      "--message-id", messageId,
      "--json"
    ]));
  }

  operatorPings(): Promise<ArcadiaJsonSuccess<OperatorPingsData>> {
    return this.runJson<OperatorPingsData>(this.withWorkspace(["ping", "pending", "--json"]), { timeoutMs: PING_POLL_TIMEOUT_MS });
  }

  operatorPingSent(pingId: string, messageId: string): Promise<ArcadiaJsonSuccess<{ pingId: string; messageId: string }>> {
    return this.runJson(this.withWorkspace(["ping", "sent", "--id", pingId, "--message-id", messageId, "--json"]));
  }

  review(): Promise<ArcadiaJsonSuccess<ReviewData>> {
    return this.runJson<ReviewData>(this.withWorkspace(["review", "--json"]), { timeoutMs: REVIEW_TIMEOUT_MS });
  }

  reviewShow(id: string): Promise<ArcadiaJsonSuccess<ReviewShowData>> {
    return this.runJson<ReviewShowData>(this.withWorkspace(["review", "show", id, "--json"]));
  }

  reviewApprove(id: string): Promise<ArcadiaJsonSuccess<ReviewDecisionData>> {
    return this.runJson<ReviewDecisionData>(this.withWorkspace(["review", "approve", id, "--json"]), { surface: "discord" });
  }

  reviewApproveWithExecute(id: string, executor = "codex"): Promise<ArcadiaJsonSuccess<ReviewDecisionData>> {
    return this.runJson<ReviewDecisionData>(
      this.withWorkspace(["review", "approve", id, "--execute", "--executor", executor, "--json"]),
      { timeoutMs: 35 * 60 * 1000, surface: "discord" }
    );
  }

  reviewReject(id: string): Promise<ArcadiaJsonSuccess<ReviewDecisionData>> {
    return this.runJson<ReviewDecisionData>(this.withWorkspace(["review", "reject", id, "--json"]), { surface: "discord" });
  }

  reviewDefer(id: string): Promise<ArcadiaJsonSuccess<ReviewDecisionData>> {
    return this.runJson<ReviewDecisionData>(this.withWorkspace(["review", "defer", id, "--json"]), { surface: "discord" });
  }

  /**
   * `options.actor` is the authenticated Discord author id; the CLI records it
   * in the capture envelope only. Omit it where no principal is authenticated.
   */
  reviewResolveReply(
    reply: string,
    id?: string | null,
    options: { actor?: string | null } = {}
  ): Promise<ArcadiaJsonSuccess<ReviewResolveReplyData>> {
    return this.runJson<ReviewResolveReplyData>(this.withWorkspace([
      "review",
      "resolve-reply",
      reply,
      ...(id ? ["--id", id] : []),
      ...(options.actor ? ["--actor", options.actor] : []),
      "--json"
    ]), { surface: "discord" });
  }

  clarify(workItemId: string): Promise<ArcadiaJsonSuccess<ClarifyData>> {
    return this.runJson<ClarifyData>(
      this.withWorkspace(["clarify", "--work", workItemId, "--apply", "--json"]),
      { timeoutMs: 5 * 60 * 1000, surface: "discord" }
    );
  }

  ask(request: string, askOptions: AskCliOptions = {}): Promise<ArcadiaJsonSuccess<AskData>> {
    return this.runJson<AskData>(this.withWorkspaceAfter(1, [
      "ask",
      request,
      ...(askOptions.sourceIngress ? ["--source-ingress", askOptions.sourceIngress] : []),
      ...(askOptions.replyReviewId ? ["--reply-review-id", askOptions.replyReviewId] : []),
      ...(askOptions.runSafe ? ["--run-safe"] : []),
      "--json"
    ]), { surface: "discord" });
  }

  /**
   * `arcadia ask correct`: re-route an Ask by operator reply. `actor` is the authenticated Discord author id; the CLI
   * records it and, for `--type answer`, checks it against DISCORD_ALLOWED_USER_IDS again.
   */
  askCorrect(
    askId: string,
    correction: { type?: string | null; project?: string | null; ref?: string | null; actor?: string | null }
  ): Promise<ArcadiaJsonSuccess<AskCorrectData>> {
    return this.runJson<AskCorrectData>(this.withWorkspaceAfter(2, [
      "ask",
      "correct",
      askId,
      ...(correction.type ? ["--type", correction.type] : []),
      ...(correction.project ? ["--project", correction.project] : []),
      ...(correction.ref ? ["--ref", correction.ref] : []),
      "--source",
      "discord",
      ...(correction.actor ? ["--actor", correction.actor] : []),
      "--json"
    ]), { surface: "discord" });
  }

  runs(limit = 10): Promise<ArcadiaJsonSuccess<RunListData>> {
    return this.runJson<RunListData>(this.withWorkspace([
      "run",
      "list",
      "--limit",
      String(limit),
      "--json"
    ]));
  }

  run(runId: string): Promise<ArcadiaJsonSuccess<RunShowData>> {
    return this.runJson<RunShowData>(this.withWorkspace(["run", "show", runId, "--json"]));
  }

  codexTasks(activeOnly = true): Promise<ArcadiaJsonSuccess<CodexListData>> {
    return this.runJson<CodexListData>(this.withWorkspaceAfter(2, [
      "codex",
      "list",
      ...(activeOnly ? ["--active-only"] : []),
      "--json"
    ]));
  }

  milestones(status = "completed", limit = 20): Promise<ArcadiaJsonSuccess<MilestoneListData>> {
    return this.runJson<MilestoneListData>(this.withWorkspaceAfter(2, [
      "milestone",
      "list",
      "--status",
      status,
      "--limit",
      String(limit),
      "--json"
    ]));
  }

  orientationPacketCompose(ifDue: boolean): Promise<ArcadiaJsonSuccess<OrientationPacketComposeData> | ArcadiaJsonFailure> {
    return this.runJsonAllowFailure<OrientationPacketComposeData>(
      this.withWorkspace(["orientation", "packet", "compose", ...(ifDue ? ["--if-due"] : []), "--json"]),
      { timeoutMs: 200_000 }
    );
  }

  orientationPacketMarkSent(packetId: string, messageId: string): Promise<ArcadiaJsonSuccess<OrientationPacketMarkSentData> | ArcadiaJsonFailure> {
    return this.runJsonAllowFailure<OrientationPacketMarkSentData>(
      this.withWorkspace(["orientation", "packet", "mark-sent", packetId, "--message-id", messageId, "--json"])
    );
  }

  /**
   * Compose every due Project and portfolio digest. The timeout is generous
   * because one run narrates once per active Project per due cadence through
   * the local model, and a cold model load alone can take minutes.
   */
  digestRun(): Promise<ArcadiaJsonSuccess<DigestRunData> | ArcadiaJsonFailure> {
    return this.runJsonAllowFailure<DigestRunData>(
      this.withWorkspace(["digest", "run", "--json"]),
      { timeoutMs: 30 * 60 * 1000 }
    );
  }

  digestMarkPosted(digestId: string, messageId: string): Promise<ArcadiaJsonSuccess<DigestMarkPostedData> | ArcadiaJsonFailure> {
    return this.runJsonAllowFailure<DigestMarkPostedData>(
      this.withWorkspace(["digest", "mark-posted", digestId, "--message-id", messageId, "--json"])
    );
  }

  orientationReply(text: string, source = "discord"): Promise<ArcadiaJsonSuccess<OrientationReplyData> | ArcadiaJsonFailure> {
    return this.runJsonAllowFailure<OrientationReplyData>(
      this.withWorkspace(["orientation", "reply", text, "--source", source, "--json"]),
      // Must exceed the interpreter's own LiteLLM timeout (180s, see
      // src/orientation/interpreter.ts) so a cold local-model load produces
      // that command's clean typed error instead of this exec just being
      // killed first and losing the structured response.
      // The one call in this file that is unambiguously the operator typing.
      { timeoutMs: 200_000, surface: "discord" }
    );
  }

  buildInvocation(args: string[]): CliInvocation {
    return buildCliInvocation(args, this.options.cliPath);
  }

  /**
   * Like runJson, but a well-formed `{ ok: false, error: { code, message } }`
   * CLI failure envelope is returned rather than thrown, so callers (the
   * orientation reply handler, the scheduler) can branch on `error.code`
   * (e.g. ORIENTATION_REPLY_AMBIGUOUS) instead of string-matching an Error
   * message. A CLI invocation that fails without producing that envelope
   * (binary missing, crash) still throws.
   */
  private async runJsonAllowFailure<TData>(
    args: string[],
    options: { timeoutMs?: number; surface?: CliSurface } = {}
  ): Promise<ArcadiaJsonSuccess<TData> | ArcadiaJsonFailure> {
    const invocation = this.buildInvocation(args);
    const timeout = options.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    const startedAt = this.now();
    try {
      const result = await this.execFile(invocation, timeout, options.surface);
      return JSON.parse(result.stdout) as ArcadiaJsonSuccess<TData>;
    } catch (error) {
      if (isExecError(error)) {
        const parsed = tryParseJson<ArcadiaJsonFailure>(error.stderr) ?? tryParseJson<ArcadiaJsonFailure>(error.stdout);
        if (parsed && parsed.ok === false) {
          return parsed;
        }
        throw this.callFailure(args, error, timeout, startedAt);
      }
      throw error;
    }
  }

  private async runJson<TData>(
    args: string[],
    options: { timeoutMs?: number; surface?: CliSurface } = {}
  ): Promise<ArcadiaJsonSuccess<TData>> {
    const invocation = this.buildInvocation(args);
    const timeout = options.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    const startedAt = this.now();
    try {
      const result = await this.execFile(invocation, timeout, options.surface);
      return parseJsonResponse<TData>(result.stdout);
    } catch (error) {
      if (isExecError(error)) {
        throw this.callFailure(args, error, timeout, startedAt);
      }
      throw error;
    }
  }

  private execFile(invocation: CliInvocation, timeout: number, surface?: CliSurface) {
    const exec = this.options.exec ?? defaultExecFile;
    return exec(invocation.command, invocation.args, {
      cwd: repoRoot(),
      env: surfaceEnv(surface),
      encoding: "utf8",
      timeout,
      maxBuffer: 16 * 1024 * 1024
    });
  }

  private now(): number {
    return (this.options.clock ?? Date.now)();
  }

  /**
   * Turns a failed exec into an error that says what happened. A call killed by
   * the timeout says so explicitly, with signal, exit code and elapsed ms, instead
   * of the opaque "null" that the empty stderr produced before (Issue #2569).
   */
  private callFailure(args: string[], error: Error & { stdout?: string; stderr?: string }, timeoutMs: number, startedAt: number): Error {
    const elapsedMs = this.now() - startedAt;
    const label = commandLabel(args);
    const killed = (error as { killed?: boolean }).killed === true;
    const code = (error as { code?: unknown }).code;
    const signal = (error as { signal?: unknown }).signal ?? null;
    const exitCode = code === undefined ? null : String(code);
    const diagnostics = `killed=${killed}, signal=${String(signal)}, exit code=${exitCode}, elapsed ${elapsedMs} ms`;
    // A stdout overflow also kills the child, but it is not a timeout.
    const timedOut = killed && code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    if (timedOut) {
      return new CliTimeoutError(label, timeoutMs, diagnostics, { cause: error });
    }
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    return new Error(`Arcadia CLI failed: ${detail} (${diagnostics})`, { cause: error });
  }

  private withWorkspace(args: string[]): string[] {
    if (!this.options.workspace) {
      return args;
    }

    const jsonIndex = args.lastIndexOf("--json");
    if (jsonIndex === -1) {
      return [...args, "--workspace", this.options.workspace];
    }

    return [...args.slice(0, jsonIndex), "--workspace", this.options.workspace, ...args.slice(jsonIndex)];
  }

  private withWorkspaceAfter(index: number, args: string[]): string[] {
    return this.options.workspace
      ? [...args.slice(0, index), "--workspace", this.options.workspace, ...args.slice(index)]
      : args;
  }
}

/**
 * Which CLI the bot runs, and why. `env` is ARCADIA_CLI_PATH; `tsx` is the source
 * CLI run through tsx, the default (a cold transpile on every call). A built dist
 * is deliberately never preferred: dist is gitignored and not rebuilt by the
 * service restart, so it can be older than the source.
 */
export type CliChoice =
  | { kind: "env"; command: string; reason: string }
  | { kind: "tsx"; command: string; sourceCli: string; reason: string };

export function resolveCliChoice(
  cliPath: string | null,
  fileExists: (candidate: string) => boolean = existsSync
): CliChoice {
  if (cliPath) {
    return { kind: "env", command: cliPath, reason: "ARCADIA_CLI_PATH is set" };
  }

  const sourceCli = findExisting([
    path.resolve(import.meta.dirname, "../../../src/cli.ts"),
    path.resolve(import.meta.dirname, "../../../../src/cli.ts"),
    path.resolve(process.cwd(), "src/cli.ts")
  ], fileExists);

  if (sourceCli) {
    return {
      kind: "tsx",
      command: findTsx(),
      sourceCli,
      reason: "ARCADIA_CLI_PATH is unset; running the source CLI through tsx"
    };
  }

  throw new Error("Unable to locate Arcadia CLI. Set ARCADIA_CLI_PATH.");
}

export function buildCliInvocation(
  args: string[],
  cliPath: string | null,
  fileExists: (candidate: string) => boolean = existsSync
): CliInvocation {
  const choice = resolveCliChoice(cliPath, fileExists);
  if (choice.kind === "env") {
    return { command: choice.command, args };
  }
  return { command: choice.command, args: [choice.sourceCli, ...args] };
}

function parseJsonResponse<TData>(stdout: string): ArcadiaJsonSuccess<TData> {
  const parsed = JSON.parse(stdout) as ArcadiaJsonSuccess<TData>;
  if (!parsed.ok) {
    throw new Error("Arcadia CLI returned a failure response.");
  }
  return parsed;
}

/**
 * The CLI verb (`status`, `review`, `orientation`, `agent-ask`) for log labels.
 * Only the first argument: later arguments can be free text, such as an Ask
 * request or an operator reply, and must never reach a log line.
 */
function commandLabel(args: string[]): string {
  const verb = args[0];
  return verb && /^[a-z][a-z-]*$/.test(verb) ? verb : "command";
}

function findExisting(paths: string[], fileExists: (candidate: string) => boolean = existsSync): string | null {
  return paths.find((candidate) => fileExists(candidate)) ?? null;
}

function findTsx(): string {
  return findExisting([
    path.resolve(repoRoot(), "node_modules", ".bin", "tsx"),
    path.resolve(import.meta.dirname, "../../node_modules/.bin/tsx")
  ]) ?? "tsx";
}

function repoRoot(): string {
  // apps/discord-bot/src/arcadia -> apps/discord-bot/src -> apps/discord-bot
  // -> apps -> <repo root>. Was previously missing this last "..", landing on
  // apps/ instead of the repo root — harmless for commands that don't depend
  // on the root .env, but it silently broke dotenv-loaded Intelligence config
  // (wrong LiteLLM route, no API key) for any CLI subprocess the bot spawns
  // that needs it, since dotenv.config() resolves relative to cwd.
  return path.resolve(import.meta.dirname, "../../../..");
}

function tryParseJson<T>(raw: string | undefined): T | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function isExecError(error: unknown): error is Error & { stdout?: string; stderr?: string } {
  return error instanceof Error && ("stdout" in error || "stderr" in error);
}
