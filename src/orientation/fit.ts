import { EFFORT_CEILING_MINUTES, EFFORT_LABELS, effortFitsWithin, formatMinutes } from "./effort.js";
import { isStale } from "./staleness.js";
import type { DailyCapacity, OrientationEffort, OrientationEntry } from "./types.js";
import { computeOrientationUrgencyScore } from "./urgency.js";

/**
 * Fit-to-gap and the day slate. Every function here is pure and
 * deterministic — a filter and a sort over data that already carries
 * urgency. No model call decides what fits; the model's only job anywhere in
 * this feature is turning "the disposal's a whole afternoon" into
 * effort=session at capture time.
 */

export interface FittingEntry {
  entry: OrientationEntry;
  effort: OrientationEffort;
  urgencyScore: number;
  /** Unconfirmed for longer than its horizon allows — surfaced, never hidden. */
  stale: boolean;
}

export interface FitToGapResult {
  availableMinutes: number;
  fits: FittingEntry[];
  /** Sized entries that did not fit this window, with the honest reason why. */
  tooBig: Array<{ entry: OrientationEntry; effort: OrientationEffort; reason: string }>;
  /** Live entries carrying no effort — invisible to fit-to-gap until sized. */
  unsizedCount: number;
}

const DEFAULT_FIT_LIMIT = 3;

function isLive(entry: OrientationEntry): boolean {
  return entry.status === "active" || entry.status === "confirmed";
}

const HORIZON_RANK: Record<OrientationEntry["horizon"], number> = { now: 0, soon: 1, later: 2, someday: 3 };

/**
 * Rank by urgency, then horizon, then the sooner due date, then age — the
 * same ordering intent as listLiveOrientationEntries, expressed over the
 * continuous score so a fit list and Needs-You-Now never disagree.
 *
 * Horizon is the tie-break because the urgency score is deliberately blind to
 * it for anything without a due date: two `high` entries score identically,
 * and without this the winner is whichever happened to be created first. That
 * is how "Private practice website work" (now) lost its protected block to
 * "Fix garbage disposal" (soon) — an arbitrary ordering producing exactly the
 * displacement of client work this feature exists to prevent.
 */
function byUrgencyThenDue(
  a: { entry: OrientationEntry; urgencyScore: number },
  b: { entry: OrientationEntry; urgencyScore: number }
): number {
  if (b.urgencyScore !== a.urgencyScore) {
    return b.urgencyScore - a.urgencyScore;
  }
  const horizonDelta = HORIZON_RANK[a.entry.horizon] - HORIZON_RANK[b.entry.horizon];
  if (horizonDelta !== 0) {
    return horizonDelta;
  }
  const aDue = a.entry.dueAt ?? "9999-99-99";
  const bDue = b.entry.dueAt ?? "9999-99-99";
  if (aDue !== bDue) {
    return aDue.localeCompare(bDue);
  }
  return a.entry.createdAt.localeCompare(b.entry.createdAt);
}

/**
 * "I have N minutes — what fits?" Only sized entries can answer; un-sized
 * ones are counted, not guessed at, so the operator can see that the answer
 * is thin because the ledger isn't sized yet rather than because there is
 * nothing to do.
 */
export function selectFittingEntries(
  entries: OrientationEntry[],
  availableMinutes: number,
  now: Date,
  options: { limit?: number } = {}
): FitToGapResult {
  const limit = options.limit ?? DEFAULT_FIT_LIMIT;
  const live = entries.filter(isLive);

  const sized: FittingEntry[] = [];
  const tooBig: FitToGapResult["tooBig"] = [];

  for (const entry of live) {
    if (!entry.effort) {
      continue;
    }
    if (effortFitsWithin(entry.effort, availableMinutes)) {
      sized.push({
        entry,
        effort: entry.effort,
        urgencyScore: computeOrientationUrgencyScore(entry, now),
        stale: isStale(entry, now)
      });
    } else {
      tooBig.push({ entry, effort: entry.effort, reason: doesNotFitReason(entry.effort, availableMinutes) });
    }
  }

  return {
    availableMinutes,
    fits: sized.sort(byUrgencyThenDue).slice(0, limit),
    tooBig,
    unsizedCount: live.filter((entry) => !entry.effort).length
  };
}

