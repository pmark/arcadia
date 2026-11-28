import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startRunLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import type { StartRunPins } from "../src/operatorActions/startRunPins.js";
import { CONTINUE_ANSWER, CONTINUE_SLUG } from "../src/operatorActions/startRunDayGrant.js";
import { DAY_CARD, DAY_RUN, OLD_FIX_COMMIT, STOP_ID, writeDayScenario, type DayScenario } from "./helpers/dayGrantFixture.js";

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
  // Issue #3189: the quiet-host check reads load1 with `sysctl -n vm.loadavg` (macOS's "{ 1m 5m 15m }" shape).
  shim("sysctl", `if [ "$1 $2" = "-n vm.loadavg" ]; then echo "{ 1.25 1.10 1.05 }"; exit 0; fi; exit 1`);
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

describe("start-run executor: failures after the first mutation", () => {
  function consumed(b: Box, result: ReturnType<Box["run"]>, phase: string, reason: RegExp) {
    expect(result.status).not.toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "refused", phase, allowanceConsumed: true });
    expect(result.receipt!.reason).toMatch(reason);
    expect(existsSync(b.marker)).toBe(true);
    expect(result.handoff).toContain("one-shot allowance is consumed forever");
    expect(result.receipt!.mutations[0]).toContain("allowance consumed");
    // A second press never repeats: it refuses from the marker before touching anything.
    const before = b.calls().length;
    const second = b.run();
    expect(second.receipt).toMatchObject({ outcome: "refused", phase: "P0", allowanceConsumed: false });
    expect(b.calls().length).toBe(before);
  }

  it("keeps the fast-forward and refuses with no restart when go-broker ensure fails", () => {
    const b = box({ scenario: "behind", state: (s) => { s.ensure.fail = true; } });
    const result = b.run();
    consumed(b, result, "P4", /go-broker ensure failed; no worker restart was attempted/);
    expect(b.sequence()).toEqual(["go-broker ensure"]);
    expect(b.head()).toBe(b.pin);
    expect(result.handoff).toContain("fast-forwarded to the pinned revision");
    expect(result.handoff).toContain("The runtime stays upgraded; there is no rollback");
    expect(result.handoff).not.toContain("restart was attempted: the worker");
    expect(result.handoff).toContain("No sign-in renewal ran");
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 60_000);

  it("does not restart when the installed broker is not the reviewed revision", () => {
    const b = box({ state: (s) => { s.ensure.noop = true; } });
    // ensure succeeds but leaves the old release installed
    const fakePath = path.join(b.root, "bin", "fake-arcadia.mjs");
    writeFileSync(fakePath, readFileSync(fakePath, "utf8").replace('state.broker.revision = git("rev-parse", "HEAD");', 'if (!state.ensure.noop) state.broker.revision = git("rev-parse", "HEAD");'));
    const result = b.run();
    consumed(b, result, "P4", /not the reviewed revision .* no worker restart was attempted/);
    expect(b.sequence()).toEqual(["go-broker ensure"]);
  }, 60_000);

  it("keeps production Off and runs no renewal when the protected install or restart fails", () => {
    const b = box({ state: (s) => { s.install = { fail: true }; } });
    const result = b.run();
    consumed(b, result, "P4", /protected worker install or restart failed: the worker may be down or still source-run; production stays Off and no renewal ran/);
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install"]);
    expect(result.read("worker-install.log")).toContain("launchctl bootstrap failed");
    expect(result.handoff).toContain("protected worker install and restart was attempted");
    expect(result.handoff).toContain("No sign-in renewal ran");
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 60_000);

  it.each<[string, (s: Record<string, any>) => void, RegExp]>([
    ["no new PID", (s) => { s.worker.noRestart = true; }, /did not come back with a new PID/],
    ["a stale heartbeat", (s) => { s.worker.heartbeat = "stale"; }, /no fresh worker heartbeat/],
    ["a heartbeat bound to the wrong release", (s) => { s.worker.heartbeat = "wrong_release"; }, /no fresh worker heartbeat bound to the new pid .* and release/],
    ["a heartbeat with no binding (still source-run)", (s) => { s.worker.heartbeat = "unbound"; }, /no fresh worker heartbeat bound to the new pid .* and release/],
    ["no heartbeat after the restart", (s) => { s.worker.heartbeat = "none"; }, /no fresh worker heartbeat/],
    ["transports that never become ready", (s) => { s.broker.transports = false; }, /no fresh worker heartbeat/]
  ])("refuses %s after the restart, before any renewal", (_label, mutate, reason) => {
    const b = box({ state: mutate });
    const result = b.run();
    consumed(b, result, "P4", reason);
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install"]);
    expect(result.handoff).toContain("protected worker install and restart was attempted");
    expect(existsSync(path.join(result.dir!, "worker-binding.json"))).toBe(false);
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
  }, 60_000);

  it("passes the real press check against the shell-made press layout, and refuses a press claimed by another run", () => {
    const ok = box();
    const good = ok.run();
    expect(good.status, good.stderr).toBe(0);
    expect(ok.calls().filter((call) => call.tool === "press-check").map((call) => call.args[0])).toEqual(["0"]);
    const bad = box({ state: (s) => { s.tamperClaimed = true; } });
    const result = bad.run();
    consumed(bad, result, "P4", /start-run sign-in runs only inside a pressed START card: the press record's start-run\.claimed marker is not this run.*\[code NOT_A_CARD_PRESS; sequenceClaimed false\]/);
    expect(existsSync(path.join(bad.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
  }, 180_000);

  it("re-checks capacity and production Off in the sign-in phase and refuses before the day is claimed", () => {
    const b = box({ state: (s) => { s.exhaustCapacityAfterInstall = true; } });
    const result = b.run();
    consumed(b, result, "P4", /refuses claude-code-cli/);
    expect(result.receipt!.phaseName).toBe("sign_in");
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install"]);
    expect(existsSync(path.join(b.workspace, ".arcadia", "claude-renewal-days"))).toBe(false);
    expect(result.handoff).toContain("No sign-in renewal ran");
  }, 60_000);

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["the renewal fails", { mode: "renewal_failed" }, /sign-in sequence did not succeed, so there is no START: the Haiku sign-in renewal failed.*\[code RENEWAL_FAILED; sequenceClaimed true\]/],
    ["the worker usage check fails", { mode: "check_failed" }, /sign-in sequence did not succeed, so there is no START: the worker usage check does not allow START.*\[code CHECK_FAILED; sequenceClaimed true\]/],
    ["the check succeeds but the credential expires within 5 minutes", { expiresInMs: 120_000 }, /credential expiry: the sign-in has expired or expires within 5 minutes/],
    ["a usage window is at 100%", { windowPercent: 100 }, /usage window unknown or at 100%/],
    ["the weekly window is missing (ruling A keeps it required)", { omitWeekly: true }, /usage window unknown or at 100%/],
    ["the weekly window is at 100% with no 5-hour window", { omitFiveHour: true, weeklyPercent: 100 }, /usage window unknown or at 100%/]
  ])("consumes the card and its sequence with no START or retry when %s", (_label, signin, reason) => {
    const b = box({ state: (s) => { s.signin = signin; } });
    const result = b.run();
    consumed(b, result, "P4", reason);
    expect(result.receipt!.phaseName).toBe("sign_in");
    expect(b.sequence()).toEqual(["go-broker ensure", "worker-install", "start-run sign-in"]);
    expect(b.calls().filter((call) => call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only"))).toHaveLength(1);
    expect(result.handoff).toContain("that sequence is consumed");
    expect(result.handoff).toContain("no calendar-day wait, Decision 0162");
    expect(result.receipt!.runtimeUpgraded).toBe(true);
    expect(b.readState().production.desiredState).toBe("inactive");
    // This press's sequence is recorded (an audit record, never a reason to refuse a later card: Decision 0162).
    expect(readdirSync(path.join(b.workspace, ".arcadia", "claude-renewal-days")).length).toBeGreaterThan(0);
  }, 60_000);

  it("keeps the Plan activation allowance consumed and production Off when the activation runner fails", () => {
    const b = box({ planStatus: "draft", activation: true, state: (s) => { s.planRunner.mode = "fail"; } });
    const result = b.run();
    consumed(b, result, "P5", /Plan-activation runner did not succeed|runner failed/);
    expect(result.handoff).toContain("Plan-activation runner was invoked. It is replay-safe");
    expect(result.receipt!.planActivatedByThisCard).toBe(false);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 60_000);

  it("refuses without activating when the preview differs from the expected fingerprint", () => {
    const b = box({ state: (s) => { s.preview = { fingerprint: "0".repeat(32) }; } });
    const result = b.run();
    consumed(b, result, "P6", /preview differs from the exact 3-Action/);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
    expect(result.receipt!.offCleanup).toBe("not_attempted");
    expect(result.handoff).toContain("No production activation was attempted");
  }, 120_000);

  it("returns only this Grant to Off when activation commits but the command fails", () => {
    const b = box({ state: (s) => { s.activate.mode = "committed_then_crash"; } });
    const result = b.run();
    consumed(b, result, "P6", /activate command failed or timed out/);
    expect(result.receipt).toMatchObject({ offCleanup: "returned_off", productionActivated: true });
    expect(b.calls().filter((call) => call.args.slice(0, 2).join(" ") === "production deactivate")).toHaveLength(1);
    expect(b.readState().production.desiredState).toBe("inactive");
    expect(result.handoff).toContain("returned only this Grant to Off");
    expect(result.handoff).toContain("The runtime stays upgraded; there is no rollback");
  }, 120_000);

  it("returns Off when the active policy is not the previewed fingerprint", () => {
    const b = box({ state: (s) => { s.activate.mode = "wrong_fingerprint"; } });
    const result = b.run();
    consumed(b, result, "P6", /not the previewed fingerprint/);
    expect(result.receipt!.offCleanup).toBe("returned_off");
  }, 120_000);

  it("reports an activation that never took effect without issuing an Off", () => {
    const b = box({ state: (s) => { s.activate.mode = "unconfirmed"; } });
    const result = b.run();
    consumed(b, result, "P6", /did not confirm Active/);
    expect(result.receipt!.offCleanup).toBe("not_active");
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production deactivate")).toBe(false);
  }, 120_000);

  it("tells the operator to press STOP when the Off cannot be confirmed", () => {
    const b = box({ state: (s) => { s.activate.mode = "committed_then_crash"; s.deactivate = { fail: true }; } });
    const result = b.run();
    consumed(b, result, "P6", /activate command failed/);
    expect(result.receipt!.offCleanup).toBe("OFF_FAILED");
    expect(result.handoff).toContain("Press the STOP button (restore-off-production) NOW");
  }, 120_000);

  it("refuses when runtime-check reports the installed runtime is not current, after the restart", () => {
    const b = box({ state: (s) => { s.runtimeStale = true; } });
    const result = b.run();
    consumed(b, result, "P4", /installed runtime is not current/);
    expect(result.receipt!.runtimeUpgraded).toBe(true);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
  }, 60_000);

  it.each([["owner"], ["handler"]])("refuses with no activation when the worker %s changes between the previews", (kind) => {
    const b = box({ state: (s) => { s.breakOnPreview = kind; } });
    const result = b.run();
    consumed(b, result, "P6", /worker changed after preview; no activation/);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
    expect(result.receipt!.offCleanup).toBe("not_attempted");
  }, 120_000);

  it("binds the operator run id into the receipt and claims the press record once", () => {
    const b = box();
    const result = b.run();
    expect(result.status, result.stderr).toBe(0);
    const runId = readdirSync(path.join(b.library, "runs", "operator", ID))[0];
    expect(result.receipt!.record.operatorRunId).toBe(runId);
    expect(existsSync(path.join(b.library, "runs", "operator", ID, runId, "start-run.claimed"))).toBe(true);
  }, 120_000);

  it("records the unbound pre-restart worker, the bound handler and a runtimeUpgraded flag on success", () => {
    const b = box();
    const result = b.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.receipt!.runtimeUpgraded).toBe(true);
    expect(result.receipt!.record).toMatchObject({ preRestartBinding: null, postRestartHandlerHash: `handler-${process.pid}` });
    expect(result.receipt!.record.signInReceipt.windows).toHaveLength(2);
  }, 120_000);

  it("starts on a weekly-only usage receipt: an absent 5-hour window is no limit (operator ruling A)", () => {
    const b = box({ state: (s) => { s.signin = { omitFiveHour: true }; } });
    const result = b.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.receipt!.record.signInReceipt.windows).toEqual([expect.objectContaining({ label: "7d", usedPercentage: 30 })]);
  }, 120_000);

  it("refuses the START when the retained usage receipt changes after the sequence", () => {
    // The fake appends to every retained receipt at each runtime-check made after the sequence passed its own gate.
    const b = box({ state: (s) => { s.tamperReceiptsOnRuntimeCheck = true; } });
    const result = b.run();
    expect(result.receipt).toMatchObject({ outcome: "refused", phase: "P6", allowanceConsumed: true });
    expect(result.receipt!.reason).toMatch(/worker usage receipt drift/);
    expect(b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate")).toBe(false);
  }, 120_000);

  it("forwards a TERM to the stage so an in-flight activation is returned to Off", async () => {
    const b = box({ state: (s) => { s.activate.mode = "slow"; } });
    const child = spawn(b.scriptPath, ["run"], { env: b.env() });
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 100_000;
    while (!b.calls().some((call) => call.args.slice(0, 2).join(" ") === "production activate") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    child.kill("SIGTERM");
    const code = await exited;
    expect(code).not.toBe(0);
    const dir = path.join(b.library, "runs", ID);
    const run = path.join(dir, readdirSync(dir)[0]);
    const receipt = JSON.parse(readFileSync(path.join(run, "receipt.json"), "utf8"));
    expect(receipt).toMatchObject({ outcome: "refused", allowanceConsumed: true, offCleanup: "returned_off" });
    expect(receipt.reason).toMatch(/interrupted by a signal/);
    expect(b.readState().production.desiredState).toBe("inactive");
  }, 150_000);
});
