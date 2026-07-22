export const ORIENTATION_ENTRY_TYPES = [
  "active_concern",
  "standing_responsibility",
  "time_bound",
  "parked_idea"
] as const;
export type OrientationEntryType = (typeof ORIENTATION_ENTRY_TYPES)[number];

export const ORIENTATION_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type OrientationPriority = (typeof ORIENTATION_PRIORITIES)[number];

export const ORIENTATION_HORIZONS = ["now", "soon", "later", "someday"] as const;
export type OrientationHorizon = (typeof ORIENTATION_HORIZONS)[number];

export const ORIENTATION_STATUSES = ["active", "confirmed", "completed", "dropped"] as const;
export type OrientationStatus = (typeof ORIENTATION_STATUSES)[number];

/**
 * Optional coarse time cost. Every entry is weighted by importance and
 * urgency; this is the one dimension the ledger had no notion of. Optional by
 * design — an un-sized entry behaves exactly as it did before effort existed.
 * Semantics (ceilings, fit rules) live in ./effort.ts.
 */
export const ORIENTATION_EFFORTS = ["quick", "short", "session", "project"] as const;
export type OrientationEffort = (typeof ORIENTATION_EFFORTS)[number];

export type OrientationSource = "cli" | "discord" | "admin" | "seed";

export interface OrientationEntry {
  id: string;
  entryType: OrientationEntryType;
  title: string;
  detail: string | null;
  area: string | null;
  projectId: string | null;
  priority: OrientationPriority;
  horizon: OrientationHorizon;
  dueAt: string | null;
  effort: OrientationEffort | null;
  status: OrientationStatus;
  lastConfirmedAt: string;
  assertedAt: string;
  source: OrientationSource;
  createdAt: string;
  updatedAt: string;
}

export interface OrientationPacket {
  id: string;
  localDate: string;
  body: string;
  entrySnapshot: Array<{ id: string; title: string; stale: boolean }>;
  discordMessageId: string | null;
  createdAt: string;
}

export interface CreateOrientationEntryInput {
  entryType: OrientationEntryType;
  title: string;
  detail?: string | null;
  area?: string | null;
  projectId?: string | null;
  priority?: OrientationPriority;
  horizon?: OrientationHorizon;
  dueAt?: string | null;
  effort?: OrientationEffort | null;
  source: OrientationSource;
}

export interface UpdateOrientationEntryInput {
  title?: string;
  detail?: string | null;
  area?: string | null;
  priority?: OrientationPriority;
  horizon?: OrientationHorizon;
  dueAt?: string | null;
  effort?: OrientationEffort | null;
}

/**
 * One line of "how much time does today actually hold", stated by the
 * operator and amendable the same conversational way as everything else.
 * Deliberately not a calendar: `note` is the operator's own words (what they
 * read back), while the two numbers are the only things the deterministic
 * composer budgets against.
 *
 * Both numbers are nullable and mean "unknown", not "zero" — an unknown
 * dimension degrades to the pre-capacity behavior rather than silently
 * deferring everything.
 */
export interface DailyCapacity {
  localDate: string;
  note: string;
  /** How many protected 1–3h blocks today holds. 0 is meaningful: "none today". */
  sessionBlocks: number | null;
  /** Total minutes of small gaps between commitments. */
  fragmentMinutes: number | null;
  source: OrientationSource;
  createdAt: string;
  updatedAt: string;
}

export interface SetDailyCapacityInput {
  localDate: string;
  note: string;
  sessionBlocks?: number | null;
  fragmentMinutes?: number | null;
  source: OrientationSource;
}

export class OrientationEntryNotFoundError extends Error {
  public constructor(public readonly entryId: string) {
    super(`Orientation entry not found: ${entryId}`);
    this.name = "OrientationEntryNotFoundError";
  }
}

export class OrientationPacketAlreadySentError extends Error {
  public constructor(public readonly localDate: string) {
    super(`An orientation packet was already composed for ${localDate}.`);
    this.name = "OrientationPacketAlreadySentError";
  }
}

export type LedgerOp =
  | { op: "add"; entry: { title: string; entryType: OrientationEntryType; area?: string; priority?: OrientationPriority; horizon?: OrientationHorizon; dueAt?: string; effort?: OrientationEffort; detail?: string } }
  | { op: "update"; entryId: string; fields: UpdateOrientationEntryInput }
  | { op: "complete"; entryId: string }
  | { op: "reprioritize"; entryId: string; priority: OrientationPriority }
  | { op: "confirm"; entryId: string }
  | { op: "capacity"; note: string; sessionBlocks?: number; fragmentMinutes?: number }
  | { op: "context"; text: string };

export interface ReplyInterpretation {
  ops: LedgerOp[];
  echo: string;
  confidence: number;
  ambiguousQuestion?: string;
}
