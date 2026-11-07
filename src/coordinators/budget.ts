/**
 * Coordinator context budget (Issue #2242): change (1) of the coordinator
 * handoff design (PR #2223, `docs/agent-guidance/coordinator-handoff-design.md`,
 * "(a) Trigger" and "(g) The vital few first changes").
 *
 * Pure: every input is text or a value passed in. It reads the host's own
 * session files as data, calls no model, starts nothing and grants nothing.
 * `src/commands/coordinatorBudget.ts` does the file reads, the pings and the
 * markers, on the existing `arcadia production liveness-check` timer.
 *
 * Fields relied on, each verified on a real file on this host on 2026-11-07:
 *
 * - **Claude Code transcript** (`~/.claude/projects/<dir>/<session>.jsonl`):
 *   the last `{"type":"custom-title","customTitle"}` line is the session title;
 *   each main-chain (`isSidechain` false) `{"type":"assistant"}` line carries
 *   `message.model` and `message.usage` with `input_tokens`,
 *   `cache_creation_input_tokens` and `cache_read_input_tokens`; a
 *   `{"type":"system","subtype":"compact_boundary"}` line carries
 *   `compactMetadata.preTokens` and `postTokens`. The window is not in the
 *   transcript.
 * - **Codex rollout** (`~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`):
 *   `{"type":"session_meta","payload":{"id"}}`; each
 *   `{"type":"event_msg","payload":{"type":"token_count","info"}}` carries
 *   `info.last_token_usage.input_tokens` (cached input is a subset of it) and
 *   `info.model_context_window`; `{"type":"compacted"}` marks a compaction.
 *   The title is `thread_name` in `~/.codex/session_index.jsonl`.
 */

export const COORDINATOR_BUDGET_SCHEMA = "arcadia-coordinator-budget-v1" as const;

/** The design's starting values, to be recalibrated after ten recorded renewals. */
export const BUDGET_THRESHOLDS = { prepare: 50, due: 60, forced: 75 } as const;
export type ThresholdLevel = keyof typeof BUDGET_THRESHOLDS;
export const THRESHOLD_LEVELS: readonly ThresholdLevel[] = ["prepare", "due", "forced"];
export type BudgetLevel = "ok" | ThresholdLevel | "unmeasured";
export type PageLevel = ThresholdLevel | "unmeasured";

/**
 * Just after a compaction a Codex rollout has no token count yet. That gap
 * lasts until the next turn, so it is not paged as unmeasured for this long
 * after the compaction (review R1-2).
 */
export const UNMEASURED_AFTER_COMPACTION_MINUTES = 10;

/**
 * A session that has written no main-chain usage yet is unmeasured, but it
 * does not page in its first hour: at the worst growth observed (29 points an
 * hour, design "(a) Trigger") a new session cannot pass the forced line in an
 * hour, and paging every freshly titled coordinator would train the operator
 * to ignore the page.
 */
export const UNMEASURED_FRESH_MINUTES = 60;

export type CoordinatorAgent = "claude" | "codex";
export type CoordinatorRole = "signal" | "rowan";

/**
 * The title is the registration. AGENTS.md has every coordinator lead its title
 * with 🚦 and the Signal skill has Signal lead with ⭐; helpers lead with ↳.
 * Matching the leading emoji needs no extra step a coordinator could forget.
 */
export function coordinatorRoleOfTitle(title: string | null | undefined): CoordinatorRole | null {
  const text = (title ?? "").trimStart();
  if (text.startsWith("⭐")) return "signal";
  if (text.startsWith("🚦")) return "rowan";
  return null;
}

/**
 * Claude windows are in no file Arcadia reads, so each model is registered by
 * hand with its evidence. A model missing here is `unmeasured`, never guessed.
 * A registered window below an observed compaction's `preTokens` is refused.
 *
 * A window registered too large pages late, the dangerous direction, so a model
 * is registered only when the status line reports its window or a local
 * transcript already held more than 80% of it. Unregistered on that rule on
 * 2026-11-07: claude-opus-5 (largest seen 615,259), claude-fable-5-1 (341,438)
 * and claude-haiku-4-5 (131,430).
 */
