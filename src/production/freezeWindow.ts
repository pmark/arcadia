import { existsSync } from "node:fs";
import { ArcadiaError } from "../cli/errors.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { loadUserConfig, readExperimentWorkspace, userConfigPath } from "../workspace/config.js";
import { canonicalPath } from "../workspace/experimentGuard.js";
import { getWorkspacePaths, resolveWorkspacePath } from "../workspace/paths.js";
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

/** One workspace the freeze check read. */
export interface FreezeObservation {
  workspace: string;
  /** `resolved`: the workspace this command resolves. `default`: the user-config default (the live one). */
  roles: Array<"resolved" | "default">;
  state: "active" | "inactive" | "unreadable";
  policyRevision: number | null;
  policyEpoch: number | null;
  observedAt: string;
  unreadableReason?: string;
}

export interface RehearsalFreezeDecision {
  operation: FreezeOperation;
  /** The workspace that decided: the Active or unreadable one, else the resolved one. */
  workspace: string | null;
  /**
   * The combined state: `active` when any checked workspace reports Active,
   * `unreadable` when none is Active but one cannot be read, `inactive` when
   * every checked workspace reads Inactive, and `no_workspace` when neither a
   * resolved nor a default workspace exists (production cannot be Active
   * without one).
   */
  state: "active" | "inactive" | "unreadable" | "no_workspace";
  policyRevision: number | null;
  policyEpoch: number | null;
  observedAt: string;
  /** Every workspace read, resolved and default (deduplicated). */
  checked: FreezeObservation[];
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

const OVERRIDE_HINT = `Operator override: ${FREEZE_OVERRIDE_ENV}=<reason>; see ${FREEZE_PROCEDURE}`;

/**
 * Refuses `operation` while managed production is Active, and fails closed
 * when a policy cannot be read. The go-broker and launchd services are
 * host-wide, so the check reads both the workspace this command resolves and
 * the user-config default (the live workspace, read-only, recording nothing
 * there), and refuses when either is Active. An experiment workspace keeps
 * its existing path: it never reads the live default (Decision 0082), and its
 * own guard already refuses these host-wide steps first.
 * `ARCADIA_FREEZE_OVERRIDE=<reason>` bypasses either refusal; the returned
 * decision carries the reason, and the caller puts its `warning` in the
 * command's receipt. Returns the decision when the operation may proceed.
 */
export function assertRehearsalFreezeAllows(
  operation: FreezeOperation,
  input: RehearsalFreezeInput = {}
): RehearsalFreezeDecision {
  const env = input.env ?? process.env;
  const overrideReason = env[FREEZE_OVERRIDE_ENV]?.trim() ?? "";
  const override = overrideReason ? { env: FREEZE_OVERRIDE_ENV, reason: overrideReason } as const : undefined;
  const alternative = ALTERNATIVES[operation];
  const now = () => new Date().toISOString();

  const checked = observeWorkspaces(input, env);
  if (checked.length === 0) {
    // First-time setup (`go-broker install` before any workspace exists):
    // managed production needs a workspace and its policy, so with neither a
    // resolved nor a default workspace nothing can be Active.
    return {
      operation,
      workspace: null,
      state: "no_workspace",
      policyRevision: null,
      policyEpoch: null,
      observedAt: now(),
      checked,
      decision: "allowed",
      note: `Rehearsal freeze check for ${operation}: no Arcadia workspace is configured or resolvable, so managed production cannot be Active; proceeding.`
    };
  }

  const resolved = checked.find((entry) => entry.roles.includes("resolved")) ?? checked[0];
  const active = checked.find((entry) => entry.state === "active");
  const unreadable = checked.find((entry) => entry.state === "unreadable");
  const decider = active ?? unreadable ?? resolved;
  const observed = {
    operation,
    workspace: decider.workspace,
    policyRevision: decider.policyRevision,
    policyEpoch: decider.policyEpoch,
    observedAt: decider.observedAt,
    checked
  };
  const which = (entry: FreezeObservation) =>
    entry.roles.includes("resolved") ? `workspace ${entry.workspace}` : `default workspace ${entry.workspace}`;

  if (active) {
    if (override) {
      return {
        ...observed,
        state: "active",
        decision: "overridden",
        override,
        warning: `Rehearsal freeze overridden for ${operation} while managed production is Active in ${which(active)} (revision ${active.policyRevision}, epoch ${active.policyEpoch}): ${FREEZE_OVERRIDE_ENV}=${override.reason}`
      };
    }
    throw new ArcadiaError(
      FREEZE_REFUSAL_CODE,
      `Refused ${operation}: managed production is Active in ${which(active)} (revision ${active.policyRevision}, epoch ${active.policyEpoch}), so the rehearsal freeze window is open. ${alternative} ${OVERRIDE_HINT}`,
      3,
      {
        operation,
        reason: FREEZE_REASON,
        workspace: active.workspace,
        policyRevision: active.policyRevision,
        policyEpoch: active.policyEpoch,
        observedAt: active.observedAt,
        checked,
        alternative,
        override: `${FREEZE_OVERRIDE_ENV}=<reason>`,
        procedure: FREEZE_PROCEDURE
      }
    );
  }

  if (unreadable) {
    if (override) {
      return {
        ...observed,
        state: "unreadable",
        decision: "overridden",
        override,
        unreadableReason: unreadable.unreadableReason,
        warning: `Rehearsal freeze check for ${operation} could not read production status in ${which(unreadable)} (${unreadable.unreadableReason}); proceeding under ${FREEZE_OVERRIDE_ENV}=${override.reason}`
      };
    }
    throw new ArcadiaError(
      FREEZE_UNVERIFIED_CODE,
      `Refused ${operation}: managed production status could not be read in ${which(unreadable)}, so a live rehearsal cannot be ruled out. ${unreadable.unreadableReason} ${OVERRIDE_HINT}`,
      1,
      {
        operation,
        reason: "production_status_unreadable",
        workspace: unreadable.workspace,
        cause: unreadable.unreadableReason,
        checked,
        alternative: `Repair the workspace so \`arcadia production status\` reads, or, when no run can be affected, rerun with ${FREEZE_OVERRIDE_ENV}=<reason>.`,
        override: `${FREEZE_OVERRIDE_ENV}=<reason>`,
        procedure: FREEZE_PROCEDURE
      }
    );
  }

  return { ...observed, state: "inactive", decision: "allowed" };
}

/** The resolved workspace and, outside an experiment, the user-config default, each read once. */
function observeWorkspaces(input: RehearsalFreezeInput, env: NodeJS.ProcessEnv): FreezeObservation[] {
  const targets: Array<{ workspace: string; role: "resolved" | "default" }> = [];
  const resolvedPath = resolveWorkspace({ workspace: input.workspace, cwd: input.cwd, env }).workspacePath;
  if (resolvedPath) targets.push({ workspace: resolvedPath, role: "resolved" });
  const experiment = resolvedPath ? readExperimentWorkspace(resolvedPath) : null;
  if (!experiment) {
    let configured: string | undefined;
    try {
      configured = loadUserConfig(env).defaultWorkspace?.trim() || undefined;
    } catch (error) {
      return [
        ...targets.map((target) => observe(target.workspace, [target.role])),
        unreadableObservation(userConfigPath(env), ["default"], `The user config cannot be read: ${error instanceof Error ? error.message : String(error)}`)
      ];
    }
    if (configured) targets.push({ workspace: resolveWorkspacePath(configured), role: "default" });
  }
  const merged = new Map<string, Array<"resolved" | "default">>();
  for (const target of targets) {
    const key = canonicalPath(target.workspace);
    merged.set(key, [...(merged.get(key) ?? []), target.role]);
  }
  return [...merged.entries()].map(([workspace, roles]) => observe(workspace, roles));
}

function observe(workspace: string, roles: Array<"resolved" | "default">): FreezeObservation {
  const databaseFile = getWorkspacePaths(workspace).databaseFile;
  if (!existsSync(databaseFile)) return unreadableObservation(workspace, roles, `No workspace database at ${databaseFile}.`);
  const read = readPolicy(workspace);
  if (read.status !== "ok") return unreadableObservation(workspace, roles, read.reason, read.observedAt);
  return {
    workspace,
    roles,
    state: read.policy.desiredState === "active" ? "active" : "inactive",
    policyRevision: read.policy.revision,
    policyEpoch: read.policy.epoch,
    observedAt: read.observedAt
  };
}

function unreadableObservation(
  workspace: string,
  roles: Array<"resolved" | "default">,
  reason: string,
  observedAt = new Date().toISOString()
): FreezeObservation {
  return { workspace, roles, state: "unreadable", policyRevision: null, policyEpoch: null, observedAt, unreadableReason: reason };
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
