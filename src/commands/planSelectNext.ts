import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { usageError, validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { buildAgentQueue } from "../dispatch/queue.js";
import { parseDoc } from "../docs/parse.js";
import { listOpenRedAlerts } from "../production/redAlerts.js";
import {
  adaptQueue, adaptRedAlerts, selectNextPlan, type CloseOutSummary, type LiveQueue, type QueueGlobal, type PlanSummary, type ProjectPreference, type QueueSummary,
  type RedAlertSummary, type Selection
} from "../plans/nextPlanSelector.js";

export interface PlanSelectNextOptions {
  repo: string;
  project?: string;
  /** JSON `{ projects: [{ project, included, chosenPlan }] }` (the operator preference record shape). */
  preferences?: string;
  /** Override: JSON in the selector shape `{ queues }` or the `advance queue --json` shape. Absent reads the live queue. */
  queue?: string;
  /** Override: JSON `{ alerts: [{ id, project, trigger? }] }`. Absent reads open red alerts live. */
  redAlerts?: string;
  /** Workspace for the live read-only readers (default workspace when omitted). */
  workspace?: string;
  runId?: string;
  sessionId?: string;
  /** Comma-separated Agent Ask ids this run submitted. */
  runAsk?: string;
  now?: Date;
}

export interface PlanSelectNextData extends Selection {
  gaps: string[];
}

function readJson(file: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw validationError(`${label} could not be read as JSON: ${(error as Error).message}`, { cause: String(error) });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw validationError(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Read-only: gathers inputs from checked-in documents and operator-supplied files; writes nothing. */
export function runPlanSelectNextCommand(options: PlanSelectNextOptions): CommandSuccess<PlanSelectNextData> {
  const repo = path.resolve(options.repo);
  const gaps: string[] = [];
  const plansDir = path.join(repo, "docs", "plans");
  const plans: PlanSummary[] = [];
  const closeOuts: CloseOutSummary[] = [];
  if (existsSync(plansDir)) {
    for (const name of readdirSync(plansDir).filter(entry => entry.endsWith(".md")).sort()) {
      const relative = `docs/plans/${name}`;
      const absolute = path.join(plansDir, name);
      const parsed = parseDoc(relative, absolute, readFileSync(absolute, "utf8"));
      if (!parsed.doc || parsed.doc.type !== "plan") continue;
      const doc = parsed.doc;
      const asks = new Set<string>();
      for (const action of doc.actions) {
        const match = /^Agent Ask (\S+)/.exec(action.source ?? "");
        if (match) asks.add(match[1]);
      }
      plans.push({
        project: doc.project, slug: doc.slug, status: doc.status,
        // The only approval the repository records is activation: an `active` Plan was activated by a
        // governed settlement. A draft Plan therefore carries no receipt here (stated gap below).
        approvalReceipt: doc.status === "active" ? "plan-status:active" : null,
        sourceAsks: [...asks], authoringSession: null
      });
      const recordPath = path.join(plansDir, `${doc.slug}.close-out.json`);
      if (existsSync(recordPath)) {
        try {
          const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
            plan?: { closed?: unknown }; openRemainders?: { id?: unknown; status?: unknown }[]; ledger?: { evidence?: unknown };
          };
          closeOuts.push({
            project: doc.project, plan: doc.slug, closed: record.plan?.closed === true,
            openRemainders: (record.openRemainders ?? []).map(item => ({ id: String(item.id), status: String(item.status) })),
            evidence: record.ledger?.evidence === "partial" || record.ledger?.evidence === "complete" ? record.ledger.evidence : "none"
          });
        } catch {
          gaps.push(`${doc.slug}.close-out.json is not valid JSON and was ignored (treated as no record).`);
        }
      }
    }
  }
  if (!options.preferences) gaps.push("no Project preference record exists yet (Decision 0122; Action record-production-project-preferences); supply --preferences to preview a choice.");
  gaps.push("Plan authoring session is not recorded by the repository; same-run authorship uses Plan/Action source Agent Asks plus --run-ask, --run-id, --session-id.");
  gaps.push("Operator approval of a draft Plan has no repository field; only an active Plan carries a receipt.");

  let preferences: ProjectPreference[] = [];
  if (options.preferences) {
    const raw = readJson(options.preferences, "--preferences").projects;
    if (!Array.isArray(raw)) throw validationError("--preferences must hold a `projects` array");
    preferences = raw.map(item => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { project: String(record.project ?? ""), included: record.included === true, chosenPlan: asString(record.chosenPlan) };
    });
  }
  const activePlans: Record<string, string | null> = {};
  const projectPath = path.join(repo, "PROJECT.md");
  if (existsSync(projectPath)) {
    const parsedProject = parseDoc("PROJECT.md", projectPath, readFileSync(projectPath, "utf8"));
    if (parsedProject.doc && parsedProject.doc.type === "project") activePlans[parsedProject.doc.slug] = parsedProject.doc.activePlan;
  }
  const liveErrors: { queue: string | null; redAlerts: string | null } = { queue: null, redAlerts: null };
  let queues: QueueSummary[] | null = null;
  let queueGlobal: QueueGlobal | null = null;
  if (options.queue) {
    const raw = readJson(options.queue, "--queue");
    if (Array.isArray(raw.ordered)) {
      const adapted = adaptQueue(raw as unknown as LiveQueue, activePlans);
      queues = adapted.queues;
      queueGlobal = adapted.global;
    } else if (Array.isArray(raw.queues)) {
      queues = raw.queues as QueueSummary[];
    } else throw validationError("--queue must hold a `queues` array or an `advance queue --json` object");
  } else {
    try {
      const { workspacePath } = resolveReadyWorkspace(options.workspace);
      const live = withReadOnlyDatabase(workspacePath, db => buildAgentQueue(db));
      const adapted = adaptQueue(live, activePlans);
      queues = adapted.queues;
      queueGlobal = adapted.global;
    } catch (error) {
      liveErrors.queue = error instanceof Error ? error.constructor.name : "UnknownError";
      gaps.push(`Live queue read failed (${liveErrors.queue}); queue order is reported as unknown.`);
    }
  }
  let redAlerts: RedAlertSummary[] | null = null;
  if (options.redAlerts) {
    const raw = readJson(options.redAlerts, "--red-alerts").alerts;
    if (!Array.isArray(raw)) throw validationError("--red-alerts must hold an `alerts` array");
    redAlerts = raw as RedAlertSummary[];
  } else {
    try {
      const { workspacePath } = resolveReadyWorkspace(options.workspace);
      redAlerts = adaptRedAlerts(withReadOnlyDatabase(workspacePath, db => listOpenRedAlerts(db)));
    } catch (error) {
      liveErrors.redAlerts = error instanceof Error ? error.constructor.name : "UnknownError";
      gaps.push(`Live red-alert read failed (${liveErrors.redAlerts}); open alerts are reported as unknown.`);
    }
  }

  let headSha: string | null = null;
  try {
    headSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { /* no git: the state hash still pins the card */ }

  if (options.project !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.project)) {
    throw usageError(`--project must be a lowercase slug, got ${JSON.stringify(options.project)}`);
  }
  const now = options.now ?? new Date();
  const selection = selectNextPlan({
    preferences, plans, queues, queueGlobal, liveErrors, closeOuts, redAlerts,
    currentRunId: options.runId ?? null,
    currentSessionId: options.sessionId ?? process.env.ARCADIA_SESSION_ID ?? null,
    currentRunAsks: (options.runAsk ?? "").split(",").map(value => value.trim()).filter(value => value !== ""),
    onlyProject: options.project ?? null,
    headSha,
    now: now.toISOString(),
    expires: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  });
  return createSuccess({ command: "plan.select-next", data: { ...selection, gaps }, artifacts: [] });
}

export function renderPlanSelectNextSuccess(response: CommandSuccess<PlanSelectNextData>): string[] {
  const data = response.data;
  return [
    data.chosen ? `Next Plan: ${data.chosen.plan} (${data.chosen.project}); preview only, nothing was activated` : "No next Plan can be chosen; preview only",
    ...data.reasons.map(reason => `  reason: ${reason}`),
    ...data.refusals.map(refusal => `  refused ${refusal.code}${refusal.plan ? ` [${refusal.plan}]` : ""}: ${refusal.message}`),
    ...data.preflight.map(check => `  preflight ${check.check}: ${check.status}${check.blocker ? ` - ${check.blocker} Remedy: ${check.remedy}` : ""}`),
    data.card ? `Card ${data.card.id} (${data.card.verb}), state ${data.stateHash}` : `Card invalid: ${data.cardErrors.join("; ")}`,
    ...data.gaps.map(gap => `  gap: ${gap}`)
  ];
}
