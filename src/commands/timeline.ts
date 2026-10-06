import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import {
  AGENT_TOOLS,
  WORK_KINDS,
  collectTimeline,
  followTimeline,
  isAgentTool,
  isWorkKind,
  pointInTime,
  DEFAULT_FOLLOW_INTERVAL_MS,
  type PointInTimeView,
  type SourceReport,
  type TimelineEvent,
  type TimelineFilters
} from "../timeline/index.js";
import { renderEventLine, renderPointInTime, renderSources } from "../timeline/render.js";
import { resolveWindow } from "../timeline/time.js";

/**
 * `arcadia timeline`: the unified operator event stream (docs/proposals/operator-timeline.md).
 * A noun command: it reads the workspace database read-only and the repositories with
 * read-only Git, and writes nothing anywhere.
 */

export const DEFAULT_TIMELINE_LIMIT = 200;

export interface TimelineCommandOptions {
  workspace?: string;
  since?: string;
  until?: string;
  asOf?: string;
  project?: string;
  tool?: string;
  kind?: string;
  limit?: string;
  pullRequests?: boolean;
  interval?: string;
}

export interface TimelineData {
  window: { since: string; until: string };
  asOf: string | null;
  filters: TimelineFilters;
  /** Events in the window after de-duplication and filters. */
  total: number;
  /** Events dropped by --limit (the oldest). */
  omitted: number;
  events: TimelineEvent[];
  sources: SourceReport[];
  repositories: Array<{ project: string; path: string }>;
  durationMs: number;
  view: PointInTimeView | null;
}

export function parseTimelineFilters(options: TimelineCommandOptions): TimelineFilters {
  if (options.tool !== undefined && !isAgentTool(options.tool)) {
    throw validationError(`--tool must be one of: ${AGENT_TOOLS.join(", ")}.`, { tool: options.tool });
  }
  if (options.kind !== undefined && !isWorkKind(options.kind)) {
    throw validationError(`--kind must be one of: ${WORK_KINDS.join(", ")}.`, { kind: options.kind });
  }
  return {
    ...(options.project ? { project: options.project } : {}),
    ...(options.tool ? { tool: options.tool } : {}),
    ...(options.kind ? { kind: options.kind } : {})
  };
}

function parsePositive(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw validationError(`${flag} must be a positive whole number.`, { [flag]: value });
  return parsed;
}

export async function runTimelineCommand(options: TimelineCommandOptions, now: Date = new Date()): Promise<CommandSuccess<TimelineData>> {
  const filters = parseTimelineFilters(options);
  const limit = parsePositive(options.limit, "--limit", DEFAULT_TIMELINE_LIMIT);
  const window = resolveWindow({ since: options.since, until: options.until, asOf: options.asOf, now });
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const collection = await collectTimeline({
    workspacePath,
    window,
    filters,
    includePullRequests: options.pullRequests === true,
    now
  });
  const events = collection.events.slice(Math.max(0, collection.events.length - limit));
  const failed = collection.sources.filter((source) => source.error);
  return createSuccess({
    command: "timeline",
    workspace: workspacePath,
    data: {
      window: collection.window,
      asOf: window.asOf?.toISOString() ?? null,
      filters,
      total: collection.events.length,
      omitted: collection.events.length - events.length,
      events,
      sources: collection.sources,
      repositories: collection.repositories,
      durationMs: collection.durationMs,
      view: window.asOf ? pointInTime(collection, window.asOf, filters) : null
    },
    warnings: failed.map((source) => `Could not read ${source.describe}: ${source.error}`)
  });
}

export function renderTimelineSuccess(response: CommandSuccess<TimelineData>): string[] {
  const data = response.data;
  const lines: string[] = [];
  if (data.view) lines.push(...renderPointInTime(data.view), "", "Stream:");
  if (data.events.length === 0) lines.push("No events in this window.");
  lines.push(...data.events.map(renderEventLine));
  lines.push("");
  lines.push(
    `${data.total} event${data.total === 1 ? "" : "s"} from ${data.window.since} to ${data.window.until}` +
      (data.omitted > 0 ? `; showing the newest ${data.events.length} (--limit)` : "") +
      ` across ${data.repositories.length} repositories in ${data.durationMs} ms.`
  );
  lines.push(...renderSources(data.sources));
  return lines;
}

/** `--ndjson` without `--follow`: one event per line, nothing else. */
export function renderTimelineNdjson(response: CommandSuccess<TimelineData>): string[] {
  return response.data.events.map((event) => JSON.stringify(event));
}

export interface TimelineFollowIo {
  write: (line: string) => void;
  signal: AbortSignal;
  json: boolean;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  maxPolls?: number;
}

/** `--follow`: stream events as they appear, as NDJSON (`--json`/`--ndjson`) or one line each, until interrupted. */
export async function runTimelineFollow(options: TimelineCommandOptions, io: TimelineFollowIo): Promise<{ polls: number; emitted: number }> {
  const filters = parseTimelineFilters(options);
  const limit = parsePositive(options.limit, "--limit", DEFAULT_TIMELINE_LIMIT);
  const intervalMs = parsePositive(options.interval, "--interval", DEFAULT_FOLLOW_INTERVAL_MS / 1000) * 1000;
  const now = io.now ?? (() => new Date());
  const first = resolveWindow({ since: options.since, asOf: undefined, now: now() });
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return followTimeline({
    since: first.since,
    now,
    intervalMs,
    backlogLimit: limit,
    signal: io.signal,
    sleep: io.sleep,
    maxPolls: io.maxPolls,
    collect: async (window) => (await collectTimeline({ workspacePath, window, filters, includePullRequests: options.pullRequests === true, now: window.until })).events,
    emit: (event) => io.write(io.json ? JSON.stringify(event) : renderEventLine(event))
  });
}
