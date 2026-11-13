import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import { claudeReasoningEffort } from "../codingAgents/reasoningEffort.js";
import type { ProviderSignInStatus } from "../codingAgents/signIn.js";
import { billingUnsetArgs, spendRefusalMessage } from "../spend/spendGuard.js";
import { systemTmux, type TmuxAdapter } from "../sessions/index.js";
import type { CapsuleSources } from "./capsule.js";
import { buildLaunchProof, claudeFolderTrust, defaultClaudeStatePath, observeTranscript, type FolderTrust, type LaunchProof } from "./launchProof.js";
import { coordinatorPaths } from "./paths.js";
import {
  COORDINATOR_ENV,
  CLAIM_LAUNCHING_FRESH_MS,
  claimNextGeneration,
  currentCustodian,
  failGeneration,
  listGenerations,
  newestLaunching,
  recordTranscriptPath
} from "./generations.js";

/**
 * Change 3 of docs/agent-guidance/coordinator-handoff-design.md: the relay
 * launch (`arcadia coordinator renew`). It launches one successor coordinator
 * through Arcadia's tmux launcher, verifies its first prompt was delivered,
 * and records custody as a `launching` generation that the successor itself
 * must `accept`. Nothing here runs unless the standing Decision recording the
 * operator's answer A is on main.
 */

/**
 * The governed Decision recording answer A to #2223, named by its full file
 * stem under `docs/decisions/`. Two Decisions share the number 0191, so the
 * number alone is ambiguous: the gate reads exactly `<stem>.md` on main and
 * requires its front matter `id` and `slug` to match the stem. Null keeps
 * `renew` refusing (`decision_pending`) before any claim, worktree or launch.
 */
export const RELAY_LAUNCH_DECISION_ID: string | null =
  "0191-may-arcadia-s-deterministic-relay-launch-successor-coordinator-sessions-signal";

/** A Decision file stem: its four-digit number, a hyphen, then its slug. */
const DECISION_STEM = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The coordinator roles Decision 0191 names. */
export const RELAY_ROLES: ReadonlySet<string> = new Set(["rowan", "signal"]);

/** Limits pinned by answer A of the design's Decision. */
export const RELAY_LIMITS = {
  attemptsPerRenewal: 2,
  renewalsPerDay: 6,
  expiryDays: 30,
  deliveryWindowMs: 2 * 60 * 1000,
  /** After delivery, how long the relay waits for the Session's first reply so the model it actually runs is observed. */
  observationWindowMs: 60 * 1000,
  retryPauseMs: 60 * 1000
} as const;

/**
 * Today's desktop coordinators run in the host's ordinary interactive `auto`
 * mode (observed in probe P1 and in the session list). Bypass modes are never
 * passed; an unanswered permission prompt stalls the session and is detected as
 * no acceptance, never auto-approved.
 */
export const RELAY_PERMISSION_MODE = "auto";
/** An allowlist, so no bypass or future permissive mode can be passed by accident. */
const ALLOWED_PERMISSION_MODES = new Set(["auto", "default"]);

export type RelayRefusal =
  | "decision_pending" | "decision_not_in_force" | "role_not_allowed" | "no_custodian" | "provider_unsupported"
  | "renewal_limit" | "sign_in" | "spend" | "capacity" | "launch_in_progress" | "repository_unresolved" | "start_in_progress" | "folder_untrusted";

export interface DecisionGate { inForce: boolean; reason: string }

