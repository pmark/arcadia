import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { writeTransaction } from "../db/connection.js";
import { validationError } from "../cli/errors.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import type { PlanDoc } from "../docs/types.js";
import { getSchedulingProject } from "../scheduling/store.js";
import {
  applyProductionActivation,
  assertReceiptTransition,
  fingerprintProductionScope,
  findTransitionReceipt,
  normalizeProductionScope,
  readInactiveConfiguration,
  readProductionPolicy,
  resolveConcurrencyGate,
  PRODUCTION_CONTROL_DEADLINES,
  type ConcurrencyGateStatus,
  type InactiveConfigurationNotCarried,
  type ProductionInactiveConfiguration,
  type ProductionTransitionResult
} from "./policy.js";

/**
 * Reactivation after Off. The reviewed configuration Off retained is replayed
 * verbatim into a fresh epoch, or refused with the exact reason it cannot be.
 *
 * Two rules keep this from becoming a second way to broaden authority:
 *
 * - The saved scope is never re-derived. `scope.actions` is the exact allowlist
 *   that was reviewed; a moved pointer or queue produces a refusal naming the
 *   Actions that no longer match, never a narrower or wider scope.
 * - Nothing time-bound or delegated is carried. Integration grants, rehearsal
 *   exceptions and packet-approval delegation are authority, not configuration,
 *   so each needs a fresh grant (Decision 0072).
 *
 * Remote preservation is the one reviewed bound that is replayed: it is part of
 * the fingerprint the operator activated with `--remote-preservation` and the
 * reactivation preview shows, so a replay restores exactly that and never adds
 * it to a configuration that lacked it.
 */

export type ReactivationRefusalCode =
  | "no_saved_configuration"
  | "already_active"
  | "saved_configuration_invalid"
  | "saved_actions_empty"
  | "configuration_fingerprint_corrupt"
  | "packet_approval_expiry_required"
  | "provider_unknown"
  | "action_missing"
  | "action_not_open"
  | "plan_not_active"
  | "project_paused"
  | "policy_revision_moved"
  | "configuration_revision_moved"
  | "configuration_fingerprint_mismatch";

export interface ReactivationRefusal {
  code: ReactivationRefusalCode;
  reason: string;
  remedy: string;
}

export interface ReactivationExpectations {
  policyRevision: number;
  configurationRevision: number;
  fingerprint: string;
}

export interface ProductionReactivationPreview {
  generatedAt: string;
  /** True only when no refusal applies; apply still re-checks inside its transaction. */
  ready: boolean;
  refusals: ReactivationRefusal[];
  currentPolicy: { desiredState: "active" | "inactive"; revision: number; epoch: number };
  configuration: ProductionInactiveConfiguration | null;
  /** Pass these back to `production reactivate`; null when nothing is saved. */
  expected: ReactivationExpectations | null;
  /** Fields Off dropped, which a reactivation does not restore. */
  notCarried: InactiveConfigurationNotCarried[];
  /** The concurrency this configuration would actually enforce, and why. */
  concurrencyGate: ConcurrencyGateStatus | null;
  controlDeadlines: typeof PRODUCTION_CONTROL_DEADLINES;
}

interface ActionDrift {
  /** Fingerprint of the saved configuration this was computed for. */
  fingerprint: string;
  missing: string[];
  notOpen: string[];
  inactivePlans: string[];
}

export interface ReactivationContext {
  now?: Date;
  /** Plan-document drift computed outside any transaction; used only when its fingerprint still matches. */
  drift?: ActionDrift;
  /** Known coding-agent provider ids; omit to skip the provider check. */
  knownProviders?: string[];
}

const NO_SAVED_CONFIGURATION: ReactivationRefusal = {
  code: "no_saved_configuration",
  reason:
    "No reviewed configuration was saved. Production was switched Off before one existed, or has never been activated, and Arcadia does not reconstruct scope from old receipts.",
  remedy:
    "Run `arcadia production preview` and `arcadia production activate` once from the CLI to establish a scope; the next Off will then retain it."
};

