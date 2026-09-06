import path from "node:path";
import { validationError } from "./cli/errors.js";
import type { CommandSuccess } from "./cli/response.js";
import { runGoCommand, type GoCommandData, type GoCommandOptions } from "./commands/go.js";

export type GoBrokerAgent = "codex" | "claude";

export interface GoBrokerRequest {
  source: string;
  agent: GoBrokerAgent;
}

export type GoBrokerRunner = (options: GoCommandOptions) => CommandSuccess<GoCommandData>;

/**
 * Parse the provider fixed by the installed launcher. There is intentionally
 * no option parser here: any public argument makes argv too long and cannot
 * acquire authority understood by the wider `arcadia go` command.
 */
export function parseGoBrokerArguments(argv: string[], source = process.cwd()): GoBrokerRequest {
  if (argv.length !== 1) {
    throw validationError("The protected broker accepts no public arguments.", {
      receivedArgumentCount: argv.length,
      remedy: "Run the provider-specific broker executable with no arguments from the completed worktree."
    });
  }

  const [agent] = argv;
  if (agent !== "codex" && agent !== "claude") {
    throw validationError("The installed broker launcher has an invalid fixed agent.", { agent });
  }

  return { source: path.resolve(source), agent };
}

/**
 * Reuse Arcadia's canonical safety checks twice: first as a read-only preview,
 * then as the identical apply. Apply revalidates all state, so a change between
 * the two calls fails closed instead of acting on stale preview evidence.
 */
export function runGoBroker(
  request: GoBrokerRequest,
  runner: GoBrokerRunner = runGoCommand
): CommandSuccess<GoCommandData> {
  const options = {
    repo: request.source,
    source: request.source,
    agent: request.agent
  } satisfies GoCommandOptions;

  runner(options);
  const applied = runner({ ...options, apply: true });
  return { ...applied, command: "go-broker" };
}
