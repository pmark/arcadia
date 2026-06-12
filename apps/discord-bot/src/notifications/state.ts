import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface NotificationState {
  initializedAt: string;
  lastRequiresReviewCount: number;
  notifiedRunIds: string[];
  notifiedMilestoneIds: string[];
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

export function notificationStatePath(workspace: string): string {
  return path.join(workspace, "database", "discord-notifications.json");
}

export function discordSubmissionStatePath(workspace: string): string {
  return path.join(workspace, "database", "discord-submissions.json");
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
    notifiedRunIds: stringArray(record.notifiedRunIds),
    notifiedMilestoneIds: stringArray(record.notifiedMilestoneIds),
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
    notifiedRunIds: [],
    notifiedMilestoneIds: [],
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

export async function saveNotificationState(filePath: string, state: NotificationState): Promise<void> {
  await writeJsonAtomically(filePath, state);
}

export async function saveDiscordSubmissionState(filePath: string, state: DiscordSubmissionState): Promise<void> {
  await writeJsonAtomically(filePath, state);
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

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
}

function appendUnique(values: string[], value: string): string[] {
  return Array.from(new Set([...values, value]));
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}
