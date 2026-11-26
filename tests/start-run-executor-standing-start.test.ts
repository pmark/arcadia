import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startRunLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import type { StartRunPins } from "../src/operatorActions/startRunPins.js";
import { CONTINUE_ANSWER, CONTINUE_SLUG } from "../src/operatorActions/startRunDayGrant.js";
import { DAY_CARD, DAY_RUN, dayScenarios, named, OLD_FIX_COMMIT, pressKey, STOP_ID, writeDayApproval, writeDayScenario, writeStopPress, type DayScenario } from "./helpers/dayGrantFixture.js";

/**
 * Hermetic cases for scripts/start-run.sh, the shared executor of every per-run START card. Each case copies the real
 * executor and a real thin launcher into a throwaway checkout whose origin is a local bare repository, and puts fake
 * `mise` (the Arcadia CLI and the plan-activation runner), `launchctl`, `timeout`, `sleep` and `tmux` shims first on
 * PATH. No case reaches the live workspace, production, launchd, GitHub or a provider.
 *
 * Issue #3073: the cases are split by describe block over tests/start-run-executor.test.ts, -day-grant, -standing-start and
 * -after-mutation, so CI's file-level shards can run them in parallel. Each file carries its own copy of this harness (kept
 * in a test file, not tests/helpers/, so it stays worker-merge-safe); change all four copies together.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtures = path.join(repoRoot, "tests", "fixtures", "start-run");
const EXECUTOR_SOURCE = readFileSync(path.join(repoRoot, "scripts", "start-run.sh"), "utf8");
const FIXTURE_ID = "start-run-fixture-20261101";
const ID = FIXTURE_ID;
const PLAN = "arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider";
const PREVIOUS = "enable-bounded-local-native-release-manager-coordination-with-durable-addressed";
const ACTIONS = ["claude-worker-launch-replay", "claude-capacity-evidence", "first-supervised-claude-run"];
const SCOPED = ACTIONS.map((a) => `arcadia/${a}`);
/** Decision 0163's delegated scope: a delegated card keeps exactly these Actions. */
const DELEGATED_ACTIONS = ["bound-guidance-test-teardown-retries", "assert-tmux-temp-launcher-removed", "cover-retired-descriptor-byte-change"];
const ORIGIN = "start-run-origin-20261101";
const ORIGIN_RUN = "20261101T010000Z-111";
const ORIGIN_PRESS = "20261101010000000-origin-press";
type DelegationScenario = "ok" | "receipt-changed" | "origin-delegated" | "origin-scope" | "expired" | "exhausted" | "not-trigger" | "activated-other-off" | "returned-off" | "attempt-mismatch" | "no-origin" | "found-off" | "before-decision" | "production-changed";
/** The before-decision press, 35 minutes before Decision 0163 reached main (2026-11-01T04:35:38Z, EARLIEST in the executor). */
const BEFORE_DECISION_PRESS = "2026-11-01T04:00:24.507Z";
/** The executor's clock for that scenario, one hour after the press: within the 72-hour window it checks first, on any real date. */
const BEFORE_DECISION_NOW = "2026-11-01T05:00:24.507Z";
const clockEnv = (now: string): NodeJS.ProcessEnv => ({
  START_RUN_FAKE_NOW: now,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(fixtures, "fake-clock.mjs")).href}`].filter(Boolean).join(" ")
});
const LABEL = "com.arcadia.local.1.worker";
const PIN_COMMIT = "0".repeat(40);
/** The number the continue-after-fix Decision landed on when written; the executor finds it by its slug alone. */
const CONTINUE_ID = "0187";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
/**
 * Parses calls.log text, one JSON object per line. The fake binary appends while this suite may read, so a read can
 * catch the final line half-written; an unparseable final line is skipped ONLY when it is unterminated (no newline
 * after it). A malformed newline-terminated line, or any unparseable earlier line, still throws.
 */
function parseCallLog<T>(text: string): T[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const unterminatedTail = !/\n\s*$/.test(text);
  return lines.flatMap((line, index) => {
    try {
      return [JSON.parse(line) as T];
    } catch (error) {
      if (index === lines.length - 1 && unterminatedTail) return [];
      throw error;
    }
  });
}

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

const GIT_ENV = { GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "f@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "f@example.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}
function commitFile(dir: string, file: string, content: string, message: string): string {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
  git(dir, "add", "-A");
  git(dir, "commit", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

const planDocument = (status: "active" | "draft", done: string[] = [], actions: string[] = ACTIONS) => [
  "---", `slug: ${PLAN}`, "project: arcadia", `status: ${status}`, "actions:",
  ...actions.flatMap((id) => [`  - id: ${id}`, `    status: ${done.includes(id) ? "done" : "open"}`]), "---", "body", ""
].join("\n");
const projectDocument = (activePlan: string) => `---\nslug: arcadia\nactive_plan: ${activePlan}\n---\n`;
const decisionDocument = (id: string, status = "approved", answer = "Yes") => `---\nid: "${id}"\nstatus: ${status}\n${answer ? `answer: ${answer}\n` : ""}---\n`;
const DECISIONS = ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162", "0163", "0170", "0173", "0181"];
const DECISION_ANSWERS: Record<string, string> = { "0173": '"A. Daily grant: START and routine run operations"', "0181": "A. Continued serial runs" };

type Scenario = "same" | "behind" | "pin-unfetched" | "origin-moved" | "diverged" | "ahead";
/** Issue #3030: what changes on the host at the first sleep of one wait (tests/fixtures/start-run/fake-sleep.mjs). */
interface SlowTickDuring {
  stage: "sign-in" | "start" | "activation";
  liveAdmissions?: number;
  queueRevision?: number;
  tmuxSession?: string;
  clockJumpMs?: number;
}
interface BoxOptions {
  scenario?: Scenario;
  planStatus?: "active" | "draft";
  /** Embed the real pinned planActivation block (required for a draft Plan to be startable). */
  activation?: boolean;
  /** The previous Plan's actual status at the pin, and the status the card's previousPlanBefore pins (default active/active). */
  previousStatus?: string;
  envelopePreviousStatus?: string;
  projectPointer?: string;
  done?: string[];
  decisions?: Record<string, string | null>;
  /** Decision 0187's record at its real slug path (found by slug, not number): null leaves it out; default approved with A. */
  continueDecision?: string | null;
  /** More Decision records by path, such as another record sharing 0187's number or its slug. */
  extraDecisions?: Record<string, string>;
  withoutFile?: string;
  expiresAt?: string;
  executorPin?: string;
  tamper?: "descriptor" | "script" | "executor";
  historyDrift?: boolean;
  /** The dashboard's run record for this press: absent, stale, for another card, not running, or already claimed. */
  press?: "none" | "stale" | "other-card" | "not-running" | "claimed" | "other-parent";
  /** Decision 0163: make this a successor card Rowan presses, delegated from an operator-pressed origin in the library. */
  delegation?: DelegationScenario;
  /** Decision 0173: make this Rowan's START card within an operator day approval, from the shared scenario table. */
  dayGrant?: DayScenario;
  /** Jump the executor's clock by byMs as this call is answered on a real press (fake-clock-offset.mjs). */
  clockJump?: { at: string; byMs: number };
  /** An operator STOP pressed while production is Off, as this call is answered on a real press. */
  stopPressAt?: string;
  /** A newer operator day press finishing as this call is answered on a real press. */
  laterApproval?: { at: string; press: string };
  /** Leave the reviewed manifest of a Decision 0173 card without its pre-mortem pointer. */
  noPremortem?: boolean;
  /** Press a delegated card without the delegated marker (as if by the operator), or mark an ordinary card delegated. */
  pressMarker?: "omit" | "forge";
  /** The pre-restart worker: fresh and unbound by default (a source-run worker), or stale, or not the launchd PID. */
  preWorker?: "stale" | "pid-mismatch" | "source-child";
  /** Issue #3030: a worker that beats once per slow tick. From `from` on, each executor step finds its last beat 40 s old;
   * a wait (the fake `sleep`) lets the next beat land only if it `recovers`. */
  slowTick?: { from: "start" | "restart" | "sign-in"; recovers: boolean; during?: SlowTickDuring };
  /** Earlier finished sequences of other cards recorded today in the ledger (Decision 0162: never a reason to refuse). */
  dayUsed?: boolean;
  plist?: boolean;
  tmuxSessions?: boolean;
  /** Exact live tmux session names (`tmux ls -F '#{session_name}'`); the registry's allowed names go in state.relaySessions. */
  tmuxLive?: string[];
  /** How `tmux ls` fails: tmux's own "no server" answer is the default; others must refuse (fail closed). */
  tmuxError?: "denied" | "other" | "mise-shim" | "not-found" | "timeout";
  /** A warning line on stderr beside a successful `tmux ls` (a shim's notice): it must never become a session name. */
  tmuxWarning?: boolean;
  /** How many panes the relay session has (default 1). */
  relayPanes?: number;
  /** Whether a process of the registry's native session id (--session-id) runs under the relay pane (default true). */
  relayProcess?: boolean;
  /** A second live relay session (the handed-off predecessor, pane 4342) and the session id its pane runs. */
  predecessorPane?: { name: string; sessionId: string };
  config?: unknown;
  /** The card's id (default the fixture's); a `standing-start-` id makes it a standing-grant card (Decision 0241). */
  cardId?: string;
  state?: (state: Record<string, any>) => void;
}

function box(options: BoxOptions = {}) {
  const ID = options.cardId ?? FIXTURE_ID;  // the card's id for this box; outside box, ID is the fixture's
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-start-run-")));
  directories.push(root);
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "arcadia");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const workspace = path.join(root, "martianrover");
  const library = path.join(repo, "artifacts", "generated", "operator-scripts");
  git(root, "init", "--bare", "-b", "main", origin);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "remote", "add", "origin", origin);
  writeFileSync(path.join(repo, ".gitignore"), "artifacts/generated/\nnode_modules\n");
  // The base commit is dated before every scenario's failure, so Decision 0187 cases can name a fix merged too early (OLD_FIX_COMMIT).
  writeFileSync(path.join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  const based = spawnSync("git", ["commit", "-m", "base"], { cwd: repo, encoding: "utf8", env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: "2026-11-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-11-01T00:00:00Z" } });
  if (based.status !== 0) throw new Error(`git commit base: ${based.stderr}`);
  const installed = git(repo, "rev-parse", "HEAD");

  const planStatus = options.planStatus ?? "active";
  const files: Record<string, string> = {
    "scripts/start-run.sh": EXECUTOR_SOURCE,
    "src/sessions/tmuxLauncher.ts": "export {};\n",
    "src/production/workerMerge.ts": "export {};\n",
    "PROJECT.md": projectDocument(options.projectPointer ?? (planStatus === "draft" ? PREVIOUS : PLAN)),
    [`docs/plans/${PLAN}.md`]: planDocument(planStatus, options.done, options.delegation ? DELEGATED_ACTIONS : ACTIONS),
    [`docs/plans/${PREVIOUS}.md`]: `---\nslug: ${PREVIOUS}\nproject: arcadia\nstatus: ${options.previousStatus ?? (planStatus === "draft" ? "active" : "draft")}\nactions: []\n---\n`
  };
  for (const id of DECISIONS) {
    const body = options.decisions?.[id];
    if (body === null) continue;
    files[`docs/decisions/${id}-fixture.md`] = body ?? decisionDocument(id, "approved", DECISION_ANSWERS[id] ?? "Yes");
  }
  if (options.continueDecision !== null) files[`docs/decisions/${CONTINUE_ID}-${CONTINUE_SLUG}.md`] = options.continueDecision ?? decisionDocument(CONTINUE_ID, "approved", CONTINUE_ANSWER);
  Object.assign(files, options.extraDecisions ?? {});
  if (options.withoutFile) delete files[options.withoutFile];
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
  }
  chmodSync(path.join(repo, "scripts", "start-run.sh"), 0o755);
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "reviewed main");
  const c0 = git(repo, "rev-parse", "HEAD");
  git(repo, "push", "-u", "origin", "main");
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(repo, "node_modules"));

  let pin = c0;
  const scenario = options.scenario ?? "same";
  if (scenario === "behind" || scenario === "diverged") {
    pin = commitFile(repo, "docs/note.md", "docs only\n", "docs-only move");
    git(repo, "push", "origin", "main");
    git(repo, "reset", "--hard", c0);
    if (scenario === "diverged") commitFile(repo, "docs/local.md", "local only\n", "local-only commit");
  } else if (scenario === "pin-unfetched") {
    const other = path.join(root, "other");
    git(root, "clone", origin, other);
    pin = commitFile(other, "docs/note.md", "docs only\n", "docs-only move");
    git(other, "push", "origin", "main");
  } else if (scenario === "origin-moved") {
    const other = path.join(root, "other");
    git(root, "clone", origin, other);
    commitFile(other, "docs/note.md", "moved\n", "origin moved");
    git(other, "push", "origin", "main");
  } else if (scenario === "ahead") {
    commitFile(repo, "docs/local.md", "local only\n", "local ahead of the pin");
  }

  const activationSource = JSON.parse(readFileSync(path.join(repoRoot, "artifacts/generated/operator-scripts/activate-production-claude-plan-20261017.json"), "utf8")) as OperatorScriptDescriptor;
  mkdirSync(library, { recursive: true });
  const history = path.join(library, "earlier.consumed.json");
  writeFileSync(history, '{"state":"CONSUMED"}\n');
  const pins: StartRunPins = {
    schema: "arcadia-start-run-v1", reviewedRevision: pin, executorSha256: options.executorPin ?? sha(EXECUTOR_SOURCE),
    workspace: "martianrover", project: "arcadia", plan: PLAN, actions: ACTIONS, provider: "claude-code-cli",
    transitions: ["validation", "acceptance", "pointer", "packet_approval"], concurrency: 1, packetApprovalHours: 24, intent: "A fixture run on the claude-code provider.",
    spendDecision: "0130", integrationDecision: "0058", requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162"],
    requiredFiles: ["scripts/start-run.sh", "src/sessions/tmuxLauncher.ts", "src/production/workerMerge.ts"],
    production: { revision: 83, epoch: 46 }, queueRevision: 290, workerLabel: LABEL, gateCardId: "enable-capacity-gate-20261017", offId: options.dayGrant?.offId ?? STOP_ID,
    grantedBy: "P. Mark Anderson, by pressing this per-run START card from /actions under Decisions 0156 and 0157", consumedHistory: [{ path: history, sha256: sha('{"state":"CONSUMED"}\n') }]
  };
  if (options.delegation) {
    // The operator's originating press, as the /actions runner and the executor leave it on disk.
    const scenario = options.delegation;
    pins.actions = DELEGATED_ACTIONS;
    pins.requiredDecisions = [...pins.requiredDecisions, "0163"];
    pins.grantedBy = `Rowan, pressing this successor START card from /actions under Decision 0163, delegated from the operator's originating press ${ORIGIN}/${ORIGIN_RUN}`;
    const activated = scenario === "returned-off" || scenario === "activated-other-off" || scenario === "not-trigger";
    const originReceipt = JSON.stringify({
      schema: "arcadia-start-run-receipt-v1", id: ORIGIN, runId: ORIGIN_RUN, mode: "run", startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      outcome: scenario === "not-trigger" ? "succeeded" : "refused", allowanceConsumed: true, productionActivated: activated,
      offCleanup: scenario === "returned-off" ? "returned_off" : scenario === "activated-other-off" ? "other_grant_active" : scenario === "found-off" ? "not_active" : "not_attempted", record: { operatorRunId: ORIGIN_PRESS }
    });
    const receiptDir = path.join(library, "runs", ORIGIN, ORIGIN_RUN);
    const pressDir = path.join(library, "runs", "operator", ORIGIN, ORIGIN_PRESS);
    mkdirSync(receiptDir, { recursive: true });
    mkdirSync(pressDir, { recursive: true });
    if (scenario !== "no-origin") writeFileSync(path.join(receiptDir, "receipt.json"), originReceipt);
    writeFileSync(path.join(pressDir, "run.json"), JSON.stringify({
      schema: "arcadia-operator-script-run-v1", runId: ORIGIN_PRESS, scriptId: ORIGIN, status: "failed",
      startedAt: scenario === "before-decision" ? BEFORE_DECISION_PRESS : new Date(Date.now() - (scenario === "expired" ? 73 * 3_600_000 : 30 * 60_000)).toISOString(),
      ...(scenario === "origin-delegated" ? { press: { kind: "delegated", agent: "rowan", decision: "0163", originatingRun: "x/y" } } : {})
    }));
    writeFileSync(path.join(pressDir, "descriptor.json"), JSON.stringify({ startRun: { ...pins, ...(scenario === "origin-scope" ? { spendDecision: "0999" } : {}),
      // Every activate and deactivate bumps the policy revision: the executor's own activate and Off add two.
      production: { ...pins.production, revision: pins.production.revision - (scenario === "returned-off" ? 2 : scenario === "production-changed" ? 1 : 0) } } }));
    writeFileSync(path.join(library, `${ORIGIN}.consumed.json`), '{"state":"CONSUMED"}\n');
    writeFileSync(path.join(pressDir, "start-run.claimed"), `${ORIGIN_RUN}\n`);
    // Earlier delegated successors of the same chain, each pressed through /actions and consumed (exhausted: 4 of them, so
    // 5 attempts already ran), recorded where the runner and the executor leave them.
    const successors = scenario === "exhausted" ? 4 : 0;
    for (let n = 1; n <= successors; n += 1) {
      const card = `start-run-successor-${n}`, press = `2026110105${n}000000-successor`, run = `20261101T05${n}000Z-1`;
      const at = new Date(Date.now() - (25 - n) * 60_000).toISOString();
      const delegationBlock = { decision: "0163", originatingCard: ORIGIN, originatingRun: ORIGIN_RUN, originatingReceiptSha256: "0".repeat(64), attempt: n + 1 };
      writeFileSync(path.join(library, `${card}.json`), JSON.stringify({ startRun: { ...pins, delegation: delegationBlock } }));
      writeFileSync(path.join(library, `${card}.consumed.json`), '{"state":"CONSUMED"}\n');
      const successorPress = path.join(library, "runs", "operator", card, press);
      mkdirSync(successorPress, { recursive: true });
      writeFileSync(path.join(successorPress, "run.json"), JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: press, scriptId: card, status: "failed", startedAt: at, press: { kind: "delegated", agent: "rowan", decision: "0163", originatingRun: `${ORIGIN}/${ORIGIN_RUN}` } }));
      writeFileSync(path.join(successorPress, "descriptor.json"), JSON.stringify({ startRun: { ...pins, delegation: delegationBlock } }));
      writeFileSync(path.join(successorPress, "start-run.claimed"), `${run}\n`);
      mkdirSync(path.join(library, "runs", card, run), { recursive: true });
      writeFileSync(path.join(library, "runs", card, run, "receipt.json"), JSON.stringify({ id: card, runId: run, mode: "run", allowanceConsumed: true, startedAt: at, outcome: "refused", productionActivated: false, offCleanup: "not_attempted", record: { operatorRunId: press } }));
    }
    pins.delegation = { decision: "0163", originatingCard: ORIGIN, originatingRun: ORIGIN_RUN, originatingReceiptSha256: sha(originReceipt), attempt: scenario === "exhausted" ? 5 : scenario === "attempt-mismatch" ? 3 : 2 };
    if (scenario === "receipt-changed") writeFileSync(path.join(receiptDir, "receipt.json"), originReceipt + " ");
  }
  let dayPolicyRevision: number | null = null;
  let dayEvidence: unknown = undefined;
  if (options.dayGrant) {
    const scenario = options.dayGrant;
    const now = Date.now();
    // A merged fix's commit is only known here: PIN_COMMIT (FIX_COMMIT) stands for the reviewed revision, dated after every
    // scenario's failure, and OLD_FIX_COMMIT for the base commit, dated before them (Decision 0187).
    const commits: Record<string, string> = { [PIN_COMMIT]: pin, [OLD_FIX_COMMIT]: installed };
    const written = writeDayScenario(library, scenario, now, commits);
    dayPolicyRevision = written.policyRevision;
    dayEvidence = written.evidence;
    pins.requiredDecisions = [...pins.requiredDecisions, "0163", "0170", "0173"];
    pins.production = { ...pins.production, revision: written.policyRevision };
    pins.grantedBy = `Rowan, pressing this START card from /actions under Decision 0173, within the operator's day approval ${written.approval.card}/${written.approval.run}`;
    const previous = scenario.previous?.clearance.kind === "merged-fix" && commits[scenario.previous.clearance.commit]
      ? { ...scenario.previous, clearance: { ...scenario.previous.clearance, commit: commits[scenario.previous.clearance.commit] } } : scenario.previous ?? null;
    pins.delegation = { decision: "0173", approvalCard: written.approval.card, approvalRun: written.approval.run, approvalReceiptSha256: written.approval.receiptSha256, approvalPressSha256: written.approval.pressSha256, attempt: scenario.attempt ?? 1, previous };
  }
  const descriptor: OperatorScriptDescriptor = {
    schema: "arcadia-operator-script-v1", id: ID, kind: "grant", title: "START: fixture", script: `${ID}.sh`, repeatable: false,
    problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" },
    expires_at: options.expiresAt ?? new Date(Date.now() + 6 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    startRun: pins, ...(options.activation ? { planActivation: (() => { const a = structuredClone(activationSource.planActivation!) as any; if (options.envelopePreviousStatus === "complete") { a.envelope.previousPlanBefore = { ...a.envelope.previousPlanBefore, status: "complete", current_action: a.envelope.projectBefore.current_action }; a.envelope.previousPlanAfter = { status: "complete", current_action: null }; } return a; })() } : {})
  };
  const script = startRunLauncher(ID);
  // A hand-written card the /actions runner would refuse: the executor must refuse it as well.
  if (options.dayGrant?.code !== "INVALID_DELEGATION") validateOperatorScriptContract(descriptor, ID, script);
  const scriptPath = path.join(library, `${ID}.sh`);
  const descriptorPath = path.join(library, `${ID}.json`);
  writeFileSync(scriptPath, script, { mode: 0o755 });
  writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2) + "\n");
  // Fixture-only wait shortening, honoured by the executor only because this marker sits in the fake library.
  writeFileSync(path.join(library, ".start-run-test-fixture"), "4");
  mkdirSync(path.join(library, "reviewed"));
  writeFileSync(path.join(library, "reviewed", `${ID}.json`), JSON.stringify({ sh: sha(readFileSync(scriptPath)), json: sha(readFileSync(descriptorPath)), executor: sha(EXECUTOR_SOURCE), ...(options.dayGrant && !options.noPremortem ? { premortem: "https://github.com/pmark/arcadia/issues/1#issuecomment-1" } : {}) }));
  if (options.tamper === "descriptor") writeFileSync(descriptorPath, readFileSync(descriptorPath, "utf8") + "\n");
  if (options.tamper === "script") writeFileSync(scriptPath, script + "# tampered\n");
  if (options.tamper === "executor") writeFileSync(path.join(repo, "scripts", "start-run.sh"), EXECUTOR_SOURCE + "\n# tampered\n");
  if (options.historyDrift) writeFileSync(history, '{"state":"EDITED"}\n');

  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(workspace, "config"), { recursive: true });
  mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
  writeFileSync(path.join(workspace, "config", "arcadia.json"), JSON.stringify(options.config ?? {}));
  // The live pre-restart worker runs from source, so its heartbeat carries no protected-release binding (Issue #1950).
  writeFileSync(path.join(workspace, ".arcadia", "worker-claude-usage-heartbeat.json"), JSON.stringify({ at: Date.now() - (options.preWorker === "stale" ? 600_000 : 0), binding: null }));
  writeFileSync(path.join(workspace, ".arcadia", "worker.pid"), JSON.stringify({ pid: options.preWorker === "pid-mismatch" ? 2222 : options.preWorker === "source-child" ? 3333 : 1111, owner: "owner-1111" }));
  if (options.dayUsed) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    mkdirSync(path.join(workspace, ".arcadia", "claude-renewal-days"), { recursive: true });
    // The legacy per-day claim shape and another card's finished per-run record, both from today.
    writeFileSync(path.join(workspace, ".arcadia", "claude-renewal-days", `${today}.json`), '{"status":"consumed-before-renewal"}');
    writeFileSync(path.join(workspace, ".arcadia", "claude-renewal-days", `${today}.start-run-earlier-card.20261101T000000Z-1.json`), '{"status":"consumed-before-renewal"}');
  }
  if (options.plist !== false) {
    mkdirSync(path.join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`), "<plist/>");
  }
  const shim = (name: string, body: string) => writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  shim("mise", `exec "${path.join(fixtures, "fake-mise")}" "$@"`);
  shim("launchctl", `exec node "${path.join(fixtures, "fake-launchctl.mjs")}" "$@"`);
  shim("fake-release-node", `exec node "${path.join(fixtures, "fake-release-node.mjs")}" "$@"`);
  shim("timeout", 'shift; exec "$@"');
  shim("sleep", options.slowTick ? `exec node "${path.join(fixtures, "fake-sleep.mjs")}" "$@"` : "exit 0");
  // `ps -o ppid= -p <pid>`: 3333 is the source-run worker the tsx CLI (launchd PID 1111) runs as its direct child.
  shim("ps", `if [ "$1" = "-axo" ]; then
  echo "  4242     1 tmux: pane shell"
  echo "  4243     1 bash stray-builder"
  ${options.relayProcess === false ? 'echo "  5151  4242 claude --session-id 99999999-9999-4999-8999-999999999999 --name other"' : 'echo "  5151  4242 claude --remote-control rowan --session-id 22222222-2222-4222-8222-222222222222 --name rowan"'}
  ${options.predecessorPane ? `echo "  4342     1 tmux: pane shell"; echo "  6161  4342 claude --remote-control rowan --session-id ${options.predecessorPane.sessionId} --name rowan"` : ""}
  exit 0
fi
case "$4" in 3333) echo " 1111" ;; *) echo " 1" ;; esac`);
  const liveNames = options.tmuxLive ?? (options.tmuxSessions ? ["0"] : []);
  const tmuxFailure = {
    denied: 'echo "error connecting to /private/tmp/tmux-501/default (Operation not permitted)" >&2; exit 1',
    other: 'echo "protocol version mismatch (client 8, server 7)" >&2; exit 1',
    "mise-shim": 'echo "mise ERROR error parsing config file: mise.toml" >&2; exit 1',
    "not-found": 'echo "tmux: command not found" >&2; exit 127',
    timeout: "exit 124"
  };
  // tmux's own answers: a server with sessions lists them (and a pane PID); no server says so on stderr. TMUX and TMUX_TMPDIR must be stripped by the caller.
  shim("tmux", options.tmuxError ? tmuxFailure[options.tmuxError]
    : `if [ -n "$TMUX" ] || [ -n "$TMUX_TMPDIR" ]; then echo "TMUX leaked into the query" >&2; exit 1; fi
