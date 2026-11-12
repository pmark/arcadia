import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { buildAgentQueue } from "../dispatch/queue.js";
import { START_RUN_EXECUTOR_PATH, StartRunPinsError, validateStartRunPins, type StartRunPins } from "../operatorActions/startRunPins.js";
import { inspectDelegationChain, type StartRunDelegation } from "../operatorActions/startRunDelegation.js";
import { ATTEMPT_COUNT_EARLIEST, CONTINUE_ANSWER, DAY_GRANT_EXECUTOR_PATH, findContinueDecision, inspectDayGrantChain, validateDayGrantPins, validateDayGrantPrevious, type DayEvidence, type DayGrantClearance, type DayGrantDelegation, type DayGrantPins, type DayGrantPrevious } from "../operatorActions/startRunDayGrant.js";
import { controllerIdentityDefaults } from "../git/askIsolation.js";
import { runClaudeCliHeadless } from "../production/capacityPreAdmission.js";
import { readDayGrantEvidence } from "../production/policy.js";
import { namedTestFiles } from "../sessions/completionValidation.js";
import { runStartRunSignIn, staticSignInChecks, StartRunSignInRefusal, type StartRunSignInDeps, type StartRunSignInResult, type StaticSignInState } from "../production/startRunSignIn.js";
import { defaultRunWindowDeps, holdStartCard, type StartCardHold } from "../workMonitoring/runWindow.js";
import { runProductionStatusCommand } from "./production.js";
import { resolveOperatorGate } from "../ask/operatorGate.js";

/**
 * `arcadia start-run pins`: compute the pins of one per-run START card from live, read-only state and print them.
 * It writes nothing, emits no bash and no manifest, and grants nothing: the printed block is reviewed (a mechanical
 * pin diff plus an independent critic check) before anyone publishes it in a descriptor next to the thin launcher.
 */
export const START_RUN_DEFAULTS = {
  provider: "claude-code-cli",
  transitions: ["validation", "acceptance", "pointer", "packet_approval"],
  packetApprovalHours: 24,
  /** Decision 0130 spend ceiling, 0058 candidate integration, 0097 worker PR merge, 0134 amendment, 0156 install, 0157 Plan activation, 0141/0143/0161/0162 the in-card sign-in renewal and bound-worker check (0162: no calendar-day ceiling) (a card is always pressed by the operator, so no delegation receipt is pinned). */
  spendDecision: "0130",
  integrationDecision: "0058",
  requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162"],
  requiredFiles: [START_RUN_EXECUTOR_PATH, "src/sessions/tmuxLauncher.ts", "src/production/workerMerge.ts"],
  gateCardId: "enable-capacity-gate-20261017",
  offId: "restore-off-production-bug-plan-first-supervised-run-2026-10-11"
} as const;

export interface StartRunPinsOptions {
  plan: string;
  actions: string;
  provider: string;
  expiresHours: string | number;
  /** Decision 0163: `<card>/<run>` of the operator's originating press; emits the delegation block for Rowan's successor card. */
  delegatedFrom?: string;
  /** Decision 0173: `<card>/<run>` of the operator's day approval; emits the delegation block for Rowan's START card. */
  dayGrantFrom?: string;
  /** Decision 0173: Rowan's named cause of the latest START press, with its evidence pointer and how it was cleared. */
  previousCause?: string;
  previousEvidence?: string;
  fixPullRequest?: string;
  fixCommit?: string;
  reproduction?: string;
  /** Decision 0187: the cause the merged fix addresses; required, and equal to --previous-cause, after a failed batch. */
  fixCause?: string;
  observedCleared?: string;
  repository?: string;
  workspace?: string;
}
export interface StartRunPinsData {
  startRun: StartRunPins;
  expires_at: string;
  observations: {
    repository: string;
    originMain: string;
    planStatus: string;
    queueTop: string[];
    workerLabel: string;
    notes: string[];
  };
}
/** Everything the emitter reads from the world; tests replace it with fakes. */
export interface StartRunPinsDeps {
  git(repository: string, args: string[]): Buffer;
  now(): Date;
  launchctlList(): string;
  production(workspace: string | undefined): { workspacePath: string; desiredState: string; revision: number; epoch: number; liveAdmissions: number };
  queue(workspacePath: string): { revision: number; orderValid: boolean; unpositionedCount: number; ordered: Array<{ orderKey?: string | null }> };
  listFiles(directory: string): string[];
  sha256File(file: string): string;
  /** Read-only verification of a Decision 0163 delegation chain in the library (fixtures replace it). */
  inspectDelegation?: typeof inspectDelegationChain;
  /** Decision 0173's production record, from the workspace database (fixtures replace it). */
  dayEvidence?: (workspacePath: string) => DayEvidence;
}

