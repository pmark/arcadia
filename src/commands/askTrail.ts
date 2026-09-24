import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";

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
  const data = withDatabase(workspacePath, (db) => buildAskTrail(db, options.id.trim()));
  return createSuccess({ command: "ask-trail", workspace: workspacePath, data });
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
  if (ask.plan_id) outcomes.push({ kind: "plan", id: ask.plan_id, status: null, summary: null, projectName: null });

  const decisions = db.prepare(`
    SELECT review.id, review.status, review.decision_needed, project.name AS project_name
    FROM review_items review LEFT JOIN projects project ON project.id = review.project_id
    WHERE review.ask_request_id = ? ORDER BY review.created_at
  `).all(ask.id) as Array<{ id: string; status: string; decision_needed: string | null; project_name: string | null }>;
  for (const decision of decisions) {
    outcomes.push({ kind: "decision", id: decision.id, status: decision.status, summary: decision.decision_needed, projectName: decision.project_name });
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

  return {
    id: ask.id,
    resolvedIntent: ask.resolved_intent,
    outputKind: ask.output_kind,
    status: ask.status,
    createdAt: ask.created_at,
    executionPath: stewardship.recommendedExecutionPath ?? null,
    reason: stewardship.classificationReason ?? null,
    projectName: stewardship.relatedProject?.name ?? null,
    outcomes
  };
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
    lines.push("Outcome: none — the capture was recorded but no Ask was processed from it.");
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
      lines.push(`  → ${outcome.kind} ${outcome.id}${detail ? ` (${detail})` : ""}${outcome.summary ? `: ${outcome.summary}` : ""}`);
    }
  }
  return lines;
}
