import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { createBackBurnerItem } from "../db/repositories.js";
import { LIKELY_DUPLICATE_THRESHOLD, normalizeEvidence, summarySimilarity } from "../defect/signal.js";

export const LESSON_PROVENANCE = ["operator_statement", "observation", "inference", "imported"] as const;
export const LESSON_FRESHNESS = ["current", "stale", "retracted", "superseded"] as const;
export const LESSON_CONFIDENCE = ["high", "medium", "low"] as const;
export type LessonProvenance = (typeof LESSON_PROVENANCE)[number];
export type LessonFreshness = (typeof LESSON_FRESHNESS)[number];
export type LessonConfidence = (typeof LESSON_CONFIDENCE)[number];

export interface LessonVersion {
  id: string;
  lesson_id: string;
  version: number;
  text: string;
  text_hash: string;
  keywords: string[];
  provenance_kind: LessonProvenance;
  confidence: LessonConfidence;
  freshness: LessonFreshness;
  repository_revision: string | null;
  source_ref: string | null;
  supersedes_version_id: string | null;
  created_at: string;
  evidence: string[];
  observations: Array<{ repository_revision: string | null; source_ref: string | null; observed_at: string }>;
}
export interface Lesson {
  id: string;
  scope_key: string;
  fingerprint: string;
  back_burner_item_id: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  current: LessonVersion | null;
  versions?: LessonVersion[];
}

export interface CaptureLessonInput {
  text: string;
  scope?: string;
  provenance?: LessonProvenance;
  confidence?: LessonConfidence;
  freshness?: LessonFreshness;
  evidence?: string[];
  revision?: string | null;
  sourceRef?: string | null;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
export const exactTextHash = hash;

/** Scope is an identifier, never a filesystem path. */
export function normalizeLessonScope(scope: string | undefined): string {
  if (scope === undefined) throw validationError("A lesson scope is required; use `arcadia` or `project:<slug>`.", {});
  const value = scope.trim();
  if (value === "arcadia") return value;
  if (!/^project:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes("..")) {
    throw validationError("Lesson scope must be `arcadia` or `project:<slug>`; paths and unscoped buckets are refused.", { scope });
  }
  return value;
}
function allowed<T extends readonly string[]>(label: string, value: string, values: T): T[number] {
  if (!values.includes(value)) throw validationError(`${label} is invalid.`, { value, allowed: values });
  return value;
}
function requiredText(text: string): string {
  if (!text || !text.trim()) throw validationError("A lesson must contain non-whitespace text.", {});
  return text;
}
export function lessonKeywords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3))].slice(0, 32);
}
function evidence(db: Database.Database, versionId: string): string[] {
  return (db.prepare("SELECT evidence FROM lesson_evidence WHERE lesson_version_id = ? ORDER BY created_at, id").all(versionId) as Array<{ evidence: string }>).map((row) => row.evidence);
}
function hydrateVersion(db: Database.Database, row: Omit<LessonVersion, "keywords" | "evidence"> & { keywords_json: string }): LessonVersion {
  const observations = db.prepare("SELECT repository_revision, source_ref, observed_at FROM lesson_observations WHERE lesson_version_id = ? ORDER BY observed_at, id").all(row.id) as LessonVersion["observations"];
  return { ...row, keywords: JSON.parse(row.keywords_json), evidence: evidence(db, row.id), observations };
}
function getVersion(db: Database.Database, id: string): LessonVersion | null {
  const row = db.prepare("SELECT * FROM lesson_versions WHERE id = ?").get(id) as (Omit<LessonVersion, "keywords" | "evidence"> & { keywords_json: string }) | undefined;
  return row ? hydrateVersion(db, row) : null;
}
export function getLesson(db: Database.Database, id: string, includeVersions = true): Lesson | null {
  const row = db.prepare("SELECT * FROM lessons WHERE id = ?").get(id) as Omit<Lesson, "current" | "versions"> | undefined;
  if (!row) return null;
  const lesson: Lesson = { ...row, current: row.current_version_id ? getVersion(db, row.current_version_id) : null };
  if (includeVersions) lesson.versions = (db.prepare("SELECT * FROM lesson_versions WHERE lesson_id = ? ORDER BY version DESC").all(id) as Array<Omit<LessonVersion, "keywords" | "evidence"> & { keywords_json: string }>).map((entry) => hydrateVersion(db, entry));
  return lesson;
}
function insertEvidence(db: Database.Database, versionId: string, entries: readonly string[]): void {
  const insert = db.prepare("INSERT OR IGNORE INTO lesson_evidence (id, lesson_version_id, evidence, evidence_hash, created_at) VALUES (?, ?, ?, ?, ?)");
  for (const value of normalizeEvidence(entries)) insert.run(`lessonEvidence_${randomUUID()}`, versionId, value, hash(value), now());
}
function recordObservation(db: Database.Database, versionId: string, revision: string | null | undefined, sourceRef: string | null | undefined, observedAt = now()): void {
  if (revision === undefined && sourceRef === undefined) return;
  db.prepare("INSERT OR IGNORE INTO lesson_observations (id, lesson_version_id, repository_revision, source_ref, observed_at) VALUES (?, ?, ?, ?, ?)")
    .run(`lessonObservation_${randomUUID()}`, versionId, revision ?? null, sourceRef ?? null, observedAt);
}
function receipt(
  db: Database.Database,
  lesson: Lesson,
  operation: "capture" | "correct" | "import" | "restore" | "cache-maintain",
  fingerprint: string,
  contentVersion: LessonVersion | null = lesson.current
): void {
  db.prepare("INSERT OR IGNORE INTO lesson_receipts (id, lesson_id, request_fingerprint, operation, receipt_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`lessonReceipt_${randomUUID()}`, lesson.id, fingerprint, operation, JSON.stringify({
      lessonId: lesson.id,
      operation,
      versionId: contentVersion?.id ?? null,
      exactTextHash: contentVersion?.text_hash ?? null
    }), now());
}

