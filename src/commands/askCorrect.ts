import { validationError, projectNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createAskRequest,
  getBackBurnerItem,
  getReviewItem,
  getReviewItemBySlug,
  getWorkItem,
  updateReviewItemStatus,
  updateWorkItem
} from "../db/repositories.js";
import { resolveProjectReference } from "../ask/rules.js";
import { ASK_CORRECTION_TYPES, ASK_HEARD_HINT, buildAskHeard, type AskCorrectionType, type AskHeard } from "../ask/heard.js";
import {
  currentAskId,
  describeAskRecord,
  recordSupersession,
  type AskRecord,
  type AskRecordKind
} from "../ask/supersession.js";
import { loadPhase3Registries } from "../intent/registries.js";
import { runAskCommand } from "./ask.js";
import { runBackBurnerArchiveCommand, runBackBurnerPromoteCommand } from "./backBurner.js";
import { runReviewResolveReplyCommand } from "./review.js";
import { runStatusCommand } from "./status.js";

/** Where a correction came from. `discord` is a reply to an Ask receipt; `cli` is the operator at a terminal. */
export type AskCorrectionSource = "cli" | "discord";

export interface AskCorrectOptions {
  workspace: string;
  /** The `ask_…` id on the receipt, or its capture or request id. */
  askId: string;
  type?: string;
  /** Project id, slug or name to move the Ask to. */
  project?: string;
  /** For `--type answer`: the pending Decision (id or slug) the Ask answers. Never inferred. */
  ref?: string;
  source?: AskCorrectionSource;
  /** The authenticated sender, when the source knows it (a Discord author id). Provenance, and the Discord gate. */
  actor?: string;
}

export interface AskCorrectData {
  /** The Ask the operator named. */
  askId: string;
  /** The Ask that stood in for it when corrected (differs from `askId` after an earlier correction). */
  correctedAskId: string;
  /** The new Ask that replaces it. */
  newAskId: string;
  targetType: AskCorrectionType | "reroute";
  previous: { kind: AskRecordKind; id: string | null; disposition: string };
  created: { kind: string; id: string | null; summary: string };
  supersessionId: string;
  heard: AskHeard;
  /** True when the correction used a writer that could queue a Run. Always false: the guarantee is checked, not assumed. */
  queuedRun: false;
}

interface CorrectionContext {
  askId: string;
  captureId: string;
  requestId: string;
  originalText: string;
  ingressSource: string;
  record: AskRecord;
}

const TARGET_TYPES: readonly string[] = ASK_CORRECTION_TYPES;

/**
 * Re-routes an Ask the operator says was heard wrongly. It goes only through the writers Arcadia already has: the Ask
 * pipeline (an Action, a Back Burner item or a question), Back Burner promote and archive, and the review
 * resolve-reply writer. The record it replaces is closed, never deleted, and linked to the new one as superseded; the
 * original capture is reused untouched. A correction never starts an executor.
 */
