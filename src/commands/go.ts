import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase, writeTransaction } from "../db/connection.js";
import { buildAgentQueue } from "../dispatch/queue.js";
import { discoverDocs } from "../docs/discover.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import {
  SAFE_TASK_BRANCH,
  assertClean,
  countCommits,
  existingDirectory,
  git,
  isAncestor,
  isInside,
  isPatchEquivalent,
  listWorktrees,
  parseWorktrees,
  refExists,
  resolveBaseBranch,
  samePath,
  summarizeClutter,
  tryGit,
  uncommittedChanges,
  type ClutterSummary
} from "../git/worktrees.js";
import {
  getActiveActionClaim,
  getRepositoryLease,
  launchPreparedSession,
  prepareSession,
  releaseActionClaim,
  reserveAgentWorktree,
  resolveProjectTransition,
  systemTmux,
  type AgentSession,
  type ProjectTransition,
  type SessionAgent,
  type TmuxAdapter
} from "../sessions/index.js";

import { recoverLegacyAgentAskDrift, type AskRecoveryTestHooks, type LegacyAskRecovery } from "../sessions/legacyAskRecovery.js";
import { getResumableLeaseHandoff } from "../sessions/reconciliation.js";
import { buildAgentLaunchCommand, prepareAgentWorktree, type PreparedAgentWorktree } from "../sessions/worktreePreparation.js";
import {
  loadModelTierRegistry,
  resolveHandoffModel,
  type ModelTier
} from "../codingAgents/modelTiers.js";
import { bindManualPreservation } from "../sessions/manualPreservation.js";
import { readPreservationReadiness, type PreservationReadiness } from "../sessions/preservationReadiness.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { resolveWorkspace } from "../workspace/resolve.js";

export interface GoCommandOptions {
  repo?: string;
  source?: string;
  apply?: boolean;
  agent?: SessionAgent;
  /** Overrides the plan's `recommended_model` for this one invocation. */
  model?: string;
  /** Overrides the plan's `recommended_reasoning_effort` for this one invocation. */
  effort?: string;
  workspace?: string;
  /** The only option that authorizes process creation. */
  launch?: boolean;
  /** Test-only override; the CLI intentionally does not expose it. */
  agentWorktreeRoot?: string;
  /** Test-only clock injection. */
  now?: Date;
  /** Test-only process boundary. */
  tmux?: TmuxAdapter;
  /** Deterministic fault injection after Git creation but before reservation commit. */
  testHooks?: {
    afterWorktreeCreatedBeforeReservationCommit?: () => void;
    /** Deterministic fault injection inside the Agent Ask drift recovery it runs before the clean check. */
    askRecovery?: AskRecoveryTestHooks;
    /** Deterministic race injection immediately before a divergent-base result is published. */
    beforeBaseReconciliationPublish?: () => void;
  };
}

export interface BaseRemoteSync {
  /** False when no remote operation ran (preview or no tracked remote). */
  attempted: boolean;
  /** The remote name (e.g. "origin"), present whenever a fetch was attempted. */
  remote: string | null;
  /** The exact configured upstream observed by the protected snapshot. */
  upstream: string | null;
  fastForwarded: boolean;
  /** The verified host-controller outcome, separate from source-branch integration. */
  strategy: "none" | "current" | "fast-forward" | "governed-merge";
  localHeadBefore: string | null;
  remoteHead: string | null;
  mergeBase: string | null;
  resultHead: string | null;
  localGovernanceCommits: string[];
  remoteCommitsIntegrated: number;
  /** Set whenever fastForwarded is false, explaining why (no remote, already current). */
  reason: string | null;
}

export interface GoCommandData {
  applied: boolean;
  preservation?: PreservationReadiness;
  projectSlug: string;
  repositoryPath: string;
  sourceWorktree: string;
  sourceBranch: string;
  baseBranch: string;
  baseWorktree: string | null;
  baseRemoteSync: BaseRemoteSync;
  integration: "not-needed" | "fast-forward" | "already-integrated";
  commitsToIntegrate: number;
  sourceWorktreeRemoved: boolean;
  sourceBranchDeleted: boolean;
  nextWorktree: PreparedAgentWorktree | null;
  /**
   * How the handoff model was chosen for the next agent. Null until an agent is
   * prepared. `note` is set whenever the plan's recommended_model was
   * reinterpreted, so a fallback is visible rather than silent.
   */
  modelResolution: {
    model: string;
    effort: string | null;
    tier: ModelTier | null;
    source: "explicit" | "tier" | "concrete" | "fallback";
    note: string | null;
  } | null;
  dispatch: DispatchResolution;
  /**
   * Set when the governed pointer's Action was already claimed by a live
   * worktree and `go` dispatched the next unclaimed, dependency-ready queue
   * entry instead of refusing. Null on the ordinary path, where the pointer's
   * Action is what was dispatched.
   *
   * `dispatch` above already describes the Action actually handed off, so a
   * reader that only wants the brief needs nothing from here; this exists so
   * the divergence from `current_action` is visible rather than silent.
   */
  queueFallback: { pointerActionId: string; actionId: string; reason: string } | null;
  dispatchable: boolean;
  transition: ProjectTransition;
  session: AgentSession | null;
  handoff: {
    baseRef: string;
    prompt: "arcadia advance";
  };
  /** Local-only accumulation counts, so session boundaries surface clutter instead of hiding it. Null when git could not be read. */
  clutter: ClutterSummary | null;
  /** Legacy root `agent-ask.yaml` drift recovered into an isolated Ask branch before the clean check, if any. */
  askRecoveries: LegacyAskRecovery[];
}

