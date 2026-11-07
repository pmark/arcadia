import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * DECISION-PLACEHOLDER: the governed Decision recording answer A to #2223 (the
 * next free number after 0190). While this is null, `renew` refuses before any
 * claim, worktree or launch. Set it to the Decision's four-digit id once that
 * Decision is on main.
 */
export const RELAY_LAUNCH_DECISION_ID: string | null = null;

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
const BYPASS_MODES = new Set(["bypassPermissions", "dangerously-skip-permissions"]);

export type RelayRefusal =
  | "decision_pending" | "decision_not_in_force" | "no_custodian" | "provider_unsupported"
  | "renewal_limit" | "sign_in" | "capacity" | "launch_in_progress";

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
  | { outcome: "launched"; generation: number; tmuxName: string; sessionId: string; snapshotSha: string; worktree: string; attempts: number }
  | { outcome: "refused"; reason: RelayRefusal; detail: string }
  | { outcome: "failed"; attempts: number; failures: string[]; pinged: boolean };

/** The fixed resume prompt (design step 3). It holds no approval, quote or free-form state. */
export function renderResumePrompt(input: { project: string; role: string; generation: number; snapshotSha: string; snapshotPath: string }): string {
  const scope = `--project ${input.project} --role ${input.role}`;
  return [
    `You are ${input.role} generation ${input.generation} for ${input.project}.`,
    `Run \`arcadia coordinator subscribe ${scope} --from-snapshot ${input.snapshotSha}\`,`,
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

/** Reads `docs/decisions/<id>-*.md`: status approved, answer A, decided within the expiry. */
export function readRelayDecision(repoRoot: string, now: Date, id: string | null = RELAY_LAUNCH_DECISION_ID): DecisionGate {
  if (id === null) return { inForce: false, reason: "The standing Decision recording answer A to #2223 is not yet on main (DECISION-PLACEHOLDER)." };
  const directory = path.join(repoRoot, "docs", "decisions");
  const file = existsSync(directory) ? readdirSync(directory).find((name) => name.startsWith(`${id}-`) && name.endsWith(".md")) : undefined;
  if (!file) return { inForce: false, reason: `Decision ${id} is not in ${directory}.` };
  const text = readFileSync(path.join(directory, file), "utf8").slice(0, 8_000);
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
    let entry: { type?: string; isSidechain?: boolean; message?: { content?: unknown } };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== "user" || entry.isSidechain) continue;
    const content = entry.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("");
    }
    return null;
  }
  return null;
}

function relayLaunchesToday(db: Database.Database, project: string, role: string, now: Date): number {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return listGenerations(db, project, role).filter((row) => row.relayLaunched && row.status !== "failed" && row.createdAt >= since).length;
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
  if (BYPASS_MODES.has(permissionMode)) {
    throw new ArcadiaError("VALIDATION_ERROR", `The relay never launches in a bypass permission mode (${permissionMode}).`, 2, { reason: "bypass_mode" });
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

  if (relayLaunchesToday(db, input.project, input.role, now) >= RELAY_LIMITS.renewalsPerDay) {
    return refuse("renewal_limit", `${input.role} already had ${RELAY_LIMITS.renewalsPerDay} relay renewals in the last 24 hours.`);
  }
  const signIn = deps.signIn(custodian.provider);
  if (signIn && !signIn.signedIn) return refuse("sign_in", signIn.remedy);
  const capacity = deps.capacity(custodian.provider);
  if (!capacity.admitted) return refuse("capacity", capacity.reason);

  const failures: string[] = [];
  for (let attempt = 1; attempt <= RELAY_LIMITS.attemptsPerRenewal; attempt += 1) {
    if (attempt > 1) deps.sleep(RELAY_LIMITS.retryPauseMs);
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
    try {
      if (!existsSync(worktree)) deps.createWorktree(input.repoRoot, worktree);
      // A crash between claim and spawn is recovered by the deterministic name, never by spawning twice.
      if (!deps.tmux.hasSession(claim.tmuxName)) {
        deps.tmux.launch({
          name: claim.tmuxName, cwd: worktree, command: "env",
          args: [
            `${COORDINATOR_ENV.role}=${input.role}`, `${COORDINATOR_ENV.generation}=${claim.generation}`, `${COORDINATOR_ENV.token}=${claim.token}`,
            "claude", "--remote-control", name, "--session-id", sessionId, "--name", name,
            "--model", custodian.model, "--effort", claudeReasoningEffort(input.effort), "--permission-mode", permissionMode, prompt
          ]
        });
      }
    } catch (error) {
      failures.push(`attempt ${attempt}: launch failed (${error instanceof Error ? error.message.slice(0, 200) : String(error)})`);
      failGeneration(db, workspace, { project: input.project, role: input.role, generation: claim.generation, reason: "launch_failed", now: deps.now() });
      deps.tmux.killSession?.(claim.tmuxName);
      continue;
    }
    // Delivery check (design step 4): the transcript's first user message is exactly the prompt.
    const deadline = deps.now().getTime() + RELAY_LIMITS.deliveryWindowMs;
    let delivered = false;
    for (;;) {
      if (deps.firstUserMessage(transcript) === prompt) { delivered = true; break; }
      if (deps.now().getTime() >= deadline) break;
      deps.sleep(5_000);
    }
    if (delivered) {
      return { outcome: "launched", generation: claim.generation, tmuxName: claim.tmuxName, sessionId, snapshotSha: claim.snapshotSha, worktree, attempts: attempt };
    }
    failures.push(`attempt ${attempt}: prompt not delivered to ${claim.tmuxName} within 2 minutes`);
    failGeneration(db, workspace, { project: input.project, role: input.role, generation: claim.generation, reason: "prompt_not_delivered", now: deps.now() });
    deps.tmux.killSession?.(claim.tmuxName);
  }
  deps.ping(`Coordinator relay could not renew ${input.role} (${input.project}): ${failures.join("; ")}. The predecessor keeps custody and should work in low-context mode. Retry: arcadia coordinator renew --project ${input.project} --role ${input.role}`.slice(0, 500));
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