function doesNotFitReason(effort: OrientationEffort, availableMinutes: number): string {
  if (effort === "project") {
    return "multi-session; needs breaking down first";
  }
  return `needs ${EFFORT_LABELS[effort]}, only ${formatMinutes(availableMinutes)} available`;
}

// ---------------------------------------------------------------------------
// The day slate
// ---------------------------------------------------------------------------

export interface SlateItem {
  entry: OrientationEntry;
  effort: OrientationEffort;
  urgencyScore: number;
}

export interface DeferredSlateItem extends SlateItem {
  reason: string;
}

export interface DaySlate {
  capacity: DailyCapacity;
  /** Session-sized work claiming today's protected blocks. Never more than the day holds. */
  protect: SlateItem[];
  /** Small work greedily packed into the day's real gaps, most urgent first. */
  fitsToday: SlateItem[];
  /** Sized work that honestly will not happen today, each with a stated reason. */
  notToday: DeferredSlateItem[];
  /** Entries the slate said nothing about — un-sized, so they keep the classic treatment. */
  unsized: OrientationEntry[];
  /** Minutes of the stated fragment budget left after packing. */
  remainingFragmentMinutes: number | null;
}

/**
 * Turn "what matters" into "what today can actually hold".
 *
 * Both capacity numbers are nullable and nullable means *unknown*, not zero:
 * an unknown dimension leaves its items un-budgeted (they fall through to the
 * classic importance/urgency sections) rather than being deferred on the
 * strength of a number the operator never gave. A stated 0, by contrast, is
 * load-bearing — "no session today" is exactly the signal that justifies
 * pushing the disposal out loud instead of letting it rot.
 *
 * Callers pass fresh (non-stale) entries only: a stale entry is a question,
 * not a fact, and planning a day around unconfirmed facts is the failure mode
 * the whole ledger exists to prevent.
 */
export function buildDaySlate(entries: OrientationEntry[], capacity: DailyCapacity, now: Date): DaySlate {
  const live = entries.filter(isLive);
  const unsized = live.filter((entry) => !entry.effort);

  const sized: SlateItem[] = live
    .filter((entry): entry is OrientationEntry & { effort: OrientationEffort } => Boolean(entry.effort))
    .map((entry) => ({ entry, effort: entry.effort, urgencyScore: computeOrientationUrgencyScore(entry, now) }))
    .sort(byUrgencyThenDue);

  const protect: SlateItem[] = [];
  const fitsToday: SlateItem[] = [];
  const notToday: DeferredSlateItem[] = [];
  const unbudgeted: OrientationEntry[] = [];

  const sessionBudget = capacity.sessionBlocks;
  const fragmentBudget = capacity.fragmentMinutes;
  let sessionsLeft = sessionBudget ?? 0;
  let minutesLeft = fragmentBudget ?? 0;

  const forTheGaps: SlateItem[] = [];

  for (const item of sized) {
    if (item.effort === "project") {
      notToday.push({ ...item, reason: "multi-session; needs breaking down before it can fit a day" });
      continue;
    }

    if (item.effort === "session") {
      if (sessionBudget === null) {
        // Capacity says nothing about protected blocks; don't invent a verdict.
        unbudgeted.push(item.entry);
        continue;
      }
      if (sessionsLeft > 0) {
        sessionsLeft -= 1;
        protect.push(item);
      } else {
        notToday.push({
          ...item,
          reason:
            sessionBudget === 0
              ? "needs a 1–3h session; today has none"
              : "needs a 1–3h session; today's session is already spoken for"
        });
      }
      continue;
    }

    if (fragmentBudget === null) {
      unbudgeted.push(item.entry);
      continue;
    }
    forTheGaps.push(item);
  }

  // Small work claims the gaps first. The point of this budget is that it is
  // *fragmented* — an hour assembled from the cracks between commitments does
  // not hold one contiguous hour-long task, and packing strictly by urgency
  // lets a single `short` item swallow the whole day's slack and defer the
  // 10-minute phone call that would have fit a gap perfectly. Urgency still
  // decides within a size, so the ordering stays fully deterministic.
  for (const item of [...forTheGaps].sort((a, b) => EFFORT_CEILING_MINUTES[a.effort] - EFFORT_CEILING_MINUTES[b.effort])) {
    const cost = EFFORT_CEILING_MINUTES[item.effort];
    if (cost <= minutesLeft) {
      minutesLeft -= cost;
      fitsToday.push(item);
    } else {
      notToday.push({
        ...item,
        reason:
          fragmentBudget === 0
            ? "no gaps today"
            : `needs ${EFFORT_LABELS[item.effort]}; only ${formatMinutes(minutesLeft)} of today's gaps left`
      });
    }
  }

  fitsToday.sort(byUrgencyThenDue);

  return {
    capacity,
    protect,
    fitsToday,
    notToday,
    unsized: [...unsized, ...unbudgeted],
    remainingFragmentMinutes: fragmentBudget === null ? null : minutesLeft
  };
}

