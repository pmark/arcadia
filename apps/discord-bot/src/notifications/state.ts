import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface NotificationState {
  initializedAt: string;
  lastRequiresReviewCount: number;
  notifiedRunIds: string[];
  notifiedMilestoneIds: string[];
}

export function notificationStatePath(workspace: string): string {
  return path.join(workspace, "database", "discord-notifications.json");
}

export async function loadNotificationState(filePath: string): Promise<NotificationState | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as NotificationState;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveNotificationState(filePath: string, state: NotificationState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}
