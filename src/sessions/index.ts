import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { getProjectBySlug, getWorkItemByDocRef, listCodexInvocationsForWorkItem } from "../db/repositories.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import { packetSha256 } from "../execution/planningAuthorization.js";
import { createId } from "../utils/id.js";

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
  status: "prepared" | "running" | "completed" | "failed" | "needs_input";
  prepared_at: string;
  started_at: string | null;
  ended_at: string | null;
  exit_status: number | null;
  created_at: string;
  updated_at: string;
}

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
  agent: "claude";
  model: string;
  effort: string | null;
  baseRevision: string;
  branch: string;
  worktreePath: string;
  now: Date;
  tmux?: TmuxAdapter;
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
  if (!selected || selected.provider !== "claude-code-cli") {
    throw validationError("The selected provider does not match the requested Claude Code Session.", {
      selectedProvider: selected?.provider ?? null,
      requestedProvider: "claude-code-cli"
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
  const lease = getRepositoryLease(input.db, path.resolve(input.repoRoot));
  if (lease) throw validationError("The repository already has a prepared or running Session lease.", { sessionId: lease.id });
  const tmux = input.tmux ?? systemTmux;
  if (!tmux.available()) throw validationError("tmux is required for explicit Session launch but is not available.");
  const stamp = input.now.toISOString().replaceAll(/[-:.]/g, "").replace(/Z$/, "Z").toLowerCase();
  const shortAction = context.action.id.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 42);
  const tmuxName = `arcadia-${context.projectSlug}-${shortAction}-${stamp}`.slice(0, 100);
  if (tmux.hasSession(tmuxName)) throw validationError("The tmux Session name already exists.", { tmuxSessionName: tmuxName });
  const id = createId("session");
  const providerSessionId = randomUUID();
  const displayName = `${context.projectName}: ${context.action.title}`.slice(0, 120);
  const timestamp = input.now.toISOString();
  const row = {
    id, project_id: project.id, project_slug: context.projectSlug, repository_path: path.resolve(input.repoRoot),
    plan_path: context.planPath, plan_slug: context.activePlan, action_id: context.action.id, work_item_id: workItem.id,
    packet_id: invocation.id, packet_path: invocation.prompt_path, packet_sha256: packetHash,
    authorizing_decisions_json: JSON.stringify(decisions), execution_profile_json: invocation.execution_profile_json,
    provider_profile: invocation.agent_profile, provider: selected.provider, model: selected.model, effort: input.effort,
    provider_mapping_id: invocation.provider_mapping_id, provider_binding_id: invocation.provider_binding_id,
    base_revision: input.baseRevision, branch: input.branch, worktree_path: input.worktreePath,
    provider_session_id: providerSessionId, display_name: displayName, terminal_transport: "tmux", tmux_session_name: tmuxName,
    status: "prepared", prepared_at: timestamp, started_at: null, ended_at: null, exit_status: null,
    created_at: timestamp, updated_at: timestamp
  } satisfies AgentSession;
  input.db.prepare(`INSERT INTO agent_sessions (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((key) => `@${key}`).join(", ")})`).run(row);
  return row;
}

function findPromotionDecision(
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

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

export function launchPreparedSession(db: Database.Database, session: AgentSession, tmux: TmuxAdapter = systemTmux): AgentSession {
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
  const args = ["--model", session.model];
  if (session.effort) args.push("--effort", session.effort);
  args.push("--session-id", session.provider_session_id, "--name", session.display_name, `arcadia advance --session ${session.id}`);
  try {
    tmux.launch({ name: session.tmux_session_name, cwd: session.worktree_path, command: "claude", args });
  } catch (error) {
    failPreparedSession(db, session.id);
    throw validationError("tmux could not start the Claude Code Session.", { sessionId: session.id, cause: error instanceof Error ? error.message : String(error) });
  }
  const started = new Date().toISOString();
  db.prepare("UPDATE agent_sessions SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?").run(started, started, session.id);
  return getSession(db, session.id)!;
}

function failPreparedSession(db: Database.Database, id: string): void {
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
  return (db.prepare("SELECT * FROM agent_sessions WHERE repository_path = ? AND status IN ('prepared', 'running') ORDER BY prepared_at DESC LIMIT 1").get(path.resolve(repositoryPath)) as AgentSession | undefined) ?? null;
}

function hasSessionTable(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'").get());
}

export function sessionView(session: AgentSession, tmux: Pick<TmuxAdapter, "hasSession"> = systemTmux) {
  const live = tmux.hasSession(session.tmux_session_name);
  return {
    ...session,
    observedStatus: live ? "running" : session.status === "prepared" ? "prepared" : "exited",
    live,
    reattachCommand: `tmux attach-session -t ${session.tmux_session_name}`,
    resumeCommand: `cd ${JSON.stringify(session.worktree_path)} && claude --resume ${session.provider_session_id}`
  };
}
