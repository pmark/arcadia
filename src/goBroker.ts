import path from "node:path";
import { validationError } from "./cli/errors.js";
import type { CommandSuccess } from "./cli/response.js";
import { runAdvanceCommand, type AdvanceCommandData } from "./commands/advance.js";
import { runGoCommand, type GoCommandData, type GoCommandOptions } from "./commands/go.js";
import { runWorkMonitorCommand, type WorkMonitorCommandData } from "./commands/workMonitor.js";
import { requireResolvedWorkspace } from "./workspace/resolve.js";

export type GoBrokerAgent = "codex" | "claude";
export type ProtectedBrokerOperation = "go" | "advance" | "work-monitor";

export interface GoBrokerRequest {
  source: string;
  agent: GoBrokerAgent;
  operation: ProtectedBrokerOperation;
}

export type GoBrokerRunner = (options: GoCommandOptions) => CommandSuccess<GoCommandData>;
export type AdvanceBrokerRunner = (options: { workspace: string; repo: string }) => CommandSuccess<AdvanceCommandData>;
export type WorkMonitorBrokerRunner = (options: { workspace: string; includePullRequests: false }) => CommandSuccess<WorkMonitorCommandData>;
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
  if (operation !== "go" && operation !== "advance" && operation !== "work-monitor") {
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
  resolveWorkspace: BrokerWorkspaceResolver = (source) => requireResolvedWorkspace({ cwd: source })
): CommandSuccess<GoCommandData | AdvanceCommandData | WorkMonitorCommandData> {
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
