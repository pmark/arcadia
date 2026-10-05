import { existsSync } from "node:fs";
import { ArcadiaError } from "../cli/errors.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { resolveWorkspace } from "../workspace/resolve.js";
import { readProductionPolicySafely } from "./policy.js";

/**
 * The rehearsal freeze window (docs/agent-guidance/rehearsal-freeze-window.md):
 * while the managed-production policy is Active, the shared host steps that
 * can disrupt a live run (reinstalling the go-broker, restarting or stopping
 * Arcadia's launchd services) are refused. The window is read, never stored:
 * it is exactly the policy state `arcadia production status` reports, read
 * through the same `readProductionPolicySafely`.
 *
 * Nothing here grants or changes authority. The run's own Off-first terminal
 * step (G8) turns production Off before its nested restart, so it is allowed.
 */

export const FREEZE_OVERRIDE_ENV = "ARCADIA_FREEZE_OVERRIDE";
export const FREEZE_REFUSAL_CODE = "PRODUCTION_ACTIVE_FREEZE";
export const FREEZE_UNVERIFIED_CODE = "PRODUCTION_FREEZE_UNVERIFIED";
export const FREEZE_REASON = "production_active_freeze";
export const FREEZE_PROCEDURE = "docs/agent-guidance/rehearsal-freeze-window.md";

export const FREEZE_OPERATIONS = ["go-broker.install", "go-broker.ensure", "services.restart", "services.stop"] as const;
export type FreezeOperation = (typeof FREEZE_OPERATIONS)[number];

const ALTERNATIVES: Record<FreezeOperation, string> = {
  "go-broker.install":
    "Check the installed broker with `arcadia go-broker status` (read-only). After the terminal production Off receipt, the release-manager or orchestrator session runs reinstall-go-broker.sh once for the batched change.",
  "go-broker.ensure":
    "Check the installed broker with `arcadia go-broker status` (read-only). After the terminal production Off receipt, the release-manager or orchestrator session runs reinstall-go-broker.sh once for the batched change.",
  "services.restart":
    "Check services with `scripts/services.sh status` (read-only). Inside the run only its own Off-first terminal step restarts services; after the terminal production Off receipt, the release-manager or orchestrator session runs recover-arcadia-host-services.sh.",
  "services.stop":
    "Check services with `scripts/services.sh status` (read-only). Inside the run only its own Off-first terminal step touches services; after the terminal production Off receipt, the release-manager or orchestrator session runs recover-arcadia-host-services.sh."
};

export interface RehearsalFreezeDecision {
  operation: FreezeOperation;
  workspace: string | null;
  /**
   * What read-only `production status` reports for this workspace, `unreadable`
   * when a resolved workspace's policy cannot be read, or `no_workspace` when
   * none is configured or resolvable (production cannot be Active without one).
   */
  state: "active" | "inactive" | "unreadable" | "no_workspace";
  policyRevision: number | null;
  policyEpoch: number | null;
  observedAt: string;
  /** `allowed`: not Active. `overridden`: refused, then bypassed by the inline override. */
  decision: "allowed" | "overridden";
  /** Present only when the override bypassed a refusal. */
  override?: { env: typeof FREEZE_OVERRIDE_ENV; reason: string };
  /** Why the policy could not be read, when `state` is `unreadable`. */
  unreadableReason?: string;
  /** One line for the command's warnings and stderr, when overridden. */
  warning?: string;
  /** One line for the command's receipt when no workspace resolved. */
  note?: string;
}

