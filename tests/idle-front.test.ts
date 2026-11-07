import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVE_IDLE_GRACE_MS,
  ARMED_WAKE_SCHEMA,
  IDLE_FRONT_ROW_SCHEMA,
  MAX_ARMED_HORIZON_MS,
  classifyIdleFront,
  detectionsFromTimeline,
  idleFrontInputFromStatus,
  idleFrontTimelineEvents,
  parseArmedWakeFile,
  wakesFromProcesses,
  type IdleFrontInput,
  type IdleFrontStatusView
} from "../src/production/idleFront.js";
import { renderProductionIdleFrontSuccess, runProductionIdleFrontCommand } from "../src/commands/productionIdleFront.js";
import { timelineEvent, type TimelineEvent } from "../src/timeline/schema.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const at = (clock: string) => `2026-11-07T${clock}.000Z`;
const NOW = new Date(at("17:00:00"));

function input(overrides: Partial<IdleFrontInput> = {}): IdleFrontInput {
  return {
    now: NOW,
    production: { readable: true, reason: null, desiredState: "active", revision: 104, epoch: 57, policyUpdatedAt: at("15:00:00"), liveAdmissions: 1, label: "Active · Building (1 admitted)" },
    scopeActions: ["arcadia/pin-a", "arcadia/pin-b"],
    mergedActions: [],
    movements: [at("15:00:00")],
    blockers: [],
    detections: [],
    wakes: [],
    expectWakes: [],
    hints: {},
    ...overrides
  };
}

