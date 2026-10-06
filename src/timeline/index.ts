import { existsSync, realpathSync } from "node:fs";
import type Database from "better-sqlite3";
import { openReadOnlyDatabase } from "../db/connection.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { asksCollector } from "./collectors/asks.js";
import {
  hasTable,
  runGhReadOnly,
  runGitReadOnly,
  type Collector,
  type CollectorContext,
  type GhRunner,
  type GitRunner,
  type TimelineRepository
} from "./collectors/context.js";
import { decisionsCollector } from "./collectors/decisions.js";
import { eventsTableCollector } from "./collectors/events.js";
import { gitCollectors } from "./collectors/git.js";
import { governedRecordCollectors } from "./collectors/governed.js";
import { operatorScriptCollectors } from "./collectors/operatorScripts.js";
import { pingsCollector } from "./collectors/pings.js";
import { productionCollector, queueCollector } from "./collectors/production.js";
import { pullRequestCollectors } from "./collectors/pullRequests.js";
import { sessionsCollector } from "./collectors/sessions.js";
import { mergeTimeline } from "./merge.js";
import { buildPointInTimeView, type PointInTimeView } from "./rewind.js";
import { inWindow, timelineEvent, type AgentTool, type TimelineEvent, type TimelineSource, type TimelineWindow, type WorkKind } from "./schema.js";

export * from "./schema.js";
export { buildPointInTimeView, type PointInTimeView } from "./rewind.js";
export { mergeTimeline, compareEvents } from "./merge.js";
export { followTimeline, DEFAULT_FOLLOW_INTERVAL_MS } from "./follow.js";
export type { Collector, CollectorContext, TimelineRepository } from "./collectors/context.js";

/** Rows read per source per collection; bounds memory however wide the window. */
export const DEFAULT_MAX_PER_SOURCE = 5_000;

export interface TimelineFilters {
  project?: string;
  tool?: AgentTool;
  kind?: WorkKind;
}

export interface CollectTimelineInput {
  workspacePath: string;
  window: TimelineWindow;
  filters?: TimelineFilters;
  includePullRequests?: boolean;
  maxPerSource?: number;
  now?: Date;
  /** Test seams; production uses the read-only runners. */
  git?: GitRunner;
  gh?: GhRunner;
  collectors?: (repositories: TimelineRepository[]) => Collector[];
}

export interface SourceReport {
  source: TimelineSource;
  describe: string;
  events: number;
  durationMs: number;
  error: string | null;
}

export interface TimelineCollection {
  workspace: string;
  window: { since: string; until: string };
  repositories: Array<{ project: string; path: string }>;
  /** Merged, filtered, ordered; before any `--limit`. */
  events: TimelineEvent[];
  /** Every record before de-duplication, for the point-in-time fold. */
  raw: TimelineEvent[];
  sources: SourceReport[];
  durationMs: number;
}

export function defaultCollectors(repositories: TimelineRepository[]): Collector[] {
  return [
    ...gitCollectors(repositories),
    ...governedRecordCollectors(repositories),
    sessionsCollector,
    asksCollector,
    decisionsCollector,
    eventsTableCollector,
    productionCollector,
    queueCollector,
    pingsCollector,
    ...operatorScriptCollectors(repositories),
    ...pullRequestCollectors(repositories)
  ];
}

interface RepositoryRow {
  id: string;
  slug: string | null;
  name: string;
  repo_path: string | null;
}

export function loadRepositories(db: Database.Database): { repositories: TimelineRepository[]; projectSlugById: Map<string, string> } {
  const projectSlugById = new Map<string, string>();
  const repositories: TimelineRepository[] = [];
  if (!hasTable(db, "projects")) return { repositories, projectSlugById };
  const withMetadata = hasTable(db, "project_metadata");
  const rows = db.prepare(
    withMetadata
      ? "SELECT p.id, p.slug, p.name, m.repo_path FROM projects p LEFT JOIN project_metadata m ON m.project_id = p.id ORDER BY p.slug"
      : "SELECT id, slug, name, NULL AS repo_path FROM projects ORDER BY slug"
  ).all() as RepositoryRow[];
  const seen = new Set<string>();
  for (const row of rows) {
    const slug = row.slug ?? row.id;
    projectSlugById.set(row.id, slug);
    const configured = row.repo_path?.trim();
    if (!configured || !existsSync(configured)) continue;
    const resolved = realpathSync(configured);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    repositories.push({ projectSlug: slug, projectId: row.id, path: resolved });
  }
  return { repositories, projectSlugById };
}

function operatorEmails(repositories: TimelineRepository[], git: GitRunner): Set<string> {
  const emails = new Set<string>();
  for (const repository of repositories) {
    const result = git(repository.path, ["config", "--get", "user.email"]);
    if (result.ok && result.stdout.trim()) emails.add(result.stdout.trim().toLowerCase());
  }
  return emails;
}

