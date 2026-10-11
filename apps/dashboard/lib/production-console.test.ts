import { describe, expect, it } from "vitest";
import type { ScheduleBatch } from "./arcadia-cli";
import {
  assembleProjects,
  assembleQueue,
  PAUSE_CAPABILITY,
  sessionLogPath,
  summarizeProduction,
  summarizeSession,
  trimBatch,
  trimWorkQueue
} from "./production-console";
import type { DashboardAgentSession } from "./types";
import type { WorkQueue, WorkQueueEntry } from "./work-queue-types";

function entry(overrides: Partial<WorkQueueEntry> & { actionId: string; projectSlug: string }): WorkQueueEntry {
  return {
    id: `wq:${overrides.projectSlug}/${overrides.actionId}`,
    state: "ready",
    attentionKind: null,
    selected: false,
    pointerAuthorized: true,
    projectId: `proj-${overrides.projectSlug}`,
    projectName: overrides.projectSlug,
    planSlug: "plan-a",
    actionTitle: `Title of ${overrides.actionId}`,
    responsibility: "agent",
    expectedArtifact: null,
    tokenImpact: "medium",
    tokenBudget: null,
    dependencies: [],
    status: "ready",
    reason: "Ready and authorized.",
    nextAction: "Do it",
    blockers: [],
    runId: null,
    decisionId: null,
    updatedAt: "2026-10-09T00:00:00.000Z",
    orderKey: `${overrides.projectSlug}/${overrides.actionId}`,
    ...overrides
  };
}

function queue(entries: WorkQueueEntry[]): WorkQueue {
  return {
    generatedAt: "2026-10-09T00:00:00.000Z",
    revision: 7,
    ordered: entries,
    nextActionKey: entries[0]?.orderKey ?? null,
    unpositionedCount: 0,
    orderValid: true,
    undoReceipt: null,
    counts: { ready: 0, running: 0, flagged: 0, attention: 0 }
  };
}

function lane(id: string, projects: string[], actions: Array<{ projectSlug: string; actionId: string; position: number }>, stops: ScheduleBatch["lanes"][number]["stops"] = []): ScheduleBatch["lanes"][number] {
  return {
    laneId: id,
    laneLabel: id,
    repositoryRoot: `/repos/${id}`,
    projectSlugs: projects,
    sequenceAdvised: actions.length > 1,
    token: { points: actions.length * 2, tiers: ["medium"] },
    actions: actions.map((action) => ({
      ...action,
      title: `Title of ${action.actionId}`,
      projectName: action.projectSlug,
      planSlug: "plan-a",
      planPath: "docs/plans/plan-a.md",
      tokenImpact: "medium",
      tokenPoints: 2,
      recommendedModel: "claude-sonnet-5",
      recommendedReasoningEffort: null
    })),
    stops,
    boundary: stops[0] ?? null,
    nextPush: []
  };
}

function session(overrides: Partial<DashboardAgentSession> = {}): DashboardAgentSession {
  return {
    id: "sess-1",
    projectId: "proj-arcadia",
    projectName: "Arcadia",
    actionId: "build-thing",
    actionTitle: "Build the thing",
    planSlug: "plan-a",
    packetPath: "prompts/p.md",
    provider: "claude-code-cli",
    model: "sonnet",
    effort: "high",
    host: "mac",
    worktreePath: "/wt",
    branch: "claude/build-thing",
    nativeSessionId: "native",
    tmuxSessionName: "tmux",
    status: "running",
    statusLabel: "Running",
    live: true,
    observedStatus: "running",
    preparedAt: "2026-10-09T00:00:00.000Z",
    startedAt: "2026-10-09T00:00:10.000Z",
    observedAt: "2026-10-09T00:01:00.000Z",
    reattachCommand: "tmux attach-session -t tmux",
    resumeCommand: null,
    resumeNotice: null,
    phoneLimitationNotice: "phone",
    ...overrides
  };
}