export interface RehearsalFreezeInput {
  /** An explicit workspace (`--workspace`); otherwise the ordinary resolution order. */
  workspace?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function isFreezeOperation(value: string): value is FreezeOperation {
  return (FREEZE_OPERATIONS as readonly string[]).includes(value);
}

/**
 * Refuses `operation` while managed production is Active, and fails closed
 * when the policy cannot be read. `ARCADIA_FREEZE_OVERRIDE=<reason>` bypasses
 * either refusal; the returned decision carries the reason, and the caller
 * puts its `warning` in the command's receipt. Returns the decision when the
 * operation may proceed.
 */
export function assertRehearsalFreezeAllows(
  operation: FreezeOperation,
  input: RehearsalFreezeInput = {}
): RehearsalFreezeDecision {
  const env = input.env ?? process.env;
  const overrideReason = env[FREEZE_OVERRIDE_ENV]?.trim() ?? "";
  const override = overrideReason ? { env: FREEZE_OVERRIDE_ENV, reason: overrideReason } as const : undefined;
  const alternative = ALTERNATIVES[operation];

  const resolution = resolveWorkspace({ workspace: input.workspace, cwd: input.cwd, env });
  const workspace = resolution.workspacePath;
  if (!workspace) {
    // First-time setup (`go-broker install` before any workspace exists):
    // managed production needs a workspace and its policy, so with none
    // configured or resolvable nothing can be Active. A workspace that
    // resolves but cannot be read still fails closed below.
    return {
      operation,
      workspace: null,
      state: "no_workspace",
      policyRevision: null,
      policyEpoch: null,
      observedAt: new Date().toISOString(),
      decision: "allowed",
      note: `Rehearsal freeze check for ${operation}: no Arcadia workspace is configured or resolvable, so managed production cannot be Active; proceeding.`
    };
  }
  const databaseFile = getWorkspacePaths(workspace).databaseFile;
  const read = existsSync(databaseFile)
    ? readPolicy(workspace)
    : { status: "unavailable" as const, reason: `No workspace database at ${databaseFile}.`, observedAt: new Date().toISOString() };

  if (read.status !== "ok") {
    if (override) {
      return {
        operation,
        workspace,
        state: "unreadable",
        policyRevision: null,
        policyEpoch: null,
        observedAt: read.observedAt,
        decision: "overridden",
        override,
        unreadableReason: read.reason,
        warning: `Rehearsal freeze check for ${operation} could not read production status (${read.reason}); proceeding under ${FREEZE_OVERRIDE_ENV}=${override.reason}`
      };
    }
    throw new ArcadiaError(
      FREEZE_UNVERIFIED_CODE,
      `Refused ${operation}: managed production status could not be read, so a live rehearsal cannot be ruled out. ${read.reason}`,
      1,
      {
        operation,
        reason: "production_status_unreadable",
        workspace,
        cause: read.reason,
        alternative: `Repair the workspace so \`arcadia production status\` reads, or, when no run can be affected, rerun with ${FREEZE_OVERRIDE_ENV}=<reason>.`,
        override: `${FREEZE_OVERRIDE_ENV}=<reason>`,
        procedure: FREEZE_PROCEDURE
      }
    );
  }

  const policy = read.policy;
  const observed = {
    operation,
    workspace,
    policyRevision: policy.revision,
    policyEpoch: policy.epoch,
    observedAt: read.observedAt
  };
  if (policy.desiredState !== "active") return { ...observed, state: "inactive", decision: "allowed" };
  if (override) {
    return {
      ...observed,
      state: "active",
      decision: "overridden",
      override,
      warning: `Rehearsal freeze overridden for ${operation} while managed production is Active (revision ${policy.revision}, epoch ${policy.epoch}): ${FREEZE_OVERRIDE_ENV}=${override.reason}`
    };
  }
  throw new ArcadiaError(
    FREEZE_REFUSAL_CODE,
    `Refused ${operation}: managed production is Active (revision ${policy.revision}, epoch ${policy.epoch}), so the rehearsal freeze window is open. ${alternative}`,
    3,
    {
      operation,
      reason: FREEZE_REASON,
      workspace,
      policyRevision: policy.revision,
      policyEpoch: policy.epoch,
      observedAt: read.observedAt,
      alternative,
      override: `${FREEZE_OVERRIDE_ENV}=<reason>`,
      procedure: FREEZE_PROCEDURE
    }
  );
}

/** The receipt lines a decision adds to its command's `warnings`. */
export function freezeReceiptLines(decision: RehearsalFreezeDecision): string[] {
  return [decision.warning, decision.note].filter((line): line is string => Boolean(line));
}

function readPolicy(workspace: string): ReturnType<typeof readProductionPolicySafely> {
  try {
    return withReadOnlyDatabase(workspace, (db) => readProductionPolicySafely(db));
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
      observedAt: new Date().toISOString()
    };
  }
}
