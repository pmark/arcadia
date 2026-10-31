import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { buildAgentQueue } from "../dispatch/queue.js";
import { START_RUN_EXECUTOR_PATH, StartRunPinsError, validateStartRunPins, type StartRunPins } from "../operatorActions/startRunPins.js";
import { runProductionStatusCommand } from "./production.js";

/**
 * `arcadia start-run pins`: compute the pins of one per-run START card from live, read-only state and print them.
 * It writes nothing, emits no bash and no manifest, and grants nothing: the printed block is reviewed (a mechanical
 * pin diff plus an independent critic check) before anyone publishes it in a descriptor next to the thin launcher.
 */
export const START_RUN_DEFAULTS = {
  provider: "claude-code-cli",
  transitions: ["validation", "acceptance", "pointer", "packet_approval"],
  packetApprovalHours: 24,
  /** Decision 0130 spend ceiling, 0058 candidate integration, 0097 worker PR merge, 0134 amendment, 0156 install. 0157 is added for a draft Plan. */
  spendDecision: "0130",
  integrationDecision: "0058",
  requiredDecisions: ["0130", "0058", "0097", "0134", "0156"],
  requiredFiles: [START_RUN_EXECUTOR_PATH, "src/sessions/tmuxLauncher.ts", "src/production/workerMerge.ts"],
  gateCardId: "enable-capacity-gate-20261017",
  offId: "restore-off-production-bug-plan-first-supervised-run-2026-10-11"
} as const;

export interface StartRunPinsOptions {
  plan: string;
  actions: string;
  provider: string;
  expiresHours: string | number;
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
  /** Files named `filename` anywhere under `root`, newest first (read-only discovery of live receipts). */
  findFiles(root: string, filename: string): string[];
  readText(file: string): string;
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
  listFiles: (directory) => { try { return readdirSync(directory); } catch { return []; } },
  sha256File: (file) => createHash("sha256").update(readFileSync(file)).digest("hex"),
  readText: (file) => readFileSync(file, "utf8"),
  findFiles: (root, filename) => {
    try {
      return (readdirSync(root, { recursive: true }) as string[]).filter((entry) => path.basename(entry) === filename).map((entry) => path.join(root, entry))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    } catch { return []; }
  }
};

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (buffer: Buffer): string => buffer.toString("utf8");
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
function frontmatter(content: string, label: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) throw validationError(`${label} has no frontmatter.`);
  return parseYaml(match[1]) as Record<string, unknown>;
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
  const planActions = (Array.isArray(planFrontmatter.actions) ? planFrontmatter.actions : []) as Array<{ id?: string; status?: string }>;
  for (const action of actions) {
    const found = planActions.find((entry) => entry.id === action);
    if (!found) throw validationError(`Action ${action} is not in Plan ${plan} at origin main.`);
    if (found.status === "done") throw validationError(`Action ${action} is already done; a START card pins only open Actions.`);
  }
  if (planStatus === "draft") notes.push("The Plan is a draft: embed its pinned planActivation block in the descriptor (Decision 0157) before review.");

  const requiredDecisions: string[] = [...START_RUN_DEFAULTS.requiredDecisions, ...(planStatus === "draft" ? ["0157"] : [])];
  const decisionFiles = text(deps.git(toplevel, ["ls-tree", "--name-only", originMain, "docs/decisions/"])).split("\n");
  for (const decision of requiredDecisions) {
    const file = decisionFiles.find((entry) => new RegExp(`^docs/decisions/${decision}-.*\\.md$`).test(entry));
    if (!file) throw validationError(`Decision ${decision} is not in docs/decisions at origin main.`);
    const content = text(show(file));
    if (!/^status: approved$/m.test(content) || !/^answer: .+/m.test(content)) throw validationError(`Decision ${decision} is not approved with a recorded answer at origin main.`);
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
  // N6: the gate and STOP cards the handoffs and refusals name must exist in the library.
  const entries = new Set(deps.listFiles(library));
  for (const card of [START_RUN_DEFAULTS.gateCardId, START_RUN_DEFAULTS.offId]) {
    if (!entries.has(`${card}.json`)) throw validationError(`Operator card ${card} is not in the library ${library}; no pins were computed.`);
  }
  // Evidence receipts are discovered, never defaulted: refuse when a live receipt cannot be found.
  const closeouts = path.join(main, "artifacts", "generated", "session-closeouts");
  const discover = (filename: string, label: string): { path: string; sha256: string } => {
    const found = deps.findFiles(closeouts, filename)[0];
    if (!found) throw validationError(`No ${label} receipt (${filename}) was found under ${closeouts}; no pins were computed.`);
    return { path: found, sha256: deps.sha256File(found) };
  };
  const delegationReceipt = discover("start-stop-daily-chat-delegation.json", "START/STOP delegation");
  const signInEvidence = discover("postrenewal-usage-worker-receipt.json", "sign-in evidence");
  try {
    const evidence = JSON.parse(deps.readText(signInEvidence.path)) as { success?: boolean; credentialExpiresAt?: string; windows?: Array<{ usedPercentage?: number }> };
    if (evidence.success !== true || !(Date.parse(String(evidence.credentialExpiresAt)) > deps.now().getTime() + 5 * 60_000) ||
        !Array.isArray(evidence.windows) || evidence.windows.length !== 2 || !evidence.windows.every((w) => Number.isFinite(w.usedPercentage) && (w.usedPercentage as number) >= 0 && (w.usedPercentage as number) < 100)) {
      throw new Error("not usable");
    }
  } catch { throw validationError(`The sign-in evidence ${signInEvidence.path} is unreadable, unsuccessful, expiring within 5 minutes or shows a usage window at 100%.`); }
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
    grantedBy: `Rowan under P. Mark Anderson START/STOP delegation through ${expiresAt}`,
    consumedHistory: receipts.map((file) => ({ path: file, sha256: deps.sha256File(file) })),
    delegationReceipt,
    signInEvidence
  };
  try { validateStartRunPins(startRun); }
  catch (error) { throw validationError(error instanceof StartRunPinsError ? error.message : String(error)); }
  return { startRun, expires_at: expiresAt, observations: { repository: toplevel, originMain, planStatus, queueTop, workerLabel: labels[0], notes } };
}

export function runStartRunPinsCommand(options: StartRunPinsOptions, deps: StartRunPinsDeps = realStartRunPinsDeps): CommandSuccess<StartRunPinsData> {
  const data = buildStartRunPins(options, deps);
  return createSuccess({ command: "start-run.pins", data, warnings: data.observations.notes });
}

export function renderStartRunPinsSuccess(response: CommandSuccess<StartRunPinsData>): string[] {
  const { startRun, expires_at } = response.data;
  return JSON.stringify({ startRun, expires_at }, null, 2).split("\n");
}