describe("production console: server-side trimming", () => {
  it("keeps queue order and only the fields the page renders", () => {
    const trimmed = trimWorkQueue(queue([
      entry({ projectSlug: "arcadia", actionId: "first", blockers: [{ relativePath: "p.md", field: "depends_on", message: "Waits.", remedy: "Finish it." }] }),
      entry({ projectSlug: "rebuster", actionId: "second" })
    ]));
    expect(trimmed.revision).toBe(7);
    expect(trimmed.entries.map((item) => [item.position, item.key])).toEqual([[1, "arcadia/first"], [2, "rebuster/second"]]);
    expect(trimmed.entries[0].blocker).toBe("Waits. Fix: Finish it.");
    expect(Object.keys(trimmed.entries[0])).not.toContain("acceptanceCriteria");
  });

  it("reads concurrency and providers from the active scope, or from the saved configuration while Off", () => {
    const base = {
      read: { status: "ok", policy: { desiredState: "inactive", revision: 30, epoch: 4, scope: { providers: ["x"], maxConcurrentSessions: 9 } }, observedAt: "" },
      display: { state: "inactive_idle", label: "Inactive · Idle", observedAt: "" },
      liveAdmissions: 0,
      inactiveConfiguration: { scope: { providers: ["claude-code-cli"], maxConcurrentSessions: 2 } },
      operatorEscalations: [{ actionKey: "arcadia/a", kind: "k", message: "m", remedy: "r", firstDetectedAt: "", lastSeenAt: "" }]
    } as never;
    const summary = summarizeProduction(base);
    expect(summary).toMatchObject({ desiredState: "inactive", revision: 30, maxConcurrentSessions: 2, providers: ["claude-code-cli"], canReactivate: true });
    expect(summary.escalations).toEqual([{ actionKey: "arcadia/a", message: "m", remedy: "r" }]);
    expect(summary.scopeProjects).toBeNull();
  });

  it("reads the scope's Projects, from the saved configuration while Off", () => {
    const summary = summarizeProduction({
      read: { status: "ok", policy: { desiredState: "inactive", revision: 1, epoch: 1, scope: { projects: ["old"] } }, observedAt: "" },
      display: { state: "inactive_idle", label: "Inactive · Idle", observedAt: "" },
      liveAdmissions: 0,
      inactiveConfiguration: { scope: { projects: ["arcadia", "rebuster"], providers: [], maxConcurrentSessions: 1 } },
      operatorEscalations: []
    } as never);
    expect(summary.scopeProjects).toEqual(["arcadia", "rebuster"]);
  });
});

