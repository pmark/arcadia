import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { listPendingOperatorPings } from "../src/ping/operatorPing.js";
import { ARMED_WAKE_SCHEMA, IDLE_FRONT_ROW_SCHEMA, parseArmedWakeFile, type ArmedWake, type IdleFrontRow } from "../src/production/idleFront.js";
import {
  KEEPER_HEARTBEAT_FILE,
  KEEPER_ROLE,
  MOMENTUM_DEFAULT_IDLE_MINUTES,
  idleAlertMessage,
  keeperAlertMessage,
  observeKeeper,
  runWindowOf,
  type MomentumWatchState
} from "../src/production/momentumWatch.js";
import {
  parseIdleMinutes,
  renderProductionLivenessTimerSuccess,
  runKeeperHeartbeatCommand,
  runProductionLivenessTimerCommand,
  runProductionMomentumCheckCommand
} from "../src/commands/productionMomentum.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-momentum-"));
  roots.push(root);
  initWorkspace(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  return root;
}

const at = (clock: string) => `2026-11-07T${clock}.000Z`;
const ms = (clock: string) => Date.parse(at(clock));

function row(overrides: Partial<IdleFrontRow> & { desired?: "active" | "inactive" | null; state?: IdleFrontRow["critical_path"]["state"] } = {}): IdleFrontRow {
  const { desired = "active", state = "blocked", ...rest } = overrides;
  return {
    schema: IDLE_FRONT_ROW_SCHEMA,
    ts: at("17:00:00"),
    critical_path: { state, label: desired === "active" ? "Active · Blocked" : "Inactive · Idle", desired_state: desired, revision: 106, epoch: 58, live_admissions: 0 },
    blocker_class: "waiting_on_operator",
    blocked_since: at("16:30:00"),
    detected_at: null,
    route_at: null,
    tap_ready: at("16:35:00"),
    ready_actions: 3,
    blockers: [{ source: "escalation", key: "arcadia/pin-a", kind: "build_packet_approval_pending", since: at("16:30:00"), operatorBound: true, tapReady: false }],
    idle_minutes: 30,
    idle_minutes_by_cause: { detection_lag: 5, no_route: 0, waiting_on_operator: 25, no_ready_work: 0 },
    armed_wakes: [],
    no_armed_wake: true,
    missing_wakes: [],
    notes: [],
    ...rest
  };
}

const moving = (overrides: Partial<IdleFrontRow> = {}) => row({ state: "moving", blocker_class: "none", blocked_since: null, tap_ready: null, blockers: [], idle_minutes: 0, idle_minutes_by_cause: { detection_lag: 0, no_route: 0, waiting_on_operator: 0, no_ready_work: 0 }, ...overrides });

// Duty pings have their own agent and suite (tests/duty-alarms.test.ts); these suites pin the idle, keeper and check alarms.
const pending = (root: string) => withDatabase(root, (db) => listPendingOperatorPings(db)).filter((ping) => ping.agent !== "Duty alarm");
const stateOf = (root: string) => JSON.parse(readFileSync(path.join(root, ".arcadia", "momentum-watch.json"), "utf8")) as MomentumWatchState;

function heartbeat(root: string, armedAt: string, armedUntil: string, session: string | null = "Keeper 1"): void {
  const directory = path.join(root, ".arcadia", "armed-wakes");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, KEEPER_HEARTBEAT_FILE), JSON.stringify({ schema: ARMED_WAKE_SCHEMA, session, role: KEEPER_ROLE, armedAt, armedUntil }));
}

/** One timer run of the momentum alarm with a fixed idle-front row. */
function run(root: string, clock: string, current: IdleFrontRow) {
  return runProductionMomentumCheckCommand(
    { workspace: root, dashboardUrl: "http://arcadia.example.ts.net" },
    { now: () => ms(clock), readRow: async () => ({ ...current, ts: at(clock) }) }
  ).then((response) => response.data);
}

