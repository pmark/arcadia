import { accessSync, constants } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { agentGoTransportState, preservationTransportReady, transportHeartbeatDiagnostic } from "../sessions/transportHeartbeat.js";

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
 * Pre-launch WORKER probe: can the host worker reach the workspace database,
 * host validation and preservation transports? Deterministic, read-only,
 * spends no tokens. The go route is only a wall when absent (`unavailable`);
 * `busy` is a transient wait, not a missing capability.
 *
 * This is evidence about the worker and the host, never about the Session:
 * the file-access check runs as the host worker, which can always write the
 * workspace. What the *Session's* sandbox may write lives in the provider's
 * runtime configuration and is not readable offline, so only the in-Session
 * probe (`scripts/session-capability-probe.mjs`, the Session's first step,
 * parsed by `parseSessionProbe`) is truthful. The one fact knowable offline is
 * the profile's declared sandbox mode: `read-only` can never write the
 * workspace database.
 */
export function probeWorkerCapability(workspace: string, profileSandbox?: string | null): EnvironmentWall[] {
  const walls: EnvironmentWall[] = [];
  if (profileSandbox === "read-only") {
    walls.push({
      wallClass: "workspace_write",
      evidence: "the selected coding profile declares a read-only sandbox, which cannot write the workspace database",
      remedy: WALL_REMEDY.workspace_write
    });
  }
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

/**
 * The one preflight every launch path runs (guarded launch, `arcadia go
 * --launch`): refuses with the named walls and remedy before anything is
 * admitted, prepared or spawned. `override` is a caller's or test's probe;
 * without one the real probe runs, except under Vitest (like the provider
 * prerequisites). A `conflict` refusal, so the production tick treats it as a
 * wait state rather than a counted launch failure.
 */
export function assertWorkerCapability(input: {
  workspace: string;
  actionLabel: string;
  profileSandbox: string | null;
  override?: (workspace: string, profileSandbox: string | null) => EnvironmentWall[];
}): void {
  const walls = input.override
    ? input.override(input.workspace, input.profileSandbox)
    : process.env.VITEST ? [] : probeWorkerCapability(input.workspace, input.profileSandbox);
  if (walls.length === 0) return;
  const named = describeEnvironmentWalls(input.actionLabel, walls, "preflight");
  throw validationError(named.message, { code: "session_environment_wall", walls, remedy: named.remedy, conflict: true });
}

/** The single named blocker text for a set of walls. */
export function describeEnvironmentWalls(
  actionKey: string,
  walls: EnvironmentWall[],
  stage: "preflight" | "exit" | "session_probe",
  inputTokens?: number | null
): { message: string; remedy: string } {
  const names = walls.map((wall) => wall.wallClass).join(", ");
  const evidence = walls.map((wall) => `${wall.wallClass}: ${wall.evidence}`).join("; ");
  const tail = inputTokens ? ` The attempt spent ${inputTokens} input tokens.` : "";
  const message = stage === "preflight"
    ? `Environment wall for ${actionKey} (${names}) found by the worker probe (host-side, not Session evidence); no Session was launched and no tokens were spent. ${evidence}`
    : stage === "session_probe"
      ? `Environment wall for ${actionKey} (${names}) found by the session probe, run inside the Session as its first step (recorded probe budget ${SESSION_PROBE_TOKEN_BUDGET} tokens): the Session was told to stop before spending and will not be relaunched automatically.${tail} ${evidence}`
      : `Environment wall for ${actionKey} (${names}): the Session exited with no diff and will not be relaunched automatically.${tail} ${evidence}`;
  const remedy = `${walls.map((wall) => wall.remedy).join(" ")} Then reset this Action's repair budget so production relaunches it.`;
  return { message, remedy };
}

/** Input/output tokens a provider log reports (Claude `result` usage, Codex `turn.completed` usage); null when it reports none. */
export function sessionTokensFromLog(log: string | null): { inputTokens: number; cachedInputTokens: number; outputTokens: number } | null {
  if (!log) return null;
  let input = 0;
  let output = 0;
  let cached = 0;
  let seen = false;
  const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  for (const line of log.split(/\r?\n/)) {
    if (!line.startsWith("{") || !line.includes("usage")) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; usage?: Record<string, unknown> };
      if (!event.usage || (event.type !== "result" && event.type !== "turn.completed")) continue;
      seen = true;
      if (event.type === "turn.completed") {
        // Codex: input_tokens is the TOTAL and cached_input_tokens a subset of it.
        const total = num(event.usage.input_tokens);
        const subset = Math.min(num(event.usage.cached_input_tokens), total);
        input += total - subset;
        cached += subset;
      } else {
        // Claude `result`: input_tokens is uncached; the cache fields are separate and additive.
        input += num(event.usage.input_tokens);
        cached += num(event.usage.cache_creation_input_tokens) + num(event.usage.cache_read_input_tokens);
      }
      output += num(event.usage.output_tokens);
    } catch { /* not a JSON event line */ }
  }
  return seen ? { inputTokens: input, cachedInputTokens: cached, outputTokens: output } : null;
}