describe("production console: queue assembly", () => {
  const entries = [
    entry({ projectSlug: "arcadia", actionId: "a1" }),
    entry({ projectSlug: "arcadia", actionId: "a2", pointerAuthorized: false }),
    entry({ projectSlug: "rebuster", actionId: "r1" }),
    entry({ projectSlug: "arcadia", actionId: "a3", state: "attention", attentionKind: "document", status: "open", dependencies: ["a2", "long-done"] }),
    entry({ projectSlug: "arcadia", actionId: "decide", state: "attention", attentionKind: "decision", responsibility: "requires_review", status: "open" }),
    entry({ projectSlug: "site", actionId: "s1", responsibility: "blocked", state: "attention", status: "blocked" })
  ];
  const batch = trimBatch({
    token: { points: 6, tiers: ["medium"] },
    blockers: [],
    lanes: [
      lane("arcadia", ["arcadia"], [{ projectSlug: "arcadia", actionId: "a2", position: 2 }, { projectSlug: "arcadia", actionId: "a1", position: 1 }], [
        { kind: "decision", actionId: "decide", title: "Decide", projectSlug: "arcadia", projectName: "arcadia", planPath: "p", decisionId: "0096", prompt: "Answer Decision 0096." }
      ]),
      lane("Rebuster", ["rebuster"], [{ projectSlug: "rebuster", actionId: "r1", position: 1 }])
    ]
  });

  it("groups ready Actions into batches with at most one Action per repository", () => {
    const assembled = assembleQueue(trimWorkQueue(queue(entries)), batch, []);
    expect(assembled.waves.map((wave) => wave.actions.map((action) => action.key))).toEqual([
      ["arcadia/a1", "rebuster/r1"],
      ["arcadia/a2"]
    ]);
    for (const wave of assembled.waves) {
      const lanes = wave.actions.map((action) => action.laneLabel);
      expect(new Set(lanes).size).toBe(lanes.length);
    }
  });

  it("gives every Action a state chip, a reason and a Launch only when it is ready for an agent", () => {
    const assembled = assembleQueue(trimWorkQueue(queue(entries)), batch, []);
    const byKey = new Map(assembled.actions.map((action) => [action.key, action]));
    expect(byKey.get("arcadia/a1")).toMatchObject({ chip: "ready", wave: 1, launch: { allowed: true, needsMakeNext: false } });
    expect(byKey.get("arcadia/a2")).toMatchObject({ chip: "make_next", launch: { allowed: true, needsMakeNext: true } });
    // Only the unfinished dependency is named; one the queue no longer holds is done.
    expect(byKey.get("arcadia/a3")).toMatchObject({ chip: "waiting", waitsOn: [{ key: "arcadia/a2", title: "Title of a2" }], launch: { allowed: false } });
    expect(byKey.get("arcadia/a3")?.why).toBe("Waits on Title of a2");
    expect(byKey.get("arcadia/decide")).toMatchObject({ chip: "needs_you", launch: { allowed: false } });
    expect(byKey.get("site/s1")).toMatchObject({ chip: "blocked", launch: { allowed: false, disabledReason: "Only ready Actions can launch." } });
  });

  it("marks the running Action and holds the rest of its repository while a Session has the lease", () => {
    const assembled = assembleQueue(trimWorkQueue(queue(entries)), batch, [session({ projectId: "proj-arcadia", actionId: "a1", id: "s-live" })]);
    const byKey = new Map(assembled.actions.map((action) => [action.key, action]));
    expect(byKey.get("arcadia/a1")).toMatchObject({ chip: "running", sessionId: "s-live", launch: { allowed: false } });
    expect(byKey.get("arcadia/a2")).toMatchObject({ chip: "repo_busy", launch: { allowed: false, disabledReason: "Another Session holds this repository." } });
    expect(byKey.get("rebuster/r1")).toMatchObject({ chip: "ready", launch: { allowed: true } });
    expect(assembled.lanes.find((item) => item.laneId === "arcadia")?.busySessionId).toBe("s-live");
  });

  it("shows a stalled and a launching Session on their Actions", () => {
    const stalled = assembleQueue(trimWorkQueue(queue(entries)), batch, [session({ projectId: "proj-arcadia", actionId: "a1", observedStatus: "stalled" })]);
    expect(stalled.actions[0].chip).toBe("stalled");
    const launching = assembleQueue(trimWorkQueue(queue(entries)), batch, [session({ projectId: "proj-arcadia", actionId: "a1", status: "prepared", live: false })]);
    expect(launching.actions[0].chip).toBe("launching");
  });

  it("still lists every Action in queue order when the batch is unavailable", () => {
    const assembled = assembleQueue(trimWorkQueue(queue(entries)), null, []);
    expect(assembled.actions.map((action) => action.key)).toEqual(entries.map((item) => item.orderKey));
    expect(assembled.waves).toEqual([]);
  });
});

describe("production console: Sessions", () => {
  const now = new Date("2026-10-09T00:05:10.000Z");

  it("counts a live Session's elapsed time up to now", () => {
    expect(summarizeSession(session(), now)).toMatchObject({ chip: "running", label: "Running", elapsedSeconds: 300, exitLine: null });
  });

  it("reports exit code, outcome and PR for a finished Session", () => {
    const finished = summarizeSession(
      session({ status: "completed", live: false, endedAt: "2026-10-09T00:30:10.000Z", exitStatus: 0, exitOutcome: "accepted_completion", pullRequestUrl: "https://github.com/x/y/pull/1" }),
      now
    );
    expect(finished).toMatchObject({ chip: "pr_open", elapsedSeconds: 1800, exitLine: "exit 0 · Accepted: the Action is done" });
    expect(summarizeSession(session({ status: "failed", live: false, endedAt: "2026-10-09T00:01:10.000Z", exitStatus: 2 }), now)).toMatchObject({ chip: "failed", exitLine: "exit 2" });
  });

  it("flags a Session whose process is gone but which was never reconciled", () => {
    expect(summarizeSession(session({ live: false }), now)).toMatchObject({ chip: "unreconciled", elapsedSeconds: null });
  });

  it("reads the per-Session log the headless launch records", () => {
    expect(sessionLogPath("sess-1")).toBe(".arcadia/sessions/sess-1.log");
  });
});