describe("the run window", () => {
  it("is open while Active, and while Off with a scope Action not merged; closed when Off with nothing waiting; unknown when unreadable", () => {
    expect(runWindowOf(row())).toEqual({ open: true, reason: "Production is Active" });
    expect(runWindowOf(row({ desired: "inactive", state: "inactive", ready_actions: 1 })).open).toBe(true);
    expect(runWindowOf(row({ desired: "inactive", state: "inactive", ready_actions: 1 })).reason).toBe("Production is Off with 1 scope Action not merged");
    expect(runWindowOf(row({ desired: "inactive", state: "inactive", ready_actions: 0 })).open).toBe(false);
    expect(runWindowOf(row({ desired: "inactive", state: "inactive", ready_actions: null })).open).toBe(false);
    expect(runWindowOf(row({ desired: null, state: "unreadable" })).open).toBeNull();
  });
});

describe("observeKeeper: the keeper's armed-until heartbeat", () => {
  const window = { open: true, reason: "Production is Active" };
  const wake = (overrides: Partial<ArmedWake>): ArmedWake => ({ session: "K", role: KEEPER_ROLE, armedAt: at("16:00:00"), armedUntil: at("17:00:00"), source: "heartbeat-file", evidence: KEEPER_HEARTBEAT_FILE, ...overrides });

  it("is fresh until armedUntil plus the grace, then stale from that moment", () => {
    expect(observeKeeper([wake({})], window, new Date(at("17:09:59")), 10).kind).toBe("fresh");
    const stale = observeKeeper([wake({})], window, new Date(at("17:10:00")), 10);
    expect(stale).toMatchObject({ kind: "stale", staleSince: at("17:10:00") });
  });

  it("counts only keeper-role heartbeat files, and never believes one beyond the 6-hour horizon", () => {
    const now = new Date(at("17:00:00"));
    expect(observeKeeper([wake({ role: "lead", armedUntil: at("18:00:00") })], window, now, 10)).toMatchObject({ kind: "stale", heartbeat: null, staleSince: null });
    expect(observeKeeper([wake({ source: "process", armedUntil: null })], window, now, 10).kind).toBe("stale");
    const beyond = observeKeeper([wake({ armedUntil: "2026-11-08T00:00:01.000Z" })], window, now, 10);
    expect(beyond).toMatchObject({ kind: "stale", staleSince: null, heartbeat: { armedUntil: "2026-11-08T00:00:01.000Z" } });
    // Review round 1 (R1-7): its age is reported, never "never".
    if (beyond.kind !== "stale") throw new Error("unreachable");
    const message = keeperAlertMessage(beyond, window, now);
    expect(message).toContain("— last heartbeat 1 h 0 min ago —");
    expect(message).toContain("is beyond the 6-hour horizon and is not believed");
  });

  it("is not required while the window is closed, and unknown while production is unreadable", () => {
    expect(observeKeeper([], { open: false, reason: "Off" }, new Date(), 10).kind).toBe("not_required");
    expect(observeKeeper([], { open: null, reason: "unreadable" }, new Date(), 10).kind).toBe("unknown");
  });
});

