import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { ArcadiaError } from "./cli/errors.js";
import { createFailure } from "./cli/response.js";

/**
 * The fixed brief runs synchronously (Git, SQLite, document reads), so no
 * in-process timer can ever interrupt it. The deadline is enforced from a
 * parent: the installed entrypoint re-spawns itself as a supervised child in
 * its own process group and owns the single receipt the caller reads.
 */

/** Set only on the supervised child; its value is the parent's correlation id. */
export const BRIEF_CHILD_ENV = "ARCADIA_BRIEF_CHILD";
/** Optional host override that may only shorten the default deadline. */
export const BRIEF_DEADLINE_ENV = "ARCADIA_BRIEF_DEADLINE_MS";
/** Internal launcher self-test used by `go-broker status`; never a public argument. */
export const BRIEF_SELF_TEST_ENV = "ARCADIA_GO_BROKER_SELFTEST";

/** Below the coding agent's 30s attempt, with room for the kill path. */
export const BRIEF_DEADLINE_MS = 25_000;
/** Each kill step (TERM grace, then KILL wait) is capped by this bound. */
export const BRIEF_KILL_GRACE_MS = 1_000;
/** Progress lines on the child's stderr carry this prefix. */
export const BRIEF_STAGE_PREFIX = "arcadia-brief-stage ";
const STDERR_TAIL_BYTES = 4_096;

export const BRIEF_STAGES = ["spawn", "workspace", "advance", "work-monitor", "next", "render", "self-test"] as const;
export type BriefStage = (typeof BRIEF_STAGES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A positive integer override, capped at {@link BRIEF_DEADLINE_MS}; anything else is ignored. */
export function briefDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env[BRIEF_DEADLINE_ENV]);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, BRIEF_DEADLINE_MS) : BRIEF_DEADLINE_MS;
}

/** The correlation id when this process is the supervised brief child. */
export function briefChildCorrelationId(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[BRIEF_CHILD_ENV];
  return value && UUID.test(value) ? value : null;
}

export function isBriefStage(value: unknown): value is BriefStage {
  return typeof value === "string" && (BRIEF_STAGES as readonly string[]).includes(value);
}

/**
 * Report a stage to the supervising parent before it starts. Written with a
 * synchronous fd write so the line is on the pipe before the stage can block.
 */
export function reportBriefStage(stage: BriefStage, correlationId: string): void {
  try {
    writeSync(2, `${BRIEF_STAGE_PREFIX}${JSON.stringify({ stage, correlationId })}\n`);
  } catch {
    // A missing or closed stderr never fails the brief itself.
  }
}

/** Safe next step for a brief that did not return its dispatch text. */
export function briefRecovery(stage: string, stalled = false): string {
  const hint = !stalled
    ? "Fix the cause this receipt names, then rerun it."
    : stage === "work-monitor"
      ? "This stage scans every Project worktree and branch with Git; many worktrees or a hung git process stall it."
      : stage === "advance" || stage === "next" || stage === "workspace"
        ? "This stage reads the workspace SQLite database and Git; a held SQLite lock or a hung git process stalls it."
        : "The child stalled outside its Git and SQLite stages; host load is the likely cause.";
  return [
    "The brief is read-only: it wrote no claim, admission, or dispatch telemetry, so rerunning the same fixed brief launcher is safe.",
    hint,
    "Do not widen sandbox permissions and do not run the mutable `arcadia next` or `arcadia advance` instead; report the correlation id if it repeats."
  ].join(" ");
}

export interface BriefFailureContext {
  stage: string;
  correlationId: string;
  /** The deadline expired, rather than a stage refusing. */
  stalled?: boolean;
}

/** The one failure shape every brief refusal uses, child- or parent-produced. */
export function briefFailureReceipt(error: ArcadiaError, context: BriefFailureContext): string {
  const stage = typeof error.details.stage === "string" ? error.details.stage : context.stage;
  const details = {
    ...error.details,
    stage,
    correlationId: context.correlationId,
    readOnly: true,
    recovery: typeof error.details.recovery === "string" ? error.details.recovery : briefRecovery(stage, context.stalled)
  };
  return `${JSON.stringify(createFailure("brief-broker", new ArcadiaError(error.code, error.message, error.exitCode, details)), null, 2)}\n`;
}

export interface BriefSupervisorOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  correlationId: string;
  deadlineMs: number;
  killGraceMs?: number;
}

export interface BriefSupervisorOutcome {
  /** Exactly one JSON document; the child's bytes verbatim when it answered in time. */
  receipt: string;
  exitCode: number;
  timedOut: boolean;
  stage: string;
  elapsedMs: number;
}

/**
 * Run the brief child under a hard deadline. On expiry the whole child process
 * group gets SIGTERM, then SIGKILL after a bounded grace; the outcome resolves
 * no later than `deadlineMs + 2 * killGraceMs` regardless of what the child
 * does. After the deadline every child byte is discarded, so a late child
 * write can never produce a second receipt.
 */
