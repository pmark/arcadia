import { describe, expect, it, vi } from "vitest";
import type { Approval } from "./approvals";
import type { ConsoleCoreData } from "./production-console";
import { SKY_RESUME_GRACE_MS, SKY_STALE_MS, readSky } from "./system-sky";
import { STATUS_SOURCES, createWorkspaceStatus, skySourcesFrom, type StatusLoaders, type WorkspaceStatus } from "./workspace-status";

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const core = (displayState: string): ConsoleCoreData => ({ generatedAt: "x", production: { displayState }, productionError: null, worker: { running: true, heartbeat: { timestamp: null, fresh: true, available: true } }, sessions: { active: [], recent: [] }, sessionsError: null, pause: {} }) as unknown as ConsoleCoreData;
const never = () => new Promise<never>(() => {});
function loaders(over: Partial<StatusLoaders> = {}): StatusLoaders {
  return {
    approvals: vi.fn(async () => [] as Approval[]),
    nextSteps: vi.fn(async () => ({ steps: [], nowStep: null, state: "moving" }) as never),
    pullRequests: vi.fn(async () => null),
    production: vi.fn(async () => core("inactive_idle")),
    ...over
  };
}

describe("workspace status read", () => {
  it("answers at once while every source is still loading", () => {
    const read = createWorkspaceStatus(loaders({ approvals: never, nextSteps: never, pullRequests: never, production: never }), () => 1_000);
    const status = read();
    expect(status.counts).toEqual({ blocking: 0, yours: 0, failing: 0, others: 0, prs: 0 });
    expect(status.sources.production).toEqual({ asOf: null, failed: false });
    expect(status.production).toBeNull();
  });

  it("stays small however long the lists are", async () => {
    const long = "x".repeat(50_000);
    const approvals = Array.from({ length: 300 }, (_, i) => ({ kind: "decision", id: String(i), project: "p", title: long, detail: long, gateQuestion: long, options: [], blocking: i < 3 })) as unknown as Approval[];
    const read = createWorkspaceStatus(loaders({ approvals: async () => approvals }), () => 1_000);
    read();
    await flush();
    const status = read();
    expect(status.counts.yours).toBe(300);
    expect(JSON.stringify(status).length).toBeLessThan(1_000);
  });

  it("shares one refresh across callers and respects each source's pace", async () => {
    let at = 0;
    const approvals = vi.fn(async () => [] as Approval[]);
    const nextSteps = vi.fn(async () => ({ steps: [], nowStep: null, state: "moving" }) as never);
    const production = vi.fn(async () => core("inactive_idle"));
    const read = createWorkspaceStatus(loaders({ approvals, nextSteps, production }), () => at);
    read(); read(); read();
    await flush();
    read();
    expect(approvals).toHaveBeenCalledTimes(1);
    at = 30_000;
    read();
    await flush();
    expect(production).toHaveBeenCalledTimes(2);
    expect(approvals).toHaveBeenCalledTimes(1);
    at = 60_000;
    read();
    await flush();
    expect(approvals).toHaveBeenCalledTimes(2);
    expect(nextSteps).toHaveBeenCalledTimes(1);
  });

  it("doesn't start a second read of a source while one is running", async () => {
    let at = 0;
    const production = vi.fn(never);
    const read = createWorkspaceStatus(loaders({ production }), () => at);
    read();
    at = 10 * 60_000;
    read();
    expect(production).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good answer and its real age when a refresh fails", async () => {
    let at = 1_000, fail = false;
    const read = createWorkspaceStatus(loaders({ production: async () => { if (fail) throw new Error("no"); return core("active_idle"); } }), () => at);
    read();
    await flush();
    fail = true;
    at = 40_000;
    read();
    await flush();
    const status = read();
    expect(status.sources.production).toEqual({ asOf: 1_000, failed: true });
    expect(status.production?.displayState).toBe("active_idle");
  });

  it("uses the inventory's own checked time for pull requests", async () => {
    const read = createWorkspaceStatus(loaders({ pullRequests: async () => ({ snapshot: { pullRequests: [] } as never, checkedAt: 500 }) }), () => 9_000);
    read();
    await flush();
    expect(read().sources["pull requests"].asOf).toBe(500);
  });
});

describe("what the sky makes of it", () => {
  const counts = { blocking: 0, yours: 0, failing: 0, others: 0, prs: 0 };
  const facts = { displayState: "inactive_idle", workerRunning: true, heartbeatFresh: true, liveSessions: 0, stalledSessions: 0 };
  const status = (over: Partial<WorkspaceStatus> = {}, at: number | null = 1_000): WorkspaceStatus => ({
    generatedAt: "x", counts, production: facts,
    sources: Object.fromEntries(STATUS_SOURCES.map(name => [name, { asOf: at, failed: false }])) as WorkspaceStatus["sources"],
    ...over
  });
  const sky = (s: WorkspaceStatus | null, unreachable = false, resumedAt = 0, now = 1_000) => readSky(skySourcesFrom(s, unreachable, resumedAt, now));

  it("makes no claim until every source has landed", () => {
    expect(sky(null).id).toBe("reading");
    expect(sky(status({ production: null }, null)).id).toBe("reading");
  });

  it("doesn't blame production when the status read itself can't be reached", () => {
    const reading = sky(null, true);
    expect(reading).toMatchObject({ id: "static", production: null });
    expect(reading.reasons.map(r => r.text)).toEqual(["could not read Arcadia's status"]);
  });

  it("keeps the last answer's bad news when the read becomes unreachable", () => {
    expect(sky(status({ counts: { ...counts, blocking: 1, yours: 1 } }), true).id).toBe("storm");
    expect(sky(status(), true).id).toBe("static");
  });

  it("says it can't read production only when production's own read failed", () => {
    const sources = status().sources;
    expect(sky(status({ production: null, sources: { ...sources, production: { asOf: null, failed: true } } }))).toMatchObject({ id: "static", production: "Can't read production" });
    expect(sky(status({ sources: { ...sources, production: { asOf: 1_000, failed: true } } }))).toMatchObject({ id: "clear", production: "Production Off" });
  });

  it("reads a failed list as Signal loss", () => {
    const sources = status().sources;
    expect(sky(status({ sources: { ...sources, "next steps": { asOf: 1_000, failed: true } } })).reasons[0].text).toBe("could not read next steps");
  });

  it("ages old data into Signal loss, with a grace after coming back", () => {
    const now = SKY_STALE_MS + 2_000;
    expect(sky(status(), false, now, now).id).toBe("reading");
    expect(sky(status(), false, 0, now + SKY_RESUME_GRACE_MS).id).toBe("static");
  });
});
