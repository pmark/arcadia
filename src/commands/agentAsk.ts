import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ACTION_ID_MAX_LENGTH, ACTION_ID_PATTERN, AGENT_ASK_AUTHORITIES, AGENT_ASK_INTENTS, normalizeAgentAsk, STRICT_ACTION_FIELDS, STRICT_FIELDS, STRICT_OPTION_FIELDS, type AgentAskProposal } from "../ask/agentAsk.js";
import { discoverUnprocessedAgentAsks, EMPTY_AGENT_ASK_DISCOVERY, type AgentAskDiscoveryResult } from "../ask/discovery.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { WORK_CLASSIFICATIONS } from "../domain/constants.js";
import { findRecoveredAsk } from "../sessions/legacyAskRecovery.js";
import { normalizeError, validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { tryGit } from "../git/worktrees.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import {
  listPendingAgentAskNotifications,
  listUnsettledAgentAskProposals,
  markAgentAskNotificationSent,
  settleAgentAsk,
  type AgentAskDisposition,
  type AgentAskPlacement,
  type AgentAskResponsibility,
  type AgentAskSettlementReceipt,
  type AgentAskSettlementTestHooks,
  type PendingAgentAskNotification
} from "../ask/settlement.js";

/**
 * The caller's repository: the Git toplevel enclosing `dir`, or `dir` itself
 * outside Git (a bare container with no checkout yet).
 *
 * `--dir` defaults to the directory the operator stood in, which may be a
 * subdirectory; without this a draft run there placed `.arcadia/asks/` under
 * the subdirectory, where neither discovery nor settlement looks. The caller's
 * own spelling is kept (Git reports a realpath) so a returned path still reads
 * the way the caller wrote it.
 */
function callerRepositoryRoot(dir: string): string {
  const requested = path.resolve(dir);
  const toplevel = existsSync(requested) ? tryGit(requested, ["rev-parse", "--show-toplevel"]) : null;
  if (!toplevel) return requested;
  const realToplevel = realpathSync(toplevel);
  // Walk up the caller's spelling rather than joining `..` onto it: `..` is
  // lexical, so after a symlinked segment it would name the wrong directory.
  for (let candidate = requested; ; candidate = path.dirname(candidate)) {
    if (realpathSync(candidate) === realToplevel) return candidate;
    if (path.dirname(candidate) === candidate) return realToplevel;
  }
}

/**
 * Read an Agent Ask `--file` from inside the caller's repository, and only
 * there.
 *
 * The launcher changes directory into Arcadia's own checkout before running,
 * so a relative `--file` resolved against `process.cwd()` named a file in the
 * main checkout, never the candidate worktree the agent was standing in
 * (issue #886). The CLI now resolves it from the invocation directory; this is
 * the boundary behind that: a missing file, or one whose realpath -- after
 * following any symlink -- lies outside the caller's repository, is refused
 * before anything is read, and nothing ever falls back to the runtime checkout.
 * Both sides are compared as realpaths because temp and home paths on macOS
 * differ lexically from what they resolve to (`/var` vs `/private/var`).
 */
function readAskFile(file: string, baseDir: string | undefined, repoRoot: string): { path: string; content: string } {
  if (!file.trim()) throw validationError("--file needs a path to an Agent Ask file inside the caller's repository.");
  const requested = path.resolve(baseDir ?? invocationRoot(), file.trim());
  const details = { file: requested, repository: repoRoot };
  let real: string;
  try {
    real = realpathSync(requested);
  } catch {
    throw validationError(`Invalid --file path: ${requested} does not exist.`, details);
  }
  let realRoot: string | null = null;
  try { realRoot = realpathSync(repoRoot); } catch { /* a missing repository contains nothing */ }
  const relative = realRoot ? path.relative(realRoot, real) : "..";
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw validationError(`Invalid --file path: ${requested} resolves outside the caller's repository ${repoRoot}.`, {
      ...details,
      resolved: real,
      remedy: "Place the Agent Ask file inside the repository or worktree you are running from, or pass --dir naming the repository that contains it."
    });
  }
  if (!statSync(real).isFile()) throw validationError(`Invalid --file path: ${requested} is not a file.`, details);
  return { path: requested, content: readFileSync(real, "utf8") };
}

