import { mkdirSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { getWorkspacePaths } from "../workspace/paths.js";

/**
 * Where one coordinator role's handoff state lives in the configured
 * workspace (docs/agent-guidance/coordinator-handoff-design.md, section b):
 * never a scratchpad or notes folder, so it survives restarts.
 */
export interface CoordinatorPaths {
  root: string;
  live: string;
  snapshots: string;
  generationsLog: string;
  /** Coordinator-owned journal, next move, subscriptions and chat-only approvals. */
  state: string;
  lock: string;
  prCache: string;
  /** Written by change 1 (`arcadia coordinator budget`), read here when present. */
  budget: string;
}

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function assertCoordinatorName(kind: "project" | "role", value: string): string {
  if (!NAME.test(value)) {
    throw validationError(`--${kind} must be lowercase letters, digits and dashes (at most 40), starting with a letter.`, { reason: "invalid_coordinator_name" });
  }
  return value;
}

export function coordinatorPaths(workspace: string, project: string, role: string): CoordinatorPaths {
  const root = path.join(getWorkspacePaths(workspace).root, "coordinators", assertCoordinatorName("project", project), assertCoordinatorName("role", role));
  return {
    root,
    live: path.join(root, "live.json"),
    snapshots: path.join(root, "snapshots"),
    generationsLog: path.join(root, "generations.jsonl"),
    state: path.join(root, "state.json"),
    lock: path.join(root, "relay.lock"),
    prCache: path.join(root, "prs-cache.json"),
    budget: path.join(root, "budget.json")
  };
}

export function ensureCoordinatorDirectories(paths: CoordinatorPaths): void {
  mkdirSync(paths.snapshots, { recursive: true, mode: 0o700 });
}