case "$1" in
  ls) if [ -f "$FAKE_ROOT/tmux-live" ]; then cat "$FAKE_ROOT/tmux-live"; exit 0; fi; ${options.tmuxWarning ? 'echo "mise WARN a shim notice" >&2; ' : ""}${liveNames.length > 0 ? `printf '%s\\n' ${liveNames.map((name) => `'${name}'`).join(" ")}` : 'echo "no server running on /private/tmp/tmux-501/default" >&2; exit 1'} ;;
  list-panes) ${options.predecessorPane ? `if [ "$2 $3 $4" = "-s -t =${options.predecessorPane.name}:" ]; then echo 4342; exit 0; fi; ` : ""}if [ "$2" != "-s" ] || [ "$3 $4" != "-t =${liveNames[0] ?? "none"}:" ]; then echo "list-panes must use -s -t =name:" >&2; exit 1; fi; ${Array.from({ length: options.relayPanes ?? 1 }, (_, index) => `echo ${4242 + index}`).join("; ")} ;;
esac`);
  writeFileSync(path.join(bin, "fake-arcadia.mjs"), readFileSync(path.join(fixtures, "fake-arcadia.mjs")));
  writeFileSync(path.join(bin, "fake-plan-runner.mjs"), readFileSync(path.join(fixtures, "fake-plan-runner.mjs")));

  const state: Record<string, any> = {
    workspace, repository: repo, plan: PLAN,
    production: { desiredState: "inactive", revision: dayPolicyRevision ?? 83, epoch: 46, liveAdmissions: 0, authority: null },
    ...(dayEvidence ? { dayEvidence } : {}),
    ...(options.clockJump ? { clockJump: options.clockJump } : {}),
    ...(options.laterApproval ? { laterApproval: options.laterApproval } : {}),
    ...(options.stopPressAt ? { stopPress: { at: options.stopPressAt, card: STOP_ID } } : {}),
    queue: { revision: 290, orderValid: true, unpositionedCount: 0, ordered: (options.delegation ? DELEGATED_ACTIONS.map((a) => `arcadia/${a}`) : SCOPED).map((orderKey) => ({ orderKey })) },
    capacity: { observation: { providers: [{ providerId: "claude-code-cli", admitted: true, code: null, reason: "5-hour 20%", receipt: { source: "claude_status_line" } }] } },
    freeze: "allow", broker: { revision: installed, ready: true, transports: true },
    ensure: { fail: false }, activate: { mode: "ok" }, planRunner: { mode: "ok" },
    worker: { pid: 1111, alive: true, heartbeat: options.preWorker === "stale" ? "frozen" : "fresh", newPid: process.pid, ...(options.slowTick ? { slowTick: options.slowTick } : {}) }
  };
  options.state?.(state);
  writeFileSync(path.join(root, "state.json"), JSON.stringify(state, null, 2));

  const marker = path.join(library, `${ID}.consumed.json`);
  /** Write the run record the dashboard writes before the runner execs the card; the runner adds its own pid (this process). */
  const pressEnv = (): Record<string, string> => {
    const kind = options.press;
    if (kind === "none") return {};
    const runId = `20261101000000000-${randomUUID()}`;
    const dir = path.join(library, "runs", "operator", ID, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "descriptor.json"), readFileSync(descriptorPath));
    writeFileSync(path.join(dir, "run.json"), JSON.stringify({
      schema: "arcadia-operator-script-run-v1", runId, scriptId: kind === "other-card" ? "some-other-card" : ID,
      status: kind === "not-running" ? "failed" : "running", pid: kind === "other-parent" ? 1 : process.pid,
      startedAt: new Date(Date.now() - (kind === "stale" ? 10 * 60_000 : 1000)).toISOString()
    }));
    if (kind === "claimed") writeFileSync(path.join(dir, "start-run.claimed"), "x\n");
    // Decision 0163: the runner records Rowan's press of a delegated card as delegated (delegatedPressMarker).
    const delegatedMarker = { kind: "delegated", agent: "rowan", decision: "0163", originatingRun: `${ORIGIN}/${ORIGIN_RUN}` };
    if ((options.delegation && options.pressMarker !== "omit") || options.pressMarker === "forge") {
      const record = JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8"));
      writeFileSync(path.join(dir, "run.json"), JSON.stringify({ ...record, press: delegatedMarker }));
    }
    // Decision 0173: Rowan's press of a card within the day is recorded as delegated under that Decision.
    if (options.dayGrant && options.pressMarker !== "omit") {
      const record = JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8"));
      writeFileSync(path.join(dir, "run.json"), JSON.stringify({ ...record, press: { kind: "delegated", agent: "rowan", decision: "0173", originatingRun: `${DAY_CARD}/${DAY_RUN}` } }));
    }
    return { ARCADIA_OPERATOR_SCRIPT_RUN_ID: runId, ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY: dir, ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR: path.join(dir, "descriptor.json") };
  };
  const env = (overrides: Record<string, string | undefined> = {}, actions = true): NodeJS.ProcessEnv => {
    const base: NodeJS.ProcessEnv = {
      ...process.env, ...GIT_ENV, PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_ROOT: root, FAKE_BIN: bin, FAKE_ARCADIA_ROOT: repoRoot,
      ...(options.delegation === "before-decision" ? clockEnv(BEFORE_DECISION_NOW) : {}),
      ...(options.clockJump || options.slowTick?.during?.clockJumpMs !== undefined ? {
        START_RUN_CLOCK_OFFSET_FILE: path.join(root, "clock-offset"),
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(fixtures, "fake-clock-offset.mjs")).href}`].filter(Boolean).join(" ")
      } : {}),
      ...(actions ? { ARCADIA_OPERATOR_SCRIPT_ID: ID, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: descriptorPath, ...pressEnv() } : {})
    };
    delete base.ANTHROPIC_API_KEY; delete base.CODEX_SANDBOX; delete base.ARCADIA_WORKSPACE; delete base.VITEST;
    for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete base[key]; else base[key] = value; }
    return base;
  };
  const calls = () => (existsSync(path.join(root, "calls.log")) ? parseCallLog<{ tool: string; args: string[]; cwd?: string; operatorId?: string | null }>(readFileSync(path.join(root, "calls.log"), "utf8")) : []);
  const readState = () => JSON.parse(readFileSync(path.join(root, "state.json"), "utf8")) as Record<string, any>;
  const runDirs = () => (existsSync(path.join(library, "runs", ID)) ? readdirSync(path.join(library, "runs", ID)).sort() : []);
  function run(mode: "run" | "preflight" | "--describe" = "run", overrides: Record<string, string | undefined> = {}, actions = mode === "run") {
    const before = new Set(runDirs());
    const result = spawnSync(scriptPath, [mode], { env: env(overrides, actions), encoding: "utf8", timeout: 200_000 });
    const created = runDirs().filter((name) => !before.has(name));
    const dir = created.length ? path.join(library, "runs", ID, created[created.length - 1]) : null;
    const read = (name: string) => (dir && existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : null);
    return {
      status: result.status, stdout: result.stdout, stderr: result.stderr, dir,
      receipt: read("receipt.json") ? JSON.parse(read("receipt.json")!) as Record<string, any> : null,
      handoff: read("failure-handoff.md"), read
    };
  }
  /** Calls that change the host, the runtime, Plan state or production. */
  const mutating = () => calls().filter((call) =>
    (call.tool === "launchctl" && call.args[0] === "kickstart") || call.tool === "plan-runner" || call.tool === "worker-install" ||
    (call.tool === "arcadia" && call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only")) ||
    (call.tool === "arcadia" && (["go-broker ensure", "production activate", "production deactivate"].includes(call.args.slice(0, 2).join(" ")))));
  /** The mutating calls as short names, in order. */
  const sequence = () => mutating().map((call) => call.tool === "arcadia" ? call.args.slice(0, 2).join(" ") : call.tool);
  return { root, repo, origin, library, marker, pin, installed, descriptorPath, scriptPath, env, run, calls, mutating, sequence, readState, workspace, head: () => git(repo, "rev-parse", "HEAD"), status: () => git(repo, "status", "--porcelain"), state };
}
type Box = ReturnType<typeof box>;

