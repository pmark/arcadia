/**
 * Reading a headless provider's log so a failure can be diagnosed from the
 * receipt alone (operator action `test-headless-provider-single-action`).
 *
 * Three log shapes reach here: Claude Code's `--output-format stream-json`
 * (one JSON event per line, ending in a `result` event), Codex's `exec --json`
 * (one JSON event per line) and OpenCode's plain text. The functions are pure:
 * they take the log text and return what a human would grep for first.
 */

// eslint-disable-next-line no-control-regex -- strips terminal colour codes from provider output
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** What an unattended provider reports when something stopped it: the lines worth reading first. */
const STRONG =
  /permission denied|auto-?reject|rejected|\bdenied\b|not permitted|operation not permitted|sandbox|\bEPERM\b|\bEACCES\b|read-only file system|unauthori[sz]ed|not logged in|please run \/login|invalid api key|oauth token|rate.?limit|usage limit|quota|credit balance|external_directory|index\.lock|haven't granted|requested permissions|\[headless-provider-test\]/i;
const WEAK = /\berror\b|\bfail(?:ed|ure|s)?\b|\bfatal\b|timeout|timed out|\bcannot\b|could not|unable to|exception/i;

const MAX_LINE = 240;

const clip = (text: string, max = MAX_LINE): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

function parseEvent(line: string): Record<string, any> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "")).join(" ");
  return "";
};

export interface ClaudePermissionDenial { tool: string; command: string | null; }

export interface ClaudeResultEvent {
  subtype: string | null;
  isError: boolean;
  result: string;
  numTurns: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

export interface ClaudeStreamSummary {
  /** Lines that parsed as stream-json events. */
  events: number;
  /** The model the init event reported, if any. */
  model: string | null;
  /** The final `result` event, or null when the stream never reached one. */
  result: ClaudeResultEvent | null;
  /** Tool calls the permission posture refused (from the result event, plus tool results that said so). */
  permissionDenials: ClaudePermissionDenial[];
  /** Tool results flagged `is_error`, with the tool call that produced them. */
  toolErrors: Array<{ tool: string; command: string | null; message: string }>;
}

/** Parse Claude Code `--output-format stream-json` output (tolerating interleaved plain text). */
export function parseClaudeStream(log: string): ClaudeStreamSummary {
  const summary: ClaudeStreamSummary = { events: 0, model: null, result: null, permissionDenials: [], toolErrors: [] };
  const calls = new Map<string, { tool: string; command: string | null }>();
  for (const raw of log.replace(ANSI, "").split("\n")) {
    const event = parseEvent(raw);
    if (!event || typeof event.type !== "string") continue;
    summary.events += 1;
    if (event.type === "system" && event.subtype === "init" && typeof event.model === "string") summary.model = event.model;
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const part of event.message.content) {
        if (part?.type === "tool_use" && typeof part.id === "string") {
          const input = part.input ?? {};
          calls.set(part.id, { tool: String(part.name ?? "tool"), command: typeof input.command === "string" ? input.command : typeof input.file_path === "string" ? input.file_path : null });
        }
      }
    }
    if (event.type === "user" && Array.isArray(event.message?.content)) {
      for (const part of event.message.content) {
        if (part?.type !== "tool_result" || part.is_error !== true) continue;
        const call = calls.get(String(part.tool_use_id)) ?? { tool: "tool", command: null };
        summary.toolErrors.push({ ...call, message: clip(textOf(part.content)) });
      }
    }
    if (event.type === "result") {
      summary.result = {
        subtype: typeof event.subtype === "string" ? event.subtype : null,
        isError: event.is_error === true,
        result: typeof event.result === "string" ? event.result : "",
        numTurns: typeof event.num_turns === "number" ? event.num_turns : null,
        durationMs: typeof event.duration_ms === "number" ? event.duration_ms : null,
        costUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : null
      };
      if (Array.isArray(event.permission_denials)) {
        for (const denial of event.permission_denials) {
          summary.permissionDenials.push({
            tool: String(denial?.tool_name ?? "tool"),
            command: typeof denial?.tool_input?.command === "string" ? denial.tool_input.command : typeof denial?.tool_input?.file_path === "string" ? denial.tool_input.file_path : null
          });
        }
      }
    }
  }
  return summary;
}