export function runGoCommand(options: GoCommandOptions): CommandSuccess<GoCommandData> {
  if (options.launch && (!options.apply || !options.agent)) {
    throw validationError("--launch requires --apply and an explicit Session adapter; it is the only authority to start a process.");
  }
  if (options.apply && process.env.CODEX_SANDBOX) {
    throw validationError("Arcadia go mutation must run in the protected host controller.", {
      sandbox: process.env.CODEX_SANDBOX,
      remedy: "Run the installed fixed Go request launcher; the host worker owns reconciliation and worktree preparation."
    });
  }
  const requestedRepo = options.repo ?? invocationRoot();
  const requestedSource = options.source ?? requestedRepo;
  const repo = existingDirectory(requestedRepo, "repository");
  const source = existingDirectory(requestedSource, "source worktree");
  const worktrees = parseWorktrees(git(repo, ["worktree", "list", "--porcelain"]));
  const controlWorktree = worktrees[0].path;
  const sourceRecord = worktrees.find((candidate) => samePath(candidate.path, source));
  if (!sourceRecord) {
    throw validationError("The source path is not a registered worktree for this repository.", {
      source,
      worktrees: worktrees.map((candidate) => candidate.path)
    });
  }
  if (!sourceRecord.branch) {
    throw validationError("Arcadia go will not reconcile a detached source worktree.", {
      source,
      head: sourceRecord.head,
      remedy: "Create and preserve a named task branch first."
    });
  }

  const baseBranch = resolveBaseBranch(repo);
  const baseRef = `refs/heads/${baseBranch}`;
  const baseRecord = worktrees.find((candidate) => candidate.branch === baseRef);

  const askRecoveries: LegacyAskRecovery[] = [];
  const sourceAskRecovery = recoverLegacyAgentAskDrift(repo, sourceRecord.path, options.testHooks?.askRecovery);
  if (sourceAskRecovery.recovered) askRecoveries.push(sourceAskRecovery);
  assertClean(sourceRecord.path, "source worktree");
  if (baseRecord && !samePath(baseRecord.path, sourceRecord.path)) {
    const baseAskRecovery = recoverLegacyAgentAskDrift(repo, baseRecord.path, options.testHooks?.askRecovery);
    if (baseAskRecovery.recovered) askRecoveries.push(baseAskRecovery);
    assertClean(baseRecord.path, "base worktree");
  }

  const sourceBranch = sourceRecord.branch.replace(/^refs\/heads\//, "");
  const operationNow = options.now ?? new Date();

  // Fetches and reconciles local base with its remote before anything below
  // reads from it — dispatch, `commitsToIntegrate`, and the next worktree all
  // have to see current state, not whatever the last session happened to leave
  // on disk. Failing closed on divergence here is the same fail-closed
  // contract the rest of this command already applies to the source branch.
  // Preview changes no Git state, fetch included, so this only runs on apply.
  const baseRemoteSync: BaseRemoteSync = options.apply
    ? syncBaseBranchWithRemote({
        controlWorktree,
        baseBranch,
        baseWorktreePath: baseRecord?.path ?? null,
        sourceWorktreePath: sourceRecord.path,
        sourceBranch,
        sourceHead: sourceRecord.head,
        now: operationNow,
        beforePublish: options.testHooks?.beforeBaseReconciliationPublish
      })
    : emptyBaseRemoteSync("Preview does not fetch or modify the base branch.");

  const integration = reconciliationKind(sourceRecord.path, baseBranch, sourceBranch);
  const commitsToIntegrate = countCommits(sourceRecord.path, baseBranch, sourceBranch);

  if (integration !== "not-needed") {
    if (!SAFE_TASK_BRANCH.test(sourceBranch)) {
      throw validationError("Arcadia go only removes clearly agent-owned task branches.", {
        sourceBranch,
        allowedPrefixes: ["codex/", "claude/", "agent/", "worktree-"],
        remedy: "Preserve this branch and route it through a reviewed Arcadia recovery; protected Go will not retire it."
      });
    }
    if (integration === null) {
      throw validationError("The source branch cannot fast-forward the local base branch.", {
        sourceBranch,
        baseBranch,
        requiresProtectedRemoteObservation: options.apply !== true,
        remedy: "Preserve both histories and route them through a reviewed Arcadia recovery; protected Go issued no worktree."
      });
    }
  }

  const projectRoot = integration === "already-integrated" ? (baseRecord?.path ?? sourceRecord.path) : sourceRecord.path;
  const projectSlug = resolveProjectSlug(projectRoot);
  const sourceDispatch = resolveDispatch(projectRoot, projectSlug);
  if (!isDispatchable(sourceDispatch)) {
    throw validationError("The repository does not resolve exactly one dispatchable Arcadia action.", {
      projectSlug,
      blockers: sourceDispatch.blockers,
      operatorQuestion: sourceDispatch.operatorQuestion,
      currentAction: sourceDispatch.context?.action.id ?? null,
      remedy: "Repair the governed pointer or answer its Decision before starting another coding-agent session."
    });
  }

  let sourceWorktreeRemoved = false;
  let sourceBranchDeleted = false;
  let nextWorktree: GoCommandData["nextWorktree"] = null;
  let modelResolution: GoCommandData["modelResolution"] = null;
  let session: AgentSession | null = null;
  let dispatch = sourceDispatch;
  // The checkout `dispatch` was resolved from, so a queue-walk fallback can
  // re-resolve a different Action's brief against exactly the same documents
  // rather than a second, possibly staler, worktree's copy of them.
  let dispatchRoot = projectRoot;
  let queueFallback: GoCommandData["queueFallback"] = null;
  if (options.apply && integration !== "not-needed" && integration !== null) {
    if (integration === "fast-forward") {
      if (baseRecord) {
        git(baseRecord.path, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", sourceBranch]);
      } else {
        // The base branch may be unattached because an agent switched the
        // primary checkout onto its task branch. Updating it is safe only after
        // the ancestry check above proves this is a strict fast-forward.
        git(sourceRecord.path, ["-c", "core.hooksPath=/dev/null", "branch", "-f", baseBranch, sourceBranch]);
      }

      const baseDispatchRoot = baseRecord?.path ?? sourceRecord.path;
      const baseDispatch = resolveDispatch(baseDispatchRoot, projectSlug);
      if (!isDispatchable(baseDispatch)) {
        throw validationError("The fast-forward completed, but dispatch validation failed from the base worktree.", {
          projectSlug,
          blockers: baseDispatch.blockers,
          operatorQuestion: baseDispatch.operatorQuestion,
          remedy: "Keep the source worktree and repair the governed pointer from the base worktree."
        });
      }
      dispatch = baseDispatch;
      dispatchRoot = baseDispatchRoot;
    }

    if (!baseRecord && samePath(worktrees[0].path, sourceRecord.path)) {
      // A primary checkout cannot be removed as a linked worktree. Return it
      // to the now-fast-forwarded base branch instead.
      git(sourceRecord.path, ["-c", "core.hooksPath=/dev/null", "switch", baseBranch]);
    } else {
      // Removing the caller's current directory is legal but leaves its shell
      // unusable. Move to a retained worktree (or its parent) first.
      if (isInside(process.cwd(), sourceRecord.path)) {
        process.chdir(baseRecord?.path ?? path.dirname(sourceRecord.path));
      }
      git(controlWorktree, ["-c", "core.hooksPath=/dev/null", "worktree", "remove", sourceRecord.path]);
      sourceWorktreeRemoved = true;
    }
    deleteVerifiedSafeSourceBranch(controlWorktree, baseBranch, sourceBranch, sourceRecord.head);
    sourceBranchDeleted = true;
    git(controlWorktree, ["-c", "core.hooksPath=/dev/null", "worktree", "prune"]);
  }

  if (options.apply && options.agent) {
    const actionId = dispatch.context?.action.id;
    if (!actionId) {
      throw validationError("Arcadia go cannot name the next agent worktree without a resolved Action.");
    }

    const planModel = dispatch.context?.planRecommendedModel ?? null;
    if (!options.model && !planModel) {
      throw validationError(
        "No model is resolved for the next agent session, and Arcadia go will not launch one unpinned.",
        {
          planPath: dispatch.context?.planPath ?? null,
          gitReconciliationAlreadyApplied: integration === "fast-forward" || integration === "already-integrated",
          note:
            integration === "fast-forward" || integration === "already-integrated"
              ? "The source was already integrated into the base branch and its worktree/branch retired " +
                "before this check runs, because the model recommendation must be read from the plan as it " +
                "exists after that merge, not before it. Only preparing the next agent worktree failed; nothing " +
                "needs to be undone."
              : "No Git state was changed by this refusal.",
          remedy:
            "Add `recommended_model` (and optionally `recommended_reasoning_effort`) to the plan's frontmatter, " +
            "or pass --model explicitly on this command."
        }
      );
    }
    // `recommended_model` is free-form text that may have been written with a
    // different agent in mind, so when Arcadia picks it automatically — no
    // explicit --model given — resolve it for this agent: a logical tier maps
    // through the model-tier registry, a concrete model the agent plausibly
    // owns is used as-is, and one that belongs to another agent falls back to
    // this agent's standard tier with a visible note. An explicit --model is
    // trusted as-is and never re-resolved.
    const workspacePath = resolveReadyWorkspace(options.workspace).workspacePath;
    modelResolution = options.model
      ? {
          model: options.model,
          effort: options.effort ?? dispatch.context?.planRecommendedReasoningEffort ?? null,
          tier: null,
          source: "explicit" as const,
          note: null
        }
      : resolveHandoffModel({
          agent: options.agent,
          recommendedModel: planModel,
          explicitEffort: options.effort ?? null,
          planEffort: dispatch.context?.planRecommendedReasoningEffort ?? null,
          registry: loadModelTierRegistry(workspacePath)
        });
    const model = modelResolution.model;
    const effort = modelResolution.effort;

    const tmux = options.tmux ?? systemTmux;
    if (options.launch && workspacePath) {
      const transition = withDatabase(workspacePath, (db) => resolveProjectTransition({
        repoRoot: controlWorktree,
        projectSlug,
        db,
        tmux
      }));
      if (transition.kind !== "launch") {
        throw validationError("The Project transition does not authorize a new Session launch.", {
          transition: transition.kind,
          reason: transition.reason,
          nextAction: transition.nextAction
        });
      }
    }

    const now = operationNow;
    // The conflict check and whatever it decides to do about it (resume's
    // reservation refresh, or a fresh worktree's creation+reservation) must
    // run inside one atomic transaction, not two separate `withDatabase`
    // calls -- otherwise two concurrent `go --apply --agent` invocations for
    // the same repository could both read "clear" before either commits, and
    // both prepare their own worktree, reproducing the exact duplicate this
    // Action exists to prevent (the same race `prepareSession` guards against
    // for its own lease/handoff checks; see its comment). `writeTransaction`
    // takes the write lock at `BEGIN IMMEDIATE`, so a second caller's
    // evaluation blocks until the first caller's write has committed.
    const reservationCommitCleanup: { candidate: GoCommandData["nextWorktree"] } = { candidate: null };
    // The generation this call claimed, so a preparation that fails after the
    // claim committed can release it explicitly rather than leaving the Action
    // blocked for the TTL's full 24 hours over work that never started.
    const claim: { generation: string | null; actionId: string } = { generation: null, actionId };
    // The pointer Action's own resolution, restored whenever a fallback attempt
    // is abandoned so a lost race cannot leave `dispatch` describing an Action
    // this call did not get.
    const pointerDispatch = dispatch;
    try {
      nextWorktree = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
        // The pointer's Action first, always. Only when it is already held by a
        // live worktree does the walk below offer anything else, and then only
        // Actions the ordered queue already reports as dependency-ready.
        const attempts: string[] = [actionId];
        // The refusal to report if nothing in `attempts` can be claimed: the
        // pointer Action's own, because that is the Action the operator asked
        // about and the one whose remedy they need.
        let refusal: CandidateEvaluation | null = null;
        // A claim race lost at the insert rather than at the lookup: the same
        // outcome, reported by the unique index instead of by the query, and
        // the refusal to re-raise when nothing else in the walk can be claimed.
        let lostRace: Error | null = null;
        let walked = false;

        for (let index = 0; index < attempts.length; index += 1) {
          const attemptActionId = attempts[index];
          const candidate = evaluateExistingCandidate(db, {
            controlWorktree,
            projectSlug,
            actionId: attemptActionId,
            agent: options.agent!,
            tmux,
            now
          });

          if (candidate.kind === "refuse") {
            refusal ??= candidate;
            if (attemptActionId === actionId) {
              // The pointer's own Action. Every refusal but this one is
              // repository-scoped -- a live Session, an unreconciled exit, an
              // unresolved candidate for another Action -- and a different ready
              // Action would hit it identically, so there is nothing to walk to.
              // Only a claimed Action is a refusal another Action can answer.
              if (candidate.code !== "action_claimed") break;
              walked = true;
              attempts.push(...queueWalkCandidates(db, { projectSlug, exclude: attempts, now }));
            }
            // A fallback candidate's refusal is necessarily about that Action
            // alone: every repository-scoped refusal would already have fired on
            // the pointer attempt above and broken the walk before reaching
            // here. So skip this entry and try the next, rather than letting one
            // Action's unresolved candidate stop the whole walk.
            continue;
          }

          if (candidate.kind === "resume") {
            // Per Decision 0051: the same governed Action still owns this
            // candidate and its prior Session is proven terminal (reconciled,
            // not merely exited), so resume it in place -- same worktree and
            // branch, repository lease handed over -- rather than preparing a
            // second one. No Git write happens here beyond refreshing the
            // handoff reservation so `tidy` does not retire it out from under
            // the resumed Session before it is used.
            reserveAgentWorktree(db, {
              repositoryPath: controlWorktree,
              worktreePath: candidate.path!,
              branch: candidate.branch!,
              now,
              project: projectSlug,
              actionId: attemptActionId
            });
            claim.actionId = attemptActionId;
            return {
              agent: options.agent!,
              path: candidate.path!,
              branch: candidate.branch!,
              model,
              effort,
              command: buildAgentLaunchCommand(options.agent!, candidate.path!, model, effort)
            };
          }

          // A fallback Action is dispatched from the same documents the pointer
          // was resolved from, and has to clear the same bar: the queue computed
          // its readiness from the configured checkout, which is not necessarily
          // the checkout this handoff dispatches from.
          if (attemptActionId !== actionId) {
            const fallbackDispatch = resolveDispatch(dispatchRoot, projectSlug, { actionId: attemptActionId });
            if (!isDispatchable(fallbackDispatch)) continue;
            dispatch = fallbackDispatch;
            queueFallback = {
              pointerActionId: actionId,
              actionId: attemptActionId,
              reason: refusal?.reason ?? "The governed pointer's Action is already claimed by a live worktree."
            };
          }

          try {
            const created = prepareAgentWorktree({
              agent: options.agent!,
              actionId: attemptActionId,
              baseBranch,
              repositoryPath: controlWorktree,
              rootOverride: options.agentWorktreeRoot,
              now,
              model,
              effort,
              beforeCreate(prepared) {
                claim.generation = reserveAgentWorktree(db, {
                  repositoryPath: controlWorktree,
                  worktreePath: prepared.path,
                  branch: prepared.branch,
                  now,
                  project: projectSlug,
                  actionId: attemptActionId
                }).claim_generation;
              }
            });
            claim.actionId = attemptActionId;
            reservationCommitCleanup.candidate = created;
            options.testHooks?.afterWorktreeCreatedBeforeReservationCommit?.();
            return created;
          } catch (error) {
            // Losing the claim race is the one failure the walk continues past,
            // and it costs nothing to recover from: `prepareAgentWorktree`
            // claims in `beforeCreate`, before it creates the branch or the
            // worktree, so a lost race leaves no Git state to undo. Anything
            // else -- a path collision, a Git failure -- is this call's own
            // problem and is raised, not walked away from.
            if (!isActionClaimRefusal(error)) throw error;
            lostRace ??= error;
            dispatch = pointerDispatch;
            queueFallback = null;
            if (attemptActionId === actionId && !walked) {
              walked = true;
              attempts.push(...queueWalkCandidates(db, { projectSlug, exclude: attempts, now }));
            }
          }
        }

        if (refusal) throw validationError(refusal.reason!, refusal.details);
        throw lostRace ?? validationError(
          "Arcadia go found no unclaimed, dependency-ready Action to dispatch.",
          { projectSlug, pointerActionId: actionId, remedy: "Finish or retire a live candidate, or add a ready Action to the queue." }
        );
      }));
    } catch (error) {
      // If SQLite cannot commit after Git created the worktree, do not leave a
      // clean, unreserved handoff that unattended tidy could immediately
      // retire. This worktree was created by this failed call and cannot yet
      // contain agent changes, so compensating removal is lossless.
      if (reservationCommitCleanup.candidate) {
        tryGit(controlWorktree, ["-c", "core.hooksPath=/dev/null", "worktree", "remove", reservationCommitCleanup.candidate.path]);
        tryGit(controlWorktree, ["-c", "core.hooksPath=/dev/null", "branch", "-D", reservationCommitCleanup.candidate.branch]);
      }
      throw error;
    }

    if (options.launch && workspacePath) {
      try {
        const prepared = withDatabase(workspacePath, (db) => prepareSession({
          db,
          workspace: workspacePath,
          repoRoot: controlWorktree,
          dispatch,
          // The launch guard above requires an explicit adapter before this path.
          agent: options.agent!,
          model,
          effort,
          baseRevision: git(controlWorktree, ["rev-parse", baseBranch]).trim(),
          branch: nextWorktree!.branch,
          worktreePath: nextWorktree!.path,
          now: options.now ?? new Date(),
          tmux: options.tmux
        }));
        session = withDatabase(workspacePath, (db) => launchPreparedSession(db, prepared, options.tmux, loadModelTierRegistry(workspacePath)));
      } catch (error) {
        // Session preparation failed outright after the claim had committed.
        // Release it here, fenced on the generation this call made, rather than
        // leaving the Action claimed by a Session that never started. The
        // release is a no-op if a later claim has already superseded this one.
        if (claim.generation) {
          withDatabase(workspacePath, (db) => writeTransaction(db, () => releaseActionClaim(db, {
            repositoryPath: controlWorktree,
            project: projectSlug,
            actionId: claim.actionId,
            generation: claim.generation!
          })));
        }
        throw error;
      }
    }
  }

  let preservation: PreservationReadiness | undefined;
  if (nextWorktree && !options.launch) {
    const workspacePath = resolveReadyWorkspace(options.workspace).workspacePath;
    preservation = withDatabase(workspacePath, db => {
      try {
        bindManualPreservation(db, { repository: controlWorktree, worktree: nextWorktree.path, baseBranch, projectSlug });
      } catch (error) {
        const readiness = readPreservationReadiness(db, { workspace: workspacePath, repository: controlWorktree, worktree: nextWorktree.path, projectSlug });
        readiness.blockers.unshift({ code: "manual_binding_failed", reason: error instanceof Error ? error.message : String(error) });
        return { ...readiness, ready: false };
      }
      return readPreservationReadiness(db, { workspace: workspacePath, repository: controlWorktree, worktree: nextWorktree.path, projectSlug });
    });
  }

  const transition = session && options.workspace
    ? withDatabase(resolveReadyWorkspace(options.workspace).workspacePath, (db) => resolveProjectTransition({
        repoRoot: controlWorktree,
        projectSlug,
        db,
        tmux: options.tmux ?? systemTmux
      }))
    : resolveProjectTransition({ repoRoot: controlWorktree, projectSlug });

  return createSuccess({
    command: "go",
    data: {
      applied: options.apply === true,
      ...(preservation ? { preservation } : {}),
      projectSlug,
      repositoryPath: controlWorktree,
      sourceWorktree: sourceRecord.path,
      sourceBranch,
      baseBranch,
      baseWorktree: baseRecord?.path ?? null,
      baseRemoteSync,
      integration,
      commitsToIntegrate,
      sourceWorktreeRemoved,
      sourceBranchDeleted,
      nextWorktree,
      modelResolution,
      dispatch,
      queueFallback,
      dispatchable: isDispatchable(dispatch),
      transition,
      session,
      handoff: {
        baseRef: baseBranch,
        prompt: "arcadia advance"
      },
      clutter: summarizeClutter(repo, baseBranch, [
        ...protectedWorktreePaths(controlWorktree, options.workspace, options.tmux ?? systemTmux),
        ...(nextWorktree ? [nextWorktree.path] : [])
      ]),
      askRecoveries
    }
  });
}