describe("the idle alarm, end to end through the ping outbox", () => {
  it("stays quiet below the threshold, pages once loudly past it, holds through repeats, and pages once on recovery", async () => {
    const root = workspace();
    heartbeat(root, at("16:55:00"), at("19:00:00"));
    expect((await run(root, "17:00:00", row({ idle_minutes: MOMENTUM_DEFAULT_IDLE_MINUTES - 0.1 }))).idle.ping).toBeNull();
    expect(pending(root)).toHaveLength(0);

    const first = await run(root, "17:01:00", row({ idle_minutes: 25 }));
    expect(first.idle.ping).toBe("alert");
    const [alert] = pending(root);
    expect(alert?.message.startsWith("🚨🚨🚨 MOMENTUM: critical path idle 25 min — cause: waiting on operator — your tap is ready: \"Approve build packet\" for build_packet_approval_pending on arcadia/pin-a.")).toBe(true);
    expect(alert?.message).toContain("Critical path idle since 2026-11-07T16:30:00.000Z.");
    expect(alert?.kind).toBe("attention");
    expect(alert?.link).toBe("http://arcadia.example.ts.net/todo");
    expect(alert?.agent).toBe("Momentum watch");

    for (const clock of ["17:02:00", "17:03:00", "17:30:00"]) {
      expect((await run(root, clock, row({ idle_minutes: 60 }))).idle.ping).toBeNull();
    }
    expect(pending(root)).toHaveLength(1);

    const recovered = await run(root, "17:31:00", moving());
    expect(recovered.idle.ping).toBe("close");
    expect(pending(root)).toHaveLength(2);
    expect(pending(root)[1]?.message).toBe(`✅ MOMENTUM: critical path moving again, 30 min after the idle alert (${first.idle.pingId}).`);
    expect((await run(root, "17:32:00", moving())).idle.ping).toBeNull();
    expect(pending(root)).toHaveLength(2);
    expect(stateOf(root).idle).toEqual({ open: null, closedAt: at("17:31:00") });

    // A new stall is a new episode, and pages again.
    expect((await run(root, "18:30:00", row({ blocked_since: at("17:50:00"), idle_minutes: 40 }))).idle.ping).toBe("alert");
    expect(pending(root)).toHaveLength(3);
  });

  it("names the cause and remedy for no route and no ready work, linking the production page", async () => {
    const root = workspace();
    heartbeat(root, at("16:55:00"), at("18:00:00"));
    await run(root, "17:00:00", row({ blocker_class: "no_route", tap_ready: null, idle_minutes: 21 }));
    expect(pending(root)[0]?.message).toContain("cause: no route — no tap is ready yet for build_packet_approval_pending on arcadia/pin-a: Rowan or the Momentum Keeper routes it.");
    expect(pending(root)[0]?.link).toBe("http://arcadia.example.ts.net/production");
    const other = workspace();
    heartbeat(other, at("16:55:00"), at("18:00:00"));
    await run(other, "17:00:00", row({ blocker_class: "no_ready_work", blockers: [], ready_actions: 0, idle_minutes: 21 }));
    expect(pending(other)[0]?.message).toContain("cause: no ready work — every scope Action is merged: Rowan plans the next work.");
  });

  it("pages an Off run with scope work waiting, and closes with one line when the window closes", async () => {
    const root = workspace();
    heartbeat(root, at("16:55:00"), at("18:00:00"));
    const off = row({ desired: "inactive", state: "inactive", ready_actions: 2, idle_minutes: 90 });
    expect((await run(root, "17:00:00", off)).idle.ping).toBe("alert");
    expect(pending(root)[0]?.message).toContain("Production is Off with 2 scope Actions not merged");
    const closed = await run(root, "17:05:00", row({ desired: "inactive", state: "inactive", ready_actions: 0, idle_minutes: 95 }));
    expect(closed.idle.ping).toBe("close");
    expect(pending(root)[1]?.message).toContain("✅ MOMENTUM: run window closed (Production is Off and no scope Action is waiting)");
  });

  it("holds an open alert through an unreadable or unmeasured check, paging nothing", async () => {
    const root = workspace();
    heartbeat(root, at("16:55:00"), at("18:00:00"));
    await run(root, "17:00:00", row());
    expect((await run(root, "17:01:00", row({ desired: null, state: "unreadable", idle_minutes: null }))).idle.ping).toBeNull();
    expect((await run(root, "17:02:00", row({ idle_minutes: null, idle_minutes_by_cause: null, notes: ["unknown"] }))).idle.ping).toBeNull();
    expect(pending(root)).toHaveLength(1);
    expect(stateOf(root).idle.open).not.toBeNull();
    // And an unknown never opens one.
    const fresh = workspace();
    heartbeat(fresh, at("16:55:00"), at("18:00:00"));
    expect((await run(fresh, "17:00:00", row({ idle_minutes: null }))).idle.ping).toBeNull();
    expect(pending(fresh)).toHaveLength(0);
  });

  it("does not page twice when the state file is lost mid-episode, and says so in the exit", async () => {
    const root = workspace();
    heartbeat(root, at("16:55:00"), at("18:00:00"));
    await run(root, "17:00:00", row());
    writeFileSync(path.join(root, ".arcadia", "momentum-watch.json"), "{ torn");
    await expect(run(root, "17:01:00", row())).rejects.toThrow(/state file was unreadable/);
    expect(pending(root)).toHaveLength(1);
    expect(stateOf(root).idle.open?.pingId).toBe(pending(root)[0]?.id);
  });

  it("leaves the state untouched when the ping fails, so the next run retries, while the other alarm still moves", async () => {
    const root = workspace();
    let fail = true;
    const attempt = (clock: string) => runProductionMomentumCheckCommand({ workspace: root }, {
      now: () => ms(clock),
      readRow: async () => row(),
      queuePing: (input) => {
        if (fail && input.message.includes("MOMENTUM: critical path")) throw new Error("database is locked");
        return { id: `ping_${clock.replaceAll(":", "")}` };
      }
    });
    await expect(attempt("17:00:00")).rejects.toThrow(/momentum idle alert was not queued.*database is locked/);
    expect(stateOf(root).idle.open).toBeNull();
    expect(stateOf(root).keeper.open?.pingId).toBe("ping_170000");
    fail = false;
    const retried = await attempt("17:01:00");
    expect(retried.data.idle.ping).toBe("alert");
    expect(retried.data.keeper.ping).toBeNull();
  });

  it("keeps every message within the ping's 500 characters, keeping the head and the episode key", () => {
    const long = row({ critical_path: { ...row().critical_path, label: "x".repeat(600) } });
    const message = idleAlertMessage(long, { open: true, reason: "Production is Active" });
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message.startsWith("🚨🚨🚨 MOMENTUM: critical path idle 30 min")).toBe(true);
    expect(message).toContain("idle since 2026-11-07T16:30:00.000Z");
    const keeper = keeperAlertMessage({ kind: "stale", heartbeat: { session: "s".repeat(400), armedAt: at("15:00:00"), armedUntil: at("16:00:00"), evidence: "f" }, staleSince: at("16:10:00") }, { open: true, reason: "r".repeat(300) }, new Date(at("17:00:00")));
    expect(keeper.length).toBeLessThanOrEqual(500);
    expect(keeper).toContain("keeper lapsed 2026-11-07T16:10:00.000Z");
  });
});

