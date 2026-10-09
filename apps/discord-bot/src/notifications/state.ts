import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface NotificationState {
  initializedAt: string;
  lastRequiresReviewCount: number;
  notifiedReviewItemIds: string[];
  notifiedRunIds: string[];
  notifiedMilestoneIds: string[];
  notifiedBlockedWorkItemIds: string[];
  notifiedArtifactIds: string[];
  codexTaskStatuses: Record<string, string>;
  notifiedCodexTaskEvents: string[];
}

export interface DiscordSubmissionState {
  submittedAskIds: string[];
  submittedWorkItemIds: string[];
  submittedRunIds: string[];
  updatedAt: string;
}

export interface DiscordSubmissionRecord {
  askId: string;
  workItemId: string | null;
  runId: string | null;
}

export interface ReviewMessageState {
  messages: Record<string, ReviewMessageRecord>;
  updatedAt: string;
}

export interface ReviewMessageRecord {
  reviewId: string;
  reviewSlug: string;
  channelId: string;
  messageId: string;
  createdAt: string;
}

/** A posted Ask receipt, so a reply to that message can correct the Ask it names. */
export interface AskReceiptMessageRecord {
  askId: string;
  channelId: string;
  messageId: string;
  createdAt: string;
}

export interface AskReceiptMessageState {
  messages: Record<string, AskReceiptMessageRecord>;
  updatedAt: string;
}

export function askReceiptMessageStatePath(workspace: string): string {
  return path.join(workspace, "database", "discord-ask-receipts.json");
}

export function notificationStatePath(workspace: string): string {
  return path.join(workspace, "database", "discord-notifications.json");
}

export function discordSubmissionStatePath(workspace: string): string {
  return path.join(workspace, "database", "discord-submissions.json");
}

export function reviewMessageStatePath(workspace: string): string {
  return path.join(workspace, "database", "discord-review-messages.json");
}

