/**
 * The closing note of every report.
 *
 * Two rules make this land instead of grate. First, it is *selected by
 * context*, never at random: a line about pacing yourself after a heavy day
 * reads as attention, while the same line after a good day reads as a fortune
 * cookie. Second, it rotates within its context by date, so the same day's
 * report is stable but a week does not repeat itself.
 *
 * Quotations are short, attributed, and drawn from public-domain sources.
 * Everything else is written for this specific problem — a general-purpose
 * motivational quote is exactly the thing that makes a tool feel like it
 * isn't paying attention.
 */

export type EncouragementMood =
  | "overloaded"
  | "momentum"
  | "quiet"
  | "scattered"
  | "deferring"
  | "steady";

export interface EncouragementSignals {
  /** Sized work outstanding, measured in days at the stated capacity. */
  daysOfBacklog: number | null;
  itemsProgressed: number;
  minutesLogged: number;
  engagementBlocks: number;
  deferredCount: number;
  urgentCount: number;
}

/** A stored line. Its mood is the key it lives under, not a field on it. */
interface EncouragementLine {
  line: string;
  attribution?: string;
}

export interface Encouragement extends EncouragementLine {
  mood: EncouragementMood;
}

const LIBRARY: Record<EncouragementMood, EncouragementLine[]> = {
  overloaded: [
    { line: "The list is long because your life is full, not because you are behind." },
    { line: "You cannot do it all today. Pick the one that will be worst to still be carrying tomorrow." },
    { line: "He who is everywhere is nowhere.", attribution: "Seneca" },
    { line: "Cut one thing from today on purpose. A deliberate no is not a failure; it's a plan." },
    { line: "Half an hour on the biggest thing beats an hour of deciding which thing." }
  ],
  momentum: [
    { line: "That's real movement. The list is shorter than it was this morning." },
    { line: "Well begun is half done.", attribution: "Aristotle" },
    { line: "You did the hard part: you started. Do that again tomorrow and the rest follows." },
    { line: "Progress compounds quietly. Today looked small and wasn't." }
  ],
  quiet: [
    { line: "Nothing logged today. That's information, not a verdict — some days hold other things." },
    { line: "Rest is not the opposite of progress; it's the part that makes tomorrow possible." },
    { line: "One fifteen-minute thing tomorrow will restart the whole machine." }
  ],
  scattered: [
    { line: "Lots of small touches today. Tomorrow, try giving one thing a whole uninterrupted block." },
    { line: "Attention is the rarest and purest form of generosity.", attribution: "Simone Weil" },
    { line: "Switching costs more than it looks. Two things done beats six things touched." }
  ],
  deferring: [
    { line: "Deferring on purpose is a decision, not a failure — you know where it stands." },
    { line: "Something has been waiting a while. Either give it a slot this week or let it go out loud." },
    { line: "The weight of an undone thing is mostly the not-deciding. Decide, and it gets lighter." }
  ],
  steady: [
    { line: "Steady is underrated. This is what it looks like when the system is working." },
    { line: "Little by little, one travels far.", attribution: "a Spanish proverb" },
    { line: "Nothing on fire. Use that — the calm days are when the big things actually move." }
  ]
};

/**
 * Reads the day's shape into one mood. Order matters: overload is checked
 * first because it is the state where the wrong note does the most damage.
 */
export function selectMood(signals: EncouragementSignals): EncouragementMood {
  if ((signals.daysOfBacklog !== null && signals.daysOfBacklog >= 3) || signals.urgentCount >= 5) {
    return "overloaded";
  }
  if (signals.itemsProgressed >= 2 || signals.minutesLogged >= 120) {
    return "momentum";
  }
  if (signals.engagementBlocks === 0 && signals.minutesLogged === 0) {
    return "quiet";
  }
  if (signals.engagementBlocks >= 4 && signals.itemsProgressed === 0) {
    return "scattered";
  }
  if (signals.deferredCount >= 3) {
    return "deferring";
  }
  return "steady";
}

/** Stable for a given day, different across a week. */
export function selectEncouragement(signals: EncouragementSignals, localDate: string): Encouragement {
  const mood = selectMood(signals);
  const options = LIBRARY[mood];
  return { mood, ...options[dayIndex(localDate) % options.length] };
}

function dayIndex(localDate: string): number {
  let hash = 0;
  for (const character of localDate) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  }
  return hash;
}

export function formatEncouragement(encouragement: Encouragement): string {
  return encouragement.attribution ? `"${encouragement.line}" — ${encouragement.attribution}` : encouragement.line;
}
