import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { providerLabel } from "../codingAgents/adapters.js";
import { observeProviderCapacity, type ProviderCapacityObservation } from "../codingAgents/capacity.js";
import { checkProviderSignIn, type ProviderSignInStatus } from "../codingAgents/signIn.js";
import { loadWorkspaceConfig, unmeteredProviderSelector } from "../workspace/config.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { loadModelTierRegistry, type ModelTierRegistry } from "../codingAgents/modelTiers.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { writeTransaction } from "../db/connection.js";
import { isDispatchable, resolveDispatch } from "../docs/dispatch.js";
import { existsSync } from "node:fs";
import { git, resolveBaseBranch, tryGit } from "../git/worktrees.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { commitAdmission, issueAdmission, releaseAdmission, type AdmissionReceipt } from "../production/policy.js";
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
import { getResumableLeaseHandoff, restoreLeaseHandoffIfSupersededBy } from "./reconciliation.js";
import { buildAgentLaunchCommand, prepareAgentWorktree, type PreparedAgentWorktree } from "./worktreePreparation.js";

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
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  /** Test-only override for where the new agent worktree is created. */
  agentWorktreeRoot?: string;
  /** Test-only override for the standing-policy provider capacity observation. */
  capacityObservation?: ProviderCapacityObservation;
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

  const repoRoot = path.resolve(input.repoRoot);
  const now = input.now ?? new Date();
  const tmux = input.tmux ?? systemTmux;
  const registry = loadModelTierRegistry(input.workspace);
  const providerSignIn = input.providerSignIn ?? checkProviderSignIn;
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
    now
  });

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
  if (existingLease && matchesPreview(existingLease, preview)) {
    return {
      reused: true,
      session: reuseOrRefuseLease(input.db, existingLease, preview, tmux, registry, providerSignIn, input.workspace, onProviderSignInConfirmed),
      preview,
      admission: null
    };
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
  // Checked from this worker process's own context, before issueAdmission
  // reserves a concurrency slot and before any worktree or lease is created:
  // a signed-out provider must take no admission and no lease, so the next
  // tick can retry it for free once sign-in is restored.
  checkSignInOrRefuse(preview.selection.provider, providerSignIn(preview.selection.provider, input.workspace), onProviderSignInConfirmed);

  const model = preview.selection.model;
  const effort = preview.selection.effort ?? null;

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
  const staleHandoff = getResumableLeaseHandoff(input.db, repoRoot);
  let resumableStaleClaim: { session: NonNullable<typeof staleHandoff>["session"]; receiptId: string; branch: string; headRevision: string } | null = null;
  if (
    staleHandoff
    && staleHandoff.session.action_id === preview.actionId
    && !tmux.hasSession(staleHandoff.session.tmux_session_name)
    && existsSync(staleHandoff.session.worktree_path)
  ) {
    const expectedBranch = staleHandoff.session.branch.replace(/^refs\/heads\//, "");
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
      // worktree on disk) is left alone, so `tidy` still will not retire it
      // out from under an operator's manual inspection.
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

  const reservationCommitCleanup: { candidate: PreparedAgentWorktree | null } = { candidate: null };
  // The generation this launch claimed, so a Session preparation that fails
  // after the claim committed releases it explicitly instead of leaving the
  // Action blocked for the TTL over work that never started.
  const claim: { generation: string | null } = { generation: null };
  let nextWorktree: PreparedAgentWorktree;
  if (resumableStaleClaim) {
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
    claim.generation = writeTransaction(input.db, () => reserveAgentWorktree(input.db, {
      repositoryPath: repoRoot,
      worktreePath: nextWorktree.path,
      branch: nextWorktree.branch,
      now,
      project: preview.projectSlug,
      actionId: preview.actionId!
    }).claim_generation);
  } else {
    try {
      nextWorktree = writeTransaction(input.db, () => {
        const created = prepareAgentWorktree({
          agent,
          actionId: preview.actionId!,
          baseBranch,
          repositoryPath: repoRoot,
          rootOverride: input.agentWorktreeRoot,
          now,
          model,
          effort,
          beforeCreate(candidate) {
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
    } catch (error) {
      if (reservationCommitCleanup.candidate) {
        tryGit(repoRoot, ["worktree", "remove", reservationCommitCleanup.candidate.path]);
        tryGit(repoRoot, ["branch", "-D", reservationCommitCleanup.candidate.branch]);
      }
      throw error;
    }
  }

  // `prepareSession` records `baseRevision` as the worktree's starting point,
  // checked against its actual HEAD right before launch
  // (`launchPreparedSession`'s "base revision changed" guard). A brand-new
  // worktree starts exactly at the base branch's current HEAD, but a resumed
  // one starts wherever the dead Session's own commits left it -- recording
  // the base branch's HEAD there would make that guard fail immediately.
  const sessionBaseRevision = resumableStaleClaim
    ? resumableStaleClaim.headRevision
    : baseRevision;

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
      branch: nextWorktree.branch,
      worktreePath: nextWorktree.path,
      now,
      tmux
    });
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
    if (!resumableStaleClaim) {
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
    if (!resumableStaleClaim) {
      releaseWorktreeReservation(input.db, repoRoot, nextWorktree.path);
    }
    const raced = getRepositoryLease(input.db, repoRoot);
    if (raced && matchesPreview(raced, preview)) {
      // The winner's Session satisfies this request; this call's own reserved
      // admission (if any) never committed to a launch and would otherwise
      // hold a concurrency slot until it expires. Release it immediately
      // rather than waiting out the TTL.
      if (admission) releaseAdmission(input.db, admission.requestId, now);
      return {
        reused: true,
        session: reuseOrRefuseLease(input.db, raced, preview, tmux, registry, providerSignIn, input.workspace, onProviderSignInConfirmed),
        preview,
        admission: null
      };
    }
    throw error;
  }

  // The standing-policy cutoff: recheck Off (and the admitted epoch) as close
  // to process start as this call gets, inside the same admission's own
  // transactional commit. A refusal here means production went Inactive or
  // reactivated between issuing this admission and this exact moment — the
  // prepared Session and its worktree are abandoned unlaunched rather than
  // spawning a process no policy currently authorizes.
  if (admission) {
    const committed = commitAdmission(input.db, admission.requestId, now);
    if (!committed.admitted) {
      failPreparedSession(input.db, prepared.id);
      // See the same guard above: a resumed stale claim's worktree is prior
      // real work, never this call's to delete.
      if (!resumableStaleClaim) {
        tryGit(repoRoot, ["worktree", "remove", nextWorktree.path]);
        tryGit(repoRoot, ["branch", "-D", nextWorktree.branch]);
      }
      if (claim.generation) {
        releaseActionClaim(input.db, {
          repositoryPath: repoRoot,
          project: preview.projectSlug,
          actionId: preview.actionId,
          generation: claim.generation
        });
      }
      if (!resumableStaleClaim) {
        releaseWorktreeReservation(input.db, repoRoot, nextWorktree.path);
      } else {
        // `prepareSession` already superseded the resumed handoff onto this
        // now-failed Session. Undo that, or the candidate's real worktree and
        // branch become permanently invisible to `getResumableLeaseHandoff`
        // even though nothing ever ran in it (CodeRabbit, PR #696).
        restoreLeaseHandoffIfSupersededBy(input.db, resumableStaleClaim.receiptId, prepared.id);
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

  try {
    return { reused: false, session: launchPreparedSession(input.db, prepared, tmux, registry, input.workspace), preview, admission };
  } catch (error) {
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
    throw error;
  }
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
  onProviderSignInConfirmed?: (provider: string) => void
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
  checkSignInOrRefuse(session.provider, providerSignIn(session.provider, workspace), onProviderSignInConfirmed);
  return launchPreparedSession(db, session, tmux, registry, workspace);
}

function checkSignInOrRefuse(
  provider: string,
  signIn: ProviderSignInStatus | null,
  onConfirmed?: (provider: string) => void
): void {
  if (!signIn) return;
  if (!signIn.signedIn) {
    throw validationError(
      `Provider "${providerLabel(provider)}" is not signed in for this worker. ${signIn.remedy}`,
      { code: "provider_not_signed_in", conflict: true, provider }
    );
  }
  onConfirmed?.(provider);
}

function matchesPreview(session: AgentSession, preview: LaunchPreview): boolean {
  return (
    session.project_slug === preview.projectSlug &&
    session.action_id === preview.actionId &&
    preview.packet !== null &&
    session.packet_sha256 === preview.packet.sha256
  );
}