/**
 * Worktrees this nudge should not nag about: one this very call just prepared
 * (added separately by the caller, since that path is not on disk yet when
 * `git worktree list` would need to see it) and any worktree currently backing
 * a genuinely *live* Session -- active work, not clutter.
 *
 * Deliberately narrower than `tidy`'s own `getWorktreeProtection`, which also
 * shields anything with an unexpired 24h handoff reservation so it never
 * destroys a manual handoff nobody has touched yet. Reusing that same
 * blanket rule here hid real accumulation: two abandoned agent worktrees each
 * carrying their own still-unexpired reservation shielded each other,
 * reporting `extraWorktrees: 0` while both sat there uncounted. This nudge's
 * job is to notice that, not to protect it -- `tidy` still refuses to retire
 * a reservation-protected worktree even though this count no longer excludes
 * it.
 *
 * Best-effort on purpose. This feeds a nudge, not a decision: a missing
 * workspace, an uninitialized database, or a schema without the session
 * table must never fail `go`. Returning nothing only costs the nudge some
 * precision, which is the same precision it had before this existed.
 */
function protectedWorktreePaths(repo: string, workspace: string | undefined, tmux: Pick<TmuxAdapter, "hasSession">): string[] {
  try {
    const workspacePath = resolveWorkspace({ workspace, cwd: repo }).workspacePath;
    if (!workspacePath || !existsSync(getWorkspacePaths(workspacePath).databaseFile)) return [];
    return withReadOnlyDatabase(workspacePath, (db) => {
      const lease = getRepositoryLease(db, repo);
      if (!lease || !tmux.hasSession(lease.tmux_session_name)) return [];
      return listWorktrees(repo)
        .filter((record) => samePath(record.path, lease.worktree_path))
        .map((record) => record.path);
    });
  } catch {
    return [];
  }
}