describe("the keeper alarm, end to end through the ping outbox", () => {
  it("pages loudly once when no keeper heartbeat exists in an open window, then once when a keeper starts", async () => {
    const root = workspace();
    const first = await run(root, "17:00:00", moving());
    expect(first.keeper.ping).toBe("alert");
    const [alert] = pending(root);
    expect(alert?.message.startsWith("🚨🚨🚨 MOMENTUM KEEPER NOT ACTIVE — last heartbeat never — start a keeper: Rowan (or you) starts a Momentum Keeper helper under Decisions 0188 and 0114; it runs `arcadia production keeper-heartbeat` at every wake.")).toBe(true);
    expect(alert?.message).toContain("Nothing was started");
    expect((await run(root, "17:01:00", moving())).keeper.ping).toBeNull();
    expect(pending(root)).toHaveLength(1);

    runKeeperHeartbeatCommand({ workspace: root, minutes: 55, session: "Keeper Claudia" }, { now: () => ms("17:05:00") });
    const recovered = await run(root, "17:06:00", moving());
    expect(recovered.keeper.ping).toBe("close");
    expect(pending(root)[1]?.message).toBe(`✅ MOMENTUM KEEPER active again: heartbeat 1 min ago from Keeper Claudia, armed until 2026-11-07T18:00:00.000Z; 6 min after the alert (${first.keeper.pingId}).`);
  });

  it("pages again when a keeper's heartbeat lapses past its grace, naming its age, and not before", async () => {
    const root = workspace();
    heartbeat(root, at("16:00:00"), at("17:00:00"));
    expect((await run(root, "17:09:00", moving())).keeper.ping).toBeNull();
    const lapsed = await run(root, "17:10:00", moving());
    expect(lapsed.keeper.ping).toBe("alert");
    expect(pending(root)[0]?.message).toContain("— last heartbeat 1 h 10 min ago —");
    expect(pending(root)[0]?.message).toContain("(keeper lapsed 2026-11-07T17:10:00.000Z)");
  });

  it("stays quiet with no keeper while the window is closed, and closes an open alarm when it closes", async () => {
    const root = workspace();
    const off = row({ desired: "inactive", state: "inactive", ready_actions: 0, blocker_class: "no_ready_work", blockers: [], idle_minutes: 500 });
    const quiet = await run(root, "17:00:00", off);
    expect(quiet.keeper.ping).toBeNull();
    expect(quiet.idle.ping).toBeNull();
    expect(pending(root)).toHaveLength(0);
    // The duty alarm's Off-with-nothing condition is opt-in, so a quiet Off night writes no duty episode.
    expect(stateOf(root).idle.open).toBeNull();
    expect(stateOf(root).keeper.open).toBeNull();
    await run(root, "17:01:00", moving());
    expect((await run(root, "17:02:00", off)).keeper.ping).toBe("close");
    expect(pending(root)[1]?.message).toContain("✅ MOMENTUM KEEPER alarm closed: Production is Off and no scope Action is waiting, so no keeper is required");
  });
});

