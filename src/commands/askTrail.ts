import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { supersessionsReplacing, supersessionThatCreated, type AskSupersession } from "../ask/supersession.js";

export interface AskTrailOptions {
  workspace: string;
  id: string;
}

export interface AskTrailCapture {
  id: string;
  requestId: string;
  originalText: string;
  ingressSource: string;
  capturedAt: string;
}

export interface AskTrailOutcome {
  kind: "action" | "plan" | "decision" | "back_burner_item";
  id: string;
  status: string | null;
  summary: string | null;
  projectName: string | null;
  /** Set when an `ask correct` replaced this record: the Ask that replaced it and the record it created. */
  supersededBy?: { askId: string; recordId: string | null } | null;
}

/** One `arcadia ask correct` link, as the trail shows it. */
export interface AskTrailSupersession {
  /** The Ask that was replaced (for `supersededBy`) or the Ask that replaced this one (for `supersedes`). */
  askId: string;
  targetType: string;
  record: { kind: string; id: string | null };
  oldRecord: { kind: string; id: string | null; disposition: string };
  source: string;
  actor: string | null;
  at: string;
}

export interface AskTrailAsk {
  id: string;
  resolvedIntent: string;
  outputKind: string;
  status: string;
  createdAt: string;
  executionPath: string | null;
  reason: string | null;
  projectName: string | null;
  outcomes: AskTrailOutcome[];
  /** Corrections that replaced this Ask, oldest first. Empty for an Ask nobody corrected. */
  supersededBy: AskTrailSupersession[];
  /** The correction that created this Ask, when it is itself a replacement. */
  supersedes: AskTrailSupersession | null;
}

export interface AskTrailData {
  capture: AskTrailCapture | null;
  asks: AskTrailAsk[];
}

interface CaptureRow {
  id: string;
  request_id: string;
  original_text: string;
  ingress_source: string;
  captured_at: string;
}

interface AskRow {
  id: string;
  resolved_intent: string;
  output_kind: string;
  status: string;
  created_at: string;
  stewardship_json: string | null;
  work_item_id: string | null;
  plan_id: string | null;
  capture_id: string | null;
}

/**
 * Answers "what happened to this Ask?" from any id the operator was handed:
 * a capture id, its request id, or an ask id. Read-only.
 */
export function runAskTrailCommand(options: AskTrailOptions): CommandSuccess<AskTrailData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db) => buildAskTrail(db, options.id.trim()));
  return createSuccess({ command: "ask-trail", workspace: workspacePath, data });
}

/** The canonical `ask show` name; `ask-trail` remains a read-only compatibility alias. */
export function runAskShowCommand(options: AskTrailOptions): CommandSuccess<AskTrailData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db) => buildAskTrail(db, options.id.trim()));
  return createSuccess({ command: "ask.show", workspace: workspacePath, data });
}

function buildAskTrail(db: Database.Database, id: string): AskTrailData {
  const captureById = db.prepare("SELECT * FROM ask_capture_envelopes WHERE id = ? OR request_id = ?");
  let capture = captureById.get(id, id) as CaptureRow | undefined;
  let asks: AskRow[];
  if (capture) {
    asks = db.prepare("SELECT * FROM ask_requests WHERE capture_id = ? ORDER BY created_at").all(capture.id) as AskRow[];
  } else {
    const ask = db.prepare("SELECT * FROM ask_requests WHERE id = ?").get(id) as AskRow | undefined;
    if (!ask) {
      throw validationError("No Ask capture, request, or ask matches this id.", {
        id,
        remedy: "Pass the capture_… id from the Ask receipt, its request id, or an ask_… id."
      });
    }
    capture = ask.capture_id ? (captureById.get(ask.capture_id, ask.capture_id) as CaptureRow | undefined) : undefined;
    asks = [ask];
  }

  return {
    capture: capture
      ? {
          id: capture.id,
          requestId: capture.request_id,
          originalText: capture.original_text,
          ingressSource: capture.ingress_source,
          capturedAt: capture.captured_at
        }
      : null,
    asks: asks.map((ask) => traceAsk(db, ask))
  };
}

