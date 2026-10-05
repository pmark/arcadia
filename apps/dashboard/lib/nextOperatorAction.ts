/**
 * The single "Do this next" operator action, derived only from published
 * descriptors (`next_after`), the run receipts and launcher state the library
 * already records, and live production status. It is presentation: it never
 * grants, gates or launches anything, and every script still checks its own
 * preconditions when it runs.
 */

export type OperatorRunStatus = "available" | "running" | "succeeded" | "failed";

export interface NextAfterRule {
  id: string;
  within_minutes: number;
  voided_by?: string[];
  when_production?: "inactive";
}

export interface SequencedScript {
  id: string;
  title: string;
  repeatable: boolean;
  state: { status: OperatorRunStatus; startedAt?: string; finishedAt?: string };
  failure?: { effect: string; next: string };
  nextAfter?: NextAfterRule | null;
  lastRunReceipt?: { outcome: string; startedAt: string | null; finishedAt: string | null } | null;
}

/** `null` when production status could not be read. */
export type ProductionObservation = { active: boolean } | null;

export interface NextActionChain {
  dependentId: string;
  prerequisiteId: string;
  voidedBy: string[];
}

export type NextOperatorAction =
  | { status: "none"; message: string; note: string | null }
  | {
      status: "next";
      reason: "window_open" | "prerequisite_expired" | "prerequisite_voided" | "prerequisite_failed" | "dependent_failed";
      scriptId: string;
      title: string;
      instruction: string;
      note: string | null;
      /** ISO instant after which the action would refuse; only for an open window. */
      deadline: string | null;
      chain: NextActionChain;
    };

interface LastRun { status: "running" | "succeeded" | "failed"; startedAt: number; finishedAt: number | null }