export const CLAUDE_CONTEXT_WINDOWS: Readonly<Record<string, { tokens: number; evidence: string }>> = {
  "claude-opus-5-5": {
    tokens: 1_000_000,
    evidence: "inferred: compactions at compact_boundary.preTokens up to 980,277 in local transcripts on 2026-11-07, so the window is at least that"
  },
  "claude-sonnet-5-5": {
    tokens: 1_000_000,
    evidence: "inferred: compactions at compact_boundary.preTokens up to 971,999 in local transcripts on 2026-11-07"
  },
  "claude-haiku-5-5": {
    tokens: 1_000_000,
    evidence: "inferred: main-chain usage up to 856,308 tokens in local transcripts on 2026-11-07"
  },
  "claude-sonnet-5": {
    tokens: 1_000_000,
    evidence: "observed: status-line context_window.context_window_size 1000000 for claude-sonnet-5 on 2026-11-07"
  }
};

export type Occupancy =
  | {
      kind: "measured";
      tokens: number;
      window: number;
      percent: number;
      /** Which field the tokens came from. */
      tokensSource: string;
      /** Where the window came from. */
      windowSource: string;
      /** The timestamp of the line the tokens came from. */
      at: string | null;
    }
  | { kind: "unmeasured"; reason: string };

export interface SessionRead {
  agent: CoordinatorAgent;
  sessionId: string | null;
  title: string | null;
  model: string | null;
  occupancy: Occupancy;
  /** The last compaction's timestamp, which starts a new episode; null when none. */
  episodeStart: string | null;
  /** Main-chain turns since the episode started: the design's coarse proxy when unmeasured. */
  turns: number;
  /** True when the session has written no main-chain usage at all yet. */
  noUsageYet: boolean;
}

function parse(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function measured(tokens: number, window: number, tokensSource: string, windowSource: string, at: string | null): Occupancy {
  if (tokens > window) {
    return { kind: "unmeasured", reason: `${tokens.toLocaleString("en-US")} tokens exceed the ${window.toLocaleString("en-US")}-token window (${windowSource}), so the window is wrong` };
  }
  return { kind: "measured", tokens, window, percent: (tokens / window) * 100, tokensSource, windowSource, at };
}

export interface ClaudeWindowHint {
  /** The status line's capture, used only when its session id is this session's. */
  sessionId: string | null;
  windowSize: number | null;
}

/** Reads a Claude Code transcript's text. Only the lines it needs are parsed. */
export function readClaudeTranscript(
  content: string,
  options: { statusLine?: ClaudeWindowHint | null; windows?: Readonly<Record<string, { tokens: number; evidence: string }>> } = {}
): SessionRead {
  const windows = options.windows ?? CLAUDE_CONTEXT_WINDOWS;
  let sessionId: string | null = null;
  let title: string | null = null;
  let model: string | null = null;
  let usage: { tokens: number; at: string | null } | null = null;
  let anyUsage = false;
  let episodeStart: string | null = null;
  let postTokens: number | null = null;
  let maxPreTokens = 0;
  const turnIds = new Set<string>();
  let anonymousTurns = 0;

  for (const line of content.split("\n")) {
    if (line === "") continue;
    const isTitle = line.includes("\"custom-title\"");
    const isBoundary = line.includes("\"compact_boundary\"");
    const isAssistant = line.includes("\"assistant\"") && line.includes("\"usage\"");
    if (!isTitle && !isBoundary && !isAssistant) continue;
    const entry = parse(line);
    if (!entry) continue;
    sessionId = text(entry.sessionId) ?? sessionId;
    if (entry.type === "custom-title") {
      title = text(entry.customTitle) ?? title;
      continue;
    }
    if (entry.isSidechain === true) continue;
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      const meta = record(entry.compactMetadata);
      maxPreTokens = Math.max(maxPreTokens, count(meta?.preTokens) ?? 0);
      postTokens = count(meta?.postTokens);
      episodeStart = text(entry.timestamp) ?? episodeStart;
      usage = null;
      turnIds.clear();
      anonymousTurns = 0;
      continue;
    }
    if (entry.type !== "assistant") continue;
    const message = record(entry.message);
    const lineModel = text(message?.model);
    const lineUsage = record(message?.usage);
    if (!lineUsage || lineModel === "<synthetic>") continue;
    const input = count(lineUsage.input_tokens);
    const created = count(lineUsage.cache_creation_input_tokens);
    const read = count(lineUsage.cache_read_input_tokens);
    if (input === null && created === null && read === null) continue;
    model = lineModel ?? model;
    usage = { tokens: (input ?? 0) + (created ?? 0) + (read ?? 0), at: text(entry.timestamp) };
    anyUsage = true;
    const id = text(message?.id);
    if (id) turnIds.add(id); else anonymousTurns += 1;
  }

  const base = { agent: "claude" as const, sessionId, title, model, episodeStart, turns: turnIds.size + anonymousTurns, noUsageYet: !anyUsage };
  const tokens = usage ?? (postTokens !== null ? { tokens: postTokens, at: episodeStart } : null);
  const tokensSource = usage ? "transcript usage" : "transcript compact_boundary.postTokens";
  if (!tokens) return { ...base, occupancy: { kind: "unmeasured", reason: "no main-chain assistant usage in the transcript yet" } };

  const hint = options.statusLine;
  const fromStatusLine = hint && sessionId && hint.sessionId === sessionId && hint.windowSize ? hint.windowSize : null;
  const registered = model ? windows[model] : undefined;
  const window = fromStatusLine
    ? { tokens: fromStatusLine, source: "status line, this session" }
    : registered ? { tokens: registered.tokens, source: `registered for ${model}` } : null;
  if (!window) {
    return { ...base, occupancy: { kind: "unmeasured", reason: `no registered context window for model ${model ?? "unknown"}` } };
  }
  if (maxPreTokens > window.tokens) {
    return { ...base, occupancy: { kind: "unmeasured", reason: `the ${window.tokens.toLocaleString("en-US")}-token window (${window.source}) is below an observed compaction of ${maxPreTokens.toLocaleString("en-US")} tokens` } };
  }
  return { ...base, occupancy: measured(tokens.tokens, window.tokens, tokensSource, window.source, tokens.at) };
}

