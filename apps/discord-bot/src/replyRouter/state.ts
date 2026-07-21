import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ReplyFeature = "playground" | "orientation";

export interface RegisteredMessage {
  messageId: string;
  feature: ReplyFeature;
  entityId: string;
  threadId?: string;
  createdAt: string;
}

export interface ReplyRouterState {
  messages: Record<string, RegisteredMessage>;
  updatedAt: string;
}

export function replyRouterStatePath(workspace: string): string {
  return path.join(workspace, "database", "discord-reply-router.json");
}

function emptyState(now = new Date().toISOString()): ReplyRouterState {
  return { messages: {}, updatedAt: now };
}

function normalizeState(raw: unknown): ReplyRouterState {
  if (!raw || typeof raw !== "object") {
    return emptyState();
  }
  const record = raw as Partial<ReplyRouterState>;
  const messages =
    record.messages && typeof record.messages === "object"
      ? Object.fromEntries(
          Object.entries(record.messages).filter((entry): entry is [string, RegisteredMessage] => {
            if (!entry[1] || typeof entry[1] !== "object") {
              return false;
            }
            const value = entry[1] as Partial<RegisteredMessage>;
            return (
              typeof entry[0] === "string" &&
              typeof value.messageId === "string" &&
              (value.feature === "playground" || value.feature === "orientation") &&
              typeof value.entityId === "string" &&
              typeof value.createdAt === "string"
            );
          })
        )
      : {};
  return {
    messages,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
  };
}

export async function loadReplyRouterState(filePath: string): Promise<ReplyRouterState> {
  try {
    return normalizeState(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyState();
    }
    throw error;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function saveReplyRouterState(filePath: string, state: ReplyRouterState): Promise<void> {
  await writeJsonAtomically(filePath, state);
}

export async function registerMessage(
  filePath: string,
  message: RegisteredMessage
): Promise<ReplyRouterState> {
  const state = await loadReplyRouterState(filePath);
  const nextState: ReplyRouterState = {
    messages: { ...state.messages, [message.messageId]: message },
    updatedAt: new Date().toISOString()
  };
  await saveReplyRouterState(filePath, nextState);
  return nextState;
}