/** Read-only: every reason the saved configuration cannot be reactivated right now. */
export function evaluateReactivation(
  db: Database.Database,
  context: ReactivationContext = {}
): ProductionReactivationPreview {
  const generatedAt = (context.now ?? new Date()).toISOString();
  const policy = readProductionPolicy(db);
  const configuration = readInactiveConfiguration(db);
  const refusals: ReactivationRefusal[] = [];
  const currentPolicy = { desiredState: policy.desiredState, revision: policy.revision, epoch: policy.epoch };

  if (policy.desiredState === "active") {
    refusals.push({
      code: "already_active",
      reason: `Production is already Active at revision ${policy.revision}, epoch ${policy.epoch}; reactivating would only churn the epoch and fence fresh admissions.`,
      remedy: "Nothing to do. Switch Off first if a fresh epoch is wanted."
    });
  }

  if (!configuration) {
    refusals.push(NO_SAVED_CONFIGURATION);
    return finish(db, generatedAt, refusals, currentPolicy, null, null, null);
  }

  const scope = configuration.scope;
  const delegatesPacketApproval = scope.mechanicalTransitions.includes("packet_approval");
  if (delegatesPacketApproval) {
    refusals.push({
      code: "packet_approval_expiry_required",
      reason:
        "The saved configuration delegates packet approval, which is only ever granted with its own expiry and is not carried across Off (Decision 0072).",
      remedy: "Grant it afresh from the CLI with `--transitions ... --packet-approval-expires-at`; the toggle cannot restore it."
    });
  }

  // The delegation was reported above with its own code; validate the rest of
  // the scope without it so that one cause does not also read as "invalid".
  let normalizedOk = true;
  try {
    normalizeProductionScope({
      ...scope,
      mechanicalTransitions: scope.mechanicalTransitions.filter((transition) => transition !== "packet_approval")
    });
  } catch (error) {
    normalizedOk = false;
    refusals.push({
      code: "saved_configuration_invalid",
      reason: `The saved configuration no longer validates: ${error instanceof Error ? error.message : String(error)}`,
      remedy: "Re-establish the scope with `arcadia production preview` and `activate`."
    });
  }

  if (normalizedOk && fingerprintProductionScope(scope) !== configuration.fingerprint) {
    refusals.push({
      code: "configuration_fingerprint_corrupt",
      reason: "The saved configuration does not match its recorded fingerprint, so it is not the scope that was reviewed.",
      remedy: "Do not edit the store. Re-establish the scope with `arcadia production preview` and `activate`."
    });
  }

  if (scope.actions.length === 0) {
    // An empty allowlist means "every Action of the Plan" to the admission gate,
    // so a saved empty list must refuse rather than quietly authorize everything.
    refusals.push({
      code: "saved_actions_empty",
      reason: "The saved configuration names no Actions, which would authorize every Action of its Plans.",
      remedy: "Re-establish an exact Action allowlist with `arcadia production preview --action ...`."
    });
  }

  if (context.knownProviders) {
    const unknown = scope.providers.filter((provider) => !context.knownProviders!.includes(provider));
    if (unknown.length > 0) {
      refusals.push({
        code: "provider_unknown",
        reason: `Saved provider(s) are no longer configured coding-agent providers: ${unknown.join(", ")}.`,
        remedy: "Re-establish the scope with a configured provider via `arcadia production preview`."
      });
    }
  }

  // The saved Action list is judged against the Plan documents, the authority
  // for Action status. The queue is not used: it lists finished Actions as
  // needing attention and lists dependents as waiting, so neither its membership
  // nor its state says whether the reviewed Action is still open. Any drift
  // refuses; the saved list is never narrowed, widened or re-derived.
  const drift =
    context.drift && context.drift.fingerprint === configuration.fingerprint
      ? context.drift
      : findActionDrift(db, configuration.fingerprint, scope.actions, scope.plans);
  if (drift.missing.length > 0) {
    refusals.push({
      code: "action_missing",
      reason: `Saved Action(s) are not in any saved Plan any more (removed, renamed or its Project has no repository): ${drift.missing.join(", ")}.`,
      remedy: "Re-establish the scope with `arcadia production preview` for the Actions that should now run; the saved list is never narrowed for you."
    });
  }
  if (drift.notOpen.length > 0) {
    refusals.push({
      code: "action_not_open",
      reason: `Saved Action(s) are no longer open (done, blocked or deferred): ${drift.notOpen.join(", ")}.`,
      remedy: "Re-establish the scope with `arcadia production preview` for the work that should now run."
    });
  }
  if (drift.inactivePlans.length > 0) {
    refusals.push({
      code: "plan_not_active",
      reason: `Saved Plan(s) are not active Plans any more: ${drift.inactivePlans.join(", ")}.`,
      remedy: "Re-establish the scope with `arcadia production preview` against the Plan that is now active."
    });
  }

  // The first activation refused a paused Project; On must not succeed while the
  // tick would skip every launch for it.
  const paused = scope.projects.filter((slug) => getSchedulingProject(db, slug).pausedReason !== null);
  if (paused.length > 0) {
    refusals.push({
      code: "project_paused",
      reason: `Saved Project(s) are paused for scheduling: ${paused.join(", ")}. Reactivating would admit nothing for them.`,
      remedy: "Resume the Project (`arcadia schedule resume`) or re-establish the scope without it."
    });
  }

  return finish(
    db,
    generatedAt,
    refusals,
    currentPolicy,
    configuration,
    {
      policyRevision: policy.revision,
      configurationRevision: configuration.configurationRevision,
      fingerprint: configuration.fingerprint
    },
    normalizedOk ? scope : null
  );
}

