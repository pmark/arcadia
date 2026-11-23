import { createHash } from "node:crypto";
import path from "node:path";

/**
 * The receipt `production-replay --card` writes and a standing-grant press reads. It is a prediction bound to one card: it names the
 * card descriptor's sha256 and the four revisions the card pins, and says what the replay expects for each pinned Action. It is not
 * proof of the run's result, and it grants nothing.
 */
export const REPLAY_RECEIPT_SCHEMA = "arcadia-start-run-replay-receipt-v1";
export const REPLAY_RECEIPT_BASIS = "A prediction bound to this one card; not proof of the run's result.";

export type ReplayRefusalCode = "REPLAY_REQUIRED" | "REPLAY_MISMATCH" | "REPLAY_PREDICTS_NO_LAUNCH";

export interface ReplayCardIdentity {
  descriptorSha256: string;
  reviewedRevision: string;
  queueRevision: number;
  productionRevision: number;
  productionEpoch: number;
  actions: string[];
}
export interface ReplayPrediction { action: string; predicted: string }
export interface ReplayReceipt extends Omit<ReplayCardIdentity, "actions"> {
  schema: typeof REPLAY_RECEIPT_SCHEMA;
  card: string;
  basis: string;
  replayedAt: string;
  predictions: ReplayPrediction[];
}

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
/** Where the replay writes a card's receipt and the press reads it: beside the card, in `replays/`. */
export const replayReceiptPath = (libraryDir: string, card: string): string => path.join(libraryDir, "replays", `${card}.json`);

/** The identity of a card read from its descriptor bytes alone, or null when it is not a START card. */
export function replayCardIdentity(descriptorBytes: string): { card: string; identity: ReplayCardIdentity } | null {
  try {
    const descriptor = JSON.parse(descriptorBytes) as { id?: unknown; startRun?: Record<string, unknown> };
    const pins = descriptor.startRun;
    const production = pins?.production as { revision?: unknown; epoch?: unknown } | undefined;
    if (typeof descriptor.id !== "string" || !pins || !production || typeof pins.reviewedRevision !== "string" || !Array.isArray(pins.actions)) return null;
    if (typeof pins.queueRevision !== "number" || typeof production.revision !== "number" || typeof production.epoch !== "number") return null;
    return {
      card: descriptor.id,
      identity: { descriptorSha256: sha256(descriptorBytes), reviewedRevision: pins.reviewedRevision, queueRevision: pins.queueRevision, productionRevision: production.revision, productionEpoch: production.epoch, actions: pins.actions.map(String) }
    };
  } catch { return null; }
}

/** What the replay report says about each pinned Action; the structural subset of the replay's own report. */
export interface ReplayOutcomeSource {
  activation: { ok: boolean };
  ticks: Array<{ launch: { outcome: string; actionKey: string | null } | null }>;
  /** Why the replay ended; an early stop (external effect, tick limit, ...) means it never reached a launch decision. */
  stop?: { reason: string } | null;
}

/** Stops that settled the replay's launch decision. Any other stop reason, including an unknown or future one, is inconclusive: never a refusal and never a launch. */
const SETTLED_STOPS = new Set(["launched", "integrated", "all_merged", "steady_state", "activation_refused"]);

/**
 * One predicted outcome per pinned Action. An Action a tick launched or refused carries that outcome. A later pinned Action the
 * replay did not reach is `launch` only when the Action before it launched and the activation held, since the press's own preview
 * requires every pinned Action ready, in order, behind it; otherwise it is `not_reached`.
 */