export const realStartRunPinsDeps: StartRunPinsDeps = {
  git: (repository, args) => execFileSync("git", args, { cwd: repository, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }),
  now: () => new Date(),
  launchctlList: () => execFileSync("launchctl", ["list"], { encoding: "utf8", timeout: 10_000 }),
  production: (workspace) => {
    const { workspacePath } = resolveReadyWorkspace(workspace);
    const data = runProductionStatusCommand({ workspace: workspacePath }).data;
    if (data.read.status !== "ok") throw validationError("Production status is unreadable; no pins were computed.");
    return { workspacePath, desiredState: data.read.policy.desiredState, revision: data.read.policy.revision, epoch: data.read.policy.epoch, liveAdmissions: data.liveAdmissions };
  },
  queue: (workspacePath) => withReadOnlyDatabase(workspacePath, (db) => buildAgentQueue(db)),
  dayEvidence: (workspacePath) => withReadOnlyDatabase(workspacePath, (db) => readDayGrantEvidence(db, ATTEMPT_COUNT_EARLIEST)),
  listFiles: (directory) => { try { return readdirSync(directory); } catch { return []; } },
  sha256File: (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
};

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Decision 0173's option A, from its frontmatter: options B and C grant less, and its body may quote any option. */
const isDayGrantAnswered = (content: string): boolean => {
  const fields = frontmatter(content, "Decision 0173");
  return fields.status === "approved" && typeof fields.answer === "string" && fields.answer.startsWith("A. Daily grant");
};
/** Decision 0181's option A, from its frontmatter: the re-decision that replaced Decision 0170's three-attempt limit. */
const isSerialRunsAnswered = (content: string): boolean => {
  const fields = frontmatter(content, "Decision 0181");
  return fields.status === "approved" && typeof fields.answer === "string" && fields.answer.startsWith("A. Continued serial runs");
};
/**
 * The continue-after-fix Decision's option A (Decision 0187 when written, found by its slug), from its frontmatter: a failed
 * batch is continued past only once this answer is on main. `id` is the number in the record's file name.
 */
const isContinueAnswered = (content: string, id: string): boolean => {
  const fields = frontmatter(content, `Decision ${id}`);
  return String(fields.id) === id && fields.status === "approved" && typeof fields.answer === "string" && fields.answer.startsWith(CONTINUE_ANSWER);
};
const text = (buffer: Buffer): string => buffer.toString("utf8");
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
function frontmatter(content: string, label: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) throw validationError(`${label} has no frontmatter.`);
  return parseYaml(match[1]) as Record<string, unknown>;
}

interface StartRunPlanAction {
  id?: string;
  status?: string;
  next_action?: string;
  acceptance_criteria?: unknown[];
}

