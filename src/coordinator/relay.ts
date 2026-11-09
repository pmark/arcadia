import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import { claudeReasoningEffort } from "../codingAgents/reasoningEffort.js";
import { systemTmux, type TmuxAdapter } from "../sessions/index.js";
import type { CapsuleSources } from "./capsule.js";
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

/** Limits pinned by answer A of the design's Decision. */
export const RELAY_LIMITS = {
  attemptsPerRenewal: 2,
  renewalsPerDay: 6,
  expiryDays: 30,
  deliveryWindowMs: 2 * 60 * 1000,
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
  | "decision_pending" | "decision_not_in_force" | "no_custodian" | "provider_unsupported"
  | "renewal_limit" | "sign_in" | "capacity" | "launch_in_progress" | "repository_unresolved";

export interface DecisionGate { inForce: boolean; reason: string }

export interface RelayDeps {
  tmux: Pick<TmuxAdapter, "hasSession" | "launch" | "killSession">;
  decision(repoRoot: string, now: Date): DecisionGate;
  signIn(provider: string): { signedIn: boolean; remedy: string } | null;
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
}

export interface RenewInput {
  project: string;
  role: string;
  repoRoot: string;
  /** Abstract effort key (e3_deep) or a native value; pinned by the Decision. */
  effort: string;
  permissionMode?: string;
}

export type RenewResult =
  | { outcome: "launched"; generation: number; tmuxName: string; sessionId: string; snapshotSha: string; worktree: string; attempts: number; warnings?: string[] }
  | { outcome: "refused"; reason: RelayRefusal; detail: string }
  | { outcome: "failed"; attempts: number; failures: string[]; pinged: boolean };

/** The fixed resume prompt (design step 3). It holds no approval, quote or free-form state. */
export function renderResumePrompt(input: { project: string; role: string; generation: number; snapshotSha: string; snapshotPath: string }): string {
  const scope = `--project ${input.project} --role ${input.role}`;
  return [
    `You are ${input.role} generation ${input.generation} for ${input.project}.`,
    `Run \`arcadia coordinator subscribe ${scope} --from-snapshot ${input.snapshotSha}\` to list the inherited watchers (it starts none),`,
    `start each listed watcher yourself in the background and register it with \`arcadia coordinator subscribe ${scope} "<command>" --cursor <c>\`,`,
    `then \`arcadia coordinator verify ${scope} --generation ${input.generation} --snapshot-sha ${input.snapshotSha}\`,`,
    `then \`arcadia coordinator accept ${scope} --generation ${input.generation} --snapshot-sha ${input.snapshotSha}\`.`,
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
  const permissionMode = input.permissionMode ?? RELAY_PERMISSION_MODE;
  if (!ALLOWED_PERMISSION_MODES.has(permissionMode)) {
    throw new ArcadiaError("VALIDATION_ERROR", `The relay launches only in an ordinary interactive permission mode (auto or default), never ${permissionMode}; bypass modes are excluded.`, 2, { reason: "bypass_mode" });
  }
  const decision = deps.decision(input.repoRoot, now);
  if (!decision.inForce) return refuse(RELAY_LAUNCH_DECISION_ID === null ? "decision_pending" : "decision_not_in_force", decision.reason);

  const custodian = currentCustodian(db, input.project, input.role);
  if (!custodian) return refuse("no_custodian", `No custodian generation of ${input.role} is recorded for ${input.project}; register the coordinator first.`);
  if (custodian.provider !== "claude") return refuse("provider_unsupported", `The relay launches Claude coordinators only so far; ${custodian.provider} waits for its probe.`);

  // A launch older than the acceptance window that was never accepted failed (design step 7).
  const stale = newestLaunching(db, input.project, input.role);
  if (stale && now.getTime() - Date.parse(stale.createdAt) >= CLAIM_LAUNCHING_FRESH_MS) {
    failGeneration(db, workspace, { project: input.project, role: input.role, generation: stale.generation, reason: "no_acceptance", now });
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
    const worktree = path.join(input.repoRoot, ".claude", "worktrees", `coord-${input.role}-g${claim.generation}`);
    const transcript = path.join(deps.claudeProjectsDirectory, claudeProjectSlug(worktree), `${sessionId}.jsonl`);
    recordTranscriptPath(db, input.project, input.role, claim.generation, transcript, deps.now(), name);
    const prompt = renderResumePrompt({ project: input.project, role: input.role, generation: claim.generation, snapshotSha: claim.snapshotSha, snapshotPath: claim.snapshotPath });
    const launched = (attempts: number): RenewResult => ({ outcome: "launched", generation: claim.generation, tmuxName: claim.tmuxName, sessionId, snapshotSha: claim.snapshotSha, worktree, attempts, ...(claim.warnings ? { warnings: claim.warnings } : {}) });
    try {
      // The generation is new, so its deterministic name existing means a foreign
      // or leftover session: refuse to reuse it and never kill what we did not start.
      if (deps.tmux.hasSession(claim.tmuxName)) {
        failGeneration(db, workspace, { project: input.project, role: input.role, generation: claim.generation, reason: "tmux_name_taken", now: deps.now() });
        failures.push(`attempt ${attempt}: tmux session ${claim.tmuxName} already exists; left untouched`);
        continue;
      }
      if (!existsSync(worktree)) deps.createWorktree(input.repoRoot, worktree);
      deps.tmux.launch({
        name: claim.tmuxName, cwd: worktree, command: "env",
        args: [
          `${COORDINATOR_ENV.role}=${input.role}`, `${COORDINATOR_ENV.generation}=${claim.generation}`, `${COORDINATOR_ENV.token}=${claim.token}`,
          "claude", "--remote-control", name, "--session-id", sessionId, "--name", name,
          "--model", custodian.model, "--effort", claudeReasoningEffort(input.effort), "--permission-mode", permissionMode, prompt
        ]
      });
    } catch (error) {
      failures.push(`attempt ${attempt}: launch failed (${error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)})`);
      if (failGeneration(db, workspace, { project: input.project, role: input.role, generation: claim.generation, reason: "launch_failed", now: deps.now() })) {
        deps.tmux.killSession?.(claim.tmuxName);
      }
      continue;
    }
    // Delivery check (design step 4): the transcript's first user message is exactly the prompt.
    const deadline = deps.now().getTime() + RELAY_LIMITS.deliveryWindowMs;
    for (;;) {
      if (deps.firstUserMessage(transcript) === prompt.trim()) return launched(attempt);
      if (deps.now().getTime() >= deadline) break;
      deps.sleep(5_000);
    }
    // The successor may have accepted even though the transcript read lagged:
    // only a still-launching row is failed, and only a row we failed is stopped.
    if (generationStatus(db, input.project, input.role, claim.generation) !== "launching") return launched(attempt);
    if (failGeneration(db, workspace, { project: input.project, role: input.role, generation: claim.generation, reason: "prompt_not_delivered", now: deps.now() })) {
      deps.tmux.killSession?.(claim.tmuxName);
      failures.push(`attempt ${attempt}: prompt not delivered to ${claim.tmuxName} within 2 minutes`);
    } else {
      return launched(attempt);
    }
  }
  // The retry command leads so the 500-character cap can never cut it off.
  const head = `Coordinator relay could not renew ${input.role} (${input.project}); the predecessor keeps custody and should work in low-context mode. Retry: ${retry}. `;
  deps.ping(`${head}${failures.join("; ")}`.slice(0, 500));
  return { outcome: "failed", attempts: RELAY_LIMITS.attemptsPerRenewal, failures, pinged: true };
}

/** The real host dependencies. */
export function systemRelayDeps(input: { sources: () => CapsuleSources; ping: (message: string) => void; signIn: RelayDeps["signIn"]; capacity: RelayDeps["capacity"] }): RelayDeps {
  return {
    tmux: systemTmux,
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
