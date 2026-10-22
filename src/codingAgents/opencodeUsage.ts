import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_export");
  return value as Record<string, unknown>;
};
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw new Error("invalid_export");
  return value;
};
const metric = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("invalid_metrics");
  return value;
};
const modelIdentifier = (value: unknown): string => {
  const id = identifier(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(id)) throw new Error("invalid_export");
  return id;
};

export interface OpenCodeUsageOptions { session?: string; exportFile?: string }
export interface OpenCodeUsageStep {
  stepIdSha256: string;
  providerID: string;
  modelID: string;
  reportedModelCost: number;
  tokens: { total?: number; input: number; output: number; reasoning: number; cache: { read: number; write: number } };
}
export interface OpenCodeUsageCoverage {
  status: "complete" | "partial";
  assistantMessages: number;
  meteredMessages: number;
  unmeteredMessages: number;
  errorMessages: number;
  incompleteMessages: number;
  pendingUserMessage: boolean;
}
export interface OpenCodeSessionUsage {
  kind: "local_session_telemetry";
  observation: "local_export" | "unavailable";
  source: "session_export" | "export_file";
  outcome: string;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  latestAssistantCompletedAt: string | null;
  cliVersion: string | null;
  sessionIdSha256: string | null;
  accountQuota: null;
  accountBinding: "unknown";
  windows: [];
  steps: OpenCodeUsageStep[];
  coverage: OpenCodeUsageCoverage | null;
}
export interface OpenCodeUsageDependencies {
  collectSession?: (session: string) => { text: string; cliVersion: string | null };
  readExport?: (file: string) => string;
}

/** Project usage from complete JSON, never transcript data or message totals. */
export function reduceOpenCodeExport(text: string, expectedSession?: string) {
  if (Buffer.byteLength(text) > MAX_EXPORT_BYTES) throw new Error("export_too_large");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("invalid_json"); }
  const data = record(parsed);
  const info = record(data.info);
  const session = identifier(info.id);
  if (expectedSession && session !== expectedSession) throw new Error("session_mismatch");
  const updated = metric(record(info.time).updated);
  const sourceUpdatedAt = new Date(updated).toISOString();
  if (!Array.isArray(data.messages)) throw new Error("invalid_export");
  const steps = new Map<string, OpenCodeUsageStep>();
  const messageIds = new Set<string>();
  let latestCompleted: number | null = null;
  const coverage: OpenCodeUsageCoverage = { status: "complete", assistantMessages: 0, meteredMessages: 0,
    unmeteredMessages: 0, errorMessages: 0, incompleteMessages: 0, pendingUserMessage: false };
  for (const value of data.messages) {
    const message = record(value);
    const metadata = record(message.info);
    if (identifier(metadata.sessionID) !== session) throw new Error("session_mismatch");
    const messageId = identifier(metadata.id);
    // Duplicate message envelopes could conceal incomplete or conflicting parts.
    if (messageIds.has(messageId)) throw new Error("duplicate_message");
    messageIds.add(messageId);
    if (!Array.isArray(message.parts)) throw new Error("invalid_export");
    if (metadata.role === "user") continue;
    if (metadata.role !== "assistant") throw new Error("invalid_export");
    coverage.assistantMessages++;
    if (metadata.error) coverage.errorMessages++;
    const completed = record(metadata.time).completed;
    if (completed === undefined) coverage.incompleteMessages++;
    else latestCompleted = Math.max(latestCompleted ?? 0, metric(completed));
    let messageSteps = 0;
    for (const value of message.parts) {
      const part = record(value);
      if (part.type !== "step-finish") continue;
      if (part.sessionID !== session || part.messageID !== messageId) throw new Error("session_mismatch");
      const providerID = modelIdentifier(metadata.providerID);
      const modelID = modelIdentifier(metadata.modelID);
      const partId = identifier(part.id);
      const tokens = record(part.tokens);
      const cache = record(tokens.cache);
      const step: OpenCodeUsageStep = {
        stepIdSha256: hash(JSON.stringify([session, messageId, partId])), providerID, modelID,
        reportedModelCost: metric(part.cost),
        tokens: {
          ...(tokens.total === undefined ? {} : { total: metric(tokens.total) }),
          input: metric(tokens.input), output: metric(tokens.output), reasoning: metric(tokens.reasoning),
          cache: { read: metric(cache.read), write: metric(cache.write) },
        },
      };
      const previous = steps.get(partId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(step)) throw new Error("conflicting_step");
      steps.set(partId, step);
      messageSteps++;
    }
    if (messageSteps) coverage.meteredMessages++;
    else coverage.unmeteredMessages++;
  }
  if (!steps.size) throw new Error("missing_steps");
  coverage.pendingUserMessage = record(record(data.messages.at(-1)).info).role === "user";
  if (coverage.unmeteredMessages || coverage.errorMessages || coverage.incompleteMessages || coverage.pendingUserMessage) coverage.status = "partial";
  return { sessionIdSha256: hash(session), sourceUpdatedAt, latestAssistantCompletedAt: latestCompleted === null ? null : new Date(latestCompleted).toISOString(), steps: [...steps.values()], coverage };
}

