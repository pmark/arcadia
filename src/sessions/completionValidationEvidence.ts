/** Host-authored completion execution evidence. No commands run on this read path. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactSecrets, sanitizeOutput } from "./validationEvidence.js";

export const MAX_COMPLETION_EVIDENCE_BYTES = 1024 * 1024;
export interface CompletionEvidenceBinding {
  sessionId: string; packetSha256: string; actionId: string; base: string;
  repository: string; worktree: string;
}
export interface CompletionEvidenceReference { ref: string; sha256: string }
export interface CompletionExecution {
  command: string; argv: string[]; exitStatus: number | null; signal: string | null;
  timedOut: boolean; terminalProven: boolean; durationMs: number; error: string | null;
  stdout: string; stderr: string;
}
export interface CompletionEvidenceRecord {
  version: 1; producer: "arcadia-completion-validation-v1";
  binding: CompletionEvidenceBinding; tree: string; commands: string[]; namedTests: string[];
  executions: CompletionExecution[];
  reports: Array<{ file: string; tests: Array<{ name: string; status: string }> }>;
  outcome: "passed" | "refused"; reason: string | null; durationMs: number;
}
export type CompletionEvidenceView =
  | { status: "unavailable"; reason: string }
  | { status: "verified"; reference: string; sha256: string; record: CompletionEvidenceRecord };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** Bound after sanitizing/redacting, including candidate-chosen names and output. */
