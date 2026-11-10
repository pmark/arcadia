import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVENESS_DEFAULT_STALE_SECONDS,
  decideLiveness,
  parseElapsed,
  parseStaleSeconds,
  readWorkerProgress,
  renderProductionLivenessCheckSuccess,
  SPEND_CHECK_INTERVAL_MINUTES,
  decideSpend,
  defaultSpendCheck,
  runProductionLivenessCheckCommand,
  staleMessage,
  suspectChild,
  type LivenessState,
  type ProcessRow
} from "../src/commands/productionLiveness.js";
import type { SpendReport, SpendVerdict } from "../src/spend/spendCheck.js";
import { createWorkerTick } from "../src/commands/worker.js";
import { startHeartbeatBeacon } from "../src/commands/workerHeartbeatBeaconExecutor.js";
import { withDatabase } from "../src/db/connection.js";
import { listPendingOperatorPings } from "../src/ping/operatorPing.js";
import { collectHangEvidence, type HangEvidenceInput } from "../src/production/evidenceBundle.js";
import { withPrReviewExecutionClaim } from "../src/qa/executionClaim.js";
import { evaluateLaunchAgent } from "../src/runtime/launchAgents.js";
import { systemTmux } from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function workspace(): string {
  const root = tempDir("arcadia-liveness-");
  initWorkspace(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  return root;
}

const WORKER = { pid: 11679, owner: "worker-owner" };
const at = (time: string) => Date.parse(`2026-11-05T${time}Z`);
const dotfile = (root: string, name: string) => path.join(root, ".arcadia", name);

/** What the beacon keeps fresh through a hang, and what only the main loop writes. */
function writeBeaconRecord(root: string, when: number, worker = WORKER): void {
  writeFileSync(dotfile(root, "worker.pid"), JSON.stringify({ ...worker, at: when }));
}
function writeTickMarker(root: string, when: number, worker = WORKER): void {
  writeFileSync(dotfile(root, "worker.tick-started"), JSON.stringify({ ...worker, at: when }));
}
function writeHeartbeat(root: string, when: number): void {
  writeFileSync(dotfile(root, "preservation.heartbeat"), JSON.stringify({ schema: "arcadia-preservation-transport-v1", at: when, intervalMs: 5_000, sessions: [] }));
}

const PROCESSES: ProcessRow[] = [
  { pid: WORKER.pid, ppid: 1, elapsedSeconds: 9_000, command: "/usr/bin/node src/cli.ts worker start" },
  { pid: 11700, ppid: WORKER.pid, elapsedSeconds: 8_990, command: "/usr/bin/node dist/src/commands/workerHeartbeatBeacon.js /ws {} 11679 5000" },
  { pid: 31788, ppid: WORKER.pid, elapsedSeconds: 300, command: "/Library/Frameworks/Python.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python -I -c import json,sys" }
];

const spendReport = (verdict: SpendVerdict, codes: string[] = []): SpendReport => ({
  verdict,
  providers: [{ id: "claude", verdict, codes: codes as never, probes: [] }],
  warnings: ["notional_cost_only"],
  checkedAt: "2026-11-05T00:00:00.000Z"
});
const CLEAR = () => spendReport("clear");

function check(root: string, now: number, active: boolean | (() => boolean) = true, processes: () => ProcessRow[] = () => PROCESSES, checkSpend: () => SpendReport = CLEAR) {
  return runProductionLivenessCheckCommand(
    { workspace: root, dashboardUrl: "http://arcadia.example.ts.net/" },
    { now: () => now, readProductionActive: () => (typeof active === "function" ? active() : active), listProcesses: processes, checkSpend }
  ).data;
}
const pending = (root: string) => withDatabase(root, (db) => listPendingOperatorPings(db));
const state = (root: string) => JSON.parse(readFileSync(dotfile(root, "production-liveness.json"), "utf8")) as LivenessState;

describe("the liveness state table, end to end through the ping outbox", () => {
  it("stays quiet while production is Inactive, however old the worker's signal is", () => {
    const root = workspace();
    writeBeaconRecord(root, at("01:00:00"));
    writeHeartbeat(root, at("01:00:00"));
    const result = check(root, at("03:00:00"), false);
    expect(result).toMatchObject({ ping: null, message: null, observation: { kind: "inactive" } });
    expect(pending(root)).toEqual([]);
  });

  it("reads Inactive from a real workspace's policy, through the read-only path", () => {
    const root = workspace();
    const result = runProductionLivenessCheckCommand({ workspace: root }, { checkSpend: CLEAR }).data;
    expect(result.observation).toEqual({ kind: "inactive" });
  });

  it("stays quiet while Active with a fresh signal, and prints nothing a timer's log would keep", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:00:00"));
    writeHeartbeat(root, at("02:00:00"));
    const result = runProductionLivenessCheckCommand({ workspace: root }, { now: () => at("02:04:59"), readProductionActive: () => true, checkSpend: CLEAR });
    expect(result.data).toMatchObject({ ping: null, observation: { kind: "fresh", signal: "preservation-heartbeat" } });
    expect(renderProductionLivenessCheckSuccess(result)).toEqual([]);
    expect(pending(root)).toEqual([]);
  });

  it("sends one alert at the first stale run, naming age, pid, child, how to look and the link", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    const result = check(root, at("02:10:30"));
    expect(result.ping).toBe("stale_alert");
    const [ping] = pending(root);
    expect(ping).toMatchObject({ kind: "attention", agent: "Liveness check", link: "http://arcadia.example.ts.net/production", id: result.pingId });
    expect(ping?.message).toContain("Worker silent 5m 0s");
    expect(ping?.message).toContain("Worker pid 11679");
    expect(ping?.message).toContain("pid 31788");
    expect(ping?.message).toContain("#2084");
    expect(ping?.message).toContain("`sample`");
    expect(ping?.message.length).toBeLessThanOrEqual(500);
    expect(state(root).openAlert).toMatchObject({ kind: "stale", pingId: result.pingId });
  });

  it("does not alert again on later stale runs, then sends one recovery line and rearms", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    check(root, at("02:10:30"));
    const alertFields = () => { const { spendCheckedAt: _ignored, ...rest } = state(root); return rest; };
    const alertedState = alertFields();

    expect(check(root, at("02:11:30")).ping).toBeNull();
    expect(check(root, at("03:08:00")).ping).toBeNull();
    expect(alertFields()).toEqual(alertedState);
    expect(pending(root)).toHaveLength(1);

    writeTickMarker(root, at("03:08:10"));
    const recovered = check(root, at("03:08:11"));
    expect(recovered.ping).toBe("recovered");
    expect(recovered.message).toContain("Worker progressing again");
    expect(pending(root)).toHaveLength(2);
    expect(state(root).openAlert).toBeNull();
    expect(check(root, at("03:09:11")).ping).toBeNull();

    writeTickMarker(root, at("04:00:00"));
    expect(check(root, at("04:05:00")).ping).toBe("stale_alert");
    expect(pending(root)).toHaveLength(3);
  });

  it("raises a distinct, deduplicated alert when its own read fails during Active, and a line when it reads again", () => {
    const root = workspace();
    writeHeartbeat(root, at("02:00:00"));
    check(root, at("02:00:01"));
    writeFileSync(dotfile(root, "preservation.heartbeat"), "{not json");

    const failed = check(root, at("02:01:00"));
    expect(failed.ping).toBe("read_failed_alert");
    expect(failed.observation).toMatchObject({ kind: "read_failed", what: "the worker's progress signal" });
    expect(failed.message).toContain("could not read the worker's progress signal");
    expect(failed.message).not.toContain("Worker silent");
    expect(pending(root)).toHaveLength(1);

    // Still failing: the open alert stands, and the failure still reaches launchd's log.
    expect(() => check(root, at("02:02:00"))).toThrow("Could not read the worker's progress signal");
    expect(pending(root)).toHaveLength(1);

    writeHeartbeat(root, at("02:03:00"));
    const back = check(root, at("02:03:01"));
    expect(back.ping).toBe("recovered");
    expect(back.message).toContain("can read again");
    expect(state(root).openAlert).toBeNull();
  });

  it("alerts when the policy itself cannot be read, unless Off was the last thing confirmed", () => {
    const failing = () => { throw new Error("SQLITE_CORRUPT"); };
    const neverRead = workspace();
    const unknown = check(neverRead, at("02:00:00"), failing);
    expect(unknown.ping).toBe("read_failed_alert");
    expect(unknown.message).toContain("SQLITE_CORRUPT");

    const off = workspace();
    check(off, at("02:00:00"), false);
    expect(() => check(off, at("02:01:00"), failing)).toThrow("Could not read the production policy: SQLITE_CORRUPT");
    expect(pending(off)).toEqual([]);
  });

  it("pages when the progress read fails just after production turned Active, whatever Off the state last saw", () => {
    const root = workspace();
    check(root, at("02:00:00"), false);
    expect(state(root).productionActive).toBe(false);
    const result = check(root, at("02:01:00"));
    expect(result.ping).toBe("read_failed_alert");
    expect(result.message).toContain("production is Active");
    expect(state(root).productionActive).toBe(true);
  });

  it("does not page twice when the state file cannot be written, however long that lasts", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    const stateDirectory = dotfile(root, "production-liveness.json");
    mkdirSync(stateDirectory);
    writeFileSync(path.join(stateDirectory, "blocks-the-rename"), "");
    for (const when of ["02:10:30", "02:11:30", "02:40:00"]) {
      expect(() => check(root, at(when))).toThrow();
    }
    expect(pending(root)).toHaveLength(1);
  });

  it("pages again for a worker stuck across Off and a new Active, though its last progress is unchanged", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    expect(check(root, at("02:10:30")).ping).toBe("stale_alert");
    expect(check(root, at("02:20:00"), false).ping).toBe("closed_by_off");
    expect(check(root, at("03:00:00")).ping).toBe("stale_alert");
    expect(pending(root)).toHaveLength(3);
  });

  it("restarts the episode when a current-schema state holds a malformed open alert", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    writeFileSync(dotfile(root, "production-liveness.json"), JSON.stringify({ schema: "arcadia-production-liveness-v1", productionActive: true, openAlert: { kind: "stale" } }));
    expect(() => check(root, at("02:10:30"))).toThrow("malformed open alert");
    expect(pending(root)).toHaveLength(1);
    expect(state(root).openAlert).toMatchObject({ kind: "stale" });
  });

  it("still queues the alert when the configured dashboard link is unusable", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    const result = runProductionLivenessCheckCommand(
      { workspace: root, dashboardUrl: "http://host.example # Tailnet dashboard" },
      { now: () => at("02:10:30"), readProductionActive: () => true, listProcesses: () => PROCESSES }
    ).data;
    expect(result.ping).toBe("stale_alert");
    expect(pending(root)[0]?.link).toBe("http://127.0.0.1:3020/production");
  });

  it("leaves the state alone and fails loudly when the ping cannot be queued, so the next run retries", () => {
    const root = workspace();
    writeTickMarker(root, at("02:05:30"));
    writeBeaconRecord(root, at("02:10:30"));
    expect(() => runProductionLivenessCheckCommand({ workspace: root }, {
      now: () => at("02:10:30"),
      readProductionActive: () => true,
      listProcesses: () => PROCESSES,
      queuePing: () => { throw new Error("database is locked"); }
    })).toThrow("will be retried on the next run: database is locked");
    expect(existsSync(dotfile(root, "production-liveness.json"))).toBe(false);
    expect(check(root, at("02:11:30")).ping).toBe("stale_alert");
  });

  it("closes an open alert with a line that does not claim recovery when production goes Off", () => {
    const root = workspace();
    writeTickMarker(root, at("02:05:30"));
    writeBeaconRecord(root, at("02:10:30"));
    check(root, at("02:10:30"));
    const closed = check(root, at("02:20:00"), false);
    expect(closed.ping).toBe("closed_by_off");
    expect(closed.message).toContain("not confirmed recovered");
    expect(state(root)).toMatchObject({ productionActive: false, openAlert: null });
  });

  it("still alerts, saying so, when ps fails or the worker has gone", () => {
    const failedPs = workspace();
    writeTickMarker(failedPs, at("02:05:30"));
    writeBeaconRecord(failedPs, at("02:10:30"));
    const unknown = check(failedPs, at("02:10:30"), true, () => { throw new Error("ps timed out"); });
    expect(unknown.message).toContain("Children unknown");

    const gone = workspace();
    writeHeartbeat(gone, at("02:05:30"));
    const noRecord = check(gone, at("02:10:30"));
    expect(noRecord.ping).toBe("stale_alert");
    expect(noRecord.message).toContain("No worker record");
  });

  it("restarts the episode rather than losing it when the state file is corrupt", () => {
    const root = workspace();
    writeFileSync(dotfile(root, "production-liveness.json"), "{nope");
    writeHeartbeat(root, at("02:00:00"));
    expect(() => check(root, at("02:00:01"))).toThrow("unreadable and has been replaced");
    expect(state(root)).toMatchObject({ productionActive: true, openAlert: null });
  });

  it("is a total, pure decision over every open-alert and observation pair", () => {
    const base = (kind: "stale" | "read_failed" | null, productionActive: boolean | null = true): LivenessState => ({
      schema: "arcadia-production-liveness-v1",
      productionActive,
      openAlert: kind ? { kind, alertedAt: "2026-11-05T02:00:00.000Z", pingId: "ping_x" } : null,
      closedAt: null
    });
    const stale = { kind: "stale", progressAt: 0, ageMs: 1, limitMs: 1, signal: "tick-marker", workerPid: 1 } as const;
    const fresh = { kind: "fresh", ageMs: 1, limitMs: 1, signal: "tick-marker", workerPid: 1 } as const;
    const failed = { kind: "read_failed", what: "x", reason: "y", policyActive: false } as const;
    expect(decideLiveness(base("read_failed"), stale)).toMatchObject({ ping: "stale_alert", openAlert: "stale" });
    expect(decideLiveness(base("stale"), failed)).toMatchObject({ ping: null, openAlert: "stale", logOnly: "Could not read x: y" });
    expect(decideLiveness(base(null), fresh)).toMatchObject({ ping: null, openAlert: null, productionActive: true });
    expect(decideLiveness(base("read_failed"), { kind: "inactive" })).toMatchObject({ ping: "closed_by_off", openAlert: null });
    expect(decideLiveness(base(null, false), failed)).toMatchObject({ ping: null, productionActive: false });
    expect(decideLiveness(base(null, false), { ...failed, policyActive: true })).toMatchObject({ ping: "read_failed_alert", productionActive: true });
  });
});

