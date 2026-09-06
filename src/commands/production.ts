import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  PRODUCTION_OFF_CONSEQUENCE,
  buildProductionActivationPreview,
  describeProductionState,
  type ProductionActivationPreview,
  type ProductionDisplayState
} from "../production/activation.js";
import {
  MECHANICAL_TRANSITIONS,
  PRODUCTION_CONTROL_DEADLINES,
  activateProduction,
  countLiveAdmissions,
  deactivateProduction,
  listAdmissions,
  readProductionPolicySafely,
  type AdmissionReceipt,
  type MechanicalTransition,
  type ProductionPolicyRead,
  type ProductionTransitionResult
} from "../production/policy.js";

export interface ProductionStatusOptions {
  workspace: string;
}

export interface ProductionPreviewOptions {
  workspace: string;
  project: string[];
  provider: string[];
  plan?: string[];
  intent?: string;
  concurrency?: string;
  transitions?: string;
}

export interface ProductionActivateOptions extends ProductionPreviewOptions {
  requestId: string;
  grantedBy: string;
  decision?: string;
  expectRevision?: string;
}

export interface ProductionDeactivateOptions {
  workspace: string;
  requestId: string;
  reason?: string;
}

export interface ProductionStatusData {
  read: ProductionPolicyRead;
  display: { state: ProductionDisplayState; label: string; observedAt: string };
  liveAdmissions: number;
  admissions: AdmissionReceipt[];
  offConsequence: string;
  controlDeadlines: typeof PRODUCTION_CONTROL_DEADLINES;
}

export interface ProductionPreviewData {
  preview: ProductionActivationPreview;
}

export interface ProductionTransitionData {
  result: ProductionTransitionResult;
  offConsequence: string;
}

export function runProductionStatusCommand(
  options: ProductionStatusOptions
): CommandSuccess<ProductionStatusData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db) => {
    const read = readProductionPolicySafely(db);
    const admissions = read.status === "ok" ? listAdmissions(db) : [];
    const live = read.status === "ok"
      ? countLiveAdmissions(db, read.policy.epoch, new Date().toISOString())
      : 0;
    return {
      read,
      display: describeProductionState(read, live),
      liveAdmissions: live,
      admissions,
      offConsequence: PRODUCTION_OFF_CONSEQUENCE,
      controlDeadlines: PRODUCTION_CONTROL_DEADLINES
    };
  });

  const warnings = data.read.status === "ok"
    ? []
    : ["Managed production state is unreadable. This is not a confirmed Off; no work may be admitted."];

  return createSuccess({ command: "production.status", workspace: workspacePath, data, warnings });
}

export function runProductionPreviewCommand(
  options: ProductionPreviewOptions
): CommandSuccess<ProductionPreviewData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const preview = withDatabase(workspacePath, (db) =>
    buildProductionActivationPreview(db, previewInput(options))
  );

  const warnings: string[] = [];
  if (preview.unmatched.projects.length > 0) {
    warnings.push(`No queued Actions for: ${preview.unmatched.projects.join(", ")}.`);
  }
  if (preview.unmatched.plans.length > 0) {
    warnings.push(`No queued Actions for Plans: ${preview.unmatched.plans.join(", ")}.`);
  }

  return createSuccess({
    command: "production.preview",
    workspace: workspacePath,
    data: { preview },
    warnings
  });
}

export function runProductionActivateCommand(
  options: ProductionActivateOptions
): CommandSuccess<ProductionTransitionData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (!options.requestId?.trim()) {
    throw validationError("Activation needs a --request-id so a replay is recognised.", {
      field: "requestId"
    });
  }
  if (!options.grantedBy?.trim()) {
    throw validationError("Activation needs --granted-by naming the authorizing operator.", {
      field: "grantedBy"
    });
  }

  const result = withDatabase(workspacePath, (db) => {
    const preview = buildProductionActivationPreview(db, previewInput(options));
    if (preview.orderedActions.length === 0) {
      throw validationError(
        "The requested scope contains no queued Actions; activating would authorize nothing.",
        { projects: options.project, plans: options.plan ?? [] }
      );
    }
    return activateProduction(db, {
      requestId: options.requestId.trim(),
      scope: preview.scope,
      scopeFingerprint: preview.scopeFingerprint,
      grantedBy: options.grantedBy.trim(),
      decisionRef: options.decision ?? null,
      expectedRevision: parseOptionalInteger(options.expectRevision, "expectRevision")
    });
  });

  return createSuccess({
    command: "production.activate",
    workspace: workspacePath,
    data: { result, offConsequence: PRODUCTION_OFF_CONSEQUENCE },
    warnings: result.replayed ? ["Replayed an existing activation receipt; nothing changed."] : []
  });
}

export function runProductionDeactivateCommand(
  options: ProductionDeactivateOptions
): CommandSuccess<ProductionTransitionData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (!options.requestId?.trim()) {
    throw validationError("Deactivation needs a --request-id so a replay is recognised.", {
      field: "requestId"
    });
  }

  const result = withDatabase(workspacePath, (db) =>
    deactivateProduction(db, { requestId: options.requestId.trim(), reason: options.reason })
  );

  const warnings: string[] = [];
  if (!result.withinAcknowledgementDeadline) {
    warnings.push(
      `Off took ${result.elapsedMs}ms, past the ${PRODUCTION_CONTROL_DEADLINES.offAcknowledgementMs}ms control target.`
    );
  }
  if (result.committed.length > 0) {
    warnings.push(
      `${result.committed.length} committed Action(s) are still running and will finish and reconcile.`
    );
  }

  return createSuccess({
    command: "production.deactivate",
    workspace: workspacePath,
    data: { result, offConsequence: PRODUCTION_OFF_CONSEQUENCE },
    warnings
  });
}