/** Reads a Codex rollout's text. Only the lines it needs are parsed. */
export function readCodexRollout(content: string, title: string | null = null): SessionRead {
  let sessionId: string | null = null;
  let model: string | null = null;
  let last: { tokens: number; window: number | null; at: string | null } | null = null;
  let anyUsage = false;
  let episodeStart: string | null = null;
  let turns = 0;

  for (const line of content.split("\n")) {
    if (line === "") continue;
    const isMeta = line.includes("\"session_meta\"");
    const isCount = line.includes("\"token_count\"");
    const isCompacted = line.includes("\"compacted\"");
    const isTurn = line.includes("\"turn_context\"");
    if (!isMeta && !isCount && !isCompacted && !isTurn) continue;
    const entry = parse(line);
    if (!entry) continue;
    const payload = record(entry.payload);
    if (entry.type === "session_meta") {
      sessionId = text(payload?.id) ?? sessionId;
    } else if (entry.type === "turn_context") {
      model = text(payload?.model) ?? model;
      turns += 1;
    } else if (entry.type === "compacted") {
      episodeStart = text(entry.timestamp) ?? episodeStart;
      last = null;
      turns = 0;
    } else if (entry.type === "event_msg" && payload?.type === "token_count") {
      const info = record(payload.info);
      const input = count(record(info?.last_token_usage)?.input_tokens);
      if (input === null) continue;
      last = { tokens: input, window: count(info?.model_context_window), at: text(entry.timestamp) };
      anyUsage = true;
    }
  }

  const base = { agent: "codex" as const, sessionId, title, model, episodeStart, turns, noUsageYet: !anyUsage };
  if (!last) {
    return { ...base, occupancy: { kind: "unmeasured", reason: anyUsage ? "compacted since its last token count" : "no token_count event in the rollout yet" } };
  }
  if (!last.window) return { ...base, occupancy: { kind: "unmeasured", reason: "its last token_count carries no model_context_window" } };
  return { ...base, occupancy: measured(last.tokens, last.window, "rollout token_count", "rollout model_context_window", last.at) };
}

