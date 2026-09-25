/**
 * Session titles built to survive truncation.
 *
 * Session lists (Claude Code, the desktop app, phone clients) cut a title to
 * roughly its first 20 characters. `<active_plan>: <current_action>` spent all
 * of them on the plan slug, so every session in one Plan looked identical. The
 * title therefore leads with two glyphs (what kind of session, what state it is
 * in), then a short Plan acronym, then the Action id — the part that actually
 * differs between sessions starts within the first ten characters.
 */

export const SESSION_TITLE_KINDS = ["build", "review", "plan", "repair"] as const;
export type SessionTitleKind = (typeof SESSION_TITLE_KINDS)[number];

export const SESSION_TITLE_STATES = ["working", "pr", "ci", "waiting", "blocked", "done"] as const;
export type SessionTitleState = (typeof SESSION_TITLE_STATES)[number];

/** Single-code-point emoji only: variation-selector glyphs render at uneven widths. */
export const SESSION_TITLE_KIND_GLYPHS: Record<SessionTitleKind, string> = {
  build: "🔨",
  review: "🔍",
  plan: "🧭",
  repair: "🩹"
};

/** Colored dots, so state reads as one scannable column down a session list. */
export const SESSION_TITLE_STATE_GLYPHS: Record<SessionTitleState, string> = {
  working: "🔵",
  pr: "🟣",
  ci: "🟡",
  waiting: "🟠",
  blocked: "🔴",
  done: "🟢"
};

const ACRONYM_STOPWORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
const MAX_ACRONYM_LENGTH = 4;

/**
 * The Plan's acronym: the first letter of each significant word of its slug,
 * uppercased and capped at four letters (`bootstrap-managed-production-to-build-flight-deck`
 * becomes `BMPB`). A one-word slug keeps its first three letters so it is still
 * recognizable.
 */
export function planAcronym(planSlug: string): string {
  const words = planSlug.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const significant = words.filter((word) => !ACRONYM_STOPWORDS.has(word));
  const source = significant.length > 0 ? significant : words;
  if (source.length === 0) return "";
  if (source.length === 1) return source[0].slice(0, 3).toUpperCase();
  return source.map((word) => word[0]).join("").slice(0, MAX_ACRONYM_LENGTH).toUpperCase();
}

export interface SessionTitleInput {
  kind: SessionTitleKind;
  state: SessionTitleState;
  /** The active Plan slug; null when no Plan resolved. */
  plan: string | null;
  /** The current Action id; null when no Action resolved. */
  action: string | null;
}

/**
 * `🔨🔵 BMPB fix-the-thing` — kind, state, Plan acronym, Action id. With no
 * Plan the acronym is omitted rather than filled with a placeholder, so those
 * characters go to the part that tells sessions apart.
 */
export function formatSessionTitle(input: SessionTitleInput): string {
  const glyphs = `${SESSION_TITLE_KIND_GLYPHS[input.kind]}${SESSION_TITLE_STATE_GLYPHS[input.state]}`;
  const scope = [input.plan ? planAcronym(input.plan) : "", input.action ?? input.kind].filter(Boolean).join(" ");
  return `${glyphs} ${scope}`;
}

/** Every state's title for one session, so an agent retitles by lookup rather than recomposing. */
export function sessionTitlesByState(input: Omit<SessionTitleInput, "state">): Record<SessionTitleState, string> {
  return Object.fromEntries(
    SESSION_TITLE_STATES.map((state) => [state, formatSessionTitle({ ...input, state })])
  ) as Record<SessionTitleState, string>;
}
