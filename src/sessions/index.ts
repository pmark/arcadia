import { assertLocalBrowserAuditReady } from "./localBrowserAuditReadiness.js";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { providerLabel } from "../codingAgents/adapters.js";
import { agentIdentityEnvironmentArgs, resolveSessionAgentIdentity, type AgentGitIdentity } from "../codingAgents/agentIdentity.js";
import { readProjectPartners } from "./partners.js";
import { claudeReasoningEffort, codexReasoningEffort } from "../codingAgents/reasoningEffort.js";
import { readClaudeCodeTokenFile } from "../codingAgents/claudeCodeToken.js";
import { loadModelTierRegistry, sessionStartBinding, type ModelTierRegistry } from "../codingAgents/modelTiers.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { writeTransaction } from "../db/connection.js";
import { getProjectBySlug, getProjectMetadata, getWorkItemByDocRef, listCodexInvocationsForWorkItem } from "../db/repositories.js";
import { decodeStringArray } from "../projects/setup.js";
import { writeHeadlessClaudeSettings } from "./headlessPermissions.js";
import { sessionRecordingFor, wrapRecordedLaunch, type SessionRecording } from "./sessionRecording.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import type { OperatorGateResolution } from "../docs/operatorGate.js";
import { resolveOperatorGate } from "../ask/operatorGate.js";
import { resolvePlanActivation, type PlanActivationResolution } from "../dispatch/planActivation.js";
import { loadActionOrder } from "../dispatch/order.js";
import { packetSha256 } from "../execution/planningAuthorization.js";
import { releaseAdmission } from "../production/policy.js";
import { createId } from "../utils/id.js";
import { isAncestor, isPatchEquivalent, mergedPullRequests, refExists, resolveBaseBranch, tryGit, uncommittedChanges } from "../git/worktrees.js";
import { renderActionBrief } from "./actionBrief.js";
import { sessionDevelopedForSupersededInput } from "./roleLineage.js";
import { getResumableLeaseHandoff, getSessionContinuation, supersedeLeaseHandoff } from "./reconciliation.js";
import { formatSessionTitle } from "./sessionTitle.js";
import { opencodeVariant } from "./worktreePreparation.js";

export type ProjectTransitionKind =
  | "launch"
  | "plan"
  | "decision"
  | "repair"
  | "reconcile"
  | "wait"
  | "complete_milestone"
  /**
   * The active Plan can no longer continue, but the explicit queue determines
   * exactly one approved Plan and Action that can. `activation` carries that
   * selection; applying it is the caller's job (Decision 0048).
   */
  | "activate";

export interface ProjectTransition {
  kind: ProjectTransitionKind;
  reason: string;
  nextAction: string;
  sessionId: string | null;
  dispatch: DispatchResolution;
  /**
   * Present for a plan-boundary transition, so a caller can apply (or preview)
   * the exact cross-Plan activation the queue selected instead of re-deriving
   * it. Null/absent everywhere else.
   */
  activation?: PlanActivationResolution | null;
  /**
   * Every pending operator item (unsettled Agent Ask proposal, open Decision)
   * scoped to this Project, classified against `dispatch`. Present whenever
   * `input.db` was supplied — the gate needs a database read `resolveDispatch`
   * itself never takes. A `kind: "decision"` transition caused by a blocking
   * item names it in `reason`/`nextAction`; `blocking` and `alerts` are the
   * full classification for a caller that wants to render more than the first.
   */
  operatorGate?: OperatorGateResolution;
}

export interface AgentSession {
  id: string;
  project_id: string;
  project_slug: string;
  repository_path: string;
  plan_path: string;
  plan_slug: string;
  action_id: string;
  work_item_id: string;
  packet_id: string;
  packet_path: string;
  packet_sha256: string;
  authorizing_decisions_json: string;
  execution_profile_json: string | null;
  provider_profile: string;
  provider: string;
  model: string;
  effort: string | null;
  provider_mapping_id: string | null;
  provider_binding_id: string | null;
  base_revision: string;
  /** The worktree HEAD to verify immediately before launch; falls back to `base_revision` when null. See `ensureAgentSessionLaunchRevisionColumn`. */
  launch_revision: string | null;
  branch: string;
  worktree_path: string;
  provider_session_id: string;
  display_name: string;
  terminal_transport: "tmux";
  tmux_session_name: string;
  host: string;
  status: "prepared" | "running" | "completed" | "failed" | "needs_input";
  prepared_at: string;
  started_at: string | null;
  ended_at: string | null;
  exit_status: number | null;
  created_at: string;
  updated_at: string;
  /** Hash of last-captured tmux pane scrollback. Null until a capture has ever succeeded. */
  last_pane_signature: string | null;
  /** Hash of last-observed Run/receipt state (status + updated_at). Null until first observed. */
  last_run_signature: string | null;
  /** When either signature last changed. Null until first observed. */
  last_activity_at: string | null;
  /** Set once neither signature has changed for the stall deadline; cleared on resumed activity. */
  stall_flagged_at: string | null;
  /** The standing-policy production admission this Session's launch committed against, if any. */
  admission_request_id: string | null;
  /** Per-launch wall-clock limit override in ms; null defers to policy, then the default. See `src/production/sessionLifetime.ts`. */
  time_limit_ms: number | null;
  /** Why Arcadia itself ended this Session (time limit or persistent blocking signal); copied onto its exit receipt. */
  stop_reason: string | null;
  /** 1 only for a Session launched under the deterministic fixture provider (`fixture-cli`); see `FIXTURE_PROVIDER`. */
  is_simulated: number;
}

export type SessionAgent = "codex" | "claude" | "opencode";

const SESSION_PROVIDER: Record<SessionAgent, string> = {
  codex: "codex-cli",
  claude: "claude-code-cli",
  opencode: "opencode-cli"
};

/**
 * The deterministic, zero-token coding-agent provider used to exercise the
 * Session/tmux/admission path end to end without spending a real model
 * invocation. Deliberately excluded from `SessionAgent`/`SESSION_AGENTS`: that
 * union backs operator-facing surfaces (`arcadia go --agent`, the go-broker
 * installer's `ProviderExecutables`) that must never offer or expect a
 * "fixture" broker. `sessionAgentForProvider` and `prepareSession` recognize
 * it through this narrower, parallel path instead.
 */
export const FIXTURE_PROVIDER = "fixture-cli";
const FIXTURE_AGENT = "fixture" as const;
export type FixtureSessionAgent = typeof FIXTURE_AGENT;
/** Any agent kind `prepareSession`/`buildSessionLaunch` accept: every real `SessionAgent`, plus the fixture. */
export type LaunchAgent = SessionAgent | FixtureSessionAgent;

/**
 * Every Session agent, in registry order. Surfaces that must enumerate
 * providers — launcher rendering, installer links, launch-command maps — read
 * this instead of restating the union, so adding an agent here can never leave
 * one of them silently supporting only the providers it happened to name.
 */
export const SESSION_AGENTS: readonly SessionAgent[] = Object.freeze(
  Object.keys(SESSION_PROVIDER) as SessionAgent[]
);

/**
 * The single provider-to-agent map, derived from `SESSION_PROVIDER` so the two
 * can never drift. `launchGuardedHostSession` and `prepareSession` both resolve
 * through here, so a provider can never be launchable without a matching
 * Session adapter (and vice versa).
 */
const SESSION_AGENT: Record<string, SessionAgent> = Object.fromEntries(
  (Object.entries(SESSION_PROVIDER) as Array<[SessionAgent, string]>).map(([agent, provider]) => [provider, agent])
);

/** The provider id a Session launched for `agent` records (`claude` is `claude-code-cli`). */
export function providerForSessionAgent(agent: SessionAgent): string {
  return SESSION_PROVIDER[agent];
}

/** The Session agent that launches `provider` (including the fixture), or null when no adapter exists. */
export function sessionAgentForProvider(provider: string): LaunchAgent | null {
  if (provider === FIXTURE_PROVIDER) return FIXTURE_AGENT;
  return SESSION_AGENT[provider] ?? null;
}

export interface AgentWorktreeReservation {
  id: string;
  repository_path: string;
  worktree_path: string;
  branch: string;
  created_at: string;
  expires_at: string;
  /** The Project slug this worktree claims an Action in; null for a reservation made without a claim. */
  project: string | null;
  /** The Action this worktree claims; null for a reservation made without a claim. */
  action_id: string | null;
  /**
   * A fresh id per claim, never reused -- the fence a settlement presents to
   * prove the claim it is settling against is still the one it started with.
   * An expiry timestamp alone cannot do this: the dangerous case is not a claim
   * that expired and was correctly refused, it is a claim that expired, was
   * reclaimed by a second session that did genuinely new work, and is then
   * settled against by the first session, still alive and merely slow.
   */
  claim_generation: string | null;
}

/** The identity a caller must present to release or settle against a claim. */
export interface ActionClaimFence {
  repositoryPath: string;
  project: string;
  actionId: string;
  generation: string;
}