export function runAskCorrectCommand(options: AskCorrectOptions): CommandSuccess<AskCorrectData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const source: AskCorrectionSource = options.source ?? "cli";
  const type = normalizeType(options.type);
  if (!type && !options.project?.trim()) {
    throw validationError("Pass --type (work|idea|answer|status), --project, or both.", {
      remedy: "Example: arcadia ask correct <ask_id> --type work --project <slug>"
    });
  }
  if (type === "answer") requireVerifiedAnswerAuthor(source, options.actor);

  const context = withDatabase(workspacePath, (db): CorrectionContext => {
    const askId = resolveAskId(db, options.askId.trim());
    const liveAskId = currentAskId(db, askId);
    const ask = db
      .prepare("SELECT id, capture_id FROM ask_requests WHERE id = ?")
      .get(liveAskId) as { id: string; capture_id: string | null } | undefined;
    const capture = ask?.capture_id
      ? (db
          .prepare("SELECT id, request_id, original_text, ingress_source FROM ask_capture_envelopes WHERE id = ?")
          .get(ask.capture_id) as { id: string; request_id: string; original_text: string; ingress_source: string } | undefined)
      : undefined;
    if (!ask || !capture) {
      throw validationError("This Ask has no stored capture, so it cannot be re-routed.", {
        id: options.askId,
        remedy: "Ask again with the right route, for example arcadia ask --back-burner."
      });
    }
    return {
      askId: ask.id,
      captureId: capture.id,
      requestId: capture.request_id,
      originalText: capture.original_text,
      ingressSource: capture.ingress_source,
      record: describeAskRecord(db, ask.id)
    };
  });

  const project = options.project?.trim()
    ? withDatabase(workspacePath, (db) => {
        const found = resolveProjectReference(db, options.project);
        if (!found) throw projectNotFound(options.project as string);
        return { id: found.id, name: found.name };
      })
    : null;

  const previous = context.record;
  assertCorrectable(previous, type, project?.id ?? null);
  // `--project` alone keeps what the Ask was heard as and moves it.
  const effectiveType: AskCorrectionType | "reroute" = type ?? rerouteTypeFor(previous);

  const created = createReplacement(workspacePath, context, effectiveType, project, options);

  // The replacement exists; record the link before closing the old record so the trail never shows a gap.
  const supersession = withDatabase(workspacePath, (db) =>
    recordSupersession(db, {
      oldAskRequestId: context.askId,
      newAskRequestId: created.newAskId,
      targetType: effectiveType,
      projectId: project?.id ?? null,
      oldKind: previous.kind,
      oldRecordId: previous.id,
      newKind: created.kind,
      newRecordId: created.recordId,
      oldDisposition: created.promotedOld ? "promoted" : dispositionFor(previous.kind),
      source,
      actor: options.actor?.trim() || null
    })
  );
  const disposition = created.promotedOld ? "promoted" : retireOldRecord(workspacePath, previous, context, created.newAskId, effectiveType);

  return createSuccess({
    command: "ask.correct",
    workspace: workspacePath,
    data: {
      askId: options.askId,
      correctedAskId: context.askId,
      newAskId: created.newAskId,
      targetType: effectiveType,
      previous: { kind: previous.kind, id: previous.id, disposition },
      created: { kind: created.kind, id: created.recordId, summary: created.summary },
      supersessionId: supersession.id,
      heard: created.heard,
      queuedRun: false
    },
    artifacts: created.artifacts,
    warnings: created.warnings
  });
}

export function renderAskCorrectSuccess(response: CommandSuccess<AskCorrectData>): string[] {
  const { data } = response;
  const replaced = data.previous.id ? `${data.previous.kind} ${data.previous.id}` : `Ask ${data.correctedAskId}`;
  return [
    data.heard.line,
    `Corrected: Ask ${data.correctedAskId} -> ${data.targetType}: ${data.created.summary}`,
    `Superseded: ${replaced} (${data.previous.disposition}); the original capture and record are kept`,
    `Ask: ${data.newAskId}`,
    `Run: Not run`
  ];
}

function normalizeType(raw: string | undefined): AskCorrectionType | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (!TARGET_TYPES.includes(value)) {
    throw validationError(`Unknown correction type "${raw}".`, {
      validTypes: [...ASK_CORRECTION_TYPES],
      remedy: `Use ${ASK_CORRECTION_TYPES.join(", ")}. (task is added by a later Action.)`
    });
  }
  return value as AskCorrectionType;
}

/**
 * A correction to `answer` resolves a Decision, so from Discord it needs a verified sender: the allowlist must be
 * configured and must include the author. The Discord bot checks the same thing before it calls this command; this is
 * the second lock, so a replayed or hand-built Discord-sourced call cannot skip it.
 */