export async function loadNotificationState(filePath: string): Promise<NotificationState | null> {
  try {
    return normalizeNotificationState(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function normalizeNotificationState(raw: unknown): NotificationState {
  if (!raw || typeof raw !== "object") {
    return emptyNotificationState();
  }

  const record = raw as Partial<NotificationState>;
  return {
    initializedAt: typeof record.initializedAt === "string" ? record.initializedAt : new Date().toISOString(),
    lastRequiresReviewCount: typeof record.lastRequiresReviewCount === "number" ? record.lastRequiresReviewCount : 0,
    notifiedReviewItemIds: stringArray(record.notifiedReviewItemIds),
    notifiedRunIds: stringArray(record.notifiedRunIds),
    notifiedMilestoneIds: stringArray(record.notifiedMilestoneIds),
    notifiedBlockedWorkItemIds: stringArray(record.notifiedBlockedWorkItemIds),
    notifiedArtifactIds: stringArray(record.notifiedArtifactIds),
    codexTaskStatuses: record.codexTaskStatuses && typeof record.codexTaskStatuses === "object"
      ? Object.fromEntries(
          Object.entries(record.codexTaskStatuses).filter(
            (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"
          )
        )
      : {},
    notifiedCodexTaskEvents: stringArray(record.notifiedCodexTaskEvents)
  };
}

function emptyNotificationState(now = new Date().toISOString()): NotificationState {
  return {
    initializedAt: now,
    lastRequiresReviewCount: 0,
    notifiedReviewItemIds: [],
    notifiedRunIds: [],
    notifiedMilestoneIds: [],
    notifiedBlockedWorkItemIds: [],
    notifiedArtifactIds: [],
    codexTaskStatuses: {},
    notifiedCodexTaskEvents: []
  };
}

export async function loadDiscordSubmissionState(filePath: string): Promise<DiscordSubmissionState> {
  try {
    return normalizeDiscordSubmissionState(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyDiscordSubmissionState();
    }
    throw error;
  }
}

export async function loadReviewMessageState(filePath: string): Promise<ReviewMessageState> {
  try {
    return normalizeReviewMessageState(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyReviewMessageState();
    }
    throw error;
  }
}

export async function loadAskReceiptMessageState(filePath: string): Promise<AskReceiptMessageState> {
  try {
    return normalizeAskReceiptMessageState(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyAskReceiptMessageState();
    }
    throw error;
  }
}

/** Records which Ask a posted receipt message names, the way {@link recordReviewMessage} does for Decisions. */
export async function recordAskReceiptMessage(
  filePath: string,
  record: AskReceiptMessageRecord,
  now = new Date().toISOString()
): Promise<AskReceiptMessageState> {
  const state = await loadAskReceiptMessageState(filePath);
  const nextState: AskReceiptMessageState = {
    messages: { ...state.messages, [record.messageId]: record },
    updatedAt: now
  };
  await writeJsonAtomically(filePath, nextState);
  return nextState;
}

function emptyAskReceiptMessageState(now = new Date().toISOString()): AskReceiptMessageState {
  return { messages: {}, updatedAt: now };
}

function normalizeAskReceiptMessageState(raw: unknown): AskReceiptMessageState {
  if (!raw || typeof raw !== "object") {
    return emptyAskReceiptMessageState();
  }
  const record = raw as Partial<AskReceiptMessageState>;
  const messages = record.messages && typeof record.messages === "object"
    ? Object.fromEntries(
        Object.entries(record.messages).filter((entry): entry is [string, AskReceiptMessageRecord] => {
          const value = entry[1] as Partial<AskReceiptMessageRecord> | null;
          return Boolean(value) && typeof value === "object" &&
            typeof value?.askId === "string" &&
            typeof value?.channelId === "string" &&
            typeof value?.messageId === "string" &&
            typeof value?.createdAt === "string";
        })
      )
    : {};
  return {
    messages,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
  };
}

export async function saveNotificationState(filePath: string, state: NotificationState): Promise<void> {
  await writeJsonAtomically(filePath, state);
}

export async function saveDiscordSubmissionState(filePath: string, state: DiscordSubmissionState): Promise<void> {
  await writeJsonAtomically(filePath, state);
}

export async function saveReviewMessageState(filePath: string, state: ReviewMessageState): Promise<void> {
  await writeJsonAtomically(filePath, state);
}

export async function recordReviewMessage(
  filePath: string,
  record: ReviewMessageRecord,
  now = new Date().toISOString()
): Promise<ReviewMessageState> {
  const state = await loadReviewMessageState(filePath);
  const nextState: ReviewMessageState = {
    messages: {
      ...state.messages,
      [record.messageId]: record
    },
    updatedAt: now
  };
  await saveReviewMessageState(filePath, nextState);
  return nextState;
}

export async function recordDiscordSubmission(
  filePath: string,
  submission: DiscordSubmissionRecord,
  now = new Date().toISOString()
): Promise<DiscordSubmissionState> {
  const state = await loadDiscordSubmissionState(filePath);
  const nextState: DiscordSubmissionState = {
    submittedAskIds: appendUnique(state.submittedAskIds, submission.askId),
    submittedWorkItemIds: submission.workItemId
      ? appendUnique(state.submittedWorkItemIds, submission.workItemId)
      : state.submittedWorkItemIds,
    submittedRunIds: submission.runId ? appendUnique(state.submittedRunIds, submission.runId) : state.submittedRunIds,
    updatedAt: now
  };
  await saveDiscordSubmissionState(filePath, nextState);
  return nextState;
}

function emptyDiscordSubmissionState(now = new Date().toISOString()): DiscordSubmissionState {
  return {
    submittedAskIds: [],
    submittedWorkItemIds: [],
    submittedRunIds: [],
    updatedAt: now
  };
}

function normalizeDiscordSubmissionState(raw: unknown): DiscordSubmissionState {
  if (!raw || typeof raw !== "object") {
    return emptyDiscordSubmissionState();
  }

  const record = raw as Partial<DiscordSubmissionState>;
  return {
    submittedAskIds: stringArray(record.submittedAskIds),
    submittedWorkItemIds: stringArray(record.submittedWorkItemIds),
    submittedRunIds: stringArray(record.submittedRunIds),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
  };
}

function emptyReviewMessageState(now = new Date().toISOString()): ReviewMessageState {
  return {
    messages: {},
    updatedAt: now
  };
}

function normalizeReviewMessageState(raw: unknown): ReviewMessageState {
  if (!raw || typeof raw !== "object") {
    return emptyReviewMessageState();
  }

  const record = raw as Partial<ReviewMessageState>;
  const messages = record.messages && typeof record.messages === "object"
    ? Object.fromEntries(
        Object.entries(record.messages).filter((entry): entry is [string, ReviewMessageRecord] => {
          if (!entry[1] || typeof entry[1] !== "object") {
            return false;
          }
          const value = entry[1] as Partial<ReviewMessageRecord>;
          return typeof entry[0] === "string" &&
            typeof value.reviewId === "string" &&
            typeof value.reviewSlug === "string" &&
            typeof value.channelId === "string" &&
            typeof value.messageId === "string" &&
            typeof value.createdAt === "string";
        })
      )
    : {};

  return {
    messages,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
  };
}

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
}

export function appendUnique(values: string[], value: string): string[] {
  return Array.from(new Set([...values, value]));
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}