describe("classifyIdleFront: the critical path and its idle minutes by cause", () => {
  it("reports a building Active run as moving with no idle time", () => {
    const row = classifyIdleFront(input());
    expect(row.schema).toBe(IDLE_FRONT_ROW_SCHEMA);
    expect(row.ts).toBe(NOW.toISOString());
    expect(row.critical_path.state).toBe("moving");
    expect(row.blocker_class).toBe("none");
    expect(row.blocked_since).toBeNull();
    expect(row.idle_minutes).toBe(0);
    expect(row.idle_minutes_by_cause).toEqual({ detection_lag: 0, no_route: 0, waiting_on_operator: 0, no_ready_work: 0 });
  });

  it("treats a short Active idle between ticks as moving, not as missing work", () => {
    const lastMerge = new Date(NOW.getTime() - ACTIVE_IDLE_GRACE_MS + 60_000).toISOString();
    const row = classifyIdleFront(input({
      production: { ...input().production, liveAdmissions: 0, label: "Active · No admitted work" },
      movements: [lastMerge],
      mergedActions: ["arcadia/pin-a"]
    }));
    expect(row.critical_path.state).toBe("moving");
    expect(row.idle_minutes).toBe(0);
  });

  it("splits an Active scope-complete gap into detection lag then no ready work", () => {
    const row = classifyIdleFront(input({
      production: { ...input().production, liveAdmissions: 0, label: "Active · No admitted work" },
      mergedActions: ["arcadia/pin-a", "arcadia/pin-b"],
      movements: [at("15:00:00"), at("16:15:23")],
      detections: [{ at: at("16:10:00"), evidence: "operator_pings/early" }, { at: at("16:20:23"), evidence: "operator_pings/p1" }]
    }));
    expect(row.critical_path.state).toBe("blocked");
    expect(row.blocker_class).toBe("no_ready_work");
    expect(row.blocked_since).toBe(at("16:15:23"));
    // The 16:10 ping predates the block, so it detects nothing.
    expect(row.detected_at).toBe(at("16:20:23"));
    expect(row.ready_actions).toBe(0);
    expect(row.idle_minutes_by_cause).toEqual({ detection_lag: 5, no_route: 0, waiting_on_operator: 0, no_ready_work: 39.6 });
    expect(row.idle_minutes).toBe(44.6);
  });

  it("measures an Inactive gap with ready work left as detection lag then no route", () => {
    const row = classifyIdleFront(input({
      production: { ...input().production, desiredState: "inactive", liveAdmissions: 0, policyUpdatedAt: at("16:20:00"), label: "Inactive · Idle" },
      mergedActions: ["arcadia/pin-a"],
      movements: [at("16:15:00")],
      detections: [{ at: at("16:20:00"), evidence: "production_policy_receipts/off" }]
    }));
    expect(row.critical_path.state).toBe("inactive");
    expect(row.blocker_class).toBe("no_route");
    expect(row.blocked_since).toBe(at("16:15:00"));
    expect(row.ready_actions).toBe(1);
    expect(row.tap_ready).toBeNull();
    expect(row.idle_minutes_by_cause).toEqual({ detection_lag: 5, no_route: 40, waiting_on_operator: 0, no_ready_work: 0 });
  });

  it("counts time after a ready tap as waiting on the operator, Active or Inactive", () => {
    const row = classifyIdleFront(input({
      production: { ...input().production, desiredState: "inactive", liveAdmissions: 0, label: "Inactive · Idle" },
      movements: [at("16:00:00")],
      detections: [{ at: at("16:10:00"), evidence: "operator_pings/p" }],
      hints: { tapReadyAt: at("16:30:00"), routeAt: at("16:25:00") }
    }));
    expect(row.blocker_class).toBe("waiting_on_operator");
    expect(row.tap_ready).toBe(at("16:30:00"));
    expect(row.route_at).toBe(at("16:25:00"));
    expect(row.idle_minutes_by_cause).toEqual({ detection_lag: 10, no_route: 20, waiting_on_operator: 30, no_ready_work: 0 });
  });

  it("blocks a building run on a one-click escalation and charges it all to the operator", () => {
    const row = classifyIdleFront(input({
      blockers: [{ source: "escalation", key: "arcadia/pin-a", kind: "environment_wall", since: at("16:40:00"), operatorBound: true, tapReady: true }]
    }));
    expect(row.critical_path.state).toBe("blocked");
    expect(row.blocker_class).toBe("waiting_on_operator");
    expect(row.blocked_since).toBe(at("16:40:00"));
    expect(row.tap_ready).toBe(at("16:40:00"));
    expect(row.idle_minutes_by_cause).toEqual({ detection_lag: 0, no_route: 0, waiting_on_operator: 20, no_ready_work: 0 });
  });

  it("ignores blockers the worker resolves itself", () => {
    const row = classifyIdleFront(input({
      blockers: [{ source: "escalation", key: "arcadia/pin-a", kind: "awaiting_independent_verdicts", since: at("16:40:00"), operatorBound: false, tapReady: false }]
    }));
    expect(row.critical_path.state).toBe("moving");
    expect(row.blockers).toHaveLength(1);
  });

  it("never reports an unreadable production state as all clear", () => {
    const row = classifyIdleFront(input({ production: { readable: false, reason: "database locked", desiredState: null, revision: null, epoch: null, policyUpdatedAt: null, liveAdmissions: 0, label: "Observation unavailable" } }));
    expect(row.critical_path.state).toBe("unreadable");
    expect(row.blocker_class).toBe("unreadable");
    expect(row.idle_minutes).toBeNull();
    expect(row.idle_minutes_by_cause).toBeNull();
  });

  it("lets no side-front activity offset critical-path idle time", () => {
    const quiet = input({ production: { ...input().production, desiredState: "inactive", liveAdmissions: 0, label: "Inactive · Idle" }, movements: [at("16:00:00")] });
    const row = classifyIdleFront(quiet);
    // No detection evidence at all: the whole gap is detection lag, whatever else moved.
    expect(row.idle_minutes_by_cause?.detection_lag).toBe(60);
    expect(row.idle_minutes).toBe(60);
  });
});