export interface AgentAskPreviewOptions { workspace: string; request?: string; file?: string; requestId?: string; project?: string; dir?: string; }
export interface AgentAskPreviewData { proposal: AgentAskProposal; preview: string[]; projectWritesPerformed: 0; replayed: boolean; discovery: AgentAskDiscoveryResult; }

export function runAgentAskPreviewCommand(options: AgentAskPreviewOptions): CommandSuccess<AgentAskPreviewData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (options.request && options.file) throw validationError("Pass either an Agent Ask argument or --file, not both.");
  // Neither an inline Ask nor --file: before falling through to natural-text
  // validation (which would reject an empty string), check whether this
  // request id already has content preserved on an isolated recovery branch
  // — the isolate-agent-asks-from-production-handoff recovery flow moves a
  // drifted draft there instead of leaving it as a live file `--file` could
  // point at. This lets `preview --request-id <id>` resolve a recovered Ask
  // directly, with no manual `git show` step in between.
  const recovered = !options.request && !options.file && options.requestId
    ? findRecoveredAsk(path.resolve(options.dir ?? process.cwd()), options.requestId)
    : null;
  const repoDir = options.dir ? callerRepositoryRoot(options.dir) : null;
  const askFile = options.file !== undefined ? readAskFile(options.file, options.dir, repoDir ?? callerRepositoryRoot(invocationRoot())) : null;
  const request = askFile ? askFile.content : recovered ? recovered.content : options.request ?? "";
  const result = withDatabase(workspacePath, (db) => previewAgentAskRequest(db, {
    request, requestId: options.requestId, project: options.project, sourcePath: askFile?.path ?? null,
    repoRoot: repoDir
  }));
  // Discovery runs only after the request this call was actually asked
  // about has already been recorded above — so a file that is itself under
  // `.arcadia/asks/` is judged "replayed" by discovery, not double-counted
  // as newly "discovered". `options.dir` is only unset when a caller
  // resolves a workspace without saying which repository it lives in (e.g.
  // a unit test exercising proposal logic directly); the CLI itself always
  // supplies it, defaulted to `process.cwd()`, so real invocations always
  // run discovery with no extra flag required.
  const discovery = repoDir
    ? withDatabase(workspacePath, (db) => discoverUnprocessedAgentAsks(db, repoDir))
    : EMPTY_AGENT_ASK_DISCOVERY;
  const preview = [...renderAgentAskPreview(result.proposal), ...renderAgentAskDiscovery(discovery)];
  return createSuccess({ command: "agent-ask.preview", workspace: workspacePath, data: { proposal: result.proposal, preview, projectWritesPerformed: 0, replayed: result.replayed, discovery } });
}
export function renderAgentAskPreviewSuccess(response: CommandSuccess<AgentAskPreviewData>): string[] { return ["Agent Ask v1 preview", ...response.data.preview]; }
function renderAgentAskDiscovery(discovery: AgentAskDiscoveryResult): string[] {
  const lines: string[] = [];
  if (discovery.discovered.length > 0) {
    lines.push(`Auto-discovered ${discovery.discovered.length} unprocessed .arcadia/asks/ file(s):`);
    lines.push(...discovery.discovered.map((finding) => `  ${finding.path} -> request ${finding.requestId}`));
  }
  if (discovery.failed.length > 0) {
    lines.push(`Failed to auto-discover ${discovery.failed.length} .arcadia/asks/ file(s):`);
    lines.push(...discovery.failed.map((failure) => `  ${failure.path}: ${failure.error}`));
  }
  return lines;
}
function renderAgentAskPreview(proposal: AgentAskProposal): string[] {
  return [
    `Request: ${proposal.normalized.requestId}${proposal.normalized.format === "natural" ? " (natural fallback)" : ""}`,
    `Project: ${proposal.normalized.project}`,
    `Intent: ${proposal.normalized.intent}`,
    ...proposal.effects.map((effect, index) => `Proposed effect ${index + 1}: ${effect.operation} ${effect.targetKind}${effect.targetRef ? ` ${effect.targetRef}` : ""}`),
    `Decisions required: ${proposal.requiredDecisions.length}`,
    "Queue: no entry until accepted",
    "Project writes: 0",
    "Workspace receipt: capture and proposal recorded"
  ];
}