// ---------------------------------------------------------------------------
// Deterministic recognition of a "what fits?" reply
// ---------------------------------------------------------------------------

const DURATION_PATTERNS: Array<{ pattern: RegExp; minutes: (match: RegExpMatchArray) => number }> = [
  { pattern: /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i, minutes: (m) => Number(m[1]) * 60 },
  { pattern: /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i, minutes: (m) => Number(m[1]) },
  { pattern: /\bhalf\s+an?\s+hour\b/i, minutes: () => 30 },
  { pattern: /\ban?\s+hour\b/i, minutes: () => 60 }
];

/** An unmistakable request for suggestions — safe to trust wherever it appears. */
const EXPLICIT_ASK = /\bwhat\s+(?:fits|can\s+i\s+(?:do|get)|should\s+i\s+do)\b|\banything\s+i\s+can\s+do\b/i;

const DURATION_SOURCE = String.raw`\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)|half\s+an?\s+hour|an?\s+hour`;

/** A message that is nothing but a duration ("20 minutes", "1h?") reads as the same question. */
const BARE_DURATION = new RegExp(String.raw`^(?:${DURATION_SOURCE})\s*\??$`, "i");

/**
 * A whole message that says only "here is the window I have" — an opener, a
 * duration, and at most a word of filler.
 */
const AVAILABILITY_STATEMENT = new RegExp(
  String.raw`^(?:i\s*(?:'ve|ve)?\s*(?:have|got|have\s+got)|i\s*(?:'ve|ve))\s+(?:${DURATION_SOURCE})(?:\s+(?:free|left|open|spare|to\s+spare|available|right\s+now|now))?\s*[.!?]*$`,
  "i"
);

/**
 * Recognizes "I have 20 minutes — what fits?" so it can be answered
 * deterministically instead of being routed to the Intelligence interpreter,
 * which only understands write operations. Mirrors the existing
 * isListRequest fast path in src/commands/orientation.ts.
 *
 * Deliberately conservative, because two very different messages contain the
 * same words. A statement of fact ("the plumber comes in 20 minutes") and a
 * statement of the day's capacity ("today I've got one client session and
 * about an hour of gaps") both need the interpreter; only an explicit ask, a
 * bare duration, or a message that is *nothing but* an availability statement
 * is answered here. Anything ambiguous falls through to the interpreter,
 * which understands both — the wrong-way failure costs one model call, while
 * the other way silently swallows what the operator was telling us.
 */
export function parseAvailableMinutesRequest(text: string): number | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  const isFitQuestion =
    EXPLICIT_ASK.test(normalized) || BARE_DURATION.test(normalized) || AVAILABILITY_STATEMENT.test(normalized);
  if (!isFitQuestion) {
    return null;
  }

  for (const { pattern, minutes } of DURATION_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const value = minutes(match);
      return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    }
  }
  return null;
}

/** One-line human rendering of a fit result — used by the CLI and the Discord reply loop. */
export function formatFitResult(result: FitToGapResult): string {
  const window = formatMinutes(result.availableMinutes);
  if (result.fits.length === 0) {
    if (result.unsizedCount > 0 && result.tooBig.length === 0) {
      return `Nothing in the ledger is sized yet, so I can't say what fits ${window}. Tell me a size (quick / short / session / project) and I'll start answering this.`;
    }
    return `Nothing fits ${window} right now.`;
  }
  const lines = result.fits.map(
    (item) => `- ${item.entry.title} (${item.effort}, ${EFFORT_LABELS[item.effort]})${item.stale ? " — unconfirmed" : ""}`
  );
  const tail =
    result.unsizedCount > 0 ? `\n(${result.unsizedCount} un-sized entr${result.unsizedCount === 1 ? "y" : "ies"} not considered.)` : "";
  return `In ${window} you could do:\n${lines.join("\n")}${tail}`;
}
