import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({
  loadProductionStatus: vi.fn(),
  loadRunsSnapshot: vi.fn(),
  loadScheduleSummary: vi.fn(),
  loadWorkQueue: vi.fn(),
  resolveDashboardWorkspace: vi.fn()
}));
vi.mock("../../../lib/arcadia-cli", () => cli);
vi.mock("../../../lib/system-status", () => ({
  readManagedRunWorker: vi.fn(async () => ({ running: true, heartbeat: { timestamp: "2026-10-09T00:00:00.000Z", fresh: true, available: true } }))
}));

import { GET } from "./route";

beforeEach(() => {
  for (const fn of Object.values(cli)) fn.mockReset();
  cli.resolveDashboardWorkspace.mockResolvedValue("/workspace");
});

async function get(part?: string) {
  const response = await GET(new Request(`http://arcadia.test/api/production-console${part ? `?part=${part}` : ""}`));
  return { status: response.status, body: await response.json() };
}

describe("GET /api/production-console", () => {
  it("assembles production, worker and Sessions, asks for recent Sessions, and reports both pause controls as unavailable", async () => {
    cli.loadProductionStatus.mockResolvedValue({
      data: {
        read: { status: "ok", policy: { desiredState: "active", revision: 31, epoch: 5, scope: { providers: ["claude-code-cli"], maxConcurrentSessions: 1 } }, observedAt: "" },
        display: { state: "active_idle", label: "Active · No admitted work", observedAt: "" },
        liveAdmissions: 0,
        inactiveConfiguration: null,
        operatorEscalations: []
      }
    });
    cli.loadRunsSnapshot.mockResolvedValue({ data: { runs: { activeAgentSessions: [{ id: "s1" }], activeExecutionRuns: [], recentRuns: [], recentAgentSessions: [{ id: "s0" }] } } });

    // `fresh` bypasses the core cache an earlier test may have filled.
    const { status, body } = await get("core&fresh=1");

    expect(status).toBe(200);
    expect(cli.loadRunsSnapshot).toHaveBeenCalledWith(0, 8);
    expect(body.production).toMatchObject({ label: "Active · No admitted work", desiredState: "active", revision: 31, maxConcurrentSessions: 1 });
    expect(body.worker).toMatchObject({ running: true });
    expect(body.sessions).toEqual({ active: [{ id: "s1" }], recent: [{ id: "s0" }] });
    expect(body.pause.all.available).toBe(false);
    expect(body.pause.session.available).toBe(false);
  });

  it("keeps the other parts when one CLI read fails, naming the failure", async () => {
    cli.loadProductionStatus.mockRejectedValue(new Error("policy store unreadable"));
    cli.loadRunsSnapshot.mockResolvedValue({ data: { runs: { activeAgentSessions: [], activeExecutionRuns: [], recentRuns: [] } } });

    const { body } = await get("core&fresh=1");

    expect(body.production).toBeNull();
    expect(body.productionError).toBe("policy store unreadable");
    expect(body.sessions).toEqual({ active: [], recent: [] });
  });

  it("answers an ordinary core poll from the last read, and fresh reads again", async () => {
    cli.loadProductionStatus.mockRejectedValue(new Error("first"));
    cli.loadRunsSnapshot.mockResolvedValue({ data: { runs: { activeAgentSessions: [], activeExecutionRuns: [], recentRuns: [] } } });
    const first = await get("core&fresh=1");
    cli.loadProductionStatus.mockRejectedValue(new Error("second"));

    const cached = await get("core");
    expect(cached.body.productionError).toBe("first");
    expect(cached.body.generatedAt).toBe(first.body.generatedAt);

    const fresh = await get("core&fresh=1");
    expect(fresh.body.productionError).toBe("second");
  });

  it("serves the queue part trimmed, with the schedule's lanes", async () => {
    cli.loadWorkQueue.mockResolvedValue({
      data: {
        generatedAt: "", revision: 3, nextActionKey: "arcadia/a", unpositionedCount: 0, orderValid: true, undoReceipt: null,
        counts: { ready: 1, running: 0, flagged: 0, attention: 0 },
        ordered: [{
          id: "x", state: "ready", attentionKind: null, selected: true, pointerAuthorized: true, projectId: "p", projectName: "Arcadia",
          projectSlug: "arcadia", planSlug: "plan", actionId: "a", actionTitle: "A", responsibility: "agent", expectedArtifact: null,
          tokenImpact: "small", tokenBudget: null, status: "ready", reason: "r", nextAction: "n", blockers: [], runId: null,
          decisionId: null, updatedAt: "", orderKey: "arcadia/a", acceptanceCriteria: ["long text"]
        }]
      }
    });
    cli.loadScheduleSummary.mockResolvedValue({ data: { projects: [], selection: null, batch: { token: { points: 1, tiers: ["small"] }, blockers: [], lanes: [] } } });

    const { body } = await get("queue");

    expect(body.queue.entries).toHaveLength(1);
    expect(body.queue.entries[0]).not.toHaveProperty("acceptanceCriteria");
    expect(body.batch).toEqual({ tokenPoints: 1, lanes: [] });
    expect(body.queueError).toBeNull();
  });

  it("rejects an unknown part", async () => {
    expect((await get("everything")).status).toBe(400);
  });
});