/**
 * Fallback cleanup only, never primary.
 *
 * A normal completion releases its claim through settlement, and a failed
 * preparation releases it before returning its error (`releaseActionClaim`).
 * This TTL exists for the one case neither can cover -- an owning process that
 * genuinely died mid-work -- because leaning on it for either of the others
 * would leave a finished or never-started Action wrongly claimed, blocking
 * legitimate re-dispatch for up to a day.
 *
 * Expiry alone never releases an Action *claim* whose candidate is still
 * unmerged (Issue #549): a PR that waits more than a day for review is not a
 * dead owner, and letting the claim lapse let `go` dispatch the same Action to
 * a second worktree. See `expiredClaimStillHeld`.
 */
export const AGENT_WORKTREE_RESERVATION_MS = 24 * 60 * 60 * 1000;

export interface TmuxAdapter {
  available(): boolean;
  hasSession(name: string): boolean;
  /**
   * `record`, present on every headless launch, tells the adapter to run
   * `command` through the recording wrapper (`wrapRecordedLaunch`): combined
   * output appended to the Session's log under the workspace and the provider's
   * exit code written to `agent_sessions.exit_status`. An adapter that ignores
   * it (a test double) simply runs the command; an interactive TUI launch
   * carries none, because piping a TUI's output would break it.
   */
  launch(input: { name: string; cwd: string; command: string; args: string[]; record?: SessionRecording }): void;
  /**
   * The pane's full scrollback (not just the currently visible screen), used
   * only as a progress signal (see `src/production/stallDetection.ts`) --
   * scrollback grows as new lines are produced even when the visible screen
   * happens to show a repeating pattern (a spinner, a recurring log line),
   * so it changes far more reliably than a bare visible-screen snapshot
   * would. Returns `null`, never `""`, when a capture could not be taken, so
   * a transient failure is distinguishable from a genuinely empty pane and
   * is never mistaken for either new activity or its absence. Optional
   * because it is meaningless once a Session's tmux is already gone, and
   * every existing test double that implements `TmuxAdapter` predates this
   * capability.
   */
  capturePane?(name: string): string | null;
  /**
   * End the tmux session and nothing else: the Session's worktree and branch
   * are never touched. Used only by the bounded-lifetime guard
   * (`src/production/sessionLifetime.ts`). Optional for the same reason as
   * `capturePane`: test doubles predate it.
   */
  killSession?(name: string): void;
}

/**
 * Every managed Session's tmux session name starts with this. It is the one
 * host-visible fact a Session cannot forge away by clearing its environment
 * or changing directory: `arcadia worker` uses it (via a live tmux pane
 * ancestry check, not this constant's presence in an env var) to refuse when
 * the caller descends from a dispatched Session rather than the operator's
 * own terminal or launchd.
 */
export const MANAGED_SESSION_TMUX_PREFIX = "arcadia-";

/**
 * The environment for every tmux invocation that creates or queries an
 * Arcadia-managed session -- launch, presence check, pane capture, and the
 * worker's Session-descendant guard in `src/commands/worker.ts` -- with
 * `TMUX`/`TMUX_TMPDIR` removed.
 *
 * Those two variables pick which server socket tmux talks to. Without this,
 * a dispatching process that happens to have them set (nested inside its own
 * unrelated tmux session, say) would launch a managed Session on a
 * *different* socket than the one the worker guard always queries, and the
 * guard would see no pane there and refuse nothing. Every caller in this file
 * and in the worker guard uses this one helper so launch and lookup can never
 * drift onto different sockets.
 */
export function tmuxQueryEnv(): NodeJS.ProcessEnv {
  const { TMUX: _tmux, TMUX_TMPDIR: _tmuxTmpdir, ...env } = process.env;
  return env;
}

export const systemTmux: TmuxAdapter = {
  available() {
    try { execFileSync("tmux", ["-V"], { stdio: "ignore", env: tmuxQueryEnv() }); return true; } catch { return false; }
  },
  hasSession(name) {
    try { execFileSync("tmux", ["has-session", "-t", `=${name}`], { stdio: "ignore", env: tmuxQueryEnv() }); return true; } catch { return false; }
  },
  launch(input) {
    const run = input.record ? wrapRecordedLaunch(input, input.record) : input;
    execFileSync("tmux", ["new-session", "-d", "-s", input.name, "-c", input.cwd, run.command, ...run.args], {
      stdio: "ignore",
      env: tmuxQueryEnv()
    });
  },
  killSession(name) {
    // `kill-session` only; never the worktree or branch. A session that is
    // already gone is the goal state, so a failure is swallowed -- the caller
    // re-checks `hasSession`.
    try { execFileSync("tmux", ["kill-session", "-t", `=${name}`], { stdio: "ignore", env: tmuxQueryEnv() }); } catch { /* already gone */ }
  },
  capturePane(name) {
    // The trailing colon matters: `capture-pane` takes a *pane* target, and
    // tmux only resolves an exact-match session to its active pane when the
    // target ends in `:` (`=name:`). A bare `=name` is a valid session target
    // for `has-session` but makes `capture-pane` fail with "can't find pane",
    // which this method would swallow into `null` -- silently discarding the
    // pane progress signal for every live Session (Issue #564).
    //
    // -S -2000 bounds the captured scrollback to (at most) tmux's own default
    // history-limit, rather than the unbounded "-" (whole history): a verbose
    // long-running command against a raised history-limit could otherwise
    // exceed execFileSync's buffer and throw on every later tick, permanently
    // disabling the pane signal for that Session. maxBuffer is raised well
    // past the default 1 MiB as a second margin against the same failure.
    try {
      return execFileSync("tmux", ["capture-pane", "-t", `=${name}:`, "-p", "-S", "-2000"], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        env: tmuxQueryEnv()
      });
    } catch {
      return null;
    }
  }
};

export function resolveProjectTransition(input: {
  repoRoot: string;
  projectSlug: string;
  db?: Database.Database;
  tmux?: Pick<TmuxAdapter, "hasSession">;
  /**
   * Resolve this Action's brief instead of the pointer's. Set by a caller that
   * already knows which Action it is answering about because it holds that
   * Action's worktree claim -- `arcadia advance` inside a worktree `go`'s
   * queue-walk fallback dispatched. Reads only; the pointer is not consulted
   * and not moved.
   */
  actionId?: string;
}): ProjectTransition {
  const dispatch = resolveDispatch(input.repoRoot, input.projectSlug, { actionId: input.actionId });
  if (input.db) {
    const lease = getRepositoryLease(input.db, path.resolve(input.repoRoot));
    if (lease) {
      const live = (input.tmux ?? systemTmux).hasSession(lease.tmux_session_name);
      return {
        kind: live ? "wait" : "reconcile",
        reason: live ? `Session ${lease.id} is still running.` : `Session ${lease.id} is no longer live and needs reconciliation.`,
        nextAction: live ? `tmux attach-session -t ${lease.tmux_session_name}` : `Reconcile Session ${lease.id}.`,
        sessionId: lease.id,
        dispatch
      };
    }
    const run = getCompetingManagedRun(input.db, path.resolve(input.repoRoot));
    if (run) {
      return {
        kind: "wait",
        reason: `Managed Run ${run.id} is still ${run.status} for this repository.`,
        nextAction: `Wait for or reconcile managed Run ${run.id} before launching another Session.`,
        sessionId: null,
        dispatch
      };
    }
  }
  if (isDispatchable(dispatch)) {
    const operatorGate = input.db
      ? resolveOperatorGate({
          db: input.db,
          repoRoot: input.repoRoot,
          projectSlug: input.projectSlug,
          selectedActionId: dispatch.context!.action.id
        })
      : undefined;
    const blocker = operatorGate?.blocking[0];
    if (blocker) {
      return {
        kind: "decision",
        reason: `${blocker.title}${blocker.consequence ? ` — ${blocker.consequence}` : ""}`,
        nextAction: `Settle this before dispatch: ${blocker.settleCommand}`,
        sessionId: null,
        dispatch,
        operatorGate
      };
    }
    return {
      kind: "launch",
      reason: "The selected Action is dispatchable.",
      nextAction: dispatch.context!.action.nextAction!,
      sessionId: null,
      dispatch,
      operatorGate
    };
  }
  // A lease or run makes waiting/reconciling the only move, even when the
  // pointer itself is at a Plan boundary: the earlier branch already returned
  // for that case, so reaching here means no lease or competing Run is live.
  if (input.db) {
    const boundary = planBoundaryTransition(dispatch);
    if (boundary) {
      const activation = resolvePlanActivation({
        repoRoot: input.repoRoot,
        projectSlug: input.projectSlug,
        positions: loadActionOrder(input.db).positions
      });
      if (activation.status === "candidate" || activation.status === "unordered") {
        return {
          kind: "activate",
          reason: activation.reason,
          nextAction: activation.candidate
            ? `Activate Plan "${activation.candidate.planSlug}" and make ${activation.candidate.actionKey} current.`
            : activation.reason,
          sessionId: null,
          dispatch,
          activation
        };
      }
      if (activation.status === "ambiguous") {
        return {
          kind: "decision",
          reason: activation.reason,
          nextAction: `Answer the ambiguity before advancing: ${activation.reason}`,
          sessionId: null,
          dispatch,
          activation
        };
      }
      if (!activation.remainingWork) {
        return {
          kind: "complete_milestone",
          reason: "Every Action in this Project's active Plans is done, blocked, or deferred.",
          nextAction: "Record the Project milestone as complete, or activate a new Plan.",
          sessionId: null,
          dispatch,
          activation
        };
      }
    }
  }
  if (dispatch.operatorQuestion || dispatch.context?.action.responsibility === "requires_review") {
    return { kind: "decision", reason: dispatch.operatorQuestion ?? "The selected Action belongs to the operator.", nextAction: dispatch.operatorQuestion ?? dispatch.context?.action.nextAction ?? "Record the required Decision.", sessionId: null, dispatch };
  }
  if (dispatch.context?.action.responsibility === "blocked") {
    return { kind: "wait", reason: "The selected Action is externally blocked.", nextAction: dispatch.context.action.nextAction ?? "Wait for the named external condition.", sessionId: null, dispatch };
  }
  if (dispatch.context?.action.status === "done") {
    return { kind: "complete_milestone", reason: "The selected Action is done and the pointer must advance.", nextAction: dispatch.blockers[0]?.remedy ?? "Complete the Milestone or select its next Action.", sessionId: null, dispatch };
  }
  const missingPlan = dispatch.blockers.some((blocker) => blocker.field === "active_plan" || blocker.field === "current_action");
  return {
    kind: missingPlan ? "plan" : "repair",
    reason: dispatch.blockers[0]?.message ?? "The Project needs a governed next step.",
    nextAction: dispatch.blockers[0]?.remedy ?? "Prepare the Project's next governed Action.",
    sessionId: null,
    dispatch
  };
}

