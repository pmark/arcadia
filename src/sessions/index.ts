import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { providerLabel } from "../codingAgents/adapters.js";
import { agentIdentityEnvironmentArgs, resolveSessionAgentIdentity } from "../codingAgents/agentIdentity.js";
import type { ModelTierRegistry } from "../codingAgents/modelTiers.js";
import { writeTransaction } from "../db/connection.js";
import { getProjectBySlug, getWorkItemByDocRef, listCodexInvocationsForWorkItem } from "../db/repositories.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import { packetSha256 } from "../execution/planningAuthorization.js";
import { createId } from "../utils/id.js";
import { getResumableLeaseHandoff, supersedeLeaseHandoff } from "./reconciliation.js";
import { opencodeVariant } from "./worktreePreparation.js";

export type ProjectTransitionKind = "launch" | "plan" | "decision" | "repair" | "reconcile" | "wait" | "complete_milestone";

export interface ProjectTransition {
  kind: ProjectTransitionKind;
  reason: string;
  nextAction: string;
  sessionId: string | null;
  dispatch: DispatchResolution;
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
}

export type SessionAgent = "codex" | "claude" | "opencode";

const SESSION_PROVIDER: Record<SessionAgent, string> = {
  codex: "codex-cli",
  claude: "claude-code-cli",
  opencode: "opencode-cli"
};

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

/** The Session agent that launches `provider`, or null when no adapter exists. */
export function sessionAgentForProvider(provider: string): SessionAgent | null {
  return SESSION_AGENT[provider] ?? null;
}

export interface AgentWorktreeReservation {
  id: string;
  repository_path: string;
  worktree_path: string;
  branch: string;
  created_at: string;
  expires_at: string;
}

export const AGENT_WORKTREE_RESERVATION_MS = 24 * 60 * 60 * 1000;

export interface TmuxAdapter {
  available(): boolean;
  hasSession(name: string): boolean;
  launch(input: { name: string; cwd: string; command: string; args: string[] }): void;
}

export const systemTmux: TmuxAdapter = {
  available() {
    try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); return true; } catch { return false; }
  },
  hasSession(name) {
    try { execFileSync("tmux", ["has-session", "-t", `=${name}`], { stdio: "ignore" }); return true; } catch { return false; }
  },
  launch(input) {
    execFileSync("tmux", ["new-session", "-d", "-s", input.name, "-c", input.cwd, input.command, ...input.args], {
      stdio: "ignore"
    });
  }
};