describe("armed wakes (deferral D2)", () => {
  it("says no wake is armed when none is live, and names expected sessions without one", () => {
    const row = classifyIdleFront(input({
      wakes: [{ session: "rowan", role: "coordinator", armedAt: at("14:00:00"), armedUntil: at("16:00:00"), source: "heartbeat-file", evidence: "rowan.json" }],
      expectWakes: ["rowan"]
    }));
    expect(row.no_armed_wake).toBe(true);
    expect(row.missing_wakes).toEqual(["rowan"]);
    expect(row.armed_wakes).toEqual([]);
  });

  it("counts a running waiter process and an unexpired heartbeat as armed", () => {
    const wakes = [
      ...wakesFromProcesses([
        { pid: 10, ppid: 1, elapsedSeconds: 60, command: "bash /x/quiet-watch.sh" },
        { pid: 11, ppid: 1, elapsedSeconds: 60, command: "node dist/cli.js timeline --wait --scope production" },
        { pid: 12, ppid: 1, elapsedSeconds: 60, command: "vim notes.md" },
        { pid: 13, ppid: 1, elapsedSeconds: 60, command: "/bin/zsh -c source snap.sh && bash /x/quiet-watch.sh" }
      ]),
      { session: "rowan", role: "coordinator", armedAt: at("16:00:00"), armedUntil: at("18:00:00"), source: "heartbeat-file" as const, evidence: "rowan.json" }
    ];
    expect(wakes.filter((wake) => wake.source === "process")).toHaveLength(2);
    const row = classifyIdleFront(input({ wakes, expectWakes: ["rowan", "coordinator", "signal"] }));
    expect(row.no_armed_wake).toBe(false);
    expect(row.armed_wakes).toHaveLength(3);
    expect(row.missing_wakes).toEqual(["signal"]);
  });

  it("reads an armed-until heartbeat file and refuses an unknown shape", () => {
    const good = parseArmedWakeFile("rowan.json", JSON.stringify({ schema: ARMED_WAKE_SCHEMA, session: "rowan", role: "coordinator", armedAt: at("16:00:00"), armedUntil: at("18:00:00") }));
    expect(good).toEqual({ ok: true, wake: { session: "rowan", role: "coordinator", armedAt: at("16:00:00"), armedUntil: at("18:00:00"), source: "heartbeat-file", evidence: "rowan.json" } });
    expect(parseArmedWakeFile("x.json", "{\"schema\":\"other\"}")).toMatchObject({ ok: false });
    expect(parseArmedWakeFile("y.json", "not json")).toMatchObject({ ok: false });
    expect(parseArmedWakeFile("z.json", JSON.stringify({ schema: ARMED_WAKE_SCHEMA, session: "s", armedUntil: "never" }))).toMatchObject({ ok: false });
  });
});

describe("idleFrontInputFromStatus: production status to classifier input", () => {
  const status = (overrides: Partial<IdleFrontStatusView> = {}): IdleFrontStatusView => ({
    read: { status: "ok", policy: { desiredState: "active", revision: 104, epoch: 57, updatedAt: at("15:00:00"), scope: { actions: ["arcadia/pin-a", "arcadia/pin-b", "arcadia/pin-c", "arcadia/pin-d"] } } },
    display: { label: "Active · Building (1 admitted)" },
    liveAdmissions: 1,
    admissions: [{ issuedAt: at("15:01:00"), committedAt: at("15:02:00"), releasedAt: at("15:20:00") }],
    operatorEscalations: [
      { actionKey: "arcadia/pin-a", kind: "environment_wall", firstDetectedAt: at("16:00:00") },
      { actionKey: "arcadia/pin-d", kind: "repair_budget_exhausted", firstDetectedAt: at("16:01:00") },
      { actionKey: "arcadia/pin-b", kind: "awaiting_independent_verdicts", firstDetectedAt: at("16:05:00") },
      { actionKey: "arcadia/pin-c", kind: "a_kind_nobody_registered", firstDetectedAt: at("16:06:00") },
      { actionKey: "old-rehearsal/write-marker", kind: "build_packet_approval_pending", firstDetectedAt: at("01:00:00") }
    ],
    redAlerts: [],
    launchBlockers: [{ projectSlug: "arcadia", code: "provider_signed_out", actionKey: null, observedAt: at("16:07:00") }],
    inactiveConfiguration: null,
    ...overrides
  });

  it("maps blockers through the remedy registry, unknown kinds counting as the operator's", () => {
    const mapped = idleFrontInputFromStatus(status(), { now: NOW, merges: [{ action_key: "arcadia/pin-a", outcome: "merged", updated_at: at("15:25:00") }, { action_key: "arcadia/pin-b", outcome: "refused", updated_at: at("15:26:00") }] });
    expect(mapped.production).toMatchObject({ readable: true, desiredState: "active", liveAdmissions: 1 });
    expect(mapped.scopeActions).toEqual(["arcadia/pin-a", "arcadia/pin-b", "arcadia/pin-c", "arcadia/pin-d"]);
    // A stale escalation outside the scope is not on the critical path.
    expect(mapped.blockers.map((blocker) => blocker.key)).not.toContain("old-rehearsal/write-marker");
    expect(mapped.blockers).toHaveLength(5);
    expect(mapped.mergedActions).toEqual(["arcadia/pin-a"]);
    expect(mapped.movements).toEqual(expect.arrayContaining([at("15:00:00"), at("15:20:00"), at("15:25:00")]));
    expect(mapped.movements).not.toContain(at("15:26:00"));
    const byKind = Object.fromEntries(mapped.blockers.map((blocker) => [blocker.kind, blocker]));
    expect(byKind.environment_wall).toMatchObject({ operatorBound: true, tapReady: true });
    expect(byKind.repair_budget_exhausted).toMatchObject({ operatorBound: true, tapReady: false });
    expect(byKind.awaiting_independent_verdicts).toMatchObject({ operatorBound: false });
    expect(byKind.a_kind_nobody_registered).toMatchObject({ operatorBound: true, tapReady: false });
    expect(byKind.provider_signed_out).toMatchObject({ source: "launch_blocker", operatorBound: true, tapReady: false });
  });

  it("uses the retained configuration's scope while Inactive, and ignores the Off itself as movement", () => {
    const mapped = idleFrontInputFromStatus(status({
      read: { status: "ok", policy: { desiredState: "inactive", revision: 105, epoch: 57, updatedAt: at("16:20:00"), scope: null } },
      inactiveConfiguration: { scope: { actions: ["arcadia/pin-z"] } },
      liveAdmissions: 0,
      admissions: [],
      operatorEscalations: [],
      launchBlockers: []
    }), { now: NOW, merges: [] });
    expect(mapped.scopeActions).toEqual(["arcadia/pin-z"]);
    expect(mapped.movements).toEqual([]);
  });

  it("maps an unreadable policy to an unreadable production view", () => {
    const mapped = idleFrontInputFromStatus(status({ read: { status: "unavailable", reason: "locked" } }), { now: NOW, merges: [] });
    expect(mapped.production).toMatchObject({ readable: false, reason: "locked" });
  });
});