export interface AgentAskDraftOptions { request?: string; file?: string; requestId?: string; project?: string; workspace?: string; dir?: string; }
export interface AgentAskDraftData {
  path: string;
  requestId: string;
  intent: string;
  format: "strict" | "natural";
  written: "created" | "unchanged";
  preview: { proposal: AgentAskProposal; fingerprint: string } | null;
  workspaceStatus: "previewed" | "not_available" | "preview_blocked";
  previewFailure: { code: string; message: string; cause?: string } | null;
  discovery: AgentAskDiscoveryResult;
}

/**
 * Validate an Agent Ask and place it at its canonical `.arcadia/asks/` path in
 * one call, with zero Project-database dependency for the validation itself —
 * `normalizeAgentAsk` is a pure function, so this succeeds in an environment
 * with no Arcadia workspace bootstrapped at all (a bare cloud container that
 * only has the `arcadia` binary and git). When a workspace *is* ready, it also
 * runs the same preview a separate `agent-ask preview` call would, collapsing
 * "write the file, then preview it" into one round trip for the common case.
 */
export function runAgentAskDraftCommand(options: AgentAskDraftOptions): CommandSuccess<AgentAskDraftData> {
  if (options.request && options.file) throw validationError("Pass either an Agent Ask argument or --file, not both.");
  const repoDir = callerRepositoryRoot(options.dir ?? invocationRoot());
  const request = options.file !== undefined ? readAskFile(options.file, options.dir, repoDir).content : options.request ?? "";
  const normalized = normalizeAgentAsk({ request, requestId: options.requestId, project: options.project });
  const content = request.trim().endsWith("\n") ? request.trim() + "\n" : `${request.trim()}\n`;
  if (normalized.intent === "complete") assertCompletionApplicableAtHead(repoDir, normalized.candidateRevision);
  const askDir = path.join(repoDir, ".arcadia", "asks");
  const filePath = path.join(askDir, `agent-ask-${normalized.requestId}.yaml`);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
  let written: "created" | "unchanged";
  if (existing !== null) {
    if (existing.trim() !== content.trim()) {
      throw validationError("An Agent Ask file already exists for this request id with different content.", { path: filePath, requestId: normalized.requestId });
    }
    written = "unchanged";
  } else {
    mkdirSync(askDir, { recursive: true });
    writeFileSync(filePath, content, "utf8");
    written = "created";
  }
  let preview: { proposal: AgentAskProposal; fingerprint: string } | null = null;
  let workspaceStatus: AgentAskDraftData["workspaceStatus"];
  let previewFailure: AgentAskDraftData["previewFailure"] = null;
  let discovery: AgentAskDiscoveryResult = EMPTY_AGENT_ASK_DISCOVERY;
  try {
    // Re-read the file draft just wrote (rather than passing `content`
    // directly) so preview records `sourcePath`, letting a later terminal
    // `settle --apply` archive this exact file automatically. Passing `dir`
    // through (rather than letting preview default it separately) makes
    // discovery scan the same `.arcadia/asks/` directory this draft was
    // just placed into, not whatever `process.cwd()` happens to be.
    const previewResult = runAgentAskPreviewCommand({ workspace: options.workspace ?? "", file: filePath, requestId: options.requestId, project: options.project, dir: repoDir });
    preview = { proposal: previewResult.data.proposal, fingerprint: previewResult.data.proposal.fingerprint };
    discovery = previewResult.data.discovery;
    workspaceStatus = "previewed";
  } catch (error) {
    // The file remains a valid handoff when preview cannot run. Distinguish
    // an absent workspace from one that resolved but could not record its
    // proposal receipt; calling both "not available" sends agents looking
    // for a different workspace and wastes retries inside the same sandbox.
    const failure = normalizeError(error);
    if (["WORKSPACE_NOT_FOUND", "DATABASE_NOT_INITIALIZED", "USAGE_ERROR"].includes(failure.code)) {
      workspaceStatus = "not_available";
    } else if (["SQLITE_WORKSPACE_WRITE_DENIED", "SQLITE_NATIVE_ABI_MISMATCH", "SQLITE_ERROR"].includes(failure.code)) {
      workspaceStatus = "preview_blocked";
    } else {
      throw error;
    }
    previewFailure = {
      code: failure.code,
      message: failure.message,
      ...(typeof failure.details.cause === "string" ? { cause: failure.details.cause } : {})
    };
  }
  return createSuccess({
    command: "agent-ask.draft",
    data: { path: filePath, requestId: normalized.requestId, intent: normalized.intent, format: normalized.format, written, preview, workspaceStatus, previewFailure, discovery }
  });
}