export function resolveProjectTransition(input: {
  repoRoot: string;
  projectSlug: string;
  db?: Database.Database;
  tmux?: Pick<TmuxAdapter, "hasSession">;
}): ProjectTransition {
  const dispatch = resolveDispatch(input.repoRoot, input.projectSlug);
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
    return { kind: "launch", reason: "The selected Action is dispatchable.", nextAction: dispatch.context!.action.nextAction!, sessionId: null, dispatch };
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

export function prepareSession(input: {
  db: Database.Database;
  workspace: string;
  repoRoot: string;
  dispatch: DispatchResolution;
  agent: SessionAgent;
  model: string;
  effort: string | null;
  baseRevision: string;
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
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as any;
  if (metadata.invocationId !== invocation.id || metadata.workItemId !== workItem.id || metadata.promptPath !== invocation.prompt_path) {
    throw validationError("The prepared build packet metadata is stale or belongs to another Action.");
  }
  const selected = metadata.providerSelection;
  const expectedProvider = SESSION_PROVIDER[input.agent];
  if (!selected || selected.provider !== expectedProvider) {
    throw validationError("The selected provider does not match the requested Session adapter.", {
      selectedProvider: selected?.provider ?? null,
      requestedProvider: expectedProvider
    });
  }
  if (selected.model !== input.model) {
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
    if (handoff && handoff.session.action_id !== context.action.id) {
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
    const tmuxName = `arcadia-${context.projectSlug}-${shortAction}-${stamp}`.slice(0, 100);
    if (tmux.hasSession(tmuxName)) throw validationError("The tmux Session name already exists.", { tmuxSessionName: tmuxName });
    const id = createId("session");
    // Claude lets Arcadia supply a native session id. Codex creates its native
    // id internally and does not expose it to a detached interactive launch.
    // Keep the immutable Arcadia receipt as the correlation identity instead of
    // fabricating a Codex id that `codex resume` could not actually resume.
    const providerSessionId = input.agent === "claude" ? randomUUID() : id;
    const displayName = `${context.projectName}: ${context.action.title}`.slice(0, 120);
    const timestamp = input.now.toISOString();
    const row = {
      id, project_id: project.id, project_slug: context.projectSlug, repository_path: canonicalPath(input.repoRoot),
      plan_path: context.planPath, plan_slug: context.activePlan, action_id: context.action.id, work_item_id: workItem.id,
      packet_id: invocation.id, packet_path: invocation.prompt_path, packet_sha256: packetHash,
      authorizing_decisions_json: JSON.stringify(decisions), execution_profile_json: invocation.execution_profile_json,
      provider_profile: invocation.agent_profile, provider: selected.provider, model: selected.model, effort: input.effort,
      provider_mapping_id: invocation.provider_mapping_id, provider_binding_id: invocation.provider_binding_id,
      base_revision: input.baseRevision, branch: input.branch, worktree_path: canonicalPath(input.worktreePath),
      provider_session_id: providerSessionId, display_name: displayName, terminal_transport: "tmux", tmux_session_name: tmuxName,
      host: input.host ?? hostname(),
      status: "prepared", prepared_at: timestamp, started_at: null, ended_at: null, exit_status: null,
      created_at: timestamp, updated_at: timestamp
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
  registry?: ModelTierRegistry
): AgentSession {
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
  if (observedRevision !== session.base_revision) {
    failPreparedSession(db, session.id);
    throw validationError("The prepared Session base revision changed before launch.", {
      sessionId: session.id,
      expected: session.base_revision,
      observed: observedRevision
    });
  }
  let launch: { command: string; args: string[] };
  try {
    launch = buildSessionLaunch(session, registry);
  } catch (error) {
    // An unresolvable agent identity is a launch refusal, not a silent fall
    // back to the operator's Git identity: mark the prepared Session failed so
    // nothing runs under the wrong name and the refusal is visible.
    failPreparedSession(db, session.id);
    throw error;
  }
  try {
    tmux.launch({ name: session.tmux_session_name, cwd: session.worktree_path, ...launch });
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
  db.prepare("UPDATE agent_sessions SET status = 'failed', ended_at = ?, updated_at = ? WHERE id = ?").run(ended, ended, id);
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
}): AgentWorktreeReservation {
  const createdAt = input.now.toISOString();
  db.prepare("DELETE FROM agent_worktree_reservations WHERE expires_at <= ?").run(createdAt);
  // A resumed candidate (Decision 0051) reserves the same path a second time
  // to refresh its protection window; replace rather than collide with the
  // still-active row `prepareAgentWorktree`'s first reservation already left.
  db.prepare("DELETE FROM agent_worktree_reservations WHERE worktree_path = ?").run(canonicalPath(input.worktreePath));
  const reservation = {
    id: createId("worktreeReservation"),
    repository_path: canonicalPath(input.repositoryPath),
    worktree_path: canonicalPath(input.worktreePath),
    branch: input.branch,
    created_at: createdAt,
    expires_at: new Date(input.now.getTime() + AGENT_WORKTREE_RESERVATION_MS).toISOString()
  } satisfies AgentWorktreeReservation;
  db.prepare(`INSERT INTO agent_worktree_reservations (
    id, repository_path, worktree_path, branch, created_at, expires_at
  ) VALUES (@id, @repository_path, @worktree_path, @branch, @created_at, @expires_at)`).run(reservation);
  return reservation;
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
  // Claude is the only adapter Arcadia can hand a native session id to, so it
  // is the only one with an exact `--resume`. Codex and opencode create their
  // native ids internally and do not expose them to a detached launch.
  const resumable = session.provider === "claude-code-cli";
  return {
    ...session,
    observedStatus: live ? "running" : session.status === "prepared" ? "prepared" : "exited",
    live,
    reattachCommand: `tmux attach-session -t ${session.tmux_session_name}`,
    resumeCommand: resumable ? `cd ${JSON.stringify(session.worktree_path)} && claude --resume ${session.provider_session_id}` : null,
    resumeNotice: resumable
      ? null
      : `Exact ${providerLabel(session.provider)} resume is unavailable after this terminal exits: ` +
        `${providerLabel(session.provider)} creates its native session id internally and does not expose it to detached launch. ` +
        "Reattach the live tmux Session; after exit, launch a new governed Session.",
    phoneLimitationNotice: SESSION_PHONE_LIMITATION_NOTICE
  };
}

/**
 * The exact process tmux starts for one Session, with the resolved agent Git
 * identity in front of it. Running through `env` scopes GIT_AUTHOR_* and
 * GIT_COMMITTER_* to this execution and every commit it makes, so the agent
 * never has to choose an identity and the operator's global Git configuration
 * is never touched.
 */
function buildSessionLaunch(session: AgentSession, registry?: ModelTierRegistry): { command: string; args: string[] } {
  const agent = sessionAgentForProvider(session.provider);
  if (!agent) {
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
  const inner = buildProviderLaunch(session);
  return { command: "env", args: [...agentIdentityEnvironmentArgs(identity), inner.command, ...inner.args] };
}

function buildProviderLaunch(session: AgentSession): { command: string; args: string[] } {
  const prompt = `arcadia advance --session ${session.id}`;
  if (session.provider === "codex-cli") {
    const args = ["--model", session.model];
    if (session.effort) args.push("--config", `model_reasoning_effort=${JSON.stringify(session.effort)}`);
    args.push("--cd", session.worktree_path, prompt);
    return { command: "codex", args };
  }

  if (session.provider === "opencode-cli") {
    // `opencode run` is the headless entry point: it executes the prompt
    // non-interactively in the prepared worktree (tmux already sets cwd) and
    // exits when the turn is done. Permission posture comes from the ambient
    // opencode configuration, exactly as Codex's and Claude's do there.
    const args = ["run", "--model", session.model];
    const variant = opencodeVariant(session.effort);
    if (variant) args.push("--variant", variant);
    args.push(prompt);
    return { command: "opencode", args };
  }

  const args = ["--model", session.model];
  if (session.effort) args.push("--effort", session.effort);
  args.push("--session-id", session.provider_session_id, "--name", session.display_name, prompt);
  return { command: "claude", args };
}