/** One line for the exit criterion: how Claude's own result event describes the end of the run. */
export function describeClaudeResult(summary: ClaudeStreamSummary): string {
  if (!summary.result) return summary.events === 0 ? "no stream-json events in the log" : `${summary.events} stream-json events but no result event`;
  const { result } = summary;
  return `result event ${result.isError ? "is_error=true" : "ok"}${result.subtype ? ` (${result.subtype})` : ""}${result.numTurns !== null ? `, ${result.numTurns} turns` : ""}${summary.permissionDenials.length ? `, ${summary.permissionDenials.length} permission denial(s)` : ""}`;
}

/**
 * Evidence that a Claude run could not commit or reach protected preservation because its headless allow list does not carry
 * `git commit` or the broker (the expected posture: Arcadia allows only the validation commands and `agent-ask draft`). The result
 * event's `permission_denials` is the source; returns the denied command, or null.
 */
export function claudePreservationDenied(log: string): string | null {
  const summary = parseClaudeStream(log);
  const denied = [...summary.permissionDenials, ...summary.toolErrors.filter((error) => /haven't granted|requested permissions|permission to use/i.test(error.message))];
  for (const entry of denied) {
    const command = entry.command ?? "";
    if (/arcadia-preserve-broker|\bgit\s+(-\S+\s+)*(commit|add)\b/.test(command)) return clip(command, 120);
  }
  return null;
}

/**
 * The first relevant error lines of a provider log, strongest signals first (permission, sandbox, sign-in, rate limits), then
 * generic failures; at most `limit`. Structured events contribute their error text, never model chatter.
 */
export function extractDiagnosis(log: string, limit = 6): string[] {
  const strong: string[] = [];
  const weak: string[] = [];
  const seen = new Set<string>();
  const push = (line: string, forceStrong = false) => {
    const text = clip(line);
    if (!text || seen.has(text)) return;
    seen.add(text);
    if (forceStrong || STRONG.test(text)) strong.push(text);
    else if (WEAK.test(text)) weak.push(text);
  };
  const stream = parseClaudeStream(log);
  const claudeLines: string[] = [];
  if (stream.result?.isError) claudeLines.push(`claude result is_error=true${stream.result.subtype ? ` (${stream.result.subtype})` : ""}: ${clip(stream.result.result || "(no message)", 200)}`);
  for (const denial of stream.permissionDenials) claudeLines.push(`permission denied: ${denial.tool}${denial.command ? ` \`${clip(denial.command, 120)}\`` : ""}`);
  for (const error of stream.toolErrors) claudeLines.push(`tool error: ${error.tool}${error.command ? ` \`${clip(error.command, 100)}\`` : ""} -> ${error.message}`);
  const claudeSeen = new Set<string>();
  for (const line of claudeLines) { if (!claudeSeen.has(line)) { claudeSeen.add(line); push(line, true); } }

  for (const raw of log.replace(ANSI, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const event = parseEvent(line);
    if (!event) { push(line); continue; }
    switch (event.type) {
      case "error": push(`error event: ${textOf(event.message) || textOf(event.error?.message) || JSON.stringify(event.error ?? event).slice(0, 200)}`, true); break;
      case "turn.failed": push(`turn failed: ${textOf(event.error?.message) || JSON.stringify(event.error ?? {}).slice(0, 200)}`, true); break;
      case "item.completed": {
        const item = event.item ?? {};
        if (item.type === "command_execution") {
          const output = String(item.aggregated_output ?? item.output ?? "");
          const failed = typeof item.exit_code === "number" && item.exit_code !== 0;
          if (failed || STRONG.test(output)) push(`command${failed ? ` failed (exit ${item.exit_code})` : ""}: ${clip(String(item.command ?? ""), 100)} -> ${clip(output, 160)}`, STRONG.test(output));
        } else if (item.type === "error") {
          push(`error item: ${textOf(item.message)}`, true);
        }
        break;
      }
      case "system":
        if (event.subtype === "api_retry") push(`api retry: ${textOf(event.error) || "error"}${event.error_status ? ` (status ${event.error_status})` : ""}`, true);
        break;
      default: break; // Claude events were handled above; other events are chatter.
    }
  }
  return [...strong, ...weak].slice(0, limit);
}
