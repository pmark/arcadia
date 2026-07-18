import type Database from "better-sqlite3";
import type { WorkItemSummary } from "../domain/types.js";
import { planStepsForWorkItem } from "../execution/skills.js";

export interface DashboardDailyAdvantage {
  actionId: string;
  projectId: string;
  projectName: string;
  mission: string;
  outcome: string | null;
  milestoneId: string;
  milestoneTitle: string;
  actionTitle: string;
  nextAction: string;
  expectedArtifact: string;
  repositoryPath: string;
  whyItMatters: string;
  whyNow: string;
  status: "ready" | "prepared";
  statusLabel: string;
  decisionId: string | null;
  decisionSlug: string | null;
  packetPath: string | null;
}

interface CandidateRow extends WorkItemSummary {
  project_mission: string;
  project_outcome: string | null;
  project_status: string;
  milestone_status: string;
  repo_path: string;
}

interface PreparedRow extends CandidateRow {
  decision_id: string;
  decision_slug: string | null;
  decision_status: "open" | "deferred";
  packet_path: string | null;
}

export function selectDailyAdvantage(db: Database.Database): DashboardDailyAdvantage | null {
  const prepared = preparedAdvantage(db);
  if (prepared) {
    return toPreparedAdvantage(prepared);
  }

  const candidates = db.prepare(
    `SELECT
       wi.*,
       wi.work_classification AS responsibility,
       p.name AS project_name,
       p.mission AS project_mission,
       p.goal AS project_outcome,
       p.status AS project_status,
       m.title AS milestone_title,
       m.status AS milestone_status,
       pm.repo_path
     FROM work_items wi
     JOIN projects p ON p.id = wi.project_id
     JOIN milestones m ON m.id = wi.milestone_id
     JOIN project_metadata pm ON pm.project_id = p.id
     WHERE wi.status = 'open'
       AND wi.queue = 'work_queue'
       AND wi.work_classification = 'codex'
       AND p.status = 'active'
       AND m.status = 'active'
       AND trim(COALESCE(wi.expected_artifact, '')) != ''
       AND trim(COALESCE(pm.repo_path, '')) != ''
       AND NOT EXISTS (
         SELECT 1 FROM execution_runs er
         WHERE er.work_item_id = wi.id
           AND er.status IN ('pending_execution', 'running')
       )
       AND NOT EXISTS (
         SELECT 1 FROM codex_invocations ci
         WHERE ci.work_item_id = wi.id
           AND ci.purpose = 'planning'
           AND ci.status IN ('packet_created', 'running')
       )
       AND NOT EXISTS (
         SELECT 1 FROM review_items ri
         WHERE ri.work_item_id = wi.id
           AND ri.status IN ('open', 'deferred')
           AND ri.resolved_intent IN (
             'CodexPlanningRunApproval',
             'CodexPlanningRetryApproval',
             'CodexPlanningArtifactAcceptance',
             'codex_planning_artifact_validation'
           )
       )
       AND NOT EXISTS (
         SELECT 1 FROM execution_plans ep
         WHERE ep.work_item_id = wi.id AND ep.status = 'planned'
       )
     ORDER BY wi.created_at DESC, wi.id ASC`
  ).all() as CandidateRow[];

  const candidate = candidates.find((item) => {
    const steps = planStepsForWorkItem(item);
    return steps.length === 1 && steps[0]?.executorType === "codex_planning";
  });

  return candidate ? toReadyAdvantage(candidate) : null;
}

function preparedAdvantage(db: Database.Database): PreparedRow | null {
  return db.prepare(
    `SELECT
       wi.*,
       wi.work_classification AS responsibility,
       p.name AS project_name,
       p.mission AS project_mission,
       p.goal AS project_outcome,
       p.status AS project_status,
       m.title AS milestone_title,
       m.status AS milestone_status,
       pm.repo_path,
       ri.id AS decision_id,
       ri.slug AS decision_slug,
       ri.status AS decision_status,
       a.path AS packet_path
     FROM review_items ri
     JOIN work_items wi ON wi.id = ri.work_item_id
     JOIN projects p ON p.id = wi.project_id
     JOIN milestones m ON m.id = wi.milestone_id
     JOIN project_metadata pm ON pm.project_id = p.id
     LEFT JOIN artifacts a ON a.id = ri.artifact_id
     WHERE ri.status IN ('open', 'deferred')
       AND ri.resolved_intent = 'CodexPlanningRunApproval'
       AND json_extract(ri.context_json, '$.preparationSource') = 'existing_action'
       AND wi.status != 'done'
       AND p.status = 'active'
     ORDER BY ri.created_at ASC, ri.id ASC
     LIMIT 1`
  ).get() as PreparedRow | undefined ?? null;
}

function toReadyAdvantage(row: CandidateRow): DashboardDailyAdvantage {
  return {
    ...baseAdvantage(row),
    whyNow: "Ready now: Codex Responsibility, repository configured, and no blocker, planning Decision, packet, or Run underway. Selected as the newest eligible Action.",
    status: "ready",
    statusLabel: "Ready to Prepare",
    decisionId: null,
    decisionSlug: null,
    packetPath: null
  };
}

function toPreparedAdvantage(row: PreparedRow): DashboardDailyAdvantage {
  const decisionLabel = row.decision_slug ?? row.decision_id;
  return {
    ...baseAdvantage(row),
    whyNow: `Decision ${decisionLabel} is already waiting. Finish this Decision before preparing another Daily Advantage.`,
    status: "prepared",
    statusLabel: row.decision_status === "deferred" ? "Decision Deferred" : "Decision Ready",
    decisionId: row.decision_id,
    decisionSlug: row.decision_slug,
    packetPath: row.packet_path
  };
}

function baseAdvantage(row: CandidateRow): Omit<
  DashboardDailyAdvantage,
  "whyNow" | "status" | "statusLabel" | "decisionId" | "decisionSlug" | "packetPath"
> {
  const expectedArtifact = row.expected_artifact as string;
  return {
    actionId: row.id,
    projectId: row.project_id as string,
    projectName: row.project_name as string,
    mission: row.project_mission,
    outcome: row.project_outcome,
    milestoneId: row.milestone_id as string,
    milestoneTitle: row.milestone_title as string,
    actionTitle: row.title,
    nextAction: row.next_action,
    expectedArtifact,
    repositoryPath: row.repo_path,
    whyItMatters: `Advances ${row.project_name}'s active “${row.milestone_title}” Milestone and produces the concrete Artifact “${expectedArtifact}”.`
  };
}
