import { accessSync, constants } from "node:fs";
import { validationError } from "../cli/errors.js";
import { withDatabase, writeTransaction } from "../db/connection.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import {
  agentGoTransportState,
  preservationTransportReady,
  transportHeartbeatDiagnostic
} from "./preservationTransport.js";

/**
 * A prepared worktree is only useful if the agent that receives it can then
 * reach the workspace database and ask the host worker to preserve its work.
 * Both fail after the worktree exists, when nothing can undo the wasted
 * handoff, so they are checked before one is prepared.
 */

/** Null when this process can take the workspace database's write lock, else why it cannot. */
function probeWorkspaceDatabaseWritable(workspace: string): string | null {
  const { databaseFile } = getWorkspacePaths(workspace);
  try {
    accessSync(databaseFile, constants.W_OK);
    withDatabase(workspace, (db) => writeTransaction(db, () => undefined));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Refuse task preparation unless the workspace database is writable by this
 * profile and both the preservation and Go routes carry a fresh heartbeat.
 * Deterministic and read-only: it writes nothing and starts no process.
 */
export function assertPreparedDispatchAdmission(workspace: string): void {
  const databaseFailure = probeWorkspaceDatabaseWritable(workspace);
  if (databaseFailure) {
    throw validationError("Refusing to prepare a worktree: this agent profile cannot write the workspace database.", {
      workspace,
      database: getWorkspacePaths(workspace).databaseFile,
      cause: databaseFailure,
      remedy:
        "Grant the selected profile write access to the workspace directory (for Claude Code, add it to " +
        "permissions.additionalDirectories) or run the command outside the sandbox, then retry. No worktree was prepared."
    });
  }

  const failures: string[] = [];
  if (!preservationTransportReady(workspace)) failures.push(transportHeartbeatDiagnostic(workspace, "preservation"));
  if (agentGoTransportState(workspace) !== "ready") failures.push(transportHeartbeatDiagnostic(workspace, "go"));
  if (failures.length > 0) {
    throw validationError("Refusing to prepare a worktree: the Arcadia worker transport has no fresh heartbeat.", {
      workspace,
      failures,
      remedy:
        "Start or restart the Arcadia worker (`arcadia worker start`, or restart-services.sh), confirm " +
        "`arcadia go-broker status` reports both routes READY, then retry. No worktree was prepared."
    });
  }
}