interface CandidateEvaluation {
  kind: "clear" | "resume" | "refuse";
  /**
   * Set on `refuse` when the refusal is about *this Action* rather than about
   * this repository: another live worktree already claims it. It is the one
   * refusal a different ready Action can answer, so it is the one the
   * queue-walk fallback is allowed to continue past. Every other refusal --
   * a live Session, an unproven exit, an unresolved candidate for a different
   * Action -- would refuse identically whichever Action were asked about.
   */
  code?: "action_claimed";
  path?: string;
  branch?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * The next dependency-ready, still-unclaimed Actions `go` may fall back to,
 * in the order `buildAgentQueue` already computes -- the same order the
 * operator reads in `arcadia advance queue` and reorders with
 * `advance queue reorder`, so the fallback can never disagree with the
 * queue about what comes next.
 *
 * Only `ready` entries are offered: the queue already classifies a
 * dependency-blocked, question-open, decision-held or operator-owned Action as
 * `attention`, and an Action a live Session or Run owns as `running`, so
 * skipping everything else falls out of reading the queue rather than from a
 * second, drifting copy of its rules here.
 *
 * Best-effort: a workspace whose Project is not registered, or whose queue
 * cannot be built at all, yields no fallback and leaves the pointer Action's
 * original refusal standing -- which is exactly the behavior before this
 * existed.
 */
function queueWalkCandidates(
  db: Database.Database,
  input: { projectSlug: string; exclude: readonly string[]; now: Date }
): string[] {
  let queue;
  try {
    queue = buildAgentQueue(db, { now: input.now });
  } catch {
    return [];
  }
  const seen = new Set(input.exclude);
  const candidates: string[] = [];
  for (const entry of queue.ordered) {
    if (entry.state !== "ready" || entry.projectSlug !== input.projectSlug || !entry.actionId) continue;
    if (seen.has(entry.actionId)) continue;
    seen.add(entry.actionId);
    candidates.push(entry.actionId);
  }
  return candidates;
}

/** Whether an error is `reserveAgentWorktree` refusing a lost Action-claim race. */
function isActionClaimRefusal(error: unknown): error is Error {
  return error instanceof Error && error.message.includes("already claimed by a live worktree");
}

/**
 * Decide whether `go` may prepare a brand new worktree for `actionId`, per
 * Decision 0051: at most one live execution per candidate, and a sequential
 * Session for the same Action reuses its predecessor's candidate once that
 * predecessor's exit is *proven* terminal -- reconciled, not merely absent
 * from `tmux`. Every other case (a different Action's unresolved candidate, a
 * still-live Session, a dead-but-unreconciled Session, or an uncommitted
 * worktree Arcadia never launched and so cannot prove terminal at all) refuses
 * with the exact path and the operator's explicit choices, and creates
 * nothing.
 */
function evaluateExistingCandidate(
  db: Database.Database,
  input: {
    controlWorktree: string;
    projectSlug: string;
    actionId: string;
    agent: SessionAgent;
    tmux: Pick<TmuxAdapter, "hasSession">;
    now: Date;
  }
): CandidateEvaluation {
  const handoff = getResumableLeaseHandoff(db, input.controlWorktree);
  if (handoff) {
    if (input.tmux.hasSession(handoff.session.tmux_session_name)) {
      return {
        kind: "refuse",
        reason: "A prior Session for this repository is still live; Arcadia go will not prepare a second worktree while it runs.",
        details: {
          sessionId: handoff.session.id,
          worktreePath: handoff.session.worktree_path,
          tmuxSessionName: handoff.session.tmux_session_name,
          remedy: `Wait for it, or attach it directly: tmux attach-session -t ${handoff.session.tmux_session_name}.`
        }
      };
    }
    if (!existsSync(handoff.session.worktree_path)) {
      // The resumable candidate's worktree is gone -- removed outside
      // Arcadia (per this function's own "discard it" remedy below), or
      // never existed on this host. There is nothing left to resume or to
      // refuse over, whichever Action it named: checked before the
      // different-Action refusal so that discarding a stale candidate exactly
      // as instructed actually clears the block, instead of leaving `go`
      // refusing every Action forever over a worktree that no longer exists.
      return { kind: "clear" };
    }
    if (handoff.session.action_id !== input.actionId) {
      return {
        kind: "refuse",
        reason: "The repository holds an unresolved resumable candidate for a different Action; Arcadia go will not prepare a new worktree until it is resolved.",
        details: {
          existingActionId: handoff.session.action_id,
          currentActionId: input.actionId,
          worktreePath: handoff.session.worktree_path,
          remedy: "Preserve the existing candidate (finish or hand it off) or discard it (remove its worktree and branch) before starting a different Action."
        }
      };
    }
    return { kind: "resume", path: handoff.session.worktree_path, branch: handoff.session.branch.replace(/^refs\/heads\//, "") };
  }

  const liveLease = getRepositoryLease(db, input.controlWorktree);
  if (liveLease) {
    const stillLive = input.tmux.hasSession(liveLease.tmux_session_name);
    return {
      kind: "refuse",
      reason: stillLive
        ? "A Session is already live for this repository; Arcadia go will not prepare a second worktree while it runs."
        : "A Session's process has exited but was never reconciled; Arcadia go will not prepare a new worktree over an unproven exit.",
      details: {
        sessionId: liveLease.id,
        worktreePath: liveLease.worktree_path,
        actionId: liveLease.action_id,
        remedy: stillLive
          ? `Wait for it, or attach it directly: tmux attach-session -t ${liveLease.tmux_session_name}.`
          : `Reconcile it first: arcadia session reconcile ${liveLease.id} --request-id <unique-id>.`
      }
    };
  }

  // No DB-tracked Session or handoff owns a matching worktree. A worktree
  // prepared through a manual (never `--launch`ed) handoff leaves no tmux
  // name or session row behind, so Arcadia has no way to prove whether a
  // human terminal is still using it -- it is always reported, never
  // silently duplicated or auto-resumed.
  const orphan = findUncommittedManualCandidate(input.controlWorktree, input.actionId, input.agent);
  if (orphan) {
    return {
      kind: "refuse",
      reason: "A prepared worktree for this Action already holds uncommitted changes; Arcadia go will not prepare a second one.",
      details: {
        worktreePath: orphan.path,
        branch: orphan.branch,
        remedy: "This worktree was never launched through Arcadia, so its exit cannot be proven terminal. Preserve it (commit and push its work, or resume it by hand) or discard it (remove the worktree and branch) before retrying."
      }
    };
  }

  // Nothing in *this* checkout owns the Action. The claim is the cross-checkout
  // question the checks above cannot answer: the 2026-09-22 collision was two
  // worktrees under the same control checkout, each of which correctly saw no
  // Session, no handoff and no orphan of its own. A live claim is a hard
  // refusal, never an advisory flag a caller can act past -- the whole failure
  // being fixed is a session reading a clearly-worded brief and starting anyway.
  const claimed = getActiveActionClaim(db, input.controlWorktree, input.projectSlug, input.actionId, input.now);
  if (claimed) {
    return {
      kind: "refuse",
      code: "action_claimed",
      reason: "Another live worktree already claims this Action; Arcadia go will not dispatch it a second time.",
      details: {
        actionId: input.actionId,
        projectSlug: input.projectSlug,
        claimedByWorktreePath: claimed.worktree_path,
        claimedByBranch: claimed.branch,
        claimExpiresAt: claimed.expires_at,
        remedy: `Finish or retire ${claimed.worktree_path}, or dispatch a different ready Action.`
      }
    };
  }

  return { kind: "clear" };
}

/**
 * A worktree `prepareAgentWorktree` made for this exact Action and agent, still
 * on disk, still holding uncommitted changes, with no corresponding
 * `agent_sessions` row at all -- the manual-handoff case `evaluateExistingCandidate`
 * cannot otherwise see, matched the same way `prepareAgentWorktree` names one:
 * `<agent>/<slugified-action-id>-<timestamp>`.
 */
function findUncommittedManualCandidate(
  repositoryPath: string,
  actionId: string,
  agent: SessionAgent
): { path: string; branch: string } | null {
  const listing = tryGit(repositoryPath, ["worktree", "list", "--porcelain"]);
  if (listing === null) return null;
  const safeAction = actionId.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 72);
  const prefix = `refs/heads/${agent}/${safeAction}-`;
  for (const record of parseWorktrees(listing)) {
    if (!record.branch?.startsWith(prefix)) continue;
    if (!existsSync(record.path)) continue;
    if (uncommittedChanges(record.path).length === 0) continue;
    return { path: record.path, branch: record.branch.replace(/^refs\/heads\//, "") };
  }
  return null;
}

export function renderGoSuccess(response: CommandSuccess<GoCommandData>): string[] {
  const data = response.data;
  const action = data.dispatch.context?.action;
  const lines = [
    `Project: ${data.projectSlug}`,
    `Base: ${data.baseBranch}${data.baseWorktree ? ` — ${data.baseWorktree}` : " (not currently checked out)"}`,
    `Source: ${data.sourceBranch} — ${data.sourceWorktree}`,
    `Integration: ${data.integration}${data.commitsToIntegrate ? ` (${data.commitsToIntegrate} commit${data.commitsToIntegrate === 1 ? "" : "s"})` : ""}`
  ];

  if (data.baseRemoteSync.attempted) {
    lines.push(
      data.baseRemoteSync.strategy === "governed-merge"
        ? `Base remote sync: reconciled governed local commits with ${data.baseRemoteSync.remote} at ${data.baseRemoteSync.resultHead}.`
        : data.baseRemoteSync.fastForwarded
          ? `Base remote sync: fast-forwarded ${data.baseBranch} from ${data.baseRemoteSync.remote}.`
          : `Base remote sync: ${data.baseRemoteSync.reason}`
    );
  } else if (data.baseRemoteSync.reason) {
    lines.push(`Base remote sync: ${data.baseRemoteSync.reason}`);
  }

  if (!data.applied) {
    lines.push(
      "",
      "Preview only: no branch, worktree, or commit was changed.",
      "Run the same command with --apply to perform this exact safe reconciliation."
    );
  } else if (data.integration === "fast-forward") {
    lines.push(
      "",
      `Fast-forwarded ${data.sourceBranch} into ${data.baseBranch}.`,
      `Removed the clean source worktree and deleted the merged task branch.`
    );
  } else if (data.integration === "already-integrated") {
    lines.push(
      "",
      `${data.sourceBranch} was already integrated into ${data.baseBranch}; the base branch was left unchanged.`,
      "Removed the clean source worktree and deleted the verified-safe local task branch."
    );
  } else {
    lines.push("", "The source is already the clean base worktree; no Git reconciliation was needed.");
  }

  lines.push(
    "",
    `Dispatchable: ${data.dispatchable ? "yes" : "no"}`,
    `Current action: ${action?.id ?? "unresolved"}`,
    ...(data.queueFallback ? [
      `  ${data.queueFallback.pointerActionId} is already claimed by a live worktree; dispatched the next ready queue entry instead.`,
      "  The governed pointer was not moved.",
    ] : []),
    `Expected artifact: ${action?.expectedArtifact ?? "not declared"}`,
    "",
    data.nextWorktree
      ? `Prepared ${data.nextWorktree.agent} worktree: ${data.nextWorktree.path}`
      : `Start a fresh coding-agent session from ${data.handoff.baseRef} and prompt: ${data.handoff.prompt}`
  );
  if (data.nextWorktree) {
    lines.push(`Model: ${data.nextWorktree.model}${data.nextWorktree.effort ? ` (${data.nextWorktree.effort} effort)` : ""}`);
    if (data.modelResolution?.note) lines.push(`  ${data.modelResolution.note}`);
    else if (data.modelResolution?.tier) lines.push(`  Resolved the ${data.modelResolution.tier} tier for ${data.nextWorktree.agent}.`);
    lines.push(`Launch: ${data.nextWorktree.command}`);
  }
  if (data.preservation) {
    lines.push(`Preservation: ${data.preservation.ready ? "ready (local manual candidate)" : "needs configuration or repair"}`);
    lines.push(...data.preservation.blockers.map(b => `  ${b.code}: ${b.reason}`));
  }
  if (data.session) {
    lines.push(
      `Session: ${data.session.id} (${data.session.status})`,
      `Reattach: tmux attach-session -t ${data.session.tmux_session_name}`
    );
  }

  if (data.clutter) {
    lines.push("", ...renderClutter(data.clutter));
  }

  if (data.askRecoveries.length > 0) {
    lines.push("", "Recovered drifted Agent Ask input:");
    for (const recovery of data.askRecoveries) {
      lines.push(`  ${recovery.askFile} on ${recovery.branch}${recovery.requestId ? ` (request_id: ${recovery.requestId})` : ""}`);
    }
  }

  return lines;
}

/**
 * The nudge that would have prevented weeks of silent accumulation.
 *
 * `go` runs at the boundary between sessions, which is both when clutter is
 * created and the only moment anyone is reliably looking. Stating the counts
 * here costs nothing and turns "nobody noticed for weeks" into "you were told
 * every time."
 */
function renderClutter(clutter: NonNullable<GoCommandData["clutter"]>): string[] {
  const { extraWorktrees, branches, obviouslyMerged } = clutter;
  if (extraWorktrees === 0 && obviouslyMerged === 0) {
    return [`Repository state: clean — no extra worktrees, ${branches} branch${branches === 1 ? "" : "es"}.`];
  }

  const parts: string[] = [];
  if (extraWorktrees > 0) parts.push(`${extraWorktrees} extra worktree${extraWorktrees === 1 ? "" : "s"}`);
  if (obviouslyMerged > 0) parts.push(`${obviouslyMerged} already-merged branch${obviouslyMerged === 1 ? "" : "es"}`);

  return [
    `Repository state: ${parts.join(" and ")} out of ${branches} branches.`,
    "  Run `arcadia tidy` to see what is safe to retire (it changes nothing without --apply)."
  ];
}


type ReconciliationKind = GoCommandData["integration"] | null;

/**
 * Classify a completed task branch without changing either branch. A source
 * already reachable from the base, or whose every patch is already on the
 * base, has nothing left to integrate and may only be retired after the same
 * proof is repeated immediately before local-ref deletion.
 */
function reconciliationKind(cwd: string, baseBranch: string, sourceBranch: string): ReconciliationKind {
  if (sourceBranch === baseBranch) return "not-needed";
  if (isAncestor(cwd, sourceBranch, baseBranch) || isPatchEquivalent(cwd, baseBranch, sourceBranch)) {
    return "already-integrated";
  }
  if (isAncestor(cwd, baseBranch, sourceBranch)) return "fast-forward";
  return null;
}

/**
 * `git branch -d` compares a branch with its configured upstream when one
 * exists. That makes a stale `origin/<task>` ref veto deletion even after the
 * branch was locally proven integrated into the base. Delete the local ref
 * directly instead, but only when its exact head is still the verified head
 * and the proof still holds. This never reads or writes a remote ref.
 */
function deleteVerifiedSafeSourceBranch(cwd: string, baseBranch: string, sourceBranch: string, expectedHead: string): void {
  if (reconciliationKind(cwd, baseBranch, sourceBranch) !== "already-integrated") {
    throw validationError("The source branch changed before cleanup; Arcadia go will not delete it.", {
      sourceBranch,
      baseBranch,
      remedy: "Preserve the changed branch and route it through a reviewed Arcadia recovery; protected Go will not delete it."
    });
  }
  git(cwd, ["-c", "core.hooksPath=/dev/null", "update-ref", "-d", `refs/heads/${sourceBranch}`, expectedHead]);
}

/**
 * Fetch the base branch's tracked remote. Fast-forward ordinary ancestry; for
 * a true divergence, admit only recognized Arcadia-generated governance
 * commits and publish one conflict-free, two-parent host-controller commit.
 */
const FULL_GIT_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function emptyBaseRemoteSync(reason: string): BaseRemoteSync {
  return {
    attempted: false,
    remote: null,
    upstream: null,
    fastForwarded: false,
    strategy: "none",
    localHeadBefore: null,
    remoteHead: null,
    mergeBase: null,
    resultHead: null,
    localGovernanceCommits: [],
    remoteCommitsIntegrated: 0,
    reason
  };
}

function syncBaseBranchWithRemote(input: {
  controlWorktree: string;
  baseBranch: string;
  baseWorktreePath: string | null;
  sourceWorktreePath: string;
  sourceBranch: string;
  sourceHead: string;
  now: Date;
  beforePublish?: () => void;
}): BaseRemoteSync {
  const {
    controlWorktree,
    baseBranch,
    baseWorktreePath,
    sourceWorktreePath,
    sourceBranch,
    sourceHead,
    now,
    beforePublish
  } = input;
  const remoteName = tryGit(controlWorktree, ["config", "--get", `branch.${baseBranch}.remote`]);
  const remoteBranchRef = tryGit(controlWorktree, ["config", "--get", `branch.${baseBranch}.merge`]);
  if (!remoteName && !remoteBranchRef) {
    return emptyBaseRemoteSync("The base branch has no tracked remote configured.");
  }
  if (!remoteName || remoteName === "." || !remoteBranchRef?.startsWith("refs/heads/")) {
    unsupportedBaseHistory("The base branch upstream is not one protected remote branch.", {
      baseBranch,
      remoteName,
      remoteBranchRef
    });
  }
  const remoteBranch = remoteBranchRef.slice("refs/heads/".length);
  const upstream = `${remoteName}/${remoteBranch}`;
  const remoteRef = `refs/remotes/${remoteName}/${remoteBranch}`;
  const configuredFetch = tryGit(controlWorktree, ["config", "--get-all", `remote.${remoteName}.fetch`]);
  const standardFetch = `refs/heads/*:refs/remotes/${remoteName}/*`;
  if (!configuredFetch?.split("\n").some(value => value.replace(/^\+/, "") === standardFetch)) {
    unsupportedBaseHistory("The base remote does not use the recognized remote-tracking ref mapping.", {
      baseBranch,
      upstream,
      configuredFetch
    });
  }
  const baseHeadRef = "refs/heads/" + baseBranch;
  const sourceHeadRef = "refs/heads/" + sourceBranch;
  const localHeadBefore = resolveFullRef(controlWorktree, baseHeadRef, "local base branch");
  assertRefValue(controlWorktree, sourceHeadRef, sourceHead, "source branch before remote observation");
  const remoteHeadBefore = refExists(controlWorktree, remoteRef)
    ? resolveFullRef(controlWorktree, remoteRef, "remote-tracking branch")
    : null;
  const temporaryRemoteRef = `refs/arcadia/go-fetch/${process.pid}-${randomUUID()}`;
  try {
    fetchRemoteSnapshot({
      cwd: controlWorktree,
      remoteName,
      remoteBranchRef,
      temporaryRemoteRef,
      upstream
    });
    const remoteHead = resolveFullRef(controlWorktree, temporaryRemoteRef, "protected fetched upstream");
    if (remoteHeadBefore && remoteHeadBefore !== remoteHead &&
        !isAncestor(controlWorktree, remoteHeadBefore, remoteHead)) {
      unsupportedBaseHistory("The fetched upstream was rewritten instead of advanced.", {
        baseBranch,
        remote: upstream,
        previousRemoteHead: remoteHeadBefore,
        fetchedRemoteHead: remoteHead
      });
    }

    if (isAncestor(controlWorktree, remoteHead, localHeadBefore)) {
      assertSourceCompatibleWithLinearBase({
        cwd: controlWorktree,
        baseBranch,
        sourceBranch,
        sourceHead,
        plannedBaseHead: localHeadBefore
      });
      assertRefValue(controlWorktree, baseHeadRef, localHeadBefore, "local base before reporting current remote state");
      assertRefValue(controlWorktree, sourceHeadRef, sourceHead, "source branch before reporting current remote state");
      assertTrackingRefValue(controlWorktree, remoteRef, remoteHeadBefore);
      assertClean(sourceWorktreePath, "source worktree after remote observation");
      if (baseWorktreePath && !samePath(baseWorktreePath, sourceWorktreePath)) {
        assertClean(baseWorktreePath, "base worktree after remote observation");
      }
      publishRemoteTrackingSnapshot(controlWorktree, remoteRef, remoteHeadBefore, remoteHead);
      assertRefValue(controlWorktree, baseHeadRef, localHeadBefore, "local base after publishing current remote state");
      assertRefValue(controlWorktree, sourceHeadRef, sourceHead, "source branch after publishing current remote state");
      return {
        attempted: true,
        remote: remoteName,
        upstream,
        fastForwarded: false,
        strategy: "current",
        localHeadBefore,
        remoteHead,
        mergeBase: remoteHead,
        resultHead: localHeadBefore,
        localGovernanceCommits: [],
        remoteCommitsIntegrated: 0,
        reason: "Local base branch already contains its fetched remote."
      };
    }

    if (isAncestor(controlWorktree, localHeadBefore, remoteHead)) {
      assertSourceCompatibleWithLinearBase({
        cwd: controlWorktree,
        baseBranch,
        sourceBranch,
        sourceHead,
        plannedBaseHead: remoteHead
      });
      assertRefValue(controlWorktree, baseHeadRef, localHeadBefore, "local base before fast-forward");
      assertRefValue(controlWorktree, sourceHeadRef, sourceHead, "source branch before base fast-forward");
      assertClean(sourceWorktreePath, "source worktree before base fast-forward");
      if (baseWorktreePath && !samePath(baseWorktreePath, sourceWorktreePath)) {
        assertClean(baseWorktreePath, "base worktree before fast-forward");
      }
      publishRemoteTrackingSnapshot(controlWorktree, remoteRef, remoteHeadBefore, remoteHead);
      if (baseWorktreePath) {
        assertCheckedOutBranch(baseWorktreePath, baseHeadRef, "base worktree before fast-forward");
        git(baseWorktreePath, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", remoteHead]);
      } else {
        git(controlWorktree, ["-c", "core.hooksPath=/dev/null", "update-ref", baseHeadRef, remoteHead, localHeadBefore]);
      }
      assertRefValue(controlWorktree, baseHeadRef, remoteHead, "fast-forwarded local base");
      return {
        attempted: true,
        remote: remoteName,
        upstream,
        fastForwarded: true,
        strategy: "fast-forward",
        localHeadBefore,
        remoteHead,
        mergeBase: localHeadBefore,
        resultHead: remoteHead,
        localGovernanceCommits: [],
        remoteCommitsIntegrated: countRevisionRange(controlWorktree, localHeadBefore + ".." + remoteHead),
        reason: null
      };
    }

    if (!remoteHeadBefore) {
      unsupportedBaseHistory("Protected Go has no pinned prior observation of this divergent upstream.", {
        baseBranch,
        remote: upstream,
        localHead: localHeadBefore,
        remoteHead
      });
    }
    if (!baseWorktreePath) {
      unsupportedBaseHistory("Protected Go requires the clean base branch to be checked out before reconciling its divergence.", {
        baseBranch,
        sourceBranch,
        sourceWorktree: sourceWorktreePath,
        remote: upstream
      });
    }
    assertSourceIntegratedWithDivergentInput({
      cwd: controlWorktree,
      baseBranch,
      sourceBranch,
      sourceHead,
      localHead: localHeadBefore,
      remoteHead
    });

    const plan = inspectGovernedBaseDivergence({
      cwd: controlWorktree,
      baseBranch,
      upstream,
      localHead: localHeadBefore,
      remoteHead
    });
    const mergeTree = writeCleanBaseMergeTree(controlWorktree, localHeadBefore, remoteHead);
    const message = baseReconciliationCommitMessage({
      baseBranch,
      upstream,
      localHead: localHeadBefore,
      remoteHead,
      mergeBase: plan.mergeBase,
      localCommits: plan.localCommits.length,
      remoteCommits: plan.remoteCommits
    });
    const resultHead = createBaseReconciliationCommit({
      cwd: controlWorktree,
      tree: mergeTree,
      localHead: localHeadBefore,
      remoteHead,
      message,
      now
    });
    verifyReconciliationCommit(controlWorktree, resultHead, mergeTree, localHeadBefore, remoteHead);
    validateReconciledDispatch(controlWorktree, resultHead);

    beforePublish?.();
    assertRefValue(controlWorktree, baseHeadRef, localHeadBefore, "local base before reconciliation");
    assertRefValue(controlWorktree, sourceHeadRef, sourceHead, "source branch before reconciliation");
    assertTrackingRefValue(controlWorktree, remoteRef, remoteHeadBefore);
    assertClean(baseWorktreePath, "base worktree");
    assertCheckedOutBranch(baseWorktreePath, baseHeadRef, "base worktree before reconciliation");
    publishRemoteTrackingSnapshot(controlWorktree, remoteRef, remoteHeadBefore, remoteHead);
    git(baseWorktreePath, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", resultHead]);
    assertRefValue(controlWorktree, baseHeadRef, resultHead, "reconciled local base");
    assertClean(baseWorktreePath, "reconciled base worktree");

    return {
      attempted: true,
      remote: remoteName,
      upstream,
      fastForwarded: false,
      strategy: "governed-merge",
      localHeadBefore,
      remoteHead,
      mergeBase: plan.mergeBase,
      resultHead,
      localGovernanceCommits: plan.localCommits,
      remoteCommitsIntegrated: plan.remoteCommits,
      reason: null
    };
  } finally {
    tryGit(controlWorktree, ["-c", "core.hooksPath=/dev/null", "update-ref", "-d", temporaryRemoteRef]);
  }
}

function fetchRemoteSnapshot(input: {
  cwd: string;
  remoteName: string;
  remoteBranchRef: string;
  temporaryRemoteRef: string;
  upstream: string;
}): void {
  const result = spawnSync("git", [
    "-c",
    "core.hooksPath=/dev/null",
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "--refmap=",
    "--",
    input.remoteName,
    `${input.remoteBranchRef}:${input.temporaryRemoteRef}`
  ], {
    cwd: input.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw validationError("Protected Go could not observe the configured upstream branch.", {
      upstream: input.upstream,
      cause: result.stderr?.trim() || result.error?.message || null,
      remedy: "Restore the configured upstream or record a reviewed host-controller repair; no worktree was issued."
    });
  }
}

function assertSourceCompatibleWithLinearBase(input: {
  cwd: string;
  baseBranch: string;
  sourceBranch: string;
  sourceHead: string;
  plannedBaseHead: string;
}): void {
  if (input.sourceBranch === input.baseBranch) return;
  if (!SAFE_TASK_BRANCH.test(input.sourceBranch)) {
    unsupportedBaseHistory("Protected Go will not reconcile a non-agent-owned source branch.", input);
  }
  const integrated = isAncestor(input.cwd, input.sourceHead, input.plannedBaseHead) ||
    isPatchEquivalent(input.cwd, input.plannedBaseHead, input.sourceHead);
  const fastForwardable = isAncestor(input.cwd, input.plannedBaseHead, input.sourceHead);
  if (!integrated && !fastForwardable) {
    unsupportedBaseHistory("The source branch is not safely related to the observed base result.", input);
  }
}

function assertSourceIntegratedWithDivergentInput(input: {
  cwd: string;
  baseBranch: string;
  sourceBranch: string;
  sourceHead: string;
  localHead: string;
  remoteHead: string;
}): void {
  if (input.sourceBranch === input.baseBranch) return;
  if (!SAFE_TASK_BRANCH.test(input.sourceBranch)) {
    unsupportedBaseHistory("Protected Go will not reconcile a non-agent-owned source branch.", input);
  }
  const integratedLocal = isAncestor(input.cwd, input.sourceHead, input.localHead) ||
    isPatchEquivalent(input.cwd, input.localHead, input.sourceHead);
  const integratedRemote = isAncestor(input.cwd, input.sourceHead, input.remoteHead) ||
    isPatchEquivalent(input.cwd, input.remoteHead, input.sourceHead);
  if (!integratedLocal && !integratedRemote) {
    unsupportedBaseHistory("The divergent base cannot absorb source-only work through the governed-history route.", input);
  }
}

function publishRemoteTrackingSnapshot(
  cwd: string,
  remoteRef: string,
  expectedBefore: string | null,
  remoteHead: string
): void {
  const actual = resolveOptionalRef(cwd, remoteRef);
  if (actual === remoteHead) return;
  if (actual !== expectedBefore) {
    throw validationError("The remote-tracking ref changed during protected reconciliation.", {
      remoteRef,
      expected: expectedBefore,
      actual,
      observedRemoteHead: remoteHead,
      remedy: "Protected Go did not publish the planned base result. Retry through the fixed host-controller route."
    });
  }
  git(cwd, [
    "-c", "core.hooksPath=/dev/null",
    "update-ref",
    "-m", "arcadia go: observe protected upstream snapshot",
    remoteRef,
    remoteHead,
    expectedBefore ?? "0".repeat(remoteHead.length)
  ]);
  assertRefValue(cwd, remoteRef, remoteHead, "published remote-tracking snapshot");
}

function assertTrackingRefValue(cwd: string, ref: string, expected: string | null): void {
  const actual = resolveOptionalRef(cwd, ref);
  if (actual !== expected) {
    throw validationError("The remote-tracking ref changed before protected reconciliation could publish.", {
      ref,
      expected,
      actual,
      remedy: "Protected Go left the local base unchanged. Retry through the fixed host-controller route."
    });
  }
}

function inspectGovernedBaseDivergence(input: {
  cwd: string;
  baseBranch: string;
  upstream: string;
  localHead: string;
  remoteHead: string;
}): { mergeBase: string; localCommits: string[]; remoteCommits: number } {
  const { cwd, baseBranch, upstream, localHead, remoteHead } = input;
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    unsupportedBaseHistory("Protected Go refuses to reconcile a shallow base history.", input);
  }
  if (process.env.GIT_REPLACE_REF_BASE) {
    unsupportedBaseHistory("Protected Go refuses history with a custom replacement-ref namespace.", {
      ...input,
      replacementRefBase: process.env.GIT_REPLACE_REF_BASE
    });
  }
  const replacements = tryGit(cwd, ["for-each-ref", "--format=%(refname)", "refs/replace"]);
  if (replacements) {
    unsupportedBaseHistory("Protected Go refuses base history with replacement refs.", {
      ...input,
      replacements: replacements.split("\n").filter(Boolean)
    });
  }
  const graftPathOutput = git(cwd, ["rev-parse", "--git-path", "info/grafts"]).trim();
  const graftPath = path.isAbsolute(graftPathOutput) ? graftPathOutput : path.resolve(cwd, graftPathOutput);
  if (existsSync(graftPath) && readFileSync(graftPath, "utf8").trim()) {
    unsupportedBaseHistory("Protected Go refuses base history with legacy grafts.", {
      ...input,
      graftPath
    });
  }
  const customMergeDrivers = tryGit(cwd, ["config", "--get-regexp", "^merge\\..*\\.driver$"]);
  if (customMergeDrivers) {
    unsupportedBaseHistory("Protected Go refuses to run repository-configured merge drivers on the host.", {
      ...input,
      customMergeDrivers: customMergeDrivers.split("\n").filter(Boolean)
    });
  }
  const mergeBaseOutput = tryGit(cwd, ["merge-base", "--all", localHead, remoteHead]);
  const mergeBases = mergeBaseOutput?.split("\n").map(value => value.trim()).filter(Boolean) ?? [];
  if (mergeBases.length !== 1 || !FULL_GIT_OID.test(mergeBases[0])) {
    unsupportedBaseHistory("Protected Go requires exactly one complete shared merge base.", {
      ...input,
      mergeBases
    });
  }

  const localCommits = git(cwd, ["rev-list", "--reverse", remoteHead + ".." + localHead])
    .split("\n").map(value => value.trim()).filter(Boolean);
  const unrecognized = localCommits.filter(commit =>
    !isRecognizedGovernanceCommit(cwd, commit, { baseBranch, upstream, remoteHead })
  );
  if (localCommits.length === 0 || unrecognized.length > 0) {
    unsupportedBaseHistory("The divergent local base contains commits that are not recognized Arcadia-generated governance writes.", {
      ...input,
      unrecognizedCommits: unrecognized
    });
  }
  return {
    mergeBase: mergeBases[0],
    localCommits,
    remoteCommits: countRevisionRange(cwd, localHead + ".." + remoteHead)
  };
}

function isRecognizedGovernanceCommit(
  cwd: string,
  commit: string,
  context: { baseBranch: string; upstream: string; remoteHead: string }
): boolean {
  const parents = git(cwd, ["show", "-s", "--format=%P", commit]).trim().split(/\s+/).filter(Boolean);
  const message = git(cwd, ["show", "-s", "--format=%B", commit]);
  const subject = message.split(/\r?\n/, 1)[0];
  if (subject === "chore(arcadia): reconcile " + context.baseBranch + " with " + context.upstream) {
    return isRecognizedProtectedReconciliation(cwd, commit, parents, message, context);
  }
  if (parents.length !== 1) return false;
  const paths = git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit])
    .split("\0").filter(Boolean);
  if (paths.length === 0 || !paths.every(isGovernancePath)) return false;
  return (
    (/^chore\(arcadia\): settle .+$/.test(subject) &&
      /^Written by `arcadia agent-ask settle --apply` \([A-Za-z0-9][A-Za-z0-9_.:-]*\)\.$/m.test(message)) ||
    (/^chore\(arcadia\): point at .+$/.test(subject) &&
      /^Written by `arcadia advance queue make-next --apply` \([A-Za-z0-9][A-Za-z0-9_.:-]*\)\.$/m.test(message)) ||
    (/^chore\(arcadia\): answer Decision .+$/.test(subject) &&
      /^Written by `arcadia decision approve` \([A-Za-z0-9][A-Za-z0-9_.:-]*\)\.$/m.test(message)) ||
    (/^chore\(arcadia\): record (?:blocker|corrective|follow_up) .+$/.test(subject) &&
      /^Discovered by [^\n]+ \([A-Za-z0-9][A-Za-z0-9_.:-]*\)\.$/m.test(message))
  );
}

function isRecognizedProtectedReconciliation(
  cwd: string,
  commit: string,
  parents: string[],
  message: string,
  context: { baseBranch: string; upstream: string; remoteHead: string }
): boolean {
  if (parents.length !== 2 || !isAncestor(cwd, parents[1], context.remoteHead)) return false;
  const mergeBases = tryGit(cwd, ["merge-base", "--all", parents[0], parents[1]])
    ?.split("\n").map(value => value.trim()).filter(Boolean) ?? [];
  if (mergeBases.length !== 1 || !FULL_GIT_OID.test(mergeBases[0])) return false;
  const mergeAttempt = attemptBaseMergeTree(cwd, parents[0], parents[1]);
  if (mergeAttempt.status !== 0 || mergeAttempt.lines.length !== 1 ||
      !FULL_GIT_OID.test(mergeAttempt.lines[0])) return false;
  const actualTree = tryGit(cwd, ["show", "-s", "--format=%T", commit]);
  if (actualTree !== mergeAttempt.lines[0]) return false;
  const expectedMessage = baseReconciliationCommitMessage({
    baseBranch: context.baseBranch,
    upstream: context.upstream,
    localHead: parents[0],
    remoteHead: parents[1],
    mergeBase: mergeBases[0],
    localCommits: countRevisionRange(cwd, parents[1] + ".." + parents[0]),
    remoteCommits: countRevisionRange(cwd, parents[0] + ".." + parents[1])
  });
  return message.trimEnd() === expectedMessage;
}

function isGovernancePath(relativePath: string): boolean {
  return relativePath === "PROJECT.md" ||
    relativePath === "MISSION_LOG.md" ||
    /^docs\/(?:plans|decisions)\/.+\.md$/.test(relativePath) ||
    /^\.arcadia\/asks\/(?:archive\/)?agent-ask-.+\.ya?ml$/.test(relativePath);
}

function writeCleanBaseMergeTree(cwd: string, localHead: string, remoteHead: string): string {
  const result = attemptBaseMergeTree(cwd, localHead, remoteHead);
  if (result.status === 129 || /unknown option|usage: git merge-tree/i.test(result.stderr)) {
    throw validationError("The installed Git cannot compute a protected two-commit merge tree.", {
      localHead,
      remoteHead,
      cause: result.stderr || result.error,
      remedy: "Run the protected controller on a host with Git 2.38 or newer; no base ref or worktree was changed."
    });
  }
  if (result.status !== 0) {
    throw validationError("The governed local base and fetched remote do not reconcile cleanly; Arcadia left the base ref and worktree unchanged.", {
      localHead,
      remoteHead,
      conflictingPaths: result.lines.slice(1),
      cause: result.stderr || result.error,
      remedy: "Record a focused governed repair for the overlap, then request protected Go again."
    });
  }
  if (result.lines.length !== 1 || !FULL_GIT_OID.test(result.lines[0])) {
    throw validationError("Git did not return one auditable tree for protected base reconciliation.", {
      localHead,
      remoteHead,
      output: result.lines
    });
  }
  return result.lines[0];
}

function attemptBaseMergeTree(cwd: string, localHead: string, remoteHead: string): {
  status: number | null;
  lines: string[];
  stderr: string;
  error: string | null;
} {
  const result = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", localHead, remoteHead], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const lines = result.stdout?.split("\n").map(value => value.trim()).filter(Boolean) ?? [];
  return {
    status: result.status,
    lines,
    stderr: result.stderr?.trim() ?? "",
    error: result.error?.message ?? null
  };
}

function createBaseReconciliationCommit(input: {
  cwd: string;
  tree: string;
  localHead: string;
  remoteHead: string;
  message: string;
  now: Date;
}): string {
  const stamp = input.now.toISOString();
  let resultHead: string;
  try {
    resultHead = execFileSync("git", [
      "-c", "core.hooksPath=/dev/null",
      "-c", "commit.gpgSign=false",
      "commit-tree", input.tree,
      "-p", input.localHead,
      "-p", input.remoteHead,
      "-m", input.message
    ], {
      cwd: input.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Arcadia Controller",
        GIT_AUTHOR_EMAIL: "controller@arcadia.local",
        GIT_COMMITTER_NAME: "Arcadia Controller",
        GIT_COMMITTER_EMAIL: "controller@arcadia.local",
        GIT_AUTHOR_DATE: stamp,
        GIT_COMMITTER_DATE: stamp
      }
    }).trim();
  } catch (error) {
    const detail = error as { stderr?: Buffer | string; message?: string };
    throw validationError("Protected Go could not create the pinned reconciliation commit.", {
      cause: String(detail.stderr ?? detail.message ?? error).trim()
    });
  }
  if (!FULL_GIT_OID.test(resultHead)) {
    throw validationError("Git did not return a full object id for the host-controller reconciliation commit.", {
      resultHead
    });
  }
  return resultHead;
}

function verifyReconciliationCommit(
  cwd: string,
  resultHead: string,
  expectedTree: string,
  localHead: string,
  remoteHead: string
): void {
  const parents = git(cwd, ["show", "-s", "--format=%P", resultHead]).trim();
  const tree = git(cwd, ["show", "-s", "--format=%T", resultHead]).trim();
  if (parents !== localHead + " " + remoteHead || tree !== expectedTree) {
    throw validationError("The generated reconciliation commit does not match its pinned parents and tree.", {
      resultHead,
      expectedParents: [localHead, remoteHead],
      actualParents: parents.split(/\s+/).filter(Boolean),
      expectedTree,
      actualTree: tree
    });
  }
}

function validateReconciledDispatch(cwd: string, resultHead: string): void {
  const scratchRoot = mkdtempSync(path.join(tmpdir(), "arcadia-go-reconcile-"));
  const checkout = path.join(scratchRoot, "checkout");
  let registered = false;
  try {
    git(cwd, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", checkout, resultHead]);
    registered = true;
    const projectSlug = resolveProjectSlug(checkout);
    const dispatch = resolveDispatch(checkout, projectSlug);
    if (!isDispatchable(dispatch)) {
      throw validationError("The conflict-free base reconciliation does not resolve a dispatchable governed Action.", {
        resultHead,
        projectSlug,
        blockers: dispatch.blockers,
        operatorQuestion: dispatch.operatorQuestion,
        remedy: "Record a focused governed repair for the merged control documents; protected Go left the base unchanged."
      });
    }
  } finally {
    if (registered) {
      tryGit(cwd, ["-c", "core.hooksPath=/dev/null", "worktree", "remove", "--force", checkout]);
    }
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function baseReconciliationCommitMessage(input: {
  baseBranch: string;
  upstream: string;
  localHead: string;
  remoteHead: string;
  mergeBase: string;
  localCommits: number;
  remoteCommits: number;
}): string {
  return [
    "chore(arcadia): reconcile " + input.baseBranch + " with " + input.upstream,
    "",
    "Local-Head: " + input.localHead,
    "Remote-Head: " + input.remoteHead,
    "Merge-Base: " + input.mergeBase,
    "Local-Governance-Commits: " + input.localCommits,
    "Remote-Commits-Integrated: " + input.remoteCommits,
    "",
    "Written by protected Arcadia Go host-controller reconciliation."
  ].join("\n");
}

function resolveFullRef(cwd: string, ref: string, label: string): string {
  const value = git(cwd, ["rev-parse", "--verify", ref]).trim();
  if (!FULL_GIT_OID.test(value)) {
    throw validationError("The " + label + " did not resolve to a full object id.", { ref, value });
  }
  return value;
}

function resolveOptionalRef(cwd: string, ref: string): string | null {
  const value = tryGit(cwd, ["rev-parse", "--verify", ref]);
  return value && FULL_GIT_OID.test(value) ? value : null;
}

function assertRefValue(cwd: string, ref: string, expected: string, label: string): void {
  const actual = tryGit(cwd, ["rev-parse", "--verify", ref]);
  if (actual !== expected) {
    throw validationError("The " + label + " changed during protected reconciliation.", {
      ref,
      expected,
      actual,
      remedy: "Protected Go did not publish the planned result. Retry through the fixed host-controller route."
    });
  }
}

function assertCheckedOutBranch(cwd: string, expectedRef: string, label: string): void {
  const actual = tryGit(cwd, ["symbolic-ref", "-q", "HEAD"]);
  if (actual !== expectedRef) {
    throw validationError("The " + label + " changed branches during protected reconciliation.", {
      expectedRef,
      actual,
      remedy: "Protected Go did not publish the planned result. Retry through the fixed host-controller route."
    });
  }
}

function countRevisionRange(cwd: string, range: string): number {
  return Number.parseInt(git(cwd, ["rev-list", "--count", range]).trim(), 10);
}

function unsupportedBaseHistory(message: string, details: Record<string, unknown>): never {
  throw validationError(message, {
    ...details,
    remedy: "Arcadia left both histories untouched. Preserve the repository and record a reviewed host-controller repair; protected Go issued no worktree."
  });
}

function resolveProjectSlug(repoRoot: string): string {
  const discovered = discoverDocs(repoRoot);
  const projects = discovered.docs.filter((doc) => doc.type === "project");
  if (projects.length !== 1) {
    throw validationError("Arcadia go requires exactly one managed Project document in the repository.", {
      projects: projects.map((project) => project.slug),
      errors: discovered.errors
    });
  }
  return projects[0].slug;
}