/** A refusal before the first mutation: the pinned phase, nothing consumed, nothing changed. */
function expectRefusedClean(b: Box, result: ReturnType<Box["run"]>, phase: string, reason: RegExp | string, headBefore: string) {
  expect(result.status).not.toBe(0);
  expect(result.receipt).toMatchObject({ outcome: "refused", phase, allowanceConsumed: false, mutations: [] });
  expect(result.receipt!.reason).toMatch(reason);
  expect(result.handoff).toContain("nothing was consumed");
  expect(existsSync(b.marker)).toBe(false);
  expect(b.mutating()).toEqual([]);
  expect(b.head()).toBe(headBefore);
}

describe("start-run executor: a standing-grant card is refused unless it re-derives (Decision 0241)", () => {
  const FIRST = dayScenarios(Date.now())[0];
  const STANDING = "standing-start-fixture0001";
  const derives = (b: ReturnType<typeof box>) => b.calls().filter((call) => call.args.slice(0, 2).join(" ") === "start-run derive");
  const withVerdicts = (verdicts: Array<string[] | null>) => (s: Record<string, any>) => { s.derive = { verdicts }; };
  it("asks the deriver to verify this card on disk, once in P0, and passes a card that re-derives", () => {
    const b = box({ dayGrant: FIRST, cardId: STANDING, state: withVerdicts([null]) });
    const result = b.run("preflight");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(derives(b)).toHaveLength(1);
    expect(derives(b)[0].args).toEqual(expect.arrayContaining(["--verify-card", path.join(b.library, `${STANDING}.json`), "--library", b.library]));
    expect(result.receipt!.record.cardRederivedP0).toBe(true);
  });
  it("refuses in P0 with CARD_NOT_DERIVED naming the differing field, before anything is consumed", () => {
    const b = box({ dayGrant: FIRST, cardId: STANDING, state: withVerdicts([["startRun.delegation", "expires_at"]]) });
    const headBefore = b.head();
    expectRefusedClean(b, b.run("preflight"), "P0", /^CARD_NOT_DERIVED: \(P0\).*differing field: startRun\.delegation, expires_at/, headBefore);
    expect(existsSync(path.join(b.library, "runs", "day-grant"))).toBe(false);
  });
  it("refuses a hand-written card whose approval is a standing-grant receipt, whatever its id", () => {
    const b = box({ dayGrant: { ...FIRST, approval: { ...FIRST.approval, standing: true } }, state: withVerdicts([["manifest"]]) });
    expectRefusedClean(b, b.run("preflight"), "P0", /^CARD_NOT_DERIVED: \(P0\).*differing field: manifest/, b.head());
    expect(derives(b)).toHaveLength(1);
  });
  it("re-derives again in P3 before the allowance is consumed, and refuses a card swapped between the two", () => {
    const b = box({ dayGrant: FIRST, cardId: STANDING, state: withVerdicts([null, null, ["title"]]) });
    expect(b.run("preflight").status).toBe(0);
    const headBefore = b.head();
    const result = b.run();
    expect(derives(b)).toHaveLength(3);
    expectRefusedClean(b, result, "P3", /^CARD_NOT_DERIVED: \(P3\).*differing field: title/, headBefore);
    expect(existsSync(path.join(b.library, "runs", "day-grant", `${DAY_CARD}--${DAY_RUN}`, "after-first.claimed"))).toBe(false);
  }, 120_000);
  it("refuses when the fresh derivation cannot run", () => {
    const b = box({ dayGrant: FIRST, cardId: STANDING, state: (s) => { s.derive = { fail: true }; } });
    expectRefusedClean(b, b.run("preflight"), "P0", /^CARD_NOT_DERIVED: \(P0\)/, b.head());
  });
  it("passes a re-derived card whose replay receipt names it, and records that in the run record", () => {
    const b = box({ dayGrant: FIRST, cardId: STANDING, state: (s) => { s.derive = { verdicts: [null] }; } });
    const result = b.run("preflight");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt!.record.replayReceiptP0).toBe(true);
  });
  it.each(["REPLAY_REQUIRED", "REPLAY_MISMATCH", "REPLAY_PREDICTS_NO_LAUNCH"])("refuses a re-derived card with %s in P0, before anything is consumed", (code) => {
    const b = box({ dayGrant: FIRST, cardId: STANDING, state: (s) => { s.derive = { verdicts: [null], replay: { ok: false, code, detail: `the replay says ${code}` } }; } });
    expectRefusedClean(b, b.run("preflight"), "P0", new RegExp(`^${code}: \\(P0\\) the replay says ${code}; no allowance consumed`), b.head());
  });
  it("leaves operator-pressed cards (Decisions 0156, 0157) and day-grant cards (Decision 0173) without a derivation", () => {
    const ordinary = box();
    expect(ordinary.run("preflight").status).toBe(0);
    expect(derives(ordinary)).toHaveLength(0);
    const day = box({ dayGrant: FIRST });
    expect(day.run("preflight").status).toBe(0);
    expect(derives(day)).toHaveLength(0);
  });
});

