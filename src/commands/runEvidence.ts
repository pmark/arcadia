import type Database from "better-sqlite3";

/** Read-only projection shared by Ask show and To-do; queueing is never completion evidence. */
export interface RunEvidence {
  id: string;
  status: string;
  summary: string | null;
  waitingReason: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  projectSlug: string | null;
  workItemId: string | null;
  reviewItemId: string | null;
  artifacts: Array<{ id: string; path: string | null; status: string; kind: string; evidenceReference: string }>;
}

interface RunRow {
  id: string; status: string; summary: string | null; created_at: string; updated_at: string;
  project_id: string | null; project_slug: string | null; work_item_id: string | null; review_item_id: string | null;
}

export function listProjectRunEvidence(db: Database.Database, projectSlugs?: string[] | null): RunEvidence[] {
  const wanted = projectSlugs == null ? null : new Set(projectSlugs.map((slug) => slug.toLowerCase()));
  const rows = db.prepare(`
    SELECT er.id, er.status, er.summary, er.created_at, er.updated_at, er.work_item_id, er.review_item_id,
      COALESCE(wi.project_id, ri.project_id) AS project_id, p.slug AS project_slug
    FROM execution_runs er
    LEFT JOIN work_items wi ON wi.id = er.work_item_id
    LEFT JOIN review_items ri ON ri.id = er.review_item_id
    LEFT JOIN projects p ON p.id = COALESCE(wi.project_id, ri.project_id)
    ORDER BY er.created_at, er.id
  `).all() as RunRow[];
  return rows.filter((row) => wanted === null || (row.project_slug !== null && wanted.has(row.project_slug.toLowerCase())))
    .map((row) => projectRunEvidence(db, row));
}

export function listAskRunEvidence(db: Database.Database, askId: string, captureId: string | null, workItemId: string | null): RunEvidence[] {
  const reviewIds = db.prepare(`SELECT id FROM review_items WHERE ask_request_id = ? OR (? IS NOT NULL AND capture_id = ?)`)
    .all(askId, captureId, captureId) as Array<{ id: string }>;
  const ids = new Set(reviewIds.map((row) => row.id));
  const workIds = new Set<string>();
  if (workItemId) workIds.add(workItemId);
  if (captureId) {
    for (const row of db.prepare("SELECT id FROM work_items WHERE capture_id = ?").all(captureId) as Array<{ id: string }>) workIds.add(row.id);
  }
  if (!ids.size && !workIds.size) return [];
  const reviewList = [...ids];
  const workList = [...workIds];
  const clauses: string[] = [];
  const params: string[] = [];
  if (reviewList.length) { clauses.push(`er.review_item_id IN (${reviewList.map(() => "?").join(",")})`); params.push(...reviewList); }
  if (workList.length) { clauses.push(`er.work_item_id IN (${workList.map(() => "?").join(",")})`); params.push(...workList); }
  const rows = db.prepare(`
    SELECT er.id, er.status, er.summary, er.created_at, er.updated_at, er.work_item_id, er.review_item_id,
      COALESCE(wi.project_id, ri.project_id) AS project_id, p.slug AS project_slug
    FROM execution_runs er
    LEFT JOIN work_items wi ON wi.id = er.work_item_id
    LEFT JOIN review_items ri ON ri.id = er.review_item_id
    LEFT JOIN projects p ON p.id = COALESCE(wi.project_id, ri.project_id)
    WHERE ${clauses.join(" OR ")} ORDER BY er.created_at, er.id
  `).all(...params) as RunRow[];
  return rows.map((row) => projectRunEvidence(db, row));
}

function projectRunEvidence(db: Database.Database, row: RunRow): RunEvidence {
  const artifacts = db.prepare(`
    SELECT a.id, a.path, a.status, a.artifact_type AS kind
    FROM run_artifacts ra JOIN artifacts a ON a.id = ra.artifact_id
    WHERE ra.run_id = ? ORDER BY ra.created_at, a.id
  `).all(row.id) as Array<{ id: string; path: string | null; status: string; kind: string }>;
  const waitingReason = row.status === "pending_execution" ? "Waiting for the managed Run worker to claim this queued Run."
    : row.status === "requires_review" ? "Run output is waiting for review."
      : row.status === "failed" ? row.summary ?? "The Run failed."
        : null;
  return {
    id: row.id, status: row.status, summary: row.summary, waitingReason,
    createdAt: row.created_at, updatedAt: row.updated_at,
    projectId: row.project_id, projectSlug: row.project_slug,
    workItemId: row.work_item_id, reviewItemId: row.review_item_id,
    artifacts: artifacts.map((artifact) => ({ ...artifact, evidenceReference: artifact.path ?? `artifact:${artifact.id}` }))
  };
}
