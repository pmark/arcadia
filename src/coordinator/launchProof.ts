import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Deterministic launch-proof helpers shared by the relay (tmux) and the keeper
 * (`claude --bg`) launchers. They encode what probes P1 and P2 proved
 * (https://github.com/pmark/arcadia/issues/1929, run 2026-11-12, Decision 0227
 * D5 answer A) and nothing the probes did not prove:
 *
 *  1. An unattended launch must start in a folder Claude Code already trusts:
 *     a fresh folder stops at "Is this a project you trust?" before it receives
 *     the brief. `claudeFolderTrust` reads the host's trusted-folder state and
 *     the launchers refuse, naming the folder, rather than launch into the prompt.
 *  2. Under `claude --bg`, `--session-id` is ignored and the host assigns the id:
 *     `discoverBackgroundSession` takes the real id from the launcher's output or
 *     from `claude agents --json`, never from the id we asked for.
 *  3. The brief is delivered exactly: its SHA-256 is recorded and compared with
 *     the hash of the first user message the Session's transcript shows.
 *  4. The provider, model and effort recorded are the ones OBSERVED from the
 *     launched Session (its transcript and `claude agents --json`), never the
 *     requested values. An observation the host did not expose is recorded as
 *     null ("unobserved"), not filled in from the request.
 *
 * Pure of process spawning and clocks: file reads only, so tests need no real
 * `claude`. Nothing here launches, stops or authorizes anything.
 */

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Trusted folder precondition
// ---------------------------------------------------------------------------

export interface FolderTrust { trusted: boolean; detail: string; trustedFolder: string | null }

export const defaultClaudeStatePath = (home: string = homedir()): string => path.join(home, ".claude.json");

/**
 * Whether Claude Code already trusts `folder`: `projects[<dir>].hasTrustDialogAccepted === true` in `~/.claude.json`
 * for the folder or any ancestor (Claude Code applies a trusted parent to its subdirectories; this is the model the
 * existing go-broker trust setup in src/agentSetup/goBrokerAgentSetup.ts uses, and the one P1 is consistent with: only
 * the fresh, never-trusted fixture stopped). A missing or unreadable state file is "not trusted": the launch would
 * stop at the prompt, so it fails closed.
 */
export function claudeFolderTrust(folder: string, statePath: string = defaultClaudeStatePath()): FolderTrust {
  const resolved = path.resolve(folder);
  let state: { projects?: Record<string, { hasTrustDialogAccepted?: unknown } | undefined> };
  try {
    state = JSON.parse(readFileSync(statePath, "utf8")) as typeof state;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { trusted: false, trustedFolder: null, detail: `Claude Code's trusted-folder state ${statePath} ${code === "ENOENT" ? "does not exist" : "cannot be read"}, so ${resolved} cannot be shown to be trusted.` };
  }
  const projects = state?.projects ?? {};
  for (let candidate = resolved; ; candidate = path.dirname(candidate)) {
    if (projects[candidate]?.hasTrustDialogAccepted === true) return { trusted: true, trustedFolder: candidate, detail: `${resolved} is trusted (via ${candidate}).` };
    if (path.dirname(candidate) === candidate) break;
  }
  return {
    trusted: false, trustedFolder: null,
    detail: `${resolved} is not a folder Claude Code trusts: an unattended session there stops at "Is this a project you trust?" and never receives its brief. Launch only into an already-trusted folder, or have the operator trust it once interactively; Arcadia never writes the trust state itself.`
  };
}

// ---------------------------------------------------------------------------
// `claude --bg` session id discovery
// ---------------------------------------------------------------------------

const FULL_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const SHORT_ID = /\b[0-9a-f]{8}\b/i;

export interface BackgroundSession {
  /** The id `claude stop` takes. */
  stopId: string;
  /** The full session UUID when the host exposed one, else null. */
  sessionId: string | null;
  source: "launch-output" | "agents-json";
  cwd: string | null;
  /** Raw model/effort fields of the `claude agents --json` row, when it carries them. */
  model: string | null;
  effort: string | null;
}

