import { writeFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { renderProductionStatusSuccess, runProductionStatusCommand } from "../../../src/commands/production.js";
import { withDatabase as defaultWithDatabase, withReadOnlyDatabase } from "../../../src/db/connection.js";
import { loadPhase3Registries as defaultLoadRegistries } from "../../../src/intent/registries.js";
import {
  listOperatorEscalations,
  runManagedProductionTick as defaultTick,
  type ManagedProductionTickProjectResult
} from "../../../src/production/tick.js";
import { listOpenRedAlerts } from "../../../src/production/redAlerts.js";
import { processPreservationRequests as defaultProcessPreservationRequests } from "../../../src/sessions/preservationTransport.js";
import type { CandidatePreservationReceipt } from "../../../src/sessions/candidatePreservation.js";
import { validatePreservationCandidate } from "../../../src/sessions/preservationValidation.js";
import { capacity, git, hostReviewer, LINE_A, LINE_B, LINE_C, Rehearsal, unsandboxedValidator } from "../../helpers/rehearsalHarness.js";
import type { IsolatedProcess } from "./environment.js";
import { ScriptedExecutor, type ActionWork, type ExecutorBehaviour, type ExecutorResult, type LaunchRecord } from "./executor.js";
import { GitHubModel } from "./github.js";
import { PhaseRecorder, sanitizer, writeScenarioReport, type Phase, type ScenarioReport } from "./report.js";

/**
 * Per-scenario hang detector, like the suite's 120 s default (vitest.config.ts)
 * but with room for a slow CI runner: a scenario takes 5 to 25 s on the
 * operator's Mac.
 */
export const SCENARIO_TIMEOUT_MS = 240_000;

/** The two dependent Actions of the shared rehearsal fixture: write MARKER.md, then extend it and add a test that depends on it. */
export const ACTION_1 = "write-marker-a";
export const ACTION_2 = "write-marker-b";
/** Only in a world built with `{ thirdAction: true }`: append action C's line (depends on B). */
export const ACTION_3 = "write-marker-c";
export const WORK: Record<string, ActionWork> = {
  [ACTION_1]: { files: { "MARKER.md": `${LINE_A}\n` }, validation: "node scripts/check-marker.mjs" },
  [ACTION_2]: {
    files: {
      "MARKER.md": `${LINE_A}\n${LINE_B}\n`,
      "tests/marker.test.mjs": `import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
test("marker lines are in order", () => {
  assert.ok(readFileSync("MARKER.md", "utf8").startsWith(${JSON.stringify(`${LINE_A}\n${LINE_B}\n`)}));
});
`
    },
    validation: "node scripts/check-marker.mjs && node --test tests/marker.test.mjs"
  },
  [ACTION_3]: { files: { "MARKER.md": `${LINE_A}\n${LINE_B}\n${LINE_C}\n` }, validation: "node scripts/check-marker.mjs" }
};

type TickImpl = {
  runManagedProductionTick: typeof defaultTick;
  validatePreservationCandidate: typeof validatePreservationCandidate;
  unsandboxedValidator: typeof unsandboxedValidator;
  processPreservationRequests: typeof defaultProcessPreservationRequests;
  withDatabase: typeof defaultWithDatabase;
  loadPhase3Registries: typeof defaultLoadRegistries;
};

/**
 * One fast-rehearsal scenario: the shared hermetic rehearsal fixture
 * ({@link Rehearsal}: real workspace, real Project repository, real
 * `project import` / `docs sync` / `work plan` / `review approve` /
 * `production activate`, a local bare `origin`, remote preservation on) driven
 * by the REAL worker tick, with only the external seams replaced:
 *
 * - tmux: the shared `FakeTmux` records each launch; {@link execute} hands
 *   that launch to the {@link ScriptedExecutor} and then ends the pane.
 * - GitHub: {@link GitHubModel} (the shared `FakeGitHub` plus GitHub-accurate
 *   PR base, files and body).
 * - the reviewer model: the shared fake's stubbed verdicts.
 * - provider capacity and sign-in: the shared fixture observation.
 *
 * Everything else -- admission, the Grant, packet preparation, launch,
 * reconciliation, preservation and its validation, PR readiness, both review
 * commands, integration, settlement, pointer and queue advancement -- is the
 * production code, called as `arcadia worker` calls it (src/commands/worker.ts:
 * preservation requests serviced, then `runManagedProductionTick`), with an
 * injected clock, `agentWorktreeRoot` and the validator choice as the only
 * differences in its options (see {@link tick} and README.md).
 */
export class FastRehearsal extends Rehearsal {
  readonly recorder: PhaseRecorder;
  readonly gh: GitHubModel;
  readonly executor: ScriptedExecutor;
  readonly validator: ScenarioReport["validator"];
  readonly executions: ExecutorResult[] = [];
  /** How many host preservation validations the tick ran. */
  hostValidations = 0;
  private tickNumber = 0;
  private impl: TickImpl = {
    runManagedProductionTick: defaultTick,
    validatePreservationCandidate,
    unsandboxedValidator,
    processPreservationRequests: defaultProcessPreservationRequests,
    withDatabase: defaultWithDatabase,
    loadPhase3Registries: defaultLoadRegistries
  };
  /** The Action launched and not yet integrated. */
  private inFlight: string | null = null;
  /** Whether the in-flight Action's terminal handoff has preserved it. */
  private preserved = false;
  private lastIntegrated: string | null = null;
  private expecting: string | null = null;

  constructor(readonly scenario: string, readonly isolation: IsolatedProcess, file: string, options: { thirdAction?: boolean } = {}) {
    super({ independentReviewers: "tick", ...(options.thirdAction ? { thirdAction: true } : {}) });
    process.env.ARCADIA_WORKSPACE = this.workspace;
    this.validator = process.env.ARCADIA_PRESERVATION_HOST_TEST === "1" ? "seatbelt" : "unsandboxed";
    this.recorder = new PhaseRecorder(scenario, path.basename(file), sanitizer([
      [this.root, "<scenario>"], [isolation.root, "<isolated>"], [isolation.originalHome, "~"]
    ]));
    this.gh = new GitHubModel(this.github, this.recorder);
    this.executor = new ScriptedExecutor(this.workspace, this.recorder, path.join(this.root, "unreachable-from-the-agent-sandbox"));
  }

  /** Runbook preparation: fixture, import, sync, packet approval, preview and activation. */
  start(): void {
    const started = performance.now();
    this.createFixtureRepository();
    this.approve(this.registerProject());
    this.activate();
    this.recorder.notes.push(`setup (fixture, import, sync, approval, activation): ${Math.round(performance.now() - started)} ms`);
  }

  /** Flag lifecycle errors matching `pattern` as expected by this scenario. */
  expectError(pattern: RegExp): void {
    this.recorder.expect(pattern);
  }

  actionKey(actionId: string): string {
    return `${this.projectSlug}/${actionId}`;
  }

  /**
   * One worker iteration, one simulated minute later, as `arcadia worker`
   * runs it (src/commands/worker.ts): service preservation requests, and run
   * the managed tick only when none was serviced. Live, the worker iterates
   * every few seconds and the review step polls on its own deadlines; here the
   * injected clock moves one minute per tick. Unlike the worker's
   * `runManagedProductionIteration`, a tick that throws is not caught and
   * logged: it fails the scenario, which makes the harness stricter.
   */
  override tick(): ManagedProductionTickProjectResult {
    this.tickNumber += 1;
    const n = this.tickNumber;
    this.now = new Date(this.now.getTime() + 60_000);
    const impl = this.impl;
    const validate: typeof validatePreservationCandidate = (...args) => {
      this.hostValidations += 1;
      return this.recorder.measure("validation", () => (this.validator === "seatbelt" ? impl.validatePreservationCandidate(...args) : impl.unsandboxedValidator(...args)));
    };
    return this.recorder.tick(n, () => {
      this.syncTmux();
      const registries = impl.loadPhase3Registries(this.workspace);
      if (!registries.providerAdapters) throw new Error("The fixture workspace has no provider-adapters registry.");
      const adapters = registries.providerAdapters;
      if (impl.withDatabase(this.workspace, (db) => impl.processPreservationRequests(db, this.workspace))) {
        this.log.push(`[tick ${n}] (harness) a preservation request was serviced; the worker skips the managed tick this iteration`);
        return { projectSlug: this.projectSlug, repositoryRoot: null, baseBranchAdvance: null, reconciled: [], handoff: null, launch: null };
      }
      const result = impl.withDatabase(this.workspace, (db) => impl.runManagedProductionTick(db, this.workspace, {
        profiles: registries.codingAgents.profiles,
        adapters,
        tmux: this.tmux,
        now: this.now,
        clock: () => this.now,
        heartbeat: () => { this.heartbeats += 1; },
        capacityObservation: capacity(this.provider),
        providerSignIn: () => ({ signedIn: true, remedy: "" }),
        agentWorktreeRoot: this.worktrees,
        log: (message) => this.log.push(`[tick ${n}] ${message}`),
        handoff: { preserve: { validate, remote: this.gh.remote } },
        review: { runCommand: this.gh.runCommand, selectReviewer: () => hostReviewer() }
      }));
      const project = result.projects.find((entry) => entry.projectSlug === this.projectSlug);
      this.syncTmux();
      if (!project) throw new Error("The fixture Project was not visited by the tick.");
      return project;
    }, (result) => this.classify(n, result));
  }

  /** Publish the FakeTmux live set to the PATH `tmux` fake (see environment.ts). */
  private syncTmux(): void {
    writeFileSync(this.isolation.tmuxLive, [...this.tmux.live].map((name) => `${name}\n`).join(""));
  }

  /** Attribute one tick to a phase and Action, and record the lifecycle's own refusals. */
  private classify(n: number, result: ManagedProductionTickProjectResult): { phase: Phase; actionId: string | null; summary: string } {
    const launched = result.launch?.outcome === "launched" ? result.launch.actionKey?.split("/").at(-1) ?? null : null;
    const integration = result.handoff?.integration;
    const preservation = result.handoff?.preservation;
    const summary = [
      result.launch ? `launch ${result.launch.outcome}${result.launch.actionKey ? ` ${result.launch.actionKey}` : ""}`
        + (result.launch.outcome === "launched" || !result.launch.reason ? "" : ` (${result.launch.reason.slice(0, 160)})`) : null,
      result.reconciled.length ? `reconciled ${result.reconciled.map((entry) => entry.outcome).join(",")}` : null,
      preservation ? `preservation ${preservation.kind}` : null,
      integration ? `integration ${integration.kind}` : null
    ].filter(Boolean).join("; ") || "idle";
    this.recordLifecycleErrors(n, result);
    let phase: Phase;
    let actionId: string | null;
    if (integration?.kind === "integrated" && this.inFlight) {
      phase = "integration";
      actionId = this.inFlight;
      this.recorder.outcome(this.inFlight, "integrated");
      this.lastIntegrated = this.inFlight;
      this.inFlight = null;
      this.preserved = false;
    } else if (launched) {
      phase = "queueWait";
      actionId = launched;
      if (this.inFlight !== launched) this.preserved = false;
      this.inFlight = launched;
      this.recorder.outcome(launched, "launched");
    } else if (this.inFlight && (result.reconciled.length > 0 || (preservation?.kind === "preserved" && !preservation.replayed && !this.preserved))) {
      phase = "gitFinalization";
      actionId = this.inFlight;
      if (preservation?.kind === "preserved") { this.preserved = true; this.recorder.outcome(this.inFlight, "preserved"); }
    } else if (this.inFlight && this.preserved) {
      phase = "review";
      actionId = this.inFlight;
    } else if (this.inFlight) {
      phase = "gitFinalization";
      actionId = this.inFlight;
    } else if (this.lastIntegrated) {
      phase = "advancement";
      actionId = this.lastIntegrated;
    } else {
      phase = "queueWait";
      actionId = this.expecting;
    }
    this.recorder.current = this.inFlight ?? actionId;
    return { phase, actionId, summary };
  }

  private recordLifecycleErrors(n: number, result: ManagedProductionTickProjectResult): void {
    const record = (command: string, stderr: string) => this.recorder.error({ kind: "lifecycle", command, cwd: this.repo, exitCode: null, stderr, expected: false });
    if (result.launch && ["failed", "repair_budget_exhausted"].includes(result.launch.outcome)) record("worker tick: launch", result.launch.reason);
    if (result.handoff?.preservation.kind === "refused") record("worker tick: terminal preservation", result.handoff.preservation.reason);
    const integration = result.handoff?.integration;
    if (integration?.kind === "refused" && !/independent|verdict|review|ready/i.test(integration.reason)) record("worker tick: integration", integration.reason);
    for (const line of this.log.filter((entry) => entry.startsWith(`[tick ${n}] `))) {
      if (/\b(error|failed|cannot integrate|not_integrable|aborted?)\b/i.test(line)) record("worker tick: log", line.replace(/^\[tick \d+\] /, ""));
    }
  }

  /** Tick until `actionId` is admitted and launched; returns its Session and the launch tmux was asked to run. */
  untilLaunched(actionId: string, limit = 6): { session: NonNullable<ReturnType<Rehearsal["lease"]>>; launch: LaunchRecord } {
    this.expecting = actionId;
    const before = this.tmux.launches.length;
    this.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === this.actionKey(actionId), limit);
    const session = this.lease();
    if (!session || session.action_id !== actionId) throw new Error(`No live lease for ${actionId} after its launch.`);
    const launch = this.tmux.launches.slice(before).find((entry) => entry.name === session.tmux_session_name);
    if (!launch) throw new Error(`tmux was never asked to start ${session.tmux_session_name}.`);
    return { session, launch };
  }

  /** The agent process runs (the scripted executor), then its pane ends. */
  execute(launch: LaunchRecord, actionId: string, behaviour: ExecutorBehaviour = "clean"): ExecutorResult {
    this.recorder.current = actionId;
    try {
      const result = this.executor.run(launch, WORK[actionId], behaviour);
      this.executions.push(result);
      return result;
    } finally {
      this.tmux.exit(launch.name);
      this.syncTmux();
    }
  }

  /** Tick until the in-flight Action integrates (terminal reconcile, preservation, readiness, both reviews, fast-forward). */
  untilIntegrated(actionId: string, limit = 8): ManagedProductionTickProjectResult {
    return this.tickUntil((r) => r.handoff?.integration.kind === "integrated" && this.lastIntegrated === actionId, limit).at(-1)!;
  }

  /**
   * A worker restart: the next tick runs on a freshly evaluated module graph
   * (vi.resetModules), new database connections and new registries. What a
   * restart cannot lose is external and kept: the workspace database, the
   * repositories, the tmux server's panes and GitHub.
   */
  async restartWorker(): Promise<void> {
    vi.resetModules();
    const [tick, transport, connection, registries, validation, harness] = await Promise.all([
      import("../../../src/production/tick.js"),
      import("../../../src/sessions/preservationTransport.js"),
      import("../../../src/db/connection.js"),
      import("../../../src/intent/registries.js"),
      import("../../../src/sessions/preservationValidation.js"),
      import("../../helpers/rehearsalHarness.js")
    ]);
    this.impl = {
      runManagedProductionTick: tick.runManagedProductionTick,
      validatePreservationCandidate: validation.validatePreservationCandidate,
      unsandboxedValidator: harness.unsandboxedValidator,
      processPreservationRequests: transport.processPreservationRequests,
      withDatabase: connection.withDatabase,
      loadPhase3Registries: registries.loadPhase3Registries
    };
    this.recorder.notes.push(`worker restarted before tick ${this.tickNumber + 1} (fresh module graph)`);
  }

  /** Run `count` more worker ticks. */
  ticks(count: number): ManagedProductionTickProjectResult[] {
    return Array.from({ length: count }, () => this.tick());
  }

  escalations() {
    return withReadOnlyDatabase(this.workspace, (db) => listOperatorEscalations(db));
  }

  redAlerts() {
    return withReadOnlyDatabase(this.workspace, (db) => listOpenRedAlerts(db));
  }

  /**
   * Let `ms` of simulated time pass with no tick (the worker idle or the
   * operator away), so a following tick sees any time-based lifecycle rule:
   * stall detection, deadlines. Stays inside the activation's 12-hour Grant.
   */
  advanceClock(ms: number): void {
    this.now = new Date(this.now.getTime() + ms);
    this.recorder.notes.push(`clock advanced ${Math.round(ms / 60_000)} simulated minutes before tick ${this.tickNumber + 1}`);
  }

  /** `arcadia production status` as the operator reads it: its data and its rendered text. */
  productionStatus(): { data: ReturnType<typeof runProductionStatusCommand>["data"]; text: string } {
    const response = runProductionStatusCommand({ workspace: this.workspace });
    return { data: response.data, text: renderProductionStatusSuccess(response).join("\n") };
  }

  /** The fake GitHub PR for one Action's candidate branch. */
  pullRequestFor(actionId: string) {
    const session = this.sessions().find((entry) => entry.action_id === actionId);
    return session ? this.gh.prs.find((pr) => pr.branch === session.branch) ?? null : null;
  }

  /** The worker's preservation receipt for one Action's (latest) Session, or null. */
  preservationReceipt(actionId: string): CandidatePreservationReceipt | null {
    const session = this.sessions().filter((entry) => entry.action_id === actionId).at(-1);
    if (!session) return null;
    const row = withReadOnlyDatabase(this.workspace, (db) => db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?")
      .get(`worker-tick-preserve-${session.id}`) as { receipt_json: string } | undefined);
    return row ? JSON.parse(row.receipt_json) as CandidatePreservationReceipt : null;
  }

  /** Commits on the Project's local base, oldest first. */
  baseHistory(): string[] {
    return git(this.repo, ["rev-list", "--reverse", "refs/heads/main"]).split("\n").filter(Boolean);
  }

  /** Build the report, write it for `pnpm fast-rehearsal`, and return it. */
  finish(): ScenarioReport {
    const report = this.recorder.build(this.validator, this.tickNumber, this.log);
    writeScenarioReport(report);
    return report;
  }
}