describe("the signal, against the hang of 2026-11-05 (Issue #2084)", () => {
  it("replays the real timeline with the beacon beating throughout: one alert at 02:11, one recovery at 03:09", () => {
    const root = workspace();
    // The worker's last log line. The beacon kept stamping worker.pid through all of it.
    writeTickMarker(root, at("02:05:30.737"));
    writeHeartbeat(root, at("02:05:30.737"));
    const pings: Array<{ minute: string; ping: string }> = [];
    for (let minute = at("02:06:00"); minute <= at("03:08:00"); minute += 60_000) {
      writeBeaconRecord(root, minute - 2_000);
      const result = check(root, minute);
      if (result.ping) pings.push({ minute: new Date(minute).toISOString(), ping: result.ping });
    }
    writeTickMarker(root, at("03:08:10.963"));
    writeBeaconRecord(root, at("03:08:58"));
    const recovery = check(root, at("03:09:00"));
    expect(pings).toEqual([{ minute: "2026-11-05T02:11:00.000Z", ping: "stale_alert" }]);
    expect(recovery.ping).toBe("recovered");
    expect(pending(root)).toHaveLength(2);
  });

  it("reads stale through a real beacon while a real tick is blocked, though worker.pid stays fresh", async () => {
    const root = workspace();
    const identity = { pid: process.pid, owner: "liveness-hang" };
    const beacon = startHeartbeatBeacon(root, identity, { intervalMs: 20 });
    const logfile = dotfile(root, "worker.log");
    let observed: { progress: ReturnType<typeof readWorkerProgress>; markerAgeMs: number; pidfileAgeMs: number } | null = null;
    try {
      const deadline = Date.now() + 5_000;
      while (!existsSync(dotfile(root, "worker.pid")) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      const tick = createWorkerTick({
        workspacePath: root,
        pid: process.pid,
        logfile,
        identity,
        schedule: () => {},
        // The hang: execFileSync on the worker's own thread, here as a blocked open.
        openDb: () => {
          const started = Date.now();
          execFileSync("sleep", ["1"]);
          const now = Date.now();
          const progress = readWorkerProgress(root);
          observed = {
            progress,
            markerAgeMs: now - progress.progressAt,
            pidfileAgeMs: now - (JSON.parse(readFileSync(dotfile(root, "worker.pid"), "utf8")) as { at: number }).at
          };
          expect(now - started).toBeGreaterThanOrEqual(900);
          throw new Error("stop the fixture tick here");
        }
      });
      tick();
    } finally {
      beacon.stop();
    }
    expect(observed).not.toBeNull();
    const seen = observed as unknown as NonNullable<typeof observed>;
    expect(seen.progress.signal).toBe("tick-marker");
    expect(seen.markerAgeMs).toBeGreaterThanOrEqual(900);
    expect(seen.pidfileAgeMs).toBeLessThan(500);
  }, 15_000);

  it("does not page on a 12-minute code review, a real one from the live log, using the real claim path", () => {
    const root = workspace();
    const worker = { pid: process.pid, owner: "liveness-review" };
    writeBeaconRecord(root, at("09:36:10"), worker);
    writeTickMarker(root, at("09:23:58"), worker);
    const claimRoot = path.join(root, "artifacts", "code-review", "pull-requests", "pmark-arcadia", "2062");

    const during = withPrReviewExecutionClaim(claimRoot, () => {
      // The real claim stamps the real clock, so move it to this replay's time.
      writeFileSync(path.join(claimRoot, ".execution-claim", "owner.json"), JSON.stringify({ pid: process.pid, claimedAt: new Date(at("09:23:59")).toISOString() }));
      const review = check(root, at("09:36:10"));
      const atTheLimit = check(root, at("09:43:57"));
      const pastTheLimit = check(root, at("09:43:59"));
      return { review, atTheLimit, pastTheLimit };
    });
    expect(during.review).toMatchObject({ ping: null, observation: { kind: "fresh" } });
    expect(during.atTheLimit.ping).toBeNull();
    expect(during.pastTheLimit.ping).toBe("stale_alert");
  });

  it("does not let a crashed run's or a manual run's claim hide a stuck worker", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    const claim = path.join(root, "artifacts", "qa", "pull-requests", "pmark-arcadia", "2062", ".execution-claim");
    mkdirSync(claim, { recursive: true });
    writeFileSync(path.join(claim, "owner.json"), JSON.stringify({ pid: 999_999, claimedAt: new Date(at("02:05:00")).toISOString() }));
    expect(check(root, at("02:10:30")).ping).toBe("stale_alert");
  });

  it("ignores a marker left by a worker since replaced", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:00"));
    writeTickMarker(root, at("01:00:00"), { pid: 222, owner: "replaced-worker" });
    writeHeartbeat(root, at("02:09:59"));
    expect(readWorkerProgress(root)).toMatchObject({ signal: "preservation-heartbeat", progressAt: at("02:09:59") });
  });

  it("catches a tick wedged on an await, where the loop's own timer keeps the heartbeat fresh", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeHeartbeat(root, at("02:10:29"));
    writeTickMarker(root, at("02:05:30"));
    expect(check(root, at("02:10:30")).ping).toBe("stale_alert");
  });
});