// OpenCode 1.16.2 can truncate pipe stdout at 65536 bytes while exiting zero.
// A Unix PTY makes its export complete; Python's standard library drains it in
// memory. Neither transcript intermediates nor CLI stderr are persisted.
const PTY_EXPORT = `import os, pty, select, signal, subprocess, sys, time
master, slave = pty.openpty()
process = subprocess.Popen(["opencode", "--pure", "export", sys.argv[1], "--sanitize"], stdout=slave, stderr=subprocess.DEVNULL, start_new_session=True)
os.close(slave)
chunks, size, deadline = [], 0, time.monotonic() + 15
try:
 while True:
  remaining = deadline - time.monotonic()
  if remaining <= 0: raise RuntimeError("timeout")
  if not select.select([master], [], [], remaining)[0]: raise RuntimeError("timeout")
  try: chunk = os.read(master, 65536)
  except OSError: break
  if not chunk: break
  size += len(chunk)
  if size > 8388608: raise RuntimeError("size")
  chunks.append(chunk)
 process.wait(timeout=max(0.01, deadline - time.monotonic()))
 if process.returncode: raise RuntimeError("export")
 sys.stdout.buffer.write(b"".join(chunks))
 sys.stdout.buffer.flush()
except Exception:
 sys.exit(1)
finally:
 os.close(master)
 try: os.killpg(process.pid, signal.SIGKILL)
 except ProcessLookupError: pass
 process.wait()
`;

export function collectOpenCodeSession(session: string): { text: string; cliVersion: string | null } {
  if (process.platform === "win32") throw new Error("collector_unavailable");
  const result = spawnSync("python3", ["-c", PTY_EXPORT, session], {
    encoding: "utf8", timeout: 20_000, maxBuffer: MAX_EXPORT_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error("collector_failed");
  const version = spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 3_000, maxBuffer: 1024, stdio: ["ignore", "pipe", "ignore"] });
  const cliVersion = !version.error && version.status === 0 && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version.stdout.trim()) ? version.stdout.trim() : null;
  return { text: result.stdout, cliVersion };
}

function readExport(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_EXPORT_BYTES) throw new Error("export_unavailable");
    const buffer = Buffer.alloc(MAX_EXPORT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > MAX_EXPORT_BYTES) throw new Error("export_too_large");
    return buffer.toString("utf8", 0, size);
  } finally { closeSync(fd); }
}

export function readOpenCodeUsage(options: OpenCodeUsageOptions, now: Date, deps: OpenCodeUsageDependencies = {}): OpenCodeSessionUsage | undefined {
  if (options.session === undefined && options.exportFile === undefined) return undefined;
  const result: OpenCodeSessionUsage = {
    kind: "local_session_telemetry", observation: "unavailable", source: options.session !== undefined ? "session_export" : "export_file",
    outcome: "unavailable", capturedAt: now.toISOString(), sourceUpdatedAt: null, latestAssistantCompletedAt: null, cliVersion: null,
    sessionIdSha256: null, accountQuota: null, accountBinding: "unknown", windows: [], steps: [], coverage: null,
  };
  try {
    if (options.session !== undefined && options.exportFile !== undefined) throw new Error("conflicting_sources");
    if (options.session !== undefined && !/^ses_[A-Za-z0-9]+$/.test(options.session)) throw new Error("invalid_session_id");
    if (options.exportFile !== undefined && !options.exportFile.trim()) throw new Error("invalid_export_file");
    const input = options.session !== undefined
      ? (deps.collectSession ?? collectOpenCodeSession)(options.session)
      : { text: (deps.readExport ?? readExport)(options.exportFile!), cliVersion: null };
    const reduced = reduceOpenCodeExport(input.text, options.session);
    if (Date.parse(reduced.sourceUpdatedAt) > now.getTime() || (reduced.latestAssistantCompletedAt !== null && Date.parse(reduced.latestAssistantCompletedAt) > now.getTime())) throw new Error("future_source_timestamp");
    return { ...result, ...reduced, cliVersion: input.cliVersion, observation: "local_export", outcome: reduced.coverage.status === "partial" ? "partial_coverage" : "ok" };
  } catch (error) {
    const allowed = ["conflicting_sources", "invalid_session_id", "invalid_export_file", "invalid_export", "invalid_metrics", "invalid_json", "export_too_large", "session_mismatch", "duplicate_message", "conflicting_step", "missing_steps", "collector_unavailable", "collector_failed", "future_source_timestamp"];
    result.outcome = error instanceof Error && allowed.includes(error.message) ? error.message : "export_unavailable";
    return result;
  }
}
