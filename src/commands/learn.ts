import { createHash } from "node:crypto";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase, writeTransaction } from "../db/connection.js";
import { invocationRoot } from "../cli/invocation.js";
import { tryGit } from "../git/worktrees.js";
import {
  captureLesson, correctLesson, getLesson, LESSON_CONFIDENCE, LESSON_FRESHNESS,
  LESSON_PROVENANCE, noteEntries, noteEntryRanges, normalizeLessonScope, restoreLessonGraph, searchLessons, type CaptureLessonInput,
  type Lesson
} from "../learning/lessons.js";

export interface LearnCaptureOptions extends CaptureLessonInput { workspace: string; }
export interface LearnSearchOptions { workspace: string; query: string; scope?: string; }
export interface LearnShowOptions { workspace: string; id: string; scope?: string; }
export interface LearnCorrectOptions extends CaptureLessonInput { workspace: string; id: string; retract?: boolean; }
export interface LearnImportOptions { workspace: string; markdown: string; scope?: string; revision?: string | null; sourceRef?: string | null; }
export interface LearnExport { schema: "arcadia-lessons-v1"; lessons: Lesson[]; }
export interface LearnCacheMaintainOptions extends LearnImportOptions { evictId?: string; }
export interface LearnHistorySnapshot { revision: string; markdown: string; sourceRef: string; }