/** Check the text the pinned Action will hand to completion validation. */
export function startRunCriteriaFindings(action: StartRunPlanAction): { errors: string[]; warnings: string[] } {
  const criteria = Array.isArray(action.acceptance_criteria) ? action.acceptance_criteria : [];
  const errors: string[] = [];
  const checkText = (label: string, value: unknown): void => {
    if (typeof value !== "string") return;
    const invisible = value.match(/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu) ?? [];
    const codes = [...new Set(invisible)].map((char) => `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    if (codes.length) errors.push(`${label} contains invisible characters (${codes.join(", ")}); spell out the escape.`);
  };
  checkText("next_action", action.next_action);
  const textCriteria = criteria.filter((criterion): criterion is string => typeof criterion === "string");
  const required = namedTestFiles(textCriteria);
  criteria.forEach((criterion, index) => checkText(`acceptance_criteria[${index + 1}]`, criterion));
  const withoutExamples = namedTestFiles(textCriteria.map((criterion) => {
    // Mask quoted arguments in direct assertions and explicitly labelled data.
    // Keep command text intact, even when a command contains function calls.
    return criterion
      .replace(/(\b(?:asserts?|expects?)\s+(?:that\s+)?`?[\w$.]+\()([^()\r\n]*)(\))/gi,
        (_match, start: string, args: string, end: string) => start + args.replace(/(^\s*|,\s*)(["'`])([^\s"'`]+)\2(?=\s*(?:,|$))/g, "$1example-value") + end)
      .replace(/(\b(?:asserts?|expects?)\s+[^"'`\r\n]*?\breturns?\s+|\bexample\s+(?:path|input|value|string)\s*:\s*)(["'`])([^\s"'`]+)\2/gi, "$1example-value");
  }));
  // An assertion can intentionally refer to a real file. Let the operator
  // clarify ambiguous paths without blocking an otherwise valid card.
  const warnings = required.filter((file) => !withoutExamples.includes(file))
    .map((file) => `acceptance_criteria would require ${file} as a test file; clarify if it is example data.`);
  return { errors, warnings };
}

/** The main checkout of the repository (ignored host files such as consumed markers live there, not in a worktree). */
function mainCheckout(repository: string, deps: StartRunPinsDeps): string {
  try {
    const common = text(deps.git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    return path.basename(common) === ".git" ? path.dirname(common) : repository;
  } catch { return repository; }
}

export function buildStartRunPins(options: StartRunPinsOptions, deps: StartRunPinsDeps = realStartRunPinsDeps): StartRunPinsData {
  const plan = options.plan;
  if (!slug.test(plan)) throw validationError("--plan must be a Plan slug.");
  const actions = options.actions.split(",").map((a) => a.trim()).filter(Boolean);
  if (!actions.length || !actions.every((a) => slug.test(a)) || new Set(actions).size !== actions.length) throw validationError("--actions needs distinct Action slugs separated by commas, in queue order.");
  if (options.provider !== START_RUN_DEFAULTS.provider) throw validationError(`--provider must be ${START_RUN_DEFAULTS.provider}; the START executor binds that provider's worker heartbeat.`);
  const hours = Number(options.expiresHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw validationError("--expires-hours must be greater than 0 and at most 24.");
  const notes: string[] = [];

  let toplevel: string;
  try { toplevel = realpathSync(options.repository ?? text(deps.git(process.cwd(), ["rev-parse", "--show-toplevel"])).trim()); }
  catch { throw validationError("Run this inside the Arcadia repository or pass --repository."); }

  // The pin: live origin main, which must also be known locally so the card can fast-forward to it.
  let originMain: string;
  try { originMain = text(deps.git(toplevel, ["ls-remote", "origin", "refs/heads/main"])).trim().split(/\s+/)[0] ?? ""; }
  catch { throw validationError("Origin main could not be observed (git ls-remote origin refs/heads/main failed)."); }
  if (!/^[0-9a-f]{40}$/.test(originMain)) throw validationError("Origin main did not return a commit id.");
  const show = (file: string): Buffer => {
    try { return deps.git(toplevel, ["show", `${originMain}:${file}`]); }
    catch { throw validationError(`${file} is not readable at origin main ${originMain}; fetch origin (git fetch origin main) or merge it first.`); }
  };
  const executorSha256 = sha256(show(START_RUN_EXECUTOR_PATH));

  const planFrontmatter = frontmatter(text(show(`docs/plans/${plan}.md`)), `Plan ${plan}`);
  const project = String(planFrontmatter.project ?? "");
  if (!slug.test(project)) throw validationError(`Plan ${plan} does not name its Project.`);
  const planStatus = String(planFrontmatter.status ?? "");
  if (planStatus !== "active" && planStatus !== "draft") throw validationError(`Plan ${plan} is ${planStatus || "of unknown status"}; a START card needs an active Plan or a draft with a pinned activation.`);
  const planActions = (Array.isArray(planFrontmatter.actions) ? planFrontmatter.actions : []) as StartRunPlanAction[];
  const criteriaErrors: string[] = [];
  const criteriaWarnings: string[] = [];
  for (const action of actions) {
    const found = planActions.find((entry) => entry.id === action);
    if (!found) throw validationError(`Action ${action} is not in Plan ${plan} at origin main.`);
    if (found.status === "done") throw validationError(`Action ${action} is already done; a START card pins only open Actions.`);
    const { errors, warnings } = startRunCriteriaFindings(found);
    criteriaErrors.push(...errors.map((finding) => `${action}: ${finding}`));
    criteriaWarnings.push(...warnings.map((finding) => `${action}: ${finding}`));
  }
  if (criteriaErrors.length) throw validationError(`START criteria preflight failed:\n${[...criteriaErrors, ...criteriaWarnings].join("\n")}`);
  notes.push(...criteriaWarnings);
  if (planStatus === "draft") notes.push("The Plan is a draft: embed its pinned planActivation block in the descriptor (Decision 0157) before review.");

  let delegatedFrom: { card: string; run: string } | null = null;
  if (options.delegatedFrom !== undefined) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/([0-9]{8}T[0-9]{6}Z-[0-9]+)$/.exec(options.delegatedFrom);
    if (!match) throw validationError("--delegated-from must be <card id>/<executor run id> of the operator's originating press.");
    delegatedFrom = { card: match[1], run: match[2] };
  }
  let dayGrantFrom: { card: string; run: string } | null = null;
  if (options.dayGrantFrom !== undefined) {
    if (delegatedFrom) throw validationError("--day-grant-from and --delegated-from are separate chains; name one.");
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/([0-9]{8}T[0-9]{6}Z-[0-9]+)$/.exec(options.dayGrantFrom);
    if (!match) throw validationError("--day-grant-from must be <card id>/<executor run id> of the operator's day approval.");
    dayGrantFrom = { card: match[1], run: match[2] };
    // Decision 0173: on the active Plan only; a draft Plan's pinned activation is not part of this grant.
    if (planStatus !== "active") throw validationError(`Plan ${plan} is ${planStatus}; a Decision 0173 card needs the active Plan.`);
    const pointer = frontmatter(text(show("PROJECT.md")), "PROJECT.md").active_plan;
    if (pointer !== plan) throw validationError(`Plan ${plan} is not the Project's active Plan (${String(pointer)}); a Decision 0173 card needs the active Plan.`);
  }
  const requiredDecisions: string[] = [...START_RUN_DEFAULTS.requiredDecisions, ...(delegatedFrom ? ["0163"] : []), ...(dayGrantFrom ? ["0163", "0170", "0173", "0181"] : [])];
  const decisionFiles = text(deps.git(toplevel, ["ls-tree", "--name-only", originMain, "docs/decisions/"])).split("\n");
  for (const decision of requiredDecisions) {
    const file = decisionFiles.find((entry) => new RegExp(`^docs/decisions/${decision}-.*\\.md$`).test(entry));
    if (!file) throw validationError(`Decision ${decision} is not in docs/decisions at origin main.`);
    const content = text(show(file));
    if (!/^status: approved$/m.test(content) || !/^answer: .+/m.test(content)) throw validationError(`Decision ${decision} is not approved with a recorded answer at origin main.`);
    if (decision === "0173" && !isDayGrantAnswered(content)) throw validationError("Decision 0173 is not answered with option A at origin main.");
    if (decision === "0181" && !isSerialRunsAnswered(content)) throw validationError("Decision 0181 is not answered with option A at origin main; the day-grant gate implements only that answer.");
  }
  for (const file of START_RUN_DEFAULTS.requiredFiles) show(file);

  const production = deps.production(options.workspace);
  if (production.desiredState !== "inactive" || production.liveAdmissions !== 0) throw validationError("Production must be Inactive with zero live admissions to prepare a START card.");
  const queue = deps.queue(production.workspacePath);
  if (!queue.orderValid || queue.unpositionedCount !== 0) throw validationError("The Action queue is invalid or has unpositioned Actions.");
  const queueTop = queue.ordered.slice(0, actions.length).map((entry) => entry.orderKey ?? "");
  if (planStatus === "active" && queueTop.join("\n") !== actions.map((a) => `${project}/${a}`).join("\n")) {
    throw validationError(`The top ${actions.length} queue entries are not the pinned Actions in order: ${queueTop.join(", ") || "(empty)"}.`);
  }
  if (planStatus === "draft") notes.push("Queue revision is the pre-activation revision; the executor requires the pinned Actions at the top only after the Plan is activated.");

  const labels = deps.launchctlList().split("\n").map((line) => line.trim().split(/\s+/).pop() ?? "").filter((label) => /^com\.arcadia\.local\.[A-Za-z0-9._-]+\.worker$/.test(label));
  if (labels.length !== 1) throw validationError(`Expected exactly one com.arcadia.local.*.worker launchd job, found ${labels.length}; no worker label was guessed.`);

  const main = mainCheckout(toplevel, deps);
  const library = path.join(main, "artifacts", "generated", "operator-scripts");
  let delegation: StartRunDelegation | DayGrantDelegation | undefined;
  if (delegatedFrom) {
    try {
      const chain = (deps.inspectDelegation ?? inspectDelegationChain)(library, delegatedFrom.card, delegatedFrom.run, null, deps.now(), null, production.revision);
      delegation = { decision: "0163", originatingCard: delegatedFrom.card, originatingRun: delegatedFrom.run, originatingReceiptSha256: chain.receiptSha256, attempt: chain.attemptsSoFar + 1 };
      notes.push(`Decision 0163 delegated successor: attempt ${delegation.attempt} of at most 5 after ${chain.latest.card}/${chain.latest.run} (${chain.trigger}); the operator's press at ${chain.originatingStartedAt} is the one activation touch.`);
    } catch (error) {
      throw validationError(`No delegated successor may be pinned: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (dayGrantFrom) {
    const named = namedDayGrantCause(options);
    if (named?.clearance.kind === "merged-fix") {
      try { deps.git(toplevel, ["merge-base", "--is-ancestor", named.clearance.commit, originMain]); }
      catch { throw validationError(`The fix commit ${named.clearance.commit} is not on origin main ${originMain}; a retry waits for the merged pull request.`); }
      show(named.clearance.reproduction);
    }
    const input = {
      library, approvalCard: dayGrantFrom.card, approvalRun: dayGrantFrom.run, approvalReceiptSha256: null, approvalPressSha256: null, now: deps.now(), policyRevision: production.revision, excludePress: null,
      evidence: (deps.dayEvidence ?? realStartRunPinsDeps.dayEvidence!)(production.workspacePath),
      scope: { project, plan, provider: options.provider, concurrency: 1, spendDecision: START_RUN_DEFAULTS.spendDecision, offId: START_RUN_DEFAULTS.offId }
    };
    try {
      // The press and its kind come from the record; only the cause, its evidence and its clearance are Rowan's words.
      const { latest } = inspectDayGrantChain(input);
      if (named && !latest) throw validationError("A cause was named, but no START press has happened since Decision 0170.");
      const previous: DayGrantPrevious | null = named && latest ? validateDayGrantPrevious({ ...latest, ...named }) : null;
      const chain = inspectDayGrantChain({ ...input, previous });
      // The continue-after-fix Decision: going on past a failed batch needs its answer on main, and each fix merged after its
      // batch ended. Found by its slug alone: numbers are minted by every START sign-in and raced for twice.
      if (chain.clearedFailures.length > 0) {
        const found = findContinueDecision(decisionFiles);
        if ("problem" in found) throw validationError(`FAILED_BATCH: the continue-after-fix Decision cannot be read at origin main: ${found.problem}; a failed batch still stops for the operator (Decision 0181).`);
        if (!isContinueAnswered(text(show(found.file)), found.id)) throw validationError(`FAILED_BATCH: Decision ${found.id} (${found.file}) is not answered with option A at origin main, so a failed batch still stops for the operator (Decision 0181).`);
        for (const cleared of chain.clearedFailures) {
          try { deps.git(toplevel, ["merge-base", "--is-ancestor", cleared.commit, originMain]); }
          catch { throw validationError(`FAILED_BATCH: the fix commit ${cleared.commit} named for the failed batch ${cleared.batch} is not on origin main ${originMain}.`); }
          show(cleared.reproduction);
          const committedAt = Number(text(deps.git(toplevel, ["show", "-s", "--format=%ct", cleared.commit])).trim()) * 1000;
          if (!Number.isFinite(committedAt) || committedAt <= Date.parse(cleared.endedAt)) throw validationError(`FAILED_BATCH: the fix commit ${cleared.commit} is dated before the failed batch ${cleared.batch} ended at ${cleared.endedAt}; the continue-after-fix Decision goes on only after a fix merged after the failure.`);
        }
        notes.push(`Continue-after-fix Decision: this card goes on past ${chain.clearedFailures.length} failed batch${chain.clearedFailures.length === 1 ? "" : "es"} in this day, each cleared by a fix merged after it: ${chain.clearedFailures.map((c) => `${c.batch} (${c.cause}, ${c.commit.slice(0, 12)})`).join(", ")}. The fix's review and checks are Rowan's recorded judgement, not machine-proved.`);
      }
      delegation = {
        decision: "0173", approvalCard: dayGrantFrom.card, approvalRun: dayGrantFrom.run, approvalReceiptSha256: chain.window.receiptSha256, approvalPressSha256: chain.window.pressSha256,
        attempt: chain.attemptsSoFar + 1, previous
      };
      notes.push(`Decision 0173 card: the day approved at ${chain.window.opensAt} ends at ${chain.window.closesAt}; attempt ${delegation.attempt} (numbered since Decision 0170, no longer capped) if it admits a Session; ${chain.failedBatchesToday} failed batches in this day, each one cleared by a merged fix for its cause (Decision 0187) or the card is refused; ${chain.rePressesToday} of at most 2 refused re-presses used in this day. Rowan's named cause is recorded, not machine-proved.`);
    } catch (error) {
      throw validationError(`No Decision 0173 card may be pinned: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // N6: the gate and STOP cards the handoffs and refusals name must exist in the library.
  const entries = new Set(deps.listFiles(library));
  for (const card of [START_RUN_DEFAULTS.gateCardId, START_RUN_DEFAULTS.offId]) {
    if (!entries.has(`${card}.json`)) throw validationError(`Operator card ${card} is not in the library ${library}; no pins were computed.`);
  }
  const receipts = [
    ...deps.listFiles(library).filter((file) => file.endsWith(".consumed.json")).map((file) => path.join(library, file)),
    ...deps.listFiles(path.join(library, "runs", "markers")).filter((file) => file.endsWith(".consumed")).map((file) => path.join(library, "runs", "markers", file))
  ].sort();
  const expiresAt = new Date(deps.now().getTime() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const startRun: StartRunPins = {
    schema: "arcadia-start-run-v1",
    reviewedRevision: originMain,
    executorSha256,
    workspace: path.basename(production.workspacePath),
    project,
    plan,
    actions,
    provider: "claude-code-cli",
    transitions: [...START_RUN_DEFAULTS.transitions],
    concurrency: 1,
    packetApprovalHours: START_RUN_DEFAULTS.packetApprovalHours,
    intent: `Unattended production run on ${project}'s Plan ${plan}: ${actions.length} pinned Action${actions.length === 1 ? "" : "s"} on the claude-code provider, each merged through its PR by the worker after exact-head independent review, with operator touches limited to activation and authority-adjacent merges.`,
    spendDecision: START_RUN_DEFAULTS.spendDecision,
    integrationDecision: START_RUN_DEFAULTS.integrationDecision,
    requiredDecisions,
    requiredFiles: [...START_RUN_DEFAULTS.requiredFiles],
    production: { revision: production.revision, epoch: production.epoch },
    queueRevision: queue.revision,
    workerLabel: labels[0],
    gateCardId: START_RUN_DEFAULTS.gateCardId,
    offId: START_RUN_DEFAULTS.offId,
    grantedBy: delegation?.decision === "0173"
      ? `Rowan, pressing this START card from /actions under Decision 0173, within the operator's day approval ${delegation.approvalCard}/${delegation.approvalRun}`
      : delegation
      ? `Rowan, pressing this successor START card from /actions under Decision 0163, delegated from the operator's originating press ${delegation.originatingCard}/${delegation.originatingRun}`
      : "P. Mark Anderson, by pressing this per-run START card from /actions under Decisions 0156 and 0157",
    consumedHistory: receipts.map((file) => ({ path: file, sha256: deps.sha256File(file) })),
    ...(delegation ? { delegation } : {})
  };
  try { validateStartRunPins(startRun); }
  catch (error) { throw validationError(error instanceof StartRunPinsError ? error.message : String(error)); }
  return { startRun, expires_at: expiresAt, observations: { repository: toplevel, originMain, planStatus, queueTop, workerLabel: labels[0], notes } };
}

/** Rowan's named cause, from the flags; null when none was named (the chain refuses when one is needed). */
function namedDayGrantCause(options: StartRunPinsOptions): Pick<DayGrantPrevious, "cause" | "evidence" | "clearance"> | null {
  const fix = [options.fixPullRequest, options.fixCommit, options.reproduction];
  if (![options.previousCause, options.previousEvidence, options.observedCleared, options.fixCause, ...fix].some((value) => value !== undefined)) return null;
  if (options.fixCause !== undefined && fix.some((value) => value === undefined)) throw validationError("--fix-cause names the cause of a merged fix: it needs --fix-pull-request, --fix-commit and --reproduction.");
  if (fix.some((value) => value !== undefined) && options.observedCleared !== undefined) throw validationError("Name a merged fix or an observed clearance, not both.");
  if (options.previousCause === undefined || options.previousEvidence === undefined) throw validationError("A named cause needs both --previous-cause and --previous-evidence.");
  if (fix.some((value) => value !== undefined) && fix.some((value) => value === undefined)) throw validationError("A merged fix needs --fix-pull-request, --fix-commit and --reproduction together.");
  if (options.observedCleared === undefined && fix.every((value) => value === undefined)) throw validationError("A named cause needs how it was cleared: --observed-cleared, or --fix-pull-request, --fix-commit and --reproduction.");
  const clearance: DayGrantClearance = options.observedCleared !== undefined
    ? { kind: "observed-cleared", observation: options.observedCleared }
    : { kind: "merged-fix", pullRequest: String(options.fixPullRequest), commit: String(options.fixCommit), reproduction: String(options.reproduction), ...(options.fixCause !== undefined ? { cause: options.fixCause } : {}) };
  return { cause: options.previousCause, evidence: options.previousEvidence, clearance };
}

export function runStartRunPinsCommand(options: StartRunPinsOptions, deps: StartRunPinsDeps = realStartRunPinsDeps): CommandSuccess<StartRunPinsData> {
  const data = buildStartRunPins(options, deps);
  return createSuccess({ command: "start-run.pins", data, warnings: data.observations.notes });
}

export interface StartRunDayPinsOptions { plan: string; expiresHours: string | number; repository?: string; workspace?: string }
export interface StartRunDayPinsData { dayGrant: DayGrantPins; expires_at: string }

/**
 * `arcadia start-run day-pins`: the pins of one day-grant card, for the operator to press. It writes nothing and grants
 * nothing: Rowan may prepare the card, and only the operator's press on /actions opens the day.
 */
export function buildStartRunDayPins(options: StartRunDayPinsOptions, deps: StartRunPinsDeps = realStartRunPinsDeps): StartRunDayPinsData {
  if (!slug.test(options.plan)) throw validationError("--plan must be a Plan slug.");
  const hours = Number(options.expiresHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw validationError("--expires-hours must be greater than 0 and at most 24.");
  let toplevel: string;
  try { toplevel = realpathSync(options.repository ?? text(deps.git(process.cwd(), ["rev-parse", "--show-toplevel"])).trim()); }
  catch { throw validationError("Run this inside the Arcadia repository or pass --repository."); }
  const originMain = text(deps.git(toplevel, ["ls-remote", "origin", "refs/heads/main"])).trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(originMain)) throw validationError("Origin main did not return a commit id.");
  const show = (file: string): Buffer => {
    try { return deps.git(toplevel, ["show", `${originMain}:${file}`]); }
    catch { throw validationError(`${file} is not readable at origin main ${originMain}; fetch origin (git fetch origin main) or merge it first.`); }
  };
  const decisionFile = text(deps.git(toplevel, ["ls-tree", "--name-only", originMain, "docs/decisions/"])).split("\n").find((entry) => /^docs\/decisions\/0173-.*\.md$/.test(entry));
  if (!decisionFile) throw validationError("Decision 0173 is not in docs/decisions at origin main.");
  const content = text(show(decisionFile));
  if (!isDayGrantAnswered(content)) throw validationError("Decision 0173 is not approved with option A at origin main.");
  const plan = frontmatter(text(show(`docs/plans/${options.plan}.md`)), `Plan ${options.plan}`);
  const project = String(plan.project ?? "");
  if (plan.status !== "active" || frontmatter(text(show("PROJECT.md")), "PROJECT.md").active_plan !== options.plan) throw validationError(`Plan ${options.plan} is not the Project's active Plan at origin main.`);
  const dayGrant = validateDayGrantPins({
    schema: "arcadia-day-grant-v1", decision: "0173", executorSha256: sha256(show(DAY_GRANT_EXECUTOR_PATH)), project, plan: options.plan,
    provider: START_RUN_DEFAULTS.provider, concurrency: 1, spendDecision: START_RUN_DEFAULTS.spendDecision
  });
  return { dayGrant, expires_at: new Date(deps.now().getTime() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z") };
}

export function runStartRunDayPinsCommand(options: StartRunDayPinsOptions, deps: StartRunPinsDeps = realStartRunPinsDeps): CommandSuccess<StartRunDayPinsData> {
  return createSuccess({ command: "start-run.day-pins", data: buildStartRunDayPins(options, deps) });
}

/** `arcadia start-run day-evidence`: Decision 0173's read-only production record, which the START executor reads in P0. */
export function runStartRunDayEvidenceCommand(options: { workspace?: string }): CommandSuccess<DayEvidence> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({ command: "start-run.day-evidence", workspace: workspacePath, data: withReadOnlyDatabase(workspacePath, (db) => readDayGrantEvidence(db, ATTEMPT_COUNT_EARLIEST)) });
}

export interface StartRunHoldOptions { card: string; reason: string; evidence: string; by?: string; repository?: string; library?: string }

/**
 * `arcadia start-run hold`: write `<library>/<card>.held.json` so the run window reports a waiting START card as held
 * instead of as opening the window. It writes only that marker, never the card's own files, and grants nothing.
 */
export function runStartRunHoldCommand(options: StartRunHoldOptions, now: Date = new Date()): CommandSuccess<StartCardHold> {
  const repository = options.repository ?? process.cwd();
  const library = options.library ?? defaultRunWindowDeps(repository).libraryDir();
  const hold = holdStartCard(library, options.card, { reason: options.reason, evidence: options.evidence, heldBy: options.by ?? os.userInfo().username, repository }, now);
  return createSuccess({ command: "start-run.hold", data: hold });
}

export interface StartRunGateCheckOptions { project: string; actions: string[]; repository?: string; workspace?: string }
export interface StartRunGateCheckData {
  project: string;
  actions: string[];
  /** Every pending Agent Ask or open Decision that names a pinned Action: each one idles the run with `operator_gate_pending` (Issue #2038). */
  blocking: Array<{ action: string; kind: string; id: string; title: string; settleCommand: string }>;
}

/**
 * `arcadia start-run gate-check`: the START executor's read-only check that no pending operator item names a pinned
 * Action. It resolves the same `resolveOperatorGate` that holds a launch, per pinned Action, because `production preview`
 * and `advance queue` do not read it (Issue #2038).
 */
export function runStartRunGateCheckCommand(options: StartRunGateCheckOptions): CommandSuccess<StartRunGateCheckData> {
  if (options.actions.length === 0) throw validationError("start-run gate-check needs at least one --action");
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repoRoot = path.resolve(options.repository ?? process.cwd());
  const blocking = withReadOnlyDatabase(workspacePath, (db) => options.actions.flatMap((action) =>
    resolveOperatorGate({ db, repoRoot, projectSlug: options.project, selectedActionId: action }).blocking
      .map((item) => ({ action, kind: item.kind, id: item.id, title: item.title, settleCommand: item.settleCommand }))));
  return createSuccess({ command: "start-run.gate-check", workspace: workspacePath, data: { project: options.project, actions: options.actions, blocking } });
}

export function renderStartRunPinsSuccess(response: CommandSuccess<StartRunPinsData>): string[] {
  const { startRun, expires_at } = response.data;
  return JSON.stringify({ startRun, expires_at }, null, 2).split("\n");
}

export interface StartRunSignInOptions {
  workspace: string;
  repository: string;
  project: string;
  card: string;
  runId: string;
  runDirectory: string;
  release: string;
  policyRevision: string | number;
  policyEpoch: string | number;
  checkOnly?: boolean;
}
export type StartRunSignInData = { mode: "check-only"; static: StaticSignInState } | ({ mode: "run" } & StartRunSignInResult);

/**
 * A `--json` command's envelope. Its stdout should be exactly one JSON document; as defense in depth (Issue #1956), when a
 * child printed ahead of it, the trailing document starting at a line beginning with "{" is taken. Throws when none parses.
 */
export function parseJsonEnvelope(stdout: string): unknown {
  try { return JSON.parse(stdout); } catch { /* fall through to the trailing document */ }
  const starts = [...stdout.matchAll(/^\{/gm)].map((match) => match.index ?? 0).reverse();
  for (const start of starts) {
    try { return JSON.parse(stdout.slice(start)); } catch { /* try an earlier start */ }
  }
  throw new Error("no JSON envelope on stdout");
}

/**
 * The compiled CLI of the pinned release the card just installed (the same revision as the checkout), run with its
 * manifest runtime: it starts in well under a second, where a `tsx` source cold start can take most of a grant window.
 */
export function pinnedReleaseCli(release: string, home = process.env.HOME ?? ""): string[] {
  const directory = path.join(home, ".local", "share", "arcadia", "go-broker", "releases", release);
  let manifest: { schema?: string; revision?: string; runtimeExecutable?: string };
  try { manifest = JSON.parse(readFileSync(path.join(directory, "broker-manifest.json"), "utf8")); }
  catch { throw validationError(`The pinned release ${release} is not installed; the sign-in sequence runs only after the card's go-broker ensure.`); }
  if (manifest.schema !== "arcadia-go-broker-install-v1" || manifest.revision !== release || typeof manifest.runtimeExecutable !== "string") {
    throw validationError(`The installed release manifest is not the pinned revision ${release}.`);
  }
  return [manifest.runtimeExecutable, path.join(directory, "dist", "src", "cli.js")];
}

/** Real collaborators: the pinned release's CLI and Git of the given repository, and the worker's own reviewed Claude runner. */
export function realStartRunSignInDeps(repository: string, release: string, workspace: string): StartRunSignInDeps {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ARCADIA_WORKSPACE;
  // The settlement and answer commits are the Arcadia Controller's, never the host's git config or an inherited identity.
  for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete env[key];
  Object.assign(env, controllerIdentityDefaults(env));
  let command: string[] | null = null;
  return {
    now: () => new Date(),
    randomUUID: () => randomUUID(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    runClaude: runClaudeCliHeadless,
    // The same set pollWorkerClaudeUsageDiagnostics (src/commands/worker.ts) reads.
    polledRepositories: () => withReadOnlyDatabase(workspace, (db) => listProjects(db).filter((project) => project.status === "active")
      .map((project) => getProjectMetadata(db, project.id)?.repo_path).filter((repo): repo is string => Boolean(repo))),
    cli: (args, timeoutMs) => {
      command ??= pinnedReleaseCli(release);
      const run = spawnSync(command[0], [...command.slice(1), ...args, "--json"], { cwd: repository, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
      // Like the executor: a non-zero exit is a failure whatever stdout holds.
      if (run.status !== 0) {
        // The CLI writes its --json failure envelope to stderr: keep its { code, message, details } for the refusal (Issue #1958).
        let envelope: { error?: unknown } | null;
        try { envelope = parseJsonEnvelope(run.stderr ?? "") as { error?: unknown }; } catch { envelope = null; }
        return { ok: false, error: envelope?.error ?? `exit ${String(run.status ?? run.signal)}: ${(run.stderr || "no output").slice(0, 2000)}` };
      }
      try { return parseJsonEnvelope(run.stdout) as { ok: boolean; data?: unknown }; }
      catch { return { ok: false, error: (run.stderr || "no JSON output").slice(0, 2000) }; }
    },
    git: (args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim()
  };
}

/**
 * `arcadia start-run sign-in`: run only by a per-run START card (scripts/start-run.sh), never by hand. With --check-only
 * it makes the read-only checks that must hold before the Decision 0141 day is claimed. Otherwise it runs the Decision
 * 0161 / 0143 sequence once against the bound worker (src/production/startRunSignIn.ts).
 */
/**
 * The sequence may run only inside this card's own live press, after its one-shot allowance is consumed: the /actions run
 * record names this card and is running, its start-run.claimed marker is this run, and <card>.consumed.json is this run's.
 * A direct invocation therefore cannot claim the day or publish a diagnostic Decision.
 */
export function assertStartCardPress(options: Pick<StartRunSignInOptions, "card" | "runId" | "runDirectory">, env: NodeJS.ProcessEnv = process.env): void {
  const refuse = (message: string): never => { throw validationError(`start-run sign-in runs only inside a pressed START card: ${message}. Nothing was claimed or changed.`, { code: "NOT_A_CARD_PRESS" }); };
  const read = (file: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { return null; } };
  if (env.ARCADIA_OPERATOR_SCRIPT_ID !== options.card) refuse("ARCADIA_OPERATOR_SCRIPT_ID does not name this card");
  const pressDirectory = env.ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY;
  if (!pressDirectory) refuse("there is no operator press record");
  const press = read(path.join(pressDirectory!, "run.json"));
  if (press?.scriptId !== options.card || press?.status !== "running") refuse("the operator press record is not this card's running press");
  let claimed = "";
  try { claimed = readFileSync(path.join(pressDirectory!, "start-run.claimed"), "utf8").trim(); } catch { /* checked below */ }
  if (claimed !== options.runId) refuse("the press record's start-run.claimed marker is not this run");
  const runDirectory = path.resolve(options.runDirectory);
  if (path.basename(runDirectory) !== options.runId || path.basename(path.dirname(runDirectory)) !== options.card) refuse("the run directory is not this card's run");
  const library = path.dirname(path.dirname(path.dirname(runDirectory)));
  const marker = read(path.join(library, `${options.card}.consumed.json`));
  if (marker?.state !== "CONSUMED" || marker?.requestId !== options.card || marker?.runId !== options.runId) refuse("this card's one-shot allowance is not consumed by this run");
}

export async function runStartRunSignInCommand(options: StartRunSignInOptions, deps?: StartRunSignInDeps, env: NodeJS.ProcessEnv = process.env): Promise<CommandSuccess<StartRunSignInData>> {
  const repository = realpathSync(options.repository);
  const workspace = realpathSync(options.workspace);
  const collaborators = deps ?? realStartRunSignInDeps(repository, options.release, workspace);
  const revision = Number(options.policyRevision), epoch = Number(options.policyEpoch);
  if (!Number.isInteger(revision) || !Number.isInteger(epoch)) throw validationError("--policy-revision and --policy-epoch must be whole numbers.");
  if (!/^[0-9a-f]{40}$/.test(options.release)) throw validationError("--release must be the reviewed 40-hex revision.");
  if (!slug.test(options.card) || !slug.test(options.project)) throw validationError("--card and --project must be slugs.");
  try {
    if (options.checkOnly) {
      const state = staticSignInChecks({ workspace, repository }, collaborators);
      return createSuccess({ command: "start-run.sign-in", workspace, data: { mode: "check-only" as const, static: state } });
    }
    assertStartCardPress(options, env);
    const result = await runStartRunSignIn({
      workspace, repository, project: options.project, cardId: options.card, runId: options.runId, runDirectory: path.resolve(options.runDirectory),
      release: options.release, policyRevision: revision, policyEpoch: epoch
    }, collaborators);
    return createSuccess({ command: "start-run.sign-in", workspace, data: { mode: "run" as const, ...result } });
  } catch (error) {
    if (error instanceof StartRunSignInRefusal) throw validationError(error.message, { code: error.code, sequenceClaimed: error.sequenceClaimed });
    throw error;
  }
}

export function renderStartRunSignInSuccess(response: CommandSuccess<StartRunSignInData>): string[] {
  const data = response.data;
  if (data.mode === "check-only") return [`Sign-in sequence checks pass for ${data.static.date}; nothing was claimed or changed.`];
  return [`Sign-in ${data.outcome}: worker receipt ${data.receipt.path} (sha256 ${data.receipt.sha256}).`];
}