const time = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/** The newest run among the script-written receipt and the launcher state. */
function lastRun(script: SequencedScript): LastRun | null {
  const runs: LastRun[] = [];
  const receipt = script.lastRunReceipt;
  const receiptStart = time(receipt?.startedAt) ?? time(receipt?.finishedAt);
  if (receipt && receiptStart !== null) {
    runs.push({ status: receipt.outcome === "succeeded" ? "succeeded" : "failed", startedAt: receiptStart, finishedAt: time(receipt.finishedAt) });
  }
  const stateStart = time(script.state.startedAt) ?? time(script.state.finishedAt);
  if (script.state.status !== "available" && stateStart !== null) {
    runs.push({ status: script.state.status, startedAt: stateStart, finishedAt: time(script.state.finishedAt) });
  }
  // The launcher state wraps the same run as the receipt; a later start wins, and on a tie the
  // script's own receipt (its recorded outcome) wins over the launcher's exit status.
  return runs.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

/** "G7 (run 2)" from "G7 (run 2): Grant …"; the whole title when it has no short prefix. */
export function shortName(title: string): string {
  const colon = title.indexOf(":");
  return colon > 0 && colon <= 40 ? title.slice(0, colon) : title;
}

export function formatLocalTime(iso: string | number): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const RANK: Record<Extract<NextOperatorAction, { status: "next" }>["reason"], number> = {
  dependent_failed: 0,
  prerequisite_failed: 1,
  window_open: 2,
  prerequisite_voided: 3,
  prerequisite_expired: 3
};

export function deriveNextOperatorAction(scripts: SequencedScript[], production: ProductionObservation, now: number): NextOperatorAction {
  const byId = new Map(scripts.map((script) => [script.id, script]));
  const candidates: Array<{ action: Extract<NextOperatorAction, { status: "next" }>; at: number }> = [];
  let running: SequencedScript | null = null;
  let productionActive = false;

  for (const dependent of scripts) {
    const rule = dependent.nextAfter;
    const prerequisite = rule ? byId.get(rule.id) : undefined;
    if (!rule || !prerequisite) continue;
    const pass = prerequisite.lastRunReceipt;
    const passAt = time(pass?.finishedAt) ?? time(pass?.startedAt);
    // The chain starts only once its prerequisite has run; until then nothing in it is pending.
    if (!pass || passAt === null) continue;
    const own = lastRun(dependent);
    if (dependent.state.status === "succeeded" && !dependent.repeatable) continue;
    if (own?.status === "succeeded" && (!dependent.repeatable || own.startedAt >= passAt)) continue;
    const prerequisiteRun = lastRun(prerequisite);
    if (own?.status === "running" || prerequisiteRun?.status === "running") { running = own?.status === "running" ? dependent : prerequisite; continue; }

    const chain: NextActionChain = { dependentId: dependent.id, prerequisiteId: prerequisite.id, voidedBy: rule.voided_by ?? [] };
    const d = shortName(dependent.title);
    const p = shortName(prerequisite.title);
    const note = production === null && rule.when_production === "inactive" ? "Production status could not be read; the action checks it again before it acts." : null;

    if (own?.status === "failed" && own.startedAt >= passAt) {
      candidates.push({ at: own.startedAt, action: { status: "next", reason: "dependent_failed", scriptId: dependent.id, title: dependent.title, deadline: null, chain,
        instruction: `Open ${d}'s failed result and follow its handoff before pressing anything else.`, note: dependent.failure?.next ?? note } });
      continue;
    }
    // A failed dependent outranks production status: its handoff may say to turn production Off.
    if (rule.when_production === "inactive" && production?.active) { productionActive = true; continue; }
    if (pass.outcome !== "succeeded") {
      candidates.push({ at: passAt, action: { status: "next", reason: "prerequisite_failed", scriptId: prerequisite.id, title: prerequisite.title, deadline: null, chain,
        instruction: `${p} did not pass: open its result, fix what it names, then run ${p} again.`, note: prerequisite.failure?.next ?? note } });
      continue;
    }
    const voider = chain.voidedBy
      .map((id) => byId.get(id))
      .map((script) => script ? { script, run: lastRun(script) } : null)
      .filter((entry): entry is { script: SequencedScript; run: LastRun } => entry !== null && entry.run !== null && entry.run.startedAt > passAt)
      .sort((a, b) => b.run.startedAt - a.run.startedAt)[0];
    if (voider) {
      candidates.push({ at: voider.run.startedAt, action: { status: "next", reason: "prerequisite_voided", scriptId: prerequisite.id, title: prerequisite.title, deadline: null, chain,
        instruction: `Run ${p} again: ${shortName(voider.script.title)} ran at ${formatLocalTime(voider.run.startedAt)}, after ${p}'s last pass, so ${d} needs a fresh pass.`, note } });
      continue;
    }
    const deadline = passAt + rule.within_minutes * 60_000;
    if (now >= deadline) {
      candidates.push({ at: deadline, action: { status: "next", reason: "prerequisite_expired", scriptId: prerequisite.id, title: prerequisite.title, deadline: null, chain,
        instruction: `Run ${p} again: its last pass expired at ${formatLocalTime(deadline)}, so ${d} would refuse it.`, note } });
      continue;
    }
    candidates.push({ at: passAt, action: { status: "next", reason: "window_open", scriptId: dependent.id, title: dependent.title, deadline: new Date(deadline).toISOString(), chain,
      instruction: `Read this card, then run ${d} before ${formatLocalTime(deadline)}, while its ${p} pass is still valid.`, note } });
  }

  const chosen = candidates.sort((a, b) => RANK[a.action.reason] - RANK[b.action.reason] || b.at - a.at)[0];
  if (chosen) return chosen.action;
  if (running) return { status: "none", message: "Nothing needs you right now.", note: `${shortName(running.title)} is running; this panel updates when it finishes.` };
  if (productionActive) return { status: "none", message: "Nothing needs you right now.", note: "Production is Active, so the rehearsal steps that need it Off are not offered." };
  return { status: "none", message: "Nothing needs you right now.", note: null };
}

/**
 * The confirmation shown before pressing an action that is not the current next
 * action, or `null` when the press is the next action (or nothing is next).
 * Confirmation never replaces the script's own gates or refusals.
 */
export function offPathConfirmation(next: NextOperatorAction, pressed: SequencedScript, scripts: SequencedScript[]): string | null {
  if (next.status !== "next" || pressed.id === next.scriptId) return null;
  const byId = new Map(scripts.map((script) => [script.id, script]));
  const label = (id: string) => shortName(byId.get(id)?.title ?? id);
  const n = shortName(next.title);
  const x = shortName(pressed.title);
  const d = label(next.chain.dependentId);
  const p = label(next.chain.prerequisiteId);
  const head = `${x} is not your next action. Your next action is ${n}${next.deadline ? `, before ${formatLocalTime(next.deadline)}` : ""}.`;
  let effect: string;
  if (next.chain.voidedBy.includes(pressed.id)) {
    effect = next.reason === "window_open"
      ? `Running ${x} now undoes ${p}'s pass that ${d} needs, so you would have to run ${p} again before ${d}.`
      : `Running ${x} after ${p} passes undoes that pass, so ${d} would need ${p} again.`;
  } else if (pressed.id === next.chain.prerequisiteId && next.reason === "window_open") {
    effect = `Running ${x} again replaces the pass ${d} relies on; if this run does not pass, ${d} cannot run until ${x} passes again.`;
  } else {
    effect = `${x} is not declared to undo ${n}, but read its card before running it.`;
  }
  return `${head} ${effect}`;
}

/** "12:04" until the deadline, or null once it has passed. */
export function formatCountdown(deadline: string, now: number): string | null {
  const remaining = Date.parse(deadline) - now;
  if (!(remaining > 0)) return null;
  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
