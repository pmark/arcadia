import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IDLE_FRONT_ROW_SCHEMA, type IdleFrontRow } from "../src/production/idleFront.js";
import {
  CUSTODIAN_SILENCE_MINUTES,
  HEALTHY_MAX_SILENCE_MINUTES,
  decideDuty,
  dutyAlertMessage,
  evaluateDuty,
  type CustodianLiveness,
  type DutyEpisodeRecord,
  type DutyInput
} from "../src/production/dutyAlarms.js";
import { readStartableCount, renderProductionMomentumLines, runProductionMomentumCheckCommand, type ProductionMomentumDependencies, type StartableCount } from "../src/commands/productionMomentum.js";
import type { LivenessPingInput } from "../src/commands/productionLiveness.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const at = (clock: string) => `2026-11-13T${clock}.000Z`;
const ms = (clock: string) => Date.parse(at(clock));
const healthy: CustodianLiveness = { readable: true, lastLiveAt: ms("16:59:00"), reason: null };
const noRunning = { count: 0, lastActivityAt: null };

/** A healthy base: Active, 10 ready (above the floor), a live custodian, nothing running, Off alarm on. Each test overrides one thing. */
function input(overrides: Partial<DutyInput> = {}): DutyInput {
  return {
    now: ms("17:00:00"),
    readyCount: 10,
    floor: 6,
    production: "active",
    eligibleCount: 10,
    offNothingAlarm: true,
    custodian: healthy,
    running: noRunning,
    ...overrides
  };
}

describe("decideDuty: once per root idle episode", () => {
  it("opens one episode on the first bad run, stays silent while it persists, and closes only when every condition clears", () => {
    const first = decideDuty(null, input({ readyCount: 2 }));
    expect(first.transition).toBe("open");
    expect(first.next?.cause).toBe("ready_below_floor");

    // The runner delivers it, so the record carries delivery before the next run.
    const delivered: DutyEpisodeRecord = { ...(first.next as DutyEpisodeRecord), delivery: { pingId: "p1", queuedAt: at("17:00:00") } };
    const second = decideDuty(delivered, input({ readyCount: 1, now: ms("17:01:00") }));
    expect(second.transition).toBe("none");
    expect(second.next).toBe(delivered);

    const third = decideDuty(second.next, input({ readyCount: 3, now: ms("17:02:00") }));
    expect(third.transition).toBe("none");

    const cleared = decideDuty(third.next, input({ readyCount: 8, now: ms("17:03:00") }));
    expect(cleared.transition).toBe("close");
    expect(cleared.next).toBeNull();
  });

  it("opens a fresh episode after a close, with a new key", () => {
    const open: DutyEpisodeRecord = { ...(decideDuty(null, input({ readyCount: 2 })).next as DutyEpisodeRecord), delivery: { pingId: "p1", queuedAt: at("17:00:00") } };
    const closed = decideDuty(open, input({ readyCount: 8, now: ms("17:03:00") }));
    expect(closed.transition).toBe("close");
    const again = decideDuty(null, input({ readyCount: 2, now: ms("17:10:00") }));
    expect(again.transition).toBe("open");
    expect(again.next?.key).not.toBe(open.key);
  });

  it("an episode recorded but never delivered is queued again under the same key, never a new one", () => {
    const recorded = decideDuty(null, input({ readyCount: 2 })).next as DutyEpisodeRecord;
    const retried = decideDuty(recorded, input({ readyCount: 2, now: ms("17:01:00") }));
    expect(retried.transition).toBe("open");
    expect(retried.next?.key).toBe(recorded.key);
    expect(retried.next?.startedAt).toBe(recorded.startedAt);
  });

  it("an unknown never closes an open episode, and never opens one", () => {
    const open: DutyEpisodeRecord = { ...(decideDuty(null, input({ readyCount: 2 })).next as DutyEpisodeRecord), delivery: { pingId: "p1", queuedAt: at("17:00:00") } };
    const held = decideDuty(open, input({ readyCount: null, now: ms("17:01:00") }));
    expect(held.transition).toBe("hold");
    expect(held.next).toBe(open);
    expect(decideDuty(null, input({ readyCount: null })).transition).toBe("none");
  });
});