export interface RelayDeps {
  tmux: Pick<TmuxAdapter, "hasSession" | "launch" | "killSession">;
  decision(repoRoot: string, now: Date): DecisionGate;
  signIn(provider: string): ProviderSignInStatus | null;
  capacity(provider: string): { admitted: boolean; reason: string };
  createWorktree(repoRoot: string, directory: string): void;
  /** The first main-chain user message's text in a Claude transcript, or null when none yet. */
  firstUserMessage(transcriptPath: string): string | null;
  claudeProjectsDirectory: string;
  sleep(ms: number): void;
  now(): Date;
  newSessionId(): string;
  ping(message: string): void;
  sources(): CapsuleSources;
  /** Whether Claude Code already trusts a folder: an unattended launch into an untrusted one stops at the trust prompt (probe P1). Required: the precondition cannot be omitted. */
  folderTrust(directory: string): FolderTrust;
  /** Whether a START press is still running (or its record unreadable); a successor launch is refused while so. Required: the interlock cannot be omitted. */
  startPressInProgress(repoRoot: string): StartPressStatus;
}

export interface RenewInput {
  project: string;
  role: string;
  /** The repository the successor's worktree is cut from; null when the caller could not resolve one (a refusal that pings). */
  repoRoot: string | null;
  /** Abstract effort key (e3_deep) or a native value; pinned by the Decision. */
  effort: string;
  permissionMode?: string;
}

export type RenewResult =
  | { outcome: "launched"; generation: number; tmuxName: string; sessionId: string; snapshotSha: string; worktree: string; attempts: number; proof: LaunchProof; proofPath: string | null; warnings?: string[] }
  | { outcome: "refused"; reason: RelayRefusal; detail: string }
  | { outcome: "failed"; attempts: number; failures: string[]; pinged: boolean; warnings?: string[] };

/** The fixed resume prompt (design step 3). It holds no approval, quote or free-form state. */
export function renderResumePrompt(input: { project: string; role: string; generation: number; snapshotSha: string; snapshotPath: string }): string {
  const scope = `--project ${input.project} --role ${input.role}`;
  return [
    `You are ${input.role} generation ${input.generation} for ${input.project}.`,
    `Run \`arcadia coordinator subscribe ${scope} --from-snapshot ${input.snapshotSha}\` to list the inherited watchers (it starts none),`,
    `start each listed watcher yourself in the background and register it with \`arcadia coordinator subscribe ${scope} "<command>" --cursor <c>\`,`,
    `then \`arcadia coordinator verify ${scope} --generation ${input.generation} --snapshot-sha ${input.snapshotSha}\`,`,
    `then \`arcadia coordinator accept ${scope} --generation ${input.generation} --snapshot-sha ${input.snapshotSha}\`.`,
    "accept is refused (predecessor_not_stood_down) until the predecessor records its own stand-down; wait and retry, and never record it for the predecessor.",
    `Snapshot: ${input.snapshotPath} (sha ${input.snapshotSha}).`,
    "Report verify's warnings in your first message and name the source of every approval you rely on."
  ].join(" ");
}

/** Claude Code's project directory name for a working directory, as observed in probe P1. */
export function claudeProjectSlug(directory: string): string {
  return directory.replace(/[^A-Za-z0-9-]/g, "-");
}

function refuse(reason: RelayRefusal, detail: string): RenewResult {
  return { outcome: "refused", reason, detail };
}

/**
 * Reads exactly `docs/decisions/<stem>.md` from `origin/main` (never the
 * working tree, which a session can edit). No prefix match: a stem that is not
 * a full `<number>-<slug>` returns null.
 */
export function readDecisionFromMain(repoRoot: string, id: string): string | null {
  if (!DECISION_STEM.test(id)) return null;
  try {
    return execFileSync("git", ["-C", repoRoot, "show", `origin/main:docs/decisions/${id}.md`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 });
  } catch {
    return null;
  }
}