export const completionEvidenceText = (text: string, max = 2048): string => redactSecrets(sanitizeOutput(text)).replaceAll("`", "'").replaceAll("@", "@\u200b").slice(-max);
const safeId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
function safeBelow(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("evidence path escapes its Session artifacts");
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("evidence path passes through a symlink");
  }
}
export function writeCompletionEvidence(workspace: string, record: CompletionEvidenceRecord): CompletionEvidenceReference {
  if (!safeId(record.binding.sessionId)) throw new Error("invalid Session evidence identity");
  const root = realpathSync(workspace);
  const parent = path.join(root, "artifacts", "preservation", record.binding.sessionId);
  safeBelow(root, parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(path.join(parent, "completion-"));
  const ref = path.join(dir, "validation.json");
  // Retention itself is sanitized: read-time redaction alone leaves secrets on disk.
  const retained: CompletionEvidenceRecord = { ...record,
    commands: record.commands.map(value => completionEvidenceText(value, 500)),
    namedTests: record.namedTests.map(value => completionEvidenceText(value, 500)),
    executions: record.executions.map(execution => ({ ...execution,
      command: completionEvidenceText(execution.command, 500), argv: execution.argv.map(value => completionEvidenceText(value, 500)),
      signal: execution.signal === null ? null : completionEvidenceText(execution.signal, 50),
      error: execution.error === null ? null : completionEvidenceText(execution.error, 500),
      stdout: completionEvidenceText(execution.stdout), stderr: completionEvidenceText(execution.stderr) })),
    reports: record.reports.map(report => ({ file: completionEvidenceText(report.file, 500), tests: report.tests.map(test => ({ name: completionEvidenceText(test.name, 300), status: completionEvidenceText(test.status, 30) })) })),
    reason: record.reason === null ? null : completionEvidenceText(record.reason, 1500) };
  const text = JSON.stringify(retained);
  if (Buffer.byteLength(text) > MAX_COMPLETION_EVIDENCE_BYTES) throw new Error("completion evidence exceeds its retention bound");
  const fd = openSync(ref, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  return { ref, sha256: hash(text) };
}
/** The caller supplies only exact trees established from Git and canonical settlement receipts. */
export function readCompletionEvidence(workspace: string, reference: CompletionEvidenceReference | undefined,
  binding: CompletionEvidenceBinding, trees: readonly string[]): CompletionEvidenceView {
  const unavailable = (reason: string): CompletionEvidenceView => ({ status: "unavailable", reason });
  if (!reference) return unavailable("no retained completion execution evidence (legacy or not required)");
  let fd: number | undefined;
  try {
    const root = realpathSync(workspace);
    if (!safeId(binding.sessionId) || typeof reference.ref !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256)) throw new Error("malformed evidence reference");
    const parent = path.join(root, "artifacts", "preservation", binding.sessionId);
    const relative = path.relative(parent, reference.ref);
    if (!/^completion-[A-Za-z0-9]+\/validation\.json$/.test(relative)) throw new Error("foreign Session evidence path");
    safeBelow(root, reference.ref);
    fd = openSync(reference.ref, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_COMPLETION_EVIDENCE_BYTES) throw new Error("evidence is not a bounded regular file");
    const text = readFileSync(fd, "utf8");
    if (Buffer.byteLength(text) > MAX_COMPLETION_EVIDENCE_BYTES || hash(text) !== reference.sha256) throw new Error("evidence content hash mismatch");
    const record = JSON.parse(text) as CompletionEvidenceRecord;
    if (record.version !== 1 || record.producer !== "arcadia-completion-validation-v1"
      || !record.binding || (Object.keys(binding) as Array<keyof CompletionEvidenceBinding>).some(key => record.binding[key] !== binding[key]) || !trees.includes(record.tree)
      || !Array.isArray(record.commands) || !Array.isArray(record.namedTests) || !Array.isArray(record.executions) || !Array.isArray(record.reports)
      || !["passed", "refused"].includes(record.outcome) || !Number.isFinite(record.durationMs) || record.durationMs < 0) throw new Error("evidence schema, Session binding or exact tree mismatch");
    // Rebuild rather than forwarding arbitrary host-file fields. Every string is untrusted.
    const clean = (text: unknown, max?: number) => { if (typeof text !== "string") throw new Error("malformed evidence text"); return completionEvidenceText(text, max); };
    const duration = (value: number) => { if (!Number.isFinite(value) || value < 0) throw new Error("malformed duration"); return value; };
    const sanitized: CompletionEvidenceRecord = { version: 1, producer: record.producer, binding: { ...binding, repository: "[repository]", worktree: "[candidate]" }, tree: record.tree,
      commands: record.commands.map(s => clean(s, 500)), namedTests: record.namedTests.map(s => clean(s, 500)),
      executions: record.executions.map(e => {
        if (!(e.exitStatus === null || Number.isInteger(e.exitStatus)) || typeof e.timedOut !== "boolean" || typeof e.terminalProven !== "boolean" || !Array.isArray(e.argv)) throw new Error("malformed execution");
        return { command: clean(e.command, 500), argv: e.argv.map(s => clean(s, 500)), exitStatus: e.exitStatus, signal: e.signal === null ? null : clean(e.signal, 50), timedOut: e.timedOut, terminalProven: e.terminalProven,
          durationMs: duration(e.durationMs), error: e.error === null ? null : clean(e.error, 500), stdout: clean(e.stdout), stderr: clean(e.stderr) };
      }),
      reports: record.reports.map(r => ({ file: clean(r.file, 500), tests: r.tests.map(t => ({ name: clean(t.name, 300), status: clean(t.status, 30) })) })),
      outcome: record.outcome, reason: record.reason === null ? null : clean(record.reason, 1500), durationMs: record.durationMs };
    return { status: "verified", reference: `artifacts/preservation/${binding.sessionId}/${relative}`, sha256: reference.sha256, record: sanitized };
  } catch { return unavailable("retained completion execution evidence is unreadable, altered, malformed or not bound to this exact Session/tree"); }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function renderCompletionEvidence(view: CompletionEvidenceView): string {
  const bounded = view.status === "verified" ? { ...view, record: { ...view.record,
    executions: view.record.executions.map(e => ({ ...e, stdout: e.stdout.slice(-256), stderr: e.stderr.slice(-256) })),
    reports: view.record.reports.map(r => ({ ...r, totalTests: r.tests.length, tests: r.tests.slice(0, 20), truncated: r.tests.length > 20 })) } } : view;
  const text = JSON.stringify(bounded, null, 2);
  const displayed = text.length <= 20000 ? text : JSON.stringify(view.status === "verified" ? { status: view.status, reference: view.reference, sha256: view.sha256, tree: view.record.tree, outcome: view.record.outcome, detail: "Detailed evidence exceeds publication bound; retained host record remains available." } : view);
  return "### Completion execution evidence\n\n```json\n" + displayed.replaceAll("`", "'") + "\n```";
}

export interface CompletionSupplementPin { workspace: string; artifactId: string; sha256: string }
export interface CompletionSupplementBinding extends CompletionEvidenceBinding {
  inputRevision: string; head: string; tree: string; preservationSha256: string; commandsSha256: string;
}
export interface CompletionSupplementEnvelope {
  schema: "arcadia-completion-validation-supplement-v1";
  requestId: string;
  binding: CompletionSupplementBinding;
  operator: import("../operatorActions/operatorExecution.js").CompletionSupplementOperator;
  validation: CompletionEvidenceReference;
  before: string;
  after: string;
}
/** Stable operation directory: a pre-existing intent is never another execution allowance. */
export function completionSupplementDirectory(workspace: string, sessionId: string, requestId: string): string {
  if (!safeId(sessionId) || !safeId(requestId)) throw new Error("Invalid supplement operation identity.");
  const root = realpathSync(workspace);
  const directory = path.join(root, "artifacts/preservation", sessionId, `supplement-${requestId}`);
  safeBelow(root, directory);
  return directory;
}
export function writeSupplementFile(workspace: string, file: string, value: unknown): CompletionEvidenceReference {
  safeBelow(realpathSync(workspace), file);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 65536) throw new Error("Supplement receipt exceeds its bound.");
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(path.dirname(file), constants.O_RDONLY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return { ref: file, sha256: hash(text) };
}
/** A pass label is insufficient without successful terminal executions and every named report. */
export function completionExecutionPassed(view: CompletionEvidenceView, commands: readonly string[], namedTests: readonly string[]): boolean {
  if (view.status !== "verified") return false;
  const r = view.record;
  return r.outcome === "passed" && r.reason === null && r.executions.length >= commands.length + 1 &&
    JSON.stringify(r.commands) === JSON.stringify(commands) && JSON.stringify(r.namedTests) === JSON.stringify(namedTests) && namedTests.length > 0 &&
    r.executions.every(e => e.exitStatus === 0 && e.signal === null && !e.timedOut && e.terminalProven && e.error === null) &&
    namedTests.every(file => r.reports.some(report => report.file === file && report.tests.some(test => test.status === "passed") &&
      report.tests.every(test => ["passed", "skipped", "pending", "todo", "disabled"].includes(test.status))));
}