function traceAsk(db: Database.Database, ask: AskRow): AskTrailAsk {
  const stewardship = parseStewardship(ask.stewardship_json);
  const outcomes: AskTrailOutcome[] = [];

  if (ask.work_item_id) outcomes.push(...actionOutcome(db, ask.work_item_id));
  if (ask.plan_id) outcomes.push(...planOutcome(db, ask.plan_id));
  if (ask.capture_id) outcomes.push(...captureOutcomes(db, ask.capture_id));

  const decisions = db.prepare(`
    SELECT review.id, review.status, review.decision_needed, project.name AS project_name,
      resulting.work_item_id AS resulting_work_item_id
    FROM review_items review
    LEFT JOIN projects project ON project.id = review.project_id
    LEFT JOIN ask_requests resulting ON resulting.id = review.resulting_ask_request_id
    WHERE review.ask_request_id = ? ORDER BY review.created_at
  `).all(ask.id) as Array<{
    id: string;
    status: string;
    decision_needed: string | null;
    project_name: string | null;
    resulting_work_item_id: string | null;
  }>;
  for (const decision of decisions) {
    outcomes.push({ kind: "decision", id: decision.id, status: decision.status, summary: decision.decision_needed, projectName: decision.project_name });
    // Approving the Decision runs a new Ask; follow it to the Action it created.
    if (decision.resulting_work_item_id) outcomes.push(...actionOutcome(db, decision.resulting_work_item_id));
  }

  const shelved = db.prepare(`
    SELECT item.id, item.status, item.classification, item.promoted_work_item_id, project.name AS project_name
    FROM back_burner_items item LEFT JOIN projects project ON project.id = item.project_id
    WHERE item.ask_request_id = ? ORDER BY item.created_at
  `).all(ask.id) as Array<{ id: string; status: string; classification: string; promoted_work_item_id: string | null; project_name: string | null }>;
  for (const item of shelved) {
    outcomes.push({ kind: "back_burner_item", id: item.id, status: item.status, summary: item.classification, projectName: item.project_name });
    if (item.promoted_work_item_id) outcomes.push(...actionOutcome(db, item.promoted_work_item_id));
  }

  const replacedBy = supersessionsReplacing(db, ask.id);
  const replaces = supersessionThatCreated(db, ask.id);
  for (const link of replacedBy) {
    for (const outcome of outcomes) {
      if (link.oldRecordId && outcome.id === link.oldRecordId) {
        outcome.supersededBy = { askId: link.newAskRequestId, recordId: link.newRecordId };
      }
    }
  }

  return {
    id: ask.id,
    resolvedIntent: ask.resolved_intent,
    outputKind: ask.output_kind,
    status: ask.status,
    createdAt: ask.created_at,
    executionPath: stewardship.recommendedExecutionPath ?? null,
    reason: stewardship.classificationReason ?? null,
    projectName: stewardship.relatedProject?.name ?? null,
    outcomes: outcomes.filter((outcome, index) => outcomes.findIndex((candidate) => candidate.kind === outcome.kind && candidate.id === outcome.id) === index),
    supersededBy: replacedBy.map((link) => trailSupersession(link, link.newAskRequestId)),
    supersedes: replaces ? trailSupersession(replaces, replaces.oldAskRequestId) : null
  };
}

function trailSupersession(link: AskSupersession, askId: string): AskTrailSupersession {
  return {
    askId,
    targetType: link.targetType,
    record: { kind: link.newKind, id: link.newRecordId },
    oldRecord: { kind: link.oldKind, id: link.oldRecordId, disposition: link.oldDisposition },
    source: link.source,
    actor: link.actor,
    at: link.createdAt
  };
}

function captureOutcomes(db: Database.Database, captureId: string): AskTrailOutcome[] {
  const outcomes: AskTrailOutcome[] = [];
  for (const row of db.prepare("SELECT id FROM work_items WHERE capture_id = ?").all(captureId) as Array<{ id: string }>) outcomes.push(...actionOutcome(db, row.id));
  for (const row of db.prepare("SELECT id FROM execution_plans WHERE capture_id = ?").all(captureId) as Array<{ id: string }>) outcomes.push(...planOutcome(db, row.id));
  for (const row of db.prepare("SELECT review.id, review.status, review.decision_needed, project.name AS project_name FROM review_items review LEFT JOIN projects project ON project.id = review.project_id WHERE review.capture_id = ?").all(captureId) as Array<{ id: string; status: string; decision_needed: string; project_name: string | null }>) outcomes.push({ kind: "decision", id: row.id, status: row.status, summary: row.decision_needed, projectName: row.project_name });
  for (const row of db.prepare("SELECT item.id, item.status, item.classification, project.name AS project_name FROM back_burner_items item LEFT JOIN projects project ON project.id = item.project_id WHERE item.capture_id = ?").all(captureId) as Array<{ id: string; status: string; classification: string; project_name: string | null }>) outcomes.push({ kind: "back_burner_item", id: row.id, status: row.status, summary: row.classification, projectName: row.project_name });
  return outcomes;
}