/** The Decision `<id>` on main: status approved, answer A, decided within the expiry. */
export function readRelayDecision(
  repoRoot: string,
  now: Date,
  id: string | null = RELAY_LAUNCH_DECISION_ID,
  read: (repoRoot: string, id: string) => string | null = readDecisionFromMain
): DecisionGate {
  if (id === null) return { inForce: false, reason: "The standing Decision recording answer A to #2223 is not named (RELAY_LAUNCH_DECISION_ID is null)." };
  const stem = DECISION_STEM.exec(id);
  if (!stem) return { inForce: false, reason: `Decision ${id} is not a full <number>-<slug> file stem; a bare number can name more than one Decision.` };
  const raw = read(repoRoot, id);
  if (raw === null) return { inForce: false, reason: `Decision ${id} is not on origin/main.` };
  const text = raw.slice(0, 8_000);
  const fileId = /^id:\s*"?(\d{4})"?\s*$/m.exec(text)?.[1];
  const fileSlug = /^slug:\s*"?([a-z0-9-]+)"?\s*$/m.exec(text)?.[1];
  if (fileId !== stem[1] || fileSlug !== stem[2]) {
    return { inForce: false, reason: `Decision ${id} on main has id ${fileId ?? "unreadable"} and slug ${fileSlug ?? "unreadable"}, not an exact match.` };
  }
  const status = /^status:\s*(\S+)/m.exec(text)?.[1];
  const answer = /^answer:\s*"?(.+?)"?\s*$/m.exec(text)?.[1] ?? "";
  const decided = /^decided:\s*(\S+)/m.exec(text)?.[1];
  if (status !== "approved") return { inForce: false, reason: `Decision ${id} is ${status ?? "unreadable"}, not approved.` };
  if (!/^A\b/.test(answer)) return { inForce: false, reason: `Decision ${id} was answered "${answer.slice(0, 40)}", not A.` };
  if (!decided || Number.isNaN(Date.parse(decided))) return { inForce: false, reason: `Decision ${id} has no readable decided date.` };
  if (now.getTime() - Date.parse(decided) > RELAY_LIMITS.expiryDays * 24 * 60 * 60 * 1000) {
    return { inForce: false, reason: `Decision ${id} (decided ${decided}) expired after ${RELAY_LIMITS.expiryDays} days.` };
  }
  return { inForce: true, reason: `Decision ${id} answer A, decided ${decided}.` };
}

export function readFirstUserMessage(transcriptPath: string): string | null {
  if (!existsSync(transcriptPath)) return null;
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== "user" || entry.isSidechain || entry.isMeta) continue;
    const content = entry.message?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("").trim();
    }
    return null;
  }
  return null;
}

/**
 * Relay launches in the last 24 hours. Every attempt started a real session, so
 * failed ones count toward the attempt cap; renewals are the attempts that did
 * not fail.
 */
function relayLaunchesToday(db: Database.Database, project: string, role: string, now: Date): { attempts: number; renewals: number } {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const rows = listGenerations(db, project, role).filter((row) => row.relayLaunched && row.createdAt >= since);
  return { attempts: rows.length, renewals: rows.filter((row) => row.status !== "failed").length };
}

function generationStatus(db: Database.Database, project: string, role: string, generation: number): string | null {
  return listGenerations(db, project, role).find((row) => row.generation === generation)?.status ?? null;
}

/**
 * `arcadia coordinator renew`: launch one successor for a registered
 * coordinator role. One successor at a time (the claim refuses while one is
 * launching), the predecessor's provider and model, at most two attempts, one
 * attention ping after the second failure. The predecessor keeps custody until
 * the successor runs `accept`.
 */
