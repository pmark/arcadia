import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { ObservedCodexTaskInput } from "../domain/types.js";

export interface CodexObservationOptions {
  codexHome?: string;
  includeCloud?: boolean;
  includeLocalGoals?: boolean;
}

export function observeCodexTasks(options: CodexObservationOptions = {}): ObservedCodexTaskInput[] {
  return [
    ...(options.includeLocalGoals === false ? [] : observeLocalGoals(options.codexHome)),
    ...(options.includeCloud === false ? [] : observeCloudTasks())
  ];
}

function observeCloudTasks(): ObservedCodexTaskInput[] {
  const fixture = process.env.ARCADIA_CODEX_CLOUD_FIXTURE;
  if (fixture) {
    return parseCloudTasks(JSON.parse(fixture));
  }

  try {
    const stdout = execFileSync("codex", ["cloud", "list", "--json", "--limit", "20"], {
      encoding: "utf8",
      cwd: os.tmpdir(),
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024
    });
    return parseCloudTasks(JSON.parse(stdout));
  } catch {
    return [];
  }
}

function parseCloudTasks(raw: unknown): ObservedCodexTaskInput[] {
  const tasks = raw && typeof raw === "object" && "tasks" in raw ? (raw as { tasks?: unknown }).tasks : [];
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.flatMap((task): ObservedCodexTaskInput[] => {
    if (!task || typeof task !== "object") {
      return [];
    }
    const record = task as Record<string, unknown>;
    const id = stringValue(record.id);
    if (!id) {
      return [];
    }
    const title = stringValue(record.title) || stringValue(record.summary) || "Codex cloud task";
    return [{
      source: "cloud_task",
      sourceTaskId: id,
      title,
      status: stringValue(record.status) || "unknown",
      url: stringValue(record.url),
      summary: stringValue(record.summary),
      codexUpdatedAt: stringValue(record.updated_at)
    }];
  });
}

function observeLocalGoals(codexHome = process.env.ARCADIA_CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")): ObservedCodexTaskInput[] {
  const goalsPath = path.join(codexHome, "goals_1.sqlite");
  const statePath = path.join(codexHome, "state_5.sqlite");
  if (!existsSync(goalsPath)) {
    return [];
  }

  const db = new Database(goalsPath, { readonly: true, fileMustExist: true });
  try {
    if (existsSync(statePath)) {
      db.exec(`ATTACH DATABASE '${statePath.replaceAll("'", "''")}' AS codex_state`);
    }
    const hasState = existsSync(statePath);
    const rows = db.prepare(
      hasState
        ? `SELECT
             tg.thread_id,
             tg.objective,
             tg.status,
             tg.updated_at_ms,
             t.title,
             t.cwd
           FROM thread_goals tg
           LEFT JOIN codex_state.threads t ON t.id = tg.thread_id
           WHERE tg.status IN ('active', 'blocked', 'usage_limited', 'budget_limited', 'complete')
           ORDER BY tg.updated_at_ms DESC`
        : `SELECT
             tg.thread_id,
             tg.objective,
             tg.status,
             tg.updated_at_ms,
             NULL AS title,
             NULL AS cwd
           FROM thread_goals tg
           WHERE tg.status IN ('active', 'blocked', 'usage_limited', 'budget_limited', 'complete')
           ORDER BY tg.updated_at_ms DESC`
    ).all() as Array<{
      thread_id: string;
      objective: string;
      status: string;
      updated_at_ms: number;
      title: string | null;
      cwd: string | null;
    }>;

    return rows.map((row) => ({
      source: "local_goal",
      sourceTaskId: row.thread_id,
      title: row.title?.trim() || firstLine(row.objective) || "Codex local goal",
      status: row.status,
      url: null,
      summary: [row.objective, row.cwd ? `Workspace: ${row.cwd}` : ""].filter(Boolean).join("\n"),
      codexUpdatedAt: new Date(row.updated_at_ms).toISOString()
    }));
  } finally {
    db.close();
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim().slice(0, 120) ?? "";
}
