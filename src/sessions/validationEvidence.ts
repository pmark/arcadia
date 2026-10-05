/**
 * The "Validation evidence" section a host-preserved candidate pull request
 * carries after its Operator QA plan.
 *
 * Independent QA judges "Tests and evidence" from the pull request alone, and
 * a plan that only says "host validation recorded exit code 0" is a claim, not
 * evidence. This module renders what host validation actually recorded: for
 * each declared validation command, the command, its working directory, exit
 * code, duration and a bounded tail of its stdout and stderr.
 *
 * Provenance: everything comes from the host validation record the
 * preservation receipt cites (`validationEvidenceRef`, written only by
 * `validateBoundCandidate` under `artifacts/preservation/`) and the governed
 * declared validation commands. The record must name the exact candidate tree
 * the receipt preserved; a record for another tree is reported, never shown.
 * No model writes any of it, and the same inputs always render the same bytes.
 *
 * Command output is untrusted text written by the candidate's own checks. It
 * is never interpreted: ANSI and other control characters are replaced,
 * bidirectional overrides are removed, secret-shaped tokens are redacted
 * (defence in depth: the checks run without network or secrets in their
 * environment), binary output is withheld, and only the last lines within a
 * fixed byte cap per stream are kept, inside a code fence its content cannot
 * close. The whole body stays under GitHub's pull-request body limit: tails
 * shrink deterministically, then the section collapses to its status line.
 *
 * Absence is explicit, never a failure of preservation: a missing, unreadable,
 * incomplete or unbound record, or a failed, timed-out or missing command,
 * renders its status, and the candidate is preserved exactly as before.
 */
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { code, inlineText } from "./operatorQaPlan.js";

/** GitHub rejects a pull-request body over 65,536 characters; stay inside it. */
export const PRESERVED_PULL_REQUEST_BODY_MAX_CHARS = 65_000;
/** Fixed cap per output stream, in UTF-8 bytes of the sanitised text; the last lines are kept. */
export const VALIDATION_OUTPUT_TAIL_BYTES = 2_048;
/** Deterministic fallbacks, in order, when the full section does not fit the body. */
const TAIL_BYTE_STEPS = [VALIDATION_OUTPUT_TAIL_BYTES, 1_024, 512, 256, 0] as const;
/** The host record holds at most 10 commands x 2 streams x 1 MiB, JSON-escaped. */
const MAX_EVIDENCE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_COMMAND_CHARS = 500;
const MAX_ERROR_CHARS = 300;
const KNOWN_PRODUCER = "arcadia-host-seatbelt-v1";
const EVIDENCE_PATH = /(?:^|\/)(artifacts\/preservation\/[^/]+\/check-[^/]+\/validation\.json)$/;

const HEADING = "### Validation evidence";

/**
 * One fixed line, always rendered: a candidate that settles its own completion
 * before review is following Arcadia's process, not crossing an approval gate.
 */
export const COMPLETION_SETTLEMENT_LINE =
  "**Completion settlement:** a candidate's own governed completion-settlement commit (the commit that marks this Action done and advances the Plan pointer, with its archived Agent Ask) is the record Arcadia expects before independent review and is not an approval-boundary crossing; the independent review verdicts and the operator or worker integration remain separate gates.";

/** One declared command's result as host validation recorded it. */
export interface ValidationCheckRecord {
  command: string;
  exitStatus: number | null;
  signal: string | null;
  error: string | null;
  stdout: string | null;
  stderr: string | null;
  /** Recorded by producers after 2026-10-05; absent in earlier records. */
  cwd?: string;
  durationMs?: number;
  timedOut?: boolean;
  timeoutMs?: number;
}

/** The parts of the host validation record this section reads. */
export interface ValidationEvidenceRecord {
  producer: string;
  tree: string;
  complete: boolean;
  runningCommand: string | null;
  results: ValidationCheckRecord[];
}

export type ValidationEvidenceRead =
  | { status: "read"; record: ValidationEvidenceRecord }
  | { status: "unreadable"; reason: string };