/**
 * True when the dispatch resolution describes a Plan boundary the total
 * transition resolver may cross (Decision 0048): the active Plan is absent,
 * complete, or points at a done Action. Deliberately false for a genuine
 * document defect — a parse error, an inactive Project, a missing PROJECT.md —
 * so those still surface as a repair rather than silently activating a
 * different Plan over them.
 */
function planBoundaryTransition(dispatch: DispatchResolution): boolean {
  if (dispatch.context) {
    return dispatch.context.action.status === "done" || dispatch.context.planStatus === "complete";
  }
  if (dispatch.blockers.length === 0) return false;
  return dispatch.blockers.every((blocker) =>
    blocker.field === "active_plan" ||
    blocker.field === "current_action" ||
    // A plan-level `status` blocker only crosses a *finished* Plan. A draft or
    // superseded pointer is a document defect to repair, not a boundary.
    (blocker.field === "status" && /(^|\/)docs\/plans\//.test(blocker.relativePath) && blocker.message.includes('is "complete"'))
  );
}

export function prepareSession(input: {
  db: Database.Database;
  workspace: string;
  repoRoot: string;
  dispatch: DispatchResolution;
  agent: LaunchAgent;
  model: string;
  effort: string | null;
  baseRevision: string;
  /** The worktree HEAD to verify immediately before launch; defaults to `baseRevision` when omitted (an ordinary fresh worktree, where the two are identical). */
  launchRevision?: string;
  /** Per-launch wall-clock limit override in ms, written in the same insert as the lease. */
  timeLimitMs?: number;
  branch: string;
  worktreePath: string;
  now: Date;
  tmux?: TmuxAdapter;
  host?: string;
  testHooks?: {
    /** Deterministic fault injection between the lease/handoff/competing-run checks and the insert, inside the same transaction. */
    afterChecksBeforeInsert?: () => void;
  };
}): AgentSession {
  const context = input.dispatch.context;
  if (!context || !isDispatchable(input.dispatch)) throw validationError("Session launch requires one dispatchable Action.");
  assertLocalBrowserAuditReady(input.agent, context.action);
  const project = getProjectBySlug(input.db, context.projectSlug);
  const workItem = getWorkItemByDocRef(input.db, `plan/${context.activePlan}#${context.action.id}`);
  if (!project || !workItem || workItem.project_id !== project.id) {
    throw validationError("The workspace is stale relative to the authoritative Action.", { remedy: `Run arcadia docs sync --project ${context.projectSlug} --apply.` });
  }
  const invocation = listCodexInvocationsForWorkItem(input.db, workItem.id)
    .filter((candidate) => candidate.purpose === "build" && candidate.status === "packet_created")
    .at(-1);
  if (!invocation) throw validationError("The Action has no prepared immutable build packet.", { actionId: context.action.id });
  const absolutePacket = path.join(input.workspace, invocation.prompt_path);
  if (!existsSync(absolutePacket)) throw validationError("The prepared build packet is missing.", { packetPath: invocation.prompt_path });
  const metadataPath = path.join(path.dirname(absolutePacket), "metadata.json");
  if (!existsSync(metadataPath)) throw validationError("The prepared build packet metadata is missing.", { metadataPath });
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.invocationId !== invocation.id || metadata.workItemId !== workItem.id || metadata.promptPath !== invocation.prompt_path) {
    throw validationError("The prepared build packet metadata is stale or belongs to another Action.");
  }
  const selected = metadata.providerSelection;
  const expectedProvider = input.agent === FIXTURE_AGENT ? FIXTURE_PROVIDER : SESSION_PROVIDER[input.agent];
  if (!selected || selected.provider !== expectedProvider) {
    throw validationError("The selected provider does not match the requested Session adapter.", {
      selectedProvider: selected?.provider ?? null,
      requestedProvider: expectedProvider
    });
  }
  // The packet binds the plan's tier model; a Session may instead start on the
  // registry's start-tier model for the same provider (smallest model first),
  // with the packet's model as its escalation target. Nothing else is accepted.
  const startModel = input.agent === FIXTURE_AGENT ? null : sessionStartBinding(input.agent, loadModelTierRegistry(input.workspace))?.model ?? null;
  if (selected.model !== input.model && startModel !== input.model) {
    throw validationError("The pinned model does not match the packet's selected provider binding.", { selectedModel: selected.model, requestedModel: input.model });
  }
  if (selected.mappingId !== invocation.provider_mapping_id || selected.bindingId !== invocation.provider_binding_id) {
    throw validationError("The packet's selected provider binding is stale.", {
      metadataMappingId: selected.mappingId ?? null,
      storedMappingId: invocation.provider_mapping_id,
      metadataBindingId: selected.bindingId ?? null,
      storedBindingId: invocation.provider_binding_id
    });
  }
  const packetHash = packetSha256(absolutePacket);
  const promotionDecision = findPromotionDecision(input.db, {
    projectId: project.id,
    invocationId: invocation.id,
    actionId: context.action.id,
    actionDocRef: `plan/${context.activePlan}#${context.action.id}`,
    repoRoot: path.resolve(input.repoRoot),
    packetPath: invocation.prompt_path,
    packetSha256: packetHash,
    providerProfile: invocation.agent_profile
  });
  const decisions = context.requiredDecisions
    .filter((decision) => decision.resolved)
    .map((decision) => decision.id)
    .concat(promotionDecision)
    .sort();
  const tmux = input.tmux ?? systemTmux;
  if (!tmux.available()) throw validationError("tmux is required for explicit Session launch but is not available.");

  // The lease/handoff/competing-run checks below and the agent_sessions insert
  // that follows must be atomic: two concurrent `prepareSession` calls for the
  // same repository could otherwise both observe no lease before either
  // inserts, both proceed, and both call `supersedeLeaseHandoff` on the same
  // receipt, violating the single-lease-per-repository invariant these checks
  // exist to enforce. `writeTransaction` takes the write lock at `BEGIN
  // IMMEDIATE`, so a second caller's check phase blocks until the first
  // caller's insert has committed and then correctly observes the lease.
  return writeTransaction(input.db, () => {
    const lease = getRepositoryLease(input.db, path.resolve(input.repoRoot));
    if (lease) throw validationError("The repository already has a prepared or running Session lease.", { sessionId: lease.id });
    const handoff = getResumableLeaseHandoff(input.db, path.resolve(input.repoRoot));
    // A different Action's candidate blocks only while its worktree still
    // exists. Once it is discarded exactly as this refusal's remedy says
    // (remove its worktree and branch) there is nothing left to resume or
    // protect -- the rule `arcadia go`'s `evaluateExistingCandidate` already
    // applies. Without it the automated tick refused every other Action in
    // the repository forever and burned its repair budget (Issue #697). The
    // discarded handoff is then superseded below, closing its record.
    if (handoff && handoff.session.action_id !== context.action.id && !candidateWorktreeIsGone(handoff.session.worktree_path)) {
      throw validationError("The repository holds an incomplete resumable candidate for a different Action; resolve or discard it before preparing a new one.", {
        sessionId: handoff.session.id, actionId: handoff.session.action_id, worktreePath: handoff.session.worktree_path
      });
    }
    const competingRun = getCompetingManagedRun(input.db, path.resolve(input.repoRoot));
    if (competingRun) {
      throw validationError("The repository already has a pending or running managed Run.", {
        runId: competingRun.id,
        status: competingRun.status
      });
    }
    input.testHooks?.afterChecksBeforeInsert?.();
    const stamp = input.now.toISOString().replaceAll(/[-:.]/g, "").replace(/Z$/, "Z").toLowerCase();
    const shortAction = context.action.id.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 42);
    const tmuxName = `${MANAGED_SESSION_TMUX_PREFIX}${context.projectSlug}-${shortAction}-${stamp}`.slice(0, 100);
    if (tmux.hasSession(tmuxName)) throw validationError("The tmux Session name already exists.", { tmuxSessionName: tmuxName });
    const id = createId("session");
    // Claude lets Arcadia supply a native session id. Codex creates its native
    // id internally and does not expose it to a detached interactive launch.
    // Keep the immutable Arcadia receipt as the correlation identity instead of
    // fabricating a Codex id that `codex resume` could not actually resume.
    const providerSessionId = input.agent === "claude" ? randomUUID() : id;
    const displayName = formatSessionTitle({ kind: "build", state: "working", plan: context.activePlan, action: context.action.id }).slice(0, 120);
    const timestamp = input.now.toISOString();
    const row = {
      id, project_id: project.id, project_slug: context.projectSlug, repository_path: canonicalPath(input.repoRoot),
      plan_path: context.planPath, plan_slug: context.activePlan, action_id: context.action.id, work_item_id: workItem.id,
      packet_id: invocation.id, packet_path: invocation.prompt_path, packet_sha256: packetHash,
      authorizing_decisions_json: JSON.stringify(decisions), execution_profile_json: invocation.execution_profile_json,
      provider_profile: invocation.agent_profile, provider: selected.provider, model: input.model, effort: input.effort,
      provider_mapping_id: invocation.provider_mapping_id, provider_binding_id: invocation.provider_binding_id,
      base_revision: input.baseRevision, launch_revision: input.launchRevision ?? input.baseRevision,
      branch: input.branch, worktree_path: canonicalPath(input.worktreePath),
      provider_session_id: providerSessionId, display_name: displayName, terminal_transport: "tmux", tmux_session_name: tmuxName,
      host: input.host ?? hostname(),
      status: "prepared", prepared_at: timestamp, started_at: null, ended_at: null, exit_status: null,
      created_at: timestamp, updated_at: timestamp,
      last_pane_signature: null, last_run_signature: null, last_activity_at: null, stall_flagged_at: null,
      admission_request_id: null, time_limit_ms: input.timeLimitMs ?? null, stop_reason: null,
      is_simulated: input.agent === FIXTURE_AGENT ? 1 : 0
    } satisfies AgentSession;
    input.db.prepare(`INSERT INTO agent_sessions (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((key) => `@${key}`).join(", ")})`).run(row);
    if (handoff) {
      supersedeLeaseHandoff(input.db, handoff.receipt.id, id);
    }
    return row;
  });
}