/**
 * Refuse to place a `complete` Ask that `settle --apply` could never apply.
 * Settlement binds the evidence to the checkout's HEAD, accepting only an exact
 * or abbreviated match, so a draft naming any other revision is broken on
 * arrival — and the operator used to find that out only at the apply step,
 * after the pull request was open (Issue #304). The common trap is committing
 * the drafted file: that moves HEAD past the revision it records, and no
 * amendment can catch up, because committing the amended file moves HEAD
 * again. Outside a Git checkout there is nothing to bind yet, so nothing is
 * refused; settlement still checks when it runs.
 */
function assertCompletionApplicableAtHead(repoDir: string, candidateRevision: string | null): void {
  const head = tryGit(repoDir, ["rev-parse", "HEAD"]);
  if (!head || !candidateRevision) return;
  if (head === candidateRevision || head.startsWith(candidateRevision)) return;
  throw validationError(
    `This complete Ask records candidate_revision ${candidateRevision}, but ${repoDir} is at HEAD ${head}; settlement could never apply it.`,
    {
      candidateRevision,
      head,
      remedy: "Set candidate_revision to `git rev-parse HEAD` after your final code commit, and leave the drafted Ask file uncommitted: settlement commits and archives it itself."
    }
  );
}

export function renderAgentAskDraftSuccess(response: CommandSuccess<AgentAskDraftData>): string[] {
  const d = response.data;
  const lines = [
    `Agent Ask ${d.written === "created" ? "drafted" : "already drafted (unchanged)"}: ${d.path}`,
    `Request: ${d.requestId}`,
    `Intent: ${d.intent}${d.format === "natural" ? " (natural fallback)" : ""}`
  ];
  if (d.preview) {
    lines.push(`Previewed: fingerprint ${d.preview.fingerprint}`, `Decisions required: ${d.preview.proposal.requiredDecisions.length}`, "Next: arcadia agent-ask settle --proposal " + d.requestId + " ...");
  } else if (d.workspaceStatus === "preview_blocked") {
    lines.push(`Previewed: blocked (${d.previewFailure?.code ?? "unknown error"}) — ${d.previewFailure?.message ?? "workspace preview failed"}${d.previewFailure?.cause ? ` Cause: ${d.previewFailure.cause}` : ""}`);
    lines.push("Next: preserve the validated Ask file for a host with workspace access. Do not guess a workspace from the Project name or retry this database write from the same sandbox.");
  } else {
    lines.push("Previewed: not yet — no ready Arcadia workspace resolved here.", `Next: preserve the Ask file; a host with the correct writable workspace can run \`arcadia agent-ask preview --file ${d.path} --dir ${path.dirname(path.dirname(path.dirname(d.path)))}\`.`);
  }
  lines.push(...renderAgentAskDiscovery(d.discovery));
  return lines;
}

export interface AgentAskSettleData { receipt: AgentAskSettlementReceipt; }

