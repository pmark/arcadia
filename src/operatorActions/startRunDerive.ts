import { createHash } from "node:crypto";
import path from "node:path";
import { START_RUN_EXECUTOR_PATH, StartRunPinsError, validateStartRunPins, startRunLauncher, type StartRunPins } from "./startRunPins.js";
import { parse as parseYaml } from "yaml";
import { validateDayGrantPrevious, type DayGrantDelegation, type DayGrantPrevious, type DayGrantPressKind } from "./startRunDayGrant.js";

/**
 * The whole standing-grant START card, derived and never typed: every field comes from origin main, the governed queue, the
 * production policy, the open standing-grant receipt or a constant below. `deriveStartCard` is pure (same input, same bytes) and
 * the `arcadia start-run derive` command only gathers its input. It writes nothing and grants nothing: a card is still pressed
 * under the standing grant by the existing checks.
 */
/** The one card lifetime: a derived card may wait this long unpressed. It covers the successor step's replay and preflight timeouts. */
export const DERIVED_CARD_LIFETIME_MS = 40 * 60_000;
/** Most Actions one card pins (the pins validator's bound). */
export const DERIVED_CARD_MAX_ACTIONS = 12;
export const DERIVED_CARD_ID_PREFIX = "standing-start-";
export const DERIVED_PROVIDER = "claude-code-cli";
const SPEND_DECISION = "0130";
const INTEGRATION_DECISION = "0058";
const TRANSITIONS = ["validation", "acceptance", "pointer", "packet_approval"];
const REQUIRED_DECISIONS = ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162", "0163", "0170", "0173", "0181"];
const REQUIRED_FILES = [START_RUN_EXECUTOR_PATH, "src/sessions/tmuxLauncher.ts", "src/production/workerMerge.ts"];
/** The previous-press block has no free text: a derived cause is the press kind, its evidence a fixed pointer. */
const PREVIOUS_EVIDENCE = "docs/agent-guidance/production-24x7.md";

/** Why nothing was derived: one named reason, in the order the checks run. */
export type DeriveRefusal =
  | "GRANT_NOT_OPEN" | "PLAN_NOT_ACTIVE" | "PRODUCTION_NOT_INACTIVE" | "QUEUE_INVALID" | "NO_READY_ACTIONS" | "OPERATOR_ITEM_FIRST" | "FAILED_BATCH_NEEDS_FIX" | "CHAIN_REFUSED" | "CARD_INVALID";

export interface DerivePlanAction { id: string; status: string; dependsOn: string[]; criteriaErrors: string[]; decisions?: string[]; references?: string[] }
/** An Action the card stops before because it cites an unanswered Decision. */
export interface OperatorItem { action: string; reasons: string[] }
export interface DeriveInput {
  originMain: string;
  /** The wall clock; the card id and expiry use its minute only. */
  now: Date;
  executorSha256: string;
  workspace: string;
  workerLabel: string;
  gateCardId: string;
  offId: string;
  grant: { open: boolean; plan: string | null; approvalCard: string | null; approvalRun: string | null; reason: { code: string; message: string } | null };
  plan: { slug: string; project: string; status: string; isProjectActivePlan: boolean; actions: DerivePlanAction[] };
  production: { desiredState: string; liveAdmissions: number; revision: number; epoch: number };
  queue: { revision: number; orderValid: boolean; unpositionedCount: number; keys: string[] };
  /** The standing chain's reading of the production record: the receipt hashes, the attempt count and the latest press. */
  chain: { receiptSha256: string; pressSha256: string; attemptsSoFar: number; latest: { press: string; kind: DayGrantPressKind } | null };
  consumedHistory: Array<{ path: string; sha256: string }>;
  /** Ids of the Decisions answered on origin main; a cited Decision not in this list is open. */
  answeredDecisions?: string[];
  /** What was recorded for a failed latest press: the cause, the independent pre-mortem pointer and the merged fix. Without it a failed batch derives nothing. */
  failedBatchClearance?: FailedBatchClearance;
}
/** Recorded evidence that a failed batch may be followed by a card (Decisions 0181 and 0187): recorded, not machine-proved. */
export interface FailedBatchClearance {
  cause: string;
  /** The independent pre-mortem's pointer: an https URL or a repository-relative path. It becomes the card's `premortem`. */
  premortem: string;
  fix: { pullRequest: string; commit: string; reproduction: string };
}
/** Where a failed press's clearance is recorded, beside the card library: `clearances/<card>--<press run id>.json`. */
export const failedBatchClearancePath = (library: string, press: string): string => path.join(library, "clearances", `${press.replace("/", "--")}.json`);
export function parseFailedBatchClearance(text: string | null): FailedBatchClearance | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Partial<FailedBatchClearance>;
    const fix = value.fix as Partial<FailedBatchClearance["fix"]> | undefined;
    if (typeof value.cause !== "string" || typeof value.premortem !== "string" || !value.premortem.trim() || !fix || typeof fix.pullRequest !== "string" || typeof fix.commit !== "string" || typeof fix.reproduction !== "string") return null;
    return { cause: value.cause, premortem: value.premortem, fix: { pullRequest: fix.pullRequest, commit: fix.commit, reproduction: fix.reproduction } };
  } catch { return null; }
}
export interface DerivedCard {
  id: string;
  expiresAt: string;
  plan: string;
  actions: string[];
  /** The reviewed manifest's hashes: the card pair and the executor, which `reviewed/<id>.json` holds. */
  manifest: { sh: string; json: string; executor: string };
  /** The Action the card stopped before because it needs the operator, or null when the card ended for another reason. */
  operatorItem: OperatorItem | null;
  descriptor: Record<string, unknown>;
  launcher: string;
  /** The exact file bytes: `<id>.json`, `<id>.sh` and `reviewed/<id>.json`. */
  descriptorBytes: string;
  manifestBytes: string;
}
export type DeriveResult = { ok: true; card: DerivedCard } | { ok: false; reason: DeriveRefusal; message: string };

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
export const refuse = (reason: DeriveRefusal, message: string): DeriveResult => ({ ok: false, reason, message });
const minuteOf = (now: Date): number => Math.floor(now.getTime() / 60_000) * 60_000;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The first unfinished ready Actions of the Plan at the top of the queue, in queue order, stopping before the first that is not. */
export function deriveActions(project: string, planActions: DerivePlanAction[], queueKeys: string[], answeredDecisions: string[] = []): string[] {
  return deriveActionsAndOperatorItem(project, planActions, queueKeys, answeredDecisions).actions;
}