/** Exact bytes, scope, and no inferred identity: retries are stable and safe. */
export function captureLesson(db: Database.Database, input: CaptureLessonInput): { lesson: Lesson; created: boolean; duplicateCandidates: Lesson[] } {
  const text = requiredText(input.text);
  const scope = normalizeLessonScope(input.scope);
  const provenance = allowed("Lesson provenance", input.provenance ?? "observation", LESSON_PROVENANCE);
  const confidence = allowed("Lesson confidence", input.confidence ?? "high", LESSON_CONFIDENCE);
  const freshness = allowed("Lesson freshness", input.freshness ?? "current", LESSON_FRESHNESS);
  const fingerprint = hash(JSON.stringify({ scope, text }));
  const existingRow = db.prepare("SELECT id FROM lessons WHERE scope_key = ? AND fingerprint = ?").get(scope, fingerprint) as { id: string } | undefined;
  if (existingRow) {
    const existing = getLesson(db, existingRow.id)!;
    const observed = db.prepare("SELECT id FROM lesson_versions WHERE lesson_id = ? AND text_hash = ? ORDER BY version DESC LIMIT 1").get(existing.id, hash(text)) as { id: string } | undefined;
    const observedVersion = observed ? getVersion(db, observed.id) : existing.current;
    if (observedVersion) {
      insertEvidence(db, observedVersion.id, input.evidence ?? []);
      recordObservation(db, observedVersion.id, input.revision, input.sourceRef);
    }
    const updated = getLesson(db, existing.id)!;
    receipt(db, updated, "capture", hash(JSON.stringify({ operation: "capture", scope, text })), observedVersion);
    return { lesson: updated, created: false, duplicateCandidates: likelyDuplicates(db, scope, text, updated.id) };
  }
  const createdAt = now();
  const id = `lesson_${fingerprint.slice(0, 20)}`;
  const backBurner = createBackBurnerItem(db, {
    originalInput: text, ingressSource: "cli.learn", classification: "IncubatingThought", confidence: 1,
    reason: "Captured as a durable lesson through `arcadia learn`.",
    suggestedNextStep: "Search or correct this lesson before acting on it."
  });
  db.prepare("INSERT INTO lessons (id, scope_key, fingerprint, back_burner_item_id, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)")
    .run(id, scope, fingerprint, backBurner.id, createdAt, createdAt);
  const versionId = `lessonVersion_${randomUUID()}`;
  db.prepare(`INSERT INTO lesson_versions (id, lesson_id, version, text, text_hash, keywords_json, provenance_kind, confidence, freshness, repository_revision, source_ref, supersedes_version_id, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
    .run(versionId, id, text, hash(text), JSON.stringify(lessonKeywords(text)), provenance, confidence, freshness, input.revision ?? null, input.sourceRef ?? null, createdAt);
  db.prepare("UPDATE lessons SET current_version_id = ?, updated_at = ? WHERE id = ?").run(versionId, createdAt, id);
  insertEvidence(db, versionId, input.evidence ?? []);
  recordObservation(db, versionId, input.revision, input.sourceRef, createdAt);
  const lesson = getLesson(db, id)!;
  receipt(db, lesson, "capture", hash(JSON.stringify({ operation: "capture", scope, text })));
  return { lesson, created: true, duplicateCandidates: likelyDuplicates(db, scope, text, id) };
}

export function correctLesson(db: Database.Database, id: string, input: CaptureLessonInput, retract = false): Lesson {
  const original = getLesson(db, id)!;
  if (!original.current) throw validationError("Lesson has no current version.", { id });
  const text = requiredText(input.text);
  const timestamp = now();
  const status: LessonFreshness = retract ? "retracted" : (input.freshness ?? "current");
  const oldStatus: LessonFreshness = retract ? "retracted" : "superseded";
  db.prepare("UPDATE lesson_versions SET freshness = ? WHERE id = ?").run(oldStatus, original.current.id);
  const versionId = `lessonVersion_${randomUUID()}`;
  db.prepare(`INSERT INTO lesson_versions (id, lesson_id, version, text, text_hash, keywords_json, provenance_kind, confidence, freshness, repository_revision, source_ref, supersedes_version_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(versionId, id, original.current.version + 1, text, hash(text), JSON.stringify(lessonKeywords(text)),
      allowed("Lesson provenance", input.provenance ?? "observation", LESSON_PROVENANCE),
      allowed("Lesson confidence", input.confidence ?? "high", LESSON_CONFIDENCE), status, input.revision ?? null, input.sourceRef ?? null, original.current.id, timestamp);
  insertEvidence(db, versionId, input.evidence ?? []);
  recordObservation(db, versionId, input.revision, input.sourceRef, timestamp);
  db.prepare("UPDATE lessons SET current_version_id = ?, updated_at = ? WHERE id = ?").run(versionId, timestamp, id);
  const updated = getLesson(db, id)!;
  receipt(db, updated, "correct", hash(JSON.stringify({ operation: "correct", id, text, retract })));
  return updated;
}

export function searchLessons(db: Database.Database, query: string, scope?: string): Lesson[] {
  const needle = query.trim().toLowerCase();
  if (!needle) throw validationError("A lesson search query is required.", {});
  const safeScope = scope === undefined ? undefined : normalizeLessonScope(scope);
  const rows = db.prepare("SELECT l.id FROM lessons l JOIN lesson_versions v ON v.lesson_id = l.id WHERE instr(lower(v.text), ?) > 0 AND (? IS NULL OR l.scope_key = ?) ORDER BY l.updated_at DESC")
    .all(needle, safeScope ?? null, safeScope ?? null) as Array<{ id: string }>;
  return [...new Set(rows.map((row) => row.id))].map((row) => getLesson(db, row, true)!);
}

/** Restores the complete exported version graph or refuses before a collision can overwrite it. */
export function restoreLessonGraph(db: Database.Database, lesson: Lesson): void {
  if (!lesson || typeof lesson.id !== "string" || typeof lesson.fingerprint !== "string" || typeof lesson.scope_key !== "string" || typeof lesson.current_version_id !== "string" || !isExportVersion(lesson.current) || !Array.isArray(lesson.versions) || lesson.versions.length === 0 || !lesson.versions.every(isExportVersion) || !/^lesson_[a-f0-9]{20}$/.test(lesson.id)) {
    throw validationError("Lesson export contains an invalid lesson graph.", { id: lesson?.id });
  }
  const scope = normalizeLessonScope(lesson.scope_key);
  if (lesson.id !== `lesson_${lesson.fingerprint.slice(0, 20)}`) throw validationError("Lesson export id does not match its fingerprint.", { id: lesson.id });
  const ordered = [...lesson.versions].sort((left, right) => left.version - right.version);
  const versionIds = new Set(ordered.map((version) => version.id));
  const numbers = new Set(ordered.map((version) => version.version));
  const currentInGraph = lesson.versions.find((version) => version.id === lesson.current_version_id);
  const contiguous = ordered.every((version, index) => version.version === index + 1);
  const chain = ordered.every((version, index) => index === 0
    ? version.supersedes_version_id === null
    : version.supersedes_version_id === ordered[index - 1].id);
  if (lesson.current_version_id !== lesson.current.id || !currentInGraph || currentInGraph.id !== ordered.at(-1)?.id || versionIds.size !== ordered.length || numbers.size !== ordered.length || !contiguous || !chain) {
    throw validationError("Lesson export has an invalid current-version pointer or version sequence.", { id: lesson.id });
  }
  if (hash(JSON.stringify({ scope, text: lesson.versions.find((version) => version.version === 1)?.text })) !== lesson.fingerprint) {
    throw validationError("Lesson export fingerprint does not match its canonical first version.", { id: lesson.id });
  }
  if (!sameVersion(currentInGraph, lesson.current)) {
    throw validationError("Lesson export current version does not match its retained graph version.", { id: lesson.id, versionId: lesson.current.id });
  }
  const conflict = db.prepare("SELECT id FROM lessons WHERE id = ? OR (scope_key = ? AND fingerprint = ?)").get(lesson.id, scope, lesson.fingerprint);
  if (conflict) throw validationError("Lesson restore conflicts with an existing retained lesson.", { id: lesson.id });
  for (const version of lesson.versions) {
    if (version.lesson_id !== lesson.id || exactTextHash(version.text) !== version.text_hash || !LESSON_PROVENANCE.includes(version.provenance_kind) || !LESSON_CONFIDENCE.includes(version.confidence) || !LESSON_FRESHNESS.includes(version.freshness) || (version.supersedes_version_id !== null && !versionIds.has(version.supersedes_version_id))) {
      throw validationError("Lesson export version failed exact-content validation.", { lessonId: lesson.id, versionId: version.id });
    }
  }
  const backBurner = createBackBurnerItem(db, {
    originalInput: lesson.current.text,
    ingressSource: "cli.learn.restore",
    classification: "IncubatingThought",
    confidence: 1,
    reason: "Restored durable lesson intake linkage.",
    suggestedNextStep: "Search or correct this lesson before acting on it."
  });
  db.prepare("INSERT INTO lessons (id, scope_key, fingerprint, back_burner_item_id, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(lesson.id, scope, lesson.fingerprint, backBurner.id, lesson.current_version_id, lesson.created_at, lesson.updated_at);
  for (const version of ordered) {
    db.prepare(`INSERT INTO lesson_versions (id, lesson_id, version, text, text_hash, keywords_json, provenance_kind, confidence, freshness, repository_revision, source_ref, supersedes_version_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(version.id, lesson.id, version.version, version.text, version.text_hash, JSON.stringify(version.keywords), version.provenance_kind, version.confidence, version.freshness, version.repository_revision, version.source_ref, version.supersedes_version_id, version.created_at);
    insertEvidence(db, version.id, version.evidence);
    for (const observation of version.observations) recordObservation(db, version.id, observation.repository_revision, observation.source_ref, observation.observed_at);
  }
  const restored = getLesson(db, lesson.id)!;
  receipt(db, restored, "restore", hash(JSON.stringify({ operation: "restore", id: lesson.id, exactTextHash: lesson.current.text_hash })));
}

/** The duplicate `current` projection must be exactly the graph's selected version. */
function sameVersion(left: LessonVersion, right: LessonVersion): boolean {
  return left.id === right.id
    && left.lesson_id === right.lesson_id
    && left.version === right.version
    && left.text === right.text
    && left.text_hash === right.text_hash
    && JSON.stringify(left.keywords) === JSON.stringify(right.keywords)
    && left.provenance_kind === right.provenance_kind
    && left.confidence === right.confidence
    && left.freshness === right.freshness
    && left.repository_revision === right.repository_revision
    && left.source_ref === right.source_ref
    && left.supersedes_version_id === right.supersedes_version_id
    && left.created_at === right.created_at
    && JSON.stringify(left.evidence) === JSON.stringify(right.evidence)
    && JSON.stringify(left.observations) === JSON.stringify(right.observations);
}

function isExportVersion(value: unknown): value is LessonVersion {
  if (!value || typeof value !== "object") return false;
  const version = value as Partial<LessonVersion>;
  return typeof version.id === "string"
    && typeof version.lesson_id === "string"
    && typeof version.version === "number"
    && typeof version.text === "string"
    && typeof version.text_hash === "string"
    && Array.isArray(version.keywords) && version.keywords.every((keyword) => typeof keyword === "string")
    && typeof version.provenance_kind === "string" && LESSON_PROVENANCE.includes(version.provenance_kind)
    && typeof version.confidence === "string" && LESSON_CONFIDENCE.includes(version.confidence)
    && typeof version.freshness === "string" && LESSON_FRESHNESS.includes(version.freshness)
    && (version.repository_revision === null || typeof version.repository_revision === "string")
    && (version.source_ref === null || typeof version.source_ref === "string")
    && (version.supersedes_version_id === null || typeof version.supersedes_version_id === "string")
    && typeof version.created_at === "string"
    && Array.isArray(version.evidence) && version.evidence.every((entry) => typeof entry === "string")
    && Array.isArray(version.observations) && version.observations.every((observation) => observation && typeof observation === "object"
      && (observation.repository_revision === null || typeof observation.repository_revision === "string")
      && (observation.source_ref === null || typeof observation.source_ref === "string")
      && typeof observation.observed_at === "string");
}
function likelyDuplicates(db: Database.Database, scope: string, text: string, excludeId: string): Lesson[] {
  const candidates = db.prepare("SELECT id FROM lessons WHERE scope_key = ? AND id <> ? ORDER BY updated_at DESC LIMIT 100").all(scope, excludeId) as Array<{ id: string }>;
  return candidates
    .map((row) => getLesson(db, row.id, false)!)
    .filter((lesson) => lesson.current && summarySimilarity(text, lesson.current.text) >= LIKELY_DUPLICATE_THRESHOLD);
}

/** Parse exact Notes entries; the heading and every byte below it remain text. */
export function noteEntries(markdown: string): string[] {
  const headings = [...markdown.matchAll(/^## (?!How the cache works\b)([^\n]+)$/gm)];
  return headings.map((match, index) => {
    const start = match.index ?? 0;
    const end = headings[index + 1]?.index ?? markdown.length;
    return markdown.slice(start, end);
  }).filter((entry) => entry.trim().length > 3);
}