export interface ValidationEvidenceInput {
  /** The receipt's `validationEvidenceRef`. */
  evidenceRef: string;
  evidence: ValidationEvidenceRead;
  /** The Project's declared validation commands (the Operator QA plan's source). */
  declaredCommands: readonly string[];
  /** The receipt's `candidateFingerprint`: the tree preservation committed. */
  candidateFingerprint: string;
}

/**
 * Read the host validation record a preservation receipt cites. Only a regular
 * file at Arcadia's own `artifacts/preservation/<id>/check-<n>/validation.json`
 * shape is read, and only up to a fixed size; anything else is "unreadable".
 */
export function readValidationEvidence(evidenceRef: string): ValidationEvidenceRead {
  if (!path.isAbsolute(evidenceRef) || !EVIDENCE_PATH.test(evidenceRef)) {
    return { status: "unreadable", reason: "the receipt does not cite a host validation record under artifacts/preservation/" };
  }
  let text: string;
  try {
    const stat = lstatSync(evidenceRef);
    if (!stat.isFile()) return { status: "unreadable", reason: "the cited record is not a regular file" };
    if (stat.size > MAX_EVIDENCE_FILE_BYTES) return { status: "unreadable", reason: `the cited record is ${stat.size} bytes, over the ${MAX_EVIDENCE_FILE_BYTES}-byte read limit` };
    text = readFileSync(evidenceRef, "utf8");
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "the cited record does not exist" : "the cited record could not be read";
    return { status: "unreadable", reason };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "unreadable", reason: "the cited record is not valid JSON" };
  }
  return parseValidationEvidence(value);
}

/** Validate an already-parsed host validation record (pure). */
export function parseValidationEvidence(value: unknown): ValidationEvidenceRead {
  const malformed = (what: string): ValidationEvidenceRead => ({ status: "unreadable", reason: `the cited record is malformed (${what})` });
  if (!isObject(value)) return malformed("not an object");
  if (typeof value.producer !== "string") return malformed("no producer");
  if (typeof value.tree !== "string" || !value.tree) return malformed("no candidate tree");
  if (typeof value.complete !== "boolean") return malformed("no completion flag");
  if (!Array.isArray(value.results)) return malformed("no results");
  const results: ValidationCheckRecord[] = [];
  for (const entry of value.results) {
    if (!isObject(entry) || typeof entry.command !== "string") return malformed("a result without a command");
    const result: ValidationCheckRecord = {
      command: entry.command,
      exitStatus: Number.isInteger(entry.exitStatus) ? entry.exitStatus as number : null,
      signal: typeof entry.signal === "string" ? entry.signal : null,
      error: typeof entry.error === "string" ? entry.error : null,
      stdout: typeof entry.stdout === "string" ? entry.stdout : null,
      stderr: typeof entry.stderr === "string" ? entry.stderr : null
    };
    if (typeof entry.cwd === "string") result.cwd = entry.cwd;
    if (typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs) && entry.durationMs >= 0) result.durationMs = entry.durationMs;
    if (typeof entry.timedOut === "boolean") result.timedOut = entry.timedOut;
    if (typeof entry.timeoutMs === "number" && Number.isFinite(entry.timeoutMs) && entry.timeoutMs > 0) result.timeoutMs = entry.timeoutMs;
    results.push(result);
  }
  return {
    status: "read",
    record: {
      producer: value.producer,
      tree: value.tree,
      complete: value.complete,
      runningCommand: typeof value.runningCommand === "string" ? value.runningCommand : null,
      results
    }
  };
}

/**
 * The preserved pull-request body: the Operator QA plan, unchanged, then the
 * Validation evidence section and the completion-settlement line, bounded by
 * `maxChars`. Pure and deterministic. If even the status-only section cannot
 * fit, the plan is returned exactly as before.
 */
export function composePreservedPullRequestBody(
  planBody: string,
  input: ValidationEvidenceInput,
  maxChars: number = PRESERVED_PULL_REQUEST_BODY_MAX_CHARS
): string {
  const prepared = prepareValidationEvidence(input);
  const join = (section: string) => `${planBody}\n\n${section}\n\n${COMPLETION_SETTLEMENT_LINE}`;
  for (const tailBytes of TAIL_BYTE_STEPS) {
    const body = join(formatSection(prepared, tailBytes));
    if (body.length <= maxChars) return body;
  }
  const minimal = join(formatSummary(prepared, maxChars));
  return minimal.length <= maxChars ? minimal : planBody;
}