describe("start-run executor: a derived card under a standing grant passes the delegation check (Decision 0241 E, issue #3001)", () => {
  const DAY = 24 * 3_600_000;
  const STANDING = "standing-start-fixture0001";
  const verdicts = (n: number) => (s: Record<string, any>) => { s.derive = { verdicts: Array(n).fill(null) }; };
  /** The first scenario with its approval a real standing-grant press (receipt, one-shot marker, press record, claim marker), pressed `ageMs` ago. */
  const standing = (ageMs: number, approval: Record<string, unknown> = {}, extra: Partial<DayScenario> = {}): DayScenario => {
    const first = dayScenarios(Date.now())[0];
    return { ...first, ...extra, approval: { ...first.approval, standing: true, pressedAt: Date.now() - ageMs, ...approval } };
  };
  const refusal = (scenario: DayScenario, code: string) => {
    const b = box({ dayGrant: scenario, cardId: STANDING, state: verdicts(1) });
    expectRefusedClean(b, b.run("preflight"), "P0", new RegExp(`^Decision 0173: ${code}: `), b.head());
  };
  it("passes P0 for a standing-grant approval, and records that it has no window", () => {
    const b = box({ dayGrant: standing(3_600_000), cardId: STANDING, state: verdicts(1) });
    const result = b.run("preflight");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt!.record.delegation).toMatchObject({ decision: "0173", approvalKind: "standing", windowClosesAt: null, attempt: 1, previous: null });
  });
  it("does not close a standing grant pressed days ago: it has no 24-hour window", () => {
    const b = box({ dayGrant: standing(5 * DAY), cardId: STANDING, state: verdicts(1) });
    const result = b.run("preflight");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt!.record.delegation).toMatchObject({ approvalKind: "standing", windowClosesAt: null });
  });
  it("keeps the day window for a day grant under a standing-start id: five days old still refuses", () => {
    const first = dayScenarios(Date.now())[0];
    refusal({ ...first, approval: { pressedAt: Date.now() - 5 * DAY } }, "WINDOW_EXPIRED");
  });
  it("runs the press to START for a standing grant: the window check again in P2 and P3, then activation", () => {
    const b = box({ dayGrant: standing(5 * DAY), cardId: STANDING, state: verdicts(3) });
    expect(b.run("preflight").status).toBe(0);
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", productionActivated: true });
    expect(result.receipt!.record.authority).toContain("standing-grant approval");
    expect(result.receipt!.record.authority).toContain("no 24-hour window");
  }, 120_000);
  // Issue #3005: in run mode this press's own record is already the latest START press when the card is re-derived.
  const chained = (n: number) => (s: Record<string, any>) => { s.derive = { verdicts: Array(n).fill(null), chain: true }; };
  const deriveArgs = (b: ReturnType<typeof box>) => b.calls().filter((call) => call.args.slice(0, 2).join(" ") === "start-run derive").map((call) => call.args);
  it("re-derives in run mode leaving out exactly its own in-flight press, in P0 and again in P3 (#3005)", () => {
    const b = box({ dayGrant: standing(5 * DAY), cardId: STANDING, state: chained(3) });
    expect(b.run("preflight").status).toBe(0);
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", productionActivated: true });
    const runId = result.receipt!.record.operatorRunId;
    const own = deriveArgs(b).filter((args) => args.includes("--current-press"));
    expect(own).toHaveLength(2);
    for (const args of own) expect(args[args.indexOf("--current-press") + 1]).toBe(`${STANDING}/${runId}`);
  }, 120_000);
  it("passes no --current-press in preflight, where no press exists yet (#3005)", () => {
    const b = box({ dayGrant: standing(5 * DAY), cardId: STANDING, state: chained(1) });
    const result = b.run("preflight");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(deriveArgs(b)).toHaveLength(1);
    expect(deriveArgs(b)[0]).not.toContain("--current-press");
  });
  it("still refuses CARD_NOT_DERIVED when a different press of any card is unsettled, naming only this run's own press (#3005)", () => {
    const b = box({ dayGrant: standing(5 * DAY), cardId: STANDING, state: chained(3) });
    const other = path.join(b.library, "runs", "operator", "standing-start-other", "20261101000000000-other");
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, "run.json"), JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: "20261101000000000-other", scriptId: "standing-start-other", status: "running" }));
    const headBefore = b.head();
    expectRefusedClean(b, b.run(), "P0", /^CARD_NOT_DERIVED: \(P0\).*differing field: derivation/, headBefore);
  });
  it.each([
    ["an unconsumed standing-grant card (no one-shot marker)", { noConsumedMarker: true }, "APPROVAL_NOT_PRESSED"],
    ["a standing receipt whose outcome is not approved", { receipt: { outcome: "refused" } }, "APPROVAL_NOT_PRESSED"],
    ["a standing receipt whose allowance was not consumed", { receipt: { allowanceConsumed: false } }, "APPROVAL_NOT_PRESSED"],
    ["a standing receipt of a preflight, not a press", { receipt: { mode: "preflight" } }, "APPROVAL_NOT_PRESSED"],
    ["a standing receipt whose id does not match the delegation", { receipt: { id: "another-standing-card" } }, "APPROVAL_NOT_PRESSED"],
    ["a standing receipt whose run does not match the delegation", { receipt: { runId: "20261104T000000Z-1" } }, "APPROVAL_NOT_PRESSED"],
    ["a standing receipt with no press record", { noPressRecord: true }, "APPROVAL_NOT_OPERATOR"],
    ["a standing press not from a browser", { browser: false }, "APPROVAL_NOT_OPERATOR"],
    ["a delegated press as the standing approval", { delegated: true }, "APPROVAL_NOT_OPERATOR"],
    ["a standing press record its run never claimed", { noClaim: true }, "APPROVAL_NOT_OPERATOR"],
    ["a standing press carrying a loose standing-grant block", { pins: { extra: 1 } }, "APPROVAL_NOT_OPERATOR"],
    ["a standing receipt that records a 24-hour window", { record: { windowClosesAt: new Date(Date.now() + DAY).toISOString() } }, "APPROVAL_CHANGED"],
    ["a standing press snapshot changed from what the receipt recorded", { record: { plan: "the-plan-the-receipt-names" } }, "APPROVAL_CHANGED"],
    ["a standing grant for another Plan", { pins: { plan: "another-active-plan" } }, "SCOPE_NOT_APPROVED"]
  ])("refuses %s in P0, before anything is consumed", (_label, approval, code) => {
    refusal(standing(3_600_000, approval), code);
  });
  it("refuses a standing receipt whose press record carries a day-grant block instead of the standing one", () => {
    refusal(standing(3_600_000, {}, { after: (_library, approval) => { const dir = path.dirname(approval.pressPath); const block = JSON.parse(readFileSync(path.join(dir, "descriptor.json"), "utf8")).standingGrant; writeFileSync(path.join(dir, "descriptor.json"), JSON.stringify({ dayGrant: { ...block, schema: "arcadia-day-grant-v1", decision: "0173" } })); } }), "APPROVAL_NOT_OPERATOR");
  });
  it("ends a standing grant on an operator STOP card pressed after it, and not on one pressed before", () => {
    refusal(standing(DAY, {}, { after: (library) => writeStopPress(library, Date.now() - 20 * 60_000) }), "GRANT_ENDED_BY_STOP");
    const b = box({ dayGrant: standing(DAY, {}, { after: (library) => writeStopPress(library, Date.now() - 2 * DAY) }), cardId: STANDING, state: verdicts(1) });
    expect(b.run("preflight").status).toBe(0);
  });
  it("ends a standing grant on the revoke card, which a day grant does not read", () => {
    const revoke = { after: (library: string) => writeStopPress(library, Date.now() - 20 * 60_000, { card: "revoke-standing-grant-20261123" }) };
    refusal(standing(DAY, {}, revoke), "GRANT_REVOKED");
    const first = dayScenarios(Date.now())[0];
    const b = box({ dayGrant: { ...first, ...revoke }, cardId: STANDING, state: verdicts(1) });
    expect(b.run("preflight").status).toBe(0);
  });
  it("ends a standing grant on an operator-issued Off", () => {
    refusal(standing(3 * 3_600_000, {}, { attempt: 2, presses: [{ card: "start-a", at: Date.now() - 40 * 60_000, status: "succeeded", receipt: { outcome: "succeeded", reason: "", productionActivated: true, allowanceConsumed: true } }], steps: [{ activate: "start-a", clean: true }, { off: "dashboard-toggle-1-abcd" }], previous: named(pressKey("start-a"), "scope-complete", "clean-batch") }), "GRANT_ENDED_BY_OFF");
  });
  it("refuses a standing approval a later standing approval supersedes, and ignores a later day approval", () => {
    const later = (spec: Record<string, unknown>) => (library: string) => { writeDayApproval(library, { card: "standing-later", run: "20261104T100000Z-888", press: "20261104100000000-later", pressedAt: Date.now() - 5 * 60_000, ...spec }); };
    refusal(standing(DAY, {}, { after: later({ standing: true }) }), "APPROVAL_SUPERSEDED");
    const b = box({ dayGrant: standing(DAY, {}, { after: later({}) }), cardId: STANDING, state: verdicts(1) });
    expect(b.run("preflight").status).toBe(0);
  });
  it("still applies the chain checks to a standing grant: the pre-mortem pointer, attempt and previous-press cause", () => {
    const noPremortem = box({ dayGrant: standing(3_600_000), cardId: STANDING, noPremortem: true, state: verdicts(1) });
    expectRefusedClean(noPremortem, noPremortem.run("preflight"), "P0", /^Decision 0173: PREMORTEM_REQUIRED: /, noPremortem.head());
    refusal(standing(3_600_000, {}, { attempt: 3 }), "ATTEMPT_MISMATCH");
    refusal(standing(3_600_000, {}, { attempt: 1, previous: null, presses: [{ card: "start-a", at: Date.now() - 40 * 60_000, receipt: {} }] }), "PREVIOUS_CAUSE_REQUIRED");
  });
  it("still needs a fresh preflight before the press of a standing-grant card", () => {
    const b = box({ dayGrant: standing(3_600_000), cardId: STANDING, state: verdicts(1) });
    const result = b.run();
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P0", allowanceConsumed: false });
    expect(result.receipt!.reason).toMatch(/^Decision 0173: PREFLIGHT_REQUIRED: /);
  });
});