interface AgentRow { id?: unknown; sessionId?: unknown; name?: unknown; cwd?: unknown; model?: unknown; effort?: unknown; reasoningEffort?: unknown; [key: string]: unknown }

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

export function parseAgentRows(json: string): AgentRow[] | null {
  let rows: unknown;
  try { rows = JSON.parse(json || "[]"); } catch { return null; }
  return Array.isArray(rows) ? rows.filter((row): row is AgentRow => row !== null && typeof row === "object") : null;
}

function describe(row: AgentRow, source: BackgroundSession["source"], fallbackId: string): BackgroundSession {
  const sessionId = [text(row.sessionId), text(row.id)].find((value) => value !== null && FULL_ID.test(value)) ?? null;
  return {
    stopId: text(row.id) ?? sessionId ?? fallbackId,
    sessionId, source, cwd: text(row.cwd),
    model: text(row.model),
    effort: text(row.effort) ?? text(row.reasoningEffort)
  };
}

/**
 * The real session of a `claude --bg` launch. `--bg` prints "--bg manages the session id; ignoring --session-id" and
 * assigns its own id (P2: pinned `a63607ad...` ignored, host chose `686736ac...`), so the id we asked for is never
 * recorded. In order: an id the launch output printed (matched to its `claude agents --json` row when that lists it),
 * else the single row of `claude agents --json` whose name and cwd are exactly the launch's. Anything ambiguous or
 * absent returns null; the caller refuses to record a guess.
 */
export function discoverBackgroundSession(input: { launchOutput: string; agentsJson: string | null; name: string; cwd: string }): BackgroundSession | null {
  const rows = input.agentsJson === null ? null : parseAgentRows(input.agentsJson);
  // The ignored-session-id notice itself contains no id; strip it so a hex word in it can never be read as one.
  const printedText = input.launchOutput.split("\n").filter((line) => !/ignoring --session-id/i.test(line)).join("\n");
  const printed = FULL_ID.exec(printedText)?.[0] ?? SHORT_ID.exec(printedText)?.[0] ?? null;
  if (printed !== null) {
    const row = rows?.find((candidate) => [candidate.id, candidate.sessionId].some((value) => typeof value === "string" && (value === printed || value.startsWith(printed))));
    if (row) return describe(row, "launch-output", printed);
    return { stopId: printed, sessionId: FULL_ID.test(printed) ? printed : null, source: "launch-output", cwd: null, model: null, effort: null };
  }
  if (rows) {
    const resolvedCwd = path.resolve(input.cwd);
    const matches = rows.filter((candidate) => candidate.name === input.name && typeof candidate.cwd === "string" && path.resolve(candidate.cwd) === resolvedCwd);
    if (matches.length === 1) return describe(matches[0], "agents-json", "");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Delivery and observation
// ---------------------------------------------------------------------------

export interface TranscriptObservation {
  /** Hash of the first main-chain user message (trimmed), or null before it exists. */
  deliveredSha: string | null;
  /** The model of the Session's latest main-chain assistant message, or null before its first reply. */
  model: string | null;
  /** An effort the transcript itself states, or null when it states none. */
  effort: string | null;
}

/** Reads one transcript. Deterministic; no model call. */
export function observeTranscript(transcriptPath: string): TranscriptObservation {
  const observed: TranscriptObservation = { deliveredSha: null, model: null, effort: null };
  if (!existsSync(transcriptPath)) return observed;
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: string; isSidechain?: boolean; isMeta?: boolean; effort?: unknown; reasoningEffort?: unknown; message?: { content?: unknown; model?: unknown; effort?: unknown } };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.isSidechain) continue;
    if (entry.type === "user" && !entry.isMeta && observed.deliveredSha === null) {
      const content = entry.message?.content;
      const body = typeof content === "string" ? content
        : Array.isArray(content) ? content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("")
          : null;
      if (body !== null) observed.deliveredSha = sha256(body.trim());
    }
    if (entry.type === "assistant" && typeof entry.message?.model === "string" && !entry.message.model.startsWith("<")) observed.model = entry.message.model;
    const effort = text(entry.effort) ?? text(entry.reasoningEffort) ?? text(entry.message?.effort);
    if (effort !== null) observed.effort = effort;
  }
  return observed;
}

