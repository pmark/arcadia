import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IDLE_FRONT_ROW_SCHEMA, type IdleFrontRow } from "../src/production/idleFront.js";
import {
  CUSTODIAN_SILENCE_MINUTES,
  decideDuty,
  dutyAlertMessage,
  evaluateDuty,
  type CustodianLiveness,
  type DutyEpisodeRecord,
  type DutyInput
} from "../src/production/dutyAlarms.js";
import { runProductionMomentumCheckCommand, type ProductionMomentumDependencies } from "../src/commands/productionMomentum.js";
import type { LivenessPingInput } from "../src/commands/productionLiveness.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const at = (clock: string) => `2026-11-13T${clock}.000Z`;
const ms = (clock: string) => Date.parse(at(clock));
const healthy: CustodianLiveness = { readable: true, lastLiveAt: ms("16:59:00"), reason: null };
const noRunning = { count: 0, lastActivityAt: null };

/** A healthy base: Active, 10 ready (above the floor), a live custodian, nothing running. Each test overrides one thing. */
function input(overrides: Partial<DutyInput> = {}): DutyInput {
  return {
    now: ms("17:00:00"),
    readyCount: 10,
    floor: 6,
    production: "active",
    eligibleCount: 10,
    custodian: healthy,
    running: noRunning,
    ...overrides
  };
}

describe("decideDuty: once per root idle episode", () => {
  it("opens one episode on the first bad run, stays silent while it persists, and closes only when every condition clears", () => {
    const low = input({ readyCount: 2 });
    const first = decideDuty(null, low);
    expect(first.transition).toBe("open");
    expect(first.next?.cause).toBe("ready_below_floor");

    const second = decideDuty(first.next, input({ readyCount: 1, now: ms("17:01:00") }));
    expect(second.transition).toBe("none");
    expect(second.next).toBe(first.next);

    const third = decideDuty(second.next, input({ readyCount: 3, now: ms("17:02:00") }));
    expect(third.transition).toBe("none");

    const cleared = decideDuty(third.next, input({ readyCount: 8, now: ms("17:03:00") }));
    expect(cleared.transition).toBe("close");
    expect(cleared.next).toBeNull();
  });

  it("opens a fresh episode after a close, with a new key", () => {
    const open = decideDuty(null, input({ readyCount: 2 })).next as DutyEpisodeRecord;
    const closed = decideDuty(open, input({ readyCount: 8, now: ms("17:03:00") }));
    expect(closed.transition).toBe("close");
    const again = decideDuty(null, input({ readyCount: 2, now: ms("17:10:00") }));
    expect(again.transition).toBe("open");
    expect(again.next?.key).not.toBe(open.key);
  });

  it("an unknown never closes an open episode, and never opens one", () => {
    const open = decideDuty(null, input({ readyCount: 2 })).next as DutyEpisodeRecord;
    const held = decideDuty(open, input({ readyCount: null, now: ms("17:01:00") }));
    expect(held.transition).toBe("hold");
    expect(held.next).toBe(open);
    expect(decideDuty(null, input({ readyCount: null })).transition).toBe("none");
  });
});