const CLOSED_ACTION_STATUSES = new Set(["done", "blocked", "deferred"]);

/**
 * Reads each saved Plan from its Project's repository and reports which saved
 * Actions are gone, closed, or inside a Plan that is no longer active.
 */
function findActionDrift(
  db: Database.Database,
  fingerprint: string,
  actions: string[],
  plans: string[]
): ActionDrift {
  const projects = new Map(listProjects(db).map((project) => [project.slug, project]));
  const discovered = new Map<string, ReturnType<typeof discoverDocs> | null>();
  const docsFor = (projectSlug: string) => {
    if (discovered.has(projectSlug)) return discovered.get(projectSlug)!;
    const project = projects.get(projectSlug);
    const repoPath = project ? getProjectMetadata(db, project.id)?.repo_path?.trim() : null;
    let result: ReturnType<typeof discoverDocs> | null = null;
    if (repoPath && existsSync(repoPath)) result = discoverDocs(realpathSync(path.resolve(repoPath)));
    discovered.set(projectSlug, result);
    return result;
  };

  const planDocs = new Map<string, PlanDoc | null>();
  const inactivePlans: string[] = [];
  for (const planKey of plans) {
    const [projectSlug, ...rest] = planKey.split("/");
    const planSlug = rest.join("/");
    const doc =
      docsFor(projectSlug)?.docs.find(
        (candidate): candidate is PlanDoc =>
          candidate.type === "plan" && candidate.project === projectSlug && candidate.slug === planSlug
      ) ?? null;
    planDocs.set(planKey, doc);
    if (doc && doc.status !== "active") inactivePlans.push(planKey);
  }

  const missing: string[] = [];
  const notOpen: string[] = [];
  for (const key of actions) {
    const [projectSlug, ...rest] = key.split("/");
    const actionId = rest.join("/");
    const found = plans
      .filter((planKey) => planKey.startsWith(`${projectSlug}/`))
      .map((planKey) => planDocs.get(planKey)?.actions.find((action) => action.id === actionId))
      .find((action) => action !== undefined);
    if (!found) missing.push(key);
    else if (CLOSED_ACTION_STATUSES.has(found.status)) notOpen.push(key);
  }
  // A saved Plan that is missing entirely surfaces as its Actions being missing.
  return { fingerprint, missing, notOpen, inactivePlans };
}

function finish(
  db: Database.Database,
  generatedAt: string,
  refusals: ReactivationRefusal[],
  currentPolicy: ProductionReactivationPreview["currentPolicy"],
  configuration: ProductionInactiveConfiguration | null,
  expected: ReactivationExpectations | null,
  gateScope: ProductionInactiveConfiguration["scope"] | null
): ProductionReactivationPreview {
  return {
    generatedAt,
    ready: refusals.length === 0,
    refusals,
    currentPolicy,
    configuration,
    expected,
    notCarried: configuration?.notCarried ?? [],
    concurrencyGate: gateScope ? resolveConcurrencyGate(db, gateScope, generatedAt) : null,
    controlDeadlines: PRODUCTION_CONTROL_DEADLINES
  };
}

export interface ReactivateProductionInput {
  requestId: string;
  grantedBy: string;
  decisionRef?: string | null;
  /** All three are required: a reactivation without a preview to bind to is refused. */
  expected: ReactivationExpectations;
  now?: Date;
  knownProviders?: string[];
}

