import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getProjectMetadata } from "../db/repositories.js";
import { listOperatorInteractions } from "../operatorInteractions/store.js";
import { OPERATOR_RUNS_DIR } from "../timeline/collectors/operatorScripts.js";
import type { DigestOperatorInteraction, DigestOperatorInteractions, DigestScope, DigestWindow } from "./types.js";

/**
 * How many times the operator had to act to keep work moving.
 *
 * Only what a record proves is counted:
 *
 * - an operator press of a /actions card, from its run receipt. A receipt
 *   carrying a delegation block is Rowan's delegated press, not the
 *   operator's; a preflight is a check, not a press;
 * - an Off the operator switched from the dashboard, from its policy receipt;
 * - an interaction an agent recorded with `arcadia operator-interaction
 *   record` when it acted on the operator's words in chat.
 *
 * GitHub merges are never counted from GitHub: every merge uses the operator's
 * token, so GitHub cannot tell an operator merge from an agent merge. A merge
 * the operator asked for in chat is counted when the agent records it.
 */

export const INTERACTION_LIMITATIONS = [
  "Counts operator card presses (run receipts), dashboard Offs (policy receipts) and interactions agents recorded from the operator's words.",
  "GitHub merges are not counted from GitHub (all use the operator's token); Decision answers and acted-on pings are counted only when an agent records them.",
  "A Project's own digest counts only presses and recorded interactions that name that Project; the portfolio digest counts every one, including dashboard Offs.",
  "Waiting time sums recorded waits and the in-window time of Actions still stopped on the operator; a resolved stop leaves no record, so the figure can undercount."
];

interface Receipt {
  schema?: unknown;
  id?: unknown;
  runId?: unknown;
  mode?: unknown;
  outcome?: unknown;
  status?: unknown;
  reason?: unknown;
  message?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  record?: {
    project?: unknown;
    plan?: unknown;
    actionIds?: unknown;
    windowClosesAt?: unknown;
    delegation?: unknown;
    authority?: unknown;
  };
}

export function gatherOperatorInteractions(input: {
  db: Database.Database;
  scope: DigestScope;
  projects: Array<{ id: string; slug: string }>;
  window: DigestWindow;
  now: Date;
  merged: number;
}): DigestOperatorInteractions {
  const { db, scope, projects, window, now } = input;
  const slugs = new Set(projects.map((project) => project.slug.toLowerCase()));
  const inScope = (project: string | null): boolean =>
    scope === "portfolio" ? true : project !== null && slugs.has(project.toLowerCase());

  const items: DigestOperatorInteraction[] = [
    ...cardPresses(db, projects, window),
    ...(scope === "portfolio" ? dashboardOffs(db, window) : []),
    ...listOperatorInteractions(db, window).map((row): DigestOperatorInteraction => ({
      at: row.at,
      source: "recorded",
      project: row.project,
      what: `"${row.words}"`,
      unlocked: row.unlocked,
      necessity: row.necessity,
      ref: row.ref,
      waitedMinutes: row.waitingSince ? Math.max(0, Math.round((Date.parse(row.at) - Date.parse(row.waitingSince)) / 60_000)) : null
    }))
  ].filter((item) => inScope(item.project))
    .sort((a, b) => a.at.localeCompare(b.at));

  const recordedWait = items.reduce((sum, item) => sum + (item.waitedMinutes ?? 0), 0);
  const stoppedWait = stoppedMinutes(db, projects, window, now);
  const required = items.filter((item) => item.necessity === "required").length;
  const avoidable = items.filter((item) => item.necessity === "avoidable").length;
  return {
    count: items.length,
    required,
    avoidable,
    perMerged: input.merged > 0 ? Math.round((items.length / input.merged) * 10) / 10 : null,
    waitedMinutes: recordedWait + stoppedWait,
    items,
    limitations: INTERACTION_LIMITATIONS
  };
}

