import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DiscordConnectionState = "connected" | "connecting" | "disconnected" | "error";

export interface DiscordAdapterStatus {
  state: "running" | "stopped";
  connectionState: DiscordConnectionState;
  lastHeartbeatAt: string;
  lastEventAt: string | null;
}

export function discordAdapterStatusPath(workspace: string): string {
  return path.join(workspace, ".arcadia", "discord-adapter.status.json");
}

export function writeDiscordAdapterStatus(
  statusPath: string,
  update: Partial<DiscordAdapterStatus> & Pick<DiscordAdapterStatus, "state" | "connectionState">,
): void {
  const now = new Date().toISOString();
  const status: DiscordAdapterStatus = {
    state: update.state,
    connectionState: update.connectionState,
    lastHeartbeatAt: update.lastHeartbeatAt ?? now,
    lastEventAt: update.lastEventAt ?? null,
  };

  try {
    mkdirSync(path.dirname(statusPath), { recursive: true });
    writeFileSync(statusPath, JSON.stringify(status), "utf8");
  } catch {
    // Status reporting must never stop the Discord adapter.
  }
}

export function removeDiscordAdapterStatus(statusPath: string): void {
  try { unlinkSync(statusPath); } catch {}
}
