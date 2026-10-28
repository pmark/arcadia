import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError, validationError } from "../cli/errors.js";
import { observeProviderCapacity, type ProviderCapacityObservation } from "../codingAgents/capacity.js";
import { checkProviderSignIn, type ProviderSignInStatus } from "../codingAgents/signIn.js";
import { loadWorkspaceConfig, unmeteredProviderSelector } from "../workspace/config.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { TIER_AGENTS, loadModelTierRegistry, sessionStartBinding, type ModelTierRegistry, type TierAgent } from "../codingAgents/modelTiers.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { writeTransaction } from "../db/connection.js";
import { isDispatchable, resolveDispatch } from "../docs/dispatch.js";
import { git, resolveBaseBranch, tryGit } from "../git/worktrees.js";
import { normalizeAgentAsk } from "../ask/agentAsk.js";
import { retiredCompletionDraftMessage } from "../qa/patchApplicability.js";
import { draftPathsAt } from "../ask/autoSettleBeforeDispatch.js";
import { commitTreeAt } from "./candidateSnapshot.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { assertWorkerCapability, type EnvironmentWall } from "../production/sessionCapability.js";
import { commitAdmission, issueAdmission, listAdmissions, releaseAdmission, type AdmissionReceipt } from "../production/policy.js";
import {
  canonicalPath,
  failPreparedSession,
  getActiveActionClaim,
  getRepositoryLease,
  getSession,
  launchPreparedSession,
  prepareSession,
  releaseActionClaim,
  releaseWorktreeReservation,
  reserveAgentWorktree,
  sessionAgentForProvider,
  systemTmux,
  type AgentSession,
  type TmuxAdapter
} from "./index.js";
import { buildLaunchPreview, type LaunchPreview } from "./launchPreview.js";
import { checkLaunchPrerequisites, refuseUnlessSignedIn } from "./launchPreflight.js";
import { liveMutationOwner, recordSessionRoleAttemptTerminal, type SessionRoleAttempt } from "./enrollment.js";
import { beginDevelopmentAttempt, markDevelopmentAttemptRunning, planDevelopmentAttempt, requirementForSession, requirementIdFor, requirementIdentity } from "./roleLineage.js";
import {
  assertDraftRecoveryUnchanged,
  commitDraftHandout,
  evaluateDraftOnlyCandidate,
  recordDraftRecoveryReceipt,
  voidDraftHandoutIfUnlaunched,
  type DraftRecoveryReceipt
} from "./draftOnlyCandidate.js";
import { getResumableLeaseHandoff, getSessionContinuation, restoreLeaseHandoffIfSupersededBy, type SessionExitReceipt } from "./reconciliation.js";
import { getSessionRepair, releaseRepairSession } from "./reviewRepair.js";
import { buildAgentLaunchCommand, prepareAgentWorktree, type PreparedAgentWorktree } from "./worktreePreparation.js";
import { verifyFixtureStandingLaunch, type FetchDecisionFile, type FixtureStandingBasis } from "./fixtureStandingLaunch.js";
import { assertOperatorLaunchRequestAvailable, mintOperatorLaunchAuthorization, refuseInsideArcadiaSession, voidOperatorLaunchAuthorization, type OperatorLaunchSource } from "./operatorLaunch.js";

export interface GuardedLaunchInput {
  db: Database.Database;
  workspace: string;
  /** The canonical repository (the primary checkout), never the launched worktree. */
  repoRoot: string;
  projectSlug: string;
  requestId: string;
  /**
   * The current explicit one-Session launch grant: the fingerprint of the
   * preview the operator approved. Exactly one of `previewFingerprint` or
   * `standingPolicy` must be given.
   */
  previewFingerprint?: string;
  /**
   * Launch under a standing managed-production policy grant instead of a
   * fresh human click: admits against the Active policy's current epoch and
   * rechecks Off immediately before launch commitment. Exactly one of
   * `previewFingerprint` or `standingPolicy` must be given.
   */
  standingPolicy?: boolean;
  /**
   * A confirmed operator Launch (Decision 0096): mint the one-shot
   * authorization for the Session this call creates, so its exit is
   * validated, committed, pushed and (on accepted completion) opened as a
   * draft PR without production Active. The caller has already confirmed it
   * (the dashboard route's confirmation step, or `--operator-launch` at an
   * interactive terminal). Only with `previewFingerprint`; never from inside
   * an Arcadia Session; a reused Session mints nothing. `env` is test-only.
   */
  operatorLaunch?: {
    source: OperatorLaunchSource;
    /** Required with, and only with, `source: "fixture_standing"` (Decision 0100): the invoking agent, recorded in the receipt. */
    standing?: { agentIdentity: string };
    /** Test-only: replaces the GitHub fetch of Decision 0100. Never set by the CLI or the environment. */
    fetchDecision?: FetchDecisionFile;
    env?: NodeJS.ProcessEnv;
  };
  /**
   * With `standingPolicy`, the production epoch the caller observed. A
   * differing current epoch refuses at admission (`stale_epoch`) before any
   * slot, worktree or claim exists, so an Off/On cycle cannot admit a launch
   * prepared against the earlier grant.
   */
  expectedPolicyEpoch?: number;
  /**
   * Host enrollment only. The reuse branch below may hand back only a lease
   * this exact request created (its `admission_request_id` is
   * `${requestId}:admission`); any other prepared or running lease -- another
   * enrollment's, the tick's, an operator's -- refuses with `action_claimed`
   * before any admission. A reused own lease must also carry the current
   * `expectedPolicyEpoch`. Other callers keep the unchanged reuse semantics.
   */
  reuseOwnLeaseOnly?: boolean;
  /**
   * Standing policy only: launch a review repair Session (src/production/reviewRepair.ts)
   * for the current Action instead of a fresh one. Its worktree is a NEW branch cut at
   * `startRevision` (the failed candidate's work before its completion settlement), its
   * lineage base is the failed candidate's own base revision, the failed candidate's
   * Action claim moves to it, and its development attempt supersedes the passed attempt
   * whose candidate failed review. The pending repair row `requestId` is bound in the
   * Session insert's transaction.
   */
  repair?: {
    requestId: string;
    failedSessionId: string;
    /** The failed candidate's Action: the pointer must still name it, or nothing launches. */
    actionId: string;
    failedWorktreePath: string;
    /** The failed candidate's head: its own completion Ask is read from the history it added to the base. */
    failedHead: string;
    startRevision: string;
    baseRevision: string;
    supersedesDevelopmentAttempt: string;
  };
  /**
   * Per-launch wall-clock limit override in ms for this Session; omitted
   * defers to the policy scope's `sessionTimeLimitMs`, then the default. See
   * `src/production/sessionLifetime.ts`.
   */
  timeLimitMs?: number;
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  /** Test-only override for where the new agent worktree is created. */
  agentWorktreeRoot?: string;
  /** Test-only override for the standing-policy provider capacity observation. */
  capacityObservation?: ProviderCapacityObservation;
  /**
   * Test-only: an environment (a stubbed PATH) to run the provider binary,
   * permission-posture and sign-in preflight against. Omitted, those checks
   * run against the real environment and are skipped under Vitest.
   */
  preflightEnv?: NodeJS.ProcessEnv;
  /**
   * Session capability preflight (workspace write, host validation,
   * preservation), run before any admission, worktree or process so a wall
   * costs no tokens. Defaults to `probeWorkerCapability`, skipped under
   * Vitest like the provider prerequisites; a caller or test may override.
   */
  workerCapability?: (workspace: string, profileSandbox: string | null) => EnvironmentWall[];
  /** Test-only override for the provider sign-in preflight; defaults to `checkProviderSignIn`. */
  providerSignIn?: (provider: string, workspace: string) => ProviderSignInStatus | null;
  /**
   * Called the moment sign-in is confirmed -- not merely attempted -- so a
   * caller tracking a durable "signed out" blocker (the managed-production
   * tick) can clear it right away, independent of whether a later launch
   * step (worktree creation, spawn) goes on to fail for an unrelated reason.
   */
  onProviderSignInConfirmed?: (provider: string) => void;
  now?: Date;
  tmux?: TmuxAdapter;
  testHooks?: {
    /** Deterministic fault injection between worktree creation and reservation commit. */
    afterWorktreeCreatedBeforeReservationCommit?: () => void;
    /** Deterministic fault injection between admission issuance and its launch-time commit recheck. */
    afterAdmissionIssuedBeforeCommit?: () => void;
    /** Deterministic fault injection inside `prepareSession`, before its Session row insert. */
    beforeSessionInsert?: () => void;
    /** Deterministic fault injection after the Session row exists, before its admission commits. */
    afterSessionPreparedBeforeCommit?: () => void;
    /** Deterministic injection after a draft-only handout committed, before its launch-time hash verification. */
    beforeDraftLaunchVerification?: () => void;
  };
}