describe("idleFrontTimelineEvents: what the check would put on the timeline", () => {
  it("emits one check event and a no-armed-wake event in the timeline event shape", () => {
    const row = classifyIdleFront(input({ production: { ...input().production, desiredState: "inactive", liveAdmissions: 0, label: "Inactive · Idle" }, movements: [at("16:00:00")] }));
    const events = idleFrontTimelineEvents(row, "/w");
    expect(events.map((event) => event.kind)).toEqual(["momentum.idle_front.check", "momentum.no_armed_wake"]);
    for (const event of events) {
      expect(event.schema).toBe("arcadia-timeline-event-v1");
      expect(event.source).toBe("timeline");
      expect(event.clock).toBe("collector");
      expect(event.time).toBe(NOW.toISOString());
      expect(event.subjects.workspace).toBe("/w");
    }
    expect(events[0]?.attention).toBe(true);
    expect(events[0]?.id).toBe(`timeline:idle-front:${NOW.toISOString()}`);
  });

  it("emits only the check event, without attention, while the path moves and a wake is armed", () => {
    const row = classifyIdleFront(input({ wakes: wakesFromProcesses([{ pid: 1, ppid: 0, elapsedSeconds: 1, command: "bash scripts/wait-for-event.sh production" }]) }));
    const events = idleFrontTimelineEvents(row, "/w");
    expect(events.map((event) => event.kind)).toEqual(["momentum.idle_front.check"]);
    expect(events[0]?.attention).toBe(false);
  });
});

describe("runProductionIdleFrontCommand: the read-only CLI surface", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("reads a fresh workspace, prints the row then NDJSON events, and writes nothing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-idle-front-"));
    roots.push(root);
    initWorkspace(root);
    const wakes = path.join(root, "wakes");
    mkdirSync(wakes);
    writeFileSync(path.join(wakes, "rowan.json"), JSON.stringify({ schema: ARMED_WAKE_SCHEMA, session: "rowan", armedAt: at("16:00:00"), armedUntil: at("16:30:00") }));
    writeFileSync(path.join(wakes, "broken.json"), "{");
    const response = await runProductionIdleFrontCommand(
      { workspace: root, wakesDir: wakes, expectWake: ["rowan"] },
      { now: () => NOW, listProcesses: () => [] }
    );
    const row = response.data.row;
    expect(row.critical_path.state).toBe("inactive");
    expect(row.no_armed_wake).toBe(true);
    expect(row.missing_wakes).toEqual(["rowan"]);
    expect(response.data.wakeReadProblems).toEqual([expect.stringContaining("broken.json")]);
    const lines = renderProductionIdleFrontSuccess(response);
    expect(JSON.parse(lines[0] ?? "")).toEqual(row);
    expect(lines.slice(1).map((line) => (JSON.parse(line) as { kind: string }).kind)).toEqual(["momentum.idle_front.check", "momentum.no_armed_wake"]);
  });

  it("refuses a hint that is not a time", async () => {
    await expect(runProductionIdleFrontCommand({ tapReadyAt: "soon" }, { now: () => NOW, listProcesses: () => [] })).rejects.toThrow(/--tap-ready-at/);
  });
});