describe("the conditions", () => {
  it("a healthy long-running Action with recent activity is not idle, however long it has run", () => {
    // Below the floor, but the critical path is moving: the supply alarm stays quiet.
    const longRunning = input({ readyCount: 2, running: { count: 1, lastActivityAt: ms("16:58:00") } });
    expect(decideDuty(null, longRunning).transition).toBe("none");
    expect(evaluateDuty(longRunning).active).toEqual([]);
  });

  it("the same below-floor supply pages once activity has gone quiet past the healthy window", () => {
    const stalled = input({ readyCount: 2, running: { count: 1, lastActivityAt: ms("16:30:00") } });
    expect(decideDuty(null, stalled).transition).toBe("open");
  });

  it("production Off with nothing eligible opens the duty alarm; with the eligible count unknown it holds", () => {
    const off = decideDuty(null, input({ production: "off", eligibleCount: 0, readyCount: 0 }));
    expect(off.transition).toBe("open");
    expect(off.next?.cause).toBe("off_nothing_eligible");
    expect(off.next?.owner).toContain("operator");
    expect(decideDuty(null, input({ production: "off", eligibleCount: null, readyCount: null })).transition).toBe("none");
    expect(decideDuty(null, input({ production: "off", eligibleCount: 3, readyCount: 3 })).transition).toBe("open");
    expect(decideDuty(null, input({ production: "off", eligibleCount: 3, readyCount: 3 })).next?.cause).toBe("ready_below_floor");
  });

  it("no custodian for ten minutes pages, but not at nine", () => {
    const nine = input({ custodian: { readable: true, lastLiveAt: ms("16:51:00"), reason: null } });
    expect(decideDuty(null, nine).transition).toBe("none");
    const ten = input({ custodian: { readable: true, lastLiveAt: ms("16:50:00"), reason: null } });
    const opened = decideDuty(null, ten);
    expect(opened.transition).toBe("open");
    expect(opened.next?.cause).toBe("no_custodian");
    // The episode starts at the silence start, not at the first run that noticed it.
    expect(opened.next?.startedAt).toBe(at("17:00:00"));
    expect(CUSTODIAN_SILENCE_MINUTES).toBe(10);
  });

  it("a custodian that was never recorded, or cannot be read, is unknown rather than silent", () => {
    expect(decideDuty(null, input({ custodian: { readable: true, lastLiveAt: null, reason: null } })).transition).toBe("none");
    const unreadable = decideDuty(null, input({ custodian: { readable: false, lastLiveAt: null, reason: "db locked" } }));
    expect(unreadable.transition).toBe("none");
    expect(unreadable.evaluation.unknown.join(" ")).toContain("db locked");
  });

  it("when several conditions hold, the root is the first by precedence and the others are recorded as contributing", () => {
    const all = input({
      custodian: { readable: true, lastLiveAt: ms("16:00:00"), reason: null },
      production: "off",
      eligibleCount: 0,
      readyCount: 0
    });
    const opened = decideDuty(null, all);
    expect(opened.next?.cause).toBe("no_custodian");
    expect(opened.next?.contributing).toEqual(["no_custodian", "off_nothing_eligible", "ready_below_floor"]);
    // A later run where only the root remains keeps the episode and its root.
    const narrowed = decideDuty(opened.next, input({ custodian: { readable: true, lastLiveAt: ms("16:00:00"), reason: null }, readyCount: 10 }));
    expect(narrowed.transition).toBe("none");
    expect(narrowed.next?.cause).toBe("no_custodian");
  });

  it("the alert names the cause, owner and next event, and fits the ping's 500 characters", () => {
    const record = decideDuty(null, input({ readyCount: 0 })).next as DutyEpisodeRecord;
    const message = dutyAlertMessage(record, new Date(ms("17:20:00")));
    expect(message).toContain("ready Actions below the floor");
    expect(message).toContain("owner: Rowan or the Momentum Keeper");
    expect(message).toContain("next event: the ready count reaches the floor");
    expect(message).toContain(record.key);
    expect(message.length).toBeLessThanOrEqual(500);
  });
});

