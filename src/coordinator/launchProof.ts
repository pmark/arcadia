import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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

function realpathOrNull(target: string): string | null {
  try { return realpathSync(target); } catch { return null; }
}

/** realpath of the nearest existing ancestor, with the not-yet-existing remainder appended (a worktrees directory may not exist yet). */
function realpathThroughMissing(target: string): string {
  const resolved = path.resolve(target);
  const parts: string[] = [];
  for (let candidate = resolved; ; candidate = path.dirname(candidate)) {
    const real = realpathOrNull(candidate);
    if (real !== null) return path.join(real, ...parts.reverse());
    parts.push(path.basename(candidate));
    if (path.dirname(candidate) === candidate) return resolved;
  }
}

/**
 * Whether Claude Code already trusts `folder`: `projects[<dir>].hasTrustDialogAccepted === true` in `~/.claude.json`
 * for the folder or an ancestor. Decisions, each tested:
 *  - Paths are compared by realpath on both sides, so a symlink inside a trusted tree that points out is judged by
 *    where it really is (untrusted), and a symlinked repository path by its real path.
 *  - A trust grant that exists only because `/` or the user's home directory is trusted does not count: that is a
 *    blanket grant, not a decision about this folder, and the launch is refused naming it.
 *  - Ancestor inheritance itself is an ASSUMPTION (the go-broker trust setup in src/agentSetup/goBrokerAgentSetup.ts
 *    uses it, and P1 only showed a fresh folder failing). If Claude Code does not inherit trust, this check passes
 *    falsely and the launch stalls at the trust prompt, which the relay's delivery check then catches after its claim,
 *    worktree and tmux session exist. It does not fail closed on that point.
 * A missing or unreadable state file is "not trusted".
 */
export function claudeFolderTrust(folder: string, statePath: string = defaultClaudeStatePath(), home: string = homedir()): FolderTrust {
  const resolved = realpathThroughMissing(folder);
  let state: { projects?: Record<string, { hasTrustDialogAccepted?: unknown } | undefined> };
  try {
    state = JSON.parse(readFileSync(statePath, "utf8")) as typeof state;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { trusted: false, trustedFolder: null, detail: `Claude Code's trusted-folder state ${statePath} ${code === "ENOENT" ? "does not exist" : "cannot be read"}, so ${resolved} cannot be shown to be trusted.` };
  }
  const trusted = new Set<string>();
  for (const [key, entry] of Object.entries(state?.projects ?? {})) {
    if (entry?.hasTrustDialogAccepted === true) trusted.add(realpathOrNull(key) ?? path.resolve(key));
  }
  const homeReal = realpathOrNull(home) ?? path.resolve(home);
  const blanket: string[] = [];
  for (let candidate = resolved; ; candidate = path.dirname(candidate)) {
    if (trusted.has(candidate)) {
      if (candidate === path.parse(candidate).root || candidate === homeReal) blanket.push(candidate);
      else return { trusted: true, trustedFolder: candidate, detail: `${resolved} is trusted (via ${candidate}).` };
    }
    if (path.dirname(candidate) === candidate) break;
  }
  if (blanket.length > 0) {
    return { trusted: false, trustedFolder: null, detail: `${resolved} is trusted only through ${blanket.join(" and ")}, a blanket grant (the filesystem root or the home directory) that Arcadia does not accept for an unattended launch; have the operator trust ${resolved} itself.` };
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
  /**
   * True only when `claude agents --json` lists a row in this launch's cwd that matches the printed id, or the one row
   * with this launch's exact name and cwd. An unverified result is never a stop target: `stopId` is null.
   */
  verified: boolean;
  /** The id `claude stop` takes; null unless verified. */
  stopId: string | null;
  /** The full session UUID when the host exposed one, else null. */
  sessionId: string | null;
  /** An id seen in the launch output that no agents row confirmed; informational only, never recorded as the session. */
  unverifiedPrintedId: string | null;
  source: "agents-json" | "unverified";
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

function verifiedSession(row: AgentRow): BackgroundSession | null {
  const sessionId = [text(row.sessionId), text(row.id)].find((value) => value !== null && FULL_ID.test(value)) ?? null;
  const stopId = text(row.id) ?? sessionId;
  if (stopId === null) return null;
  return { verified: true, stopId, sessionId, unverifiedPrintedId: null, source: "agents-json", cwd: text(row.cwd), model: text(row.model), effort: text(row.effort) ?? text(row.reasoningEffort) };
}

/**
 * The real session of a `claude --bg` launch. `--bg` prints "--bg manages the session id; ignoring --session-id" and
 * assigns its own id (P2: pinned `a63607ad...` ignored, host chose `686736ac...`), so the id we asked for is never
 * recorded. Launch output is free text: any 8-hex token in it (a date such as 20261112, a count, a version) is only a
 * CANDIDATE. An id is accepted only through `claude agents --json`:
 *  1. a row in this launch's cwd whose id or sessionId equals or starts with a printed token; else
 *  2. the single row with this launch's exact name and cwd (the keeper may retitle itself, so a printed-id match does
 *     not require the name; the name match is the fallback for output that printed nothing usable).
 * Otherwise the result is `verified: false` with a null `stopId`: the caller must not record a stop target, and the
 * printed candidate is kept only for the error message.
 */
export function discoverBackgroundSession(input: { launchOutput: string; agentsJson: string | null; name: string; cwd: string }): BackgroundSession {
  const rows = input.agentsJson === null ? null : parseAgentRows(input.agentsJson);
  // The ignored-session-id notice itself contains no id; strip it so a hex word in it can never be read as one.
  const printedText = input.launchOutput.split("\n").filter((line) => !/ignoring --session-id/i.test(line)).join("\n");
  const tokens = [...printedText.matchAll(new RegExp(FULL_ID.source, "gi")), ...printedText.matchAll(new RegExp(SHORT_ID.source, "gi"))].map((match) => match[0].toLowerCase());
  const unverified: BackgroundSession = { verified: false, stopId: null, sessionId: null, unverifiedPrintedId: tokens[0] ?? null, source: "unverified", cwd: null, model: null, effort: null };
  if (rows === null) return unverified;
  const resolvedCwd = path.resolve(input.cwd);
  const inCwd = rows.filter((candidate) => typeof candidate.cwd === "string" && path.resolve(candidate.cwd) === resolvedCwd);
  const printedMatches = inCwd.filter((candidate) => [candidate.id, candidate.sessionId].some((value) => typeof value === "string" && tokens.some((token) => value.toLowerCase() === token || value.toLowerCase().startsWith(token))));
  if (printedMatches.length === 1) return verifiedSession(printedMatches[0]) ?? unverified;
  if (printedMatches.length === 0) {
    const named = inCwd.filter((candidate) => candidate.name === input.name);
    if (named.length === 1) return verifiedSession(named[0]) ?? unverified;
  }
  return unverified;
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