describe("production console: pause controls", () => {
  it("reports Pause all and per-Session Pause as unavailable, with the reason", () => {
    expect(PAUSE_CAPABILITY.all.available).toBe(false);
    expect(PAUSE_CAPABILITY.session.available).toBe(false);
    expect(PAUSE_CAPABILITY.all.reason).toMatch(/^Not available yet/);
    expect(PAUSE_CAPABILITY.session.reason).toMatch(/^Not available yet/);
  });
});

describe("production console: Projects view", () => {
  const production = (scopeProjects: string[] | null, escalations: Array<{ actionKey: string; message: string; remedy: string | null }> = []) => ({
    displayState: "inactive_idle", label: "Inactive · Idle", desiredState: "inactive" as const, revision: 1, epoch: 1, liveAdmissions: 0,
    maxConcurrentSessions: 1, providers: [], escalations, canReactivate: true, scopeProjects
  });
  const entries = [
    entry({ projectSlug: "rebuster", actionId: "r1" }),
    entry({ projectSlug: "ppn", actionId: "p1", planSlug: "pilot" }),
    entry({ projectSlug: "ppn", actionId: "p2", planSlug: "pilot", pointerAuthorized: false, state: "attention", status: "open", dependencies: ["p1"] }),
    entry({ projectSlug: "ppn", actionId: "img", planSlug: "imagery", pointerAuthorized: false }),
    entry({ projectSlug: "site", actionId: "s1", pointerAuthorized: false })
  ];
  const assembled = assembleQueue(trimWorkQueue(queue(entries)), null, []);

  it("makes one card per Project in queue order, with its pointer Plan, counts, other Plans and what it would pick", () => {
    const cards = assembleProjects(assembled, production(null));
    expect(cards.map((card) => card.slug)).toEqual(["rebuster", "ppn", "site"]);
    const ppn = cards[1];
    expect(ppn).toMatchObject({ projectId: "proj-ppn", planSlug: "pilot", planOpen: 2, planReady: 1, chip: "ready", otherPlans: [{ slug: "imagery", open: 1 }] });
    expect(ppn.next?.actionId).toBe("p1");
    expect(cards[0].chip).toBe("next_up");
    expect(cards[2]).toMatchObject({ chip: "nothing_ready", next: null, planSlug: null });
  });

  it("marks only in-scope Projects as next up and flags the rest as outside the scope", () => {
    const cards = assembleProjects(assembled, production(["ppn"]));
    expect(cards.find((card) => card.slug === "rebuster")).toMatchObject({ inScope: false, chip: "ready" });
    expect(cards.find((card) => card.slug === "ppn")).toMatchObject({ inScope: true, chip: "next_up" });
  });

  it("says Needs you only when an escalation names the Project's pointer Action, and lists every escalation on its card", () => {
    const onPointer = assembleProjects(assembled, production(null, [{ actionKey: "ppn/p1", message: "Prepare the packet.", remedy: "arcadia work plan x" }]));
    expect(onPointer.find((card) => card.slug === "ppn")).toMatchObject({ chip: "needs_you", needs: [{ actionKey: "ppn/p1" }] });
    const elsewhere = assembleProjects(assembled, production(null, [{ actionKey: "ppn/img", message: "m", remedy: null }]));
    expect(elsewhere.find((card) => card.slug === "ppn")).toMatchObject({ chip: "ready", needs: [{ actionKey: "ppn/img" }] });
  });

  it("shows the running Action and its Plan while a Session holds it", () => {
    const running = assembleQueue(trimWorkQueue(queue(entries)), null, [session({ projectId: "proj-ppn", actionId: "img" })]);
    const ppn = assembleProjects(running, production(null)).find((card) => card.slug === "ppn");
    expect(ppn).toMatchObject({ chip: "running", planSlug: "imagery" });
    expect(ppn?.next?.actionId).toBe("img");
  });
});
