/**
 * Deterministic classification of a live managed Session. No model calls, no
 * I/O: the classifier is a pure function over signals another layer already
 * gathered (tmux pane capture, `observeSessionActivity`, the Session row, git,
 * the Run, the preservation receipt, drafted Asks, the PR, the Action claim).
 *
 * The output ({@link SessionClassification}) is deliberately small and stable:
 * later detection/recovery Actions (red alerts, stalled-session recovery)
 * branch on `state` and `action`. Both are closed sets documented in
 * `docs/session-signal-classifier.md`; adding a member is a contract change.
 */

// ---------------------------------------------------------------------------
// Pane catalog
// ---------------------------------------------------------------------------

/** What a pane line can say about why a Session is not making progress. */
export type PaneSignalClass =
  | "permission_prompt"
  | "auth_failure"
  | "provider_limit"
  | "sandbox_denial"
  | "context_exhaustion"
  | "command_loop";

export interface PaneSignalPattern {
  id: string;
  class: PaneSignalClass;
  /** Provider whose output this string comes from, or "any". Informational. */
  provider: "claude" | "codex" | "opencode" | "any";
  pattern: RegExp;
}

/**
 * Regex catalog of pane-text signals. Patterns are case-insensitive and
 * anchored on wording providers actually print; they are matched against the
 * pane's recent tail only (see {@link PANE_TAIL_LINES}) so a limit message
 * scrolled far above live output does not condemn a Session that recovered.
 * `command_loop` is not here: it needs a repetition count, not a single-line
 * match (see {@link detectRepeatedCommandLoop}).
 */