export function runAgentAskSettleCommand(options: {
  workspace: string;
  proposal: string;
  requestId: string;
  disposition: AgentAskDisposition;
  responsibility?: AgentAskResponsibility;
  top?: boolean;
  before?: string;
  after?: string;
  revision?: number;
  preview?: string;
  apply?: boolean;
  activate?: boolean;
  action?: string;
  model?: string;
  effort?: string;
  operator?: boolean;
  cwd?: string;
  projectionBusyTimeoutMs?: number;
  hooks?: AgentAskSettlementTestHooks;
  beforeGovernanceWrite?: (db: Database.Database) => void;
}): CommandSuccess<AgentAskSettleData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (options.disposition !== "accepted" && options.disposition !== "rejected") {
    throw validationError("Agent Ask disposition must be accepted or rejected.");
  }
  if (options.responsibility && !WORK_CLASSIFICATIONS.includes(options.responsibility)) {
    throw validationError(`Agent Ask Action Responsibility must be one of: ${WORK_CLASSIFICATIONS.join(", ")}.`);
  }
  const placements = [options.top ? "top" : null, options.before ? "before" : null, options.after ? "after" : null].filter(Boolean);
  if (placements.length > 1) throw validationError("Choose at most one queue placement: --top, --before, or --after.");
  if (options.disposition === "rejected" && placements.length > 0) {
    throw validationError("Rejected Agent Ask settlement cannot declare a queue position.");
  }
  const receipt = withDatabase(workspacePath, (db) => settleAgentAsk(db, {
    proposalRef: options.proposal,
    settlementRequestId: options.requestId,
    disposition: options.disposition,
    responsibility: options.responsibility,
    placement: placements[0] as AgentAskPlacement | undefined,
    anchor: options.before ?? options.after,
    expectedQueueRevision: options.revision,
    previewFingerprint: options.preview,
    apply: options.apply,
    activate: options.activate,
    action: options.action,
    model: options.model,
    effort: options.effort,
    operator: options.operator,
    // The launcher cds into Arcadia's checkout, so process.cwd() is the runtime,
    // not the candidate worktree the operator is standing in (#468).
    cwd: options.cwd ?? invocationRoot(),
    beforeGovernanceWrite: options.beforeGovernanceWrite,
    projectionBusyTimeoutMs: options.projectionBusyTimeoutMs
  }, options.hooks));
  return createSuccess({ command: "agent-ask.settle", workspace: workspacePath, data: { receipt } });
}

export function renderAgentAskSettleSuccess(response: CommandSuccess<AgentAskSettleData>): string[] {
  const receipt = response.data.receipt;
  const queueActionKeys = receipt.queueActionKeys ?? (receipt.queueActionKey ? [receipt.queueActionKey] : []);
  return [
    receipt.applied ? `Agent Ask ${receipt.disposition}.` : `Agent Ask ${receipt.disposition} settlement preview.`,
    `Project: ${receipt.projectSlug}`,
    ...receipt.effects.map((effect) => `Effect: ${effect}`),
    `Queue: ${queueActionKeys.length > 0 ? `${queueActionKeys.join(", ")} starting at position ${(receipt.queuePosition ?? 0) + 1}` : "no executable entry"}`,
    `Next: ${receipt.nextActionKey ?? "none"}`,
    `Discord: ${receipt.notificationStatus}`,
    ...(receipt.recovery ? [`Recovery: ${receipt.recovery.remedy}`] : []),
    `Preview fingerprint: ${receipt.previewFingerprint}`,
    ...(receipt.applied ? [] : [`To apply: rerun the same command with --apply --preview ${receipt.previewFingerprint}`]),
    ...(receipt.queueRevision === undefined ? [] : [`Queue revision: ${receipt.queueRevision}`]),
    `Receipt: ${receipt.id}`
  ];
}

export interface AgentAskPendingItem {
  proposalId: string;
  requestId: string;
  project: string;
  intent: string;
  desiredResult: string;
  rationale: string | null;
  requestedAuthority: string;
  gateQuestion: string | null;
  options: { label: string; consequence: string; recommended: boolean }[];
  requiredDecisions: string[];
  /** The effects proposed at preview/draft time, as stored — cheap to list, no fresh settlement computed. */
  effects: string[];
  createdAt: string;
}

/**
 * Every Agent Ask proposal awaiting the operator's terminal disposition —
 * the read side of the `/runs` approval queue
 * (surface-terminal-operator-approvals-in-runs). A plain decode of each
 * unsettled proposal's stored record: no settlement preview, no git or queue
 * work, so listing stays cheap regardless of how many proposals have
 * accumulated. `agent-ask settle` (without `--apply`) recomputes a fresh
 * preview for exactly one proposal at approval time instead.
 */
