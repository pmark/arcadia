import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import { replaceTopLevelField } from "../ask/settlement.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { observeProviderCapacity, type ProviderCapacityObservation } from "../codingAgents/capacity.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { git, resolveBaseBranch, tryGit } from "../git/worktrees.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { PRODUCTION_CONTROL_DEADLINES, readProductionPolicySafely } from "./policy.js";
import { getRepositoryLease, resolveProjectTransition, systemTmux, type TmuxAdapter } from "../sessions/index.js";
import { launchGuardedHostSession } from "../sessions/launch.js";
import { reconcileSessionExit } from "../sessions/reconciliation.js";
import { createId } from "../utils/id.js";

/**
 * The continuous half of managed production: on every worker tick, while the
 * standing policy is Active, reconcile any repository whose Session died
 * without being observed, admit and launch the next eligible Action for every
 * other eligible repository, and independently notice when a repository's
 * base branch moved for a reason this tick did not itself cause (a human or
 * another host merged its PR). This module owns none of the primitives it
 * calls -- admission, launch, and reconciliation are exactly the same calls a
 * human-triggered `arcadia advance`/`session launch` already makes -- it only
 * decides, once per tick, which repository each of those calls applies to,
 * and remembers how many times a repository has failed in a row so a broken
 * Action stops retrying instead of looping forever on tokens.
 */

export interface ManagedProductionTickOptions {
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  now?: Date;
  tmux?: TmuxAdapter;
  /** Test-only override for the standing-policy provider capacity observation. */
  capacityObservation?: ProviderCapacityObservation;
  /** Test-only override for where a newly launched agent worktree is created. */
  agentWorktreeRoot?: string;
  /**
   * Re-stamp the preservation transport heartbeat between per-Project steps.
   * The tick blocks the event loop for minutes, so the worker's own 5s timer
   * cannot fire while it runs; this is how the 15s freshness window survives.
   */
  heartbeat?: () => void;
  log?: (message: string) => void;
}

export interface BaseBranchAdvanceObservation {
  changed: boolean;
  previousSha: string | null;
  newSha: string;
  baseBranch: string;
}

export type ManagedProductionLaunchOutcome =
  | "launched"
  | "reused"
  | "refused"
  | "failed"
  | "repair_budget_exhausted"
  | "skipped";

export interface ManagedProductionLaunchAttempt {
  attempted: boolean;
  outcome: ManagedProductionLaunchOutcome;
  reason: string;
  actionKey: string | null;
}

export interface ManagedProductionTickProjectResult {
  projectSlug: string;
  repositoryRoot: string | null;
  baseBranchAdvance: BaseBranchAdvanceObservation | null;
  reconciled: Array<{ sessionId: string; outcome: string }>;
  launch: ManagedProductionLaunchAttempt | null;
}

export interface ManagedProductionTickResult {
  policyActive: boolean;
  projects: ManagedProductionTickProjectResult[];
}