/** The section alone at a given tail cap (the default is the fixed per-stream cap). */
export function renderValidationEvidence(input: ValidationEvidenceInput, tailBytes: number = VALIDATION_OUTPUT_TAIL_BYTES): string {
  return formatSection(prepareValidationEvidence(input), tailBytes);
}

/** A section stating only that the evidence could not be rendered; never derived from output. */
export function unavailableValidationEvidence(reason: string): string {
  return [HEADING, "", `**Status:** unavailable — ${inlineText(reason)} Arcadia preserved the candidate as usual; this body does not prove validation.`].join("\n");
}

// --- preparation ---------------------------------------------------------

type CommandStatus = "passed" | "failed" | "timed out" | "did not complete" | "missing";

interface PreparedStream {
  kind: "absent" | "empty" | "binary" | "text";
  recordedBytes: number;
  /** Sanitised full text (kind "text" only). */
  text: string;
}

interface PreparedCommand {
  index: number;
  declared: string;
  status: CommandStatus;
  result: ValidationCheckRecord | null;
  stdout: PreparedStream;
  stderr: PreparedStream;
}

type Prepared =
  | { kind: "unreadable"; ref: string; reason: string }
  | { kind: "unbound"; ref: string; producer: string; tree: string; expected: string }
  | { kind: "none-declared"; ref: string }
  | { kind: "results"; ref: string; record: ValidationEvidenceRecord; tree: string; commands: PreparedCommand[]; undeclared: number };

function prepareValidationEvidence(input: ValidationEvidenceInput): Prepared {
  const ref = displayRef(input.evidenceRef);
  if (input.evidence.status !== "read") return { kind: "unreadable", ref, reason: input.evidence.reason };
  const record = input.evidence.record;
  if (record.tree !== input.candidateFingerprint) {
    return { kind: "unbound", ref, producer: record.producer, tree: record.tree, expected: input.candidateFingerprint };
  }
  const declared = input.declaredCommands.map((command) => command.trim()).filter(Boolean);
  if (declared.length === 0) return { kind: "none-declared", ref };
  const commands = declared.map((command, index): PreparedCommand => {
    const candidate = record.results[index];
    const result = candidate && candidate.command.trim() === command ? candidate : null;
    return {
      index,
      declared: command,
      status: result ? commandStatus(result) : "missing",
      result,
      stdout: prepareStream(result?.stdout ?? null),
      stderr: prepareStream(result?.stderr ?? null)
    };
  });
  const undeclared = record.results.filter((result) => !declared.includes(result.command.trim())).length;
  return { kind: "results", ref, record, tree: record.tree, commands, undeclared };
}

function commandStatus(result: ValidationCheckRecord): CommandStatus {
  if (result.timedOut === true || (result.error !== null && /\bETIMEDOUT\b/.test(result.error))) return "timed out";
  if (result.error !== null || result.signal !== null || result.exitStatus === null) return "did not complete";
  return result.exitStatus === 0 ? "passed" : "failed";
}

function prepareStream(raw: string | null): PreparedStream {
  if (raw === null) return { kind: "absent", recordedBytes: 0, text: "" };
  const recordedBytes = Buffer.byteLength(raw, "utf8");
  if (isBinary(raw)) return { kind: "binary", recordedBytes, text: "" };
  const text = redactSecrets(sanitizeOutput(raw)).replace(/\s+$/, "");
  if (!text.trim()) return { kind: "empty", recordedBytes, text: "" };
  return { kind: "text", recordedBytes, text };
}

/** NUL bytes, or more than 1 in 20 characters undecodable or non-text control: withhold as binary. */
function isBinary(raw: string): boolean {
  if (raw.includes("\u0000")) return true;
  // eslint-disable-next-line no-control-regex -- counting control characters is the point
  const suspicious = raw.match(/[\u0001-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f-\u009f\ufffd]/g)?.length ?? 0;
  return suspicious > 8 && suspicious * 20 > raw.length;
}

/**
 * Terminal escapes removed, line endings normalised, every remaining control
 * and bidirectional-formatting character replaced with "?". Tabs and newlines stay.
 */