describe("hang evidence saved with the stale alert", () => {
  const sleepers: ChildProcess[] = [];
  afterEach(() => {
    for (const sleeper of sleepers.splice(0)) sleeper.kill("SIGKILL");
  });

  function staleWorkerRoot(): { root: string; pid: number } {
    const sleeper = spawn("sleep", ["300"], { stdio: "ignore" });
    sleepers.push(sleeper);
    const pid = sleeper.pid as number;
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"), { pid, owner: "worker-owner" });
    writeTickMarker(root, at("02:05:30"), { pid, owner: "worker-owner" });
    return { root, pid };
  }

  function run(root: string, now: number, collect: NonNullable<Parameters<typeof runProductionLivenessCheckCommand>[1]>["collectHangEvidence"]) {
    return runProductionLivenessCheckCommand(
      { workspace: root, dashboardUrl: "http://arcadia.example.ts.net/" },
      { now: () => now, readProductionActive: () => true, listProcesses: () => PROCESSES, collectHangEvidence: collect }
    );
  }

  it("captures the worker's process once per episode, after the ping, and keeps host paths out of the ping", () => {
    const { root, pid } = staleWorkerRoot();
    const calls: number[] = [];
    const collect = (input: HangEvidenceInput) => {
      // The page is already queued when the slow part starts.
      calls.push(pending(root).length);
      return collectHangEvidence({ ...input, limits: { budgetMs: 8_000 } });
    };

    const first = run(root, at("02:10:30"), collect);
    expect(first.data.ping).toBe("stale_alert");
    expect(calls).toEqual([1]);
    const evidence = first.data.hangEvidence;
    expect(evidence?.directory).toContain(path.join("artifacts", "generated", "red-alerts", "liveness-2026-11-05T02-05-30.000Z", "hang"));
    const record = JSON.parse(readFileSync(path.join(evidence?.directory as string, "hang-evidence.json"), "utf8")) as { rootPid: number; status: string };
    expect(record).toMatchObject({ rootPid: pid, status: "captured" });
    expect(renderProductionLivenessCheckSuccess(first).join("\n")).toContain(evidence?.directory as string);
    const [ping] = pending(root);
    expect(ping?.message).not.toContain(root);
    expect(ping?.message).not.toContain("red-alerts");

    const before = readFileSync(path.join(evidence?.directory as string, "hang-evidence.json"), "utf8");
    for (const later of ["02:11:30", "02:20:00"]) {
      const repeat = run(root, at(later), collect);
      expect(repeat.data).toMatchObject({ ping: null, hangEvidence: null });
    }
    expect(calls).toHaveLength(1);
    expect(pending(root)).toHaveLength(1);
    expect(readFileSync(path.join(evidence?.directory as string, "hang-evidence.json"), "utf8")).toBe(before);
  }, 30_000);

  it("still raises and records the alert when the capture throws", () => {
    const { root } = staleWorkerRoot();
    const result = run(root, at("02:10:30"), () => { throw new Error("sample exploded"); });
    expect(result.data.ping).toBe("stale_alert");
    expect(result.data.hangEvidence).toMatchObject({ status: "failed", directory: null, note: "sample exploded" });
    expect(pending(root)).toHaveLength(1);
    expect(state(root).openAlert).toMatchObject({ kind: "stale", pingId: result.data.pingId });
  });

  it("makes no capture while the alert is quiet or fresh", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:00:00"));
    writeTickMarker(root, at("02:00:00"));
    const collect = vi.fn();
    expect(run(root, at("02:01:00"), collect).data.hangEvidence).toBeNull();
    expect(collect).not.toHaveBeenCalled();
  });
});