function enumValue<T extends readonly string[]>(label: string, value: string | undefined, allowed: T): T[number] | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw validationError(`${label} is invalid.`, { value, allowed });
  return value;
}
export function runLearnCaptureCommand(options: LearnCaptureOptions): CommandSuccess<{ lesson: Lesson; created: boolean; duplicateCandidates: Lesson[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const result = withDatabase(workspacePath, (db) => writeTransaction(db, () => captureLesson(db, {
    ...options,
    revision: options.revision ?? captureRevision(),
    sourceRef: options.sourceRef ?? invocationRoot(),
    provenance: enumValue("Lesson provenance", options.provenance, LESSON_PROVENANCE),
    confidence: enumValue("Lesson confidence", options.confidence, LESSON_CONFIDENCE),
    freshness: enumValue("Lesson freshness", options.freshness, LESSON_FRESHNESS)
  })));
  return createSuccess({ command: "learn.capture", workspace: workspacePath, data: result });
}
export function runLearnSearchCommand(options: LearnSearchOptions): CommandSuccess<{ lessons: Lesson[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const scope = normalizeLessonScope(options.scope);
  return createSuccess({ command: "learn.search", workspace: workspacePath, data: { lessons: withReadOnlyDatabase(workspacePath, (db) => searchLessons(db, options.query, scope)) } });
}
export function runLearnShowCommand(options: LearnShowOptions): CommandSuccess<{ lesson: Lesson }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const lesson = withReadOnlyDatabase(workspacePath, (db) => getLesson(db, options.id));
  if (!lesson) throw validationError("Lesson was not found.", { id: options.id });
  if (lesson.scope_key !== normalizeLessonScope(options.scope)) throw validationError("Lesson is outside the requested scope.", { id: options.id });
  return createSuccess({ command: "learn.show", workspace: workspacePath, data: { lesson } });
}
export function runLearnCorrectCommand(options: LearnCorrectOptions): CommandSuccess<{ lesson: Lesson }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const scope = normalizeLessonScope(options.scope);
  const lesson = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
    const existing = getLesson(db, options.id, false);
    if (!existing || existing.scope_key !== scope) throw validationError("Lesson was not found in the requested scope.", { id: options.id, scope });
    return correctLesson(db, options.id, {
    ...options,
    revision: options.revision ?? captureRevision(),
    sourceRef: options.sourceRef ?? invocationRoot(),
    provenance: enumValue("Lesson provenance", options.provenance, LESSON_PROVENANCE),
    confidence: enumValue("Lesson confidence", options.confidence, LESSON_CONFIDENCE),
    freshness: enumValue("Lesson freshness", options.freshness, LESSON_FRESHNESS)
    }, Boolean(options.retract));
  }));
  return createSuccess({ command: options.retract ? "learn.retract" : "learn.correct", workspace: workspacePath, data: { lesson } });
}
/** Imports every entry before cache maintenance can remove one. Text is kept byte-for-byte. */
export function runLearnImportNotesCommand(options: LearnImportOptions): CommandSuccess<{ imported: number; lessonIds: string[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const scope = normalizeLessonScope(options.scope);
  const entries = noteEntries(options.markdown);
  const result = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
    const captured = entries.map((text) => captureLesson(db, {
      text,
      scope,
      provenance: "imported",
      confidence: "high",
      // Imported cache/history text is evidence, never silently current advice.
      freshness: "stale",
      revision: options.revision,
      sourceRef: options.sourceRef
    }));
    return { imported: captured.filter((entry) => entry.created).length, lessonIds: captured.map((entry) => entry.lesson.id) };
  }));
  return createSuccess({ command: "learn.import-notes", workspace: workspacePath, data: result });
}
/** Bounded file-history migration; callers provide only verified available snapshots. */
export function runLearnImportHistoryCommand(options: { workspace: string; scope?: string; snapshots: LearnHistorySnapshot[]; shallow: boolean; unavailableRevisions?: string[] }): CommandSuccess<{ imported: number; snapshots: number; shallowGap: boolean; unavailableRevisions: string[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const scope = normalizeLessonScope(options.scope);
  const result = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
    let imported = 0;
    for (const snapshot of options.snapshots) {
      for (const text of noteEntries(snapshot.markdown)) {
        if (captureLesson(db, { text, scope, provenance: "imported", confidence: "high", freshness: "stale", revision: snapshot.revision, sourceRef: snapshot.sourceRef }).created) imported += 1;
      }
    }
    return { imported, snapshots: options.snapshots.length, shallowGap: options.shallow, unavailableRevisions: options.unavailableRevisions ?? [] };
  }));
  return createSuccess({ command: "learn.import-history", workspace: workspacePath, data: result, warnings: [
    ...(result.shallowGap ? ["Git history is shallow; unavailable parent history was not recovered."] : []),
    ...(result.unavailableRevisions.length ? [`${result.unavailableRevisions.length} Notes revisions were unavailable and were not recovered.`] : [])
  ] });
}
export function runLearnExportCommand(options: { workspace: string; scope?: string }): CommandSuccess<LearnExport> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const scope = normalizeLessonScope(options.scope);
  const lessons = withReadOnlyDatabase(workspacePath, (db) => {
    const ids = (db.prepare("SELECT id FROM lessons WHERE scope_key = ? ORDER BY created_at").all(scope) as Array<{ id: string }>).map((row) => row.id);
    return ids.map((id) => getLesson(db, id, true)!);
  });
  return createSuccess({ command: "learn.export", workspace: workspacePath, data: { schema: "arcadia-lessons-v1", lessons } });
}
/**
 * Imports all current cache entries before considering a named eviction. It
 * never guesses which friction is safe to drop: a stable lesson id is required.
 */
