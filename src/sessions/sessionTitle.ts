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

export const SESSION_TITLE_STATES = ["working", "pr", "ci", "waiting", "blocked", "done", "parked"] as const;
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
  done: "🟢",
  parked: "⏸"
};

/**
 * Who the operator should talk to (docs/agent-guidance/chat-titles.md):
 * `direct` is a contact for its own work, `coordinator` is the one
 * operator-facing manager of a workstream (⭐ marks the current contact; 🚦 replaces the kind glyph) and
 * `helper` reports to a named parent coordinator (a leading `↳ `).
 */
export const SESSION_TITLE_RELATIONS = ["direct", "coordinator", "helper"] as const;
export type SessionTitleRelation = (typeof SESSION_TITLE_RELATIONS)[number];

export const CONTACT_TITLE_PREFIX = "⭐ ";
export const COORDINATOR_TITLE_GLYPH = "🚦";
export const HELPER_TITLE_PREFIX = "↳ ";

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
  /** Reporting relationship; defaults to `direct`. */
  relation?: SessionTitleRelation;
  /** Short workstream label shared by a coordinator and its helpers; replaces the Plan acronym. */
  workstream?: string | null;
  /** Role or task and the specific need, each appended after ` · `. */
  details?: readonly string[];
}

/**
 * `🔨🔵 BMPB fix-the-thing` — kind, state, Plan acronym, Action id. With no
 * Plan the acronym is omitted rather than filled with a placeholder, so those
 * characters go to the part that tells sessions apart.
 */
export function formatSessionTitle(input: SessionTitleInput): string {
  const relation = input.relation ?? "direct";
  const kindGlyph = relation === "coordinator" ? COORDINATOR_TITLE_GLYPH : SESSION_TITLE_KIND_GLYPHS[input.kind];
  const prefix = relation === "helper" ? HELPER_TITLE_PREFIX
    : relation === "coordinator" && input.state !== "parked" ? CONTACT_TITLE_PREFIX : "";
  const glyphs = `${prefix}${kindGlyph}${SESSION_TITLE_STATE_GLYPHS[input.state]}`;
  const workstream = input.workstream?.trim();
  const scope = workstream
    ? [workstream, input.action ?? ""].filter(Boolean).join(" · ")
    : [input.plan ? planAcronym(input.plan) : "", input.action ?? input.kind].filter(Boolean).join(" ");
  const details = (input.details ?? []).map((part) => part.trim()).filter(Boolean);
  return [`${glyphs} ${scope}`, ...details].join(" · ");
}

/** Every state's title for one session, so an agent retitles by lookup rather than recomposing. */
export function sessionTitlesByState(input: Omit<SessionTitleInput, "state">): Record<SessionTitleState, string> {
  return Object.fromEntries(
    SESSION_TITLE_STATES.map((state) => [state, formatSessionTitle({ ...input, state })])
  ) as Record<SessionTitleState, string>;
}

/** Shared native instructions; title maps are projections, never observed state or admission. */
export function renderStateSignalInstructions(agent: "codex" | "claude" | "opencode", titles: Record<SessionTitleState, string>): string[] {
  return [
    `Compact state signals — ${agent}:`,
    "Immediately acknowledge the actual observed assignment, selected Action, canonical Session evidence and next permitted step in a few sentences; keep detailed evidence available on demand.",
    "Report observed state changes promptly. Never claim an active team from a role brief, claims or native activity; native activity does not prove governed Session admission.",
    "Use the matching sessionTitles base with the host title tool only after observing the transition: working = authorized work underway; pr = PR open/in review; ci = independent review cleared and required checks remain; waiting = concrete input needed; blocked = external blocker; done = completion proved; parked = deliberate hold/handoff.",
    "Keep canonical kind/state and Plan/Action or workstream early. Add the helper arrow only for a verified named parent assignment; preserve it on retitling. Selected A never replaces caller-assigned B. Refresh the brief when the assignment changes.",
    "Idle, silence and end-of-turn alone never imply pause, completion or custody release. A completed title alone does not settle an Action or transfer custody.",
    "If no title tool is exposed, say: Title tool unavailable; suggested title: <matching title>. Never assert a title update without a successful tool result. Title-tool support in each native runtime must be verified locally; these instructions prove no live provider support.",
    ...SESSION_TITLE_STATES.map(state => `  ${state}: ${titles[state]}`)
  ];
}