describe("the conditions", () => {
  it("a healthy long-running Action with recent admission change is not idle, however long it has run", () => {
    // Below the floor, but the critical path is moving and its admissions changed 10 minutes ago: the supply alarm stays quiet.
    const longRunning = input({ readyCount: 2, running: { count: 1, lastActivityAt: ms("16:50:00") } });
    expect(decideDuty(null, longRunning).transition).toBe("none");
    expect(evaluateDuty(longRunning).active).toEqual([]);
  });

  it("the healthy window is capped: a stuck admission past the cap pages the floor, and not before", () => {
    const within = input({ readyCount: 2, running: { count: 1, lastActivityAt: ms("17:00:00") - (HEALTHY_MAX_SILENCE_MINUTES - 1) * 60_000 } });
    expect(decideDuty(null, within).transition).toBe("none");
    const past = input({ readyCount: 2, running: { count: 1, lastActivityAt: ms("17:00:00") - (HEALTHY_MAX_SILENCE_MINUTES + 1) * 60_000 } });
    expect(decideDuty(null, past).transition).toBe("open");
  });

  it("a stale custodian while Off pages nobody by default, pages with the Off alarm on, and pages when not Off", () => {
    const stale: CustodianLiveness = { readable: true, lastLiveAt: ms("16:00:00"), reason: null };
    const offDefault = decideDuty(null, input({ production: "off", eligibleCount: 0, readyCount: 0, offNothingAlarm: false, custodian: stale }));
    expect(offDefault.transition).toBe("none");
    expect(offDefault.evaluation.active).toEqual([]);
    expect(offDefault.evaluation.unknown).toEqual([]);
    const offFlag = decideDuty(null, input({ production: "off", eligibleCount: 0, readyCount: 0, offNothingAlarm: true, custodian: stale }));
    expect(offFlag.transition).toBe("open");
    expect(offFlag.next?.cause).toBe("no_custodian");
    const notOff = decideDuty(null, input({ production: "active", offNothingAlarm: false, custodian: stale }));
    expect(notOff.transition).toBe("open");
    expect(notOff.next?.cause).toBe("no_custodian");
  });

  it("a null progress clock removes the healthy suppression: a moving Action with no observed count change pages the floor", () => {
    const unproven = input({ readyCount: 2, running: { count: 1, lastActivityAt: null } });
    expect(decideDuty(null, unproven).transition).toBe("open");
    expect(decideDuty(null, unproven).next?.cause).toBe("ready_below_floor");
  });

  it("an undelivered episode whose condition cleared is still paged once, marked as cleared, and closes at once", () => {
    const recorded = decideDuty(null, input({ readyCount: 2 })).next as DutyEpisodeRecord;
    const decision = decideDuty(recorded, input({ readyCount: 10, now: ms("17:01:00") }));
    expect(decision.transition).toBe("open");
    expect(decision.cleared).toBe(true);
    expect(decision.next?.key).toBe(recorded.key);
    expect(dutyAlertMessage(decision.next as DutyEpisodeRecord, new Date(ms("17:01:00")), true)).toContain("Cleared before this page was sent");
  });

  it("production Off with nothing eligible opens the duty alarm when enabled; with the eligible count unknown it holds", () => {
    const off = decideDuty(null, input({ production: "off", eligibleCount: 0, readyCount: 0 }));
    expect(off.transition).toBe("open");
    expect(off.next?.cause).toBe("off_nothing_eligible");
    expect(off.next?.owner).toContain("operator");
    expect(decideDuty(null, input({ production: "off", eligibleCount: null, readyCount: null })).transition).toBe("none");
    expect(decideDuty(null, input({ production: "off", eligibleCount: 3, readyCount: 3 })).next?.cause).toBe("ready_below_floor");
  });

  it("production Off with nothing eligible pages nobody by default (the flag is off), and the floor is not judged while Off", () => {
    const quietNight = decideDuty(null, input({ production: "off", eligibleCount: 0, readyCount: 0, offNothingAlarm: false }));
    expect(quietNight.transition).toBe("none");
    expect(quietNight.evaluation.active).toEqual([]);
    expect(quietNight.evaluation.unknown).toEqual([]);
    // A short scope while Off is the normal wait for START, so it is not a floor page by default either.
    expect(decideDuty(null, input({ production: "off", eligibleCount: 3, readyCount: 3, offNothingAlarm: false })).transition).toBe("none");
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
    const delivered = { ...(opened.next as DutyEpisodeRecord), delivery: { pingId: "p1", queuedAt: at("17:00:00") } };
    const narrowed = decideDuty(delivered, input({ custodian: { readable: true, lastLiveAt: ms("16:00:00"), reason: null }, readyCount: 10 }));
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

  /** Every queued ping goes in `queued`; the keeper alarm also pages these Active fixtures, so duty assertions use the duty agent. */
  function harness(root: string, queued: LivenessPingInput[], options: { failNext?: boolean; dutyOffAlarm?: boolean; repoRoot?: () => string } = {}) {
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
      run: (clock: string, current: IdleFrontRow, custodian: CustodianLiveness = healthy, startable: StartableCount = { readable: true, count: current.ready_actions, reason: null }) =>
        runProductionMomentumCheckCommand(
          // dutyOffAlarm is passed exactly as the timer passes it: undefined unless the flag was given.
          { workspace: root, readyFloor: 6, dutyOffAlarm: options.dutyOffAlarm },
          // With a repoRoot, the real readiness read runs (no injected count); otherwise the count is injected.
          {
            ...deps, now: () => ms(clock), readRow: async () => ({ ...current, ts: at(clock) }), readCustodian: () => custodian,
            ...(options.repoRoot ? { repoRoot: options.repoRoot } : { readStartable: () => startable })
          }
        ).then((response) => response.data)
    };
  }

  const duties = (queued: LivenessPingInput[]) => queued.filter((ping) => ping.agent === "Duty alarm");
  const state = (root: string) => JSON.parse(readFileSync(path.join(root, ".arcadia", "momentum-watch.json"), "utf8")) as { duty: { open: DutyEpisodeRecord | null; closedAt: string | null } };

  it("with --duty-off-alarm, pages once for an Off run with nothing eligible, records delivery and leaves acknowledgment empty, then closes with one line", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued, { dutyOffAlarm: true });
    const off = row({ desired: "inactive", ready_actions: 0 });

    const first = await h.run("17:00:00", off);
    expect(first.duty.ping).toBe("alert");
    expect((await h.run("17:01:00", off)).duty.ping).toBeNull();
    expect((await h.run("17:02:00", off)).duty.ping).toBeNull();
    expect(duties(queued)).toHaveLength(1);
    expect(duties(queued)[0]?.message).toContain("production Off with nothing eligible");

    const open = state(root).duty.open;
    expect(open?.cause).toBe("off_nothing_eligible");
    expect(open?.delivery).toEqual({ pingId: first.duty.pingId, queuedAt: at("17:00:00") });
    expect(open?.acknowledgment).toBeNull();

    const closed = await h.run("17:05:00", row({ ready_actions: 10 }));
    expect(closed.duty.ping).toBe("close");
    expect(duties(queued)).toHaveLength(2);
    expect(duties(queued)[1]?.message).toMatch(new RegExp(`^✅ DUTY cleared: production Off with nothing eligible, 5 min after the duty alarm \\(${first.duty.pingId}\\)`));
    expect(state(root).duty.open).toBeNull();
    expect(state(root).duty.closedAt).toBe(at("17:05:00"));
  });

  it("by default, a quiet Off night pages no duty alarm at all", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    expect((await h.run("17:00:00", row({ desired: "inactive", ready_actions: 0 }))).duty.ping).toBeNull();
    expect(duties(queued)).toHaveLength(0);
    expect(state(root).duty.open).toBeNull();
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
    expect(duties(queued)).toHaveLength(1);
    expect(duties(queued)[0]?.message).toContain("no custodian live");
  });

  it("a failed queue keeps the recorded, undelivered episode, so the next run queues it under the same key", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued, { failNext: true });
    const low = row({ ready_actions: 2 });
    await expect(h.run("17:00:00", low)).rejects.toThrow(/duty alarm was not queued and will be retried.*outbox busy/);
    const recorded = state(root).duty.open;
    expect(recorded?.delivery).toBeNull();
    expect((await h.run("17:01:00", low)).duty.ping).toBe("alert");
    const sent = duties(queued);
    expect(sent).toHaveLength(1);
    expect(state(root).duty.open?.key).toBe(recorded?.key);
  });

  it("a page queued whose delivery write then fails is queued again under the same key, never minted as a new episode", async () => {
    const root = workspace();
    const statePath = path.join(root, ".arcadia", "momentum-watch.json");
    const queued: LivenessPingInput[] = [];
    let breakOnce = true;
    let savedBeforeQueue = "";
    const deps: ProductionMomentumDependencies = {
      queuePing: (input) => {
        queued.push(input);
        if (input.agent === "Duty alarm" && breakOnce) {
          // Simulate the delivery write failing: the state file cannot be replaced after the page is queued.
          breakOnce = false;
          savedBeforeQueue = readFileSync(statePath, "utf8");
          rmSync(statePath);
          mkdirSync(statePath);
        }
        return { id: `ping_${queued.length}` };
      }
    };
    const run = (clock: string) => runProductionMomentumCheckCommand(
      { workspace: root, readyFloor: 6 },
      { ...deps, now: () => ms(clock), readRow: async () => ({ ...row({ ready_actions: 2 }), ts: at(clock) }), readCustodian: () => healthy, readStartable: () => ({ readable: true, count: 2, reason: null }) }
    );

    await expect(run("17:00:00")).rejects.toThrow();
    // The episode was on disk before its page was queued, undelivered.
    expect(JSON.parse(savedBeforeQueue).duty.open.delivery).toBeNull();
    // The fault clears, and the state the pre-queue write persisted is still there.
    rmSync(statePath, { recursive: true, force: true });
    writeFileSync(statePath, savedBeforeQueue);

    const second = (await run("17:01:00")).data;
    expect(second.duty.ping).toBe("alert");
    const sent = duties(queued);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.episodeKey).toBe(sent[0]?.episodeKey);
    expect(state(root).duty.open?.delivery).not.toBeNull();
  });

  it("an existing state file with no duty slot still reads, as an empty duty slot", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued, { dutyOffAlarm: true });
    // A state file from before duty alarms: the other alarms' slots only.
    const legacy = { schema: "arcadia-momentum-watch-v2", idle: { open: null, closedAt: null }, keeper: { open: null, closedAt: null }, check: { open: null, closedAt: null }, checkFailingSince: null };
    writeFileSync(path.join(root, ".arcadia", "momentum-watch.json"), JSON.stringify(legacy));
    expect((await h.run("17:00:00", row({ ready_actions: 10 }))).duty.ping).toBeNull();
    expect(duties(queued)).toHaveLength(0);
  });

  it("with the flag left undefined, a quiet Off night with a stale custodian pages nobody through the wired path", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    const stale: CustodianLiveness = { readable: true, lastLiveAt: ms("16:00:00"), reason: null };
    expect((await h.run("17:00:00", row({ desired: "inactive", ready_actions: 0 }), stale)).duty.ping).toBeNull();
    expect(duties(queued)).toHaveLength(0);
    expect(state(root).duty.open).toBeNull();
  });

  it("the same stale custodian pages with the Off alarm on, and pages by default when production is not Off", async () => {
    const stale: CustodianLiveness = { readable: true, lastLiveAt: ms("16:00:00"), reason: null };
    const onRoot = workspace();
    const onQueued: LivenessPingInput[] = [];
    const on = harness(onRoot, onQueued, { dutyOffAlarm: true });
    expect((await on.run("17:00:00", row({ desired: "inactive", ready_actions: 0 }), stale)).duty.ping).toBe("alert");
    expect(duties(onQueued)[0]?.message).toContain("no custodian live");

    const activeRoot = workspace();
    const activeQueued: LivenessPingInput[] = [];
    const active = harness(activeRoot, activeQueued);
    expect((await active.run("17:00:00", row({ ready_actions: 10 }), stale)).duty.ping).toBe("alert");
  });

  it("the startable count decides the Off alarm and the floor, not ready_actions: a blocked-only scope is not eligible", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued, { dutyOffAlarm: true });
    // 10 unmerged scope Actions, none startable: the Off alarm must still fire.
    const none = { readable: true, count: 0, reason: null } as const;
    expect((await h.run("17:00:00", row({ desired: "inactive", ready_actions: 10 }), healthy, none)).duty.ping).toBe("alert");
    expect(duties(queued)[0]?.message).toContain("production Off with nothing eligible");
  });

  it("an unreadable startable count is unknown: it holds the Off alarm (no episode), surfaces as one cannot-judge page, and never reads as zero", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued, { dutyOffAlarm: true });
    const unreadable = { readable: false, count: null, reason: "readiness blocked" } as const;
    expect((await h.run("17:00:00", row({ desired: "inactive", ready_actions: 0 }), healthy, unreadable)).duty.ping).toBeNull();
    expect(duties(queued).every((ping) => ping.message.includes("DUTY CANNOT JUDGE"))).toBe(true);
    expect(duties(queued).some((ping) => ping.message.includes("production Off with nothing eligible"))).toBe(false);
  });

  it("the floor fires while Off with the Off alarm on, through the wired path, and stays quiet with it off", async () => {
    const onRoot = workspace();
    const onQueued: LivenessPingInput[] = [];
    const on = harness(onRoot, onQueued, { dutyOffAlarm: true });
    const scarce = { readable: true, count: 2, reason: null } as const;
    expect((await on.run("17:00:00", row({ desired: "inactive", ready_actions: 2 }), healthy, scarce)).duty.ping).toBe("alert");
    expect(duties(onQueued)[0]?.message).toContain("ready Actions below the floor");

    const offRoot = workspace();
    const offQueued: LivenessPingInput[] = [];
    const off = harness(offRoot, offQueued);
    expect((await off.run("17:00:00", row({ desired: "inactive", ready_actions: 2 }), healthy, scarce)).duty.ping).toBeNull();
    expect(duties(offQueued)).toHaveLength(0);
  });

  it("an episode that never reached the outbox and then cleared is paged once as cleared, and closes at once", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued, { failNext: true });
    await expect(h.run("17:00:00", row({ ready_actions: 2 }))).rejects.toThrow(/outbox busy/);
    const recorded = state(root).duty.open;
    expect(recorded?.delivery).toBeNull();
    // The first run's startable read (2) is cached for 5 minutes, so the count only changes once the cache expires.
    const cleared = await h.run("17:06:00", row({ ready_actions: 10 }));
    expect(cleared.duty.ping).toBe("alert");
    const sent = duties(queued);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toContain("Cleared before this page was sent");
    expect(sent[0]?.episodeKey).toBe(recorded?.key);
    expect(state(root).duty.open).toBeNull();
    expect(state(root).duty.closedAt).toBe(at("17:06:00"));
  });

  it("a first observed admission is not progress: the floor pages until a real count change, then the healthy window holds it to the cap", async () => {
    const moving = (live: number, ready: number) => row({
      ready_actions: ready,
      critical_path: { state: "moving", label: "test", desired_state: "active", revision: 1, epoch: 1, live_admissions: live }
    });
    const first = harness(workspace(), []);
    expect((await first.run("17:00:00", moving(1, 2))).duty.ping).toBe("alert");

    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    expect((await h.run("16:55:00", moving(0, 10))).duty.ping).toBeNull();
    // The count went 0 -> 1 at 17:00: a real change starts the healthy window.
    expect((await h.run("17:00:00", moving(1, 2))).duty.ping).toBeNull();
    expect((await h.run("17:01:00", moving(1, 2))).duty.ping).toBeNull();
    // 125 minutes after the change: past the 120-minute cap, the floor pages.
    expect((await h.run("19:05:00", moving(1, 2))).duty.ping).toBe("alert");
  });

  it("an open episode is carried, not closed, while production is Off with the Off alarm off, and resumes when not Off", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    const stale: CustodianLiveness = { readable: true, lastLiveAt: ms("16:00:00"), reason: null };
    expect((await h.run("17:00:00", row(), stale)).duty.ping).toBe("alert");
    // Off with default flags: the custodian condition is not judged, so the open episode is carried, never cleared.
    expect((await h.run("17:01:00", row({ desired: "inactive", ready_actions: 0 }), stale)).duty.ping).toBeNull();
    expect(state(root).duty.open?.cause).toBe("no_custodian");
    // Back to not Off, condition still holding: the same episode continues, with no second page.
    expect((await h.run("17:02:00", row(), stale)).duty.ping).toBeNull();
    expect(duties(queued)).toHaveLength(1);
    // The custodian is live again while not Off: the episode closes once, with its duration.
    const back: CustodianLiveness = { readable: true, lastLiveAt: ms("17:02:30"), reason: null };
    expect((await h.run("17:03:00", row(), back)).duty.ping).toBe("close");
    expect(duties(queued)).toHaveLength(2);
    expect(duties(queued)[1]?.message).toContain("DUTY cleared");
  });

  it("a custodian that returns during Off neither closes the open episode nor pages; it closes once when judgement resumes", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    const stale: CustodianLiveness = { readable: true, lastLiveAt: ms("16:00:00"), reason: null };
    expect((await h.run("17:00:00", row(), stale)).duty.ping).toBe("alert");
    // The custodian is live again, but production is Off and not judged: nothing closes, nothing pages.
    const live: CustodianLiveness = { readable: true, lastLiveAt: ms("17:01:30"), reason: null };
    expect((await h.run("17:02:00", row({ desired: "inactive", ready_actions: 0 }), live)).duty.ping).toBeNull();
    expect(state(root).duty.open?.cause).toBe("no_custodian");
    expect(duties(queued)).toHaveLength(1);
    // Judgement resumes (not Off): the episode closes once.
    expect((await h.run("17:03:00", row(), live)).duty.ping).toBe("close");
    expect(duties(queued)).toHaveLength(2);
    expect(duties(queued)[1]?.message).toContain("DUTY cleared");
  });

  it("an unknown count is surfaced: one duty page per unknown episode, named in the output, and cleared when judgement resumes", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    const unreadable = { readable: false, count: null, reason: "readiness blocked for martianrover: scope" } as const;
    const first = await h.run("17:00:00", row(), healthy, unreadable);
    expect(first.dutyUnknown).toEqual(["ready Action count is unknown: readiness blocked for martianrover: scope"]);
    expect(renderProductionMomentumLines(first).join("\n")).toContain("readiness blocked for martianrover");
    expect(duties(queued)).toHaveLength(1);
    expect(duties(queued)[0]?.message).toContain("DUTY CANNOT JUDGE");
    expect(duties(queued)[0]?.message).toContain("readiness blocked for martianrover");

    const again = await h.run("17:01:00", row(), healthy, unreadable);
    expect(again.dutyUnknown).toHaveLength(1);
    expect(duties(queued)).toHaveLength(1);

    const readable = { readable: true, count: 10, reason: null } as const;
    expect((await h.run("17:02:00", row(), healthy, readable)).dutyUnknown).toEqual([]);
    expect(duties(queued)).toHaveLength(2);
    expect(duties(queued)[1]?.message).toContain("DUTY can judge again");
  });

  it("an unknown count while Off pages nothing by default, and pages with the Off alarm on", async () => {
    const unreadable = { readable: false, count: null, reason: "readiness blocked" } as const;
    const offQueued: LivenessPingInput[] = [];
    const off = harness(workspace(), offQueued);
    expect((await off.run("17:00:00", row({ desired: "inactive", ready_actions: 0 }), healthy, unreadable)).dutyUnknown).toEqual([]);
    expect(duties(offQueued)).toHaveLength(0);

    const onQueued: LivenessPingInput[] = [];
    const on = harness(workspace(), onQueued, { dutyOffAlarm: true });
    expect((await on.run("17:00:00", row({ desired: "inactive", ready_actions: 0 }), healthy, unreadable)).dutyUnknown.length).toBeGreaterThan(0);
    expect(duties(onQueued)).toHaveLength(1);
    expect(duties(onQueued)[0]?.message).toContain("DUTY CANNOT JUDGE");
  });

  it("the readiness walk runs at most once per 5 minutes: the cached count serves the runs between", async () => {
    const root = workspace();
    let reads = 0;
    const deps: ProductionMomentumDependencies = {
      queuePing: () => ({ id: "ping_cache" }),
      readCustodian: () => healthy,
      readStartable: () => {
        reads += 1;
        return { readable: true, count: 10, reason: null };
      }
    };
    for (const clock of ["17:00:00", "17:01:00", "17:02:00", "17:05:00", "17:06:00"]) {
      await runProductionMomentumCheckCommand({ workspace: root, readyFloor: 6 }, { ...deps, now: () => ms(clock), readRow: async () => ({ ...row(), ts: at(clock) }) });
    }
    expect(reads).toBe(2);
  });

  // Finding 1: production Off clears the policy scope; the real read must still count the retained Projects.
  describe("the real startable read while production is Off", () => {
    const actionLines = (id: string, status: string) => [
      `  - id: ${id}`, `    title: Work ${id}`, `    status: ${status}`, "    responsibility: agent", "    effort: short",
      "    clarification: clarified", `    next_action: Do ${id}.`, "    confidence: high", "    source: conversation",
      "    acceptance_criteria:", "      - The change is covered by a deterministic test.", "    depends_on: []"
    ];

    function repoWith(actionStatus: "open" | "blocked"): string {
      const repo = mkdtempSync(path.join(tmpdir(), "arcadia-duty-repo-"));
      roots.push(repo);
      mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
      writeFileSync(path.join(repo, "PROJECT.md"), ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
        "goal: Test the duty read.", "milestone: First milestone", "active_plan: plan-a", "updated: 2026-11-12", "---", ""].join("\n"));
      writeFileSync(path.join(repo, "docs", "plans", "plan-a.md"), ["---", "arcadia: v1", "type: plan", "slug: plan-a", "project: demo",
        "status: active", "milestone: First milestone", "token_impact: medium", "token_budget: One bounded pass; tests are deterministic.",
        "recommended_model: gpt-5.6-terra", "updated: 2026-11-12", "actions:", ...actionLines("alpha", actionStatus), ...actionLines("beta", actionStatus), "---", ""].join("\n"));
      return repo;
    }

    /** What `arcadia production deactivate` leaves: scope cleared, the reviewed scope retained in its own table. */
    function setOff(root: string, retained: boolean): void {
      withDatabase(root, (db) => {
        db.prepare("UPDATE production_policy SET desired_state = 'inactive', scope_json = NULL, authority_json = NULL").run();
        if (retained) {
          db.prepare(`INSERT INTO production_inactive_configuration
              (id, configuration_revision, fingerprint, saved_at_policy_revision, source_epoch, source_authority_request_id, scope_json, not_carried_json, saved_at)
            VALUES ('workspace', 1, 'test', 1, 1, NULL, ?, '[]', ?)`).run(JSON.stringify({ projects: ["demo"], plans: [], actions: [], providers: [] }), at("16:00:00"));
        }
      });
    }

    it("counts the retained Projects while Off, so a Off with nothing eligible pages through the real read", async () => {
      const root = workspace();
      setOff(root, true);
      const queued: LivenessPingInput[] = [];
      const h = harness(root, queued, { dutyOffAlarm: true, repoRoot: () => repoWith("blocked") });
      const response = await h.run("17:00:00", row({ desired: "inactive", ready_actions: 0 }));
      expect(response.duty.ping).toBe("alert");
      expect(duties(queued)[0]?.message).toContain("production Off with nothing eligible");
    });

    it("counts ready work in the retained Projects while Off (no false alarm on a stocked Off)", () => {
      const root = workspace();
      setOff(root, true);
      expect(readStartableCount(root, () => repoWith("open"))).toEqual({ readable: true, count: 2, reason: null });
    });

    it("stays unknown while Off when no configuration was ever retained, never a silent zero", () => {
      const root = workspace();
      setOff(root, false);
      const read = readStartableCount(root, () => repoWith("open"));
      expect(read.readable).toBe(false);
      expect(read.count).toBeNull();
    });
  });

  // Finding 2: a persisted episode without a `delivery` field must not read as already queued.
  describe("persisted episodes must carry an explicit delivery", () => {
    it("a recorded duty episode with no delivery field is queued again, never silently carried", async () => {
      const root = workspace();
      const statePath = path.join(root, ".arcadia", "momentum-watch.json");
      const queued: LivenessPingInput[] = [];
      const h = harness(root, queued);
      await h.run("17:00:00", row({ ready_actions: 2 }));
      const saved = JSON.parse(readFileSync(statePath, "utf8")) as { duty: { open: Record<string, unknown> } };
      delete saved.duty.open.delivery;
      writeFileSync(statePath, JSON.stringify(saved));
      // The malformed episode is rejected (the momentum state is replaced), so the run reports it and pages a fresh episode.
      await expect(h.run("17:01:00", row({ ready_actions: 2 }))).rejects.toThrow(/malformed duty slot/);
      const alerts = duties(queued).filter((ping) => ping.message?.includes("ready Actions below the floor"));
      expect(alerts).toHaveLength(2);
      expect(state(root).duty.open).not.toBeNull();
    });

    it("a recorded cannot-judge episode with no delivery field is paged again, not treated as queued", async () => {
      const root = workspace();
      const statePath = path.join(root, ".arcadia", "momentum-watch.json");
      const queued: LivenessPingInput[] = [];
      const h = harness(root, queued);
      const unreadable: CustodianLiveness = { readable: false, lastLiveAt: null, reason: "transcript store locked" };
      await h.run("17:00:00", row({ ready_actions: 2 }), unreadable);
      const saved = JSON.parse(readFileSync(statePath, "utf8")) as { duty: { unknown: Record<string, unknown> | null } };
      expect(saved.duty.unknown).not.toBeNull();
      delete saved.duty.unknown!.delivery;
      writeFileSync(statePath, JSON.stringify(saved));
      await h.run("17:01:00", row({ ready_actions: 2 }), unreadable);
      expect(duties(queued).filter((ping) => ping.message?.includes("DUTY CANNOT JUDGE"))).toHaveLength(2);
    });
  });

  // Finding 3: the episode key must survive a long reasons list (reasons belong in the cut detail, not the head).
  it("a cannot-judge page keeps its episode key and the Nothing-was-started line when the reasons are long", async () => {
    const root = workspace();
    const queued: LivenessPingInput[] = [];
    const h = harness(root, queued);
    const longReason = "readiness blocked for demo: " + "field-name, ".repeat(40);
    const unreadable: CustodianLiveness = { readable: false, lastLiveAt: null, reason: longReason };
    await h.run("17:00:00", row({ ready_actions: 2 }), unreadable);
    const page = duties(queued).find((ping) => ping.message?.includes("DUTY CANNOT JUDGE"))?.message ?? "";
    const key = (JSON.parse(readFileSync(path.join(root, ".arcadia", "momentum-watch.json"), "utf8")) as { duty: { unknown: { key: string } } }).duty.unknown.key;
    expect(page.length).toBeLessThanOrEqual(500);
    expect(page).toContain(key);
    expect(page).toContain("Nothing was started.");
  });
});