export function renewCoordinator(db: Database.Database, workspace: string, input: RenewInput, deps: RelayDeps): RenewResult {
  const now = deps.now();
  // Log-write warnings from claims and failures are surfaced in the result, never dropped.
  const warnings: string[] = [];
  const onWarning = (warning: string) => { warnings.push(warning); };
  const permissionMode = input.permissionMode ?? RELAY_PERMISSION_MODE;
  if (!ALLOWED_PERMISSION_MODES.has(permissionMode)) {
    throw new ArcadiaError("VALIDATION_ERROR", `The relay launches only in an ordinary interactive permission mode (auto or default), never ${permissionMode}; bypass modes are excluded.`, 2, { reason: "bypass_mode" });
  }
  // Decision 0191 pins one successor per registered coordinator role (Rowan, Signal): never a builder or helper role.
  if (!RELAY_ROLES.has(input.role)) return refuse("role_not_allowed", `The relay launches successors only for the coordinator roles ${[...RELAY_ROLES].join(" and ")}, not ${input.role}.`);
  if (input.repoRoot === null) {
    // The Decision gate reads origin/main of the repository, so nothing can be checked. A tick that
    // omitted --repo would otherwise refuse on every run with nobody told (#2286 gate 4).
    const detail = "The invocation directory is not inside a repository with a primary worktree (the primary worktree, not the worktree that has main checked out); run renew from the repository or pass --repo <path>. Any tick or timer that runs renew must pass --repo.";
    deps.ping(`Coordinator relay could not start ${input.role} (${input.project}): repository unresolved; the predecessor keeps custody. Pass --repo <primary checkout> to renew. ${detail}`.slice(0, 500));
    return refuse("repository_unresolved", detail);
  }
  const repoRoot = input.repoRoot;
  const decision = deps.decision(repoRoot, now);
  if (!decision.inForce) return refuse(RELAY_LAUNCH_DECISION_ID === null ? "decision_pending" : "decision_not_in_force", decision.reason);

  // Probe P1: a fresh folder stops at "Is this a project you trust?" before the brief arrives. The successor's worktree
  // lives under this directory, so refuse before any claim, worktree or session when Claude Code does not trust it.
  const worktreesRoot = path.join(repoRoot, ".claude", "worktrees");
  const trust = deps.folderTrust(worktreesRoot);
  if (!trust.trusted) {
    deps.ping(`Coordinator relay held ${input.role} (${input.project}): the launch folder is not trusted by Claude Code; the predecessor keeps custody. ${trust.detail}`.slice(0, 500));
    return refuse("folder_untrusted", trust.detail);
  }

  const startPress = deps.startPressInProgress(repoRoot);
  if (startPress.inProgress) return refuse("start_in_progress", startPress.unreadable ? `A START press record cannot be read (${startPress.detail}); the relay launches no successor until it is resolved.` : `A START press is still in progress (${startPress.detail}); the relay launches no successor until its run record finishes or its runner dies.`);

  const custodian = currentCustodian(db, input.project, input.role);
  if (!custodian) return refuse("no_custodian", `No custodian generation of ${input.role} is recorded for ${input.project}; register the coordinator first.`);
  if (custodian.provider !== "claude") return refuse("provider_unsupported", `The relay launches Claude coordinators only so far; ${custodian.provider} waits for its probe.`);

  // A launch older than the acceptance window that was never accepted failed (design step 7).
  const stale = newestLaunching(db, input.project, input.role);
  if (stale && now.getTime() - Date.parse(stale.createdAt) >= CLAIM_LAUNCHING_FRESH_MS) {
    failGeneration(db, workspace, { project: input.project, role: input.role, generation: stale.generation, reason: "no_acceptance", now, onWarning });
    if (stale.tmuxName) deps.tmux.killSession?.(stale.tmuxName);
  } else if (stale) {
    return refuse("launch_in_progress", `Generation ${stale.generation} is still launching; one successor at a time.`);
  }

  const retry = `arcadia coordinator renew --project ${input.project} --role ${input.role}`;
  const failures: string[] = [];
  for (let attempt = 1; attempt <= RELAY_LIMITS.attemptsPerRenewal; attempt += 1) {
    if (attempt > 1) deps.sleep(RELAY_LIMITS.retryPauseMs);
    const today = relayLaunchesToday(db, input.project, input.role, deps.now());
    if (today.renewals >= RELAY_LIMITS.renewalsPerDay || today.attempts >= RELAY_LIMITS.renewalsPerDay * RELAY_LIMITS.attemptsPerRenewal) {
      return refuse("renewal_limit", `${input.role} already had ${today.renewals} relay renewals and ${today.attempts} launch attempts in the last 24 hours (limits ${RELAY_LIMITS.renewalsPerDay} and ${RELAY_LIMITS.renewalsPerDay * RELAY_LIMITS.attemptsPerRenewal}).`);
    }
    // Pre-launch gates, re-run before a retry (design steps 2 and 7). A failed gate pings once and the predecessor keeps custody.
    const signIn = deps.signIn(custodian.provider);
    if (signIn && !signIn.signedIn) {
      deps.ping(`Coordinator relay held ${input.role} (${input.project}): sign-in gate refused; the predecessor keeps custody. Then: ${retry}`);
      return refuse("sign_in", signIn.remedy);
    }
    // A risk or unknown spend verdict launches nothing: no claim, no worktree, no tmux Session.
    const spendRefusal = signIn?.spend ? spendRefusalMessage(signIn.spend, `The relay launch of ${input.role}`) : null;
    if (spendRefusal !== null) {
      deps.ping(`Coordinator relay held ${input.role} (${input.project}): spend gate refused; the predecessor keeps custody. Then: ${retry}`);
      return refuse("spend", spendRefusal);
    }
    const capacity = deps.capacity(custodian.provider);
    if (!capacity.admitted) {
      deps.ping(`Coordinator relay held ${input.role} (${input.project}): capacity gate refused; the predecessor keeps custody. Then: ${retry}`);
      return refuse("capacity", capacity.reason);
    }
    const sessionId = deps.newSessionId();
    const claim = claimNextGeneration(db, workspace, {
      project: input.project, role: input.role, provider: custodian.provider, model: custodian.model, tier: custodian.tier,
      identity: custodian.identity, nativeSessionId: sessionId,
      briefPath: custodian.briefPath, briefSha: custodian.briefSha, sources: deps.sources(), now: deps.now()
    });
    const name = `${input.role} g${claim.generation}`;
    const worktree = path.join(repoRoot, ".claude", "worktrees", `coord-${input.role}-g${claim.generation}`);
    const transcript = path.join(deps.claudeProjectsDirectory, claudeProjectSlug(worktree), `${sessionId}.jsonl`);
    recordTranscriptPath(db, input.project, input.role, claim.generation, transcript, deps.now(), name);
    const prompt = renderResumePrompt({ project: input.project, role: input.role, generation: claim.generation, snapshotSha: claim.snapshotSha, snapshotPath: claim.snapshotPath });
    warnings.push(...(claim.warnings ?? []));
    // The proof records what the Session shows (its transcript), never the requested values; it is written beside the generation.
    const launched = (attempts: number): RenewResult => {
      const proof = buildLaunchProof({
        transport: "tmux", sessionId, brief: prompt, transcript: observeTranscript(transcript),
        requestedModel: custodian.model, requestedEffort: claudeReasoningEffort(input.effort), now: deps.now()
      });
      let proofPath: string | null = null;
      try {
        const paths = coordinatorPaths(workspace, input.project, input.role);
        mkdirSync(paths.root, { recursive: true, mode: 0o700 });
        const target = path.join(paths.root, `launch-proof-g${claim.generation}.json`);
        const temporary = `${target}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, target);
        proofPath = target;
      } catch (error) {
        warnings.push(`The launch proof could not be written (${error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)}); it is in this result only.`);
      }
      const all = [...warnings, ...proof.warnings];
      return { outcome: "launched", generation: claim.generation, tmuxName: claim.tmuxName, sessionId, snapshotSha: claim.snapshotSha, worktree, attempts, proof, proofPath, ...(all.length > 0 ? { warnings: all } : {}) };
    };
    try {
      // The generation is new, so its deterministic name existing means a foreign
      // or leftover session: refuse to reuse it and never kill what we did not start.
      if (deps.tmux.hasSession(claim.tmuxName)) {
        failGeneration(db, workspace, { project: input.project, role: input.role, generation: claim.generation, reason: "tmux_name_taken", now: deps.now(), onWarning });
        failures.push(`attempt ${attempt}: tmux session ${claim.tmuxName} already exists; left untouched`);
        continue;
      }
      if (!existsSync(worktree)) deps.createWorktree(repoRoot, worktree);
      deps.tmux.launch({
        name: claim.tmuxName, cwd: worktree, command: "env",
        args: [
          ...billingUnsetArgs(),
          `${COORDINATOR_ENV.role}=${input.role}`, `${COORDINATOR_ENV.generation}=${claim.generation}`, `${COORDINATOR_ENV.token}=${claim.token}`,
          "claude", "--remote-control", name, "--session-id", sessionId, "--name", name,
          "--model", custodian.model, "--effort", claudeReasoningEffort(input.effort), "--permission-mode", permissionMode, prompt
        ]
      });
    } catch (error) {
      failures.push(`attempt ${attempt}: launch failed (${error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)})`);
      if (failGeneration(db, workspace, { project: input.project, role: input.role, generation: claim.generation, reason: "launch_failed", now: deps.now(), onWarning })) {
        deps.tmux.killSession?.(claim.tmuxName);
      }
      continue;
    }
    // Delivery check (design step 4): the transcript's first user message is exactly the prompt.
    const deadline = deps.now().getTime() + RELAY_LIMITS.deliveryWindowMs;
    for (;;) {
      if (deps.firstUserMessage(transcript) === prompt.trim()) {
        // Delivered. Give the Session a bounded further window to show its first reply so the model it actually runs is observed.
        const replyDeadline = deps.now().getTime() + RELAY_LIMITS.observationWindowMs;
        while (observeTranscript(transcript).model === null && deps.now().getTime() < replyDeadline) deps.sleep(5_000);
        return launched(attempt);
      }
      if (deps.now().getTime() >= deadline) break;
      deps.sleep(5_000);
    }
    // The successor may have accepted even though the transcript read lagged:
    // only a still-launching row is failed, and only a row we failed is stopped.
    if (generationStatus(db, input.project, input.role, claim.generation) !== "launching") return launched(attempt);
    if (failGeneration(db, workspace, { project: input.project, role: input.role, generation: claim.generation, reason: "prompt_not_delivered", now: deps.now(), onWarning })) {
      deps.tmux.killSession?.(claim.tmuxName);
      failures.push(`attempt ${attempt}: prompt not delivered to ${claim.tmuxName} within 2 minutes`);
    } else {
      return launched(attempt);
    }
  }
  // The retry command leads so the 500-character cap can never cut it off.
  const head = `Coordinator relay could not renew ${input.role} (${input.project}); the predecessor keeps custody and should work in low-context mode. Retry: ${retry}. `;
  deps.ping(`${head}${failures.join("; ")}`.slice(0, 500));
  return { outcome: "failed", attempts: RELAY_LIMITS.attemptsPerRenewal, failures, pinged: true, ...(warnings.length > 0 ? { warnings } : {}) };
}

/** The real host dependencies. */
/** Age past which a record whose runner and child cannot be verified live no longer blocks. A verified-live process always blocks. */
export const START_PRESS_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** A process that started this long after the record's startedAt is a reused pid, not the recorded process. */
const PID_REUSE_TOLERANCE_MS = 60_000;

export interface StartPressStatus { inProgress: boolean; detail: string; unreadable?: boolean }
export type PidLiveness = "live" | "dead" | "unverified";

/**
 * Whether the recorded process is still the one that wrote the record. Signal 0 answers existence (EPERM means it
 * exists); `ps -o lstart=` gives its start time, which must not be later than the record's startedAt by more than
 * PID_REUSE_TOLERANCE_MS (a later start is a reused pid: dead). Existing but with no readable start time: unverified.
 */
export function pidLiveness(pid: number, startedAtMs: number, options: { startTime?: (pid: number) => number | null } = {}): PidLiveness {
  try { process.kill(pid, 0); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return "dead";
  }
  const started = (options.startTime ?? processStartTime)(pid);
  if (started === null || !Number.isFinite(startedAtMs)) return "unverified";
  return started > startedAtMs + PID_REUSE_TOLERANCE_MS ? "dead" : "live";
}

function processStartTime(pid: number): number | null {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    const parsed = Date.parse(out);
    return out !== "" && Number.isFinite(parsed) ? parsed : null;
  } catch { return null; }
}

/**
 * Scans the operator-scripts library for a START press that is genuinely in progress. Only cards whose
 * `descriptor.json` carries `startRun` count (as scripts/start-run.sh and startRunDayGrant.ts decide); the descriptor is
 * read first, so a damaged record of a non-START card never blocks. For a START press whose `run.json` is `running`,
 * the runner pid and (recorded by the runner since this change) the child `childPid` are checked: any process that is
 * verified live (signal 0 plus a start time not after startedAt, so a reused pid is not mistaken) blocks, with no age
 * limit, because a press can legitimately run for hours. Only when no recorded process is verified live and one is
 * unverifiable (no pid recorded, or no readable start time) does the age bound apply: a record younger than
 * START_PRESS_MAX_AGE_MS blocks, an older one is stale. When every recorded process is dead the press is hard-stopped
 * (SIGKILL, crash, reboot): it does not block and is named in the detail. Records written before `childPid` existed
 * have only the runner pid, so a surviving child of such a press cannot be seen. A receipt `in_progress` alone never
 * blocks. Fail closed: a START (or unidentifiable) press whose descriptor or run record cannot be read, or a library
 * directory that cannot be listed, refuses (PRESS_UNREADABLE). A directory without run.json is not a press (the
 * runner has not written its record yet) and is skipped. A missing library means no press.
 */
export function startPressInProgressIn(
  library: string,
  options: { now?: Date; liveness?: (pid: number, startedAtMs: number) => PidLiveness; maxAgeMs?: number } = {}
): StartPressStatus {
  const now = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? START_PRESS_MAX_AGE_MS;
  const liveness = options.liveness ?? pidLiveness;
  const unreadable = (what: string, cause: string): StartPressStatus => ({ inProgress: true, unreadable: true, detail: `PRESS_UNREADABLE: ${what} cannot be read (${cause}), so it cannot be ruled out; preserve it and stop for the operator` });
  // A press is a directory; a stray file (.DS_Store, a lock, a note) is not one (start-run.sh: statSync(dir).isDirectory()).
  const isDirectory = (entry: string): boolean | StartPressStatus => {
    try { return statSync(entry).isDirectory(); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" || code === "ENOTDIR" ? false : unreadable(entry, code ?? "stat error");
    }
  };
  const list = (dir: string): string[] | StartPressStatus => {
    try { return readdirSync(dir); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" || code === "ENOTDIR" ? [] : unreadable(dir, code ?? "list error");
    }
  };
  const readJson = (file: string): { ok: true; value: Record<string, unknown> | null } | { ok: false; code: string } => {
    try { return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown> }; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" ? { ok: true, value: null } : { ok: false, code: code ?? "not valid JSON" };
    }
  };
  const usablePid = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);
  const root = path.join(library, "runs", "operator");
  const cards = list(root);
  if (!Array.isArray(cards)) return cards;
  const stale: string[] = [];
  for (const card of cards) {
    const cardDirectory = isDirectory(path.join(root, card));
    if (cardDirectory !== true) { if (cardDirectory === false) continue; return cardDirectory; }
    const presses = list(path.join(root, card));
    if (!Array.isArray(presses)) return presses;
    for (const press of presses) {
      const dir = path.join(root, card, press);
      const label = `${card}/${press}`;
      const pressDirectory = isDirectory(dir);
      if (pressDirectory !== true) { if (pressDirectory === false) continue; return pressDirectory; }
      const descriptor = readJson(path.join(dir, "descriptor.json"));
      if (descriptor.ok && descriptor.value !== null && !descriptor.value.startRun) continue; // a readable non-START card
      const run = readJson(path.join(dir, "run.json"));
      if (run.ok && run.value === null) continue; // not a press directory
      // Here the card is START, or its descriptor cannot be read (missing or damaged) so it cannot be ruled out.
      if (!run.ok) return unreadable(path.join(dir, "run.json"), run.code);
      if (run.value === null) continue;
      if (run.value.status !== "running") continue;
      if (!descriptor.ok || descriptor.value === null) return unreadable(path.join(dir, "descriptor.json"), descriptor.ok ? "missing" : descriptor.code);
      const startedAt = typeof run.value.startedAt === "string" ? Date.parse(run.value.startedAt) : Number.NaN;
      const recorded = [["runner", usablePid(run.value.pid)], ["child", usablePid(run.value.childPid)]] as const;
      const pids = recorded.filter((entry): entry is readonly ["runner" | "child", number] => entry[1] !== null);
      if (!Number.isFinite(startedAt) && pids.length === 0) return unreadable(path.join(dir, "run.json"), "running with neither a usable pid nor startedAt");
      const states = pids.map(([who, pid]) => ({ who, pid, state: liveness(pid, startedAt) }));
      const live = states.find((entry) => entry.state === "live");
      if (live) return { inProgress: true, detail: `${label} status running, ${live.who} pid ${live.pid} live` };
      const unverified = pids.length === 0 || states.some((entry) => entry.state === "unverified");
      if (!unverified) { stale.push(`${label} (${states.map((entry) => `${entry.who} pid ${entry.pid}`).join(" and ")} dead)`); continue; }
      const age = Number.isFinite(startedAt) ? now - startedAt : 0;
      if (Number.isFinite(startedAt) && age >= maxAgeMs) { stale.push(`${label} (unverifiable and older than ${Math.round(maxAgeMs / 3_600_000)}h)`); continue; }
      return { inProgress: true, detail: `${label} status running, ${pids.length === 0 ? "no usable pid" : "pid not verifiable"}, record is recent` };
    }
  }
  return { inProgress: false, detail: stale.length > 0 ? `no START press in progress; hard-stopped, ignored: ${stale.join(", ")}` : "no START press in progress" };
}

export function systemRelayDeps(input: { sources: () => CapsuleSources; ping: (message: string) => void; signIn: RelayDeps["signIn"]; capacity: RelayDeps["capacity"]; startPressInProgress: RelayDeps["startPressInProgress"]; folderTrust?: RelayDeps["folderTrust"] }): RelayDeps {
  return {
    tmux: systemTmux,
    startPressInProgress: input.startPressInProgress,
    folderTrust: input.folderTrust ?? ((directory) => claudeFolderTrust(directory, defaultClaudeStatePath(process.env, undefined, directory))),
    decision: (repoRoot, now) => readRelayDecision(repoRoot, now),
    signIn: input.signIn,
    capacity: input.capacity,
    createWorktree(repoRoot, directory) {
      execFileSync("git", ["-C", repoRoot, "fetch", "origin", "main"], { stdio: "ignore", timeout: 60_000 });
      execFileSync("git", ["-C", repoRoot, "worktree", "add", "--detach", directory, "origin/main"], { stdio: "ignore", timeout: 120_000 });
    },
    firstUserMessage: readFirstUserMessage,
    claudeProjectsDirectory: path.join(homedir(), ".claude", "projects"),
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    now: () => new Date(),
    newSessionId: () => randomUUID(),
    ping: input.ping,
    sources: input.sources
  };
}