function sumsToTotal(row: ReturnType<typeof classifyIdleFront>): void {
  const parts = Object.values(row.idle_minutes_by_cause ?? {}).reduce((sum, value) => sum + Math.round(value * 10), 0);
  expect(parts).toBe(Math.round((row.idle_minutes ?? 0) * 10));
}

function policyEvent(time: string, transition: string, granted: boolean): TimelineEvent {
  return timelineEvent({
    id: `production:policy:${time}`, time, clock: "workspace-db", source: "production", kind: `production.policy.${transition}`, workKind: "operate", summary: transition,
    actor: { tool: granted ? "operator" : "unknown", name: null, tier: null, role: null, account: null, confidence: granted ? "high" : "none" },
    evidence: [{ kind: "receipt", value: `production_policy_receipts/${time}` }], provenance: {}
  }) as TimelineEvent;
}

function pingEvent(time: string, message: string): TimelineEvent {
  return timelineEvent({
    id: `pings:${time}`, time, clock: "workspace-db", source: "pings", kind: "ping.created", workKind: "observe", summary: `Ping (attention, pending): ${message}`,
    evidence: [{ kind: "row", value: `operator_pings/${time}` }], provenance: {}
  }) as TimelineEvent;
}

describe("review round 1: detection evidence and honest nulls", () => {
  const scope = ["arcadia/pin-a", "arcadia/pin-b"];
  const activeStatus = (): IdleFrontStatusView => ({
    read: { status: "ok", policy: { desiredState: "active", revision: 104, epoch: 57, updatedAt: at("16:00:00"), scope: { actions: scope } } },
    display: { label: "Active · No admitted work" },
    liveAdmissions: 0,
    admissions: [],
    operatorEscalations: [],
    redAlerts: [],
    launchBlockers: [],
    inactiveConfiguration: null
  });

  it("charges a silent stall after activation entirely to detection lag", () => {
    const detections = detectionsFromTimeline([policyEvent(at("16:00:00"), "activate", true)], scope);
    const row = classifyIdleFront(idleFrontInputFromStatus(activeStatus(), { now: NOW, merges: [], detections }));
    expect(row.blocked_since).toBe(at("16:00:00"));
    expect(row.detected_at).toBeNull();
    expect(row.idle_minutes_by_cause).toEqual({ detection_lag: 60, no_route: 0, waiting_on_operator: 0, no_ready_work: 0 });
  });

  it("keeps only grantor policy receipts and pings that name a scope Action or production", () => {
    const detections = detectionsFromTimeline([
      policyEvent(at("16:10:00"), "terminal_off", false),
      pingEvent(at("16:11:00"), "Rebuster #45 needs a review"),
      pingEvent(at("16:12:00"), "pin-b is waiting on a packet"),
      pingEvent(at("16:13:00"), "Production stalled"),
      policyEvent(at("16:14:00"), "activate", true)
    ], scope);
    expect(detections.map((detection) => detection.at)).toEqual([at("16:12:00"), at("16:13:00"), at("16:14:00")]);
  });

  it("does not let an unrelated ping end detection lag", () => {
    const detections = detectionsFromTimeline([pingEvent(at("16:05:00"), "Design brief #534 ready")], scope);
    const row = classifyIdleFront(idleFrontInputFromStatus(activeStatus(), { now: NOW, merges: [], detections }));
    expect(row.idle_minutes_by_cause?.detection_lag).toBe(60);
  });

  it("reports an unknown scope as unknown, not as no ready work", () => {
    const row = classifyIdleFront(input({ scopeActions: [], production: { ...input().production, desiredState: "inactive", liveAdmissions: 0, label: "Inactive · Idle" }, movements: [at("16:00:00")] }));
    expect(row.blocker_class).toBe("unknown");
    expect(row.ready_actions).toBeNull();
    expect(row.idle_minutes).toBe(60);
    expect(row.idle_minutes_by_cause).toBeNull();
  });

  it("gives null minutes for an unparseable blocker time or no movement record", () => {
    const badSince = classifyIdleFront(input({ blockers: [{ source: "escalation", key: "arcadia/pin-a", kind: "x", since: "not a time", operatorBound: true, tapReady: false }] }));
    expect(badSince.critical_path.state).toBe("blocked");
    expect(badSince.idle_minutes).toBeNull();
    expect(badSince.idle_minutes_by_cause).toBeNull();
    const noMovement = classifyIdleFront(input({ production: { ...input().production, desiredState: "inactive", liveAdmissions: 0, label: "Inactive · Idle" }, movements: [] }));
    expect(noMovement.critical_path.state).toBe("inactive");
    expect(noMovement.blocked_since).toBeNull();
    expect(noMovement.idle_minutes).toBeNull();
  });

  it("rounds so the parts always sum exactly to the total", () => {
    const row = classifyIdleFront(input({
      production: { ...input().production, desiredState: "inactive", liveAdmissions: 0, label: "Inactive · Idle" },
      movements: [at("16:00:03")],
      detections: [{ at: at("16:10:06"), evidence: "p" }],
      hints: { tapReadyAt: at("16:31:09") }
    }));
    sumsToTotal(row);
    expect(row.idle_minutes_by_cause?.waiting_on_operator).toBeGreaterThan(0);
  });
});