export function findPromotionDecision(
  db: Database.Database,
  expected: {
    projectId: string;
    invocationId: string;
    actionId: string;
    actionDocRef: string;
    repoRoot: string;
    packetPath: string;
    packetSha256: string;
    providerProfile: string;
  }
): string {
  const rows = db
    .prepare("SELECT id, status, context_json FROM review_items WHERE project_id = ? ORDER BY created_at DESC")
    .all(expected.projectId) as Array<{ id: string; status: string; context_json: string }>;
  for (const row of rows) {
    let context: any;
    try { context = JSON.parse(row.context_json); } catch { continue; }
    const promotion = context?.planningPromotion;
    if (promotion?.buildInvocationId !== expected.invocationId) continue;
    if (row.status !== "approved") {
      throw validationError("The build packet's authorizing Decision is no longer approved.", { decisionId: row.id, status: row.status });
    }
    const pairs: Record<string, [unknown, unknown]> = {
      actionId: [promotion.actionId, expected.actionId],
      actionDocRef: [promotion.actionDocRef, expected.actionDocRef],
      repoPath: [canonicalPath(promotion.repoPath ?? ""), canonicalPath(expected.repoRoot)],
      buildProfile: [promotion.buildProfile, expected.providerProfile],
      buildPacketPath: [promotion.buildPacketPath, expected.packetPath],
      buildPacketSha256: [promotion.buildPacketSha256, expected.packetSha256]
    };
    const stale = Object.entries(pairs).filter(([, [actual, wanted]]) => actual !== wanted);
    if (stale.length > 0) {
      throw validationError(`The promoted build packet or its authority set is stale: ${stale.map(([field]) => field).join(", ")}.`, {
        decisionId: row.id,
        mismatches: Object.fromEntries(stale)
      });
    }
    return row.id;
  }
  throw validationError("The build packet has no approved planning-promotion Decision.", { invocationId: expected.invocationId });
}

export function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  if (existsSync(resolved)) return realpathSync(resolved);
  const suffix: string[] = [];
  let existing = resolved;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return resolved;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...suffix);
}