/* eslint-disable no-control-regex -- stripping terminal escapes and control characters is the point */
export function sanitizeOutput(raw: string): string {
  return raw
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[ -/]*[0-~]?/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\t\n]/gu, "?")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "?");
}
/* eslint-enable no-control-regex */

/** Well-known credential shapes; defence in depth, not a guarantee. */
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, "[redacted private key]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted token]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[redacted token]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted token]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted token]"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, "[redacted token]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, "$1 [redacted]"],
  [/\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY)[A-Za-z0-9_]*\s*[=:]\s*)["']?[^\s"']{8,}["']?/gi, "$1[redacted]"]
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

/** The last whole lines within `capBytes` UTF-8 bytes (a single longer line keeps its end). */
function tail(text: string, capBytes: number): { text: string; keptBytes: number; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= capBytes) return { text, keptBytes: bytes.length, truncated: false };
  let start = bytes.length - capBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  let kept = bytes.subarray(start).toString("utf8");
  if (bytes[start - 1] !== 0x0a) {
    const newline = kept.indexOf("\n");
    kept = newline >= 0 && newline < kept.length - 1 ? kept.slice(newline + 1) : `…${kept}`;
  }
  return { text: kept, keptBytes: Buffer.byteLength(kept.replace(/^…/, ""), "utf8"), truncated: true };
}

// --- formatting ----------------------------------------------------------