export const PANE_SIGNAL_CATALOG: readonly PaneSignalPattern[] = [
  // Permission prompts: an interactive approval the Session cannot answer itself.
  { id: "claude-proceed-prompt", class: "permission_prompt", provider: "claude", pattern: /do you want to (?:proceed|make this edit|create|run)\b/i },
  { id: "claude-dont-ask-again", class: "permission_prompt", provider: "claude", pattern: /yes, and don'?t ask again/i },
  { id: "codex-run-approval", class: "permission_prompt", provider: "codex", pattern: /would you like to run the following command\?/i },
  { id: "codex-approval-choice", class: "permission_prompt", provider: "codex", pattern: /yes, proceed \(y\)|no, and tell codex what to do differently/i },
  { id: "generic-allow-prompt", class: "permission_prompt", provider: "any", pattern: /\b(?:allow|approve) (?:this|the) (?:tool|command|action)\b.*\?|\(y\/n\)\s*$/im },

  // Auth or scope failures: credentials the Session cannot fix by waiting.
  { id: "claude-login-required", class: "auth_failure", provider: "claude", pattern: /please run \/login|invalid api key|oauth token has expired|not logged in/i },
  { id: "http-401", class: "auth_failure", provider: "any", pattern: /\b401\b.*\b(?:unauthorized|authentication_error)\b|\bunexpected status 401\b|authentication_error/i },
  { id: "scope-failure", class: "auth_failure", provider: "any", pattern: /insufficient[_ ]scope|resource not accessible by (?:personal access token|integration)|missing required scope|permission_error/i },
  { id: "codex-not-signed-in", class: "auth_failure", provider: "codex", pattern: /you are not signed in|please (?:sign in|log in) (?:again|to codex)|run `?codex login`?/i },

  // Provider rate or usage limits: waiting (not restarting) is the remedy.
  { id: "claude-usage-limit", class: "provider_limit", provider: "claude", pattern: /(?:\b5-hour|weekly|opus|usage) limit (?:reached|will reset)|claude usage limit reached|you'?ve hit your (?:usage |session )?limit/i },
  { id: "codex-usage-limit", class: "provider_limit", provider: "codex", pattern: /you'?ve hit your usage limit|usage limit.*try again at/i },
  { id: "http-429", class: "provider_limit", provider: "any", pattern: /\b429\b.*(?:too many requests|rate[_ ]limit)|rate_limit_error|exceeded retry limit, last status: 429|overloaded_error/i },
  { id: "generic-rate-limit", class: "provider_limit", provider: "any", pattern: /rate limit(?:ed| exceeded| reached)|quota exceeded|resets? (?:at|in) \d/i },

  // Sandbox denials: the OS refused an operation inside the sandbox.
  { id: "sandbox-denied", class: "sandbox_denial", provider: "any", pattern: /sandbox(?:-exec)?[^\n]*\bdeny|denied by (?:the )?sandbox|blocked by sandbox/i },
  { id: "operation-not-permitted", class: "sandbox_denial", provider: "any", pattern: /operation not permitted|\bEPERM\b|read-only file system|\bEROFS\b/i },

  // Context exhaustion: the conversation no longer fits the model window.
  { id: "claude-context-limit", class: "context_exhaustion", provider: "claude", pattern: /context limit reached|prompt is too long|context low \(\d+% remaining\)|conversation too long/i },
  { id: "codex-context-window", class: "context_exhaustion", provider: "codex", pattern: /ran out of room in the model'?s context window|context window exceeded|exceeds the context window/i }
];

/** Only this many trailing non-blank pane lines are scanned. */
export const PANE_TAIL_LINES = 40;

/** A command line repeated this many times in a row is a loop. */
export const COMMAND_LOOP_MIN_REPEATS = 4;

/** Lines that begin a tool/command invocation in provider transcripts. */
const COMMAND_LINE = /^\s*(?:[⏺●•]\s+(?:Bash|Ran|Run|Read|Search|Update)\b|\$\s+\S|>\s*Bash\()/;

export interface PaneScan {
  /** Every catalog class seen in the pane tail, in precedence order. */
  classes: PaneSignalClass[];
  /** Ids of the catalog entries that matched, for evidence. */
  matched: string[];
}

function tailLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "").slice(-PANE_TAIL_LINES);
}

/**
 * True when one command invocation line repeats {@link COMMAND_LOOP_MIN_REPEATS}
 * or more times consecutively among the tail's command lines. Output lines
 * between the repeats do not break the run: a loop that prints the same
 * failing result each time is still a loop.
 */
export function detectRepeatedCommandLoop(lines: readonly string[]): boolean {
  const commands = lines.filter((line) => COMMAND_LINE.test(line)).map((line) => line.trim().replace(/\s+/g, " "));
  const joined = commands.join("\n");
  const repeat = new RegExp(`^(.+)(?:\\n\\1){${COMMAND_LOOP_MIN_REPEATS - 1},}$`, "m");
  return repeat.test(joined);
}

/** Precedence among pane classes; see the doc. Earlier beats later. */
export const PANE_CLASS_PRECEDENCE: readonly PaneSignalClass[] = [
  "permission_prompt",
  "auth_failure",
  "provider_limit",
  "sandbox_denial",
  "context_exhaustion",
  "command_loop"
];

export function scanPane(text: string | null): PaneScan {
  if (text === null) return { classes: [], matched: [] };
  const lines = tailLines(text);
  const tail = lines.join("\n");
  const found = new Set<PaneSignalClass>();
  const matched: string[] = [];
  for (const entry of PANE_SIGNAL_CATALOG) {
    if (entry.pattern.test(tail)) {
      found.add(entry.class);
      matched.push(entry.id);
    }
  }
  if (detectRepeatedCommandLoop(lines)) {
    found.add("command_loop");
    matched.push("repeated-command-loop");
  }
  return { classes: PANE_CLASS_PRECEDENCE.filter((c) => found.has(c)), matched };
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/** The closed state set. Each state maps to exactly one action below. */
export type SessionState =
  | "completed_merged"
  | "completion_drafted"
  | "permission_prompt"
  | "auth_failure"
  | "provider_limit"
  | "sandbox_denial"
  | "context_exhaustion"
  | "command_loop"
  | "stalled"
  | "exited_unpreserved"
  | "exited_preserved"
  | "exited_failed"
  | "exited_clean"
  | "working"
  | "unobservable";

export type SessionAction =
  | "release_claim"
  | "settle_drafted_completion"
  | "escalate_approval"
  | "escalate_credentials"
  | "wait_for_provider_reset"
  | "escalate_sandbox"
  | "resume_with_fresh_context"
  | "interrupt_and_restart"
  | "recover_stalled_session"
  | "preserve_candidate"
  | "await_pr_review"
  | "reconcile_failed_exit"
  | "reconcile_exit"
  | "none"
  | "observe_again";

/** One action per state. Stable contract: see docs/session-signal-classifier.md. */
export const SESSION_STATE_ACTION: Readonly<Record<SessionState, SessionAction>> = {
  completed_merged: "release_claim",
  completion_drafted: "settle_drafted_completion",
  permission_prompt: "escalate_approval",
  auth_failure: "escalate_credentials",
  provider_limit: "wait_for_provider_reset",
  sandbox_denial: "escalate_sandbox",
  context_exhaustion: "resume_with_fresh_context",
  command_loop: "interrupt_and_restart",
  stalled: "recover_stalled_session",
  exited_unpreserved: "preserve_candidate",
  exited_preserved: "await_pr_review",
  exited_failed: "reconcile_failed_exit",
  exited_clean: "reconcile_exit",
  working: "none",
  unobservable: "observe_again"
};

/** Already-gathered signals. Every field is optional evidence; null means unknown. */
export interface SessionSignals {
  process: {
    /** tmux session is alive. */
    alive: boolean;
    /** Exit status recorded for a dead Session; null when unknown or alive. */
    exitStatus: number | null;
  };
  /** `tmux.capturePane` result; null when capture is unavailable or failed. */
  paneText: string | null;
  /** `observeSessionActivity(...).stalled`; null when not observed this tick. */
  stalled: boolean | null;
  git: {
    /** Commits on the candidate branch not on the base branch. */
    commitsAhead: number;
    /** Uncommitted changes in the candidate worktree. */
    dirty: boolean;
  };
  /** Latest `execution_runs.status` for the Session's work item. */
  runStatus: string | null;
  /** Candidate preservation receipt state, if any. */
  preservation: "LOCAL ONLY" | "PUSHED" | "IN PR" | null;
  /** A drafted `complete` Ask whose evidence covers every declared criterion. */
  draftedCompletion: boolean;
  pr: { state: "open" | "merged" | "closed" | null };
  /** The Action claim is still held for this Session. */
  claimHeld: boolean;
}

export interface SessionClassification {
  state: SessionState;
  action: SessionAction;
  /** One line naming the signal that decided, for logs and alerts. */
  reason: string;
  /** Pane catalog ids that matched, whether or not they decided. */
  paneMatches: string[];
}

const PANE_CLASS_STATE: Record<PaneSignalClass, SessionState> = {
  permission_prompt: "permission_prompt",
  auth_failure: "auth_failure",
  provider_limit: "provider_limit",
  sandbox_denial: "sandbox_denial",
  context_exhaustion: "context_exhaustion",
  command_loop: "command_loop"
};

function result(state: SessionState, reason: string, paneMatches: string[]): SessionClassification {
  return { state, action: SESSION_STATE_ACTION[state], reason, paneMatches };
}

/**
 * Precedence, first match wins:
 *  1. PR merged             -- the work landed; nothing else matters.
 *  2. drafted completion    -- deterministic settle beats any live symptom.
 *  3. pane classes, in {@link PANE_CLASS_PRECEDENCE} order -- an explained
 *     block (approval, credentials, provider limit, sandbox, context, loop)
 *     always outranks a stall, because a blocked Session is silent by design.
 *  4. process dead          -- by preservation / exit status.
 *  5. stalled               -- only reached when nothing above explains it.
 *  6. working / unobservable.
 */
export function classifySession(signals: SessionSignals): SessionClassification {
  const scan = scanPane(signals.paneText);
  const m = scan.matched;

  if (signals.pr.state === "merged") return result("completed_merged", signals.claimHeld ? "PR merged; Action claim still held" : "PR merged; claim already released", m);
  if (signals.draftedCompletion) return result("completion_drafted", "drafted complete Ask covers every criterion", m);

  const paneClass = scan.classes[0];
  if (paneClass) return result(PANE_CLASS_STATE[paneClass], `pane shows ${paneClass} (${m.join(", ")})`, m);

  if (!signals.process.alive) {
    const hasWork = signals.git.dirty || signals.git.commitsAhead > 0;
    const preserved = signals.preservation === "PUSHED" || signals.preservation === "IN PR" || signals.pr.state === "open";
    if (hasWork && !preserved) return result("exited_unpreserved", "process exited with unpreserved candidate work", m);
    if (signals.pr.state === "open" || signals.preservation === "IN PR") return result("exited_preserved", "process exited; PR open", m);
    if (signals.preservation === "PUSHED") return result("exited_preserved", "process exited; candidate pushed", m);
    const failedRun = signals.runStatus === "failed";
    if (failedRun || (signals.process.exitStatus !== null && signals.process.exitStatus !== 0)) {
      return result("exited_failed", `process exited (status ${signals.process.exitStatus ?? "unknown"}, run ${signals.runStatus ?? "none"}) with no work`, m);
    }
    return result("exited_clean", "process exited with no unpreserved work", m);
  }

  if (signals.stalled === true) return result("stalled", "no pane or Run activity past the stall deadline", m);
  if (signals.stalled === null && signals.paneText === null) return result("unobservable", "no pane capture and no activity observation", m);
  return result("working", "alive with recent activity", m);
}