export function launchPreparedSession(
  db: Database.Database,
  session: AgentSession,
  tmux: TmuxAdapter = systemTmux,
  /**
   * The workspace's model-tier registry, so a workspace override binding still
   * resolves to the right agent identity. Bundled defaults when omitted.
   */
  registry?: ModelTierRegistry,
  /**
   * The Arcadia workspace this Session's launch was requested from, so a
   * claude-code-cli launch can read the operator's documented token file.
   * Required for a headless launch (the default), which records the Session's
   * log and exit status under it; an interactive launch without it gets no
   * token file lookup and no injected `CLAUDE_CODE_OAUTH_TOKEN`.
   */
  workspace?: string,
  options: {
    /**
     * Launch the provider's interactive TUI instead of the default headless
     * run. Only an operator at the terminal opts in (`arcadia go --launch
     * --interactive`); it is never recorded to a log or exit status, because
     * piping a TUI's output would break it. The fixture provider ignores it.
     */
    interactive?: boolean;
  } = {}
): AgentSession {
  const headless = session.provider === FIXTURE_PROVIDER || !options.interactive;
  if (headless && !workspace) {
    failPreparedSession(db, session.id);
    throw validationError("A headless Session launch needs its workspace to record the Session's log and exit status.", {
      sessionId: session.id
    });
  }
  // `launch_revision` (falling back to `base_revision` for a row from before
  // that column existed) is the worktree HEAD this exact launch expects --
  // distinct from `base_revision` itself, which `reconcileSessionExit` and
  // candidate preservation read as the candidate's true lineage starting
  // point. A resumed stale claim (Issue #695) inherits its predecessor's
  // `base_revision` unchanged, since the worktree already carries that
  // predecessor's real commits; `launch_revision` is what this particular
  // Session's worktree actually looked like when it was prepared, checked
  // here to confirm nothing touched it since (CodeRabbit, PR #696). Reading
  // it from the persisted row rather than a caller-supplied argument means a
  // retry that finds this exact Session still sitting in `prepared` status --
  // this process died between `prepareSession` committing and this function
  // ever running the first time -- still gets the right expectation.
  const expected = session.launch_revision ?? session.base_revision;
  let observedRevision: string;
  try {
    observedRevision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: session.worktree_path,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch (error) {
    failPreparedSession(db, session.id);
    throw validationError("The prepared Session worktree revision cannot be verified before launch.", {
      sessionId: session.id,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (observedRevision !== expected) {
    failPreparedSession(db, session.id);
    throw validationError("The prepared Session base revision changed before launch.", {
      sessionId: session.id,
      expected,
      observed: observedRevision
    });
  }
  let launch: { command: string; args: string[] };
  try {
    launch = buildSessionLaunch(db, session, registry, workspace, headless);
  } catch (error) {
    // An unresolvable agent identity is a launch refusal, not a silent fall
    // back to the operator's Git identity: mark the prepared Session failed so
    // nothing runs under the wrong name and the refusal is visible.
    failPreparedSession(db, session.id);
    throw error;
  }
  try {
    tmux.launch({
      name: session.tmux_session_name,
      cwd: session.worktree_path,
      ...launch,
      ...(headless ? { record: sessionRecordingFor(workspace!, session.id) } : {})
    });
  } catch (error) {
    failPreparedSession(db, session.id);
    throw validationError(`tmux could not start the ${providerLabel(session.provider)} Session.`, {
      sessionId: session.id,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const started = new Date().toISOString();
  db.prepare("UPDATE agent_sessions SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?").run(started, started, session.id);
  return getSession(db, session.id)!;
}

export function failPreparedSession(db: Database.Database, id: string): void {
  const ended = new Date().toISOString();
  writeTransaction(db, () => {
    db.prepare("UPDATE agent_sessions SET status = 'failed', ended_at = ?, updated_at = ? WHERE id = ?").run(ended, ended, id);
    // A launch that fails after its admission committed (a worktree revision
    // check, an unresolvable agent identity, or a tmux spawn failure) never
    // reaches `reconcileSessionExit` -- this is the only writer that ever
    // marks it terminal, so it must release the same admission itself,
    // exactly as reconciliation does, or the slot leaks just like Issue #610.
    const session = getSession(db, id);
    if (session?.admission_request_id) {
      releaseAdmission(db, session.admission_request_id, new Date(ended));
    }
  });
}

export function getSession(db: Database.Database, id: string): AgentSession | null {
  if (!hasSessionTable(db)) return null;
  return (db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id) as AgentSession | undefined) ?? null;
}

export function getLatestSession(db: Database.Database): AgentSession | null {
  if (!hasSessionTable(db)) return null;
  return (db.prepare("SELECT * FROM agent_sessions ORDER BY prepared_at DESC, id DESC LIMIT 1").get() as AgentSession | undefined) ?? null;
}

export function getRepositoryLease(db: Database.Database, repositoryPath: string): AgentSession | null {
  if (!hasSessionTable(db)) return null;
  return (db.prepare("SELECT * FROM agent_sessions WHERE repository_path = ? AND status IN ('prepared', 'running') ORDER BY prepared_at DESC LIMIT 1").get(canonicalPath(repositoryPath)) as AgentSession | undefined) ?? null;
}

/**
 * Every repository lease across the whole portfolio, independent of any
 * recent-history limit. `getRepositoryLease` scopes to one repository for the
 * dispatch path; the portfolio observation surface needs every live or
 * prepared Session regardless of which project's transition happened to
 * surface it, including one whose owning project is not currently active.
 */
export function listActiveAgentSessions(db: Database.Database): AgentSession[] {
  if (!hasSessionTable(db)) return [];
  return db
    .prepare("SELECT * FROM agent_sessions WHERE status IN ('prepared', 'running') ORDER BY prepared_at DESC")
    .all() as AgentSession[];
}

export function getCompetingManagedRun(
  db: Database.Database,
  repositoryPath: string
): { id: string; status: "pending_execution" | "running" } | null {
  const target = canonicalPath(repositoryPath);
  const rows = db.prepare(`SELECT er.id, er.status, pm.repo_path
    FROM execution_runs er
    JOIN work_items wi ON wi.id = er.work_item_id
    JOIN project_metadata pm ON pm.project_id = wi.project_id
    WHERE er.status IN ('pending_execution', 'running') AND pm.repo_path IS NOT NULL`).all() as Array<{
      id: string;
      status: "pending_execution" | "running";
      repo_path: string;
    }>;
  return rows.find((run) => canonicalPath(run.repo_path) === target) ?? null;
}

export function reserveAgentWorktree(db: Database.Database, input: {
  repositoryPath: string;
  worktreePath: string;
  branch: string;
  now: Date;
  /** Claim this Action for this worktree. Both must be given, or neither. */
  project?: string;
  actionId?: string;
}): AgentWorktreeReservation {
  if ((input.project === undefined) !== (input.actionId === undefined)) {
    throw validationError("An Action claim needs both a Project and an Action id, or neither.", {
      project: input.project ?? null,
      actionId: input.actionId ?? null
    });
  }
  const createdAt = input.now.toISOString();
  const repositoryPath = canonicalPath(input.repositoryPath);
  const worktreePath = canonicalPath(input.worktreePath);
  purgeExpiredReservations(db, createdAt);
  // A resumed candidate (Decision 0051) reserves the same path a second time
  // to refresh its protection window; replace rather than collide with the
  // still-active row `prepareAgentWorktree`'s first reservation already left.
  db.prepare("DELETE FROM agent_worktree_reservations WHERE worktree_path = ?").run(worktreePath);
  if (input.project !== undefined && input.actionId !== undefined) {
    // The expiry-filtered conflict query, not the delete above, is what decides
    // this: a cleanup path that crashed mid-way could leave a stale row the
    // delete never reached, and treating that row as live would block
    // legitimate dispatch for the rest of its TTL.
    let held = getActiveActionClaim(db, repositoryPath, input.project, input.actionId, input.now);
    // A claim whose candidate already landed through a merged PR is released
    // rather than refused over (Issue #733).
    // So is a finished Session's claim whose work was done for a superseded
    // input of the Action: it can never integrate, and the amended Action
    // needs a fresh dispatch.
    if (held && held.worktree_path !== worktreePath && (releaseLandedActionClaim(db, held) || releaseSupersededActionClaim(db, held))) {
      held = getActiveActionClaim(db, repositoryPath, input.project, input.actionId, input.now);
    }
    if (held && held.worktree_path !== worktreePath) throw actionAlreadyClaimed(held, input.actionId, input.now);
    if (!held) {
      // Whatever claim row remains for this Action is one the query above no
      // longer honours -- its worktree is gone (Issue #625). Release it so the
      // unique Action index, which cannot see why, does not refuse this claim.
      db.prepare(`UPDATE agent_worktree_reservations
        SET project = NULL, action_id = NULL, claim_generation = NULL
        WHERE repository_path = ? AND project = ? AND action_id = ?`)
        .run(repositoryPath, input.project, input.actionId);
    }
  }
  const reservation = {
    id: createId("worktreeReservation"),
    repository_path: repositoryPath,
    worktree_path: worktreePath,
    branch: input.branch,
    created_at: createdAt,
    expires_at: new Date(input.now.getTime() + AGENT_WORKTREE_RESERVATION_MS).toISOString(),
    project: input.project ?? null,
    action_id: input.actionId ?? null,
    claim_generation: input.actionId === undefined ? null : createId("worktreeReservation")
  } satisfies AgentWorktreeReservation;
  try {
    db.prepare(`INSERT INTO agent_worktree_reservations (
      id, repository_path, worktree_path, branch, created_at, expires_at, project, action_id, claim_generation
    ) VALUES (@id, @repository_path, @worktree_path, @branch, @created_at, @expires_at, @project, @action_id, @claim_generation)`)
      .run(reservation);
  } catch (error) {
    // The unique index is the backstop behind the query above, for the race the
    // query cannot see: a second caller that read "clear" and inserted first.
    // Losing here is the same refusal as losing to a visible claim.
    if (input.actionId !== undefined && isActionClaimConflict(error)) {
      const winner = getActiveActionClaim(db, repositoryPath, input.project!, input.actionId, input.now);
      if (winner) throw actionAlreadyClaimed(winner, input.actionId, input.now);
    }
    throw error;
  }
  return reservation;
}

/**
 * The live claim on an Action, or null. Expiry is filtered here, in the query,
 * rather than trusted to the best-effort `DELETE ... WHERE expires_at <= ?`
 * that runs on each insert -- the same discipline `getActiveWorktreeReservation`
 * already applies to the worktree-path lookup.
 */
/**
 * Whether a candidate worktree has provably been removed. Only a missing path
 * counts: `existsSync` also reports false on a permission or I/O error, which
 * would let a still-present candidate -- possibly holding real work -- be
 * superseded as if it had been discarded.
 */
function candidateWorktreeIsGone(worktreePath: string): boolean {
  try {
    statSync(worktreePath);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return true;
    throw error;
  }
}

export function getActiveActionClaim(
  db: Database.Database,
  repositoryPath: string,
  project: string,
  actionId: string,
  now: Date = new Date()
): AgentWorktreeReservation | null {
  if (!hasWorktreeReservationTable(db)) return null;
  const live = (db.prepare(`SELECT * FROM agent_worktree_reservations
    WHERE repository_path = ? AND project = ? AND action_id = ? AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1`).get(
      canonicalPath(repositoryPath),
      project,
      actionId,
      now.toISOString()
    ) as AgentWorktreeReservation | undefined) ?? null;
  // A claim whose worktree no longer exists claims nothing (Issue #625): the
  // worktree was removed by a path that never released it (raw Git cleanup, a
  // non-`--launch` `go` failure), and honouring it would refuse dispatch of an
  // Action nobody holds for the rest of its window.
  if (live) return claimWorktreeIsGone(live) ? null : live;
  // Past its window, a claim is still held while its candidate is unmerged
  // (Issue #549). Only a claim nobody released qualifies: an explicit release
  // clears these columns, and retiring the worktree deletes the row.
  const expired = (db.prepare(`SELECT * FROM agent_worktree_reservations
    WHERE repository_path = ? AND project = ? AND action_id = ? AND expires_at <= ?
    ORDER BY created_at DESC LIMIT 1`).get(
      canonicalPath(repositoryPath),
      project,
      actionId,
      now.toISOString()
    ) as AgentWorktreeReservation | undefined) ?? null;
  return expired && expiredClaimStillHeld(expired) ? expired : null;
}

/**
 * Whether a claim's worktree has provably been removed while its repository
 * is still present. A repository that cannot be observed proves nothing, and
 * neither does a filesystem error, so both keep the claim: an indeterminate
 * answer must never read as "safe to dispatch again".
 */
function claimWorktreeIsGone(claim: Pick<AgentWorktreeReservation, "repository_path" | "worktree_path">): boolean {
  try {
    if (candidateWorktreeIsGone(claim.repository_path)) return false;
    return candidateWorktreeIsGone(claim.worktree_path);
  } catch {
    return false;
  }
}

/**
 * Whether a live claim's candidate is confirmed landed through a merged pull
 * request (Issue #733): GitHub reports a same-repository PR from the claim's
 * branch merged at exactly the branch's current tip, and the worktree holds no
 * uncommitted work. Anything short of that proof -- no GitHub remote, `gh`
 * unavailable, a tip that moved past the merged head, a dirty worktree, a Git
 * error -- keeps the claim.
 *
 * An offline ancestry check cannot answer this for a live claim: a worktree
 * prepared a minute ago with no commits yet is an ancestor of its base too, so
 * only the merged pull request distinguishes "done" from "not started".
 */
export function claimCandidateLanded(claim: Pick<AgentWorktreeReservation, "repository_path" | "worktree_path" | "branch">): boolean {
  const repo = claim.repository_path;
  const branch = claim.branch.replace(/^refs\/heads\//, "");
  try {
    if (candidateWorktreeIsGone(repo) || candidateWorktreeIsGone(claim.worktree_path)) return false;
  } catch {
    return false;
  }
  const tip = tryGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`])?.trim();
  if (!tip) return false;
  const merges = mergedPullRequests(repo);
  if (!merges?.some((merge) => merge.headBranch === branch && merge.headRefOid === tip)) return false;
  try {
    return uncommittedChanges(claim.worktree_path).length === 0;
  } catch {
    return false;
  }
}

/**
 * Release `claim` when its candidate is confirmed landed (see
 * {@link claimCandidateLanded}), fenced on its exact generation so a newer
 * claim is never torn down. Only dispatch refusal paths call this -- the
 * GitHub lookup runs only when a claim is about to refuse a dispatch, never on
 * the common path. Returns whether the claim was released.
 */
export function releaseLandedActionClaim(db: Database.Database, claim: AgentWorktreeReservation): boolean {
  if (!claim.project || !claim.action_id || !claim.claim_generation) return false;
  if (!claimCandidateLanded(claim)) return false;
  return releaseActionClaim(db, {
    repositoryPath: claim.repository_path,
    project: claim.project,
    actionId: claim.action_id,
    generation: claim.claim_generation
  });
}

/**
 * Release `claim` when it is held by a finished Session (neither prepared nor
 * running) whose worktree holds no uncommitted work and whose every passed
 * development attempt was for an earlier input revision of the Action than
 * the checked-in Plan now carries (see {@link developedForSupersededInput}).
 * Only the claim columns are cleared, fenced on the exact generation: the
 * worktree reservation row, the worktree, its branch and any pull request
 * stay exactly as they are. Anything short of that proof keeps the claim.
 */
export function releaseSupersededActionClaim(db: Database.Database, claim: AgentWorktreeReservation): boolean {
  if (!claim.project || !claim.action_id || !claim.claim_generation) return false;
  const holders = (db.prepare("SELECT * FROM agent_sessions WHERE project_slug = ? AND action_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(claim.project, claim.action_id) as AgentSession[])
    .filter((session) => canonicalPath(session.worktree_path) === claim.worktree_path);
  const holder = holders[0];
  if (!holder || holder.status === "prepared" || holder.status === "running") return false;
  try {
    if (candidateWorktreeIsGone(claim.repository_path)) return false;
    if (!candidateWorktreeIsGone(claim.worktree_path) && uncommittedChanges(claim.worktree_path).length > 0) return false;
    if (!sessionDevelopedForSupersededInput(db, holder, claim.repository_path)) return false;
  } catch {
    return false;
  }
  return releaseActionClaim(db, {
    repositoryPath: claim.repository_path,
    project: claim.project,
    actionId: claim.action_id,
    generation: claim.claim_generation
  });
}

/**
 * Whether a claim past its 24-hour window must still be honoured because its
 * candidate has not merged (Issue #549).
 *
 * Released -- returns false -- when the candidate branch no longer exists
 * (merged and retired by `go`/`tidy`, or deleted to abandon it), or when its
 * commits are already on the base branch (ancestry, or patch-equivalence for a
 * rebase or single-commit squash) and its worktree holds no uncommitted work.
 * A dirty worktree keeps the claim either way: a long-running candidate that
 * has not committed yet is not an abandoned one. A Git check that fails, as
 * opposed to one that proves the branch absent, keeps the claim too.
 *
 * Deliberately offline: dispatch must not depend on GitHub being reachable. A
 * multi-commit squash merge that no offline check can prove keeps the claim
 * until `go` or `tidy` retires the worktree, which only ever delays a
 * re-dispatch of an Action that is already done -- never duplicates one. When
 * the base branch cannot be determined at all the claim is kept, because an
 * indeterminate answer must never read as "safe to dispatch again".
 */
export function expiredClaimStillHeld(claim: Pick<AgentWorktreeReservation, "repository_path" | "worktree_path" | "branch">): boolean {
  const repo = claim.repository_path;
  const branch = claim.branch.replace(/^refs\/heads\//, "");
  // A repository that is gone has nothing left to dispatch into.
  try {
    if (candidateWorktreeIsGone(repo)) return false;
  } catch {
    return true;
  }
  const branchState = localBranchState(repo, branch);
  if (branchState === "absent") return false;
  if (branchState === "unknown") return true;
  let base: string;
  try {
    base = resolveBaseBranch(repo);
  } catch {
    return true;
  }
  const bases = [base, ...(refExists(repo, `refs/remotes/origin/${base}`) ? [`origin/${base}`] : [])];
  const onBase = bases.some((ref) => isPatchEquivalent(repo, ref, branch) || isAncestor(repo, branch, ref));
  if (!onBase) return true;
  // Everything committed is already on base: merged, or never committed. Only
  // uncommitted work in a still-present worktree keeps the claim then, since
  // releasing it would let a second dispatch start over work nobody saved.
  try {
    if (candidateWorktreeIsGone(claim.worktree_path)) return false;
    return uncommittedChanges(claim.worktree_path).length > 0;
  } catch {
    return true;
  }
}

/**
 * Whether a local branch exists, keeping a failed Git check distinct from a
 * confirmed-absent ref: `show-ref --verify --quiet` exits 1 only for a missing
 * ref, so any other outcome is "unknown" and must never release a claim.
 */
function localBranchState(repo: string, branch: string): "present" | "absent" | "unknown" {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo, stdio: "ignore" });
  if (result.status === 0) return "present";
  if (result.status === 1) return "absent";
  return "unknown";
}

/**
 * The expiry cleanup `reserveAgentWorktree` runs on each insert, minus any
 * expired claim whose candidate is still unmerged -- deleting that row would
 * release the claim by expiry alone, which is exactly Issue #549.
 */
function purgeExpiredReservations(db: Database.Database, nowIso: string): void {
  const expired = db.prepare("SELECT * FROM agent_worktree_reservations WHERE expires_at <= ?")
    .all(nowIso) as AgentWorktreeReservation[];
  const remove = db.prepare("DELETE FROM agent_worktree_reservations WHERE id = ?");
  for (const row of expired) {
    if (row.action_id !== null && expiredClaimStillHeld(row)) continue;
    remove.run(row.id);
  }
}

/**
 * Release a claim, conditioned atomically on the exact generation the caller
 * believes it holds.
 *
 * This clears the claim columns rather than deleting the row, because the row
 * carries *two* guarantees and only one of them is being given up: the
 * worktree-path reservation is what keeps `tidy` from retiring a clean handoff,
 * and a spawn failure leaves the worktree on disk. Dropping the row to release
 * the claim would hand `tidy` a worktree it could retire out from under an
 * operator. A caller that genuinely removed the worktree calls
 * `releaseWorktreeReservation` for that separately.
 *
 * Returns whether this call was the one that released it. Releasing an
 * already-released claim, or one whose generation has since moved on to a
 * different session, is a deliberate no-op rather than an error: a retried
 * settlement must be able to repeat its release safely, and a slow settlement
 * or a delayed cleanup must never release a newer, actively-owned claim out
 * from under whoever now holds it.
 */
export function releaseActionClaim(db: Database.Database, fence: ActionClaimFence): boolean {
  if (!hasWorktreeReservationTable(db)) return false;
  const result = db.prepare(`UPDATE agent_worktree_reservations
    SET project = NULL, action_id = NULL, claim_generation = NULL
    WHERE repository_path = ? AND project = ? AND action_id = ? AND claim_generation = ?`)
    .run(canonicalPath(fence.repositoryPath), fence.project, fence.actionId, fence.generation);
  return result.changes > 0;
}

/**
 * Refuse loudly unless `fence` names the claim that is live right now.
 *
 * Callers must run this inside the same transaction as the writes it guards --
 * a check performed before the transaction opens leaves exactly the window the
 * generation exists to close.
 */
export function assertActionClaimGeneration(db: Database.Database, fence: ActionClaimFence, now: Date = new Date()): void {
  const held = getActiveActionClaim(db, fence.repositoryPath, fence.project, fence.actionId, now);
  if (held?.claim_generation === fence.generation) return;
  throw validationError("This Action's claim is no longer the one this settlement started with, so it may not write.", {
    project: fence.project,
    actionId: fence.actionId,
    presentedGeneration: fence.generation,
    currentGeneration: held?.claim_generation ?? null,
    currentWorktreePath: held?.worktree_path ?? null,
    remedy: held
      ? "Another session reclaimed this Action. Do not overwrite its work: preserve this worktree's output and reconcile against the claim that now holds it."
      : "This claim expired or was already released. Re-dispatch this Action to obtain a fresh claim before settling it."
  });
}

function actionAlreadyClaimed(held: AgentWorktreeReservation, actionId: string, now: Date): Error {
  const unmerged = isHeldByUnmergedCandidate(held, now);
  return validationError(
    unmerged
      ? `This Action is already claimed by a live worktree: its claim outlived its 24-hour window because candidate branch ${held.branch} is still unmerged; Arcadia will not dispatch it a second time.`
      : "This Action is already claimed by a live worktree; Arcadia will not dispatch it a second time.",
    {
      actionId,
      project: held.project,
      claimedByWorktreePath: held.worktree_path,
      claimedByBranch: held.branch,
      claimExpiresAt: held.expires_at,
      unmergedCandidateBranch: unmerged ? held.branch : null,
      remedy: unmerged
        ? `Merge the candidate branch ${held.branch}, or abandon it (retire ${held.worktree_path} and delete the branch), or dispatch a different ready Action.`
        : `Finish or retire ${held.worktree_path}, or dispatch a different ready Action.`
    }
  );
}

/**
 * Whether a claim `getActiveActionClaim` returned is held only because its
 * candidate is unmerged -- it is past its window, so nothing else could have
 * kept it.
 */
export function isHeldByUnmergedCandidate(claim: Pick<AgentWorktreeReservation, "expires_at">, now: Date = new Date()): boolean {
  return claim.expires_at <= now.toISOString();
}

function isActionClaimConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("idx_agent_worktree_reservations_action")
    || (message.includes("UNIQUE constraint failed") && message.includes("action_id"));
}

export function getActiveWorktreeReservation(
  db: Database.Database,
  repositoryPath: string,
  worktreePath: string,
  now: Date = new Date()
): AgentWorktreeReservation | null {
  if (!hasWorktreeReservationTable(db)) return null;
  return (db.prepare(`SELECT * FROM agent_worktree_reservations
    WHERE repository_path = ? AND worktree_path = ? AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1`).get(
      canonicalPath(repositoryPath),
      canonicalPath(worktreePath),
      now.toISOString()
    ) as AgentWorktreeReservation | undefined) ?? null;
}

/**
 * Drop the handoff reservation for a worktree that has been retired.
 *
 * Reservations used to be insert-only, cleared solely by a 24-hour expiry that
 * measured how long ago `go` prepared a worktree rather than whether anyone was
 * still using it. A merged, finished handoff therefore kept reporting as
 * protected active work for the rest of the day -- which is how `go` came to
 * report already-merged branches while `tidy`, pointed at by that same nudge,
 * refused to retire a single one of them.
 */
export function releaseWorktreeReservation(
  db: Database.Database,
  repositoryPath: string,
  worktreePath: string
): void {
  if (!hasWorktreeReservationTable(db)) return;
  db.prepare("DELETE FROM agent_worktree_reservations WHERE repository_path = ? AND worktree_path = ?")
    .run(canonicalPath(repositoryPath), canonicalPath(worktreePath));
}

export function hasWorktreeReservationTable(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_worktree_reservations'").get());
}

function hasSessionTable(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'").get());
}

export const SESSION_PHONE_LIMITATION_NOTICE =
  "Reattach and resume run a terminal command against this host; a phone-only client cannot execute it. Use the existing Run evidence links, or open this Session from a machine with a terminal.";

export function sessionView(session: AgentSession, tmux: Pick<TmuxAdapter, "hasSession"> = systemTmux) {
  const live = tmux.hasSession(session.tmux_session_name);
  // A native resume command could be saved while tmux is live and used after
  // exit, bypassing Arcadia's fresh governed brief and launch checks. Reattach
  // is the only continuation command this read-only view advertises.
  return {
    ...session,
    observedStatus: live ? (session.stall_flagged_at ? "stalled" : "running") : session.status === "prepared" ? "prepared" : "exited",
    live,
    reattachCommand: `tmux attach-session -t ${session.tmux_session_name}`,
    // Preserve the public nullable-string field for existing view consumers.
    resumeCommand: null as string | null,
    resumeNotice: session.provider === "claude-code-cli"
      ? session.status === "prepared" && !live
        ? "This Session is prepared. Launch it through Arcadia to receive the governed Action brief and launch checks."
        : "Reattach the live tmux Session; after exit, launch a new governed Session so continuation receives a fresh Action brief and launch checks."
      : `Exact ${providerLabel(session.provider)} resume is unavailable after this terminal exits: ` +
        `${providerLabel(session.provider)} creates its native session id internally and does not expose it to detached launch. ` +
        "Reattach the live tmux Session; after exit, launch a new governed Session.",
    phoneLimitationNotice: SESSION_PHONE_LIMITATION_NOTICE
  };
}

/**
 * Variables a launched Session must never inherit from the tmux server or the
 * launcher's shell. The operator-script markers fence operator authority; the
 * inline-workspace mode belongs to the shell that turned it on, and the
 * launcher sets it for no Session (its commands resolve the user config
 * default, which the mode would refuse; src/workspace/resolve.ts).
 */
const SESSION_OPERATOR_CONTEXT_RESET = [
  "-u", "ARCADIA_OPERATOR_SCRIPT_ID", "-u", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR",
  "-u", "ARCADIA_REQUIRE_INLINE_WORKSPACE"
];

/**
 * The exact process tmux starts for one Session, with the resolved agent Git
 * identity in front of it. Running through `env` scopes GIT_AUTHOR_* and
 * GIT_COMMITTER_* to this execution and every commit it makes, so the agent
 * never has to choose an identity and the operator's global Git configuration
 * is never touched.
 */
function buildSessionLaunch(db: Database.Database, session: AgentSession, registry: ModelTierRegistry | undefined, workspace: string | undefined, headless: boolean): { command: string; args: string[] } {
  // The fixture provider is not a real coding agent: it never needs an Action
  // brief prompt, and the Git identity it commits under is fixed and always
  // visibly non-attributable to any real platform/tier -- resolving through
  // `resolveSessionAgentIdentity`'s tier registry would require inventing a
  // fake model-tier binding for a provider that has no model at all.
  if (session.provider === FIXTURE_PROVIDER) return buildFixtureSessionLaunch(session, workspace);
  const agent = sessionAgentForProvider(session.provider);
  if (!agent || agent === FIXTURE_AGENT) {
    throw validationError(`No agent Git identity can be resolved for provider "${session.provider}".`, {
      provider: session.provider
    });
  }
  const identity = resolveSessionAgentIdentity({
    agent,
    model: session.model,
    effort: session.effort,
    registry
  });
  const inner = buildProviderLaunch(db, session, agent, workspace, identity, headless, registry);
  // A newly admitted Session has its own governed authority. Its candidate
  // settlements must not inherit the operator action that dispatched it;
  // ordinary script helpers retain that context and remain fenced. Use env -u
  // at the child boundary even if a long-lived tmux server retained the vars.
  return { command: "env", args: [...SESSION_OPERATOR_CONTEXT_RESET, ...agentIdentityEnvironmentArgs(identity), inner.command, ...inner.args] };
}

function buildProviderLaunch(
  db: Database.Database,
  session: AgentSession,
  agent: SessionAgent,
  workspace: string | undefined,
  identity: AgentGitIdentity,
  headless: boolean,
  registry?: ModelTierRegistry
): { command: string; args: string[] } {
  const continuation = getSessionContinuation(db, session);
  const prompt = renderActionBrief({
    repoRoot: session.worktree_path,
    projectSlug: session.project_slug,
    planSlug: session.plan_slug,
    actionId: session.action_id,
    worktreePath: session.worktree_path,
    branch: session.branch,
    agent,
    baseRevision: session.base_revision,
    continuation: continuation ? { sessionId: continuation.session_id, candidateRevision: continuation.candidate_revision } : undefined,
    // The same identity the launch environment below commits under, so the
    // name the agent is told and the name on its commits cannot diverge.
    identity,
    model: session.model,
    registry,
    partners: readProjectPartners(db, {
      projectSlug: session.project_slug,
      excludeSessionId: session.id,
      excludeWorktree: session.worktree_path,
      registry
    })
  });
  if (session.provider === "codex-cli") {
    // A headless Session has no operator at its terminal. The interactive TUI
    // never exits after its turn, so nothing would see it end, reconcile it,
    // or admit the next Action. `codex exec` is Codex's non-interactive entry
    // point: it runs the brief and exits, streaming JSON events (`--json`). It
    // gets the same `workspace-write` sandbox an interactive trusted Session
    // runs in (exec would otherwise fall back to read-only on a never-trusted
    // fresh worktree) and never asks for approval, so an escalation is refused
    // back to the agent rather than waiting on nobody. Only an explicit
    // `arcadia go --launch --interactive` stays interactive.
    const args = headless ? ["exec", "--json", "--model", session.model] : ["--model", session.model];
    if (session.effort) args.push("--config", `model_reasoning_effort=${JSON.stringify(codexReasoningEffort(session.effort))}`);
    if (headless) args.push("--sandbox", "workspace-write");
    args.push("--cd", session.worktree_path, prompt);
    return { command: "codex", args };
  }

  if (session.provider === "opencode-cli") {
    // `opencode run` is the headless entry point: it executes the prompt
    // non-interactively in the prepared worktree (tmux already sets cwd) and
    // exits when the turn is done. Its permission posture is whatever the
    // operator's own opencode configuration says: Arcadia manages none for it
    // (Claude's is the per-Session allow list in `headlessPermissions.ts`,
    // Codex's the `workspace-write` sandbox), and `run` never waits on a prompt.
    const args = ["run", "--model", session.model];
    const variant = opencodeVariant(session.effort);
    if (variant) args.push("--variant", variant);
    args.push(prompt);
    return { command: "opencode", args };
  }

  // A headless Session has no operator at its terminal, and the interactive TUI
  // would stop at the workspace trust dialog, prompt for every edit, and never
  // exit after its turn (pmark/arcadia#727, #698). `--print` is Claude's
  // non-interactive entry point: it skips the trust dialog, runs the brief, and
  // exits, streaming JSON events (`--output-format stream-json`, which Claude
  // rejects in print mode without `--verbose`). `acceptEdits` lets it edit the
  // candidate without prompting; it is not a bypass, so any tool call outside
  // the allow list is refused back to the agent rather than waiting on nobody.
  // That allow list is Arcadia's own checked-in one (`headlessPermissions.ts`),
  // written per Session and passed with `--settings`. `--setting-sources ""`
  // stops Claude merging the operator's user settings and the worktree's own
  // (agent-editable) project settings into it, leaving only this file and managed
  // policy. `acceptEdits` also auto-approves mkdir/rm/mv/cp/sed in the working
  // directory, and the list is not a security boundary (validation commands run
  // code the agent can edit). Only an explicit `arcadia go --launch --interactive`
  // stays interactive.
  let args: string[];
  if (headless) {
    if (!workspace) {
      throw validationError("A headless Claude Session needs its workspace to write its permission settings.", { sessionId: session.id });
    }
    const metadata = getProjectMetadata(db, session.project_id);
    const settingsFile = writeHeadlessClaudeSettings({
      workspace,
      sessionId: session.id,
      validationCommands: decodeStringArray(metadata?.validation_commands)
    });
    args = [
      "--print", "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits", "--settings", settingsFile, "--setting-sources", "",
      "--model", session.model
    ];
  } else {
    args = ["--model", session.model];
  }
  if (session.effort) args.push("--effort", claudeReasoningEffort(session.effort));
  args.push("--session-id", session.provider_session_id, "--name", session.display_name, prompt);
  const inner = { command: "claude", args };
  if (session.provider !== "claude-code-cli" || !workspace) return inner;
  return withClaudeCodeToken(inner, workspace);
}

/** The four deterministic behaviors a fixture Session's launch can be configured to reach. */
const FIXTURE_OUTCOMES = ["completed", "failed", "stalled", "crashed"] as const;
export type FixtureOutcome = (typeof FIXTURE_OUTCOMES)[number];

function isFixtureOutcome(value: string): value is FixtureOutcome {
  return (FIXTURE_OUTCOMES as readonly string[]).includes(value);
}

/** The one file every "completed" fixture launch edits in its candidate. */
export const FIXTURE_EDIT_FILE = "ARCADIA_FIXTURE_SESSION_EDIT.txt";

const DEFAULT_FIXTURE_DURATION_SECONDS = 1;

/** The configured outcome a fixture Session's pinned `model` selects: `"fixture-<outcome>"`. */
export function fixtureModelFor(outcome: FixtureOutcome): string {
  return `fixture-${outcome}`;
}

/**
 * Resolved only relative to this compiled module, never the caller's working
 * directory: a launch command is built once and then handed to tmux, so its
 * argv must not depend on whichever directory the host process happened to be
 * running from at that moment. The build copies `scripts/fixture-coding-agent.mjs`
 * to `dist/scripts/` (see `package.json`'s `build` script) so this resolves
 * identically under `tsx` (`dist/src/sessions` doesn't exist yet; the module
 * lives at `src/sessions`) and under the compiled CLI (`dist/src/sessions`).
 */
function fixtureScriptPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fromModule = path.resolve(moduleDir, "..", "..", "scripts", "fixture-coding-agent.mjs");
  if (existsSync(fromModule)) return fromModule;
  throw new Error(`Could not find the bundled fixture-coding-agent.mjs script at ${fromModule}.`);
}

/**
 * The fixture provider's own launch command: a small deterministic Node
 * script (`scripts/fixture-coding-agent.mjs`) that sleeps for the configured
 * duration and then behaves exactly as the configured outcome declares. It
 * exercises the same tmux/admission path a real provider does, at zero token
 * cost, and is never wrapped in the Git-identity `env` prefix real providers
 * get -- see `buildSessionLaunch` -- because this process is not a real agent
 * and commits (when it commits at all) under its own fixed, visibly-fake
 * identity instead.
 *
 * `session.model` carries the configured outcome as `fixture-<outcome>`
 * (see `fixtureModelFor`) and `session.effort` carries the configured sleep
 * duration in seconds, defaulting to {@link DEFAULT_FIXTURE_DURATION_SECONDS}.
 * Reusing these two existing pinned columns keeps the fixture's configuration
 * flowing through the exact same build-packet/metadata plumbing a real
 * provider's model and effort do, instead of adding fixture-only schema.
 */
function buildFixtureSessionLaunch(session: AgentSession, workspace?: string): { command: string; args: string[] } {
  const outcome = session.model.startsWith("fixture-") ? session.model.slice("fixture-".length) : "";
  if (!isFixtureOutcome(outcome)) {
    throw validationError(`Unrecognized fixture outcome pinned to model "${session.model}".`, {
      model: session.model,
      validModels: FIXTURE_OUTCOMES.map(fixtureModelFor)
    });
  }
  const duration = session.effort ? Number(session.effort) : DEFAULT_FIXTURE_DURATION_SECONDS;
  if (!Number.isFinite(duration) || duration < 0) {
    throw validationError(`A fixture Session's duration must be a non-negative number of seconds; got "${session.effort}".`, {
      effort: session.effort
    });
  }
  const args = [
    fixtureScriptPath(),
    "--worktree", session.worktree_path,
    "--file", FIXTURE_EDIT_FILE,
    "--duration", String(duration),
    "--outcome", outcome,
    "--session-id", session.id
  ];
  if (outcome === "failed") {
    // Only "failed" needs to self-report: it deliberately leaves no git
    // changes (the one signal the generic evidence probe would otherwise
    // read), so it is the sole case that needs a narrow, explicitly gated
    // write of its own configured exit status. See
    // `scripts/fixture-coding-agent.mjs` and `applyFixtureExitStatus`.
    if (!workspace) {
      throw validationError('A fixture Session configured to fail needs its workspace to report its exit status.', { sessionId: session.id });
    }
    args.push("--db", getWorkspacePaths(workspace).databaseFile);
  }
  return { command: "env", args: [...SESSION_OPERATOR_CONTEXT_RESET, "node", ...args] };
}

/**
 * Applies a fixture Session's own configured exit status, gated so this
 * self-report can never touch anything but a Session already marked
 * `is_simulated` under the fixture provider -- the one exception to "an agent
 * never reports its own outcome" (see `classifyExitOutcome`), narrowly scoped
 * to the deterministic test double.
 *
 * Since headless launches, the recording wrapper (`wrapRecordedLaunch`) writes
 * the real provider exit code to `agent_sessions.exit_status` for EVERY
 * provider, the fixture included, so this self-report is redundant for a
 * launched fixture (both write the same value). It remains for callers that
 * apply a fixture outcome without running the process.
 */
export function applyFixtureExitStatus(db: Database.Database, sessionId: string, exitStatus: number): void {
  const now = new Date().toISOString();
  const result = db
    .prepare(`UPDATE agent_sessions SET exit_status = ?, updated_at = ? WHERE id = ? AND provider = ? AND is_simulated = 1`)
    .run(exitStatus, now, sessionId, FIXTURE_PROVIDER);
  if (result.changes !== 1) {
    throw validationError("Refused to apply a fixture exit status to a Session that is not a simulated fixture-cli Session.", { sessionId });
  }
}

/**
 * Injects the operator's `CLAUDE_CODE_OAUTH_TOKEN` into the claude-code-cli
 * Session process only -- never into `codex-cli` or `opencode-cli`, and never
 * as a literal value on this command's own argv, where it would sit in `ps`
 * output for as long as the process runs.
 *
 * The existing agent-identity vars above are passed as literal `KEY=value`
 * arguments to `env` (`agentIdentityEnvironmentArgs`), which is fine for a
 * non-secret Git identity but is exactly the pattern a secret must avoid.
 * Instead this wraps the launch in `sh -c`, where the shell reads the token
 * file itself at exec time (`CLAUDE_CODE_OAUTH_TOKEN="$(cat '<file>')" exec
 * ...`): only the token *file's path* ever appears in the command line: the
 * token value itself is read into the environment inside the shell, never
 * passed as an argument to any process.
 */
function withClaudeCodeToken(inner: { command: string; args: string[] }, workspace: string): { command: string; args: string[] } {
  const paths = getWorkspacePaths(workspace);
  const tokenFile = readClaudeCodeTokenFile(paths.claudeCodeTokenFile, paths.config);
  if (tokenFile.status === "absent") return inner;
  if (tokenFile.status === "refused") {
    throw validationError(
      `The Claude Code token file at ${paths.claudeCodeTokenFile} ${tokenFile.reason}. ${tokenFile.remedy}`,
      { provider: "claude-code-cli" }
    );
  }
  const script = `CLAUDE_CODE_OAUTH_TOKEN="$(cat ${shellQuote(paths.claudeCodeTokenFile)})" exec ${shellQuote(inner.command)} ${inner.args.map(shellQuote).join(" ")}`;
  return { command: "sh", args: ["-c", script] };
}

/** POSIX single-quote escaping: safe for any byte a shell word can contain. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
