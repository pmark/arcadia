import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import {
  classifyIdleFront,
  detectionsFromTimeline,
  idleFrontInputFromStatus,
  idleFrontTimelineEvents,
  parseArmedWakeFile,
  wakesFromProcesses,
  type ArmedWake,
  type IdleFrontRow
} from "../production/idleFront.js";
import { listWorkerMerges } from "../production/workerMerge.js";
import { collectTimeline } from "../timeline/index.js";
import { pingsCollector } from "../timeline/collectors/pings.js";
import { productionCollector } from "../timeline/collectors/production.js";
import { normalizeTime, type TimelineEvent } from "../timeline/schema.js";
import { runProductionStatusCommand } from "./production.js";
import { listProcesses, type ProcessRow } from "./productionLiveness.js";

/**
 * `arcadia production idle-front`: Momentum Keeper Layer 1, one read-only check.
 *
 * Reads production status, the worker-merge rows and the timeline's production
 * and ping records read-only, the process list (`ps`) and the armed-until
 * files, then prints one JSON row and the same check as timeline events
 * (NDJSON). It writes no file, table, ping or Project state, so it is safe
 * while production is Active and runs the same while it is Inactive.
 */

/** How far back detection evidence is read; an older block over-counts detection lag, never under-counts it. */
const DETECTION_LOOKBACK_MS = 48 * 3_600_000;
const MERGE_ROWS = 200;

export interface ProductionIdleFrontOptions {
  workspace?: string;
  /** Directory of armed-until heartbeat files; default `<workspace>/.arcadia/armed-wakes`. */
  wakesDir?: string;
  expectWake?: string[];
  tapReadyAt?: string;
  routeAt?: string;
}

export interface ProductionIdleFrontDependencies {
  now?: () => Date;
  listProcesses?: () => ProcessRow[];
}

export interface ProductionIdleFrontData {
  row: IdleFrontRow;
  events: TimelineEvent[];
  wakesDir: string;
  wakeReadProblems: string[];
}

function hint(value: string | undefined, flag: string, now: Date): string | undefined {
  if (value === undefined) return undefined;
  const time = normalizeTime(value);
  if (!time) throw validationError(`${flag} must be an ISO time.`, { [flag]: value });
  // A future time would clamp to now and read as a ready tap with zero minutes.
  if (Date.parse(time) > now.getTime()) throw validationError(`${flag} must not be later than now.`, { [flag]: value, now: now.toISOString() });
  return time;
}

function readWakeFiles(directory: string): { wakes: ArmedWake[]; problems: string[] } {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { wakes: [], problems: [] };
    return { wakes: [], problems: [`${directory}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const wakes: ArmedWake[] = [];
  const problems: string[] = [];
  for (const name of names) {
    let content: string;
    try {
      content = readFileSync(path.join(directory, name), "utf8");
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const parsed = parseArmedWakeFile(name, content);
    if (parsed.ok) wakes.push(parsed.wake);
    else problems.push(parsed.problem);
  }
  return { wakes, problems };
}

export async function runProductionIdleFrontCommand(
  options: ProductionIdleFrontOptions,
  dependencies: ProductionIdleFrontDependencies = {}
): Promise<CommandSuccess<ProductionIdleFrontData>> {
  const now = (dependencies.now ?? (() => new Date()))();
  const hints = { tapReadyAt: hint(options.tapReadyAt, "--tap-ready-at", now), routeAt: hint(options.routeAt, "--route-at", now) };
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const status = runProductionStatusCommand({ workspace: workspacePath }).data;
  const merges = withReadOnlyDatabase(workspacePath, (db) => listWorkerMerges(db, MERGE_ROWS));
  const timeline = await collectTimeline({
    workspacePath,
    window: { since: new Date(now.getTime() - DETECTION_LOOKBACK_MS), until: now },
    now,
    collectors: () => [productionCollector, pingsCollector]
  });
  const wakesDir = path.resolve(options.wakesDir ?? path.join(workspacePath, ".arcadia", "armed-wakes"));
  const files = readWakeFiles(wakesDir);
  let processes: ProcessRow[] | null = null;
  let processProblem: string | null = null;
  try {
    processes = (dependencies.listProcesses ?? listProcesses)();
  } catch (error) {
    // A slow or refused `ps` makes waiters unknown; it never stops the check.
    processProblem = `Could not list processes: ${error instanceof Error ? error.message : String(error)}`;
  }
  const wakes = [...wakesFromProcesses(processes ?? [], workspacePath), ...files.wakes];
  const input = idleFrontInputFromStatus(status, { now, merges, wakes, expectWakes: options.expectWake ?? [], hints });
  input.detections = detectionsFromTimeline(timeline.events, input.scopeActions);
  input.processesReadable = processes !== null;
  const row = classifyIdleFront(input);
  const failed = timeline.sources.filter((source) => source.error).map((source) => `Could not read ${source.describe}: ${source.error}`);
  if (failed.length > 0) row.notes.push("A detection source failed; detection lag may be over-counted.");
  return createSuccess({
    command: "production.idle-front",
    workspace: workspacePath,
    data: { row, events: idleFrontTimelineEvents(row, workspacePath), wakesDir, wakeReadProblems: files.problems },
    warnings: [...failed, ...(processProblem ? [processProblem] : []), ...files.problems.map((problem) => `Armed-wake file skipped: ${problem}`)]
  });
}

/** Line 1 is the JSON row; each further line is one timeline event (NDJSON). */
export function renderProductionIdleFrontSuccess(response: CommandSuccess<ProductionIdleFrontData>): string[] {
  return [JSON.stringify(response.data.row), ...response.data.events.map((event) => JSON.stringify(event))];
}