describe("what could hold the write lock against the alert", () => {
  it("gives up on a stalled tmux capture, which the tick runs inside a write transaction", () => {
    const bin = tempDir("arcadia-liveness-tmux-");
    writeFileSync(path.join(bin, "tmux"), "#!/bin/sh\nexec sleep 30\n");
    chmodSync(path.join(bin, "tmux"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env["PATH"] ?? ""}`);
    try {
      const started = Date.now();
      expect(systemTmux.capturePane?.("stalled")).toBeNull();
      // #2090's TMUX_QUERY_LIMITS bound of 15 seconds.
      expect(Date.now() - started).toBeLessThan(25_000);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);
});

describe("the alert's details", () => {
  it("names the capture reader ahead of an older child, and never the beacon", () => {
    const rows: ProcessRow[] = [
      ...PROCESSES,
      { pid: 40000, ppid: WORKER.pid, elapsedSeconds: 8_000, command: "/usr/bin/gh pr view" },
      { pid: 40001, ppid: 40000, elapsedSeconds: 100, command: "/usr/bin/git status" }
    ];
    expect(suspectChild(rows, WORKER.pid)?.pid).toBe(31788);
    expect(suspectChild(rows.filter((row) => row.pid !== 31788), WORKER.pid)?.pid).toBe(40000);
    expect(suspectChild(PROCESSES.slice(0, 2), WORKER.pid)).toBeNull();
  });

  it("parses ps elapsed time", () => {
    expect(parseElapsed("05:01")).toBe(301);
    expect(parseElapsed("1:02:03")).toBe(3_723);
    expect(parseElapsed("2-01:00:00")).toBe(176_400);
    expect(parseElapsed("soon")).toBeNaN();
  });

  it("keeps the longest alert inside the ping limit, and says when the worker is gone", () => {
    const message = staleMessage(
      { kind: "stale", progressAt: at("02:05:30"), ageMs: 90_000_000, limitMs: 300_000, signal: "tick-marker", workerPid: 2_147_483_647 },
      [{ pid: 3, ppid: 2_147_483_647, elapsedSeconds: 8_000_000, command: `/${"x".repeat(400)}/Python -I -c ${"y".repeat(400)}` }]
    );
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message).toContain("is gone");
  });

  it("defaults the threshold to five minutes and refuses one that would page on a slow step", () => {
    expect(LIVENESS_DEFAULT_STALE_SECONDS).toBe(300);
    expect(parseStaleSeconds(undefined)).toBe(300);
    expect(parseStaleSeconds("600")).toBe(600);
    expect(() => parseStaleSeconds("5")).toThrow("at least 30");
    expect(() => parseStaleSeconds("soon")).toThrow("whole number");
  });
});

describe("the launchd agent", () => {
  const repo = path.resolve(__dirname, "..");
  const lib = path.join(repo, "scripts", "lib", "liveness-agent.sh");
  const impl = path.join(repo, "scripts", "restart-services-impl.sh");
  const UID = String(process.getuid?.() ?? 0);

  /** A host with every system command stubbed: nothing here can reach the real launchd, ports or processes. */
  function host(options: { release?: boolean; loaded?: boolean; bootstrapFailures?: number } = {}) {
    const root = tempDir("arcadia-liveness-host-");
    const bin = path.join(root, "bin");
    const home = path.join(root, "home");
    const fakeRepo = path.join(root, "repo");
    const fakeWorkspace = path.join(root, "workspace");
    for (const dir of [bin, home, fakeWorkspace, path.join(fakeRepo, "docs"), path.join(fakeRepo, "src", "commands"), path.join(fakeRepo, "apps", "discord-bot")]) mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(fakeRepo, "package.json"), '{"name": "@pmark/arcadia"}');
    writeFileSync(path.join(fakeRepo, "pnpm-workspace.yaml"), "");
    writeFileSync(path.join(fakeRepo, "docs", "arcadia-semantics.md"), "");
    writeFileSync(path.join(fakeRepo, "src", "commands", "intelligence.ts"), "");
    writeFileSync(path.join(fakeRepo, "src", "commands", "worker.ts"), "");
    writeFileSync(path.join(fakeRepo, "apps", "discord-bot", ".env"), "DISCORD_BOT_TOKEN=do-not-read\nARCADIA_DASHBOARD_URL=http://arcadia.example.ts.net\n");

    const calls = path.join(root, "launchctl.calls");
    const stub = (name: string, body: string) => {
      const file = path.join(bin, name);
      writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(file, 0o755);
    };
    stub("uname", 'echo Darwin');
    const failures = path.join(root, "bootstrap-failures");
    writeFileSync(failures, String(options.bootstrapFailures ?? 0));
    stub("launchctl", `echo "$*" >> "${calls}"\nif [[ "$1" == "print" ]]; then ${options.loaded ? 'echo "	last exit code = 0"; exit 0' : "exit 113"}; fi\nif [[ "$1" == "bootstrap" ]]; then n=$(cat "${failures}"); if [[ "$n" -gt 0 ]]; then echo $((n - 1)) > "${failures}"; exit 5; fi; fi\nexit 0`);
    stub("lsof", "exit 0");
    stub("ps", "exit 0");
    stub("curl", "exit 1");
    stub("mise", "exit 0");

    let releaseDir: string | null = null;
    if (options.release) {
      releaseDir = path.join(home, ".local", "share", "arcadia", "go-broker", "releases", "a".repeat(40));
      mkdirSync(path.join(releaseDir, "dist", "src", "commands"), { recursive: true });
      writeFileSync(path.join(releaseDir, "dist", "src", "cli.js"), "");
      writeFileSync(path.join(releaseDir, "dist", "src", "commands", "productionLiveness.js"), "");
      const runtime = path.join(root, "release-node");
      writeFileSync(runtime, "#!/bin/sh\n");
      chmodSync(runtime, 0o755);
      writeFileSync(path.join(releaseDir, "broker-manifest.json"), JSON.stringify({ runtimeExecutable: runtime }, null, 2));
      mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
      symlinkSync(path.join(releaseDir, "arcadia-advance-broker-claude"), path.join(home, ".local", "bin", "arcadia-advance-broker-claude"));
    }
    const run = (action: string, env: Record<string, string> = {}) => spawnSync("bash", [impl, action, fakeRepo], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        ARCADIA_WORKSPACE: fakeWorkspace,
        ARCADIA_MISE_BIN: path.join(bin, "mise"),
        ...env
      }
    });
    const agentsDir = path.join(home, "Library", "LaunchAgents");
    const plistPath = () => {
      const key = spawnSync("bash", ["-c", `printf '%s' "$(cd "$1" && pwd -P)" | cksum | awk '{print $1}'`, "--", fakeRepo], { encoding: "utf8" }).stdout.trim();
      return path.join(agentsDir, `com.arcadia.local.${key}.liveness-check.plist`);
    };
    const launchctlCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");
    return { root, home, fakeRepo, fakeWorkspace, releaseDir, run, plistPath, launchctlCalls, bin, failures };
  }

  function plistJson(file: string): { Label: string; ProgramArguments: string[]; StartInterval: number; RunAtLoad: boolean; KeepAlive?: unknown; StandardOutPath: string; StandardErrorPath: string; WorkingDirectory: string; EnvironmentVariables: Record<string, string> } {
    const python = [
      "import plistlib,json,sys",
      "print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))"
    ].join("\n");
    return JSON.parse(execFileSync("python3", ["-I", "-c", python, file], { encoding: "utf8" })) as ReturnType<typeof plistJson>;
  }

  it("is generated on a 60-second schedule, with RunAtLoad, stable logs and no KeepAlive, running an immutable release", () => {
    const fixture = host({ release: true });
    const result = fixture.run("liveness");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const plist = plistJson(fixture.plistPath());
    expect(plist.StartInterval).toBe(60);
    expect(plist.RunAtLoad).toBe(true);
    expect(plist.KeepAlive).toBeUndefined();
    expect(plist.Label).toMatch(/^com\.arcadia\.local\.\d+\.liveness-check$/);
    expect(plist.StandardOutPath).toMatch(/Library\/Logs\/arcadia-services-\d+\/liveness-check\.out\.log$/);
    expect(plist.StandardErrorPath).toMatch(/Library\/Logs\/arcadia-services-\d+\/liveness-check\.err\.log$/);
    // The worker's agent: this checkout as cwd, no workspace in its environment. Same resolution, same workspace.
    expect(plist.WorkingDirectory).toBe(realpathSync(fixture.fakeRepo));
    expect(Object.keys(plist.EnvironmentVariables).sort()).toEqual(["HOME", "NODE_PATH", "PATH"]);
    expect(plist.EnvironmentVariables.NODE_PATH).toBe(`${fixture.releaseDir}/node_modules`);
    expect(plist.ProgramArguments).toEqual([
      path.join(fixture.root, "release-node"),
      `${fixture.releaseDir}/dist/src/cli.js`,
      "production", "liveness-check",
      "--dashboard-url", "http://arcadia.example.ts.net"
    ]);
    expect(readFileSync(fixture.plistPath(), "utf8")).not.toContain("do-not-read");
    expect(fixture.launchctlCalls()).toContain(`bootstrap gui/${UID} ${fixture.plistPath()}`);
    const audit = (argv: string[]) => evaluateLaunchAgent(plist.Label, fixture.plistPath(), { argv, pathValue: plist.EnvironmentVariables.PATH ?? null }).verdict;
    expect(audit(plist.ProgramArguments)).toBe("pinned");
    expect(audit(["/opt/homebrew/bin/node", ...plist.ProgramArguments.slice(1)])).toBe("unpinned");
  });

  it("reads the dashboard URL from the bot's .env as dotenv does", () => {
    const read = (line: string) => {
      const fixture = host();
      writeFileSync(path.join(fixture.fakeRepo, "apps", "discord-bot", ".env"), `${line}\n`);
      const result = spawnSync("bash", ["-c", 'source "$1"; liveness_dashboard_url "$2"', "--", lib, fixture.fakeRepo], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
      return result.stdout;
    };
    expect(read("ARCADIA_DASHBOARD_URL=http://host.example  # Tailnet dashboard")).toBe("http://host.example");
    expect(read("ARCADIA_DASHBOARD_URL=http://host.example")).toBe("http://host.example");
    expect(read('ARCADIA_DASHBOARD_URL="http://host.example:3020/#/x" # note')).toBe("http://host.example:3020/#/x");
    expect(read("ARCADIA_DASHBOARD_URL='http://host.example'")).toBe("http://host.example");
  });

  it("refuses a threshold the command would refuse, and leaves the running timer in place", () => {
    const fixture = host({ release: true });
    fixture.run("liveness");
    const before = readFileSync(fixture.plistPath(), "utf8");
    const calls = fixture.launchctlCalls();
    for (const value of ["soon", "5"]) {
      const result = fixture.run("liveness", { ARCADIA_LIVENESS_STALE_SECONDS: value });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must be a whole number of at least 30");
    }
    expect(readFileSync(fixture.plistPath(), "utf8")).toBe(before);
    expect(fixture.launchctlCalls()).toBe(calls);
  });

  it("puts the previous timer back when launchd refuses its replacement", () => {
    const fixture = host({ release: true });
    fixture.run("liveness");
    const before = readFileSync(fixture.plistPath(), "utf8");
    writeFileSync(fixture.failures, "1");
    const result = fixture.run("liveness", { ARCADIA_LIVENESS_STALE_SECONDS: "420" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("failed to load");
    expect(readFileSync(fixture.plistPath(), "utf8")).toBe(before);
    expect(existsSync(`${fixture.plistPath()}.prev`)).toBe(false);
    expect(fixture.launchctlCalls().match(/bootstrap /g)).toHaveLength(3);
  });

  it("falls back to the checkout through mise until a release has the command, and says so", () => {
    const fixture = host();
    const result = fixture.run("liveness", { ARCADIA_LIVENESS_STALE_SECONDS: "420" });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("runs from this checkout");
    const plist = plistJson(fixture.plistPath());
    const argv = plist.ProgramArguments;
    expect(argv.slice(0, 5)).toEqual([path.join(fixture.bin, "mise"), "-C", realpathSync(fixture.fakeRepo), "exec", "--"]);
    expect(argv.slice(-2)).toEqual(["--stale-seconds", "420"]);
    expect(argv).toContain("liveness-check");
  });

  it("is removed by stop and reported by status, without touching the real launchd", () => {
    const fixture = host({ release: true });
    fixture.run("liveness");
    expect(existsSync(fixture.plistPath())).toBe(true);
    const stopped = fixture.run("stop");
    expect(stopped.status).toBe(0);
    expect(existsSync(fixture.plistPath())).toBe(false);
    expect(fixture.launchctlCalls()).toMatch(/remove com\.arcadia\.local\.\d+\.liveness-check/);

    expect(fixture.run("status").stdout).toContain("liveness-check: not installed");
    const installed = host({ release: true, loaded: true });
    installed.run("liveness");
    expect(installed.run("status").stdout).toContain("liveness-check: every 60s from a go-broker release (last exit 0)");
  });

  it("is left running by a restart's rollback and installed by a restart, which never fails over it", () => {
    const script = readFileSync(impl, "utf8");
    expect(script).toContain("SERVICES=(intelligence worker dashboard discord-bot)");
    expect(script.slice(script.indexOf("stop_all() {"), script.indexOf("# --- liveness-check timer"))).not.toContain("liveness");
    const restart = script.slice(script.indexOf("  restart)\n    # Probe settings"));
    expect(restart).toContain('install_liveness_agent || echo "warning:');
    expect(readFileSync(lib, "utf8")).not.toMatch(/\bgit\b/);
  });
});

describe("the spend check on each liveness tick", () => {
  const spendPings = (root: string) => pending(root).filter((ping) => /Spend|spend/.test(ping.message));
  const tick = (root: string, minute: number, verdict: () => SpendReport) => check(root, at("04:00:00") + minute * 20 * 60_000, false, undefined, verdict);

  it("decides from the verdict alone: clear to risk pages, risk to risk is silent, unknown never pages", () => {
    const none = { spend: null, spendUnknownSince: null };
    const open = { spend: { alertedAt: "2026-11-05T04:00:00.000Z", pingId: "p1", codes: [] }, spendUnknownSince: null };
    expect(decideSpend(none, "risk")).toMatchObject({ ping: "spend_risk", episode: "open" });
    expect(decideSpend(open, "risk")).toMatchObject({ ping: null, episode: "keep" });
    expect(decideSpend(open, "clear")).toMatchObject({ ping: "spend_recovered", episode: "closed" });
    expect(decideSpend(none, "clear")).toMatchObject({ ping: null });
    expect(decideSpend(none, "unknown")).toEqual({ ping: null, episode: "keep", digestUnknown: true });
    expect(decideSpend(open, "unknown")).toMatchObject({ ping: null, episode: "keep" });
  });

  it("pages once at clear to risk naming the code, stays silent on risk to risk, and sends one recovery line", () => {
    const root = workspace();
    expect(tick(root, 0, CLEAR).spend.ping).toBeNull();
    const first = tick(root, 1, () => spendReport("risk", ["api_key_in_launch_env"]));
    expect(first.spend).toMatchObject({ verdict: "risk", ping: "spend_risk" });
    expect(first.spend.message).toContain("api_key_in_launch_env");
    expect(tick(root, 2, () => spendReport("risk", ["api_key_in_launch_env"])).spend.ping).toBeNull();
    expect(spendPings(root)).toHaveLength(1);
    const recovered = tick(root, 3, CLEAR);
    expect(recovered.spend.ping).toBe("spend_recovered");
    expect(recovered.spend.message).toContain("clear again");
    expect(spendPings(root)).toHaveLength(2);
    expect(state(root).spend).toBeNull();
    expect(tick(root, 4, () => spendReport("risk", ["paid_model_route"])).spend.ping).toBe("spend_risk");
  });

  it("never pages for unknown, and a risk -> unknown -> risk run is one episode with one page", () => {
    const root = workspace();
    const unknown = tick(root, 0, () => spendReport("unknown"));
    expect(unknown.spend).toMatchObject({ ping: null, message: null });
    expect(unknown.spend.digestLine).toContain("digest only");
    expect(spendPings(root)).toEqual([]);
    expect(tick(root, 1, () => spendReport("risk", ["extra_usage_enabled"])).spend.ping).toBe("spend_risk");
    expect(tick(root, 2, () => spendReport("unknown")).spend.ping).toBeNull();
    expect(state(root).spend).not.toBeNull();
    expect(tick(root, 3, () => spendReport("risk", ["extra_usage_enabled"])).spend.ping).toBeNull();
    expect(spendPings(root)).toHaveLength(1);
  });

  it("names codes only, never an environment value", () => {
    const root = workspace();
    const secret = "sk-ant-SECRET-VALUE";
    const previous = process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = secret;
    try {
      tick(root, 0, () => spendReport("risk", ["api_key_in_launch_env"]));
    } finally {
      if (previous === undefined) delete process.env["ANTHROPIC_API_KEY"]; else process.env["ANTHROPIC_API_KEY"] = previous;
    }
    const [ping] = spendPings(root);
    expect(ping?.message).toContain("api_key_in_launch_env");
    expect(ping?.message).not.toContain(secret);
    expect(readFileSync(dotfile(root, "production-liveness.json"), "utf8")).not.toContain(secret);
  });

  it("keeps the liveness tick working when the spend check throws: unknown, digest only", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    const result = check(root, at("02:10:30"), true, undefined, () => { throw new Error("probe exploded sk-ant-LEAK"); });
    expect(result.ping).toBe("stale_alert");
    expect(result.spend).toMatchObject({ verdict: "unknown", ping: null });
    expect(JSON.stringify(result.spend)).not.toContain("LEAK");
    expect(pending(root)).toHaveLength(1);
  });

  const at4 = (minutes: number) => at("04:00:00") + minutes * 60_000;
  const counting = (verdict: SpendVerdict, codes: string[] = []) => {
    const fn = vi.fn(() => spendReport(verdict, codes));
    return fn;
  };

  it("throttles the probe: a tick inside the interval does not call checkSpend and never pages", () => {
    const root = workspace();
    const probe = counting("clear");
    check(root, at4(0), false, undefined, probe);
    expect(probe).toHaveBeenCalledTimes(1);
    const skipped = check(root, at4(SPEND_CHECK_INTERVAL_MINUTES - 1), false, undefined, probe);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(skipped.spend).toMatchObject({ verdict: "skipped", ping: null, message: null, digestLine: null });
  });

  it("runs the probe exactly at the interval boundary", () => {
    const root = workspace();
    const probe = counting("clear");
    check(root, at4(0), false, undefined, probe);
    check(root, at4(SPEND_CHECK_INTERVAL_MINUTES), false, undefined, probe);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("probes every tick while a risk episode is open, so recovery is seen promptly", () => {
    const root = workspace();
    check(root, at4(0), false, undefined, counting("risk", ["paid_model_route"]));
    const open = counting("risk", ["paid_model_route"]);
    check(root, at4(1), false, undefined, open);
    check(root, at4(2), false, undefined, open);
    expect(open).toHaveBeenCalledTimes(2);
    const recovered = check(root, at4(3), false, undefined, counting("clear"));
    expect(recovered.spend.ping).toBe("spend_recovered");
    const after = counting("clear");
    check(root, at4(4), false, undefined, after);
    expect(after).not.toHaveBeenCalled();
  });

  it("does not re-page the stale alert on the tick after a probe crashed mid-run", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    // The probe sees the alert already on disk, then dies; the next tick must find it open.
    check(root, at("02:10:30"), true, undefined, () => {
      expect(state(root).openAlert).toMatchObject({ kind: "stale" });
      throw new Error("killed mid-probe");
    });
    const again = check(root, at("02:11:30"));
    expect(again.ping).toBeNull();
    expect(pending(root).filter((ping) => ping.message.includes("Worker silent"))).toHaveLength(1);
  });

  it("persists the alert state before the probe runs", () => {
    const root = workspace();
    writeBeaconRecord(root, at("02:10:30"));
    writeTickMarker(root, at("02:05:30"));
    let seen: LivenessState | null = null;
    check(root, at("02:10:30"), true, undefined, () => { seen = state(root); return spendReport("clear"); });
    expect(seen).toMatchObject({ openAlert: { kind: "stale" } });
  });

  it("reports both a log-only liveness error and a spend queue failure", () => {
    const root = workspace();
    check(root, at4(0), false);
    expect(() => runProductionLivenessCheckCommand(
      { workspace: root },
      { now: () => at4(20), readProductionActive: () => { throw new Error("policy unreadable"); }, checkSpend: () => spendReport("risk", ["paid_model_route"]), queuePing: () => { throw new Error("outbox down"); } }
    )).toThrow(/Could not read the production policy[\s\S]*outbox down/);
  });

  it("never runs the real probes in a test process: the default is a fixed clear report", () => {
    expect(defaultSpendCheck(at4(0), { VITEST: "true" })).toMatchObject({ verdict: "clear", providers: [] });
  });
});
