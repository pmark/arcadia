import type Database from "better-sqlite3";
import { resolveOperatorGate } from "../ask/operatorGate.js";
import { listUnsettledAgentAskProposals } from "../ask/settlement.js";
import { observeCodingAgentAvailability, readCodexRateLimitsLive, type CodexRateLimitRead, type CodexRateLimitReadFailure } from "../codingAgents/availability.js";
import { observeProviderCapacity } from "../codingAgents/capacity.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import path from "node:path";

export interface ChainAskState {
  /** Every pending proposal or open Decision that would gate one of the chain's Actions. */
  blocking: Array<{ action: string; kind: string; id: string; requestId: string | null; title: string; settle: string | null }>;
  /** Every pending (unsettled) proposal for the fixture Project. */
  fixturePending: Array<{ id: string; requestId: string; intent: string; targetRef: string | null }>;
  /** Which of the asked request ids are already recorded as proposals anywhere in the workspace. */
  usedRequestIds: string[];
  /** Every fixture proposal with its disposition (pending when unsettled), for the receipt only. */
  fixtureProposals: Array<{ requestId: string; intent: string | null; targetRef: string | null; disposition: string }>;
}

/**
 * Read-only observation for the rehearsal-chain reset: the dispatch gate for
 * each chain Action (the same resolveOperatorGate the tick uses), the pending
 * fixture proposals, the fixture's proposal history and whether the fresh
 * completion ids are unused. It reads a database handle the caller opened
 * read-only and never settles, previews or writes anything.
 */
export function readChainAskState(db: Database.Database, input: { repoRoot: string; projectSlug: string; actionIds: string[]; requestIds: string[] }): ChainAskState {
  const slug = input.projectSlug.toLowerCase();
  const unsettled = listUnsettledAgentAskProposals(db);
  const requestOf = new Map(unsettled.map((row) => [row.id, row.requestId]));
  const blocking: ChainAskState["blocking"] = [];
  for (const action of input.actionIds) {
    const gate = resolveOperatorGate({ db, repoRoot: input.repoRoot, projectSlug: input.projectSlug, selectedActionId: action });
    for (const item of gate.blocking) {
      blocking.push({ action, kind: item.kind, id: item.id, requestId: requestOf.get(item.id) ?? null, title: item.title, settle: item.settleCommand ?? null });
    }
  }
  const fixturePending = unsettled
    .filter((row) => String(row.proposal.normalized.project).toLowerCase() === slug)
    .map((row) => ({ id: row.id, requestId: row.requestId, intent: row.proposal.normalized.intent, targetRef: row.proposal.normalized.targetRef ?? null }));
  const used = db.prepare("SELECT 1 FROM agent_ask_proposals WHERE request_id = ?");
  const usedRequestIds = input.requestIds.filter((id) => Boolean(used.get(id)));
  const fixtureProposals = (db.prepare("SELECT p.request_id, p.proposal_json, s.disposition FROM agent_ask_proposals p LEFT JOIN agent_ask_settlements s ON s.proposal_id = p.id ORDER BY p.rowid").all() as Array<{ request_id: string; proposal_json: string; disposition: string | null }>)
    .map((row) => {
      let normalized: { project?: unknown; intent?: string; targetRef?: string | null } = {};
      try { normalized = JSON.parse(row.proposal_json).normalized ?? {}; } catch { /* an unreadable row is reported as having no project */ }
      return { row, normalized };
    })
    .filter(({ normalized }) => String(normalized.project).toLowerCase() === slug)
    .map(({ row, normalized }) => ({ requestId: row.request_id, intent: normalized.intent ?? null, targetRef: normalized.targetRef ?? null, disposition: row.disposition ?? "pending" }));
  return { blocking, fixturePending, usedRequestIds, fixtureProposals };
}

/** G6's bounded live read of Codex capacity: three attempts of at most 20 s, 2 s apart, so the probe stays inside its 120 s bound. */
export const CODEX_CAPACITY_LIVE_READ = { attempts: 3, deadlineMs: 20_000, pauseMs: 2_000 } as const;