export function levelOf(occupancy: Occupancy): BudgetLevel {
  if (occupancy.kind === "unmeasured") return "unmeasured";
  if (occupancy.percent >= BUDGET_THRESHOLDS.forced) return "forced";
  if (occupancy.percent >= BUDGET_THRESHOLDS.due) return "due";
  if (occupancy.percent >= BUDGET_THRESHOLDS.prepare) return "prepare";
  return "ok";
}

/** True when the coordinator should start its handoff now: due, forced, or unreadable (design: unmeasured is due at once). */
export function handoffDue(level: BudgetLevel): boolean {
  return level === "due" || level === "forced" || level === "unmeasured";
}

export interface PagedRecord {
  pingId: string;
  at: string;
}

export interface SessionBudgetState {
  agent: CoordinatorAgent;
  sessionId: string;
  title: string | null;
  episodeStart: string | null;
  paged: Partial<Record<PageLevel, PagedRecord>>;
  lastSeen: string;
}

export interface CoordinatorBudgetState {
  schema: typeof COORDINATOR_BUDGET_SCHEMA;
  sessions: Record<string, SessionBudgetState>;
}

export function emptyBudgetState(): CoordinatorBudgetState {
  return { schema: COORDINATOR_BUDGET_SCHEMA, sessions: {} };
}

export function sessionKey(agent: CoordinatorAgent, sessionId: string): string {
  return `${agent}:${sessionId}`;
}

/**
 * Which page, if any, this reading opens, and the paged set it starts from.
 * Once per threshold per episode: a compaction starts a new episode. A jump
 * past several lines pages only the highest; the caller marks the lower ones
 * paged with it, so they never page late.
 */
export function decidePage(
  previous: SessionBudgetState | undefined,
  read: Pick<SessionRead, "episodeStart" | "occupancy" | "noUsageYet">,
  options: { fileAgeMinutes: number; now?: Date }
): { page: PageLevel | null; paged: Partial<Record<PageLevel, PagedRecord>> } {
  // An episode pages each line at most once: the ping outbox's episode key
  // enforces the same rule, so a reading that wobbles across a line never
  // re-pages within the episode (review R1-1).
  const paged: Partial<Record<PageLevel, PagedRecord>> =
    previous && previous.episodeStart === read.episodeStart ? { ...previous.paged } : {};
  const level = levelOf(read.occupancy);
  if (read.occupancy.kind === "measured") {
    if (level === "ok" || level === "unmeasured") return { page: null, paged };
    return { page: paged[level] ? null : level, paged };
  }
  if (paged.unmeasured) return { page: null, paged };
  if (read.noUsageYet && options.fileAgeMinutes < UNMEASURED_FRESH_MINUTES) return { page: null, paged };
  if (read.episodeStart && options.now) {
    const since = (options.now.getTime() - Date.parse(read.episodeStart)) / 60_000;
    if (since >= 0 && since < UNMEASURED_AFTER_COMPACTION_MINUTES) return { page: null, paged };
  }
  return { page: "unmeasured", paged };
}

/** The paged set after `page` was queued: the page's level and every lower threshold. */
export function markPaged(
  paged: Partial<Record<PageLevel, PagedRecord>>,
  page: PageLevel,
  record: PagedRecord
): Partial<Record<PageLevel, PagedRecord>> {
  const next = { ...paged, [page]: record };
  if (page !== "unmeasured") {
    for (const threshold of THRESHOLD_LEVELS) {
      if (BUDGET_THRESHOLDS[threshold] <= BUDGET_THRESHOLDS[page] && !next[threshold]) next[threshold] = record;
    }
  }
  return next;
}

/** Fixed per session, level and episode, and carried in the message, so the outbox recognises a retry after a lost state file. */
export function budgetEpisodeKey(agent: CoordinatorAgent, sessionId: string, page: PageLevel): string {
  return `budget ${page} ${agent}:${sessionId}`;
}