/** Operator presses in the window, from every in-scope Project checkout's /runs receipts. */
function cardPresses(db: Database.Database, projects: Array<{ id: string; slug: string }>, window: DigestWindow): DigestOperatorInteraction[] {
  const roots = new Set<string>();
  for (const project of projects) {
    const repo = getProjectMetadata(db, project.id)?.repo_path?.trim();
    if (repo) roots.add(path.resolve(repo, OPERATOR_RUNS_DIR));
  }
  const items: DigestOperatorInteraction[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const file of receiptFiles(root)) {
      let receipt: Receipt;
      try {
        receipt = JSON.parse(readFileSync(file, "utf8")) as Receipt;
      } catch {
        continue;
      }
      const item = pressFromReceipt(receipt);
      if (!item || item.at < window.start || item.at >= window.end) continue;
      const key = `${String(receipt.id)}:${String(receipt.runId ?? file)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

/** `<runs>/<run>/receipt.json` and `<runs>/<card>/<run>/receipt.json`, the two layouts the runner writes. */
function receiptFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const isFile = (file: string): boolean => {
    try {
      return lstatSync(file).isFile();
    } catch {
      return false;
    }
  };
  const isDirectory = (dir: string): boolean => {
    try {
      return lstatSync(dir).isDirectory();
    } catch {
      return false;
    }
  };
  for (const entry of readdirSync(root)) {
    const dir = path.join(root, entry);
    if (!isDirectory(dir)) continue;
    const direct = path.join(dir, "receipt.json");
    if (isFile(direct)) {
      files.push(direct);
      continue;
    }
    for (const run of readdirSync(dir)) {
      const nested = path.join(dir, run, "receipt.json");
      if (isFile(nested)) files.push(nested);
    }
  }
  return files;
}

const PRESS_SCHEMAS = new Set([
  "arcadia-start-run-receipt-v1",
  "arcadia-day-grant-receipt-v1",
  "arcadia-operator-run-receipt-v1",
  "arcadia-plan-amendment-receipt-v1"
]);

/** One operator press, or null for a preflight, a delegated press, or a receipt that is not a press. */
export function pressFromReceipt(receipt: Receipt): DigestOperatorInteraction | null {
  const schema = str(receipt.schema);
  if (!schema || !PRESS_SCHEMAS.has(schema)) return null;
  if (str(receipt.mode) === "preflight") return null;
  const record = receipt.record && typeof receipt.record === "object" ? receipt.record : {};
  // Rowan's delegated press under a day grant names its delegation; it is not the operator acting.
  if (record.delegation || /^Rowan/i.test(str(record.authority) ?? "")) return null;
  const at = iso(str(receipt.startedAt) ?? str(receipt.finishedAt));
  if (!at) return null;
  const outcome = str(receipt.outcome) ?? str(receipt.status) ?? "unknown";
  const refused = outcome === "refused" || outcome === "failed";
  const card = str(receipt.id) ?? "card";
  const plan = str(record.plan);
  const actions = Array.isArray(record.actionIds) ? record.actionIds.length : null;
  const unlocked = refused
    ? `nothing: the press was ${outcome}${str(receipt.reason) ? ` (${clip(str(receipt.reason)!, 80)})` : ""}`
    : schema === "arcadia-start-run-receipt-v1"
      ? `START${plan ? ` on ${plan}` : ""}${actions !== null ? ` for ${actions} Action${actions === 1 ? "" : "s"}` : ""}`
      : schema === "arcadia-day-grant-receipt-v1"
        ? `a day grant: Rowan may press START${plan ? ` on ${plan}` : ""}${str(record.windowClosesAt) ? ` until ${str(record.windowClosesAt)!.slice(5, 16).replace("T", " ")}Z` : ""}`
        : schema === "arcadia-plan-amendment-receipt-v1"
          ? clip(str(receipt.message) ?? "a Plan amendment", 100)
          : `operator script ${card}`;
  return {
    at,
    source: "card_press",
    project: str(record.project),
    what: `Pressed ${card}`,
    unlocked,
    // The runner executes only on the operator's own press: authority only the operator holds.
    // A press the runner refused unlocked nothing, so it was a touch that could have been avoided.
    necessity: refused ? "avoidable" : "required",
    ref: str(receipt.runId) ? `${card}/${str(receipt.runId)}` : card,
    waitedMinutes: null
  };
}

/** Offs the operator switched from the dashboard; Rowan's own Offs carry a `rowan-` request id. */
function dashboardOffs(db: Database.Database, window: DigestWindow): DigestOperatorInteraction[] {
  if (!hasTable(db, "production_policy_receipts")) return [];
  const rows = db.prepare(
    `SELECT request_id, created_at FROM production_policy_receipts
     WHERE transition = 'deactivate' AND request_id LIKE 'dashboard-%' AND created_at >= ? AND created_at < ?`
  ).all(window.start, window.end) as Array<{ request_id: string; created_at: string }>;
  return rows.map((row) => ({
    at: row.created_at,
    source: "production_off" as const,
    project: null,
    what: "Switched production Off from the dashboard",
    unlocked: "production Off",
    necessity: "required" as const,
    ref: row.request_id,
    waitedMinutes: null
  }));
}

/** In-window minutes of Actions currently stopped on the operator (one current escalation per Action is all the table keeps). */
function stoppedMinutes(db: Database.Database, projects: Array<{ slug: string }>, window: DigestWindow, now: Date): number {
  if (!hasTable(db, "production_operator_escalations") || projects.length === 0) return 0;
  const rows = db.prepare(
    "SELECT action_key, first_detected_at FROM production_operator_escalations"
  ).all() as Array<{ action_key: string; first_detected_at: string }>;
  const slugs = new Set(projects.map((project) => `${project.slug.toLowerCase()}/`));
  const start = Date.parse(window.start);
  const end = Math.min(Date.parse(window.end), now.getTime());
  let minutes = 0;
  for (const row of rows) {
    const prefix = row.action_key.slice(0, row.action_key.indexOf("/") + 1).toLowerCase();
    if (!slugs.has(prefix)) continue;
    const from = Math.max(start, Date.parse(row.first_detected_at));
    // The row exists only while the Action is still stopped, so the wait runs to the window's end (or now).
    if (Number.isFinite(from) && end > from) minutes += (end - from) / 60_000;
  }
  return Math.round(minutes);
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function iso(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
