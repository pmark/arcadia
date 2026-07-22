import { openDatabase } from "../db/connection.js";
import { resolveWorkspace } from "../workspace/resolve.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { existsSync } from "node:fs";
import { recordActivityEvent } from "./repository.js";
import { ACTIVITY_SURFACES, type ActivitySurface } from "./types.js";

/**
 * Records one interaction moment. Called from the single CLI choke point, so
 * it covers every surface for free: the dashboard and the Discord bot both
 * reach Arcadia by shelling out to this same CLI.
 *
 * Absolutely never allowed to fail a command. Losing a telemetry row is
 * nothing; breaking `orientation reply` because the log write hiccuped would
 * be a self-inflicted outage on the operator's most-used path.
 */
export function recordCliActivity(input: {
  command: string;
  workspace?: string;
  outcome: "ok" | "error";
  durationMs: number;
  /** The command's response payload, inspected only for an obvious subject. */
  data?: unknown;
}): void {
  try {
    const resolved = resolveWorkspace({ workspace: input.workspace });
    if (!resolved.workspacePath) {
      return;
    }
    const databasePath = getWorkspacePaths(resolved.workspacePath).databaseFile;
    if (!existsSync(databasePath)) {
      return;
    }

    const db = openDatabase(resolved.workspacePath);
    try {
      const subject = subjectOf(input.data);
      recordActivityEvent(db, {
        occurredAt: new Date().toISOString(),
        surface: currentSurface(),
        command: input.command,
        focus: subject.focus,
        entryId: subject.entryId,
        projectId: subject.projectId,
        outcome: input.outcome,
        durationMs: Math.round(input.durationMs)
      });
    } finally {
      db.close();
    }
  } catch {
    // Deliberately silent: see the note above.
  }
}

/**
 * Which surface the operator is actually touching. The dashboard and the
 * Discord bot set ARCADIA_SURFACE when they shell out; long-running pollers
 * set "automation" so their traffic never masquerades as engagement.
 */
export function currentSurface(env: NodeJS.ProcessEnv = process.env): ActivitySurface {
  const declared = env.ARCADIA_SURFACE?.trim().toLowerCase();
  return (ACTIVITY_SURFACES as readonly string[]).includes(declared ?? "")
    ? (declared as ActivitySurface)
    : "cli";
}

interface Subject {
  focus: string | null;
  entryId: string | null;
  projectId: string | null;
}

const EMPTY_SUBJECT: Subject = { focus: null, entryId: null, projectId: null };

/**
 * Best-effort "what was this about", read from shapes the commands already
 * return. Deliberately shallow and defensive rather than wired command by
 * command: an unrecognized shape yields no subject, which costs a little
 * detail in the report and nothing else.
 */
function subjectOf(data: unknown): Subject {
  if (!data || typeof data !== "object") {
    return EMPTY_SUBJECT;
  }
  const record = data as Record<string, unknown>;

  const entry = asRecord(record.entry);
  if (entry) {
    return { focus: asString(entry.title), entryId: asString(entry.id), projectId: asString(entry.projectId) };
  }

  const touched = Array.isArray(record.touchedEntries) ? record.touchedEntries : null;
  if (touched && touched.length > 0) {
    const first = asRecord(touched[0]);
    if (first) {
      return {
        focus:
          touched.length === 1
            ? asString(first.title)
            : `${asString(first.title) ?? "several items"} +${touched.length - 1}`,
        entryId: touched.length === 1 ? asString(first.id) : null,
        projectId: null
      };
    }
  }

  const project = asRecord(record.project);
  if (project) {
    return { focus: asString(project.name), entryId: null, projectId: asString(project.id) };
  }

  const node = asString(record.label);
  if (node) {
    return { focus: node, entryId: null, projectId: null };
  }

  return EMPTY_SUBJECT;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