describe("the duty alarm through the momentum runner, with the ping queue injected", () => {
  function workspace(): string {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-duty-"));
    roots.push(root);
    initWorkspace(root);
    mkdirSync(path.join(root, ".arcadia"), { recursive: true });
    return root;
  }

  function row(overrides: Partial<IdleFrontRow> & { desired?: "active" | "inactive" } = {}): IdleFrontRow {
    const { desired = "active", ...rest } = overrides;
    return {
      schema: IDLE_FRONT_ROW_SCHEMA,
      ts: at("17:00:00"),
      critical_path: { state: desired === "active" ? "blocked" : "inactive", label: "test", desired_state: desired, revision: 1, epoch: 1, live_admissions: 0 },
      blocker_class: desired === "active" ? "waiting_on_operator" : "no_ready_work",
      blocked_since: null,
      detected_at: null,
      route_at: null,
      tap_ready: null,
      ready_actions: 10,
      blockers: [],
      idle_minutes: 0,
      idle_minutes_by_cause: { detection_lag: 0, no_route: 0, waiting_on_operator: 0, no_ready_work: 0 },
      armed_wakes: [],
      no_armed_wake: true,
      missing_wakes: [],
      notes: [],
      ...rest
    };
  }

  /** Every queued ping goes in `queued`; the keeper alarm also pages these Active fixtures, so duty assertions use `duties`. */
  function harness(root: string, queued: LivenessPingInput[], options: { failNext?: boolean } = {}) {
    let failNext = options.failNext ?? false;
    const deps: ProductionMomentumDependencies = {
      queuePing: (input) => {
        if (failNext && input.agent === "Duty alarm") {
          failNext = false;
          throw new Error("outbox busy");
        }
        queued.push(input);
        return { id: `ping_${queued.length}` };
      }
    };
    return {
      run: (clock: string, current: IdleFrontRow, custodian: CustodianLiveness = healthy) =>
        runProductionMomentumCheckCommand(
          { workspace: root, readyFloor: 6 },
          { ...deps, now: () => ms(clock), readRow: async () => ({ ...current, ts: at(clock) }), readCustodian: () => custodian }
        ).then((response) => response.data),
      failNext: () => { failNext = true; }
    };
  }

  const state = (root: string) => JSON.parse(readFileSync(path.join(root, ".arcadia", "momentum-watch.json"), "utf8")) as { duty: { open: DutyEpisodeRecord | null; closedAt: string | null } };

  it("pages once for an Off run with nothing eligible, records delivery and leaves acknowledgment empty, then closes with one line", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    const off = row({ desired: "inactive", ready_actions: 0 });

    const first = await h.run("17:00:00", off);
    expect(first.duty.ping).toBe("alert");
    expect((await h.run("17:01:00", off)).duty.ping).toBeNull();
    expect((await h.run("17:02:00", off)).duty.ping).toBeNull();
    const duties = queued.filter((ping) => ping.agent === "Duty alarm");
    expect(duties).toHaveLength(1);
    expect(duties[0]?.message).toContain("production Off with nothing eligible");

    const open = state(root).duty.open;
    expect(open?.cause).toBe("off_nothing_eligible");
    expect(open?.delivery).toEqual({ pingId: first.duty.pingId, queuedAt: at("17:00:00") });
    expect(open?.acknowledgment).toBeNull();

    const closed = await h.run("17:05:00", row({ ready_actions: 10 }));
    expect(closed.duty.ping).toBe("close");
    const after = queued.filter((ping) => ping.agent === "Duty alarm");
    expect(after).toHaveLength(2);
    expect(after[1]?.message).toMatch(new RegExp(`^✅ DUTY cleared: production Off with nothing eligible, 5 min after the duty alarm \\(${first.duty.pingId}\\)`));
    expect(state(root).duty.open).toBeNull();
    expect(state(root).duty.closedAt).toBe(at("17:05:00"));
  });

  it("pages no custodian at ten minutes of silence but not at nine, and keeps the ping for the same episode", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    const nineMinutes: CustodianLiveness = { readable: true, lastLiveAt: ms("16:51:00"), reason: null };
    expect((await h.run("17:00:00", row(), nineMinutes)).duty.ping).toBeNull();
    const ten: CustodianLiveness = { readable: true, lastLiveAt: ms("16:50:00"), reason: null };
    expect((await h.run("17:00:00", row(), ten)).duty.ping).toBe("alert");
    expect((await h.run("17:01:00", row(), ten)).duty.ping).toBeNull();
    const duties = queued.filter((ping) => ping.agent === "Duty alarm");
    expect(duties).toHaveLength(1);
    expect(duties[0]?.message).toContain("no custodian live");
  });

  it("a failed queue leaves the episode unopened, so the next run queues it", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued, { failNext: true });
    const low = row({ ready_actions: 2 });
    await expect(h.run("17:00:00", low)).rejects.toThrow(/duty alarm was not queued and will be retried.*outbox busy/);
    expect(state(root).duty.open).toBeNull();
    expect((await h.run("17:01:00", low)).duty.ping).toBe("alert");
    expect(queued.filter((ping) => ping.agent === "Duty alarm")).toHaveLength(1);
  });

  it("an existing state file with no duty slot still reads, as an empty duty slot", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    // A state file from before duty alarms: the other alarms' slots only.
    mkdirSync(path.join(root, ".arcadia"), { recursive: true });
    const legacy = { schema: "arcadia-momentum-watch-v2", idle: { open: null, closedAt: null }, keeper: { open: null, closedAt: null }, check: { open: null, closedAt: null }, checkFailingSince: null };
    writeFileSync(path.join(root, ".arcadia", "momentum-watch.json"), JSON.stringify(legacy));
    expect((await h.run("17:00:00", row({ ready_actions: 10 }))).duty.ping).toBeNull();
    expect(queued.filter((ping) => ping.agent === "Duty alarm")).toHaveLength(0);
  });
});