export interface LaunchProof {
  schema: "arcadia-launch-proof-v1";
  transport: "tmux" | "bg";
  sessionId: string | null;
  /** SHA-256 of the exact brief handed to the launcher. */
  briefSha: string;
  /** SHA-256 of the first user message the Session's transcript shows; null when none was readable. */
  deliveredSha: string | null;
  /** True only when deliveredSha equals briefSha. */
  delivered: boolean;
  /** Observed values; null means the host did not expose it, never "same as requested". */
  observed: { provider: "claude"; model: string | null; effort: string | null };
  requested: { model: string; effort: string | null };
  /** False when an observed model is known and does not correspond to the requested one. null when unobserved. */
  modelMatchesRequest: boolean | null;
  effortMatchesRequest: boolean | null;
  warnings: string[];
  recordedAt: string;
}

/** A requested alias (`opus`, `sonnet`) matches an observed full id that contains it; an exact id matches itself. */
export function modelMatches(requested: string, observed: string): boolean {
  const want = requested.toLowerCase().replace(/\[.*\]$/, "");
  const have = observed.toLowerCase();
  return have === want || have.includes(want);
}

export function buildLaunchProof(input: {
  transport: LaunchProof["transport"];
  sessionId: string | null;
  brief: string;
  transcript: TranscriptObservation;
  /** Fields from `claude agents --json`, used only where the transcript did not state them. */
  agent?: { model: string | null; effort: string | null } | null;
  requestedModel: string;
  requestedEffort: string | null;
  now: Date;
}): LaunchProof {
  const briefSha = sha256(input.brief.trim());
  const model = input.transcript.model ?? input.agent?.model ?? null;
  const effort = input.transcript.effort ?? input.agent?.effort ?? null;
  const delivered = input.transcript.deliveredSha === briefSha;
  const warnings: string[] = [];
  if (input.transcript.deliveredSha === null) warnings.push("The Session's transcript shows no first user message yet, so brief delivery is unverified.");
  else if (!delivered) warnings.push(`The first user message in the transcript (sha ${input.transcript.deliveredSha.slice(0, 12)}) is not the brief (sha ${briefSha.slice(0, 12)}).`);
  if (model === null) warnings.push("The Session has not shown which model it runs (no assistant message and no model in `claude agents --json`); the model is recorded as unobserved, not as the requested value.");
  if (effort === null) warnings.push("Neither the transcript nor `claude agents --json` states the Session's effort; it is recorded as unobserved, not as the requested value.");
  const modelMatchesRequest = model === null ? null : modelMatches(input.requestedModel, model);
  const effortMatchesRequest = effort === null || input.requestedEffort === null ? null : effort.toLowerCase() === input.requestedEffort.toLowerCase();
  if (modelMatchesRequest === false) warnings.push(`Observed model ${model} does not correspond to the requested ${input.requestedModel}.`);
  if (effortMatchesRequest === false) warnings.push(`Observed effort ${effort} differs from the requested ${input.requestedEffort}.`);
  return {
    schema: "arcadia-launch-proof-v1",
    transport: input.transport,
    sessionId: input.sessionId,
    briefSha, deliveredSha: input.transcript.deliveredSha, delivered,
    observed: { provider: "claude", model, effort },
    requested: { model: input.requestedModel, effort: input.requestedEffort },
    modelMatchesRequest, effortMatchesRequest, warnings,
    recordedAt: input.now.toISOString()
  };
}
