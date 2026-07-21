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
  source: OrientationSource;
}

export interface UpdateOrientationEntryInput {
  title?: string;
  detail?: string | null;
  area?: string | null;
  priority?: OrientationPriority;
  horizon?: OrientationHorizon;
  dueAt?: string | null;
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
  | { op: "add"; entry: { title: string; entryType: OrientationEntryType; area?: string; priority?: OrientationPriority; horizon?: OrientationHorizon; dueAt?: string; detail?: string } }
  | { op: "update"; entryId: string; fields: UpdateOrientationEntryInput }
  | { op: "complete"; entryId: string }
  | { op: "reprioritize"; entryId: string; priority: OrientationPriority }
  | { op: "confirm"; entryId: string }
  | { op: "context"; text: string };

export interface ReplyInterpretation {
  ops: LedgerOp[];
  echo: string;
  confidence: number;
  ambiguousQuestion?: string;
}
