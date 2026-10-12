import { accessSync, constants } from "node:fs";
import path from "node:path";
import { getWorkspacePaths } from "../workspace/paths.js";
import { agentGoTransportState, preservationTransportReady, transportHeartbeatDiagnostic } from "../sessions/preservationTransport.js";

/**
 * An environment wall is a missing capability a coding Session needs to finish
 * an Action -- writing the workspace database, running host validation,
 * producing a preservation receipt -- that no amount of further model effort
 * can supply. Both the pre-launch preflight and the no-diff stop name walls
 * with the same vocabulary so one blocker reads the same before and after.
 */
export type EnvironmentWallClass = "workspace_write" | "host_validation" | "preservation";

export interface EnvironmentWall {
  wallClass: EnvironmentWallClass;
  /** The line or diagnostic that established the wall. */
  evidence: string;
  /** What restores the capability; never a model retry. */
  remedy: string;
}

export const ENVIRONMENT_WALL_ESCALATION_KIND = "environment_wall";

const WALL_REMEDY: Record<EnvironmentWallClass, string> = {
  workspace_write:
    "Give the coding profile write access to the workspace directory (Claude Code: permissions.additionalDirectories; Codex: a workspace-write sandbox covering it).",
  host_validation:
    "Make host validation reachable from the Session: confirm the Arcadia worker's go route is READY, or run the validation outside the sandbox.",
  preservation:
    "Make preservation reachable from the Session: restart the Arcadia worker so the preservation route heartbeat is fresh, and confirm the broker can write its receipt."
};

const WALL_PATTERNS: ReadonlyArray<{ wallClass: EnvironmentWallClass; pattern: RegExp }> = [
  { wallClass: "workspace_write", pattern: /SQLITE_WORKSPACE_WRITE_DENIED|attempt to write a readonly database|cannot write the workspace database|workspace (?:database )?write (?:was )?denied/i },
  { wallClass: "host_validation", pattern: /(?:go test|validation|vitest|pnpm)[^\n]{0,120}(?:operation not permitted|sandbox|permission denied|refused)|(?:operation not permitted|sandbox)[^\n]{0,120}(?:go test|validation)/i },
  { wallClass: "preservation", pattern: /preservation[^\n]{0,80}(?:no receipt|did not (?:produce|write)|denied|not permitted|unreachable)|arcadia-preserve-broker[^\n]{0,120}(?:denied|not permitted|no receipt)/i }
];

function clip(text: string, max = 200): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}...` : line;
}

/** Walls a Session's own log reports (one per class, first matching line), in a stable order. */
export function detectEnvironmentWalls(log: string | null): EnvironmentWall[] {
  if (!log) return [];
  const lines = log.split(/\r?\n/);
  const found: EnvironmentWall[] = [];
  for (const { wallClass, pattern } of WALL_PATTERNS) {
    const hit = lines.find((line) => pattern.test(line));
    if (hit) found.push({ wallClass, evidence: clip(hit), remedy: WALL_REMEDY[wallClass] });
  }
  return found;
}

/**
 * Pre-launch capability preflight: can a Session admitted now reach the
 * workspace database, host validation and preservation? Deterministic,
 * read-only, spends no tokens. The go route is only a wall when absent
 * (`unavailable`); `busy` is a transient wait, not a missing capability.
 */
export function probeSessionCapability(workspace: string): EnvironmentWall[] {
  const walls: EnvironmentWall[] = [];
  const { databaseFile } = getWorkspacePaths(workspace);
  try {
    accessSync(databaseFile, constants.W_OK);
    accessSync(path.dirname(databaseFile), constants.W_OK);
  } catch (error) {
    walls.push({ wallClass: "workspace_write", evidence: clip(error instanceof Error ? error.message : String(error)), remedy: WALL_REMEDY.workspace_write });
  }
  if (!preservationTransportReady(workspace)) {
    walls.push({ wallClass: "preservation", evidence: clip(transportHeartbeatDiagnostic(workspace, "preservation")), remedy: WALL_REMEDY.preservation });
  } else if (agentGoTransportState(workspace) === "unavailable") {
    walls.push({ wallClass: "host_validation", evidence: clip(transportHeartbeatDiagnostic(workspace, "go")), remedy: WALL_REMEDY.host_validation });
  }
  return walls;
}

/** The single named blocker text for a set of walls. */
export function describeEnvironmentWalls(
  actionKey: string,
  walls: EnvironmentWall[],
  stage: "preflight" | "exit",
  inputTokens?: number | null
): { message: string; remedy: string } {
  const names = walls.map((wall) => wall.wallClass).join(", ");
  const evidence = walls.map((wall) => `${wall.wallClass}: ${wall.evidence}`).join("; ");
  const tail = inputTokens ? ` The attempt spent ${inputTokens} input tokens.` : "";
  const message = stage === "preflight"
    ? `Environment wall for ${actionKey} (${names}); no Session was launched and no tokens were spent. ${evidence}`
    : `Environment wall for ${actionKey} (${names}): the Session exited with no diff and will not be relaunched automatically.${tail} ${evidence}`;
  const remedy = `${walls.map((wall) => wall.remedy).join(" ")} Then reset this Action's repair budget so production relaunches it.`;
  return { message, remedy };
}

/** Input/output tokens a provider log reports (Claude `result` usage, Codex `turn.completed` usage); null when it reports none. */
export function sessionTokensFromLog(log: string | null): { inputTokens: number; outputTokens: number } | null {
  if (!log) return null;
  let input = 0;
  let output = 0;
  let seen = false;
  const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  for (const line of log.split(/\r?\n/)) {
    if (!line.startsWith("{") || !line.includes("usage")) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; usage?: Record<string, unknown> };
      if (!event.usage || (event.type !== "result" && event.type !== "turn.completed")) continue;
      seen = true;
      input += num(event.usage.input_tokens) + num(event.usage.cache_creation_input_tokens) + num(event.usage.cache_read_input_tokens);
      output += num(event.usage.output_tokens);
    } catch { /* not a JSON event line */ }
  }
  return seen ? { inputTokens: input, outputTokens: output } : null;
}