describe("review round 1: the alarm's own blindness and lost state", () => {
  it("pages once when the critical path cannot be read for 3 unbroken minutes, holds the other alarms, and closes on the next good read", async () => {
    const root = workspace();
    heartbeat(root, at("16:55:00"), at("19:00:00"));
    await run(root, "17:00:00", row());
    expect(pending(root)).toHaveLength(1);
    let broken = true;
    const attempt = (clock: string) => runProductionMomentumCheckCommand({ workspace: root }, {
      now: () => ms(clock),
      readRow: async () => { if (broken) throw new Error("SQLITE_BUSY: database is locked"); return { ...moving(), ts: at(clock) }; }
    });
    await expect(attempt("17:01:00")).rejects.toThrow(/could not read the critical path.*SQLITE_BUSY/);
    await expect(attempt("17:03:00")).rejects.toThrow(/could not read/);
    expect(pending(root)).toHaveLength(1);
    await expect(attempt("17:04:00")).rejects.toThrow(/queued ping ping_\w+: 🚨🚨🚨 MOMENTUM CHECK FAILING for 3 min/);
    expect(pending(root)[1]?.message).toContain("momentum check failing since 2026-11-07T17:01:00.000Z");
    await expect(attempt("17:05:00")).rejects.toThrow(/could not read/);
    expect(pending(root)).toHaveLength(2);
    expect(stateOf(root).idle.open).not.toBeNull();
    broken = false;
    const back = await attempt("17:06:00");
    expect(back.data.check.ping).toBe("close");
    expect(back.data.idle.ping).toBe("close");
    // The last two share one timestamp, so the outbox's order between them is arbitrary.
    expect(pending(root).map((ping) => ping.message.split(" ").slice(0, 3).join(" ")).sort()).toEqual([
      "🚨🚨🚨 MOMENTUM: critical",
      "🚨🚨🚨 MOMENTUM CHECK",
      "✅ MOMENTUM check",
      "✅ MOMENTUM: critical"
    ].sort());
    expect(stateOf(root).checkFailingSince).toBeNull();
  });

  it("a single failed read pages nothing", async () => {
    const root = workspace();
    await expect(runProductionMomentumCheckCommand({ workspace: root }, { now: () => ms("17:00:00"), readRow: async () => { throw new Error("busy"); } })).rejects.toThrow(/busy/);
    expect(pending(root)).toHaveLength(0);
  });

  it("pages a new no-heartbeat episode even when the state file was lost after an earlier one closed (R1-2)", async () => {
    const root = workspace();
    await run(root, "17:00:00", moving());
    heartbeat(root, at("17:05:00"), at("19:00:00"));
    await run(root, "17:06:00", moving());
    rmSync(path.join(root, ".arcadia", "armed-wakes", KEEPER_HEARTBEAT_FILE));
    rmSync(path.join(root, ".arcadia", "momentum-watch.json"));
    expect((await run(root, "18:00:00", moving())).keeper.ping).toBe("alert");
    expect(pending(root).filter((ping) => ping.message.includes("MOMENTUM KEEPER NOT ACTIVE"))).toHaveLength(2);
  });
});