function planOutcome(db: Database.Database, planId: string): AskTrailOutcome[] {
  const row = db.prepare("SELECT id, status, summary FROM execution_plans WHERE id = ?").get(planId) as { id: string; status: string; summary: string } | undefined;
  return row ? [{ kind: "plan", id: row.id, status: row.status, summary: row.summary, projectName: null }] : [];
}

function actionOutcome(db: Database.Database, workItemId: string): AskTrailOutcome[] {
  const row = db.prepare(`
    SELECT work.id, work.title, work.status, project.name AS project_name
    FROM work_items work LEFT JOIN projects project ON project.id = work.project_id
    WHERE work.id = ?
  `).get(workItemId) as { id: string; title: string; status: string; project_name: string | null } | undefined;
  return row ? [{ kind: "action", id: row.id, status: row.status, summary: row.title, projectName: row.project_name }] : [];
}

function parseStewardship(json: string | null): {
  recommendedExecutionPath?: string;
  classificationReason?: string;
  relatedProject?: { name?: string } | null;
} {
  if (!json) return {};
  try {
    return JSON.parse(json) as ReturnType<typeof parseStewardship>;
  } catch {
    return {};
  }
}

export function renderAskTrailSuccess(response: CommandSuccess<AskTrailData>): string[] {
  const { capture, asks } = response.data;
  const lines = ["Arcadia Ask trail"];
  if (capture) {
    lines.push(
      `Capture: ${capture.id} (${capture.ingressSource}, ${capture.capturedAt})`,
      `Request: ${capture.requestId}`,
      `Text: ${capture.originalText.split("\n")[0]}`
    );
  } else {
    lines.push("Capture: not linked (recorded before Ask tracing)");
  }
  if (asks.length === 0) {
    lines.push("Outcome: no linked Ask — none was processed, or it predates Ask tracing and could not be matched unambiguously.");
  }
  for (const ask of asks) {
    lines.push(
      "",
      `Ask ${ask.id}: ${ask.resolvedIntent} → ${ask.executionPath ?? ask.outputKind} [${ask.status}]`,
      `  Project: ${ask.projectName ?? "none"}`,
      ...(ask.reason ? [`  Why: ${ask.reason}`] : [])
    );
    if (ask.outcomes.length === 0) lines.push("  Produced: nothing yet");
    for (const outcome of ask.outcomes) {
      const detail = [outcome.status, outcome.projectName].filter(Boolean).join(", ");
      const replaced = outcome.supersededBy
        ? ` [superseded by ${outcome.supersededBy.recordId ?? "Ask"} via ${outcome.supersededBy.askId}]`
        : "";
      lines.push(`  → ${outcome.kind} ${outcome.id}${detail ? ` (${detail})` : ""}${outcome.summary ? `: ${outcome.summary}` : ""}${replaced}`);
    }
    for (const link of ask.supersededBy) {
      lines.push(`  Superseded by ${link.askId}: corrected to ${link.targetType} (${link.source}, ${link.at}); ${describeOld(link)} -> ${describeNew(link)}`);
    }
    if (ask.supersedes) {
      const link = ask.supersedes;
      lines.push(`  Supersedes ${link.askId}: corrected to ${link.targetType} (${link.source}, ${link.at}); ${describeOld(link)} -> ${describeNew(link)}`);
    }
  }
  return lines;
}

function describeOld(link: AskTrailSupersession): string {
  return `${link.oldRecord.kind}${link.oldRecord.id ? ` ${link.oldRecord.id}` : ""} ${link.oldRecord.disposition}`;
}

function describeNew(link: AskTrailSupersession): string {
  return link.record.id ? `${link.record.kind} ${link.record.id}` : "nothing created";
}