describe("start-run executor: P3 consume", () => {
  it("refuses at P3 when another press consumed the allowance after the preflight, still before any mutation", () => {
    const b = box();
    // The freeze check runs in P2; a concurrent press lands its marker right after it.
    const fakePath = path.join(b.root, "bin", "fake-arcadia.mjs");
    writeFileSync(fakePath, readFileSync(fakePath, "utf8").replace("ok({ operation: args[2]", `writeFileSync(${JSON.stringify(b.marker)}, "{}"); ok({ operation: args[2]`));
    const result = b.run();
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P3", allowanceConsumed: false });
    expect(result.receipt!.reason).toMatch(/allowance is consumed/);
    expect(b.mutating()).toEqual([]);
  });
});

describe("start-run executor: the START itself", () => {
  it("installs, restarts, binds the worker and starts production on an active Plan already at the pin", () => {
    const b = box();
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("START GRANTED");
    expect(result.receipt).toMatchObject({ outcome: "succeeded", phase: "P6", allowanceConsumed: true, productionActivated: true, planActivatedByThisCard: false });
    expect(result.receipt!.record.planActivation).toContain("skipped");
    expect(JSON.parse(readFileSync(b.marker, "utf8"))).toMatchObject({ state: "CONSUMED", requestId: ID, reviewedRevision: b.pin });
    // Order: ensure, then the protected install and restart, then the sign-in sequence, then activation; each exactly once.
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in", "production activate"]);
    expect(b.calls().some((call) => call.tool === "launchctl" && call.args[0] === "kickstart")).toBe(false);
    // The install runs the pinned release's own compiled CLI, replacing exactly the pinned label for the live workspace.
    const install = b.calls().find((call) => call.tool === "worker-install")!;
    const release = path.join(b.root, "home", ".local", "share", "arcadia", "go-broker", "releases", b.pin);
    expect(install.args).toEqual([path.join(release, "dist", "src", "cli.js"), "worker", "install", "--replace-label", LABEL, "--workspace", b.workspace]);
    expect(install.cwd).toBe(release);
    const signIn = b.calls().find((call) => call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only"))!;
    expect(signIn.args).toEqual(expect.arrayContaining(["--release", b.pin, "--card", ID, "--policy-revision", "83", "--policy-epoch", "46", "--repository", b.repo, "--workspace", b.workspace]));
    const activate = b.calls().find((call) => call.args.slice(0, 2).join(" ") === "production activate")!;
    expect(activate.args).toEqual(expect.arrayContaining(["--require-current-runtime", "--repository", b.repo, "--request-id", ID, "--expected-revision", "83"]));
    // The worker binding is read live after the restart and recorded.
    const binding = JSON.parse(result.read("worker-binding.json")!);
    expect(binding).toMatchObject({ oldPid: 1111, workerLabel: LABEL, binding: { pid: process.pid, release: b.pin, handlerHash: `handler-${process.pid}` } });
    expect(result.receipt!.record.workerBinding).toMatchObject({ pid: process.pid, release: b.pin });
    // The sequence ran once: the day is claimed, two Decision-only commits are on main and origin, and the receipt gated START.
    expect(result.receipt!.record.signIn).toMatchObject({ outcome: "checked", sequenceClaimed: true });
    expect(result.receipt!.record.signInReceipt).toMatchObject({ release: b.pin, handlerHash: `handler-${process.pid}` });
    expect(git(b.repo, "rev-parse", "HEAD~2")).toBe(b.pin);
    expect(git(b.repo, "diff", "--name-only", b.pin, "HEAD")).toBe(`docs/decisions/${result.receipt!.record.signIn.decision}.md`);
    expect(git(b.origin, "rev-parse", "main")).toBe(b.head());
    expect(result.receipt!.mutations.join("\n")).toContain("this press's renewal sequence consumed");
    expect(result.receipt!.record.runtimeCheck.current).toBe(true);
    expect(b.readState().production).toMatchObject({ desiredState: "active", authority: { requestId: ID } });
    expect(result.handoff).toContain("No failure");
    expect(readFileSync(path.join(result.dir!, "receipt.md"), "utf8")).toContain(`reviewed revision installed: ${b.pin}`);
    // A second press refuses from P0 and touches nothing.
    const before = b.calls().length;
    const second = b.run();
    expect(second.receipt).toMatchObject({ outcome: "refused", phase: "P0", allowanceConsumed: false });
    expect(b.calls().length).toBe(before);
  }, 120_000);

  it("fetches an unfetched pin, fast-forwards only to it, activates the draft Plan through the shared runner, then starts", () => {
    const b = box({ scenario: "pin-unfetched", planStatus: "draft", activation: true, state: (s) => { s.queue.ordered = [{ orderKey: "arcadia/other" }, ...s.queue.ordered]; } });
    // Before activation the pinned Actions are not queued; the fake queue shows them after the runner commits.
    const fakePath = path.join(b.root, "bin", "fake-plan-runner.mjs");
    writeFileSync(fakePath, readFileSync(fakePath, "utf8").replace('git("add", "-A");', `const s = JSON.parse(readFileSync(path.join(root, "state.json"), "utf8")); s.queue.ordered = s.queue.ordered.filter((e) => e.orderKey !== "arcadia/other"); writeFileSync(path.join(root, "state.json"), JSON.stringify(s)); git("add", "-A");`));
    const headBefore = b.head();
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", allowanceConsumed: true, planActivatedByThisCard: true });
    expect(result.receipt!.record.needsPlanActivation).toBe(true);
    expect(result.receipt!.mutations.join(" ")).toContain("fast-forward");
    // The checkout moved to the pin, then the two diagnostic Decision commits, then one governance commit (the activation).
    expect(git(b.repo, "rev-parse", "HEAD~3")).toBe(b.pin);
    expect(git(b.repo, "merge-base", "--is-ancestor", headBefore, b.pin)).toBe("");
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in", "plan-runner", "production activate"]);
    const runner = b.calls().find((call) => call.tool === "plan-runner")!;
    expect(runner.args).toEqual([b.descriptorPath, "run"]);
    expect(runner.operatorId).toBe(ID);
    expect(result.receipt!.record.arcadiaHeadAfterPlanActivation).toBe(b.head());
    expect(result.receipt!.record.runtimeCheck.current).toBe(true);
  }, 120_000);

  it("parses go-broker ensure when its build children print noise on stderr, or (defense in depth) on stdout ahead of the envelope (Issue #1956)", () => {
    for (const stdoutNoise of [false, true]) {
      const b = box({ state: (s) => { s.ensure.stdoutNoise = stdoutNoise; } });
      const result = b.run();
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.receipt).toMatchObject({ outcome: "succeeded", productionActivated: true });
      expect(result.receipt!.record.ensureAction).toBe("installed");
      expect(JSON.parse(result.read("ensure.json")!)).toMatchObject({ ok: true, data: { action: "installed" } });
      expect(result.read("run.log")).toContain("Bridged 4 dependency trees.");
    }
  }, 240_000);

  it.each<[string, string, RegExp]>([
    ["exits non-zero after printing an ok envelope", "nonzero", /go-broker ensure failed; no worker restart was attempted/],
    ["exits zero with ok:false", "notOk", /go-broker ensure did not report success; no worker restart was attempted/]
  ])("refuses, with noise on stdout, when go-broker ensure %s", (_label, ensureResult, reason) => {
    const b = box({ state: (s) => { s.ensure.stdoutNoise = true; s.ensure.result = ensureResult; } });
    const result = b.run();
    expect(result.status).not.toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P4", allowanceConsumed: true });
    expect(result.receipt!.reason).toMatch(reason);
    expect(b.sequence()).toEqual(["go-broker ensure"]);
  }, 60_000);

  it("Decision 0162: a second card on the same America/Los_Angeles date proceeds to START despite earlier sequences today", () => {
    const b = box({ dayUsed: true });
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", productionActivated: true });
    expect(result.receipt!.record.signIn).toMatchObject({ outcome: "checked", sequenceClaimed: true });
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in", "production activate"]);
  }, 120_000);

  it("reuses a fresh receipt of the bound worker: no renewal, no day claimed, no Decision, then starts", () => {
    const b = box({ state: (s) => { s.signin = { mode: "reused" }; } });
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", allowanceConsumed: true, productionActivated: true });
    expect(result.receipt!.record.signIn).toMatchObject({ outcome: "reused", sequenceClaimed: false });
    expect(b.head()).toBe(b.pin);
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
    expect(result.receipt!.mutations.join("\n")).toContain("fresh usage receipt of the bound worker was reused");
  }, 120_000);
});