export function predictOutcomes(actions: string[], project: string, report: ReplayOutcomeSource): ReplayPrediction[] {
  const seen = new Map<string, string>();
  const inconclusive = report.stop && !SETTLED_STOPS.has(report.stop.reason) ? `inconclusive (${report.stop.reason})` : null;
  for (const tick of report.ticks) {
    const key = tick.launch?.actionKey;
    if (!tick.launch || !key) continue;
    const id = key.startsWith(`${project}/`) ? key.slice(project.length + 1) : key;
    if (!seen.has(id) || tick.launch.outcome === "launched") seen.set(id, tick.launch.outcome === "launched" ? "launch" : tick.launch.outcome);
  }
  const out: ReplayPrediction[] = [];
  actions.forEach((action, index) => {
    if (!report.activation.ok) return out.push({ action, predicted: "activation_refused" });
    const own = seen.get(action);
    if (own === "launch") return out.push({ action, predicted: "launch" });
    if (inconclusive) return out.push({ action, predicted: inconclusive });
    if (own) return out.push({ action, predicted: own });
    out.push({ action, predicted: index > 0 && out[index - 1].predicted === "launch" ? "launch" : "not_reached" });
  });
  return out;
}

export function buildReplayReceipt(card: string, identity: ReplayCardIdentity, project: string, report: ReplayOutcomeSource, now: string): ReplayReceipt {
  const { actions, ...bound } = identity;
  return { schema: REPLAY_RECEIPT_SCHEMA, card, basis: REPLAY_RECEIPT_BASIS, replayedAt: now, ...bound, predictions: predictOutcomes(actions, project, report) };
}

export interface ReplayCheck { ok: boolean; code: ReplayRefusalCode | null; detail: string }

/** The press-time check: a receipt exists, names this card's five values and predicts a launch for every pinned Action. */
export function checkReplayReceipt(receiptText: string | null, identity: ReplayCardIdentity): ReplayCheck {
  const refuse = (code: ReplayRefusalCode, detail: string): ReplayCheck => ({ ok: false, code, detail });
  if (receiptText === null) return refuse("REPLAY_REQUIRED", "no replay receipt exists for this card; run `pnpm production-replay --card <id>` first");
  let receipt: Partial<ReplayReceipt>;
  try { receipt = JSON.parse(receiptText) as Partial<ReplayReceipt>; } catch { return refuse("REPLAY_REQUIRED", "the replay receipt is not valid JSON"); }
  if (!receipt || receipt.schema !== REPLAY_RECEIPT_SCHEMA) return refuse("REPLAY_REQUIRED", `the replay receipt is not a ${REPLAY_RECEIPT_SCHEMA}`);
  const differing = (["descriptorSha256", "reviewedRevision", "queueRevision", "productionRevision", "productionEpoch"] as const).filter((key) => receipt[key] !== identity[key]);
  if (differing.length) return refuse("REPLAY_MISMATCH", `the replay receipt differs from this card in ${differing.join(", ")}`);
  const predictions = Array.isArray(receipt.predictions) ? receipt.predictions : [];
  const missing = identity.actions.filter((action) => !predictions.some((entry) => entry?.action === action));
  if (missing.length) return refuse("REPLAY_MISMATCH", `the replay receipt predicts no outcome for ${missing.join(", ")}`);
  const noLaunch = identity.actions.filter((action) => predictions.find((entry) => entry.action === action)?.predicted !== "launch");
  const inconclusive = noLaunch.filter((action) => String(predictions.find((entry) => entry.action === action)?.predicted).startsWith("inconclusive"));
  if (inconclusive.length) return refuse("REPLAY_PREDICTS_NO_LAUNCH", `the replay was inconclusive (it stopped before a launch decision), not a predicted refusal, for ${inconclusive.map((action) => `${action} ${predictions.find((entry) => entry.action === action)?.predicted}`).join(", ")}; fix the stop and replay again`);
  if (noLaunch.length) return refuse("REPLAY_PREDICTS_NO_LAUNCH", `the replay does not predict a launch for ${noLaunch.map((action) => `${action} (${predictions.find((entry) => entry.action === action)?.predicted ?? "none"})`).join(", ")}`);
  return { ok: true, code: null, detail: "the replay receipt names this card and predicts a launch for every pinned Action" };
}