describe("arcadia production keeper-heartbeat", () => {
  it("writes an armed-until file the idle-front reader accepts, as the keeper role", () => {
    const root = workspace();
    const result = runKeeperHeartbeatCommand({ workspace: root }, { now: () => ms("17:00:00") }).data;
    expect(result.armedUntil).toBe(at("18:00:00"));
    const parsed = parseArmedWakeFile(KEEPER_HEARTBEAT_FILE, readFileSync(result.file, "utf8"));
    expect(parsed).toMatchObject({ ok: true, wake: { role: KEEPER_ROLE, session: null, armedAt: at("17:00:00"), armedUntil: at("18:00:00") } });
  });

  it("refuses a heartbeat beyond the 6-hour horizon or under a minute, and a bad idle threshold", () => {
    const root = workspace();
    expect(() => runKeeperHeartbeatCommand({ workspace: root, minutes: 361 })).toThrow(/--minutes/);
    expect(() => runKeeperHeartbeatCommand({ workspace: root, minutes: "0" })).toThrow(/--minutes/);
    expect(() => parseIdleMinutes("4")).toThrow(/--idle-minutes/);
    expect(parseIdleMinutes(undefined)).toBe(20);
  });
});

describe("liveness-check runs the momentum alarm on the same timer", () => {
  it("runs both checks in one timer run and renders both pages", async () => {
    const root = workspace();
    const response = await runProductionLivenessTimerCommand(
      { workspace: root },
      { liveness: { now: () => ms("17:00:00"), readProductionActive: () => false }, momentum: { readRow: async () => row(), readStartable: () => ({ readable: true, count: 3, reason: null }), readCustodian: () => ({ readable: true, lastLiveAt: ms("16:59:00"), reason: null }) } }
    );
    expect(response.command).toBe("production.liveness-check");
    expect(response.data.observation.kind).toBe("inactive");
    expect(response.data.momentum?.idle.ping).toBe("alert");
    expect(response.data.momentum?.keeper.ping).toBe("alert");
    const lines = renderProductionLivenessTimerSuccess(response);
    // The fixture's 3 ready Actions sit under the default floor, so the duty alarm pages too (its own suite pins that).
    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.includes("🚨🚨🚨 MOMENTUM"))).toHaveLength(2);
    expect(lines.filter((line) => line.includes("🚨🚨🚨 DUTY"))).toHaveLength(1);
  });

  it("never lets a momentum failure stop the worker check, and exits non-zero with both", async () => {
    const root = workspace();
    const run = runProductionLivenessTimerCommand(
      { workspace: root },
      {
        liveness: { now: () => ms("17:00:00"), readProductionActive: () => { throw new Error("policy unreadable"); } },
        momentum: { readRow: async () => { throw new Error("status read failed"); } }
      }
    );
    await expect(run).rejects.toThrow(/Momentum alarm: .*status read failed.*queued ping ping_/);
    // The worker check's read-failure page still went out.
    expect(pending(root).map((ping) => ping.agent)).toEqual(["Liveness check"]);
  });

  it("refuses a bad threshold before either check runs", async () => {
    const root = workspace();
    await expect(runProductionLivenessTimerCommand({ workspace: root, idleMinutes: "abc" })).rejects.toThrow(/--idle-minutes/);
    expect(pending(root)).toHaveLength(0);
  });
});
