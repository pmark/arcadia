export type LogLevel = "info" | "warn" | "error";

export function logJson(level: LogLevel, obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level, ...obj })}\n`);
}
