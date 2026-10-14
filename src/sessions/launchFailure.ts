import { redactSecrets, sanitizeOutput } from "./validationEvidence.js";

export const LAUNCH_FAILURE_MAX_CHARS = 2048;

/** Keep diagnostic text, never a subprocess's argv, environment or arbitrary details. */
export function formatLaunchFailure(error: unknown): string {
  const seen = new Set<unknown>();
  function describe(value: unknown, depth: number): string {
    if (depth > 3 || seen.has(value)) return "";
    seen.add(value);
    if (typeof value === "string") return clean(value);
    if (value === null || typeof value !== "object") return clean(String(value));
    const record = value as Record<string, unknown>;
    const stderr = Buffer.isBuffer(record.stderr) ? record.stderr.toString("utf8") : record.stderr;
    // execFileSync's message includes the entire launch command (including the
    // prompt); prefer its captured stderr without rendering that message.
    const rawMessage = typeof record.message === "string" ? record.message : "Launch failed.";
    const message = typeof stderr === "string" && stderr.trim()
      ? clean(stderr)
      : rawMessage.startsWith("Command failed:")
        ? `Subprocess launch failed${typeof record.status === "number" ? ` (exit ${record.status})` : ""}.`
        : clean(rawMessage);
    const details = record.details !== null && typeof record.details === "object"
      ? record.details as Record<string, unknown> : null;
    const cause = details?.cause ?? record.cause;
    const underlying = cause === undefined ? "" : describe(cause, depth + 1);
    return underlying && underlying !== message ? `${message} Cause: ${underlying}` : message;
  }
  const text = describe(error, 0);
  if (text.length <= LAUNCH_FAILURE_MAX_CHARS) return text;
  const suffix = "… [truncated]";
  return text.slice(0, LAUNCH_FAILURE_MAX_CHARS - suffix.length).replace(/[\ud800-\udbff]$/, "") + suffix;
}

function clean(text: string): string {
  // Truncation before these passes can shorten a token below the redactor's
  // threshold; removing a long terminal escape can then expose that prefix.
  return redactSecrets(sanitizeOutput(text)).trim();
}