export interface GuardedLaunchResult {
  /** True when an already-durable Session satisfied this request instead of a new one being created. */
  reused: boolean;
  session: AgentSession;
  preview: LaunchPreview;
  /** The epoch-bound admission this launch committed against, when launched under a standing policy grant. */
  admission: AdmissionReceipt | null;
}

/**
 * The single entry point a guarded host launch operation (CLI or HTTP) must
 * call. It re-derives everything from disk and the database at call time —
 * never trusting a caller-supplied dispatch, packet hash, or selection — and
 * is safe to call more than once for the same intended launch: a second call
 * that targets the exact same previewed Action and packet reconciles onto the
 * first call's durable result (an in-flight "prepared" Session is resumed to
 * "running"; an already-"running" Session is returned as-is) instead of
 * starting a second process or erroring. A call that targets a different
 * Action while this repository already holds a lease is refused.
 */
export function launchGuardedHostSession(input: GuardedLaunchInput): GuardedLaunchResult {
  if (input.timeLimitMs !== undefined && (!Number.isInteger(input.timeLimitMs) || input.timeLimitMs < 1)) {
    throw validationError("The Session time limit must be a positive whole number of milliseconds.", { timeLimitMs: input.timeLimitMs });
  }
  if (input.standingPolicy && input.previewFingerprint) {
    throw validationError(
      "A launch may not carry both an operator-approved preview fingerprint and a standing production policy grant."
    );
  }
  if (!input.standingPolicy && !input.previewFingerprint) {
    throw validationError(
      "A launch must carry either an operator-approved preview fingerprint or the standing production policy grant."
    );
  }

  if (input.repair && (!input.standingPolicy || input.operatorLaunch)) {
    throw validationError("A review repair Session is launched only under the standing production policy.", { code: "repair_requires_standing_policy" });
  }
  if (input.operatorLaunch) {
    if (input.standingPolicy) {
      throw validationError("An operator launch authorization is minted only by a confirmed, fingerprinted Launch, never under the standing production policy.");
    }
    // Refused before anything is reserved or started.
    refuseInsideArcadiaSession(input.operatorLaunch.env);
  }
  // Decision 0100: a standing fixture mint is verified here, before anything is
  // reserved, so no caller can mint one without every condition holding.
  let standingBasis: FixtureStandingBasis | undefined;
  if (input.operatorLaunch?.source === "fixture_standing") {
    standingBasis = verifyFixtureStandingLaunch(input.db, {
      workspace: input.workspace, repoRoot: path.resolve(input.repoRoot), projectSlug: input.projectSlug,
      agentIdentity: input.operatorLaunch.standing?.agentIdentity, env: input.operatorLaunch.env, now: input.now ?? new Date(),
      fetchDecision: input.operatorLaunch.fetchDecision
    });
  } else if (input.operatorLaunch?.standing) {
    throw validationError("Only a --fixture-standing launch carries a standing basis.", { code: "operator_launch_standing_mismatch" });
  }

  const repoRoot = path.resolve(input.repoRoot);
  // The canonical authorization survives terminal reconciliation. Only this
  // request's still-leased Session may be returned; no post-exit replay mints
  // a second principal, even if Go and its preview are unchanged.
  const requestRepository = canonicalPath(repoRoot);
  assertOperatorLaunchRequestAvailable(input.db, requestRepository, input.requestId, getRepositoryLease(input.db, repoRoot)?.id);
  const assertFreshRequest = () => assertOperatorLaunchRequestAvailable(input.db, requestRepository, input.requestId);
  const now = input.now ?? new Date();
  const tmux = input.tmux ?? systemTmux;
  const registry = loadModelTierRegistry(input.workspace);
  // Every launch step that spawns the provider (a fresh launch, a reused or
  // resumed lease) is gated on this one probe, so the provider binary and its
  // headless permission posture are checked right before sign-in does, with
  // nothing reserved yet: a missing prerequisite costs the next tick nothing.
  const signInProbe = input.providerSignIn ?? ((provider: string, workspace: string) => checkProviderSignIn(provider, workspace, input.preflightEnv));
  const providerSignIn = (provider: string, workspace: string): ProviderSignInStatus | null => {
    checkLaunchPrerequisites({ provider, headless: true, env: input.preflightEnv });
    return signInProbe(provider, workspace);
  };
  const onProviderSignInConfirmed = input.onProviderSignInConfirmed;

  const preview = buildLaunchPreview({
    db: input.db,
    workspace: input.workspace,
    repoRoot,
    projectSlug: input.projectSlug,
    requestId: input.requestId,
    profiles: input.profiles,
    adapters: input.adapters,
    tmux,
    now,
    ...(input.repair
      ? { supersededCompletionAskIds: candidateCompletionAskIds(repoRoot, input.projectSlug, input.repair.baseRevision, input.repair.failedHead, input.repair.actionId) }
      : (() => { const resumed = resumedSessionSupersededAskIds(input.db, repoRoot, input.projectSlug, tmux); return resumed ? { supersededCompletionAskIds: resumed } : {}; })())
  });

  if (input.repair && preview.actionId !== input.repair.actionId) {
    throw validationError(`A review repair of ${input.repair.actionId} launches only while the governed pointer names it (it names ${preview.actionId ?? "nothing"}).`, {
      code: "repair_pointer_moved", conflict: true
    });
  }

  // Reconcile onto an already-durable result first, before any staleness
  // check: a lost HTTP response or a second tab retrying the same approved
  // launch must recover the existing Session even though re-previewing now
  // reports its own lease as a "conflicting execution" prerequisite (which
  // would otherwise change the fingerprint and make a correct retry look
  // stale). This is the only path that may return a Session whose packet or
  // pointer are not this preview's freshly-recomputed "ready" state — because
  // it is not creating anything, only handing back what this exact request
  // already caused.
  const existingLease = getRepositoryLease(input.db, repoRoot);
  if (existingLease && input.reuseOwnLeaseOnly) {
    const ownAdmission = `${input.requestId}:admission`;
    if (existingLease.admission_request_id !== ownAdmission) {
      throw validationError("The repository already has a prepared or running Session this request did not create; it is never re-issued.", {
        code: existingLease.action_id === preview.actionId ? "action_claimed" : "repository_leased",
        sessionId: existingLease.id,
        conflict: true
      });
    }
    const admission = listAdmissions(input.db).find((row) => row.requestId === ownAdmission) ?? null;
    if (input.expectedPolicyEpoch !== undefined && admission?.epoch !== input.expectedPolicyEpoch) {
      throw validationError("This request's own Session was admitted under an earlier production epoch; it is not resumed under the current grant.", {
        code: "stale_epoch", sessionId: existingLease.id, admittedEpoch: admission?.epoch ?? null, currentEpoch: input.expectedPolicyEpoch, conflict: true
      });
    }
    if (!matchesPreview(existingLease, preview)) {
      // Checked before any admission commit: an own lease for another packet
      // or Action is never resumed, and its issued slot is not consumed.
      throw validationError("This request's own Session no longer matches the governed Action and packet; it is not resumed.", {
        code: "enrollment_launch_identity_changed", sessionId: existingLease.id, conflict: true
      });
    }
    // A crash between `prepareSession` and `commitAdmission` leaves the own
    // lease prepared with its admission still issued. Commit it (idempotent
    // for an already-committed one) only after the reuse checks below pass
    // and before the process may start, so a resumed Session always runs on a
    // committed slot; an expired, fenced or released admission refuses instead.
    const commitOwnAdmission = () => {
      const committed = admission ? commitAdmission(input.db, ownAdmission, now) : null;
      if (!committed?.admitted) {
        throw validationError("This request's own Session has no committable admission; it is not started.", {
          code: committed?.code ?? "admission_missing", sessionId: existingLease.id, conflict: true
        });
      }
    };
    return reusedLease(input, existingLease, preview, tmux, registry, providerSignIn, now, commitOwnAdmission);
  }
  if (existingLease && matchesPreview(existingLease, preview)) {
    return reusedLease(input, existingLease, preview, tmux, registry, providerSignIn, now);
  }

  if (!input.standingPolicy && preview.previewFingerprint !== input.previewFingerprint) {
    throw validationError("The launch preview is stale or was altered since it was approved; re-preview before launching.", {
      expectedFingerprint: input.previewFingerprint,
      currentFingerprint: preview.previewFingerprint,
      conflict: true
    });
  }

  if (existingLease) {
    throw validationError("The repository already has a prepared or running Session for a different Action.", {
      sessionId: existingLease.id,
      conflict: true
    });
  }

  if (!preview.ready || !preview.actionId || !preview.selection || !preview.packet) {
    throw validationError("The previewed Action is not ready to launch.", {
      prerequisites: preview.prerequisites,
      conflict: true,
      // Lets a caller (the managed-production tick) distinguish a refusal whose
      // remedy needs an operator or agent action from one time alone resolves,
      // without re-deriving packet lifecycle state itself.
      packetLifecycleKind: preview.packetLifecycle?.kind ?? null,
      packetLifecycleRemedy: preview.packetLifecycle?.remedy ?? null,
      packetLifecycleDecisionId: preview.packetLifecycle?.kind === "build_packet_approval_pending" ? preview.packetLifecycle.decisionId : null,
      // Named the same as `issueAdmission`'s own refusal code (policy.ts) so a
      // caller need not distinguish "caught at preview" from "caught at
      // admission" -- both are the identical policy-provider mismatch.
      code: preview.prerequisites.some((entry) => entry.startsWith("provider not permitted"))
        ? "provider_not_permitted"
        // Never self-resolving: nothing but an operator editing the
        // Project's metadata clears this, so the managed-production tick
        // must escalate rather than silently retry it forever.
        : preview.prerequisites.some((entry) => entry.startsWith("no validation commands"))
          ? "no_validation_commands"
          : null
    });
  }

  const dispatch = resolveDispatch(repoRoot, input.projectSlug);
  if (!isDispatchable(dispatch) || dispatch.context?.action.id !== preview.actionId) {
    throw validationError("The governed pointer changed since the preview was built; re-preview before launching.", { conflict: true });
  }

  // Resolve the Session adapter before reserving anything. A provider that is
  // enabled in the adapter registry but has no Session adapter must refuse here,
  // before `issueAdmission` can reserve a concurrency slot it would never commit.
  const agent = sessionAgentForProvider(preview.selection.provider);
  if (!agent) {
    throw validationError(
      `No Session launch adapter is registered for provider "${preview.selection.provider}".`,
      { conflict: true }
    );
  }
  // A selection reused from an immutable packet carries no profile; its sandbox is then unknown (null).
  // An already-durable own lease is returned (or resumed) above, before this
  // point: reused and resumed leases are covered only by the exit-side no-diff stop.
  assertWorkerCapability({
    workspace: input.workspace,
    actionLabel: `${preview.projectSlug}/${preview.actionId}`,
    profileSandbox: preview.selection.profile?.sandbox ?? null,
    override: input.workerCapability
  });
  // Checked from this worker process's own context, before issueAdmission
  // reserves a concurrency slot and before any worktree or lease is created:
  // a signed-out provider must take no admission and no lease, so the next
  // tick can retry it for free once sign-in is restored.
  refuseUnlessSignedIn(preview.selection.provider, providerSignIn(preview.selection.provider, input.workspace), onProviderSignInConfirmed);

  // The one mutation-owning development attempt this launch runs under. Its
  // refusals (a passed or exhausted lineage, a live owner whose Session still
  // runs) are checked here, read-only, after every deterministic launch
  // prerequisite and before any admission, worktree or Session; the attempt
  // itself is allocated only after the admission's Off/epoch cutoff commits
  // below, so an Off or stale-epoch refusal never leaves a pending attempt. A
  // live attempt for the same requirement input is resumed rather than
  // duplicated; after a terminal failure the launch grant this call carries (a
  // standing policy or an approved preview) authorizes the next bounded ordinal.
  const requirement = requirementIdentity({ projectSlug: preview.projectSlug, planSlug: dispatch.context.activePlan, action: dispatch.context.action });
  try {
    planDevelopmentAttempt(input.db, { requirement, retryAuthorized: true, supersedesPassed: input.repair?.supersedesDevelopmentAttempt ?? null });
  } catch (error) {
    throw lineageRefusal(error);
  }

  // The Session starts on the registry's start tier (light by default) for its
  // provider; the packet-bound selection stays the plan's tier, which the brief
  // names as the escalation target. The fixture provider has no tier.
  const startBinding = (TIER_AGENTS as readonly string[]).includes(agent) ? sessionStartBinding(agent as TierAgent, registry) : null;
  const model = startBinding?.model ?? preview.selection.model;
  const effort = startBinding ? startBinding.effort : (preview.selection.effort ?? null);

  let admission: AdmissionReceipt | null = null;
  if (input.standingPolicy) {
    const provider = preview.selection.provider;
    const codingAgentConfig = loadWorkspaceConfig(getWorkspacePaths(input.workspace).configFile).codingAgent;
    const unmeteredProvider = unmeteredProviderSelector(codingAgentConfig);
    const observation =
      input.capacityObservation ?? observeProviderCapacity(input.profiles, { now, unmeteredProvider });
    const capacity = observation.providers.find((decision) => decision.providerId === provider);
    if (!capacity) {
      throw validationError(`No capacity observation is available for provider "${provider}".`, { conflict: true });
    }
    const issued = issueAdmission(input.db, {
      requestId: `${input.requestId}:admission`,
      actionKey: `${preview.projectSlug}/${preview.actionId}`,
      projectSlug: preview.projectSlug,
      planSlug: preview.planSlug ?? "",
      provider,
      capacity,
      ...(input.expectedPolicyEpoch !== undefined ? { expectedEpoch: input.expectedPolicyEpoch } : {}),
      now
    });
    if (!issued.admitted) {
      throw validationError(`The standing managed-production policy refused this launch: ${issued.reason}`, {
        code: issued.code,
        conflict: true
      });
    }
    admission = issued.receipt;
    input.testHooks?.afterAdmissionIssuedBeforeCommit?.();
  }

  const baseBranch = resolveBaseBranch(repoRoot);
  const baseRevision = git(repoRoot, ["rev-parse", baseBranch]).trim();

  // Issue #695: an unattended tick must recover from a dead-but-claimed
  // worktree the same way `arcadia go`'s stale-claim recovery does (Decision
  // 0051), rather than refusing on `actionAlreadyClaimed` forever. A claim is
  // only ever resumed when its exit was *proven* terminal -- a reconciled
  // `incomplete_resumable` receipt with its lease handed off, not merely a
  // dead tmux pane -- and only for this exact Action, and only while its
  // worktree still exists on disk to resume into.
  //
  // The candidate's Git metadata is probed with `tryGit` *before* the claim is
  // renewed, and its checked-out branch confirmed against the receipt: a
  // worktree directory that survives on disk but is no longer valid Git state
  // (or was somehow re-checked-out to a different branch) must not have its
  // claim renewed only to throw past that point with the claim already held
  // and nothing left to release it (CodeRabbit, PR #696).
  // A review repair never resumes an incomplete handoff or a draft-only candidate: it
  // always starts its own branch from the failed candidate's pre-settlement work.
  const staleHandoff = input.repair ? null : getResumableLeaseHandoff(input.db, repoRoot);
  let resumableStaleClaim: { session: NonNullable<typeof staleHandoff>["session"]; receiptId: string; branch: string; headRevision: string } | null = null;
  if (staleHandoff && staleHandoff.session.action_id === preview.actionId && !tmux.hasSession(staleHandoff.session.tmux_session_name)) {
    const expectedBranch = staleHandoff.session.branch.replace(/^refs\/heads\//, "");
    // A worktree that is gone outright fails the same "not safely resumable"
    // test as one whose Git metadata is invalid -- `tryGit` against a missing
    // directory fails exactly like it does against a corrupt one, so the
    // check below covers both without a separate `existsSync` gate that would
    // otherwise skip releasing the stale claim entirely for a deleted
    // worktree (CodeRabbit, PR #696).
    const headProbe = tryGit(staleHandoff.session.worktree_path, ["rev-parse", "HEAD"]);
    const branchProbe = tryGit(staleHandoff.session.worktree_path, ["symbolic-ref", "--short", "HEAD"]);
    if (headProbe !== null && branchProbe !== null && branchProbe.trim() === expectedBranch) {
      resumableStaleClaim = { session: staleHandoff.session, receiptId: staleHandoff.receipt.id, branch: expectedBranch, headRevision: headProbe.trim() };
    } else {
      // Not safely resumable after all. Its stale claim would otherwise make
      // the ordinary new-worktree path below refuse on `actionAlreadyClaimed`
      // over a claim nothing will ever resume -- release it explicitly,
      // fenced on the exact generation currently held, so a fresh worktree
      // can be claimed normally. The worktree reservation itself (and the
      // worktree on disk, if it still exists) is left alone, so `tidy` still
      // will not retire it out from under an operator's manual inspection.
      //
      // Only ever release a claim actually held on *this* handoff's worktree.
      // A concurrent caller (another tick, a manual `arcadia go`) could have
      // already claimed a different worktree for this same Action between
      // our read of the handoff above and this read of the live claim; that
      // claim is live and legitimate, not stale, and must not be torn down
      // out from under it.
      const held = getActiveActionClaim(input.db, repoRoot, preview.projectSlug, preview.actionId, now);
      if (held?.claim_generation && canonicalPath(held.worktree_path) === canonicalPath(staleHandoff.session.worktree_path)) {
        releaseActionClaim(input.db, {
          repositoryPath: repoRoot,
          project: preview.projectSlug,
          actionId: preview.actionId,
          generation: held.claim_generation
        });
      }
    }
  }

  // Issue #884: agree with `arcadia go` about a prepared candidate no Session
  // row describes. Inside one claim transaction the shared evaluator either
  // hands a never-launched draft-only candidate out in place -- once, with
  // its receipt and handout marker committed alongside the claim refresh, so
  // a candidate Go already handed out is never launched into again -- or
  // refuses with the same reason and details Go reports, committing the
  // receipt of a disposition first. Like Go's own ordering, a resumable
  // handoff (handled above) decides first; only with none at all is an
  // undescribed candidate considered.
  let draftResume: { path: string; branch: string; receipt: DraftRecoveryReceipt } | null = null;
  if (!staleHandoff && !input.repair) {
    const lookup = { repositoryPath: repoRoot, projectSlug: preview.projectSlug, actionId: preview.actionId, agent, baseBranch, now };
    try {
      const decision = writeTransaction(input.db, () => {
        assertFreshRequest();
        const evaluated = evaluateDraftOnlyCandidate(input.db, lookup);
        if (evaluated.kind === "refuse" && evaluated.receipt) recordDraftRecoveryReceipt(input.db, evaluated.receipt, now);
        // Refreshed at the same path, never a second claim. The claim is not
        // this call's to release afterwards: it held this candidate before.
        if (evaluated.kind === "resume") {
          reserveAgentWorktree(input.db, {
            repositoryPath: repoRoot,
            worktreePath: evaluated.path,
            branch: evaluated.branch,
            now,
            project: preview.projectSlug,
            actionId: preview.actionId!
          });
          commitDraftHandout(input.db, evaluated.receipt, "tick", now);
        }
        return evaluated;
      });
      if (decision.kind === "refuse") throw validationError(decision.reason, decision.details);
      if (decision.kind === "resume") draftResume = decision;
    } catch (error) {
      if (admission) releaseAdmission(input.db, admission.requestId, now);
      throw error;
    }
  }
  // A worktree this call did not create: never removed or unreserved here.
  const resumedInPlace = resumableStaleClaim !== null || draftResume !== null;

  const reservationCommitCleanup: { candidate: PreparedAgentWorktree | null } = { candidate: null };
  // The generation this launch claimed, so a Session preparation that fails
  // after the claim committed releases it explicitly instead of leaving the
  // Action blocked for the TTL over work that never started.
  const claim: { generation: string | null } = { generation: null };
  // A review repair moves the failed candidate's Action claim to its own worktree;
  // every failure path below gives that claim back to the failed candidate.
  let repairReleasedClaim: { worktreePath: string; branch: string } | null = null;
  const restoreFailedCandidateClaim = () => {
    if (!repairReleasedClaim) return;
    const released = repairReleasedClaim;
    repairReleasedClaim = null;
    try {
      writeTransaction(input.db, () => reserveAgentWorktree(input.db, {
        repositoryPath: repoRoot, worktreePath: released.worktreePath, branch: released.branch, now,
        project: preview.projectSlug, actionId: preview.actionId!
      }));
    } catch {
      // Best effort: the failed candidate's worktree reservation itself was never released.
    }
  };
  let repairLaunchRevision: string | null = null;
  let nextWorktree: PreparedAgentWorktree;
  if (draftResume) {
    nextWorktree = {
      agent,
      path: draftResume.path,
      branch: draftResume.branch,
      model,
      effort,
      command: buildAgentLaunchCommand(agent, draftResume.path, model, effort)
    };
  } else if (resumableStaleClaim) {
    // Resume in place: same worktree and branch, claim refreshed rather than
    // replaced (`reserveAgentWorktree` treats a reservation at the same path
    // as a renewal, per Decision 0051). No Git write happens here -- the
    // worktree already exists and may hold uncommitted work from the dead
    // Session that must not be disturbed.
    nextWorktree = {
      agent,
      path: resumableStaleClaim.session.worktree_path,
      branch: resumableStaleClaim.branch,
      model,
      effort,
      command: buildAgentLaunchCommand(agent, resumableStaleClaim.session.worktree_path, model, effort)
    };
    claim.generation = writeTransaction(input.db, () => {
      assertFreshRequest();
      return reserveAgentWorktree(input.db, {
        repositoryPath: repoRoot,
        worktreePath: nextWorktree.path,
        branch: nextWorktree.branch,
        now,
        project: preview.projectSlug,
        actionId: preview.actionId!
      }).claim_generation;
    });
  } else {
    try {
      nextWorktree = writeTransaction(input.db, () => {
        assertFreshRequest();
        const created = prepareAgentWorktree({
          agent,
          actionId: preview.actionId!,
          baseBranch,
          repositoryPath: repoRoot,
          rootOverride: input.agentWorktreeRoot,
          now,
          model,
          effort,
          ...(input.repair ? { startPoint: input.repair.startRevision } : {}),
          beforeCreate(candidate) {
            // The failed candidate's Action claim moves to the repair (fenced on
            // its exact generation, only while it is still held on that worktree);
            // its worktree reservation, branch and PR stay as they are.
            if (input.repair) {
              const held = getActiveActionClaim(input.db, repoRoot, preview.projectSlug, preview.actionId!, now);
              if (held?.claim_generation && canonicalPath(held.worktree_path) === canonicalPath(input.repair.failedWorktreePath)) {
                releaseActionClaim(input.db, { repositoryPath: repoRoot, project: preview.projectSlug, actionId: preview.actionId!, generation: held.claim_generation });
                repairReleasedClaim = { worktreePath: held.worktree_path, branch: held.branch };
              }
            }
            claim.generation = reserveAgentWorktree(input.db, {
              repositoryPath: repoRoot,
              worktreePath: candidate.path,
              branch: candidate.branch,
              now,
              project: preview.projectSlug,
              actionId: preview.actionId!
            }).claim_generation;
          }
        });
        reservationCommitCleanup.candidate = created;
        input.testHooks?.afterWorktreeCreatedBeforeReservationCommit?.();
        return created;
      });
      if (input.repair) repairLaunchRevision = retireInheritedCompletionDrafts(nextWorktree.path, input.repair.startRevision, preview.projectSlug, preview.planSlug ?? "", preview.actionId);
    } catch (error) {
      if (reservationCommitCleanup.candidate) {
        tryGit(repoRoot, ["worktree", "remove", "--force", reservationCommitCleanup.candidate.path]);
        tryGit(repoRoot, ["branch", "-D", reservationCommitCleanup.candidate.branch]);
        if (input.repair) releaseWorktreeReservation(input.db, repoRoot, reservationCommitCleanup.candidate.path);
      }
      if (claim.generation && input.repair) {
        releaseActionClaim(input.db, { repositoryPath: repoRoot, project: preview.projectSlug, actionId: preview.actionId, generation: claim.generation });
      }
      restoreFailedCandidateClaim();
      // Worktree preparation failed before this admission ever reached
      // `commitAdmission`; nothing else will free the slot it reserved.
      if (admission) releaseAdmission(input.db, admission.requestId, now);
      throw error;
    }
  }

  // `prepareSession` records `baseRevision` as this candidate's true lineage
  // starting point -- what `reconcileSessionExit` and candidate preservation
  // measure accumulated progress against (a resumed Session that itself makes
  // no further commits must still be recognized as carrying its predecessor's
  // real work, not misclassified as having no changes at all). A resumed
  // Session inherits its predecessor's own `base_revision` unchanged, however
  // many resumptions deep, rather than the worktree's current HEAD.
  //
  // `launchRevision` is the separate, narrower expectation `launchPreparedSession`
  // checks immediately before spawning: "has anything touched this worktree
  // since this Session was prepared." For a resumed claim that is the
  // worktree's actual current HEAD (already probed above), not the lineage
  // baseline -- conflating the two broke every other reader of
  // `base_revision` (CodeRabbit, PR #696). Persisted on the row (not just
  // threaded through this call) so a retry that finds this exact Session
  // still sitting in `prepared` status -- this process died between the
  // insert below committing and ever reaching launch -- still supplies the
  // right expectation the second time around.
  // A never-launched draft-only candidate carries no commits, so its own
  // branch tip is both its lineage start and the HEAD launch must observe.
  const sessionBaseRevision = input.repair ? input.repair.baseRevision : draftResume ? draftResume.receipt.baseSha : resumableStaleClaim ? resumableStaleClaim.session.base_revision : baseRevision;
  const sessionLaunchRevision = input.repair ? repairLaunchRevision ?? input.repair.startRevision : draftResume ? draftResume.receipt.baseSha : resumableStaleClaim ? resumableStaleClaim.headRevision : baseRevision;

  // Outside the `prepareSession` failure path below on purpose: a mismatch is
  // positive evidence that something is writing in the worktree, so the
  // handout marker is KEPT and every later Go or tick attempt refuses with the
  // disposition. Only the admission this call reserved is released.
  if (draftResume) {
    try {
      input.testHooks?.beforeDraftLaunchVerification?.();
      assertDraftRecoveryUnchanged(draftResume.receipt);
    } catch (error) {
      if (admission) releaseAdmission(input.db, admission.requestId, now);
      throw error;
    }
  }

  let prepared: AgentSession;
  try {
    prepared = prepareSession({
      db: input.db,
      workspace: input.workspace,
      repoRoot,
      dispatch,
      agent,
      model,
      effort,
      baseRevision: sessionBaseRevision,
      launchRevision: sessionLaunchRevision,
      timeLimitMs: input.timeLimitMs,
      branch: nextWorktree.branch,
      worktreePath: nextWorktree.path,
      now,
      tmux,
      ...(input.repair ? { repair: { requestId: input.repair.requestId } } : {}),
      testHooks: { afterChecksBeforeInsert: input.testHooks?.beforeSessionInsert },
      assertLaunchRequest: assertFreshRequest
    });
    if (input.reuseOwnLeaseOnly && admission) {
      // Enrollment only: bind the lease to this request's admission at once,
      // so a crash before the commit below still leaves positive evidence the
      // lease is this request's own (the reuse branch then commits it).
      input.db.prepare("UPDATE agent_sessions SET admission_request_id = ? WHERE id = ?").run(admission.requestId, prepared.id);
      prepared = { ...prepared, admission_request_id: admission.requestId };
    }
  } catch (error) {
    // A concurrent caller may have won the repository lease between our
    // pre-check above and this insert (either by throwing here first, or via
    // the database's own unique lease index on a true race). Reconcile onto
    // the winner rather than leaving an orphaned worktree and a misleading
    // failure for a request that was, in substance, satisfied.
    //
    // A resumed stale claim's worktree pre-dates this call and may hold the
    // dead Session's real work -- never delete it or drop its protection
    // here; only the claim itself is released, so a later attempt can retry.
    if (!resumedInPlace) {
      tryGit(repoRoot, ["worktree", "remove", nextWorktree.path]);
      tryGit(repoRoot, ["branch", "-D", nextWorktree.branch]);
    }
    // The worktree this call claimed the Action for is gone, so both of the
    // row's guarantees end here: release the claim fenced on this call's own
    // generation, then drop the reservation the removed worktree no longer
    // needs.
    if (claim.generation) {
      releaseActionClaim(input.db, {
        repositoryPath: repoRoot,
        project: preview.projectSlug,
        actionId: preview.actionId,
        generation: claim.generation
      });
    }
    if (!resumedInPlace) {
      releaseWorktreeReservation(input.db, repoRoot, nextWorktree.path);
    }
    restoreFailedCandidateClaim();
    // A draft-only handout whose launch failed before any Session row came to
    // describe the candidate is voided, or every later Go or tick attempt would
    // refuse it as handed out over a session that never ran. Best effort.
    if (draftResume) {
      const handedOut = draftResume.receipt;
      try {
        writeTransaction(input.db, () => voidDraftHandoutIfUnlaunched(input.db, handedOut));
      } catch {
        // Left marked: later attempts refuse with the structured disposition.
      }
    }
    const raced = getRepositoryLease(input.db, repoRoot);
    if (raced && input.reuseOwnLeaseOnly && raced.admission_request_id !== `${input.requestId}:admission`) {
      // Enrollment never reconciles onto a lease another caller won.
      if (admission) releaseAdmission(input.db, admission.requestId, now);
      throw validationError("Another caller won this repository's lease; it is never re-issued.", {
        code: raced.action_id === preview.actionId ? "action_claimed" : "repository_leased", sessionId: raced.id, conflict: true
      });
    }
    if (raced && matchesPreview(raced, preview)) {
      // The winner's Session satisfies this request; this call's own reserved
      // admission (if any) never committed to a launch and would otherwise
      // hold a concurrency slot until it expires. Release it immediately
      // rather than waiting out the TTL.
      if (admission) releaseAdmission(input.db, admission.requestId, now);
      return reusedLease(input, raced, preview, tmux, registry, providerSignIn, now);
    }
    // No winning Session satisfied this request either: this admission never
    // committed to a launch and would otherwise hold its slot until it expires.
    if (admission) releaseAdmission(input.db, admission.requestId, now);
    throw error;
  }

  // The standing-policy cutoff: recheck Off (and the admitted epoch) as close
  // to process start as this call gets, inside the same admission's own
  // transactional commit. A refusal here means production went Inactive or
  // reactivated between issuing this admission and this exact moment — the
  // prepared Session and its worktree are abandoned unlaunched rather than
  // spawning a process no policy currently authorizes.
  // Outside every cleanup path on purpose: a throw here models a host crash.
  input.testHooks?.afterSessionPreparedBeforeCommit?.();
  const preparedActionId: string = preview.actionId;
  /** Abandon the prepared, never-started Session and everything this call reserved for it. */
  const abandonPrepared = () => {
    failPreparedSession(input.db, prepared.id);
    if (input.repair) releaseRepairSession(input.db, { requestId: input.repair.requestId, sessionId: prepared.id, now });
    // See the same guard above: a resumed stale claim's worktree is prior
    // real work, never this call's to delete.
    if (!resumedInPlace) {
      tryGit(repoRoot, ["worktree", "remove", nextWorktree.path]);
      tryGit(repoRoot, ["branch", "-D", nextWorktree.branch]);
    }
    if (claim.generation) {
      releaseActionClaim(input.db, {
        repositoryPath: repoRoot,
        project: preview.projectSlug,
        actionId: preparedActionId,
        generation: claim.generation
      });
    }
    if (!resumedInPlace) {
      releaseWorktreeReservation(input.db, repoRoot, nextWorktree.path);
    } else if (resumableStaleClaim) {
      // `prepareSession` already superseded the resumed handoff onto this
      // now-failed Session. Undo that, or the candidate's real worktree and
      // branch become permanently invisible to `getResumableLeaseHandoff`
      // even though nothing ever ran in it (CodeRabbit, PR #696).
      restoreLeaseHandoffIfSupersededBy(input.db, resumableStaleClaim.receiptId, prepared.id);
    }
    restoreFailedCandidateClaim();
  };
  if (admission) {
    const committed = commitAdmission(input.db, admission.requestId, now);
    if (!committed.admitted) {
      abandonPrepared();
      // `commitAdmission` already fenced a stale-epoch/expired/inactive
      // admission before reporting the refusal, which already excludes it
      // from `countLiveAdmissions`. `policy_unavailable` is the one refusal
      // that fences nothing (the policy read itself failed, so there was
      // nothing to compare the admission against) and would otherwise leave
      // it "issued" and live until its receipt expires (CodeRabbit, PR #729).
      if (committed.receipt?.status === "issued") {
        releaseAdmission(input.db, admission.requestId, now);
      }
      throw validationError(`The standing managed-production policy withdrew authorization before launch commitment: ${committed.reason}`, {
        code: committed.code,
        conflict: true
      });
    }
    admission = committed.receipt;
    // Link the Session to the exact admission its launch committed against, so
    // `reconcileSessionExit` can release this specific slot through
    // `releaseAdmission` once the Session reaches a terminal outcome, instead
    // of leaving it committed until its TTL-less "committed" state leaks
    // forever (Issue #610).
    input.db.prepare("UPDATE agent_sessions SET admission_request_id = ? WHERE id = ?").run(admission.requestId, prepared.id);
  }
  // Past the Off/epoch cutoff: allocate (or resume) the development attempt
  // now. This launch's own prepared Session never counts as a competing live
  // holder. A refusal here (only a concurrent lineage change could cause one
  // after the read-only check above) abandons the unstarted Session and gives
  // back its committed slot, exactly like a withdrawn admission.
  let development: SessionRoleAttempt;
  try {
    development = beginDevelopmentAttempt(input.db, { requirement, requestId: input.requestId, retryAuthorized: true, exceptSessionId: prepared.id,
      supersedesPassed: input.repair?.supersedesDevelopmentAttempt ?? null, now }).attempt;
  } catch (error) {
    abandonPrepared();
    if (admission) releaseAdmission(input.db, admission.requestId, now);
    throw lineageRefusal(error);
  }
  // The launch command depends on whether the Session is admission-bound
  // (unattended), so hand `launchPreparedSession` the row as it now stands.
  const launching = admission ? { ...prepared, admission_request_id: admission.requestId } : prepared;

  // The confirmed Launch's one-shot authorization is bound to this exact
  // Session (and so its Action) and recorded before the process may start.
  if (input.operatorLaunch) {
    mintOperatorLaunchAuthorization(input.db, {
      session: prepared, source: input.operatorLaunch.source, requestId: input.requestId,
      ...(standingBasis ? { standing: standingBasis } : {}), env: input.operatorLaunch.env, now
    });
  }

  let launched: AgentSession;
  try {
    launched = launchPreparedSession(input.db, launching, tmux, registry, input.workspace);
  } catch (error) {
    // A Session that never started carries no authorization.
    if (input.operatorLaunch) {
      voidOperatorLaunchAuthorization(input.db, prepared.id, `the Session never started: ${error instanceof Error ? error.message : String(error)}`, now);
    }
    // A spawn that fails outright releases the lease (`failPreparedSession`),
    // and the claim has to go with it: otherwise the Action stays claimed by a
    // Session that never ran, and the retry this failure exists to allow is
    // refused for the TTL's full 24 hours. Fenced on this call's own
    // generation, so a claim that has since moved on is left alone.
    if (claim.generation) {
      releaseActionClaim(input.db, {
        repositoryPath: repoRoot,
        project: preview.projectSlug,
        actionId: preview.actionId,
        generation: claim.generation
      });
    }
    // Same as the admission-withdrawal path above: a spawn failure leaves
    // `launchPreparedSession`'s own `failPreparedSession` call behind it, so
    // the resumed handoff's supersession onto this dead Session must be
    // undone the same way, or the candidate is lost to future resumption.
    if (resumableStaleClaim) {
      restoreLeaseHandoffIfSupersededBy(input.db, resumableStaleClaim.receiptId, prepared.id);
    }
    // A repair that never started gives the failed candidate back to terminal
    // recovery, and its own fresh worktree, branch and reservation go with it.
    // Only when tmux never started its process: a failure after the spawn
    // (a busy database on the status write) leaves a running agent in that
    // worktree, so its attempt, binding and worktree are left exactly as they
    // are for reconciliation to judge.
    const spawned = (() => {
      try { return tmux.hasSession(launching.tmux_session_name); } catch { return true; }
    })();
    if (input.repair && !spawned) {
      // Its development attempt did no work: recorded as a never-started
      // repair, which the lineage sets aside, so the failed candidate's own
      // passed attempt stands again (its verdict readiness and real failed
      // verdict are re-derived normally) and a retried repair supersedes it.
      if (development.status === "pending" || development.status === "running") {
        try {
          recordSessionRoleAttemptTerminal(input.db, { requestId: development.request_id, actorId: development.actor_id, status: "failed", now,
            receipt: { repairNeverStarted: true, sessionId: prepared.id, reason: `the review repair Session never started: ${error instanceof Error ? error.message : String(error)}` } });
        } catch {
          // Left live: the failed candidate then stays unready until an operator acts; never a launch.
        }
      }
      releaseRepairSession(input.db, { requestId: input.repair.requestId, sessionId: prepared.id, now });
      tryGit(repoRoot, ["worktree", "remove", "--force", nextWorktree.path]);
      tryGit(repoRoot, ["branch", "-D", nextWorktree.branch]);
      releaseWorktreeReservation(input.db, repoRoot, nextWorktree.path);
      restoreFailedCandidateClaim();
    }
    throw error;
  }
  markAttemptRunning(input.db, development, now);
  return { reused: false, session: launched, preview, admission };
}

/** The process is already running; a failed marker write leaves the attempt pending, which exit reconciliation treats identically. */
function markAttemptRunning(db: Database.Database, attempt: SessionRoleAttempt | null, now: Date): void {
  if (!attempt || attempt.status === "running") return;
  try {
    markDevelopmentAttemptRunning(db, attempt, now);
  } catch {
    // Still the requirement's one live owner; nothing else may allocate around it.
  }
}

/** A lineage refusal is an expected wait or operator state, never a repair-worthy launch failure. */
function lineageRefusal(error: unknown): unknown {
  return error instanceof ArcadiaError && typeof error.details?.code === "string" &&
    (error.details.code.startsWith("attempt_") || error.details.code === "mutation_owner_active")
    ? validationError(`The development attempt lineage refused this launch: ${error.message}`, { ...error.details, conflict: true })
    : error;
}

function reusedLease(
  input: GuardedLaunchInput,
  lease: AgentSession,
  preview: LaunchPreview,
  tmux: TmuxAdapter,
  registry: ModelTierRegistry | undefined,
  providerSignIn: (provider: string, workspace: string) => ProviderSignInStatus | null,
  now: Date,
  beforeStart?: () => void
): GuardedLaunchResult {
  // Also fences a lease that won the race after the initial read. A Continue
  // response may return only a principal its durable request actually owns.
  assertOperatorLaunchRequestAvailable(input.db, canonicalPath(input.repoRoot), input.requestId, lease.id);
  // A lease prepared before a crash may have no development attempt yet (the
  // launcher allocates it only after the admission cutoff). After any own
  // admission commit, and before the process may start, bind the requirement's
  // one development attempt to this Session: a live owner is resumed,
  // otherwise one is allocated with this lease excluded from the live-holder
  // check. An already-running Session is handed back unchanged: its live
  // attempt is never superseded under it (one is allocated only if none is
  // live). A prepared lease whose Action is no longer in the checked-in Plan
  // has no requirement to bind, so no process starts without an attempt.
  const ensureAttempt = (alreadyRunning: boolean) => {
    beforeStart?.();
    const requirement = requirementForSession(path.resolve(input.repoRoot), lease);
    if (!requirement) {
      if (alreadyRunning) return;
      throw validationError("The prepared Session's Action is no longer in the checked-in Plan; no process starts without its development attempt.", {
        code: "requirement_missing", sessionId: lease.id, actionId: lease.action_id, conflict: true
      });
    }
    if (alreadyRunning && liveMutationOwner(input.db, requirement.requirementId)) return;
    try {
      beginDevelopmentAttempt(input.db, { requirement, requestId: input.requestId, retryAuthorized: true, exceptSessionId: lease.id, now });
    } catch (error) {
      throw lineageRefusal(error);
    }
  };
  // A per-launch time limit applies to a reused lease too, before it may start.
  if (input.timeLimitMs !== undefined && lease.time_limit_ms !== input.timeLimitMs) {
    input.db.prepare("UPDATE agent_sessions SET time_limit_ms = ? WHERE id = ?").run(input.timeLimitMs, lease.id);
    lease = { ...lease, time_limit_ms: input.timeLimitMs };
  }
  const session = reuseOrRefuseLease(input.db, lease, preview, tmux, registry, providerSignIn, input.workspace, input.onProviderSignInConfirmed, ensureAttempt);
  if (session.status === "running") {
    markAttemptRunning(input.db, liveMutationOwner(input.db, requirementIdFor(session.project_slug, session.plan_slug, session.action_id)), now);
  }
  return { reused: true, session, preview, admission: null };
}

/**
 * The single liveness check both the no-validation-commands refusal and
 * `resumeOrReturn` need. Computed once and threaded through both, rather than
 * each calling `tmux.hasSession` independently: two independent OS-level
 * checks left a real, if narrow, TOCTOU window (CodeRabbit review on PR
 * #647) -- a tmux Session alive at the first check could exit before the
 * second, so `resumeOrReturn`'s own re-check would spawn a brand-new process
 * for an Action whose Project declares no validation commands, never having
 * been subject to the refusal at all.
 */
function reuseOrRefuseLease(
  db: Database.Database,
  session: AgentSession,
  preview: LaunchPreview,
  tmux: TmuxAdapter,
  registry: ModelTierRegistry | undefined,
  providerSignIn: (provider: string, workspace: string) => ProviderSignInStatus | null,
  workspace: string,
  onProviderSignInConfirmed?: (provider: string) => void,
  beforeStart?: (alreadyRunning: boolean) => void
): AgentSession {
  const isAlreadyRunning = session.status === "running" || tmux.hasSession(session.tmux_session_name);
  // An already-running Session (or one alive in tmux) is always handed back
  // unchanged. A merely *prepared* lease (never started, or crashed before it
  // ever reached tmux) is not yet running anything, so it is still subject to
  // the same no-validation-commands refusal an ordinary fresh launch would
  // hit: without this check, `resumeOrReturn` below would call
  // `launchPreparedSession` and start a brand-new process for an Action whose
  // Project now declares no validation commands, bypassing the refusal
  // entirely because `matchesPreview` checks only the project, Action, and
  // packet hash.
  if (!isAlreadyRunning && preview.prerequisites.some((entry) => entry.startsWith("no validation commands"))) {
    throw validationError("The previewed Action is not ready to launch.", {
      prerequisites: preview.prerequisites,
      conflict: true,
      code: "no_validation_commands"
    });
  }
  beforeStart?.(isAlreadyRunning);
  return resumeOrReturn(db, session, isAlreadyRunning, tmux, registry, providerSignIn, workspace, onProviderSignInConfirmed);
}

/**
 * A "prepared" lease whose tmux Session was never actually started (a crash
 * between insert and spawn) is resumed rather than left stuck. Resuming still
 * spawns the provider process, so it is gated on the same sign-in preflight
 * as a fresh launch; only the already-live return above it is exempt.
 * `isAlreadyRunning` is the caller's own liveness check, passed in rather
 * than recomputed here -- see `reuseOrRefuseLease`.
 */
function resumeOrReturn(
  db: Database.Database,
  session: AgentSession,
  isAlreadyRunning: boolean,
  tmux: TmuxAdapter,
  registry: ModelTierRegistry | undefined,
  providerSignIn: (provider: string, workspace: string) => ProviderSignInStatus | null,
  workspace: string,
  onProviderSignInConfirmed?: (provider: string) => void
): AgentSession {
  if (isAlreadyRunning) {
    return getSession(db, session.id) ?? session;
  }
  refuseUnlessSignedIn(session.provider, providerSignIn(session.provider, workspace), onProviderSignInConfirmed);
  return launchPreparedSession(db, session, tmux, registry, workspace);
}

function matchesPreview(session: AgentSession, preview: LaunchPreview): boolean {
  return (
    session.project_slug === preview.projectSlug &&
    session.action_id === preview.actionId &&
    preview.packet !== null &&
    session.packet_sha256 === preview.packet.sha256
  );
}

/**
 * The completion Ask ids that must not gate a launch that RESUMES an
 * incomplete candidate (the stale handoff the next launch would pick up):
 *
 * - for a repair Session, the failed candidate's own completion Asks, so they
 *   gate the resume no more than they gated the first repair launch;
 * - for any Session, the `complete` Asks for its Action that the candidate's
 *   own Sessions drafted: added by a commit on the candidate's first-parent
 *   line between the start of its first Session on that worktree and the
 *   handoff's preserved revision, and still an unsettled draft there (not
 *   archived by a settlement the candidate already carries). That draft is
 *   the very thing the resumed Session must correct (its evidence was
 *   refused), so it cannot hold it.
 *
 * Every other pending item still gates. Undefined when there is no handoff.
 */
export function resumedSessionSupersededAskIds(db: Database.Database, repoRoot: string, projectSlug: string, tmux: Pick<TmuxAdapter, "hasSession"> = systemTmux): ReadonlySet<string> | undefined {
  const root = path.resolve(repoRoot);
  const handoff = getResumableLeaseHandoff(db, root);
  if (!handoff) return undefined;
  const session = handoff.session;
  // Only when the next launch would actually resume this handoff: the
  // governed pointer names its Plan and Action (the launch resumes a stale
  // handoff only for the Action it dispatches).
  const context = resolveDispatch(root, projectSlug).context;
  if (!context || context.activePlan !== session.plan_slug || context.action.id !== session.action_id) return undefined;
  // The same resumability probes the launch runs before reusing the handoff
  // (no live tmux Session, a readable worktree HEAD on the handoff's branch):
  // a handoff the launch would not resume exempts nothing.
  if (tmux.hasSession(session.tmux_session_name)) return undefined;
  const headProbe = tryGit(session.worktree_path, ["rev-parse", "HEAD"]);
  const branchProbe = tryGit(session.worktree_path, ["symbolic-ref", "--short", "HEAD"]);
  if (headProbe === null || branchProbe === null || branchProbe.trim() !== session.branch.replace(/^refs\/heads\//, "")) return undefined;
  const ids = new Set<string>();
  const repair = getSessionRepair(db, session.id);
  if (repair) for (const id of candidateCompletionAskIds(root, projectSlug, session.base_revision, repair.failed_head, session.action_id)) ids.add(id);
  // The first Session on this candidate: walk back through the continuation
  // receipts, each of which is proven to share this worktree and branch.
  let first: AgentSession = session;
  for (let guard = 0; guard < 50; guard += 1) {
    let previous: SessionExitReceipt | null;
    try { previous = getSessionContinuation(db, first); } catch { previous = null; }
    const earlier = previous ? getSession(db, previous.session_id) : null;
    if (!earlier) break;
    first = earlier;
  }
  const start = first.launch_revision ?? first.base_revision;
  const end = handoff.receipt.candidate_revision ?? `refs/heads/${session.branch}`;
  // A draft the candidate archived was settled by a settlement it carries and
  // keeps gating. One it merely left in place, or deleted when a later Session
  // replaced it with a corrected draft (Issue #1640), is a refused draft all
  // the same: its proposal stays pending and must not hold the resume.
  const archived = requestIdsOfArchivedAsksAt(root, end);
  for (const id of candidateCompletionAskIds(root, projectSlug, start, end, session.action_id, { firstParent: true })) {
    if (!archived.has(id)) ids.add(id);
  }
  return ids.size > 0 ? ids : undefined;
}

/** The request ids of the Agent Asks archived (below `.arcadia/asks/`, not drafts) at `revision`. */
function requestIdsOfArchivedAsksAt(repoRoot: string, revision: string): Set<string> {
  const ids = new Set<string>();
  const listed = tryGit(repoRoot, ["ls-tree", "-r", "--name-only", revision, "--", ".arcadia/asks/"]);
  if (!listed) return ids;
  const drafts = new Set(draftPathsAt(repoRoot, revision));
  for (const file of listed.split("\n").map((line) => line.trim())) {
    if (!file || !/\.ya?ml$/i.test(file) || drafts.has(file)) continue;
    const content = tryGit(repoRoot, ["show", `${revision}:${file}`]);
    if (content === null) continue;
    try { ids.add(normalizeAgentAsk({ request: content }).requestId); } catch { /* not an Agent Ask */ }
  }
  return ids;
}

/**
 * The request ids of every `complete` Ask for `actionId` that the failed
 * candidate added to the base (its own, and any an earlier repair round
 * retired), read from the history `baseRevision..failedHead` rather than from
 * the head tree, which a retirement commit may have emptied. Unreadable
 * history yields nothing, so the gate stays closed.
 */
export function candidateCompletionAskIds(repoRoot: string, projectSlug: string, baseRevision: string, failedHead: string, actionId: string, options: { firstParent?: boolean } = {}): Set<string> {
  const ids = new Set<string>();
  // Exactly the selected Plan's target: a same-named Action in another Plan is a different Action.
  const planSlug = resolveDispatch(repoRoot, projectSlug).context?.activePlan;
  const targets = new Set([`action/${actionId}`, ...(planSlug ? [`plan/${planSlug}#${actionId}`] : [])]);
  // `firstParent`: only commits on the candidate's own line, and never a merge
  // commit's diff (since Git 2.31 `--first-parent` implies
  // `--diff-merges=first-parent`, which would show a base merged into the
  // candidate as files the merge added).
  const log = tryGit(repoRoot, ["log", ...(options.firstParent ? ["--first-parent", "--diff-merges=off"] : []), "--diff-filter=A", "--name-only", "--format=@%H", `${baseRevision}..${failedHead}`, "--", ".arcadia/asks"]);
  if (!log) return ids;
  let commit = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) { commit = line.slice(1).trim(); continue; }
    const file = line.trim();
    if (!file || !commit || !/\.ya?ml$/.test(file)) continue;
    const content = tryGit(repoRoot, ["show", `${commit}:${file}`]);
    if (content === null) continue;
    try {
      const ask = normalizeAgentAsk({ request: content });
      const target = ask.targetRef;
      if (ask.intent === "complete" && target !== null && targets.has(target)) ids.add(ask.requestId);
    } catch { /* not an Ask */ }
  }
  return ids;
}

/**
 * A review repair's fresh worktree starts at the failed candidate's work
 * before its completion settlement, which may still carry that candidate's own
 * drafted `complete` Ask (a sandboxed agent's draft, committed by host
 * preservation). It is retired here, in one host commit before the agent
 * starts, so it can neither be settled for the repaired head nor ride onto the
 * base as a stray draft. Returns the worktree HEAD the launch must observe.
 */
function retireInheritedCompletionDrafts(worktreePath: string, startRevision: string, projectSlug: string, planSlug: string, actionId: string): string {
  const targets = new Set([`action/${actionId}`, `plan/${planSlug}#${actionId}`]);
  const requestIds: string[] = [];
  const inherited = draftPathsAt(worktreePath, startRevision).filter((file) => {
    const content = tryGit(worktreePath, ["show", `${startRevision}:${file}`]);
    if (content === null) return false;
    try {
      const ask = normalizeAgentAsk({ request: content });
      const retire = ask.intent === "complete" && ask.targetRef !== null && targets.has(ask.targetRef) && (ask.project === "unknown" || ask.project === projectSlug);
      if (retire) requestIds.push(ask.requestId);
      return retire;
    } catch {
      return false;
    }
  });
  if (inherited.length > 0) {
    try {
      // A freshly created worktree: the index holds exactly these removals.
      git(worktreePath, ["rm", "-q", "--", ...inherited]);
      // Under the standing Arcadia Controller identity (the one preservation
      // commits under), never the host's ambient Git identity.
      const parent = git(worktreePath, ["rev-parse", "HEAD"]).trim();
      const tree = git(worktreePath, ["write-tree"]).trim();
      // The trailers let the deterministic patch check recognize exactly this
      // retirement (src/qa/patchApplicability.ts), so a repaired head's
      // governed records are not classified as authority.
      const retired = commitTreeAt(worktreePath, tree, parent, { message: retiredCompletionDraftMessage(actionId, requestIds) });
      git(worktreePath, ["update-ref", "-m", "arcadia: retire inherited completion draft", "HEAD", retired, parent]);
    } catch (error) {
      throw validationError(`The review repair could not retire the failed candidate's completion draft: ${error instanceof Error ? error.message : String(error)}`, { code: "repair_draft_retirement_failed" });
    }
  }
  return git(worktreePath, ["rev-parse", "HEAD"]).trim();
}