export function superviseBrief(options: BriefSupervisorOptions): Promise<BriefSupervisorOutcome> {
  const grace = options.killGraceMs ?? BRIEF_KILL_GRACE_MS;
  const started = Date.now();
  return new Promise((resolve) => {
    let stage = "spawn";
    // `accepting` ends at the deadline (or at the child's answer); `settled`
    // ends when the single receipt is handed back.
    let accepting = true;
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    const stdout: Buffer[] = [];
    let stderrTail = "";
    let partialLine = "";
    const exitWaiters: Array<() => void> = [];

    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: { ...options.env, [BRIEF_CHILD_ENV]: options.correlationId },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, signal); } catch { /* The group is already gone. */ }
    };
    // A supervisor that is itself stopped must not orphan a hung brief.
    const stopGroup = () => killGroup("SIGKILL");
    const parentSignals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
    const onParentSignal = (signal: NodeJS.Signals) => {
      stopGroup();
      process.exit(128 + (signal === "SIGHUP" ? 1 : signal === "SIGINT" ? 2 : 15));
    };
    for (const signal of parentSignals) process.on(signal, onParentSignal);
    process.on("exit", stopGroup);

    const failure = (error: ArcadiaError, stalled = false) =>
      briefFailureReceipt(error, { stage, correlationId: options.correlationId, stalled });
    const finish = (outcome: Omit<BriefSupervisorOutcome, "stage" | "elapsedMs">) => {
      if (settled) return;
      settled = true;
      accepting = false;
      clearTimeout(deadline);
      for (const signal of parentSignals) process.off(signal, onParentSignal);
      process.off("exit", stopGroup);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      resolve({ ...outcome, stage, elapsedMs: Date.now() - started });
    };

    child.stdout?.on("data", (chunk: Buffer) => { if (accepting) stdout.push(chunk); });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (!accepting) return;
      const lines = (partialLine + chunk).split("\n");
      partialLine = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith(BRIEF_STAGE_PREFIX)) {
          try {
            const progress = JSON.parse(line.slice(BRIEF_STAGE_PREFIX.length)) as { stage?: unknown; correlationId?: unknown };
            if (progress.correlationId === options.correlationId && isBriefStage(progress.stage)) stage = progress.stage;
            continue;
          } catch { /* Not a progress line; keep it as a diagnostic. */ }
        }
        stderrTail = `${stderrTail}${line}\n`.slice(-STDERR_TAIL_BYTES);
      }
    });

    child.on("error", (error) => {
      if (!accepting) return;
      finish({
        receipt: failure(new ArcadiaError("UNEXPECTED_ERROR", "The fixed brief could not start its supervised child.", 1, { cause: error.message })),
        exitCode: 1,
        timedOut: false
      });
    });
    child.on("exit", (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      for (const waiter of exitWaiters.splice(0)) waiter();
    });
    child.on("close", () => {
      if (!accepting) return;
      const output = Buffer.concat(stdout).toString("utf8");
      let parsed: unknown;
      try { parsed = JSON.parse(output); } catch { parsed = undefined; }
      if (parsed && typeof parsed === "object" && typeof (parsed as { ok?: unknown }).ok === "boolean") {
        // Verbatim: the dispatch brief's bytes are never re-serialized.
        finish({ receipt: output, exitCode: (parsed as { ok: boolean }).ok ? (exitCode ?? 0) : exitCode || 1, timedOut: false });
        return;
      }
      finish({
        receipt: failure(new ArcadiaError("UNEXPECTED_ERROR", "The fixed brief child exited without a structured receipt.", 1, {
          childExitCode: exitCode,
          childSignal: exitSignal,
          ...(stderrTail.trim() ? { childStderrTail: stderrTail.trim() } : {})
        })),
        exitCode: 1,
        timedOut: false
      });
    });

    const waitForExit = (ms: number) => new Promise<void>((done) => {
      if (exited) return done();
      const timer = setTimeout(done, ms);
      exitWaiters.push(() => { clearTimeout(timer); done(); });
    });

    const deadline = setTimeout(() => {
      if (!accepting) return;
      // Freeze the receipt first: nothing the child writes from here on can
      // reach the caller, so a late child answer never becomes a second one.
      accepting = false;
      const receipt = failure(new ArcadiaError(
        "BRIEF_DEADLINE_EXCEEDED",
        `The fixed brief did not finish within ${options.deadlineMs}ms; its process group was stopped.`,
        1,
        { deadlineMs: options.deadlineMs, elapsedMs: Date.now() - started }
      ), true);
      void (async () => {
        killGroup("SIGTERM");
        await waitForExit(grace);
        // Grandchildren may ignore TERM or outlive the leader; a group id stays
        // reserved while any member lives, so this KILL remains scoped to it.
        killGroup("SIGKILL");
        await waitForExit(grace);
        finish({ receipt, exitCode: 1, timedOut: true });
      })();
    }, options.deadlineMs);
  });
}
