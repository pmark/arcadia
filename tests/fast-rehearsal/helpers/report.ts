import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

/**
 * Per-phase timings and exact errors for one scenario.
 *
 * Phases (see README.md for how each tick is attributed):
 * - `queueWait`: worker ticks until the tick that admits and launches the Action.
 * - `agentExecution`: the scripted executor's edits in the candidate.
 * - `validation`: the executor's own validation run plus the host's
 *   preservation validation (Seatbelt or the unsandboxed binding).
 * - `gitFinalization`: the executor's commit and completion draft/preview/
 *   settle, the terminal tick that reconciles and preserves, and every push
 *   and pull-request write through the preservation remote.
 * - `review`: ticks after preservation until integration (PR readiness, the
 *   checks wait, both reviewers), plus the stubbed GitHub and reviewer calls.
 * - `integration`: the tick that fast-forwards the Project's base.
 * - `advancement`: ticks after integration until the next Action is admitted
 *   (or, for the last Action, the trailing ticks that must admit nothing).
 */
export const PHASES = ["queueWait", "agentExecution", "validation", "gitFinalization", "review", "integration", "advancement"] as const;
export type Phase = (typeof PHASES)[number];

export interface PhaseTotals { ms: number; ticks: number }

export interface RecordedError {
  /** `command`: a process the harness or executor ran; `injected`: a fault this scenario armed; `lifecycle`: a refusal or failure the real lifecycle reported. */
  kind: "command" | "injected" | "lifecycle";
  command: string;
  cwd: string;
  exitCode: number | null;
  stderr: string;
  /** Whether the scenario armed or expects it. */
  expected: boolean;
}

export interface ActionReport {
  actionId: string;
  outcome: string;
  phases: Record<Phase, PhaseTotals>;
}

export interface ScenarioReport {
  scenario: string;
  file: string;
  validator: "seatbelt" | "unsandboxed";
  wallMs: number;
  ticks: number;
  actions: ActionReport[];
  tickLog: Array<{ tick: number; ms: number; phase: Phase; actionId: string | null; summary: string }>;
  errors: RecordedError[];
  notes: string[];
  /** The worker's own log lines (`[tick N] ...`), sanitised. */
  workerLog: string[];
}

function emptyPhases(): Record<Phase, PhaseTotals> {
  return Object.fromEntries(PHASES.map((phase) => [phase, { ms: 0, ticks: 0 }])) as Record<Phase, PhaseTotals>;
}

/**
 * Accumulates wall time into (Action, phase) buckets. Nested measurements
 * (a validator inside a tick) are attributed to their own phase and
 * subtracted from the enclosing tick, so no millisecond is counted twice.
 */
export class PhaseRecorder {
  private readonly actions = new Map<string, ActionReport>();
  private readonly stack: Array<{ nested: number }> = [];
  readonly errors: RecordedError[] = [];
  private readonly expectedPatterns: RegExp[] = [];
  readonly notes: string[] = [];
  readonly tickLog: ScenarioReport["tickLog"] = [];
  private readonly started = performance.now();
  /** The Action nested measurements are attributed to. */
  current: string | null = null;

  constructor(readonly scenario: string, readonly file: string, private readonly sanitize: (text: string) => string) {}

  action(actionId: string): ActionReport {
    let entry = this.actions.get(actionId);
    if (!entry) {
      entry = { actionId, outcome: "not started", phases: emptyPhases() };
      this.actions.set(actionId, entry);
    }
    return entry;
  }

  add(actionId: string, phase: Phase, ms: number, ticks = 0): void {
    const bucket = this.action(actionId).phases[phase];
    bucket.ms += ms;
    bucket.ticks += ticks;
  }

  /** Time `fn` into `phase` of the current Action; nested inside a tick, the tick's remainder excludes it. */
  measure<T>(phase: Phase, fn: () => T, actionId: string | null = this.current): T {
    const frame = { nested: 0 };
    this.stack.push(frame);
    const start = performance.now();
    try {
      return fn();
    } finally {
      const elapsed = performance.now() - start;
      this.stack.pop();
      const parent = this.stack.at(-1);
      if (parent) parent.nested += elapsed;
      if (actionId) this.add(actionId, phase, elapsed - frame.nested);
    }
  }

  /**
   * Time one worker tick; `classify` runs after it and names the phase and
   * Action its remainder (wall time minus nested measurements) belongs to.
   */
  tick<T>(tick: number, fn: () => T, classify: (result: T) => { phase: Phase; actionId: string | null; summary: string }): T {
    const frame = { nested: 0 };
    this.stack.push(frame);
    const start = performance.now();
    let result: T;
    try {
      result = fn();
    } finally {
      this.stack.pop();
    }
    const elapsed = performance.now() - start;
    const { phase, actionId, summary } = classify(result);
    if (actionId) this.add(actionId, phase, elapsed - frame.nested, 1);
    this.tickLog.push({ tick, ms: Math.round(elapsed), phase, actionId, summary });
    return result;
  }

  /** Mark recorded errors whose stderr matches `pattern` as expected by this scenario. */
  expect(pattern: RegExp): void {
    this.expectedPatterns.push(pattern);
  }

  error(entry: RecordedError): void {
    const record = {
      ...entry,
      command: this.sanitize(entry.command),
      cwd: this.sanitize(entry.cwd),
      stderr: this.sanitize(entry.stderr),
      expected: entry.expected || this.expectedPatterns.some((pattern) => pattern.test(entry.stderr))
    };
    if (!this.errors.some((existing) => JSON.stringify(existing) === JSON.stringify(record))) this.errors.push(record);
  }

  outcome(actionId: string, outcome: string): void {
    this.action(actionId).outcome = outcome;
  }

  build(validator: ScenarioReport["validator"], ticks: number, workerLog: string[]): ScenarioReport {
    return {
      scenario: this.scenario,
      file: this.file,
      validator,
      wallMs: Math.round(performance.now() - this.started),
      ticks,
      actions: [...this.actions.values()].map((entry) => ({
        ...entry,
        phases: Object.fromEntries(PHASES.map((phase) => [phase, { ms: Math.round(entry.phases[phase].ms * 10) / 10, ticks: entry.phases[phase].ticks }])) as Record<Phase, PhaseTotals>
      })),
      tickLog: this.tickLog,
      // Patterns a scenario declared after an error was recorded still apply.
      errors: this.errors.map((error) => ({ ...error, expected: error.expected || this.expectedPatterns.some((pattern) => pattern.test(error.stderr)) })),
      notes: this.notes.map(this.sanitize),
      workerLog: workerLog.map(this.sanitize)
    };
  }
}

/** Strip ANSI, replace temporary roots and home directories, bound the length. */
export function sanitizer(replacements: Array<[string, string]>): (text: string) => string {
  const ordered = replacements.filter(([from]) => from.length > 1).sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    // eslint-disable-next-line no-control-regex
    let out = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
    for (const [from, to] of ordered) out = out.split(from).join(to);
    out = out.trim();
    return out.length > 2000 ? `${out.slice(0, 2000)} [... ${out.length - 2000} more characters]` : out;
  };
}

/**
 * Write the scenario report where `pnpm fast-rehearsal` collects it. Without
 * `FAST_REHEARSAL_REPORT_DIR` (a plain `vitest run`, CI shards) nothing is
 * written: the report never lands in the repository.
 */
export function writeScenarioReport(report: ScenarioReport): string | null {
  const dir = process.env.FAST_REHEARSAL_REPORT_DIR;
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${report.scenario.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}
