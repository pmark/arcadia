import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeAgentAsk, type NormalizedAgentAsk } from "../ask/agentAsk.js";
import { discoverDocs } from "../docs/discover.js";
import { parseDoc } from "../docs/parse.js";
import { slugify } from "../utils/slug.js";
import { CLAUDE_CLI_SELF_REFRESH_ARGS, CLAUDE_CLI_SELF_REFRESH_TIMEOUT_MS, type ClaudeCliRunner } from "./capacityPreAdmission.js";
import {
  CLAUDE_DIAGNOSTIC_ENDPOINT, CLAUDE_DIAGNOSTIC_REQUEST, diagnosticGrantAnswer, diagnosticGrantPath, diagnosticResponsePath, publishDiagnosticAttempt,
  type ClaudeDiagnosticGrant, type DiagnosticWorkerBinding
} from "./workerClaudeUsageDiagnostic.js";

/**
 * Decision 0161 (option A): after a per-run START card has installed and restarted the worker from the pinned compiled
 * release, it runs the Decision 0143 sequence exactly once, with 0143's bounds unchanged, unless a fresh retained
 * receipt from that same bound worker already exists:
 *
 *   1. claim this press's own sequence record in the ledger (exclusive, durable, before the renewal), while no other
 *      sequence is in flight;
 *   2. one reviewed Haiku one-turn call (the worker's own `runClaudeCliHeadless` with its exact arguments, environment
 *      allowlist, private empty cwd, closed stdin and 60-second bound); its redacted result is retained before branching;
 *   3. only on success, one usage check by the bound worker: a fresh nonce, the exact canonical diagnostic Decision
 *      created, settled, answered and published to main through the existing supported Agent Ask route (Decision 0141's
 *      "mechanical creation/settlement/approval/publication"), a grant of at most 5 minutes with at least 60 seconds
 *      remaining at every step, a 30-second worker deadline, and only the worker's own receipt read back.
 *
 * Decision 0162 removed the calendar-day ceiling for this whole class: nothing refuses because of the calendar day or
 * an earlier finished, failed or refused sequence. Agents must not add a calendar-day or cool-down limit on renewal and
 * check sequences without a new Decision. The ledger stays the durable, exclusive per-sequence claim: a second sequence
 * that overlaps an in-flight one is refused, and each press consumes its own record.
 *
 * Every failure after the claim consumes this press's sequence: there is no retry, no second nonce and no reset. START needs the
 * returned receipt to pass `signInReceiptRefusal` (success, a credential expiring more than 5 minutes later, both
 * usage windows below 100%), which the executor checks again itself.
 */
export const DAILY_LEDGER_DIRECTORY = path.join(".arcadia", "claude-renewal-days");
export const SIGN_IN_TIME_ZONE = "America/Los_Angeles";
/** A retained receipt from the same bound worker is reused only while this young. */
export const SIGN_IN_RECEIPT_REUSE_MS = 60 * 60_000;
export const CREDENTIAL_MARGIN_MS = 5 * 60_000;
export const GRANT_WINDOW_MS = 5 * 60_000;
export const GRANT_RESERVE_MS = 60_000;
export const WORKER_CHECK_DEADLINE_MS = 30_000;
/** How long the card waits for the worker's own receipt (the worker polls every two seconds; its check is bounded at 30 s). */
export const WORKER_RECEIPT_WAIT_MS = 55_000;
const HEARTBEAT_FRESH_MS = 15_000;
/** A read-only CLI call is never allowed more than this, nor more than the grant time left above the reserve. */
export const READ_CLI_TIMEOUT_MS = 60_000;
/** The commit identity the settlement and answer commands must use (src/git/askIsolation.ts controllerIdentityDefaults). */
export const CONTROLLER_IDENTITY = { name: "Arcadia Controller", email: "controller@arcadia.local" };
const RECEIPT_SCHEMA = "arcadia-worker-claude-usage-receipt-v1";

export class StartRunSignInRefusal extends Error {
  constructor(readonly code: string, message: string, readonly sequenceClaimed: boolean) { super(message); }
}

export interface StartRunSignInContext {
  workspace: string;
  repository: string;
  project: string;
  cardId: string;
  runId: string;
  /** The card's run directory (inside the git-ignored operator library): journal, Ask file and archived request. */
  runDirectory: string;
  /** The reviewed revision the bound worker must run. */
  release: string;
  policyRevision: number;
  policyEpoch: number;
}

export interface StartRunSignInDeps {
  now(): Date;
  randomUUID(): string;
  sleep(ms: number): Promise<void>;
  runClaude: ClaudeCliRunner;
  /**
   * One supported Arcadia CLI command run in the repository with `--json`, killed only after `timeoutMs`; returns its
   * parsed envelope. Commits it makes must carry the Arcadia Controller identity, never the host's git config.
   */
  cli(args: string[], timeoutMs: number): { ok: boolean; data?: any; error?: unknown };
  /** Git in the repository; returns trimmed stdout or throws. */
  git(args: string[]): string;
  /** The repositories the production worker polls for diagnostic requests (active Projects' repo_path, read-only). */
  polledRepositories(): string[];
}

