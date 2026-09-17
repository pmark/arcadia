import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ACTION_ID_MAX_LENGTH, ACTION_ID_PATTERN, AGENT_ASK_AUTHORITIES, AGENT_ASK_INTENTS, normalizeAgentAsk, STRICT_ACTION_FIELDS, STRICT_FIELDS, STRICT_OPTION_FIELDS, type AgentAskProposal } from "../ask/agentAsk.js";
import { discoverUnprocessedAgentAsks, EMPTY_AGENT_ASK_DISCOVERY, type AgentAskDiscoveryResult } from "../ask/discovery.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { findRecoveredAsk } from "../sessions/legacyAskRecovery.js";
import { normalizeError, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  listPendingAgentAskNotifications,
  markAgentAskNotificationSent,
  settleAgentAsk,
  type AgentAskDisposition,
  type AgentAskPlacement,
  type AgentAskResponsibility,
  type AgentAskSettlementReceipt,
  type AgentAskSettlementTestHooks,
  type PendingAgentAskNotification
} from "../ask/settlement.js";

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
  const request = options.file ? readFileSync(path.resolve(options.file), "utf8") : recovered ? recovered.content : options.request ?? "";
  const result = withDatabase(workspacePath, (db) => previewAgentAskRequest(db, {
    request, requestId: options.requestId, project: options.project, sourcePath: options.file ? path.resolve(options.file) : null
  }));
  // Discovery runs only after the request this call was actually asked
  // about has already been recorded above — so a file that is itself under
  // `.arcadia/asks/` is judged "replayed" by discovery, not double-counted
  // as newly "discovered". `options.dir` is only unset when a caller
  // resolves a workspace without saying which repository it lives in (e.g.
  // a unit test exercising proposal logic directly); the CLI itself always
  // supplies it, defaulted to `process.cwd()`, so real invocations always
  // run discovery with no extra flag required.
  const discovery = options.dir
    ? withDatabase(workspacePath, (db) => discoverUnprocessedAgentAsks(db, path.resolve(options.dir!)))
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
    "Project writes: 0"
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
  workspaceStatus: "previewed" | "not_available";
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
  const request = options.file ? readFileSync(path.resolve(options.file), "utf8") : options.request ?? "";
  const normalized = normalizeAgentAsk({ request, requestId: options.requestId, project: options.project });
  const content = request.trim().endsWith("\n") ? request.trim() + "\n" : `${request.trim()}\n`;
  const askDir = path.join(path.resolve(options.dir ?? process.cwd()), ".arcadia", "asks");
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
  let workspaceStatus: "previewed" | "not_available" = "not_available";
  let discovery: AgentAskDiscoveryResult = EMPTY_AGENT_ASK_DISCOVERY;
  try {
    // Re-read the file draft just wrote (rather than passing `content`
    // directly) so preview records `sourcePath`, letting a later terminal
    // `settle --apply` archive this exact file automatically. Passing `dir`
    // through (rather than letting preview default it separately) makes
    // discovery scan the same `.arcadia/asks/` directory this draft was
    // just placed into, not whatever `process.cwd()` happens to be.
    const previewResult = runAgentAskPreviewCommand({ workspace: options.workspace ?? "", file: filePath, requestId: options.requestId, project: options.project, dir: options.dir });
    preview = { proposal: previewResult.data.proposal, fingerprint: previewResult.data.proposal.fingerprint };
    discovery = previewResult.data.discovery;
    workspaceStatus = "previewed";
  } catch (error) {
    // Anything about *reaching* a usable workspace from here — missing,
    // uninitialized, wrong native ABI, or a sandboxed/read-only filesystem
    // denying the SQLite write — degrades to "not available" rather than
    // failing the whole draft: the file is already validated and placed, and
    // that's the part this environment can guarantee. normalizeError is the
    // same classifier the CLI boundary uses, so this matches exactly what a
    // bare `preview` call would have reported for the same failure. A real
    // content problem (e.g. PROJECT_NOT_FOUND, an unexpected VALIDATION_ERROR)
    // still throws, since that's feedback about the Ask itself, not the
    // environment.
    const workspaceUnreachable = [
      "WORKSPACE_NOT_FOUND", "DATABASE_NOT_INITIALIZED", "USAGE_ERROR",
      "SQLITE_WORKSPACE_WRITE_DENIED", "SQLITE_NATIVE_ABI_MISMATCH", "SQLITE_ERROR"
    ].includes(normalizeError(error).code);
    if (!workspaceUnreachable) throw error;
  }
  return createSuccess({
    command: "agent-ask.draft",
    data: { path: filePath, requestId: normalized.requestId, intent: normalized.intent, format: normalized.format, written, preview, workspaceStatus, discovery }
  });
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
  } else {
    lines.push("Previewed: not yet — no Arcadia workspace resolved here.", `Next: run \`arcadia agent-ask preview --file ${d.path}\` wherever a workspace is available.`);
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
  hooks?: AgentAskSettlementTestHooks;
}): CommandSuccess<AgentAskSettleData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (options.disposition !== "accepted" && options.disposition !== "rejected") {
    throw validationError("Agent Ask disposition must be accepted or rejected.");
  }
  if (options.responsibility && options.responsibility !== "autonomous" && options.responsibility !== "agent") {
    throw validationError("Agent Ask Action Responsibility must be autonomous or agent.");
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
    cwd: options.cwd
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
    `Receipt: ${receipt.id}`
  ];
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
    `  Next: ${notification.nextActionKey ?? "none"}`
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
        "Preview performs zero Project writes and creates no queue entry.",
        "Replaying a request_id returns the original receipt; changed content under a used id is refused."
      ]
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
    ...d.authorityBoundary.map((line) => `  - ${line}`)
  ];
}