function sourceError(describe: string, source: TimelineSource, message: string, now: Date): TimelineEvent {
  return timelineEvent({
    id: `timeline:source_error:${describe}`,
    time: now,
    clock: "collector",
    source: "timeline",
    kind: "source_error",
    workKind: "observe",
    summary: `Could not read ${describe}: ${message}`,
    provenance: { event: `the ${source} collector failed; the rest of the stream is unaffected` }
  }) as TimelineEvent;
}

export function matchesFilters(event: TimelineEvent, filters: TimelineFilters): boolean {
  if (event.kind === "source_error") return true;
  if (filters.project && event.subjects.project !== filters.project) return false;
  if (filters.tool && event.actor.tool !== filters.tool) return false;
  if (filters.kind && event.workKind !== filters.kind) return false;
  return true;
}

/**
 * Collects the unified stream for one window. Strictly read-only: the
 * workspace database is opened read-only, repositories are read with
 * `git log`/`rev-parse`/`cat-file` and the reflog and index files only, and
 * GitHub is read with `gh api` GET only when asked. Each collector's failure
 * becomes one `source_error` event; nothing aborts the stream.
 */
export async function collectTimeline(input: CollectTimelineInput): Promise<TimelineCollection> {
  const started = Date.now();
  const now = input.now ?? new Date();
  const git = input.git ?? runGitReadOnly;
  const raw: TimelineEvent[] = [];
  const sources: SourceReport[] = [];

  let db: Database.Database | null = null;
  try {
    if (!existsSync(getWorkspacePaths(input.workspacePath).databaseFile)) throw new Error("no workspace database file");
    db = openReadOnlyDatabase(input.workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    raw.push(sourceError("the workspace database", "timeline", message, now));
    sources.push({ source: "timeline", describe: "workspace database", events: 0, durationMs: 0, error: message });
  }

  try {
    let loaded: { repositories: TimelineRepository[]; projectSlugById: Map<string, string> } = { repositories: [], projectSlugById: new Map() };
    if (db) {
      try {
        loaded = loadRepositories(db);
      } catch (error) {
        // Without the repository list the database collectors still stream.
        const message = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 300);
        raw.push(sourceError("project repositories", "timeline", message, now));
        sources.push({ source: "timeline", describe: "project repositories", events: 0, durationMs: 0, error: message });
      }
    }
    const repositories = input.filters?.project
      ? loaded.repositories.filter((repository) => repository.projectSlug === input.filters?.project)
      : loaded.repositories;
    const context: CollectorContext = {
      workspacePath: input.workspacePath,
      db,
      repositories,
      projectSlugById: loaded.projectSlugById,
      operatorEmails: operatorEmails(repositories, git),
      window: input.window,
      maxPerSource: input.maxPerSource ?? DEFAULT_MAX_PER_SOURCE,
      now,
      git,
      includePullRequests: input.includePullRequests ?? false,
      gh: input.gh ?? runGhReadOnly
    };
    const collectors = (input.collectors ?? defaultCollectors)(repositories);
    for (const collector of collectors) {
      const collectorStarted = Date.now();
      try {
        if (!db && collector.source !== "git" && collector.source !== "governed-records" && collector.source !== "operator-scripts" && collector.source !== "pull-requests") {
          continue;
        }
        const events = await collector.collect(context);
        raw.push(...events);
        sources.push({ source: collector.source, describe: collector.describe, events: events.length, durationMs: Date.now() - collectorStarted, error: null });
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 300);
        raw.push(sourceError(collector.describe, collector.source, message, now));
        sources.push({ source: collector.source, describe: collector.describe, events: 0, durationMs: Date.now() - collectorStarted, error: message });
      }
    }
    // A row is selected when any of its timestamps falls in the window, so a collector may emit stages
    // outside it (a review item opened inside and decided after --until). Only in-window events stream;
    // a source_error always does.
    const windowed = raw.filter((event) => event.kind === "source_error" || inWindow(event.time, input.window));
    for (const event of windowed) event.subjects.workspace = input.workspacePath;
    const merged = mergeTimeline(windowed).filter((event) => matchesFilters(event, input.filters ?? {}));
    return {
      workspace: input.workspacePath,
      window: { since: input.window.since.toISOString(), until: input.window.until.toISOString() },
      repositories: repositories.map((repository) => ({ project: repository.projectSlug, path: repository.path })),
      events: merged,
      raw: windowed,
      sources,
      durationMs: Date.now() - started
    };
  } finally {
    db?.close();
  }
}

/** The rewind view for a collection, filtered the same way as the stream. */
export function pointInTime(collection: TimelineCollection, asOf: Date, filters: TimelineFilters = {}): PointInTimeView {
  return buildPointInTimeView(collection.raw.filter((event) => matchesFilters(event, filters)), asOf, new Date(collection.window.since));
}