describe("review round 1: armed-wake evidence", () => {
  const WS = "/w/live";
  it("anchors waiter processes on an interpreter and the script argument", () => {
    const wakes = wakesFromProcesses([
      { pid: 1, ppid: 0, elapsedSeconds: 1, command: "vim scripts/wait-for-event.sh" },
      { pid: 2, ppid: 0, elapsedSeconds: 1, command: "less /x/quiet-watch.sh" },
      { pid: 3, ppid: 0, elapsedSeconds: 1, command: "grep timeline --wait" },
      { pid: 4, ppid: 0, elapsedSeconds: 1, command: "bash -c bash /x/quiet-watch.sh" },
      { pid: 5, ppid: 0, elapsedSeconds: 1, command: "/bin/bash scripts/wait-for-event.sh production" },
      { pid: 6, ppid: 0, elapsedSeconds: 1, command: "/x/scripts/wait-for-event.sh pr 2184" },
      { pid: 7, ppid: 0, elapsedSeconds: 1, command: "node scripts/comms-watch-issue.mjs 1929" },
      { pid: 8, ppid: 0, elapsedSeconds: 1, command: "node dist/cli.js timeline --wait --workspace /w/other" },
      { pid: 9, ppid: 0, elapsedSeconds: 1, command: "node dist/cli.js timeline --wait --workspace /w/live" },
      { pid: 10, ppid: 0, elapsedSeconds: 1, command: "arcadia timeline --wait --scope production" }
    ], WS);
    expect(wakes.map((wake) => wake.evidence.split(":")[0])).toEqual(["pid 5", "pid 6", "pid 7", "pid 9", "pid 10"]);
  });

  it("ignores a heartbeat armed beyond the horizon", () => {
    const far = new Date(NOW.getTime() + MAX_ARMED_HORIZON_MS + 60_000).toISOString();
    const near = new Date(NOW.getTime() + MAX_ARMED_HORIZON_MS - 60_000).toISOString();
    const row = classifyIdleFront(input({ wakes: [
      { session: "rowan", role: null, armedAt: null, armedUntil: far, source: "heartbeat-file", evidence: "rowan.json" },
      { session: "signal", role: null, armedAt: null, armedUntil: near, source: "heartbeat-file", evidence: "signal.json" }
    ] }));
    expect(row.armed_wakes.map((wake) => wake.session)).toEqual(["signal"]);
    expect(row.notes.join(" ")).toMatch(/rowan\.json/);
  });

  it("reports the armed state as unknown when the process list could not be read", () => {
    const row = classifyIdleFront(input({ processesReadable: false }));
    expect(row.no_armed_wake).toBeNull();
    const events = idleFrontTimelineEvents(row, "/w");
    expect(events.find((event) => event.kind === "momentum.no_armed_wake")?.summary).toMatch(/unknown/);
  });
});

describe("review round 1: command guards", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("refuses a --tap-ready-at or --route-at later than now", async () => {
    await expect(runProductionIdleFrontCommand({ tapReadyAt: at("17:30:00") }, { now: () => NOW, listProcesses: () => [] })).rejects.toThrow(/--tap-ready-at/);
    await expect(runProductionIdleFrontCommand({ routeAt: at("17:30:00") }, { now: () => NOW, listProcesses: () => [] })).rejects.toThrow(/--route-at/);
  });

  it("keeps the check running when ps fails, reporting waiters unreadable", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-idle-front-ps-"));
    roots.push(root);
    initWorkspace(root);
    const response = await runProductionIdleFrontCommand({ workspace: root }, { now: () => NOW, listProcesses: () => { throw new Error("ps timed out"); } });
    expect(response.data.row.no_armed_wake).toBeNull();
    expect(response.warnings.join(" ")).toMatch(/ps timed out/);
  });
});