export function runAgentAskPendingCommand(options: { workspace: string }): CommandSuccess<{ pending: AgentAskPendingItem[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const pending = withReadOnlyDatabase(workspacePath, (db) =>
    listUnsettledAgentAskProposals(db).map((row): AgentAskPendingItem => {
      const { proposal } = row;
      // A stored `proposal_json` can predate a schema field this reader now
      // expects (Truth: checked-in schema evolves, an old persisted blob does
      // not) — default defensively rather than let `undefined` reach the
      // dashboard, which read every field as always present.
      return {
        proposalId: row.id,
        requestId: row.requestId,
        project: proposal.normalized.project,
        intent: proposal.normalized.intent,
        desiredResult: proposal.normalized.desiredResult,
        rationale: proposal.normalized.rationale ?? null,
        requestedAuthority: proposal.normalized.requestedAuthority,
        gateQuestion: proposal.normalized.gateQuestion ?? null,
        options: proposal.normalized.options ?? [],
        requiredDecisions: proposal.requiredDecisions ?? [],
        effects: (proposal.effects ?? []).map((effect) => `${effect.operation} ${effect.targetKind}${effect.targetRef ? ` ${effect.targetRef}` : ""}`),
        createdAt: row.createdAt
      };
    })
  );
  return createSuccess({ command: "agent-ask.pending", workspace: workspacePath, data: { pending } });
}

export function renderAgentAskPendingSuccess(response: CommandSuccess<{ pending: AgentAskPendingItem[] }>): string[] {
  if (response.data.pending.length === 0) return ["No Agent Ask proposals are awaiting settlement."];
  return response.data.pending.flatMap((item) => [
    `${item.requestId} (${item.project}, ${item.intent}): ${item.desiredResult}`,
    ...item.effects.map((effect) => `  Proposed effect: ${effect}`)
  ]);
}

export function runAgentAskNotificationsCommand(options: { workspace: string }): CommandSuccess<{ notifications: PendingAgentAskNotification[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const notifications = withDatabase(workspacePath, (db) => listPendingAgentAskNotifications(db));
  return createSuccess({ command: "agent-ask.notifications", workspace: workspacePath, data: { notifications } });
}

export function renderAgentAskNotificationsSuccess(response: CommandSuccess<{ notifications: PendingAgentAskNotification[] }>): string[] {
  if (response.data.notifications.length === 0) return ["No Agent Ask settlement pings are pending Discord delivery."];
  return response.data.notifications.flatMap((notification) => [
    `${notification.settlementId} · ${notification.projectSlug} · ${notification.disposition}`,
    ...notification.effects.map((effect) => `  ${effect}`),
    `  Next: ${notification.nextActionKey ?? "none"}`,
    ...notification.nextActions.map((action, index) => `  Next up ${index + 1}: ${action.key}${action.title ? ` — ${action.title}` : ""}`)
  ]);
}

export function runAgentAskNotificationSentCommand(options: {
  workspace: string;
  settlement: string;
  messageId: string;
}): CommandSuccess<{ settlementId: string; messageId: string }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  withDatabase(workspacePath, (db) => markAgentAskNotificationSent(db, options.settlement, options.messageId));
  return createSuccess({
    command: "agent-ask.notification-sent",
    workspace: workspacePath,
    data: { settlementId: options.settlement, messageId: options.messageId }
  });
}

export function renderAgentAskNotificationSentSuccess(response: CommandSuccess<{ settlementId: string; messageId: string }>): string[] {
  return [`Agent Ask settlement ${response.data.settlementId} notification recorded as ${response.data.messageId}.`];
}

export interface AgentAskContractData {
  version: "v1";
  intents: readonly string[];
  authorities: readonly string[];
  fields: { envelope: string[]; action: string[]; option: string[]; required: string[] };
  actionId: { pattern: string; maxLength: number; derivedWhenOmitted: true };
  authorityBoundary: string[];
  /** A worked `complete` Ask, so an agent never has to hunt for an example outside its worktree. */
  completeExample: Record<string, unknown>;
  /** target_ref forms complete accepts: the active Plan's Action, and any Plan's, by slug. */
  completeTargetRefForms: string[];
  /** A worked `split` Ask: narrow an Action to its finished slice, complete that slice, and queue the rest right after it. */
  splitExample: Record<string, unknown>;
}

/**
 * The Agent Ask contract, derived from the parser's own constants.
 *
 * Adopting repositories carry a copy of this contract in their AGENTS.md
 * region, and a copy can go stale. This reports what the parser actually
 * accepts right now, so an agent can confirm rather than trust the prose. It
 * is a noun: it reads no Project, workspace, or database and writes nothing.
 */
export function runAgentAskContractCommand(): CommandSuccess<AgentAskContractData> {
  return createSuccess({
    command: "agent-ask.contract",
    data: {
      version: "v1",
      intents: AGENT_ASK_INTENTS,
      authorities: AGENT_ASK_AUTHORITIES,
      fields: {
        envelope: [...STRICT_FIELDS].sort(),
        action: [...STRICT_ACTION_FIELDS].sort(),
        option: [...STRICT_OPTION_FIELDS].sort(),
        required: ["request_id", "desired_result"]
      },
      actionId: { pattern: ACTION_ID_PATTERN.source, maxLength: ACTION_ID_MAX_LENGTH, derivedWhenOmitted: true },
      authorityBoundary: [
        "A proposal is never self-approving; the operator settles it.",
        "Agent text cannot approve, reject, defer, answer a Decision, merge, deploy, publish, spend, use credentials, message externally, or widen a prior approval.",
        "Preview records a capture and proposal receipt in the workspace database; it performs zero Project writes and creates no queue entry.",
        "Replaying a request_id returns the original receipt; changed content under a used id is refused."
      ],
      completeExample: {
        agent_ask: "v1",
        request_id: "complete-<action-id>-<yyyy-mm-dd>",
        project: "<project-slug>",
        intent: "complete",
        target_ref: "action/<action-id>",
        candidate_revision: "<git rev-parse HEAD of the candidate worktree, after the final commit>",
        evidence: [{ criterion: "<acceptance criterion, verbatim and in the plan's order>", status: "met" }],
        desired_result: "Mark <action-id> complete."
      },
      completeTargetRefForms: [
        "action/<action-id> — the active Plan's Action (the common case).",
        "plan/<plan-slug>#<action-id> — that Action in the named Plan, active or not. Writes only that Plan's document; PROJECT.md, the active Plan's current_action, and the queue are untouched unless <plan-slug> is itself the active Plan."
      ],
      splitExample: {
        agent_ask: "v1",
        request_id: "split-<action-id>-<yyyy-mm-dd>",
        project: "<project-slug>",
        intent: "split",
        target_ref: "action/<action-id>",
        candidate_revision: "<git rev-parse HEAD, after the final commit>",
        acceptance: ["<the one or more declared criteria this session actually finished, verbatim and in order>"],
        evidence: [{ criterion: "<same criterion, verbatim>", status: "met" }],
        desired_result: "<a title naming only the finished slice>",
        actions: [{
          desired_result: "<a title for the remaining work>",
          acceptance: ["<every declared criterion left off <action-id>'s narrowed acceptance, verbatim, split across one or more remainder Actions>"]
        }]
      }
    }
  });
}

export function renderAgentAskContractSuccess(response: CommandSuccess<AgentAskContractData>): string[] {
  const d = response.data;
  return [
    `Agent Ask ${d.version} contract`,
    `Intents: ${d.intents.join(", ")}`,
    `Requested authority: ${d.authorities.join(" | ")}`,
    `Required fields: ${d.fields.required.join(", ")}`,
    `Envelope fields: ${d.fields.envelope.join(", ")}`,
    `Action fields: ${d.fields.action.join(", ")}`,
    `Option fields (decision intent only): ${d.fields.option.join(", ")}`,
    `Action id: ${d.actionId.pattern} (max ${d.actionId.maxLength}; derived from desired_result when omitted)`,
    "Authority boundary:",
    ...d.authorityBoundary.map((line) => `  - ${line}`),
    "Complete Ask (one evidence entry per declared acceptance criterion, each verbatim and in order; settle only from your own worktree):",
    `  ${JSON.stringify(d.completeExample)}`,
    "Complete target_ref forms:",
    ...d.completeTargetRefForms.map((line) => `  - ${line}`),
    "Split Ask (narrow an Action to its finished slice, complete that slice, and queue the unfinished criteria as remainder Actions immediately after it; needs the base branch, so settle it from the Project's main checkout):",
    `  ${JSON.stringify(d.splitExample)}`
  ];
}