export interface RetainedReceipt { path: string; sha256: string }
export interface StartRunSignInResult {
  outcome: "reused" | "checked";
  date: string;
  sequenceClaimed: boolean;
  receipt: RetainedReceipt;
  binding: DiagnosticWorkerBinding;
  decision?: string;
  digest?: string;
  nonce?: string;
  publicationHead?: string;
  headBefore?: string;
}

export interface WorkerUsageReceipt {
  schema?: string; nonce?: string; repository?: string; workspace?: string; pid?: number; release?: string | null; handlerHash?: string | null;
  approval?: { decision?: string; digest?: string } | null; startedAt?: string; finishedAt?: string; credentialExpiresAt?: string | null;
  requestAttempted?: boolean | null; httpStatus?: number | null; outcome?: string; success?: boolean;
  windows?: Array<{ label?: string; usedPercentage?: number; resetsAt?: string }>;
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** The America/Los_Angeles date that names a sequence record (a label only: Decision 0162 removed the daily ceiling). */
export function signInDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SIGN_IN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The in-flight marker: present only while one sequence runs (Decision 0162 keeps the ledger an exclusive claim). */
export const IN_FLIGHT_MARKER = "in-flight.json";

export interface InFlightSequence { pid: number; cardId: string; runId: string; at: string; path: string }
/** The live in-flight sequence, or null. A marker whose process is gone is stale, not in flight. Read-only. */
export function inFlightSequence(workspace: string): InFlightSequence | null {
  const file = path.join(workspace, DAILY_LEDGER_DIRECTORY, IN_FLIGHT_MARKER);
  let marker: Omit<InFlightSequence, "path">;
  try { marker = JSON.parse(readFileSync(file, "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { pid: -1, cardId: "unknown", runId: "unknown", at: "unknown", path: file }; // unreadable: treat as in flight, never guess
  }
  if (!Number.isSafeInteger(marker.pid) || marker.pid < 1) return { ...marker, path: file };
  try { process.kill(marker.pid, 0); return { ...marker, path: file }; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? null : { ...marker, path: file }; }
}

/** The record names of one press's sequence: unique per card and run, never per day. */
export function sequenceRecordName(date: string, cardId: string, runId: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cardId) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new Error("card or run id is not a safe record name");
  return `${date}.${cardId}.${runId}`;
}

/**
 * The START gate on one worker usage receipt: why it does not allow START, or null when it does. The receipt must be the
 * bound worker's own (release and handler), a successful authorized live request, with the credential expiring more than
 * 5 minutes after `now` and both the 5-hour and 7-day windows below 100%.
 */
export function signInReceiptRefusal(receipt: WorkerUsageReceipt, binding: Pick<DiagnosticWorkerBinding, "release" | "handlerHash">, now: Date): string | null {
  if (receipt.schema !== RECEIPT_SCHEMA) return "not a worker usage receipt";
  if (receipt.release !== binding.release || receipt.handlerHash !== binding.handlerHash) return "the receipt is not from the bound worker (release and handler)";
  if (!receipt.approval || typeof receipt.approval.digest !== "string") return "the receipt carries no approved grant";
  if (receipt.success !== true || receipt.outcome !== "ok" || receipt.httpStatus !== 200 || receipt.requestAttempted !== true) {
    return `the worker usage check did not succeed (outcome ${String(receipt.outcome)}, HTTP ${String(receipt.httpStatus)})`;
  }
  const expiry = Date.parse(String(receipt.credentialExpiresAt));
  if (!Number.isFinite(expiry) || expiry <= now.getTime() + CREDENTIAL_MARGIN_MS) return "credential expiry: the sign-in has expired or expires within 5 minutes";
  const windows = Array.isArray(receipt.windows) ? receipt.windows : [];
  for (const label of ["5h", "7d"]) {
    const window = windows.filter((w) => w.label === label);
    if (window.length !== 1 || !Number.isFinite(window[0].usedPercentage) || (window[0].usedPercentage as number) < 0) return `usage window ${label} unknown`;
    if ((window[0].usedPercentage as number) >= 100) return `usage window ${label} at 100%`;
  }
  return null;
}

function boundedJson(file: string, protectedFile = false): any {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16384 || (protectedFile && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new Error("invalid_file");
    const bytes = Buffer.alloc(stat.size);
    if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error("incomplete_file");
    return JSON.parse(bytes.toString("utf8"));
  } finally { closeSync(fd); }
}

/** The newest fresh receipt from this bound worker (same release and handler), or null. A receipt from any other worker never counts. */
export function findFreshBoundReceipt(workspace: string, binding: DiagnosticWorkerBinding, now: Date): RetainedReceipt | null {
  const directory = path.join(workspace, "artifacts", "worker-claude-usage");
  if (!existsSync(directory)) return null;
  const found: Array<{ path: string; finished: number }> = [];
  for (const name of readdirSync(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const file = path.join(directory, name);
    let receipt: WorkerUsageReceipt;
    try { receipt = boundedJson(file, true); } catch { continue; }
    const finished = Date.parse(String(receipt.finishedAt));
    if (!Number.isFinite(finished) || finished > now.getTime() || now.getTime() - finished > SIGN_IN_RECEIPT_REUSE_MS) continue;
    if (receipt.repository !== binding.repository || receipt.workspace !== workspace) continue;
    if (signInReceiptRefusal(receipt, binding, now) !== null) continue;
    found.push({ path: file, finished });
  }
  const newest = found.sort((a, b) => b.finished - a.finished)[0];
  return newest ? { path: newest.path, sha256: sha256(readFileSync(newest.path)) } : null;
}

/** Exclusive, durable, complete publication; false when the path already exists. */
function publishExclusive(file: string, value: object): boolean {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  return publishDiagnosticAttempt(file, value);
}

function atomicJournal(file: string, value: object): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}

/** Move a terminal file aside exclusively (never overwrite); refuses across devices. */
function archiveExclusive(from: string, to: string): void {
  linkSync(from, to);
  unlinkSync(from);
}

interface SlotState { path: string; nonce: string | null; terminal: boolean }
/** The fixed grant and request slots may hold only a previous, terminal (answered) diagnostic. */
function slotState(file: string, workspace: string, protectedFile: boolean): SlotState | null {
  try { lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let nonce: string | null;
  try { const value = boundedJson(file, protectedFile); nonce = typeof value?.nonce === "string" && /^[a-f0-9-]{36}$/.test(value.nonce) ? value.nonce : null; } catch { nonce = null; }
  return { path: file, nonce, terminal: nonce !== null && existsSync(diagnosticResponsePath(workspace, nonce)) };
}

export interface StaticSignInState {
  date: string;
  grantSlot: SlotState | null;
  requestSlot: SlotState | null;
}

/**
 * The read-only checks that must hold before a sequence is claimed: no other sequence in flight, the grant and request slots
 * empty or holding only a terminal diagnostic (archived later), the request path ignored by Git (so the checkout stays
 * clean for START), and the checkout clean on main at origin main.
 */
export function staticSignInChecks(context: Pick<StartRunSignInContext, "workspace" | "repository">, deps: Pick<StartRunSignInDeps, "now" | "git" | "polledRepositories">): StaticSignInState {
  const date = signInDay(deps.now());
  // Decision 0162: never a calendar-day or earlier-sequence refusal; only an overlapping in-flight sequence refuses.
  const live = inFlightSequence(context.workspace);
  if (live) throw new StartRunSignInRefusal("SEQUENCE_IN_FLIGHT", `another renewal and check sequence is in flight (card ${live.cardId}, run ${live.runId}, pid ${live.pid}, ${live.path}); nothing was claimed`, false);
  const grantSlot = slotState(diagnosticGrantPath(context.workspace), context.workspace, true);
  if (grantSlot && !grantSlot.terminal) throw new StartRunSignInRefusal("GRANT_SLOT_BUSY", `the worker diagnostic grant slot ${grantSlot.path} holds a non-terminal or unreadable grant; preserve it`, false);
  const requestSlot = slotState(path.join(context.repository, CLAUDE_DIAGNOSTIC_REQUEST), context.workspace, false);
  if (requestSlot && !requestSlot.terminal) throw new StartRunSignInRefusal("REQUEST_SLOT_BUSY", `the worker diagnostic request ${requestSlot.path} is not a terminal request; preserve it`, false);
  try { deps.git(["check-ignore", "-q", CLAUDE_DIAGNOSTIC_REQUEST]); }
  catch { throw new StartRunSignInRefusal("REQUEST_NOT_IGNORED", `${CLAUDE_DIAGNOSTIC_REQUEST} is not ignored by Git in ${context.repository}, so a request would leave the checkout dirty before START`, false); }
  // The worker answers only requests in the repositories it polls; anything else would time out after the day is claimed.
  const polled = deps.polledRepositories().map((repo) => { try { return realpathSync(repo); } catch { return repo; } });
  if (!polled.includes(context.repository)) {
    throw new StartRunSignInRefusal("REPOSITORY_NOT_POLLED", `${context.repository} is not the repository of an active Project the worker polls, so the worker would never answer the usage check`, false);
  }
  if (deps.git(["branch", "--show-current"]) !== "main" || deps.git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
    throw new StartRunSignInRefusal("CHECKOUT_NOT_CLEAN", "the Arcadia checkout must be clean on main", false);
  }
  return { date, grantSlot, requestSlot };
}

function readBoundWorker(context: StartRunSignInContext, now: Date): DiagnosticWorkerBinding {
  let heartbeat: { at?: number; binding?: DiagnosticWorkerBinding | null };
  try { heartbeat = JSON.parse(readFileSync(path.join(context.workspace, ".arcadia", "worker-claude-usage-heartbeat.json"), "utf8")); }
  catch { throw new StartRunSignInRefusal("WORKER_UNBOUND", "the worker heartbeat is unreadable", false); }
  const binding = heartbeat.binding;
  const age = now.getTime() - Number(heartbeat.at);
  if (!binding || !(age >= 0 && age < HEARTBEAT_FRESH_MS)) throw new StartRunSignInRefusal("WORKER_UNBOUND", "the worker heartbeat is stale or carries no protected-release binding", false);
  if (binding.release !== context.release || binding.repository !== context.repository) {
    throw new StartRunSignInRefusal("WORKER_UNBOUND", `the bound worker runs release ${binding.release} from ${binding.repository}, not ${context.release} from ${context.repository}`, false);
  }
  return binding;
}

/** The id settlement will allocate: the highest frontmatter id over the discovered Decision documents, plus one (src/ask/settlement.ts addDecisionMutation). */
export function nextDecisionId(repository: string): string {
  const highest = discoverDocs(repository).docs.filter((doc) => doc.type === "decision")
    .reduce((max, doc) => Math.max(max, Number.parseInt(String((doc as { id?: unknown }).id), 10) || 0), 0);
  return String(highest + 1).padStart(4, "0");
}

/** The exact grant, in the property order the digest is taken over. */
export function buildSignInGrant(input: { nonce: string; repository: string; workspace: string; binding: DiagnosticWorkerBinding; decision: string; policyRevision: number; policyEpoch: number; expiresAt: string }): ClaudeDiagnosticGrant {
  return {
    schema: "arcadia-worker-claude-usage-grant-v1", nonce: input.nonce, repository: input.repository, workspace: input.workspace,
    release: input.binding.release, handlerHash: input.binding.handlerHash, decision: input.decision, provider: "claude", source: "auto",
    endpoint: CLAUDE_DIAGNOSTIC_ENDPOINT, policyRevision: input.policyRevision, policyEpoch: input.policyEpoch, expiresAt: input.expiresAt,
    deadlineMs: WORKER_CHECK_DEADLINE_MS
  };
}

/** The standing authorities the diagnostic Decision records itself under (Issue #1958: cited repository-relative). */
export const GOVERNING_DECISIONS = ["0141", "0143", "0161"] as const;

/** Repository-relative paths of the governing Decisions; an Ask never cites an absolute path (normalizeAgentAsk refuses it). */
export function governingDecisionReferences(repository: string): string[] {
  const files = readdirSync(path.join(repository, "docs", "decisions"));
  return GOVERNING_DECISIONS.map((id) => {
    const matches = files.filter((name) => name.startsWith(`${id}-`) && name.endsWith(".md"));
    if (matches.length !== 1) throw new Error(`Decision ${id} is not exactly one file in docs/decisions`);
    return `docs/decisions/${matches[0]}`;
  });
}

export const diagnosticQuestion = (date: string, nonce: string) => `Authorize one START card worker Claude usage diagnostic ${date} ${nonce.slice(0, 8)}`;

export interface DiagnosticAsk {
  ask: Record<string, unknown>;
  requestId: string;
  settlementRequestId: string;
  answerLetter: "A";
}

/** The exact diagnostic Agent Ask. Every value is derived; the run id lives in the rationale, never as a file path. */
export function buildDiagnosticAsk(input: {
  context: Pick<StartRunSignInContext, "project" | "cardId" | "runId" | "policyRevision" | "policyEpoch">;
  date: string; nonce: string; binding: Pick<DiagnosticWorkerBinding, "release" | "handlerHash">; answer: string; digest: string; expiresAt: string; references: string[];
}): DiagnosticAsk {
  const { context, date, nonce, binding, answer, digest, expiresAt, references } = input;
  const requestId = `start-run-signin-${date}-${nonce.slice(0, 8)}`;
  return {
    requestId, settlementRequestId: `settle-${requestId}`, answerLetter: "A",
    ask: {
      agent_ask: "v1", request_id: requestId, project: context.project, intent: "decision", requested_authority: "propose", gate_question: "resists_reversal",
      desired_result: diagnosticQuestion(date, nonce),
      rationale: `Mechanical record under Decisions 0141, 0143 and 0161 for START card ${context.cardId} run ${context.runId}: the card's one Haiku renewal of ${date} succeeded, so the bound worker (release ${binding.release}, handler ${binding.handlerHash}) may run exactly one usage check. No retry, no second nonce, no START by this record.`,
      options: [
        { label: answer, recommended: true, consequence: `Authorizes only the worker grant with SHA-256 ${digest}: nonce ${nonce}, expiring ${expiresAt}, policy revision ${context.policyRevision} epoch ${context.policyEpoch}, the fixed usage endpoint and a ${WORKER_CHECK_DEADLINE_MS} ms deadline; one check by the bound worker, no refresh, no retry.` },
        { label: "Do not authorize the check", recommended: false, consequence: "No usage check runs; the card and today's sequence stay consumed." }
      ],
      references
    }
  };
}

/**
 * Run the real Agent Ask validator (`normalizeAgentAsk`, the one `agent-ask preview` applies) on the exact Ask, and check
 * the derived settlement request id and answer letter. Throws with the validator's own message and details.
 */
export function validateDiagnosticAsk(diagnostic: DiagnosticAsk): NormalizedAgentAsk {
  const normalized = normalizeAgentAsk({ request: JSON.stringify(diagnostic.ask) });
  const fail = (message: string): never => { throw new Error(message); };
  if (normalized.format !== "strict" || normalized.intent !== "decision" || normalized.requestId !== diagnostic.requestId) fail("the Ask did not normalize as the exact strict decision Ask");
  if (normalized.options.length !== 2 || !normalized.options[0].recommended || normalized.options[0].label !== (diagnostic.ask.options as Array<{ label: string }>)[0].label) fail("the Ask's options did not normalize unchanged");
  for (const id of [diagnostic.requestId, diagnostic.settlementRequestId]) if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`${id} is not a valid request id`);
  if (!/^[A-Z]$/.test(diagnostic.answerLetter)) fail("the answer is not a single choice letter");
  return normalized;
}

/** A validator or CLI failure as `CODE: message (details)`, for refusals and the journal. */
export function errorText(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const details = e && typeof e === "object" && e.details && Object.keys(e.details).length ? ` ${JSON.stringify(e.details).slice(0, 600)}` : "";
  return `${typeof e?.code === "string" ? `${e.code}: ` : ""}${error instanceof Error ? error.message : typeof e?.message === "string" ? e.message : String(error)}${details}`;
}

/** The failure a CLI envelope reports (`{ ok: false, error: { code, message, details } }`, or the raw stderr text). */
export function cliFailureText(result: { ok: boolean; error?: unknown }): string {
  const error = result.error;
  if (error && typeof error === "object") return errorText(error);
  return typeof error === "string" && error.trim() ? error.trim().slice(0, 600) : "no error detail";
}

/**
 * Run the sequence once. Throws StartRunSignInRefusal on every refusal or failure; `sequenceClaimed` says whether today's
 * Decision 0141 sequence was consumed by this call.
 */
export async function runStartRunSignIn(context: StartRunSignInContext, deps: StartRunSignInDeps): Promise<StartRunSignInResult> {
  mkdirSync(context.runDirectory, { recursive: true });
  const journalPath = path.join(context.runDirectory, "sign-in.json");
  const journal: Record<string, unknown> = { schema: "arcadia-start-run-sign-in-v1", cardId: context.cardId, runId: context.runId, startedAt: deps.now().toISOString(), stages: [] as string[] };
  const stage = (name: string, data: Record<string, unknown> = {}) => { (journal.stages as string[]).push(name); Object.assign(journal, data, { updatedAt: deps.now().toISOString() }); atomicJournal(journalPath, journal); };
  let sequenceClaimed = false;
  let inFlightClaimed: string | null = null;
  // From the settlement apply until the push is confirmed, local main may carry unpublished Controller commits.
  let unpublishedRecords = false;
  const refuse = (code: string, message: string): never => {
    const local = unpublishedRecords ? "; main may hold unpublished local Controller diagnostic commits, and START refuses until they are reconciled" : "";
    throw new StartRunSignInRefusal(code, message + local, sequenceClaimed);
  };
  try {
    const binding = readBoundWorker(context, deps.now());
    stage("bound", { binding });
    const reused = findFreshBoundReceipt(context.workspace, binding, deps.now());
    if (reused) {
      stage("reused", { outcome: "reused", receipt: reused });
      return { outcome: "reused", date: signInDay(deps.now()), sequenceClaimed, receipt: reused, binding };
    }

    // Every static route check precedes the claim.
    const slots = staticSignInChecks(context, deps);
    const headBefore = deps.git(["rev-parse", "HEAD"]);
    if (deps.git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]).split(/\s+/)[0] !== headBefore) refuse("ORIGIN_MOVED", "origin main is not the checkout HEAD; the diagnostic Decision could not be published fast-forward");
    const decisionId = nextDecisionId(context.repository);
    // Everything the sequence submits is checked with the real validator before the day can be claimed: an Ask of exactly
    // the same shape, with placeholder nonce and digest (the real ones exist only after the renewal), and the
    // settlement and answer inputs derived from it. The real Ask is validated again before it is written.
    let references: string[] = [];
    try {
      references = governingDecisionReferences(context.repository);
      const placeholderNonce = "00000000-0000-4000-8000-000000000000";
      const placeholderGrant = buildSignInGrant({
        nonce: placeholderNonce, repository: context.repository, workspace: context.workspace, binding,
        decision: `${decisionId}-${slugify(diagnosticQuestion(slots.date, placeholderNonce))}`, policyRevision: context.policyRevision,
        policyEpoch: context.policyEpoch, expiresAt: new Date(deps.now().getTime() + GRANT_WINDOW_MS).toISOString()
      });
      const placeholderAnswer = diagnosticGrantAnswer(placeholderGrant);
      validateDiagnosticAsk(buildDiagnosticAsk({
        context, date: slots.date, nonce: placeholderNonce, binding, answer: placeholderAnswer, digest: placeholderAnswer.split(" ").at(-1)!,
        expiresAt: placeholderGrant.expiresAt, references
      }));
    } catch (error) {
      refuse("ASK_INVALID", `the diagnostic Agent Ask would be refused, so nothing was claimed or renewed: ${errorText(error)}`);
    }

    // 1. Claim this press's sequence: the in-flight marker (exclusive: an overlapping sequence refuses) and then this run's
    //    own record (exclusive per card and run, never per day; Decision 0162), both durable, before the renewal.
    const ledger = path.join(context.workspace, DAILY_LEDGER_DIRECTORY);
    let recordName = "";
    try { recordName = sequenceRecordName(slots.date, context.cardId, context.runId); } catch (error) { refuse("SEQUENCE_RECORD", errorText(error)); }
    const inFlightPath = path.join(ledger, IN_FLIGHT_MARKER);
    const stale = existsSync(inFlightPath) && !inFlightSequence(context.workspace);
    if (stale) archiveExclusive(inFlightPath, path.join(ledger, `in-flight.stale-before-${recordName}.json`)); // preserved, never deleted
    if (!publishExclusive(inFlightPath, { pid: process.pid, cardId: context.cardId, runId: context.runId, at: deps.now().toISOString() })) {
      refuse("SEQUENCE_IN_FLIGHT", "another renewal and check sequence started concurrently; nothing was claimed or renewed");
    }
    inFlightClaimed = inFlightPath;
    const claimPath = path.join(ledger, `${recordName}.json`);
    const claim = { schema: "arcadia-renewal-sequence-claim-v2", date: slots.date, timeZone: SIGN_IN_TIME_ZONE, decisions: ["0141", "0143", "0161", "0162"], at: deps.now().toISOString(), cardId: context.cardId, runId: context.runId, binding, status: "consumed-before-renewal" };
    if (!publishExclusive(claimPath, claim)) refuse("SEQUENCE_CONSUMED", `this press's sequence record ${claimPath} already exists; one press runs at most one sequence, with no retry`);
    sequenceClaimed = true;
    stage("sequence-claimed", { date: slots.date, claim: claimPath });

    // 2. One reviewed Haiku call; its redacted result is durable before any branch.
    const callStartedAt = deps.now();
    let renewal: { ok: boolean; detail: string };
    try { renewal = await deps.runClaude(CLAUDE_CLI_SELF_REFRESH_ARGS, CLAUDE_CLI_SELF_REFRESH_TIMEOUT_MS); }
    catch (error) { renewal = { ok: false, detail: `runner exception: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) }; }
    const callFinishedAt = deps.now();
    const renewalRecord = {
      schema: "arcadia-daily-0141-renewal-v1", date: slots.date, cardId: context.cardId, runId: context.runId, binding, ok: renewal.ok === true,
      detail: String(renewal.detail ?? "").slice(0, 300), callStartedAt: callStartedAt.toISOString(), callFinishedAt: callFinishedAt.toISOString(),
      durationMs: callFinishedAt.getTime() - callStartedAt.getTime(), noRetry: true,
      limitation: "Exit 0 alone does not prove sign-in; direct-child timer only; shared interactive-login interference remains possible"
    };
    if (!publishExclusive(path.join(ledger, `${recordName}.renewal.json`), renewalRecord)) refuse("RENEWAL_UNRECORDED", "the renewal result could not be retained exclusively; this press's sequence is consumed");
    stage("renewed", { renewal: renewalRecord });
    if (!renewalRecord.ok) refuse("RENEWAL_FAILED", `the Haiku sign-in renewal failed (${renewalRecord.detail || "no detail"}); this press's sequence is consumed, no usage check runs and there is no retry`);

    // 3. One fresh nonce and its at-most-5-minute grant.
    const nonce = deps.randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(nonce)) refuse("NONCE_INVALID", "the fresh nonce is malformed");
    const preparedAt = deps.now();
    const expiresAt = new Date(preparedAt.getTime() + GRANT_WINDOW_MS).toISOString();
    const reserve = (what: string) => {
      const left = Date.parse(expiresAt) - deps.now().getTime();
      if (!(left >= GRANT_RESERVE_MS && left <= GRANT_WINDOW_MS)) refuse("GRANT_WINDOW", `less than 60 seconds of the 5-minute grant remain ${what}; no new nonce or retry`);
    };
    const slug = slugify(diagnosticQuestion(slots.date, nonce));
    const decision = `${decisionId}-${slug}`;
    const decisionRelative = `docs/decisions/${decision}.md`;
    if (existsSync(path.join(context.repository, decisionRelative))) refuse("DECISION_EXISTS", `${decisionRelative} already exists`);
    const grant = buildSignInGrant({ nonce, repository: context.repository, workspace: context.workspace, binding, decision, policyRevision: context.policyRevision, policyEpoch: context.policyEpoch, expiresAt });
    const answer = diagnosticGrantAnswer(grant);
    const digest = answer.split(" ").at(-1)!;
    stage("prepared", { nonce, preparedAt: preparedAt.toISOString(), expiresAt, decision, digest, grant });

    // 4. The exact canonical diagnostic Decision through the existing Agent Ask route, then a Decision-only publication.
    const diagnostic = buildDiagnosticAsk({ context, date: slots.date, nonce, binding, answer, digest, expiresAt, references });
    const requestId = diagnostic.requestId;
    try { validateDiagnosticAsk(diagnostic); }
    catch (error) { refuse("ASK_INVALID", `the diagnostic Agent Ask is invalid: ${errorText(error)}`); }
    const askPath = path.join(context.runDirectory, `${requestId}.json`);
    writeFileSync(askPath, JSON.stringify(diagnostic.ask, null, 2) + "\n");
    // Read-only calls are bounded by the grant time left above the reserve. The two committing calls (apply and answer) are
    // given the whole grant window: they are started only with at least the reserve left and are never killed mid-commit;
    // one that finishes late is refused by the next reserve() check instead.
    const readTimeout = () => Math.max(1_000, Math.min(READ_CLI_TIMEOUT_MS, Date.parse(expiresAt) - deps.now().getTime() - GRANT_RESERVE_MS));
    // The committing calls may use the rest of the grant, never beyond it (a commit after expiry could not be used anyway).
    const commitTimeout = () => Math.max(1_000, Date.parse(expiresAt) - deps.now().getTime());
    reserve("before the Agent Ask preview");
    if (deps.git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]).split(/\s+/)[0] !== headBefore || deps.git(["rev-parse", "HEAD"]) !== headBefore) {
      refuse("ORIGIN_MOVED", "origin main or the checkout moved before the diagnostic Agent Ask; nothing was recorded");
    }
    const preview = deps.cli(["agent-ask", "preview", "--file", askPath, "--dir", context.repository, "--workspace", context.workspace], readTimeout());
    if (!preview.ok) refuse("RECORDS_FAILED", `the diagnostic Agent Ask preview failed: ${cliFailureText(preview)}`);
    const settleBase = ["agent-ask", "settle", "--proposal", requestId, "--request-id", diagnostic.settlementRequestId, "--disposition", "accepted", "--workspace", context.workspace];
    const settlement = deps.cli(settleBase, readTimeout());
    const receipt = settlement.data?.receipt;
    const created = (receipt?.review?.documents ?? []) as Array<{ path: string; before: string | null; after: string | null }>;
    if (!settlement.ok || !receipt?.previewFingerprint || created.length !== 1 || created[0].before !== null || path.resolve(context.repository, created[0].path) !== path.join(context.repository, decisionRelative)
      || !String(created[0].after).includes(answer)) {
      refuse("RECORDS_FAILED", `the settlement preview does not create exactly ${decisionRelative} with the exact grant answer${settlement.ok ? "" : `: ${cliFailureText(settlement)}`}`);
    }
    reserve("before the settlement");
    unpublishedRecords = true;
    const applied = deps.cli([...settleBase, "--preview", receipt.previewFingerprint, "--apply"], commitTimeout());
    if (!applied.ok || applied.data?.receipt?.applied !== true || !/^[a-f0-9]{40}$/.test(String(applied.data?.receipt?.documentsCommit))) refuse("RECORDS_FAILED", `the diagnostic Decision settlement did not apply and commit${applied.ok ? "" : `: ${cliFailureText(applied)}`}`);
    reserve("after the settlement");
    const review = deps.cli(["review", "--workspace", context.workspace], readTimeout());
    const items = ((review.data?.items ?? []) as Array<{ id: string; docRef?: string | null; status?: string; answerMenu?: { answerable?: boolean; options?: Array<{ letter?: string; label?: string }> } | null }>)
      .filter((item) => item.docRef === `decision/${slug}`);
    const item = items[0];
    if (items.length !== 1 || item.answerMenu?.answerable !== true || item.answerMenu.options?.[0]?.letter !== "A" || item.answerMenu.options[0].label !== answer) {
      refuse("RECORDS_FAILED", `the unique open diagnostic Decision with the exact grant answer as option A was not found${review.ok ? "" : `: ${cliFailureText(review)}`}`);
    }
    reserve("before recording the answer");
    const answered = deps.cli(["review", "answer", item.id, diagnostic.answerLetter, "--workspace", context.workspace], commitTimeout());
    if (!answered.ok) refuse("RECORDS_FAILED", `the diagnostic Decision answer was not recorded: ${cliFailureText(answered)}`);
    const recordHead = deps.git(["rev-parse", "HEAD"]);
    const changed = deps.git(["diff", "--name-only", headBefore, recordHead]).split("\n").filter(Boolean);
    if (deps.git(["rev-list", "--count", `${headBefore}..${recordHead}`]) !== "2" || changed.length !== 1 || changed[0] !== decisionRelative
      || deps.git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "" || deps.git(["branch", "--show-current"]) !== "main") {
      refuse("RECORDS_FAILED", `the canonical records must be exactly two commits changing only ${decisionRelative} on a clean main`);
    }
    // Both commits must be the Arcadia Controller's (author and committer), never the operator's host identity.
    const identities = deps.git(["log", "--format=%an%x09%ae%x09%cn%x09%ce", `${headBefore}..${recordHead}`]).split("\n").filter(Boolean);
    const controller = `${CONTROLLER_IDENTITY.name}\t${CONTROLLER_IDENTITY.email}`;
    if (identities.length !== 2 || !identities.every((line) => line === `${controller}\t${controller}`)) {
      refuse("RECORDS_IDENTITY", `the diagnostic Decision commits are not authored and committed by ${CONTROLLER_IDENTITY.name}; nothing was pushed`);
    }
    const decisionFile = path.join(context.repository, decisionRelative);
    const parsed = parseDoc(path.basename(decisionFile), decisionFile, readFileSync(decisionFile, "utf8"));
    if (parsed.errors.length || parsed.doc?.type !== "decision" || parsed.doc.status !== "approved" || parsed.doc.answer !== answer) refuse("RECORDS_FAILED", "the diagnostic Decision is not approved with the exact grant answer");
    reserve("before publication");
    if (deps.git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]).split(/\s+/)[0] !== headBefore) refuse("RECORDS_FAILED", "origin main moved before the Decision-only publication");
    deps.git(["push", "origin", "HEAD:refs/heads/main"]);
    if (deps.git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]).split(/\s+/)[0] !== recordHead) refuse("RECORDS_FAILED", "the Decision-only publication could not be confirmed on origin main");
    unpublishedRecords = false;
    stage("records-published", { publicationHead: recordHead, headBefore });

    // 5. Archive only the terminal previous grant and request, then publish the grant and the nonce-only request.
    reserve("before the grant");
    const grantPath = diagnosticGrantPath(context.workspace);
    const requestPath = path.join(context.repository, CLAUDE_DIAGNOSTIC_REQUEST);
    for (const target of [diagnosticResponsePath(context.workspace, nonce), `${diagnosticResponsePath(context.workspace, nonce)}.attempt`]) {
      if (existsSync(target)) refuse("NONCE_USED", `${target} already exists`);
    }
    const archived: Array<{ from: string; to: string; sha256: string }> = [];
    const grantSlot = slotState(grantPath, context.workspace, true);
    if (grantSlot) {
      if (!grantSlot.terminal || grantSlot.nonce !== slots.grantSlot?.nonce) refuse("GRANT_SLOT_BUSY", "the grant slot changed after the static checks");
      const to = `${grantPath}.completed-${grantSlot.nonce}`;
      const bytes = sha256(readFileSync(grantPath));
      archiveExclusive(grantPath, to);
      archived.push({ from: grantPath, to, sha256: bytes });
    }
    const requestSlot = slotState(requestPath, context.workspace, false);
    if (requestSlot) {
      if (!requestSlot.terminal || requestSlot.nonce !== slots.requestSlot?.nonce) refuse("REQUEST_SLOT_BUSY", "the request slot changed after the static checks");
      const to = path.join(context.runDirectory, `archived-worker-claude-usage-request-${requestSlot.nonce}.json`);
      const bytes = sha256(readFileSync(requestPath));
      archiveExclusive(requestPath, to);
      archived.push({ from: requestPath, to, sha256: bytes });
    }
    if (!publishDiagnosticAttempt(grantPath, grant)) refuse("GRANT_SLOT_BUSY", "the grant could not be published exclusively; no retry");
    reserve("before the request");
    if (realpathSync(path.dirname(requestPath)) !== path.dirname(requestPath)) refuse("REQUEST_SLOT_BUSY", "the request directory is not canonical");
    if (!publishDiagnosticAttempt(requestPath, { nonce })) refuse("REQUEST_SLOT_BUSY", "the request could not be published exclusively; no retry");
    stage("requested", { archived, grantPath, requestPath });

    // 6. Only the bound worker's own receipt for this nonce counts.
    const responsePath = diagnosticResponsePath(context.workspace, nonce);
    const waitUntil = Math.min(deps.now().getTime() + WORKER_RECEIPT_WAIT_MS, Date.parse(expiresAt));
    let workerReceipt: WorkerUsageReceipt | null = null;
    while (deps.now().getTime() < waitUntil) {
      if (existsSync(responsePath)) { try { workerReceipt = boundedJson(responsePath, true); break; } catch { /* still being written */ } }
      await deps.sleep(1000);
    }
    if (!workerReceipt && existsSync(responsePath)) { try { workerReceipt = boundedJson(responsePath, true); } catch { workerReceipt = null; } }
    if (!workerReceipt) refuse("CHECK_TIMEOUT", "the bound worker returned no usage receipt for this nonce in time; this press's sequence is consumed, no retry");
    const retained = { path: responsePath, sha256: sha256(readFileSync(responsePath)) };
    stage("received", { receipt: retained });
    const got = workerReceipt!;
    if (got.nonce !== nonce || got.pid !== binding.pid || got.repository !== context.repository || got.workspace !== context.workspace) refuse("CHECK_FAILED", "the usage receipt is not the bound worker's receipt for this nonce");
    if (got.approval?.digest !== digest || got.approval?.decision !== decision) refuse("CHECK_FAILED", "the usage receipt does not carry this card's approved grant");
    const refusal = signInReceiptRefusal(got, binding, deps.now());
    if (refusal) refuse("CHECK_FAILED", `the worker usage check does not allow START: ${refusal}`);
    stage("checked", { outcome: "checked" });
    return { outcome: "checked", date: slots.date, sequenceClaimed, receipt: retained, binding, decision, digest, nonce, publicationHead: recordHead, headBefore };
  } catch (error) {
    const refusal = error instanceof StartRunSignInRefusal ? error : new StartRunSignInRefusal("SEQUENCE_FAILED", error instanceof Error ? error.message : String(error), sequenceClaimed);
    try { stage("refused", { refusal: { code: refusal.code, message: refusal.message, sequenceClaimed: refusal.sequenceClaimed } }); } catch { /* the journal is evidence, never a gate */ }
    throw refusal;
  } finally {
    // The sequence is over (succeeded, refused or failed): it is no longer in flight. Its own record stays consumed.
    if (inFlightClaimed) { try { unlinkSync(inFlightClaimed); } catch { /* a marker whose process is gone counts as stale */ } }
  }
}
