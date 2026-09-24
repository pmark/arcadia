import path from "node:path";
import { ArcadiaError, normalizeError, validationError } from "./cli/errors.js";
import type { CommandSuccess } from "./cli/response.js";
import { runAdvanceCommand, type AdvanceCommandData } from "./commands/advance.js";
import { runGoCommand, type GoCommandData, type GoCommandOptions } from "./commands/go.js";
import { renderNextSuccess, runNextCommand, type NextCommandData } from "./commands/next.js";
import { runWorkMonitorCommand, type WorkMonitorCommandData } from "./commands/workMonitor.js";
import { discoverDocs } from "./docs/discover.js";
import { existingDirectory } from "./git/worktrees.js";
import { SESSION_AGENTS, type SessionAgent } from "./sessions/index.js";
import { sessionTitlesByState, type SessionTitleState } from "./sessions/sessionTitle.js";
import { requireResolvedWorkspace } from "./workspace/resolve.js";

/** The protected broker carries the same agent union the Session registry does. */
export type GoBrokerAgent = SessionAgent;
export type ProtectedBrokerOperation = "go" | "preserve" | "advance" | "work-monitor" | "brief";

/** Operations that write shared Git metadata and must never run in the agent sandbox. */
const HOST_CONTROLLER_OPERATIONS: ReadonlySet<ProtectedBrokerOperation> = new Set(["go"]);

export interface GoBrokerRequest {
  source: string;
  agent: GoBrokerAgent;
  operation: ProtectedBrokerOperation;
}

/**
 * A `go` handoff mutates the Git common directory shared by linked worktrees.
 * Refuse before its first Git command in the agent sandbox. Preservation uses
 * the sandbox-callable request transport; its consumer enforces the host boundary.
 */
export function assertGoBrokerHostController(request: GoBrokerRequest, environment: NodeJS.ProcessEnv = process.env): void {
  if (!HOST_CONTROLLER_OPERATIONS.has(request.operation) || !environment.CODEX_SANDBOX) return;
  throw validationError("This Arcadia broker operation must run through the host controller, outside the coding-agent sandbox.", {
    operation: request.operation,
    sandbox: environment.CODEX_SANDBOX,
    remedy: "Run the installed fixed go request launcher from the configured Project repository or prepared Session worktree. The host worker owns reconciliation; do not retry direct Git mutation with elevated permissions."
  });
}

export type GoBrokerRunner = (options: GoCommandOptions) => CommandSuccess<GoCommandData>;
export type AdvanceBrokerRunner = (options: { workspace: string; repo: string }) => CommandSuccess<AdvanceCommandData>;
export type WorkMonitorBrokerRunner = (options: { workspace: string; includePullRequests: false; repositoryPath: string }) => CommandSuccess<WorkMonitorCommandData>;
export type NextBrokerRunner = (options: { workspace: string; project: string }) => CommandSuccess<NextCommandData>;
export type BrokerWorkspaceResolver = (source: string) => string;
export type BrokerProjectSlugResolver = (source: string) => string;

export interface BriefCommandData {
  advance: AdvanceCommandData;
  workMonitor: WorkMonitorCommandData;
  next: NextCommandData;
  /** The exact lines `pnpm arcadia next` would render, joined for a single paste. */
  dispatchBrief: string;
  /**
   * The session title for each state this session can be in, so the agent
   * retitles by lookup as it moves from working to PR to waiting or done.
   */
  sessionTitles: Record<SessionTitleState, string>;
}

/**
 * The Project slug a prepared worktree's own checkout declares, the same
 * source `advance` already reads. Resolved independently of `advance`'s
 * response so a `next` project mismatch is never possible: both stages agree
 * because both derive it from the same managed Project document.
 */
function resolveProjectSlugFromRepository(source: string): string {
  const repoRoot = existingDirectory(source, "repository");
  const project = discoverDocs(repoRoot).docs.find((doc) => doc.type === "project");
  if (!project || project.type !== "project") {
    throw validationError("Arcadia brief requires one managed Project document.", { repository: repoRoot });
  }
  return project.slug;
}

/**
 * Attach which of the combined stages failed, without altering the underlying
 * error's code, message, exit code, or details. `normalizeError` first turns
 * any non-`ArcadiaError` throw (a plain `Error`, a SQLite failure, ...) into
 * the same structured shape the standalone command's own CLI entrypoint would
 * have produced for it, so a stage's failure is never less specific here than
 * running that stage alone would have been -- only the added `stage` field is
 * new.
 */