export interface ReactivationRefusalDetails {
  /** Makes the dashboard answer 409 (a conflict with current state) rather than 400. */
  conflict: true;
  code: ReactivationRefusalCode;
  remedy: string;
  refusals: ReactivationRefusal[];
}

/** Carried on the thrown validation error so the CLI and dashboard relay the exact gate. */
export function refusalDetails(refusals: ReactivationRefusal[]): ReactivationRefusalDetails {
  return { conflict: true, code: refusals[0].code, remedy: refusals[0].remedy, refusals };
}

/**
 * Validates and applies in one IMMEDIATE transaction, so no Off, On or queue
 * change can land between the drift check and the activation write. A replayed
 * request id returns its original receipt before any current-state check.
 */
export function reactivateProduction(
  db: Database.Database,
  input: ReactivateProductionInput
): ProductionTransitionResult {
  const startedAt = Date.now();
  const at = (input.now ?? new Date()).toISOString();

  // Reading Plan documents is disk I/O. Do it before taking the write lock so a
  // slow repository cannot hold up an Off; the result is used only if the saved
  // configuration it was computed for is still the one inside the transaction.
  const saved = readInactiveConfiguration(db);
  const drift = saved ? findActionDrift(db, saved.fingerprint, saved.scope.actions, saved.scope.plans) : undefined;

  const result = writeTransaction(db, () => {
    const replay = findTransitionReceipt(db, input.requestId);
    if (replay) {
      assertReceiptTransition(replay, input.requestId, "activate");
      if (replay.scope_fingerprint !== null && replay.scope_fingerprint !== input.expected.fingerprint) {
        throw validationError("This request id already settled a different configuration; use a new request id.", {
          conflict: true,
          requestId: input.requestId,
          code: "configuration_fingerprint_mismatch",
          previousScopeFingerprint: replay.scope_fingerprint,
          requestedScopeFingerprint: input.expected.fingerprint
        });
      }
      return { replayed: true, revisionBefore: replay.revision_before };
    }

    const preview = evaluateReactivation(db, { now: input.now, knownProviders: input.knownProviders, drift });
    const refusals = [...preview.refusals];
    if (preview.configuration) {
      const { expected } = input;
      if (expected.policyRevision !== preview.currentPolicy.revision) {
        refusals.push({
          code: "policy_revision_moved",
          reason: `Production policy moved from revision ${expected.policyRevision} to ${preview.currentPolicy.revision} since it was previewed.`,
          remedy: "Preview again and reactivate against the current revision."
        });
      }
      if (expected.configurationRevision !== preview.configuration.configurationRevision) {
        refusals.push({
          code: "configuration_revision_moved",
          reason: `The saved configuration moved from revision ${expected.configurationRevision} to ${preview.configuration.configurationRevision}.`,
          remedy: "Preview again; a later Off saved a different configuration."
        });
      }
      if (expected.fingerprint !== preview.configuration.fingerprint) {
        refusals.push({
          code: "configuration_fingerprint_mismatch",
          reason: "The saved configuration is not the one that was previewed.",
          remedy: "Preview again and review the configuration before reactivating."
        });
      }
    }
    if (refusals.length > 0) {
      throw validationError(`Reactivation refused: ${refusals[0].reason}`, { ...refusalDetails(refusals) });
    }

    const configuration = preview.configuration!;
    const applied = applyProductionActivation(
      db,
      {
        requestId: input.requestId,
        scope: configuration.scope,
        scopeFingerprint: configuration.fingerprint,
        grantedBy: input.grantedBy,
        decisionRef: input.decisionRef ?? null,
        expectedRevision: input.expected.policyRevision
      },
      at,
      {
        reactivation: {
          configurationRevision: configuration.configurationRevision,
          fingerprint: configuration.fingerprint,
          savedAtPolicyRevision: configuration.savedAtPolicyRevision,
          sourceEpoch: configuration.sourceEpoch,
          notCarried: configuration.notCarried
        }
      }
    );
    return applied;
  });

  const elapsedMs = Date.now() - startedAt;
  return {
    transition: "activate",
    policy: readProductionPolicy(db),
    revisionBefore: result.revisionBefore,
    replayed: result.replayed,
    fenced: [],
    committed: [],
    elapsedMs,
    withinAcknowledgementDeadline: elapsedMs <= PRODUCTION_CONTROL_DEADLINES.offAcknowledgementMs
  };
}