export function runLearnCacheMaintainCommand(options: LearnCacheMaintainOptions): CommandSuccess<{ imported: number; entryCount: number; evictedId: string | null; updatedMarkdown: string | null }> {
  const entries = noteEntries(options.markdown);
  const ranges = noteEntryRanges(options.markdown);
  if (!entries.length) throw validationError("Notes file has no importable `##` entries; cache maintenance made no change.", {});
  const imported = runLearnImportNotesCommand(options).data;
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (!options.evictId) return createSuccess({ command: "learn.cache-maintain", workspace: workspacePath, data: { imported: imported.imported, entryCount: entries.length, evictedId: null, updatedMarkdown: null } });
  const evictId = options.evictId;
  const result = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
    const lesson = getLesson(db, evictId, true);
    if (!lesson || lesson.scope_key !== normalizeLessonScope(options.scope) || !lesson.current) throw validationError("Eviction lesson was not found in this scope.", { id: evictId });
    const current = lesson.current;
    const index = ranges.findIndex((entry) => entry.text === current.text);
    if (index < 0) throw validationError("Eviction lesson does not match an exact current Notes entry; cache was left untouched.", { id: options.evictId });
    const receiptExists = db.prepare("SELECT receipt_json FROM lesson_receipts WHERE lesson_id = ? AND receipt_json LIKE ?").get(lesson.id, `%${current.text_hash}%`);
    if (!receiptExists) throw validationError("No exact-content retention receipt exists; cache was left untouched.", { id: options.evictId });
    return ranges[index];
  }));
  return createSuccess({ command: "learn.cache-maintain", workspace: workspacePath, data: { imported: imported.imported, entryCount: entries.length, evictedId: evictId, updatedMarkdown: options.markdown.slice(0, result.start) + options.markdown.slice(result.end) } });
}
/** Restore only validates the documented export envelope; no paths are interpreted from it. */
export function runLearnRestoreCommand(options: { workspace: string; scope?: string; payload: LearnExport }): CommandSuccess<{ restored: number }> {
  if (options.payload?.schema !== "arcadia-lessons-v1" || !Array.isArray(options.payload.lessons)) throw validationError("Lesson import payload is invalid.", {});
  const scope = normalizeLessonScope(options.scope);
  if (options.payload.lessons.some((lesson) => lesson.scope_key !== scope)) throw validationError("Lesson restore payload contains a different scope; no lessons were restored.", { scope });
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const result = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
    let restored = 0;
    for (const lesson of options.payload.lessons) {
      restoreLessonGraph(db, lesson);
      restored += 1;
    }
    return { restored };
  }));
  return createSuccess({ command: "learn.restore", workspace: workspacePath, data: result });
}
export function renderLearnCaptureSuccess(response: CommandSuccess<{ lesson: Lesson; created: boolean; duplicateCandidates: Lesson[] }>): string[] {
  const { lesson, created, duplicateCandidates } = response.data;
  return [created ? "Arcadia lesson captured." : "Arcadia lesson already captured — evidence merged.", `ID: ${lesson.id}`, `Scope: ${lesson.scope_key}`, `Versions: ${lesson.versions?.length ?? 1}`, ...(duplicateCandidates.length ? [`Likely related lessons: ${duplicateCandidates.map((item) => item.id).join(", ")}`] : [])];
}
export function renderLearnSearchSuccess(response: CommandSuccess<{ lessons: Lesson[] }>): string[] {
  return ["Arcadia lessons", `Matches: ${response.data.lessons.length}`, ...response.data.lessons.map((lesson) => `- ${lesson.id} [${lesson.versions?.map((version) => `${version.freshness}/${version.provenance_kind}`).join(", ") ?? "unknown"}]: ${lesson.current?.text ?? "(no current version)"}`)];
}
export function renderLearnShowSuccess(response: CommandSuccess<{ lesson: Lesson }>): string[] {
  const { lesson } = response.data;
  return ["Arcadia lesson", `ID: ${lesson.id}`, `Scope: ${lesson.scope_key}`, ...(lesson.versions ?? []).flatMap((version) => [`Version ${version.version} (${version.freshness}, ${version.provenance_kind}):`, version.text, ...version.evidence.map((entry) => `Evidence: ${entry}`)])];
}
export function renderLearnImportSuccess(response: CommandSuccess<{ imported: number; lessonIds: string[] }>): string[] { return [`Imported: ${response.data.imported}`, `Lessons: ${response.data.lessonIds.length}`]; }
export function renderLearnRestoreSuccess(response: CommandSuccess<{ restored: number }>): string[] { return [`Restored: ${response.data.restored}`]; }
export function serializedLessonExport(data: LearnExport): string { return JSON.stringify(data, null, 2); }
export function lessonPayloadHash(payload: string): string { return createHash("sha256").update(payload).digest("hex"); }
function captureRevision(): string | null { return tryGit(invocationRoot(), ["rev-parse", "HEAD"])?.trim() || null; }