function runBriefStage<T>(stage: "advance" | "work-monitor" | "next", run: () => T): T {
  try {
    return run();
  } catch (error) {
    const normalized = normalizeError(error);
    throw new ArcadiaError(normalized.code, normalized.message, normalized.exitCode, { ...normalized.details, stage });
  }
}

/**
 * Parse the provider fixed by the installed launcher. There is intentionally
 * no option parser here: any public argument makes argv too long and cannot
 * acquire authority understood by the wider `arcadia go` command.
 */
export function parseGoBrokerArguments(argv: string[], source = process.cwd()): GoBrokerRequest {
  if (argv.length !== 2) {
    throw validationError("The protected broker accepts no public arguments.", {
      receivedArgumentCount: argv.length,
      remedy: "Run the provider-specific protected executable with no arguments from its required worktree."
    });
  }

  const [agent, operation] = argv;
  if (!SESSION_AGENTS.includes(agent as SessionAgent)) {
    throw validationError("The installed broker launcher has an invalid fixed agent.", { agent });
  }
  if (
    operation !== "go" &&
    operation !== "preserve" &&
    operation !== "advance" &&
    operation !== "work-monitor" &&
    operation !== "brief"
  ) {
    throw validationError("The installed broker launcher has an invalid fixed operation.", { operation });
  }

  return { source: path.resolve(source), agent: agent as SessionAgent, operation };
}

/**
 * The `go` operation reuses Arcadia's canonical safety checks twice: first as a
 * read-only preview, then as the identical apply. A prepared source can be
 * provably integrated only after the host observes the pinned upstream; that
 * one preview refusal is deferred to apply, which performs the observation and
 * repeats every safety check before mutation. `advance`, `work-monitor`, and
 * `brief` reuse their canonical read-only implementations with the caller's
 * repository and resolved workspace fixed by the launcher.
 */
export function runGoBroker(
  request: GoBrokerRequest & { operation: Exclude<ProtectedBrokerOperation, "preserve"> },
  runner: GoBrokerRunner = runGoCommand,
  advanceRunner: AdvanceBrokerRunner = runAdvanceCommand,
  workMonitorRunner: WorkMonitorBrokerRunner = runWorkMonitorCommand,
  resolveWorkspace: BrokerWorkspaceResolver = (source) => requireResolvedWorkspace({ cwd: source }),
  nextRunner: NextBrokerRunner = runNextCommand,
  resolveProjectSlug: BrokerProjectSlugResolver = resolveProjectSlugFromRepository
): CommandSuccess<GoCommandData | AdvanceCommandData | WorkMonitorCommandData | BriefCommandData> {
  if (request.operation === "advance") {
    return {
      ...advanceRunner({ workspace: resolveWorkspace(request.source), repo: request.source }),
      command: "advance-broker"
    };
  }
  if (request.operation === "work-monitor") {
    return {
      ...workMonitorRunner({ workspace: resolveWorkspace(request.source), includePullRequests: false, repositoryPath: request.source }),
      command: "work-monitor-broker"
    };
  }
  if (request.operation === "brief") {
    const workspace = resolveWorkspace(request.source);
    const advance = runBriefStage("advance", () => advanceRunner({ workspace, repo: request.source }));
    const workMonitor = runBriefStage("work-monitor", () =>
      workMonitorRunner({ workspace, includePullRequests: false, repositoryPath: request.source }));
    const projectSlug = runBriefStage("next", () => resolveProjectSlug(request.source));
    const next = runBriefStage("next", () => nextRunner({ workspace, project: projectSlug }));
    return {
      ok: true,
      command: "brief-broker",
      workspace,
      data: {
        advance: advance.data,
        workMonitor: workMonitor.data,
        next: next.data,
        dispatchBrief: renderNextSuccess(next).join("\n"),
        sessionTitles: sessionTitlesByState({
          kind: next.data.dispatchable ? "build" : "repair",
          plan: next.data.context?.activePlan ?? null,
          action: next.data.context?.action.id ?? null
        })
      },
      artifacts: [],
      warnings: []
    };
  }
  const options = {
    repo: request.source,
    source: request.source,
    agent: request.agent
  } satisfies GoCommandOptions;

  try {
    runner(options);
  } catch (error) {
    if (!(error instanceof ArcadiaError) || error.details.requiresProtectedRemoteObservation !== true) throw error;
  }
  const applied = runner({ ...options, apply: true });
  return { ...applied, command: "go-broker" };
}