/** Which of the cited Decision ids are answered (frontmatter `status: approved` with an `answer`) among the Decision files on main. */
export function answeredDecisionIds(cited: string[], decisionPaths: string[], read: (file: string) => string): string[] {
  const answered: string[] = [];
  for (const id of new Set(cited)) {
    const file = decisionPaths.find((entry) => new RegExp(`^docs/decisions/${id}-[^/]+\\.md$`).test(entry));
    if (!file) continue;
    try {
      const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(file));
      const fields = match ? (parseYaml(match[1]) as Record<string, unknown> | null) : null;
      if (fields && fields.status === "approved" && typeof fields.answer === "string" && fields.answer.trim() !== "") answered.push(id);
    } catch { /* unreadable counts as open */ }
  }
  return answered;
}

/** Why an Action needs the operator: each unanswered Decision it cites. Authority paths its references name do not stop the card; the diff gate judges authority at merge time. */
export function operatorReasons(action: DerivePlanAction, answeredDecisions: string[]): string[] {
  const answered = new Set(answeredDecisions);
  const reasons = (action.decisions ?? []).filter((decision) => !answered.has(decision)).map((decision) => `cites unanswered Decision ${decision}`);
  return reasons;
}

/**
 * The same walk as `deriveActions`, which also stops before the first ready Action that needs the operator (an unanswered Decision
 * in its `decisions`) and returns it as the one operator item. Nothing is derived past it.
 */
export function deriveActionsAndOperatorItem(project: string, planActions: DerivePlanAction[], queueKeys: string[], answeredDecisions: string[]): { actions: string[]; operatorItem: OperatorItem | null } {
  const byId = new Map(planActions.map((action) => [action.id, action]));
  const ready = (action: DerivePlanAction): boolean =>
    !["done", "blocked", "deferred"].includes(action.status) && action.criteriaErrors.length === 0 &&
    action.dependsOn.every((dependency) => byId.get(dependency)?.status === "done");
  const picked: string[] = [];
  for (const key of queueKeys) {
    if (picked.length >= DERIVED_CARD_MAX_ACTIONS || !key.startsWith(`${project}/`)) break;
    const action = byId.get(key.slice(project.length + 1));
    if (!action || !ready(action)) break;
    const reasons = operatorReasons(action, answeredDecisions);
    if (reasons.length) return { actions: picked, operatorItem: { action: action.id, reasons } };
    picked.push(action.id);
  }
  return { actions: picked, operatorItem: null };
}