export function requireVerifiedAnswerAuthor(source: AskCorrectionSource, actor: string | undefined): void {
  if (source !== "discord") return;
  const allowed = (process.env.DISCORD_ALLOWED_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (allowed.length === 0 || !actor?.trim() || !allowed.includes(actor.trim())) {
    throw validationError("An answer correction from Discord needs a verified author.", {
      remedy:
        "Set DISCORD_ALLOWED_USER_IDS to include the author, or run arcadia ask correct <ask_id> --type answer --ref <decision> from the CLI.",
      allowlistConfigured: allowed.length > 0
    });
  }
}

function resolveAskId(db: Parameters<typeof describeAskRecord>[0], id: string): string {
  const direct = db.prepare("SELECT id FROM ask_requests WHERE id = ?").get(id) as { id: string } | undefined;
  if (direct) return direct.id;
  const viaCapture = db
    .prepare(
      `SELECT ar.id FROM ask_requests ar
         JOIN ask_capture_envelopes ce ON ce.id = ar.capture_id
        WHERE ce.id = ? OR ce.request_id = ?
        ORDER BY ar.created_at DESC, ar.id DESC LIMIT 1`
    )
    .get(id, id) as { id: string } | undefined;
  if (viaCapture) return viaCapture.id;
  throw validationError("No Ask matches this id.", {
    id,
    remedy: "Pass the ask_… id from the Ask receipt (arcadia ask show lists it)."
  });
}

/** Refuses, before anything is written, a correction that cannot be applied cleanly. */
function assertCorrectable(record: AskRecord, type: AskCorrectionType | null, projectId: string | null): void {
  if (record.kind === "answer") {
    throw validationError("This Ask already answered a Decision, so it cannot be re-routed.", {
      remedy: "Reopen the Decision through its own review command if the answer was wrong."
    });
  }
  if (record.kind === "question" && record.status !== "open" && record.status !== "deferred") {
    throw validationError(`The question ${record.slug ?? record.id} was already ${record.status}, so this Ask cannot be re-routed.`, {
      remedy: "Correct the Action or Decision it produced instead."
    });
  }
  if (record.kind === "idea" && record.status !== "incubating" && record.status !== "opportunistic") {
    throw validationError(`The Back Burner item ${record.id} is already ${record.status}, so this Ask cannot be re-routed.`, {});
  }
  if (record.kind === "work" && record.status !== "open") {
    throw validationError(`The Action ${record.id} is already ${record.status}, so this Ask cannot be re-routed.`, {
      remedy: "Only an Action nobody has started can be superseded."
    });
  }
  if (!type) {
    if (record.kind === "none") {
      throw validationError("--project alone needs an Ask that created an Action, an idea or a question.", {
        remedy: "Pass --type as well."
      });
    }
    if (!projectId || projectId === record.projectId) {
      throw validationError("The Ask is already in that Project.", { projectId });
    }
    return;
  }
  if (type === "work" && record.kind === "work" && (!projectId || projectId === record.projectId)) {
    throw validationError("This Ask is already an Action. Pass --project to move it to another Project.", { id: record.id });
  }
  if (type === "idea" && record.kind === "idea" && (!projectId || projectId === record.projectId)) {
    throw validationError("This Ask is already a Back Burner idea. Pass --project to move it to another Project.", { id: record.id });
  }
  if (type === "status" && projectId) {
    throw validationError("--project does not apply to type status.", {});
  }
}

function rerouteTypeFor(record: AskRecord): AskCorrectionType | "reroute" {
  if (record.kind === "work") return "work";
  if (record.kind === "idea") return "idea";
  return "reroute";
}

function dispositionFor(kind: AskRecordKind): string {
  switch (kind) {
    case "question":
      return "closed";
    case "idea":
      return "archived";
    case "work":
      return "deferred";
    default:
      return "unchanged";
  }
}

interface Replacement {
  newAskId: string;
  kind: string;
  recordId: string | null;
  summary: string;
  heard: AskHeard;
  /** True when the old record was a Back Burner item and promoting it already retired it. */
  promotedOld: boolean;
  artifacts: string[];
  warnings: string[];
}

function createReplacement(
  workspacePath: string,
  context: CorrectionContext,
  target: AskCorrectionType | "reroute",
  project: { id: string; name: string } | null,
  options: AskCorrectOptions
): Replacement {
  switch (target) {
    case "answer":
      return correctToAnswer(workspacePath, context, options);
    case "status":
      return correctToStatus(workspacePath, context);
    case "work":
      if (context.record.kind === "idea" && context.record.id) return correctIdeaToWork(workspacePath, context, project);
      return correctThroughAsk(workspacePath, context, "work", project);
    case "idea":
      return correctThroughAsk(workspacePath, context, "idea", project);
    case "reroute":
      return correctThroughAsk(workspacePath, context, "reroute", project);
  }
}

/** The Ask pipeline again on the original capture: no new capture, no suppression, no Decision resolved, no Run. */
function correctThroughAsk(
  workspacePath: string,
  context: CorrectionContext,
  route: "work" | "idea" | "reroute",
  project: { id: string; name: string } | null
): Replacement {
  const response = runAskCommand({
    workspace: workspacePath,
    request: context.originalText,
    requestId: context.requestId,
    reuseCaptureEnvelope: true,
    sourceIngress: context.ingressSource,
    project: project?.id,
    correctionRoute: route
  });
  const ask = response.data.ask;
  if (!ask) throw validationError("The corrected Ask produced no Ask record.", { askId: context.askId });
  if (response.data.run) throw validationError("A correction must not run anything.", { runId: response.data.run.id });
  const heard = response.data.heard ?? buildAskHeard(response.data);
  const record = response.data.backBurnerItemId
    ? { kind: "back_burner_item", id: response.data.backBurnerItemId }
    : response.data.workItem
      ? { kind: "action", id: response.data.workItem.id }
      : response.data.reviewItemId
        ? { kind: "decision", id: response.data.reviewItemId }
        : { kind: "none", id: null };
  return {
    newAskId: ask.id,
    kind: record.kind,
    recordId: record.id,
    summary: heard.created,
    heard,
    promotedOld: false,
    artifacts: response.artifacts,
    warnings: response.warnings
  };
}

/** Back Burner promote is the writer that turns an idea into an Action; it also retires the item. */
function correctIdeaToWork(
  workspacePath: string,
  context: CorrectionContext,
  project: { id: string; name: string } | null
): Replacement {
  const promoted = runBackBurnerPromoteCommand({
    workspace: workspacePath,
    id: context.record.id as string,
    ...(project ? { project: project.id } : {})
  });
  const workItem = promoted.data.workItem;
  const registries = loadPhase3Registries(workspacePath);
  const ask = withDatabase(workspacePath, (db) =>
    createAskRequest(db, {
      captureId: context.captureId,
      rawRequest: context.originalText,
      resolvedIntent: "AskCorrection",
      registryVersion: registries.intents.version,
      outputKind: "correction",
      workItemId: workItem.id,
      status: "planned"
    })
  );
  const projectName = withDatabase(workspacePath, (db) => getWorkItem(db, workItem.id))?.project_name ?? project?.name ?? null;
  const created = `Action ${workItem.id} ${projectName ? `in ${projectName}` : "unscoped"}`;
  return {
    newAskId: ask.id,
    kind: "action",
    recordId: workItem.id,
    summary: created,
    heard: correctionHeard("work", created),
    promotedOld: true,
    artifacts: promoted.artifacts,
    warnings: promoted.warnings
  };
}

function correctToStatus(workspacePath: string, context: CorrectionContext): Replacement {
  const status = runStatusCommand({ workspace: workspacePath });
  const registries = loadPhase3Registries(workspacePath);
  const ask = withDatabase(workspacePath, (db) =>
    createAskRequest(db, {
      captureId: context.captureId,
      rawRequest: context.originalText,
      resolvedIntent: "AskCorrection",
      registryVersion: registries.intents.version,
      outputKind: "correction",
      status: "planned"
    })
  );
  return {
    newAskId: ask.id,
    kind: "none",
    recordId: null,
    summary: "status shown (nothing created)",
    heard: correctionHeard("status", "status shown (nothing created)"),
    promotedOld: false,
    artifacts: status.artifacts,
    warnings: status.warnings
  };
}

/**
 * The review resolve-reply writer, with its own validation, applied to the Decision the operator named. The Ask's
 * text is the reply. Execution is switched off, so approving a Decision this way can never queue a Run.
 */
function correctToAnswer(workspacePath: string, context: CorrectionContext, options: AskCorrectOptions): Replacement {
  const reference = options.ref?.trim();
  if (!reference) {
    throw validationError("An answer correction needs an explicit reference to the pending Decision it answers.", {
      remedy: "Pass --ref <decision id or slug>. Arcadia never picks the Decision for you."
    });
  }
  const target = withDatabase(workspacePath, (db) => getReviewItem(db, reference) ?? getReviewItemBySlug(db, reference));
  if (!target) throw validationError("The referenced Decision was not found.", { ref: reference });
  if (target.status !== "open" && target.status !== "deferred") {
    throw validationError("The referenced Decision is already decided.", { ref: reference, status: target.status });
  }
  if (context.record.kind === "question" && context.record.id === target.id) {
    throw validationError("An Ask cannot answer the question it raised itself.", { ref: reference });
  }
  if (target.resolved_intent === "ProjectProposalApproval") {
    throw validationError("A project proposal approval starts a build, so a correction cannot answer it.", {
      ref: reference,
      remedy: `Approve it deliberately with arcadia review approve ${target.slug ?? target.id}.`
    });
  }

  const resolution = runReviewResolveReplyCommand({
    workspace: workspacePath,
    id: target.id,
    reply: context.originalText,
    execute: false,
    actor: options.actor ?? null,
    captureId: context.captureId
  });
  if (resolution.data.run) {
    // Cannot happen with execute off; if a future writer disagrees, say so loudly rather than hide a queued Run.
    throw validationError("The review writer queued a Run for a correction. This must not happen.", { runId: resolution.data.run.id });
  }
  const registries = loadPhase3Registries(workspacePath);
  const ask = withDatabase(workspacePath, (db) =>
    createAskRequest(db, {
      captureId: context.captureId,
      rawRequest: context.originalText,
      resolvedIntent: "ReviewResponse",
      registryVersion: registries.intents.version,
      outputKind: "review_response",
      status: "planned"
    })
  );
  const created = `answer recorded on Decision ${resolution.data.item.slug ?? target.id}`;
  return {
    newAskId: ask.id,
    kind: "decision",
    recordId: target.id,
    summary: `${created}. ${resolution.data.confirmation}`,
    heard: correctionHeard("answer", created),
    promotedOld: false,
    artifacts: resolution.artifacts,
    warnings: resolution.warnings
  };
}

function correctionHeard(type: AskHeard["type"], created: string): AskHeard {
  return {
    type,
    confidence: "high",
    source: "rule",
    created,
    line: `Heard: ${type} (high, rule) -> ${created} . ${ASK_HEARD_HINT}`
  };
}

/** Closes the record the correction replaced. Closed, archived or deferred: never deleted. */
function retireOldRecord(
  workspacePath: string,
  record: AskRecord,
  context: CorrectionContext,
  newAskId: string,
  target: AskCorrectionType | "reroute"
): string {
  const note = `Superseded by Ask correction ${newAskId} (${target}).`;
  if (record.kind === "question" && record.id) {
    withDatabase(workspacePath, (db) => updateReviewItemStatus(db, record.id as string, { status: "rejected", decisionNote: note }));
    return "closed";
  }
  if (record.kind === "idea" && record.id) {
    const still = withDatabase(workspacePath, (db) => getBackBurnerItem(db, record.id as string));
    if (still && (still.status === "incubating" || still.status === "opportunistic")) {
      runBackBurnerArchiveCommand({ workspace: workspacePath, id: record.id });
    }
    return "archived";
  }
  if (record.kind === "work" && record.id) {
    withDatabase(workspacePath, (db) => {
      const item = getWorkItem(db, record.id as string);
      if (!item) return;
      updateWorkItem(db, item.id, { status: "deferred", nextAction: note });
      // Decisions the replaced Ask raised for that Action are no longer wanted either.
      const open = db
        .prepare("SELECT id FROM review_items WHERE ask_request_id = ? AND status IN ('open', 'deferred')")
        .all(context.askId) as Array<{ id: string }>;
      for (const decision of open) updateReviewItemStatus(db, decision.id, { status: "rejected", decisionNote: note });
    });
    return "deferred";
  }
  return "unchanged";
}
