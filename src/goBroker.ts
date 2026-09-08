import path from "node:path";
import { validationError } from "./cli/errors.js";
import type { CommandSuccess } from "./cli/response.js";
import { runAdvanceCommand, type AdvanceCommandData } from "./commands/advance.js";
import { runGoCommand, type GoCommandData, type GoCommandOptions } from "./commands/go.js";
import { runPreserveCommand, type PreserveCommandData } from "./commands/preserve.js";
import { runWorkMonitorCommand, type WorkMonitorCommandData } from "./commands/workMonitor.js";
import { requireResolvedWorkspace } from "./workspace/resolve.js";

export type GoBrokerAgent = "codex" | "claude";
export type ProtectedBrokerOperation = "go" | "preserve" | "advance" | "work-monitor";

/** Operations that write shared Git metadata and must never run in the agent sandbox. */
const HOST_CONTROLLER_OPERATIONS: ReadonlySet<ProtectedBrokerOperation> = new Set(["go", "preserve"]);

export interface GoBrokerRequest {
  source: string;
  agent: GoBrokerAgent;
  operation: ProtectedBrokerOperation;
}

/**
 * A `go` handoff and a `preserve` both mutate the Git common directory shared by
 * every linked worktree — `preserve` stages and commits, `go` fetches and
 * updates refs. Codex intentionally protects that directory even when the source
 * tree itself is writable, so refuse before the first Git command rather than
 * leaking a misleading FETCH_HEAD or index.lock failure.
 */
export function assertGoBrokerHostController(request: GoBrokerRequest, environment: NodeJS.ProcessEnv = process.env): void {
  if (!HOST_CONTROLLER_OPERATIONS.has(request.operation) || !environment.CODEX_SANDBOX) return;
  throw validationError("This Arcadia broker operation must run through the host controller, outside the coding-agent sandbox.", {
    operation: request.operation,
    sandbox: environment.CODEX_SANDBOX,
    remedy: "Finish the candidate in this task, then have the host run the revision-pinned host-controller executable from the completed worktree. Codex may run only the advance and work-monitor brokers."
  });
}

export type GoBrokerRunner = (options: GoCommandOptions) => CommandSuccess<GoCommandData>;
export type AdvanceBrokerRunner = (options: { workspace: string; repo: string }) => CommandSuccess<AdvanceCommandData>;
export type WorkMonitorBrokerRunner = (options: { workspace: string; includePullRequests: false }) => CommandSuccess<WorkMonitorCommandData>;
export type PreserveBrokerRunner = (options: { workspace: string; source: string }) => CommandSuccess<PreserveCommandData>;
export type BrokerWorkspaceResolver = (source: string) => string;

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
  if (agent !== "codex" && agent !== "claude") {
    throw validationError("The installed broker launcher has an invalid fixed agent.", { agent });
  }
  if (operation !== "go" && operation !== "preserve" && operation !== "advance" && operation !== "work-monitor") {
    throw validationError("The installed broker launcher has an invalid fixed operation.", { operation });
  }

  return { source: path.resolve(source), agent, operation };
}

/**
 * The `go` operation reuses Arcadia's canonical safety checks twice: first as a
 * read-only preview, then as the identical apply. `advance` and `work-monitor`
 * reuse their canonical read-only implementations with the caller's repository
 * and resolved workspace fixed by the launcher.
 */
export function runGoBroker(
  request: GoBrokerRequest,
  runner: GoBrokerRunner = runGoCommand,
  advanceRunner: AdvanceBrokerRunner = runAdvanceCommand,
  workMonitorRunner: WorkMonitorBrokerRunner = runWorkMonitorCommand,
  resolveWorkspace: BrokerWorkspaceResolver = (source) => requireResolvedWorkspace({ cwd: source }),
  preserveRunner: PreserveBrokerRunner = runPreserveCommand
): CommandSuccess<GoCommandData | AdvanceCommandData | WorkMonitorCommandData | PreserveCommandData> {
  if (request.operation === "preserve") {
    return {
      ...preserveRunner({ workspace: resolveWorkspace(request.source), source: request.source }),
      command: "preserve-broker"
    };
  }
  if (request.operation === "advance") {
    return {
      ...advanceRunner({ workspace: resolveWorkspace(request.source), repo: request.source }),
      command: "advance-broker"
    };
  }
  if (request.operation === "work-monitor") {
    return {
      ...workMonitorRunner({ workspace: resolveWorkspace(request.source), includePullRequests: false }),
      command: "work-monitor-broker"
    };
  }
  const options = {
    repo: request.source,
    source: request.source,
    agent: request.agent
  } satisfies GoCommandOptions;

  runner(options);
  const applied = runner({ ...options, apply: true });
  return { ...applied, command: "go-broker" };
}