/** The previous-press block, read from the production record alone. A failed attempt needs a merged fix, which cannot be derived. */
function derivedPrevious(latest: DeriveInput["chain"]["latest"], clearance?: FailedBatchClearance): DayGrantPrevious | null | "needs-fix" {
  if (!latest) return null;
  if (latest.kind === "failed-attempt") {
    if (!clearance) return "needs-fix";
    return {
      press: latest.press, kind: latest.kind, cause: clearance.cause, evidence: clearance.premortem,
      clearance: { kind: "merged-fix", pullRequest: clearance.fix.pullRequest, commit: clearance.fix.commit, reproduction: clearance.fix.reproduction, cause: clearance.cause }
    };
  }
  return { press: latest.press, kind: latest.kind, cause: latest.kind, evidence: PREVIOUS_EVIDENCE, clearance: { kind: "observed-cleared", observation: PREVIOUS_EVIDENCE } };
}

export function deriveStartCard(input: DeriveInput): DeriveResult {
  const { grant, plan, production, queue, chain } = input;
  if (!grant.open || !grant.plan || !grant.approvalCard || !grant.approvalRun) return refuse("GRANT_NOT_OPEN", grant.reason ? `${grant.reason.code}: ${grant.reason.message}` : "no standing grant is open");
  if (plan.slug !== grant.plan || plan.status !== "active" || !plan.isProjectActivePlan) return refuse("PLAN_NOT_ACTIVE", `Plan ${grant.plan} is not the active Plan of the Project at origin main`);
  if (production.desiredState !== "inactive" || production.liveAdmissions !== 0) return refuse("PRODUCTION_NOT_INACTIVE", "production must be Inactive with zero live admissions");
  if (!queue.orderValid || queue.unpositionedCount !== 0) return refuse("QUEUE_INVALID", "the Action queue is invalid or has unpositioned Actions");
  const { actions, operatorItem } = deriveActionsAndOperatorItem(plan.project, plan.actions, queue.keys, input.answeredDecisions ?? []);
  if (!actions.length && operatorItem) return refuse("OPERATOR_ITEM_FIRST", `the first Action in the queue, ${operatorItem.action}, needs the operator (${operatorItem.reasons.join("; ")}); nothing is derived`);
  if (!actions.length) return refuse("NO_READY_ACTIONS", `the top of the queue holds no ready Action of Plan ${plan.slug}`);
  const previous = derivedPrevious(chain.latest, input.failedBatchClearance);
  if (previous === "needs-fix") return refuse("FAILED_BATCH_NEEDS_FIX", `the latest press ${chain.latest!.press} failed; a failed batch stops for a merged fix and an independent pre-mortem, which are not derived`);

  const minute = minuteOf(input.now);
  // The card id is a function of exactly these inputs.
  const id = DERIVED_CARD_ID_PREFIX + sha256(JSON.stringify([
    input.originMain, queue.revision, production.revision, production.epoch, grant.approvalCard, grant.approvalRun, chain.receiptSha256, chain.pressSha256, minute
  ])).slice(0, 16);
  const delegation: DayGrantDelegation = {
    decision: "0173", approvalCard: grant.approvalCard, approvalRun: grant.approvalRun, approvalReceiptSha256: chain.receiptSha256, approvalPressSha256: chain.pressSha256,
    attempt: chain.attemptsSoFar + 1, previous
  };
  const startRun: StartRunPins = {
    schema: "arcadia-start-run-v1", reviewedRevision: input.originMain, executorSha256: input.executorSha256, workspace: input.workspace, project: plan.project, plan: plan.slug, actions,
    provider: DERIVED_PROVIDER, transitions: [...TRANSITIONS], concurrency: 1, packetApprovalHours: 24,
    intent: `Unattended production run on ${plan.project}'s Plan ${plan.slug}: ${actions.length} pinned Action${actions.length === 1 ? "" : "s"} on the claude-code provider, each merged through its PR by the worker after exact-head independent review, under the operator's standing grant.`,
    spendDecision: SPEND_DECISION, integrationDecision: INTEGRATION_DECISION, requiredDecisions: [...REQUIRED_DECISIONS], requiredFiles: [...REQUIRED_FILES],
    production: { revision: production.revision, epoch: production.epoch }, queueRevision: queue.revision, workerLabel: input.workerLabel, gateCardId: input.gateCardId, offId: input.offId,
    grantedBy: `Rowan, pressing this START card from /actions within the operator's standing grant ${grant.approvalCard}/${grant.approvalRun}`,
    consumedHistory: input.consumedHistory.map((entry) => ({ ...entry })), delegation
  };
  try {
    validateStartRunPins(startRun);
    if (previous) validateDayGrantPrevious(previous);
  } catch (error) { return refuse("CARD_INVALID", error instanceof StartRunPinsError || error instanceof Error ? error.message : String(error)); }

  const expiresAt = iso(minute + DERIVED_CARD_LIFETIME_MS);
  const descriptor: Record<string, unknown> = {
    schema: "arcadia-operator-script-v1", id, kind: "grant", project: plan.project, title: `Start ${actions.length} Action${actions.length === 1 ? "" : "s"} of ${plan.slug} under the standing grant`,
    script: `${id}.sh`, repeatable: false, expires_at: expiresAt,
    problem: `Production is Off and the standing grant is open, with ${actions.length} ready Action${actions.length === 1 ? "" : "s"} at the top of the queue.`,
    desired_effect: `Fast-forward to ${input.originMain}, install and restart the worker, and start production on the ${actions.length} pinned Action${actions.length === 1 ? "" : "s"} at concurrency 1.`,
    authority: { does: ["Start one production run of the pinned Actions under the standing grant"], never_does: ["Widen the Plan, the Actions, the provider or the concurrency", "Spend beyond Decision 0130", "Merge outside the worker's exact-head review gate"] },
    success: { effect: "Production is Active on the pinned Actions.", next: "The batch runs to scope complete; the next card is derived from main." },
    failure: { effect: "Nothing starts and the allowance may stay unspent.", next: "Read the card's receipt; a refusal names its cause." },
    startRun
  };
  const launcher = startRunLauncher(id);
  const descriptorBytes = `${JSON.stringify(descriptor, null, 2)}\n`;
  const manifest = { sh: sha256(launcher), json: sha256(descriptorBytes), executor: input.executorSha256 };
  return { ok: true, card: { id, expiresAt, plan: plan.slug, actions, manifest, operatorItem, descriptor, launcher, descriptorBytes, manifestBytes: `${JSON.stringify(manifest, null, 2)}\n` } };
}