function shortTitle(title: string | null, agent: CoordinatorAgent, sessionId: string): string {
  const base = (title ?? `${agent} session ${sessionId.slice(0, 8)}`).replace(/\s+/g, " ").trim();
  return base.length > 60 ? `${base.slice(0, 59)}…` : base;
}

const SUCCESSOR = "ask it for its paste-ready handoff prompt (arcadia-handoff skill) and paste that into a new session";

/** `arcadia ping` takes 500 characters; the head and the episode key always survive, the detail is cut. */
export function fitBudgetPing(head: string, detail: string, tail: string, max = 500): string {
  const whole = `${head}${detail}${tail}`;
  if (whole.length <= max) return whole;
  const room = Math.max(0, max - head.length - tail.length - 1);
  return `${head}${detail.slice(0, room)}…${tail}`.slice(0, max);
}

export function budgetPingMessage(read: SessionRead & { sessionId: string }, page: PageLevel): string {
  const name = shortTitle(read.title, read.agent, read.sessionId);
  const key = budgetEpisodeKey(read.agent, read.sessionId, page);
  const tail = ` It sees this on its next turn through \`arcadia coordinator budget\`. Nothing was started (${key}).`;
  const occupancy = read.occupancy;
  if (occupancy.kind === "unmeasured" || page === "unmeasured") {
    const reason = occupancy.kind === "unmeasured" ? occupancy.reason : "unreadable";
    return fitBudgetPing(
      `👆👆 HANDOFF DUE: ${name} context unmeasured — treat it as due: start its successor: ${SUCCESSOR}.`,
      ` Unmeasured because ${reason}; a coarse proxy only: ${read.turns} main-chain turns since its last compaction.`,
      tail
    );
  }
  const percent = Math.floor(occupancy.percent);
  const detail = ` ${occupancy.tokens.toLocaleString("en-US")} of ${occupancy.window.toLocaleString("en-US")} tokens (${occupancy.tokensSource}; window ${occupancy.windowSource}).`;
  switch (page) {
    case "prepare":
      return fitBudgetPing(`👆 HANDOFF PREPARE: ${name} at ${percent}% context — it brings its handoff notes up to date now; the handoff is due at ${BUDGET_THRESHOLDS.due}%.`, detail, tail);
    case "due":
      return fitBudgetPing(`👆👆 HANDOFF DUE: ${name} at ${percent}% context — start its successor: ${SUCCESSOR}.`, detail, tail);
    case "forced":
      return fitBudgetPing(`👆👆👆 HANDOFF OVERDUE: ${name} at ${percent}% context, past the ${BUDGET_THRESHOLDS.forced}% forced line — start its successor now: ${SUCCESSOR}.`, detail, tail);
  }
}

/** What a coordinator reads on its next turn. Written by the timer; read by `arcadia coordinator budget`. */
export interface CoordinatorBudgetMarker {
  schema: typeof COORDINATOR_BUDGET_SCHEMA;
  agent: CoordinatorAgent;
  session_id: string;
  title: string | null;
  role: CoordinatorRole | null;
  level: BudgetLevel;
  handoff_due: boolean;
  percent: number | null;
  tokens: number | null;
  window: number | null;
  unmeasured_reason: string | null;
  measured_at: string;
  transcript: string;
  next_step: string;
  pings: Partial<Record<PageLevel, PagedRecord>>;
}

export function nextStepFor(level: BudgetLevel): string {
  switch (level) {
    case "ok":
      return "Nothing to do.";
    case "prepare":
      return `Bring your handoff notes up to date now; the handoff is due at ${BUDGET_THRESHOLDS.due}%.`;
    case "due":
      return "Start your handoff at the next safe point: write the paste-ready successor prompt with the arcadia-handoff skill and give it to the operator.";
    case "forced":
      return "Stop new work and hand off now: write the paste-ready successor prompt with the arcadia-handoff skill and give it to the operator.";
    case "unmeasured":
      return "Your context could not be measured, so treat the handoff as due: write the paste-ready successor prompt with the arcadia-handoff skill.";
  }
}