export interface CodexCapacityLiveObservation {
  generatedAt: string;
  readOnlyReviewers: string[];
  liveRead: {
    ok: boolean;
    maxAttempts: number;
    deadlineMs: number;
    attempts: Array<{ attempt: number; ok: boolean; failure?: CodexRateLimitReadFailure }>;
  };
  /** The admission decision from the telemetry this probe read live; null when no live read succeeded (a stale cache is never judged). */
  codex: {
    admitted: boolean; code: string | null; reason: string; unattendedProof: unknown; source: string; evidence: string; confidence: string;
    freshness: string; usagePolicy: string; observedAt: string | null; expiresAt: string | null; availability: string; windows: unknown;
  } | null;
}

const waitSynchronously = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * Observe Codex capacity for G6 from a fresh live `account/rateLimits/read`
 * (the path observeCodingAgentAvailability uses), retried a bounded number of
 * times. A success feeds the capacity decision exactly that telemetry; failing
 * every attempt returns each named failure (timeout or exit status) and no
 * decision, so the caller refuses naming it instead of judging whatever the
 * cache held. Reads only; it never writes a capacity receipt.
 */
export function observeCodexCapacityLive(profiles: CodingAgentProfile[], options: {
  attempts?: number; deadlineMs?: number; pauseMs?: number;
  read?: (now: Date, deadlineMs: number) => CodexRateLimitRead;
  sleep?: (ms: number) => void;
  now?: () => Date;
} = {}): CodexCapacityLiveObservation {
  const maxAttempts = options.attempts ?? CODEX_CAPACITY_LIVE_READ.attempts;
  const deadlineMs = options.deadlineMs ?? CODEX_CAPACITY_LIVE_READ.deadlineMs;
  const pauseMs = options.pauseMs ?? CODEX_CAPACITY_LIVE_READ.pauseMs;
  const read = options.read ?? ((now: Date, limit: number) => readCodexRateLimitsLive(now, { deadlineMs: limit }));
  const sleep = options.sleep ?? waitSynchronously;
  const clock = options.now ?? (() => new Date());
  const readOnlyReviewers = profiles.filter((p) => p.provider === "codex-cli" && p.sandbox === "read-only" && path.basename(p.command) === "codex").map((p) => p.name);
  const attempts: CodexCapacityLiveObservation["liveRead"]["attempts"] = [];
  let telemetry: Extract<CodexRateLimitRead, { ok: true }>["telemetry"] | null = null;
  for (let attempt = 1; attempt <= maxAttempts && telemetry === null; attempt++) {
    const result = read(clock(), deadlineMs);
    if (result.ok) { telemetry = result.telemetry; attempts.push({ attempt, ok: true }); }
    else { attempts.push({ attempt, ok: false, failure: result.failure }); if (attempt < maxAttempts) sleep(pauseMs); }
  }
  const liveRead = { ok: telemetry !== null, maxAttempts, deadlineMs, attempts };
  if (telemetry === null) return { generatedAt: clock().toISOString(), readOnlyReviewers, liveRead, codex: null };
  const now = clock();
  const snapshot = observeCodingAgentAvailability(profiles, now, { providerTelemetry: { "codex-cli": telemetry } });
  const observation = observeProviderCapacity(profiles, { now, snapshot, unmeteredProvider: null });
  const decision = observation.providers.find((entry) => entry.providerId === "codex-cli");
  return {
    generatedAt: observation.generatedAt, readOnlyReviewers, liveRead,
    codex: decision ? {
      admitted: decision.admitted, code: decision.code ?? null, reason: decision.reason, unattendedProof: decision.unattendedProof,
      source: decision.receipt.source, evidence: decision.receipt.evidence, confidence: decision.receipt.confidence,
      freshness: decision.receipt.freshness, usagePolicy: decision.receipt.usagePolicy, observedAt: decision.receipt.observedAt,
      expiresAt: decision.receipt.expiresAt, availability: decision.receipt.availability, windows: decision.receipt.windows
    } : null
  };
}