/** The refusal code of a press whose card on disk is not what the deriver returns for the current state. */
export const CARD_NOT_DERIVED = "CARD_NOT_DERIVED";
export interface CardOnDisk { descriptor: string | null; launcher: string | null; manifest: string | null }
export interface CardVerification { verified: boolean; code: typeof CARD_NOT_DERIVED | null; differs: string[]; derivedCardId: string | null }

const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner) =>
  inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : inner);
const differing = (derived: Record<string, unknown>, actual: Record<string, unknown>, prefix: string): string[] =>
  [...new Set([...Object.keys(derived), ...Object.keys(actual)])].sort().filter((key) => canonical(derived[key]) !== canonical(actual[key])).map((key) => `${prefix}${key}`);

/**
 * The reviewed manifest may carry one extra key, `premortem`: the pre-press check recorded after minting (the replay receipt's
 * pointer after a clean batch, the independent pre-mortem's after a failed one). Everything else must be the derived bytes.
 */
function manifestMatches(onDisk: string | null, derivedBytes: string): boolean {
  if (onDisk === null) return false;
  if (onDisk === derivedBytes) return true;
  try {
    const { premortem, ...rest } = JSON.parse(onDisk) as Record<string, unknown>;
    return typeof premortem === "string" && premortem.trim() !== "" && `${JSON.stringify(rest, null, 2)}\n` === derivedBytes;
  } catch { return false; }
}

/**
 * Compares the card on disk with a fresh derivation, byte for byte, and names each differing field: every descriptor key, every
 * `startRun` key (the delegation block among them), the launcher and the reviewed manifest. Pure; a card that is not a card at all
 * names `descriptor`.
 */
export function verifyDerivedCard(result: DeriveResult, onDisk: CardOnDisk): CardVerification {
  if (!result.ok) return { verified: false, code: CARD_NOT_DERIVED, differs: [`derivation (${result.reason}: ${result.message})`], derivedCardId: null };
  const { card } = result;
  const differs: string[] = [];
  let actual: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = onDisk.descriptor === null ? null : JSON.parse(onDisk.descriptor);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) actual = parsed as Record<string, unknown>;
  } catch { /* named below */ }
  if (!actual) differs.push("descriptor");
  else {
    const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
    const { startRun: derivedStart, ...derivedTop } = card.descriptor;
    const { startRun: actualStart, ...actualTop } = actual;
    differs.push(...differing(derivedTop, actualTop, ""), ...differing(derivedStart as Record<string, unknown>, isRecord(actualStart) ? actualStart : {}, "startRun."));
    if (!differs.length && onDisk.descriptor !== card.descriptorBytes) differs.push("descriptor.bytes");
  }
  if (onDisk.launcher !== card.launcher) differs.push("launcher");
  if (!manifestMatches(onDisk.manifest, card.manifestBytes)) differs.push("manifest");
  return { verified: differs.length === 0, code: differs.length ? CARD_NOT_DERIVED : null, differs, derivedCardId: card.id };
}