function formatSection(prepared: Prepared, tailBytes: number): string {
  const lines = [HEADING, "", intro(prepared), "", `- **Record:** ${recordLine(prepared)}`, `- **Status:** ${overallStatus(prepared)}`];
  if (prepared.kind !== "results") return lines.join("\n");
  if (prepared.undeclared > 0) {
    lines.push(`- **Not shown:** ${prepared.undeclared} recorded ${prepared.undeclared === 1 ? "result is" : "results are"} for commands the Project does not declare.`);
  }
  if (tailBytes === 0) {
    lines.push("- **Output:** command output tails are omitted so this body stays within GitHub's pull-request body limit; the full output is in the record above.");
  }
  const total = prepared.commands.length;
  for (const command of prepared.commands) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(`#### Command ${command.index + 1} of ${total} — ${command.status}`, "");
    lines.push(`- **Command:** ${code(clip(command.declared, MAX_COMMAND_CHARS))}`);
    const result = command.result;
    if (!result) {
      lines.push("- **Result:** none recorded: host validation has no result for this declared command, so it is unproven.");
      continue;
    }
    lines.push(`- **Working directory:** ${workingDirectory(result, prepared.tree)}`);
    lines.push(`- **Exit code:** ${exitLine(result, command.status)}`);
    lines.push(`- **Duration:** ${result.durationMs === undefined ? "not recorded in this record" : formatDuration(result.durationMs)}`);
    if (tailBytes > 0) {
      lines.push(...formatStream("stdout", command.stdout, tailBytes));
      lines.push(...formatStream("stderr", command.stderr, tailBytes));
    }
  }
  while (lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** Status only, when the plan leaves too little room for per-command detail. */
function formatSummary(prepared: Prepared, maxChars: number): string {
  return [HEADING, "", `- **Record:** ${recordLine(prepared)}`, `- **Status:** ${overallStatus(prepared)}`,
    `- **Details:** omitted so this body stays within ${maxChars} characters; the full record is cited above.`].join("\n");
}

function intro(prepared: Prepared): string {
  const base = "Rendered by Arcadia host preservation from the host validation record this candidate's preservation receipt cites; no model wrote it.";
  return prepared.kind === "results"
    ? `${base} Command output is untrusted text from the candidate's checks: it is shown with control characters replaced, secret-shaped tokens redacted and only its last lines kept (at most ${VALIDATION_OUTPUT_TAIL_BYTES} bytes per stream).`
    : base;
}

function recordLine(prepared: Prepared): string {
  const ref = code(prepared.ref);
  switch (prepared.kind) {
    case "unreadable":
    case "none-declared":
      return ref;
    case "unbound":
      return `${ref} (producer ${code(clip(prepared.producer, 100))})`;
    case "results":
      return `${ref} (producer ${code(clip(prepared.record.producer, 100))}), bound to candidate tree ${code(prepared.tree)}`;
  }
}

function overallStatus(prepared: Prepared): string {
  const preserved = "Arcadia preserved the candidate as usual; this body does not prove validation.";
  switch (prepared.kind) {
    case "unreadable":
      return `missing — ${inlineText(prepared.reason)}. ${preserved}`;
    case "unbound":
      return `not bound to this candidate — the record is for candidate tree ${code(clip(prepared.tree, 80))}, not the preserved tree ${code(clip(prepared.expected, 80))}, so its results are not shown. ${preserved}`;
    case "none-declared":
      return "none declared — the Project declares no validation commands, so there is no validation output to show.";
    case "results": {
      const total = prepared.commands.length;
      const notPassed = prepared.commands.filter((command) => command.status !== "passed");
      const incomplete = prepared.record.complete
        ? ""
        : `incomplete — host validation did not finalise this record${prepared.record.runningCommand === null ? "" : ` (it was running ${code(clip(prepared.record.runningCommand, MAX_COMMAND_CHARS))})`}. `;
      if (notPassed.length === 0 && !incomplete) {
        return `passed — ${total === 1 ? "the declared validation command" : `all ${total} declared validation commands`} ran to completion and exited 0.`;
      }
      const counts = (["failed", "timed out", "did not complete", "missing"] as const)
        .map((status) => [status, notPassed.filter((command) => command.status === status).length] as const)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${count} ${status}`);
      const summary = notPassed.length === 0
        ? "every recorded command exited 0, but the record is not final."
        : `${notPassed.length} of ${total} declared validation commands did not pass (${counts.join(", ")}).`;
      return `${incomplete || "failed — "}${summary} ${preserved}`;
    }
  }
}

function workingDirectory(result: ValidationCheckRecord, tree: string): string {
  const meaning = `the root of candidate tree ${code(tree.slice(0, 12))}, a disposable host copy checked under the macOS Seatbelt sandbox with no network`;
  return result.cwd === undefined
    ? `not recorded in this record; producer ${code(KNOWN_PRODUCER)} runs every check from ${meaning}`
    : `${code(clip(result.cwd, 300))} — ${meaning}`;
}

function exitLine(result: ValidationCheckRecord, status: CommandStatus): string {
  const exit = result.exitStatus === null ? "none" : code(String(result.exitStatus));
  const parts = [exit];
  if (status === "timed out") parts.push(`timed out${result.timeoutMs === undefined ? "" : ` after ${formatDuration(result.timeoutMs)}`} and was killed`);
  if (result.signal !== null) parts.push(`terminated by signal ${code(clip(result.signal, 40))}`);
  if (result.error !== null) parts.push(`error: ${inlineText(clip(result.error, MAX_ERROR_CHARS))}`);
  return parts.join("; ");
}

function formatStream(name: "stdout" | "stderr", stream: PreparedStream, tailBytes: number): string[] {
  switch (stream.kind) {
    case "absent":
      return [`- **${name}:** not captured.`];
    case "empty":
      return [`- **${name}:** empty${stream.recordedBytes > 0 ? ` (${stream.recordedBytes} bytes of whitespace or control characters)` : ""}.`];
    case "binary":
      return [`- **${name}:** binary output (${stream.recordedBytes} bytes) withheld.`];
    case "text": {
      const kept = tail(stream.text, tailBytes);
      const label = kept.truncated
        ? `last ${kept.keptBytes} bytes of ${Buffer.byteLength(stream.text, "utf8")} after sanitising (${stream.recordedBytes} recorded); earlier lines omitted`
        : `${stream.recordedBytes} bytes recorded`;
      return [`- **${name}** (${label}):`, "", ...fenced(kept.text), ""];
    }
  }
}

/** A fenced block whose content cannot close it: the fence outruns every backtick run inside. */
function fenced(text: string): string[] {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}text`, text, fence];
}

function formatDuration(ms: number): string {
  return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

/** The workspace-relative record path when it has Arcadia's shape; never the host's home path. */
function displayRef(ref: string): string {
  const match = EVIDENCE_PATH.exec(ref);
  return clip(match ? match[1] : ref, 300);
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}… (truncated)`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