export const SESSION_PROBE_ID = "session-capability/v1";
/**
 * Recorded token expectation for the probe: one short Bash command (about two
 * thousand input tokens through the Session's cached context plus a one-line
 * result). The platform token ceiling still bounds the attempt; a failing
 * probe ends it here, before any further spend.
 */
export const SESSION_PROBE_TOKEN_BUDGET = 5_000;

export interface SessionProbeCheck { name: string; ok: boolean; error?: string }
export interface SessionProbeResult { probe: typeof SESSION_PROBE_ID; nonce?: string | null; ok: boolean; checks: SessionProbeCheck[]; ms?: number }

function probesFromString(text: string, nonce: string, out: SessionProbeResult[]): void {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes(SESSION_PROBE_ID)) continue;
    try {
      const value = JSON.parse(trimmed) as Partial<SessionProbeResult>;
      // Only a line echoing this Session's recorded nonce counts: a probe-looking
      // line from a cat'd file or injected text cannot carry it.
      if (value.probe === SESSION_PROBE_ID && value.nonce === nonce && typeof value.ok === "boolean" && Array.isArray(value.checks)) {
        out.push(value as SessionProbeResult);
      }
    } catch { /* not the probe line */ }
  }
}

function stringsIn(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out, depth + 1);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringsIn(item, out, depth + 1);
}

/**
 * The probe result a Session log carries for this Session's `nonce`: a bare
 * line (plain log) or one nested inside a provider event's tool-result text
 * (Claude stream-json, Codex JSONL). The FIRST failing line wins, so a later
 * spoofed passing line cannot mask a real failure; otherwise the last passing
 * line. Null when no nonce was issued or the Session never ran the probe.
 */
export function parseSessionProbe(log: string | null, nonce: string | null): SessionProbeResult | null {
  if (!log || !nonce || !log.includes(SESSION_PROBE_ID) || !log.includes(nonce)) return null;
  const found: SessionProbeResult[] = [];
  for (const line of log.split(/\r?\n/)) {
    if (!line.includes(SESSION_PROBE_ID)) continue;
    const candidates: string[] = [line];
    if (line.startsWith("{")) {
      try { stringsIn(JSON.parse(line), candidates); } catch { /* plain line */ }
    }
    for (const candidate of candidates) probesFromString(candidate, nonce, found);
  }
  return found.find((probe) => !probe.ok || probe.checks.some((check) => !check.ok)) ?? found[found.length - 1] ?? null;
}

/** Walls named by a failed session probe, one per failed check class; the probe JSON rides in the evidence. */
export function sessionProbeWalls(result: SessionProbeResult | null): EnvironmentWall[] {
  if (!result || (result.ok && result.checks.every((check) => check.ok))) return [];
  const failed: SessionProbeCheck[] = result.checks.filter((check) => !check.ok);
  const evidenceJson = clip(JSON.stringify(result), 600);
  const known: ReadonlySet<string> = new Set<EnvironmentWallClass>(["workspace_write", "host_validation", "preservation"]);
  const walls = new Map<EnvironmentWallClass, EnvironmentWall>();
  for (const check of failed.length > 0 ? failed : [{ name: "workspace_write", ok: false } as SessionProbeCheck]) {
    const wallClass = (known.has(check.name) ? check.name : "workspace_write") as EnvironmentWallClass;
    if (!walls.has(wallClass)) {
      walls.set(wallClass, { wallClass, evidence: `${check.name}: ${check.error ?? "failed"} | session probe ${evidenceJson}`, remedy: WALL_REMEDY[wallClass] });
    }
  }
  return [...walls.values()];
}
