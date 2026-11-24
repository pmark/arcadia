import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { START_RUN_EXECUTOR_PATH } from "../operatorActions/startRunPins.js";
import { inspectDayGrantChain, standingGrantStatus } from "../operatorActions/startRunDayGrant.js";
import { StartRunDelegationError } from "../operatorActions/startRunDelegation.js";
import { checkReplayReceipt, replayCardIdentity, replayReceiptPath, type ReplayCheck } from "../operatorActions/startRunReplayReceipt.js";
import { DERIVED_CARD_LIFETIME_MS, DERIVED_PROVIDER, answeredDecisionIds, failedBatchClearancePath, parseFailedBatchClearance, deriveStartCard, refuse, verifyDerivedCard, type CardVerification, type DeriveInput, type DeriveResult } from "../operatorActions/startRunDerive.js";
import { START_RUN_DEFAULTS, frontmatter, mainCheckout, originMainReads, realStartRunPinsDeps, startRunCriteriaFindings, type StartRunPinsDeps } from "./startRun.js";
import { createHash } from "node:crypto";

/** The options `start-run derive` accepts: where to read, never what to derive. */
export interface StartRunDeriveOptions { repository?: string; workspace?: string; library?: string; verifyCard?: string; currentPress?: string; json?: boolean; unknownArguments?: string[] }
export interface StartRunDeriveData {
  derived: boolean;
  /** The named reason nothing was derived, or null. */
  reason: string | null;
  message: string | null;
  card: Extract<DeriveResult, { ok: true }>["card"] | null;
  /** Only with `--verify-card`: the card on disk against this derivation (the press-time check of scripts/start-run.sh). */
  verification?: CardVerification;
  /** Only with `--verify-card`: the card's replay receipt, a prediction bound to this card (REPLAY_REQUIRED, REPLAY_MISMATCH, REPLAY_PREDICTS_NO_LAUNCH). */
  replay?: ReplayCheck;
  observations: { originMain: string | null; queueRevision: number | null; production: { revision: number; epoch: number } | null; latestPress: { press: string; kind: string } | null };
}

const text = (buffer: Buffer): string => buffer.toString("utf8");
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

/**
 * `arcadia start-run derive`: the whole standing-grant START card (descriptor, launcher, reviewed manifest) computed from origin
 * main, the governed queue, the production policy and the open standing-grant receipt. Read-only: it reads the library, the
 * workspace database and origin main. It first fetches origin main's objects (#2969), and writes no governed document, queue,
 * receipt or card and grants nothing. No option names the Plan, Actions, count, provider, concurrency, expiry, cause, Decision
 * or card id; an unknown option is refused by name.
 */