describe("start-run executor: a slow-tick worker heartbeat (#3030)", () => {
  // The worker writes its usage heartbeat once per tick, about 60 s under load, so one read against the 15 s window finds it
  // stale by chance. Every read waits, within a bound, for a beat that is fresh AND bound; the window itself is unchanged.
  // The fixture's bound is 4 s at a 2 s poll (.start-run-test-fixture): at most 3 live reads.
  const BOUND_POLLS = 3;
  const previewCalls = (b: Box) => b.calls().filter((call) => call.tool === "arcadia" && call.args.slice(0, 2).join(" ") === "production preview").length;

  it("P2 waits for the next beat of a slow-tick worker instead of refusing on one stale read", () => {
    const b = box({ slowTick: { from: "start", recovers: true } });
    const headBefore = b.head();
    const result = b.run("preflight");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "preflight_ok", phase: "P2", allowanceConsumed: false, mutations: [] });
    expect(result.receipt!.record.preRestartHeartbeatWait).toEqual({ outcome: "fresh", polls: 2 });
    expect(result.receipt!.record.preRestartWorkerPid).toBe(1111);
    expect(b.head()).toBe(headBefore);
  });

  it("the P4 sign-in and both P6 reads wait for the next beat after the card is consumed, then START", () => {
    const b = box({ slowTick: { from: "restart", recovers: true } });
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", phase: "P6", allowanceConsumed: true, productionActivated: true });
    expect(result.receipt!.record).toMatchObject({
      signInHeartbeatWait: { outcome: "fresh", polls: 2 }, signInLeadHeartbeatWait: { outcome: "fresh", polls: 2 },
      startHeartbeatWait: { outcome: "fresh", polls: 2 }, activationHeartbeatWait: { outcome: "fresh", polls: 2 }
    });
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in", "production activate"]);
    // The activation wait polled twice, so the whole recheck ran again after it (a third preview) before the activation.
    expect(previewCalls(b)).toBe(3);
    expect(existsSync(path.join(result.dir!, "preview-recheck-after-wait.json"))).toBe(true);
  }, 120_000);

  it("a beat on the first read at every site keeps the single-poll path: two previews, no second recheck", () => {
    const b = box();
    const result = b.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", phase: "P6", productionActivated: true });
    expect(result.receipt!.record).toMatchObject({
      signInHeartbeatWait: { outcome: "fresh", polls: 1 }, signInLeadHeartbeatWait: { outcome: "fresh", polls: 1 },
      startHeartbeatWait: { outcome: "fresh", polls: 1 }, activationHeartbeatWait: { outcome: "fresh", polls: 1 }
    });
    expect(previewCalls(b)).toBe(2);
    expect(existsSync(path.join(result.dir!, "preview-recheck-after-wait.json"))).toBe(false);
    // After the sign-in, P6 reads production status, capacity and the queue as before: once each before the previews, the queue again in the recheck.
    const afterSignIn = b.calls().slice(b.calls().findIndex((call) => call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only")) + 1);
    const count = (key: string) => afterSignIn.filter((call) => call.args.slice(0, 2).join(" ") === key).length;
    expect([count("production capacity"), count("advance queue")]).toEqual([1, 2]);
  }, 120_000);

  it("a pidfile that is not the launchd PID still refuses at once, without waiting", () => {
    const b = box({ preWorker: "pid-mismatch" });
    const headBefore = b.head();
    const result = b.run("preflight");
    expectRefusedClean(b, result, "P2", /stale or mismatched pre-restart worker heartbeat: the pidfile names 2222/, headBefore);
    expect(result.receipt!.record.preRestartHeartbeatWait).toEqual({ outcome: "mismatch", polls: 1 });
  });

  it("a stale-forever pre-restart worker still refuses in P2 within the bound, consuming nothing", () => {
    const b = box({ slowTick: { from: "start", recovers: false } });
    const headBefore = b.head();
    const result = b.run("preflight");
    expectRefusedClean(b, result, "P2", /stale or mismatched pre-restart worker heartbeat: no beat younger than 15000 ms within 4 s/, headBefore);
    expect(result.receipt!.record.preRestartHeartbeatWait).toEqual({ outcome: "stale", polls: BOUND_POLLS });
  });

  it("a worker stale forever after the restart refuses in P4 within the bound, before the sign-in is invoked", () => {
    const b = box({ slowTick: { from: "restart", recovers: false } });
    const result = b.run();
    expect(result.status).not.toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P4", allowanceConsumed: true, productionActivated: false });
    expect(result.receipt!.reason).toMatch(/the bound worker.s heartbeat: no beat younger than 15000 ms within 4 s; the sign-in sequence was not invoked/);
    expect(result.receipt!.record.signInHeartbeatWait).toEqual({ outcome: "stale", polls: BOUND_POLLS });
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install"]);
  }, 120_000);

  it("a worker stale forever after the sign-in refuses in P6 within the bound, with no activation", () => {
    const b = box({ slowTick: { from: "sign-in", recovers: false } });
    const result = b.run();
    expect(result.status).not.toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P6", allowanceConsumed: true, productionActivated: false, offCleanup: "not_attempted" });
    expect(result.receipt!.reason).toMatch(/the worker heartbeat stayed stale after the restart: no beat younger than 15000 ms within 4 s; no activation/);
    expect(result.receipt!.record.startHeartbeatWait).toEqual({ outcome: "stale", polls: BOUND_POLLS });
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in"]);
  }, 120_000);

  // Review B2 of PR #3036: the Off / zero-admission / no-Session guards run after the slow-tick wait, next to the claim.
  it.each<[string, SlowTickDuring, RegExp]>([
    ["a production admission", { stage: "sign-in", liveAdmissions: 1 }, /production must be Inactive at policy revision 83 \/ epoch 46 with zero live admissions/],
    ["a tmux Session", { stage: "sign-in", tmuxSession: "stray-builder" }, /no competing Session may run before the sign-in sequence .*stray-builder/]
  ])("%s appearing during the P4 slow-tick wait refuses before the sign-in claims the day", (_label, during, reason) => {
    const b = box({ slowTick: { from: "restart", recovers: true, during } });
    const result = b.run();
    expect(result.status).not.toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P4", allowanceConsumed: true, productionActivated: false });
    expect(result.receipt!.reason).toMatch(reason);
    expect(result.receipt!.record.signInHeartbeatWait).toEqual({ outcome: "fresh", polls: 2 });
    expect(b.calls().some((call) => call.tool === "sleep-during" && call.args[0] === "sign-in")).toBe(true);
    // No sequence claimed and no credential refresh: the sign-in was never invoked.
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install"]);
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
  }, 120_000);

  // Review B1 of PR #3036: after an activation wait that polled more than once, nothing checked before it is that old at the activation.
  it.each<[string, SlowTickDuring, Record<string, unknown> | undefined, RegExp]>([
    ["the queue moves", { stage: "activation", queueRevision: 291 }, undefined, /queue revision changed from the reviewed 290 to 291|queue moved after preview; no activation/],
    ["the credential window shrinks below five minutes", { stage: "activation", clockJumpMs: 120_000 }, { expiresInMs: 6 * 60_000 }, /credential expiry: the sign-in has expired or expires within 5 minutes/],
    ["a production admission appears", { stage: "activation", liveAdmissions: 1 }, undefined, /production must be Inactive at policy revision 83 \/ epoch 46 with zero live admissions/]
  ])("%s during the P6 activation wait refuses with no activation", (_label, during, signin, reason) => {
    const b = box({ slowTick: { from: "sign-in", recovers: true, during }, ...(signin ? { state: (s: Record<string, any>) => { s.signin = signin; } } : {}) });
    const result = b.run();
    expect(result.status).not.toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P6", allowanceConsumed: true, productionActivated: false, offCleanup: "not_attempted" });
    expect(result.receipt!.reason).toMatch(reason);
    expect(result.receipt!.record.activationHeartbeatWait).toEqual({ outcome: "fresh", polls: 2 });
    expect(b.calls().some((call) => call.tool === "sleep-during" && call.args[0] === "activation")).toBe(true);
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in"]);
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 120_000);
});