export function ensureProductionTickTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_repair_attempts (
      action_key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_base_branch_observations (
      project_slug TEXT PRIMARY KEY,
      project_id TEXT,
      repository_path TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      observed_sha TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );
  `);
}

/**
 * Run one managed-production tick across every active Project. Never throws
 * for an individual repository's failure -- a broken or refused repository is
 * reported in its own result entry so one Project's trouble never stops the
 * tick from reaching the rest.
 */
export function runManagedProductionTick(
  db: Database.Database,
  workspace: string,
  options: ManagedProductionTickOptions
): ManagedProductionTickResult {
  ensureProductionTickTables(db);
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const tmux = options.tmux ?? systemTmux;
  const policyRead = readProductionPolicySafely(db);
  const active = policyRead.status === "ok" && policyRead.policy.desiredState === "active";

  const projects: ManagedProductionTickProjectResult[] = [];
  for (const project of listProjects(db).filter((candidate) => candidate.status === "active")) {
    options.heartbeat?.();
    const metadata = getProjectMetadata(db, project.id);
    const configuredPath = metadata?.repo_path?.trim() || null;
    if (!configuredPath || !existsSync(configuredPath)) {
      projects.push({ projectSlug: project.slug, repositoryRoot: null, baseBranchAdvance: null, reconciled: [], launch: null });
      continue;
    }
    const repoRoot = path.resolve(configuredPath);

    let baseBranchAdvance: BaseBranchAdvanceObservation | null;
    try {
      baseBranchAdvance = detectBaseBranchAdvance(db, { repoRoot, projectSlug: project.slug, projectId: project.id, now, log });
    } catch (error) {
      log(`Base branch observation failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
      baseBranchAdvance = null;
    }
    options.heartbeat?.();

    const reconciled: Array<{ sessionId: string; outcome: string }> = [];
    try {
      const lease = getRepositoryLease(db, repoRoot);
      if (lease && !tmux.hasSession(lease.tmux_session_name)) {
        const result = reconcileSessionExit({ db, sessionId: lease.id, requestId: `worker-tick-reconcile-${lease.id}`, repoRoot });
        reconciled.push({ sessionId: lease.id, outcome: result.receipt.outcome });
        log(`Reconciled Session ${lease.id} for ${project.slug}: ${result.receipt.outcome} (${result.receipt.reason})`);
      }
    } catch (error) {
      log(`Reconciliation failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }

    let launch: ManagedProductionLaunchAttempt | null = null;
    if (active && reconciled.length === 0) {
      launch = attemptProjectLaunch(db, { workspace, repoRoot, projectSlug: project.slug, options, tmux, now, log });
    } else if (active) {
      // A Session for this repository was just reconciled this very tick. Its
      // outcome (e.g. `accepted_completion`) may have settled onto the
      // candidate's own branch, which has not been merged into this checked-in
      // repository yet -- `resolveProjectTransition` would still see the same
      // pre-completion pointer and relaunch the identical Action a second
      // time. Give the operator (or bound CI) a full tick to land that merge
      // before this repository is considered for another launch; the next
      // tick's base-branch-advance detection picks it up as soon as it lands.
      launch = { attempted: false, outcome: "skipped", reason: "Repository was just reconciled this tick; deferring admission one tick for its merge to land.", actionKey: null };
    }

    options.heartbeat?.();
    projects.push({ projectSlug: project.slug, repositoryRoot: repoRoot, baseBranchAdvance, reconciled, launch });
  }

  return { policyActive: active, projects };
}

function attemptProjectLaunch(
  db: Database.Database,
  input: {
    workspace: string;
    repoRoot: string;
    projectSlug: string;
    options: ManagedProductionTickOptions;
    tmux: TmuxAdapter;
    now: Date;
    log: (message: string) => void;
  }
): ManagedProductionLaunchAttempt {
  const lease = getRepositoryLease(db, input.repoRoot);
  if (lease) {
    return { attempted: false, outcome: "skipped", reason: `Repository lease held by Session ${lease.id}.`, actionKey: null };
  }

  const transition = resolveProjectTransition({ repoRoot: input.repoRoot, projectSlug: input.projectSlug, db, tmux: input.tmux });
  if (transition.kind !== "launch" || !transition.dispatch.context) {
    return { attempted: false, outcome: "skipped", reason: transition.reason, actionKey: null };
  }

  const actionKey = `${input.projectSlug}/${transition.dispatch.context.action.id}`;
  const attempts = getRepairAttempts(db, actionKey);
  if (attempts.attempts >= PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) {
    return {
      attempted: false,
      outcome: "repair_budget_exhausted",
      reason: `Repair budget exhausted for ${actionKey} after ${attempts.attempts} failed launch attempt(s); most recent error: ${attempts.lastError ?? "unknown"}. An operator must repair and reset it.`,
      actionKey
    };
  }

  const requestId = `worker-tick-${actionKey.replaceAll("/", "-")}-${input.now.getTime()}`;
  try {
    const result = launchGuardedHostSession({
      db,
      workspace: input.workspace,
      repoRoot: input.repoRoot,
      projectSlug: input.projectSlug,
      requestId,
      standingPolicy: true,
      profiles: input.options.profiles,
      adapters: input.options.adapters,
      now: input.now,
      tmux: input.tmux,
      capacityObservation: input.options.capacityObservation,
      agentWorktreeRoot: input.options.agentWorktreeRoot
    });
    resetRepairAttempts(db, actionKey);
    input.log(`${result.reused ? "Reused" : "Launched"} Session ${result.session.id} for ${actionKey} under the standing production policy.`);
    return {
      attempted: true,
      outcome: result.reused ? "reused" : "launched",
      reason: result.reused ? "An already-durable Session satisfied this tick's launch." : "Launched under the standing production policy grant.",
      actionKey
    };
  } catch (error) {
    // A refusal carries `details.conflict`: capacity/Off/stale-preview/lease
    // races are expected wait states this tick will simply retry later, never
    // a repair-worthy failure. Anything else is a real defect in preparing or
    // spawning the Session and counts against the finite repair budget.
    if (error instanceof ArcadiaError && error.details?.conflict) {
      return { attempted: true, outcome: "refused", reason: error.message, actionKey };
    }
    const message = error instanceof Error ? error.message : String(error);
    recordRepairAttempt(db, actionKey, message, input.now);
    input.log(`Launch attempt failed for ${actionKey}: ${message}`);
    return { attempted: true, outcome: "failed", reason: message, actionKey };
  }
}

interface RepairAttemptsRow {
  attempts: number;
  last_error: string | null;
}

function getRepairAttempts(db: Database.Database, actionKey: string): { attempts: number; lastError: string | null } {
  const row = db.prepare("SELECT attempts, last_error FROM production_repair_attempts WHERE action_key = ?").get(actionKey) as
    | RepairAttemptsRow
    | undefined;
  return { attempts: row?.attempts ?? 0, lastError: row?.last_error ?? null };
}

function recordRepairAttempt(db: Database.Database, actionKey: string, error: string, now: Date): void {
  const at = now.toISOString();
  const existing = db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?").get(actionKey) as
    | { attempts: number }
    | undefined;
  const attempts = (existing?.attempts ?? 0) + 1;
  db.prepare(
    `INSERT INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at)
       VALUES (@action_key, @attempts, @last_error, @last_attempt_at, @updated_at)
     ON CONFLICT(action_key) DO UPDATE SET
       attempts = @attempts, last_error = @last_error, last_attempt_at = @last_attempt_at, updated_at = @updated_at`
  ).run({ action_key: actionKey, attempts, last_error: error, last_attempt_at: at, updated_at: at });
}

function resetRepairAttempts(db: Database.Database, actionKey: string): void {
  db.prepare("DELETE FROM production_repair_attempts WHERE action_key = ?").run(actionKey);
}

/**
 * Reset a repository's exhausted repair budget after an operator has fixed
 * the underlying problem, so the next tick attempts admission again rather
 * than reporting the same stale error forever.
 */
export function resetProductionRepairBudget(db: Database.Database, actionKey: string): void {
  ensureProductionTickTables(db);
  resetRepairAttempts(db, actionKey);
}

function detectBaseBranchAdvance(
  db: Database.Database,
  input: { repoRoot: string; projectSlug: string; projectId: string; now: Date; log: (message: string) => void }
): BaseBranchAdvanceObservation | null {
  const baseBranch = resolveBaseBranch(input.repoRoot);
  // Fetch and fast-forward the local base branch onto its remote when that is
  // a clean ancestor merge, mirroring `go.ts`'s own `syncBaseBranchWithRemote`
  // -- without this, a PR merged by a human or CI elsewhere never becomes
  // visible here, because `git fetch` alone only updates the remote-tracking
  // ref, not the local branch this repository actually dispatches against.
  // `--ff-only` refuses (leaving everything untouched) on any divergence or
  // conflicting local change, so a tick can attempt this every time with no
  // risk of rewriting or discarding work.
  if (tryGit(input.repoRoot, ["fetch", "--quiet", "origin"]) !== null) {
    tryGit(input.repoRoot, ["merge", "--ff-only", "--quiet", `origin/${baseBranch}`]);
  }
  const newSha = git(input.repoRoot, ["rev-parse", baseBranch]).trim();
  const at = input.now.toISOString();

  const existing = db.prepare("SELECT observed_sha FROM production_base_branch_observations WHERE project_slug = ?").get(input.projectSlug) as
    | { observed_sha: string }
    | undefined;
  const previousSha = existing?.observed_sha ?? null;

  db.prepare(
    `INSERT INTO production_base_branch_observations (project_slug, project_id, repository_path, base_branch, observed_sha, observed_at)
       VALUES (@project_slug, @project_id, @repository_path, @base_branch, @observed_sha, @observed_at)
     ON CONFLICT(project_slug) DO UPDATE SET
       project_id = @project_id, repository_path = @repository_path, base_branch = @base_branch,
       observed_sha = @observed_sha, observed_at = @observed_at`
  ).run({
    project_slug: input.projectSlug,
    project_id: input.projectId,
    repository_path: input.repoRoot,
    base_branch: baseBranch,
    observed_sha: newSha,
    observed_at: at
  });

  if (previousSha === null || previousSha === newSha) {
    return { changed: false, previousSha, newSha, baseBranch };
  }

  recordEvent(db, {
    eventType: "managed_production.base_branch_advanced",
    projectId: input.projectId,
    payload: { projectSlug: input.projectSlug, baseBranch, previousSha, newSha, repositoryPath: input.repoRoot },
    at
  });
  appendBaseBranchAdvanceMissionLog(input.repoRoot, input.projectSlug, { previousSha, newSha, baseBranch });
  // The Mission Log append above commits directly onto `baseBranch`, which
  // moves it again -- re-observe the SHA after that commit and store it, or
  // the next tick reads its own commit back as yet another "advance" and
  // repeats forever (this is what produced thousands of spurious commits
  // before this fix; see the history purge that accompanied it).
  const shaAfterMissionLog = git(input.repoRoot, ["rev-parse", baseBranch]).trim();
  if (shaAfterMissionLog !== newSha) {
    db.prepare(
      `UPDATE production_base_branch_observations SET observed_sha = @observed_sha, observed_at = @observed_at WHERE project_slug = @project_slug`
    ).run({ project_slug: input.projectSlug, observed_sha: shaAfterMissionLog, observed_at: input.now.toISOString() });
  }
  input.log(`Base branch ${baseBranch} advanced for ${input.projectSlug} (a merge landed independent of this worker's own admission pipeline): ${previousSha} -> ${newSha}`);
  return { changed: true, previousSha, newSha, baseBranch };
}

function recordEvent(db: Database.Database, input: { eventType: string; projectId: string | null; payload: unknown; at: string }): void {
  db.prepare(
    `INSERT INTO events (id, event_type, source_module, project_id, work_item_id, artifact_id, review_item_id, payload_json, created_at)
       VALUES (@id, @event_type, 'managed_production_tick', @project_id, NULL, NULL, NULL, @payload_json, @created_at)`
  ).run({
    id: createId("event"),
    event_type: input.eventType,
    project_id: input.projectId,
    payload_json: JSON.stringify({ schemaVersion: 1, ...input.payload as object }),
    created_at: input.at
  });
}

/**
 * Append (and commit) a MISSION_LOG.md line naming the previous and new base
 * SHA, so a merge that lands while the worker was off or between ticks is
 * never silent. Written and committed directly on the base branch -- the same
 * repository the SHA comparison just read -- because this is a purely
 * mechanical observation of a transition that already happened, not a new
 * decision; a failure to write or commit is swallowed exactly like
 * `commitSettlementOutput` does, so a MISSION_LOG hiccup never breaks the
 * tick that observed the advance (the `events` row already recorded it).
 */
function appendBaseBranchAdvanceMissionLog(
  repoRoot: string,
  projectSlug: string,
  input: { previousSha: string; newSha: string; baseBranch: string }
): void {
  try {
    const logPath = path.join(repoRoot, "MISSION_LOG.md");
    const today = new Date().toISOString().slice(0, 10);
    let before: string | null = null;
    try {
      before = readFileSync(logPath, "utf8");
    } catch {
      // No MISSION_LOG.md yet; start one below.
    }
    const base =
      before ??
      ["---", "arcadia: v1", "type: log", `slug: ${projectSlug}-mission-log`, `project: ${projectSlug}`, `updated: ${today}`, "---", "", `# Mission Log: ${projectSlug}`, ""].join(
        "\n"
      );
    const updated = replaceTopLevelField(base, "updated", today).trimEnd();
    const section =
      `\n\n## ${today} — Base branch advanced\n\n` +
      [
        `- **Did:** Observed \`${input.baseBranch}\` advance from \`${input.previousSha.slice(0, 12)}\` to \`${input.newSha.slice(0, 12)}\`, independent of this worker's own completion signal (a PR merged, or another host advanced it).`,
        "- **Result:** Recorded as a `managed_production.base_branch_advanced` event and this Log entry so the merge is never silent.",
        "- **Next:** Continue from the governed Project pointer and execution queue.",
        "- **Blockers:** None."
      ].join("\n") +
      "\n";
    const content = `${updated}${section}`;
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(logPath, content, "utf8");
    git(repoRoot, ["add", "--", "MISSION_LOG.md"]);
    git(repoRoot, [
      "commit",
      "-m",
      `chore(arcadia): record base branch advance for ${projectSlug} (${input.previousSha.slice(0, 12)} -> ${input.newSha.slice(0, 12)})`,
      "--",
      "MISSION_LOG.md"
    ]);
  } catch {
    // Intentionally swallowed: the `events` row is the durable record of this
    // observation; the MISSION_LOG commit is a convenience on top of it, and
    // the next command to touch this repository reports a dirty tree (if any)
    // far more clearly than a rethrow here would.
  }
}