export function renderProductionStatusSuccess(
  response: CommandSuccess<ProductionStatusData>
): string[] {
  const { read, display, admissions } = response.data;
  const lines = ["Managed production", `  ${display.label}`, `  Observed: ${display.observedAt}`];

  if (read.status === "ok") {
    const policy = read.policy;
    lines.push(`  Desired state: ${policy.desiredState} (revision ${policy.revision}, epoch ${policy.epoch})`);
    if (policy.scope) {
      lines.push(`  Intent: ${policy.scope.intent}`);
      lines.push(`  Projects: ${policy.scope.projects.join(", ")}`);
      lines.push(`  Plans: ${policy.scope.plans.join(", ")}`);
      lines.push(`  Actions in scope: ${policy.scope.actions.length}`);
      lines.push(`  Providers: ${policy.scope.providers.join(", ")}`);
      lines.push(`  Concurrency: ${policy.scope.maxConcurrentSessions}`);
      lines.push(`  Delegated mechanics: ${policy.scope.mechanicalTransitions.join(", ") || "none"}`);
    }
    if (policy.authority) {
      lines.push(`  Authority: ${policy.authority.grantedBy} at ${policy.authority.grantedAt}`);
    }
    if (policy.revokedAt) {
      lines.push(`  Revoked: ${policy.revokedAt}`);
    }
  }

  const notable = admissions.filter((admission) => admission.status !== "released");
  if (notable.length > 0) {
    lines.push("  Admissions:");
    for (const admission of notable) {
      const suffix = admission.fencedReason ? ` (${admission.fencedReason})` : "";
      lines.push(`    ${admission.status.padEnd(9)} ${admission.actionKey} via ${admission.provider}${suffix}`);
    }
  }

  lines.push(`  Off consequence: ${response.data.offConsequence}`);
  return lines;
}

export function renderProductionPreviewSuccess(
  response: CommandSuccess<ProductionPreviewData>
): string[] {
  const { preview } = response.data;
  const lines = [
    "Managed production activation preview (nothing was written)",
    `  Intent: ${preview.scope.intent}`,
    `  Projects: ${preview.includedProjects.join(", ") || "none"}`,
    `  Plans: ${preview.includedPlans.join(", ") || "none"}`,
    `  Providers: ${preview.scope.providers.join(", ")}`,
    `  Concurrency: ${preview.scope.maxConcurrentSessions}`,
    `  Delegated mechanics: ${preview.scope.mechanicalTransitions.join(", ") || "none"}`,
    `  Scope fingerprint: ${preview.scopeFingerprint}`,
    `  Expected revision: ${preview.expectedRevision ?? "unknown"}`,
    `  Ordered Action scope (${preview.orderedActions.length}):`
  ];
  for (const [index, action] of preview.orderedActions.entries()) {
    lines.push(`    ${index + 1}. ${action.actionKey} [${action.state}] ${action.title}`);
  }
  lines.push("  Activation does not grant:");
  for (const stop of preview.explicitStops) {
    lines.push(`    - ${stop}`);
  }
  lines.push(`  Off consequence: ${preview.offConsequence}`);
  return lines;
}

export function renderProductionTransitionSuccess(
  response: CommandSuccess<ProductionTransitionData>
): string[] {
  const { result } = response.data;
  const lines = [
    result.transition === "activate" ? "Managed production is Active." : "Managed production is Inactive.",
    `  Revision: ${result.revisionBefore} → ${result.policy.revision} (epoch ${result.policy.epoch})`,
    `  Acknowledged in ${result.elapsedMs}ms${result.withinAcknowledgementDeadline ? "" : " — past the control target"}`
  ];
  if (result.fenced.length > 0) {
    lines.push(`  Fenced before launch (${result.fenced.length}):`);
    for (const admission of result.fenced) {
      lines.push(`    ${admission.actionKey} via ${admission.provider}`);
    }
  }
  if (result.committed.length > 0) {
    lines.push(`  Already committed and finishing (${result.committed.length}):`);
    for (const admission of result.committed) {
      lines.push(`    ${admission.actionKey} via ${admission.provider}`);
    }
  }
  lines.push(`  Off consequence: ${response.data.offConsequence}`);
  return lines;
}

function previewInput(options: ProductionPreviewOptions) {
  return {
    projects: options.project ?? [],
    plans: options.plan ?? [],
    providers: options.provider ?? [],
    intent: options.intent ?? "",
    maxConcurrentSessions: parseOptionalInteger(options.concurrency, "concurrency") ?? 1,
    mechanicalTransitions: parseTransitions(options.transitions)
  };
}

function parseTransitions(raw?: string): MechanicalTransition[] {
  if (raw === undefined) {
    return [...MECHANICAL_TRANSITIONS];
  }
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "none") {
    return [];
  }
  return trimmed.split(",").map((value) => value.trim()) as MechanicalTransition[];
}

function parseOptionalInteger(raw: string | undefined, field: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw validationError(`--${field} must be a whole number.`, { field, value: raw });
  }
  return value;
}