export function runStartRunDeriveCommand(options: StartRunDeriveOptions, deps: StartRunPinsDeps = realStartRunPinsDeps): CommandSuccess<StartRunDeriveData> {
  if (options.unknownArguments?.length) {
    throw validationError(`DERIVE_OPTION_REFUSED: start-run derive derives every field and accepts no ${options.unknownArguments.filter((arg) => arg.startsWith("-")).join(", ") || "argument"}; only --repository, --workspace, --library, --verify-card, --current-press and --json are read.`, { code: "DERIVE_OPTION_REFUSED" });
  }
  // Run mode only (scripts/start-run.sh): this card's own in-flight press, `<card>/<pressId>`, is not a previous press. It must be a
  // press of the card being verified; every other press still counts, so another unsettled press still refuses PREVIOUS_UNSETTLED.
  if (options.currentPress !== undefined) {
    const own = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(options.currentPress);
    if (!options.verifyCard || !own || own[1] !== path.basename(options.verifyCard).replace(/\.json$/, "")) {
      throw validationError("DERIVE_OPTION_REFUSED: --current-press <card>/<pressId> is read only with --verify-card and must name a press of that card.", { code: "DERIVE_OPTION_REFUSED" });
    }
  }
  let toplevel: string;
  try { toplevel = realpathSync(options.repository ?? text(deps.git(process.cwd(), ["rev-parse", "--show-toplevel"])).trim()); }
  catch { throw validationError("Run this inside the Arcadia repository or pass --repository."); }
  const originMain = text(deps.git(toplevel, ["ls-remote", "origin", "refs/heads/main"])).trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(originMain)) throw validationError("Origin main did not return a commit id.");
  const { show, tree } = originMainReads(toplevel, originMain, deps);
  const decisionFiles = tree("docs/decisions/");
  const standingDecision = { paths: decisionFiles, read: (file: string) => text(show(file)) };
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const library = options.library ?? path.join(mainCheckout(toplevel, deps), "artifacts", "generated", "operator-scripts");
  const now = deps.now();
  const evidence = (deps.dayEvidence ?? realStartRunPinsDeps.dayEvidence!)(workspacePath);
  // `--verify-card <descriptor>` names the card to compare, never a value to derive. The minute is the card's own, taken only when
  // it is a whole minute already reached: a later or unaligned expiry derives at the real clock and so differs in id and expires_at.
  const readOrNull = (file: string): string | null => { try { return readFileSync(file, "utf8"); } catch { return null; } };
  const cardOnDisk = options.verifyCard === undefined ? { descriptor: null, launcher: null, manifest: null } : {
    descriptor: readOrNull(options.verifyCard), launcher: readOrNull(options.verifyCard.replace(/\.json$/, ".sh")),
    manifest: readOrNull(path.join(path.dirname(options.verifyCard), "reviewed", path.basename(options.verifyCard)))
  };
  /** The replay receipt beside the card, held to the card's own bytes: its descriptor sha256, pinned revisions and every pinned Action. */
  const replayCheckOf = (descriptorFile: string, descriptor: string | null): ReplayCheck => {
    const bound = descriptor === null ? null : replayCardIdentity(descriptor);
    if (!bound) return { ok: false, code: "REPLAY_REQUIRED", detail: "the card is not a START card, so no replay receipt can name it" };
    return checkReplayReceipt(readOrNull(replayReceiptPath(path.dirname(descriptorFile), bound.card)), bound.identity);
  };
  let latestPress: { press: string; kind: string } | null = null;
  let deriveAt = now;
  if (cardOnDisk.descriptor !== null) {
    try {
      const expires = Date.parse(String((JSON.parse(cardOnDisk.descriptor) as { expires_at?: unknown }).expires_at));
      const minute = expires - DERIVED_CARD_LIFETIME_MS;
      if (Number.isFinite(expires) && minute % 60_000 === 0 && minute <= now.getTime()) deriveAt = new Date(minute);
    } catch { /* the descriptor is named as differing */ }
  }
  const done = (result: DeriveResult, queueRevision: number | null, production: { revision: number; epoch: number } | null): CommandSuccess<StartRunDeriveData> =>
    createSuccess({
      command: "start-run.derive", workspace: workspacePath,
      data: {
        derived: result.ok,
        ...(options.verifyCard === undefined ? {} : { verification: verifyDerivedCard(result, cardOnDisk), replay: replayCheckOf(options.verifyCard, cardOnDisk.descriptor) }), reason: result.ok ? null : result.reason, message: result.ok ? null : result.message, card: result.ok ? result.card : null,
        observations: { originMain, queueRevision, production, latestPress }
      },
      warnings: result.ok ? [] : [`${result.reason}: ${result.message}`]
    });

  const grant = standingGrantStatus({ library, now, evidence, offId: START_RUN_DEFAULTS.offId, standingDecision });
  if (!grant.open || !grant.plan || !grant.approvalCard || !grant.approvalRun) return done(refuse("GRANT_NOT_OPEN", grant.reason ? `${grant.reason.code}: ${grant.reason.message}` : "no standing grant is open"), null, null);

  const planFile = frontmatter(text(show(`docs/plans/${grant.plan}.md`)), `Plan ${grant.plan}`);
  const project = String(planFile.project ?? "");
  const planActions = (Array.isArray(planFile.actions) ? planFile.actions : []) as Array<{ id?: string; status?: string; depends_on?: unknown; next_action?: string; acceptance_criteria?: unknown[]; decisions?: unknown; references?: unknown }>;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
  const answeredDecisions = answeredDecisionIds(planActions.flatMap((action) => strings(action.decisions)), decisionFiles, (file) => text(show(file)));
  const production = deps.production(options.workspace);
  const queue = deps.queue(production.workspacePath);
  const productionPins = { revision: production.revision, epoch: production.epoch };

  let chain: ReturnType<typeof inspectDayGrantChain>;
  try {
    chain = inspectDayGrantChain({
      library, approvalCard: grant.approvalCard, approvalRun: grant.approvalRun, approvalReceiptSha256: null, approvalPressSha256: null, now, evidence,
      policyRevision: production.revision, excludePress: options.currentPress ?? null, grant: "standing", standingDecision,
      scope: { project, plan: grant.plan, provider: DERIVED_PROVIDER, concurrency: 1, spendDecision: START_RUN_DEFAULTS.spendDecision, offId: START_RUN_DEFAULTS.offId }
    });
  } catch (error) {
    if (!(error instanceof StartRunDelegationError)) throw error;
    return done(refuse("CHAIN_REFUSED", `${error.code}: ${error.message}`), queue.revision, productionPins);
  }

  latestPress = chain.latest;
  const labels = deps.launchctlList().split("\n").map((line) => line.trim().split(/\s+/).pop() ?? "").filter((label) => /^com\.arcadia\.local\.[A-Za-z0-9._-]+\.worker$/.test(label));
  if (labels.length !== 1) throw validationError(`Expected exactly one com.arcadia.local.*.worker launchd job, found ${labels.length}; no worker label was guessed.`);
  const entries = new Set(deps.listFiles(library));
  for (const card of [START_RUN_DEFAULTS.gateCardId, START_RUN_DEFAULTS.offId]) {
    if (!entries.has(`${card}.json`)) throw validationError(`Operator card ${card} is not in the library ${library}; nothing was derived.`);
  }
  for (const file of START_RUN_DEFAULTS.requiredFiles) show(file);
  const receipts = [
    ...deps.listFiles(library).filter((file) => file.endsWith(".consumed.json")).map((file) => path.join(library, file)),
    ...deps.listFiles(path.join(library, "runs", "markers")).filter((file) => file.endsWith(".consumed")).map((file) => path.join(library, "runs", "markers", file))
  ].sort();

  const input: DeriveInput = {
    originMain, now: deriveAt, executorSha256: sha256(show(START_RUN_EXECUTOR_PATH)), workspace: path.basename(production.workspacePath), workerLabel: labels[0],
    gateCardId: START_RUN_DEFAULTS.gateCardId, offId: START_RUN_DEFAULTS.offId, grant,
    plan: {
      slug: grant.plan, project, status: String(planFile.status ?? ""),
      isProjectActivePlan: frontmatter(text(show("PROJECT.md")), "PROJECT.md").active_plan === grant.plan,
      actions: planActions.filter((action): action is { id: string } & typeof action => typeof action.id === "string").map((action) => ({
        id: action.id, status: String(action.status ?? ""), dependsOn: Array.isArray(action.depends_on) ? action.depends_on.map(String) : [],
        criteriaErrors: startRunCriteriaFindings(action).errors, decisions: strings(action.decisions), references: strings(action.references)
      }))
    },
    answeredDecisions,
    ...(chain.latest?.kind === "failed-attempt" ? (() => {
      const failedBatchClearance = parseFailedBatchClearance(readOrNull(failedBatchClearancePath(library, chain.latest.press)));
      return failedBatchClearance ? { failedBatchClearance } : {};
    })() : {}),
    production: { desiredState: production.desiredState, liveAdmissions: production.liveAdmissions, ...productionPins },
    queue: { revision: queue.revision, orderValid: queue.orderValid, unpositionedCount: queue.unpositionedCount, keys: queue.ordered.map((entry) => entry.orderKey ?? "") },
    chain: { receiptSha256: chain.window.receiptSha256, pressSha256: chain.window.pressSha256, attemptsSoFar: chain.attemptsSoFar, latest: chain.latest },
    consumedHistory: receipts.map((file) => ({ path: file, sha256: deps.sha256File(file) }))
  };
  return done(deriveStartCard(input), queue.revision, productionPins);
}
