import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyCommit, workKindFor, WORK_KIND_BY_EVENT_KIND } from "../src/timeline/classify.js";
import { diffGovernedFile, parseFrontmatter, scanPlanFrontmatter } from "../src/timeline/collectors/governed.js";
import { isAllowedGhCall, runGhReadOnly } from "../src/timeline/collectors/context.js";
import { parseReflogLine, redactUrlUserinfo } from "../src/timeline/collectors/git.js";
import { githubSlug } from "../src/timeline/collectors/pullRequests.js";
import { DEFAULT_FOLLOW_INTERVAL_MS, followTimeline } from "../src/timeline/follow.js";
import {
  actionHintFromBranch,
  actorFromCoAuthors,
  actorFromEmail,
  actorFromName,
  actorFromPeerWatchTrailer,
  actionFromPeerWatchTrailer,
  actorFromRoleActorId,
  actorFromSession,
  strongestActor,
  toolFromBranch,
  toolFromWorktreePath
} from "../src/timeline/identity.js";
import { compareEvents, mergeTimeline } from "../src/timeline/merge.js";
import { buildPointInTimeView } from "../src/timeline/rewind.js";
import { TIMELINE_EVENT_SCHEMA, WORK_KINDS, timelineEvent, type TimelineEvent, type TimelineEventInput } from "../src/timeline/schema.js";
import { parseTimeBound, resolveWindow } from "../src/timeline/time.js";

function event(input: Partial<TimelineEventInput> & { id: string; time: string }): TimelineEvent {
  const built = timelineEvent({
    clock: "workspace-db",
    source: "git",
    kind: "git.commit",
    workKind: "implement",
    summary: input.id,
    provenance: { event: "test" },
    ...input
  });
  if (!built) throw new Error("bad fixture time");
  return built;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("agent tool and semantic-name recovery", () => {
  it("reads the tool from a worktree path prefix", () => {
    expect(toolFromWorktreePath("/Users/x/.claude/worktrees/fix-thing-20261006T010203000Z/arcadia")?.actor.tool).toBe("claude-code");
    expect(toolFromWorktreePath("/Users/x/.codex/worktrees/a/arcadia")?.actor.tool).toBe("codex");
    expect(toolFromWorktreePath("/Users/x/.opencode/worktrees/a/arcadia")?.actor.tool).toBe("opencode");
    expect(toolFromWorktreePath("/Users/x/Dev/arcadia")).toBeNull();
    expect(toolFromWorktreePath("/Users/x/.codex/worktrees/a/arcadia")?.actor.confidence).toBe("medium");
  });

  it("reads the tool from a branch prefix and the Action slug from the branch name", () => {
    expect(toolFromBranch("refs/heads/opencode/x")?.actor.tool).toBe("opencode");
    expect(toolFromBranch("origin/claude/x")?.actor.tool).toBe("claude-code");
    expect(toolFromBranch("main")).toBeNull();
    expect(actionHintFromBranch("codex/operator-timeline-phase-1-20261006T044735866Z")).toBe("operator-timeline-phase-1");
    expect(actionHintFromBranch("opencode/back-burner-burndown-20261005T154246Z")).toBe("back-burner-burndown");
    expect(actionHintFromBranch("claude/operator-directed-work-20261005")).toBeNull();
  });

  it("recovers the full identity from an agent commit email, and only from the roster", () => {
    const claim = actorFromEmail("claudia.atlas@agents.arcadia.local");
    expect(claim?.actor).toMatchObject({ tool: "claude-code", name: "Claudia Atlas", tier: "heavy", role: "builder", confidence: "high" });
    expect(actorFromEmail("critic.cody.mason@agents.arcadia.local")?.actor).toMatchObject({ tool: "codex", role: "critic", tier: "standard" });
    expect(actorFromEmail("owen.swift@agents.arcadia.local")?.actor).toMatchObject({ tool: "opencode", tier: "light" });
    expect(actorFromEmail("nobody.here@agents.arcadia.local")?.actor).toMatchObject({ tool: "unknown", confidence: "low" });
    expect(actorFromEmail("controller@arcadia.local")?.actor).toMatchObject({ tool: "host-worker", confidence: "high" });
    expect(actorFromEmail("someone@example.com")).toBeNull();
    const operator = actorFromEmail("me@example.com", { operatorEmails: new Set(["me@example.com"]) });
    expect(operator?.actor).toMatchObject({ tool: "operator", confidence: "low" });
    expect(operator?.provenance).toContain("configured user.email");
  });

  it("recovers tool, tier and name from a Session row", () => {
    const fromEffort = actorFromSession({ provider: "claude-code-cli", model: "not-a-registered-model", effort: "e2_standard" });
    expect(fromEffort?.actor).toMatchObject({ tool: "claude-code", tier: "standard", name: "Claudia Mason", confidence: "high" });
    const unknownTier = actorFromSession({ provider: "codex-cli", model: "not-a-registered-model", effort: null });
    expect(unknownTier?.actor).toMatchObject({ tool: "codex", tier: null, name: null });
    expect(unknownTier?.provenance).toContain("tier unknown");
    expect(actorFromSession({ provider: "fixture-cli", model: "m" })).toBeNull();
  });

  it("weighs co-author trailers, names and role actor ids honestly", () => {
    expect(actorFromCoAuthors(["Claudia Atlas <claudia.atlas@agents.arcadia.local>", "Claude Sonnet 5.5 <noreply@anthropic.com>"])?.actor).toMatchObject({ tool: "claude-code", name: "Claudia Atlas", confidence: "medium" });
    expect(actorFromCoAuthors(["Claude Opus 5.5 <noreply@anthropic.com>"])?.actor).toMatchObject({ tool: "claude-code", confidence: "low", name: null });
    expect(actorFromCoAuthors([])).toBeNull();
    expect(actorFromName("Cody Mason")?.actor).toMatchObject({ tool: "codex", name: "Cody Mason" });
    expect(actorFromName("Somebody")).toBeNull();
    expect(actorFromRoleActorId("host-planner:work-plan", "planner").actor.tool).toBe("host-worker");
    expect(actorFromRoleActorId("qa-reviewer:codex-terra", "qa").actor).toMatchObject({ tool: "codex", role: "qa" });
    expect(actorFromRoleActorId("development-abc123", "development").actor.tool).toBe("unknown");
  });

  it("reads the peer-watch contract trailers exactly, and nothing malformed", () => {
    expect(actorFromPeerWatchTrailer("codex/heavy")?.actor).toMatchObject({ tool: "codex", tier: "heavy", name: "Cody Atlas", confidence: "high" });
    expect(actorFromPeerWatchTrailer("vim/heavy")).toBeNull();
    expect(actionFromPeerWatchTrailer("arcadia/operator-timeline-phase-1")).toEqual({ project: "arcadia", action: "operator-timeline-phase-1" });
    expect(actionFromPeerWatchTrailer("not an action")).toBeNull();
  });

  it("lets the strongest claim win, fills gaps from agreeing claims and notes disagreement", () => {
    const combined = strongestActor([toolFromWorktreePath("/h/.codex/worktrees/a/r"), actorFromEmail("claudia.atlas@agents.arcadia.local")]);
    expect(combined.actor).toMatchObject({ tool: "claude-code", name: "Claudia Atlas" });
    expect(combined.provenance).toContain("weaker evidence names a different tool");
    expect(strongestActor([]).actor.tool).toBe("unknown");
  });
});

describe("work kind classification", () => {
  it("maps every classified kind to a controlled work kind, and an unknown kind to unknown", () => {
    for (const kind of Object.values(WORK_KIND_BY_EVENT_KIND)) expect(WORK_KINDS).toContain(kind);
    expect(workKindFor("role.qa")).toBe("verify");
    expect(workKindFor("role.code-review")).toBe("review");
    expect(workKindFor("role.planner")).toBe("plan-design");
    expect(workKindFor("ask.settled")).toBe("govern");
    expect(workKindFor("production.admission.issued")).toBe("operate");
    expect(workKindFor("pr.merged")).toBe("integrate");
    expect(workKindFor("brand.new.kind")).toBe("unknown");
    // "Git ran here" is a signal, not work.
    expect(workKindFor("git.worktree.touched")).toBe("observe");
  });

  it("classifies commits by critic role, merge shape and conventional prefix", () => {
    expect(classifyCommit({ subject: "feat: x", parentCount: 1, actorRole: "critic", committerIsGitHub: false }).workKind).toBe("review");
    expect(classifyCommit({ subject: "Merge origin/main", parentCount: 2, actorRole: null, committerIsGitHub: false }).workKind).toBe("integrate");
    expect(classifyCommit({ subject: "feat: thing (#12)", parentCount: 1, actorRole: null, committerIsGitHub: true }).workKind).toBe("integrate");
    expect(classifyCommit({ subject: "test(x): cover it", parentCount: 1, actorRole: null, committerIsGitHub: false }).workKind).toBe("verify");
    expect(classifyCommit({ subject: "chore(arcadia): settle foo", parentCount: 1, actorRole: null, committerIsGitHub: false }).workKind).toBe("govern");
    expect(classifyCommit({ subject: "fix: y", parentCount: 1, actorRole: "builder", committerIsGitHub: false }).workKind).toBe("implement");
  });
});

describe("event schema", () => {
  it("normalises time to UTC, drops empty subjects, bounds the summary and rejects a bad time", () => {
    const built = event({ id: "a", time: "2026-10-06T03:30:00-07:00", summary: "x".repeat(500), subjects: { project: "p", plan: "" } });
    expect(built.schema).toBe(TIMELINE_EVENT_SCHEMA);
    expect(built.time).toBe("2026-10-06T10:30:00.000Z");
    expect(built.subjects).toEqual({ project: "p" });
    expect(built.summary.length).toBeLessThanOrEqual(240);
    expect(built.actor.tool).toBe("unknown");
    expect(timelineEvent({ id: "b", time: "not a time", clock: "collector", source: "git", kind: "git.commit", workKind: "implement", summary: "", provenance: {} })).toBeNull();
  });
});

describe("time windows", () => {
  const now = new Date("2026-10-06T05:00:00.000Z");
  it("parses ISO and relative bounds, and counts a relative --since back from the window end", () => {
    expect(parseTimeBound("6h", now, "--since").toISOString()).toBe("2026-10-05T23:00:00.000Z");
    expect(parseTimeBound("30m", now, "--since").toISOString()).toBe("2026-10-06T04:30:00.000Z");
    expect(parseTimeBound("2026-10-06T03:30Z", now, "--since").toISOString()).toBe("2026-10-06T03:30:00.000Z");
    // A time with no zone is UTC, like a bare date, never the host's local time.
    expect(parseTimeBound("2026-10-06T03:30", now, "--since").toISOString()).toBe("2026-10-06T03:30:00.000Z");
    expect(parseTimeBound("2026-10-06", now, "--since").toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(parseTimeBound("2026-10-06T03:30:00-07:00", now, "--since").toISOString()).toBe("2026-10-06T10:30:00.000Z");
    expect(() => parseTimeBound("yesterday", now, "--since")).toThrow(/ISO time/);
    const rewind = resolveWindow({ asOf: "2026-10-06T03:30:00Z", since: "2h", now });
    expect(rewind.until.toISOString()).toBe("2026-10-06T03:30:00.000Z");
    expect(rewind.since.toISOString()).toBe("2026-10-06T01:30:00.000Z");
    expect(resolveWindow({ now }).since.toISOString()).toBe("2026-10-05T05:00:00.000Z");
    expect(() => resolveWindow({ since: "2026-10-07", until: "2026-10-06", now })).toThrow(/after/);
  });
});

describe("ordering and de-duplication", () => {
  it("orders by time, then source priority, then id, deterministically", () => {
    const a = event({ id: "git:b", time: "2026-10-06T01:00:00Z" });
    const b = event({ id: "asks:a", source: "asks", kind: "ask.settled", time: "2026-10-06T01:00:00Z" });
    const c = event({ id: "git:a", time: "2026-10-06T00:59:00Z" });
    expect([a, b, c].sort(compareEvents).map((item) => item.id)).toEqual(["git:a", "asks:a", "git:b"]);
    expect(mergeTimeline([a, b, c]).map((item) => item.id)).toEqual(mergeTimeline([c, a, b]).map((item) => item.id));
  });

  it("folds a commit, its settlement, its governed facts and the worker's observation into one event with provenance", () => {
    const commit = event({ id: "git:p:commit:abc", time: "2026-10-06T01:00:00Z", summary: "chore(arcadia): settle x", actor: actorFromEmail("cody.mason@agents.arcadia.local")?.actor, dedupeKeys: ["commit:abc"], evidence: [{ kind: "sha", value: "abc" }], provenance: { event: "git", actor: "from email" } });
    const settlement = event({ id: "asks:settlement:1", source: "asks", kind: "ask.settled", workKind: "plan-design", time: "2026-10-06T01:00:01Z", summary: "Ask x settled", subjects: { project: "p" }, dedupeKeys: ["commit:abc", "settlement:x"] });
    const fact = event({ id: "governed-records:p:abc:0", source: "governed-records", kind: "record.action.created", workKind: "plan-design", time: "2026-10-06T01:00:00Z", dedupeKeys: ["commit:abc"] });
    const observed = event({ id: "events:1", source: "events", kind: "event.base_branch_advanced", workKind: "integrate", time: "2026-10-06T01:00:30Z", dedupeKeys: ["commit:abc"] });
    const notified = event({ id: "pings:n", source: "pings", kind: "notification.settlement_sent", workKind: "observe", time: "2026-10-06T01:02:00Z", dedupeKeys: ["settlement:x"] });
    const unrelated = event({ id: "git:p:commit:def", time: "2026-10-06T01:05:00Z", dedupeKeys: ["commit:def"] });
    const merged = mergeTimeline([commit, settlement, fact, observed, notified, unrelated]);
    expect(merged).toHaveLength(2);
    const [one] = merged;
    expect(one.id).toBe("asks:settlement:1");
    expect(one.alsoSeenAs.map((alias) => alias.id).sort()).toEqual(["events:1", "git:p:commit:abc", "governed-records:p:abc:0", "pings:n"]);
    expect(one.actor).toMatchObject({ tool: "codex", name: "Cody Mason" });
    expect(one.provenance.actor).toContain("git:p:commit:abc");
    expect(one.provenance.dedupe).toContain("4 other record");
    expect(one.evidence).toContainEqual({ kind: "sha", value: "abc" });
    expect(one.dedupeKeys).toBeUndefined();
  });

  it("keeps the first of two records with the same id", () => {
    const first = event({ id: "same", time: "2026-10-06T01:00:00Z", summary: "first" });
    const second = event({ id: "same", time: "2026-10-06T01:00:00Z", summary: "second" });
    expect(mergeTimeline([first, second]).map((item) => item.summary)).toEqual(["first"]);
  });
});

describe("governed-record facts", () => {
  const plan = (status: string, pointer: string, extra = "") => `---\narcadia: v1\ntype: plan\nslug: p1\nproject: demo\nstatus: active\nactions:\n  - id: a1\n    title: "First: one"\n    status: ${status}\n    acceptance_criteria:\n      - status: not-this\n  - id: a2\n    title: Second\n    status: open\n${extra}current_action: ${pointer}\n---\n\n# Plan\n`;

  it("scans Plan frontmatter like the YAML parser does for the fields it reads", () => {
    const content = plan("open", "a1");
    const scanned = scanPlanFrontmatter(content);
    const parsed = parseFrontmatter(content);
    expect(scanned?.status).toBe(parsed?.status);
    expect(scanned?.current_action).toBe(parsed?.current_action);
    expect((scanned?.actions as Array<Record<string, string>>).map((action) => [action.id, action.status, action.title])).toEqual([["a1", "open", "First: one"], ["a2", "open", "Second"]]);
  });

  it("derives Action done, Action created and pointer moves from before/after content", () => {
    const facts = diffGovernedFile("docs/plans/p1.md", plan("open", "a1"), plan("done", "a2", "  - id: a3\n    title: Third\n    status: open\n"));
    expect(facts.map((fact) => fact.kind)).toEqual(["record.plan.pointer_moved", "record.action.done", "record.action.created"]);
    const project = diffGovernedFile(
      "PROJECT.md",
      "---\narcadia: v1\ntype: project\nslug: demo\nactive_plan: p0\ncurrent_action: a1\n---\n",
      "---\narcadia: v1\ntype: project\nslug: demo\nactive_plan: p1\ncurrent_action: a2\n---\n"
    );
    expect(project.map((fact) => [fact.kind, fact.subjects.project])).toEqual([["record.project.plan_activated", "demo"], ["record.project.pointer_moved", "demo"]]);
    const decision = diffGovernedFile("docs/decisions/0001-x.md", null, "---\narcadia: v1\ntype: decision\nid: \"0001\"\nstatus: open\nquestion: Should we?\n---\n");
    expect(decision).toEqual([expect.objectContaining({ kind: "record.decision.raised", attention: true })]);
    expect(diffGovernedFile("docs/plans/p1.md", "not frontmatter", "still not")).toEqual([]);
  });
});

describe("parsers", () => {
  it("parses reflog lines and GitHub remotes", () => {
    const line = `${"a".repeat(40)} ${"b".repeat(40)} Cody Mason <cody.mason@agents.arcadia.local> 1791262269 -0700\tcommit: chore: x`;
    expect(parseReflogLine(line)).toMatchObject({ newSha: "b".repeat(40), email: "cody.mason@agents.arcadia.local", message: "commit: chore: x" });
    expect(parseReflogLine(line)?.time.toISOString()).toBe(new Date(1791262269 * 1000).toISOString());
    expect(parseReflogLine("garbage")).toBeNull();
    expect(githubSlug("git@github.com:pmark/arcadia.git")).toBe("pmark/arcadia");
    expect(githubSlug("https://github.com/pmark/mission-control-site.git")).toBe("pmark/mission-control-site");
    expect(githubSlug("/tmp/bare.git")).toBeNull();
  });
});

describe("read-only GitHub guard", () => {
  it("allows only the pulls listing with no flags, and refuses every write shape", () => {
    expect(isAllowedGhCall(["api", "repos/pmark/arcadia/pulls?state=all&sort=updated&direction=desc&per_page=50"])).toBe(true);
    for (const args of [
      ["api", "repos/pmark/arcadia/pulls?state=all", "-X", "POST"],
      ["api", "repos/pmark/arcadia/pulls?state=all", "--method=POST"],
      ["api", "-XPOST", "repos/pmark/arcadia/pulls?state=all"],
      ["api", "repos/pmark/arcadia/pulls?state=all", "-fq=x"],
      ["api", "repos/pmark/arcadia/pulls?state=all", "--raw-field=title=x"],
      ["api", "graphql"],
      ["api", "repos/pmark/arcadia/issues?state=all"],
      ["api", "repos/pmark/arcadia/pulls/1/merge"],
      ["pr", "merge", "1"]
    ]) {
      expect(isAllowedGhCall(args), args.join(" ")).toBe(false);
      expect(runGhReadOnly(args)).toMatchObject({ ok: false, stderr: expect.stringContaining("Refused") });
    }
  });

  it("redacts credentials from URLs a reflog message carries", () => {
    expect(redactUrlUserinfo("pull https://user:token@github.com/pmark/x.git: Fast-forward")).toBe("pull https://***@github.com/pmark/x.git: Fast-forward");
    expect(redactUrlUserinfo("pull origin main")).toBe("pull origin main");
  });
});

describe("--follow", () => {
  it("polls on the documented default interval and streams each event once", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-10-06T05:00:00.000Z");
    vi.setSystemTime(start);
    const store: TimelineEvent[] = [event({ id: "old", time: "2026-10-06T04:59:00Z" })];
    const windows: Array<{ since: string; until: string }> = [];
    const emitted: string[] = [];
    const controller = new AbortController();
    const done = followTimeline({
      since: new Date("2026-10-06T04:00:00.000Z"),
      signal: controller.signal,
      collect: (window) => {
        windows.push({ since: window.since.toISOString(), until: window.until.toISOString() });
        return Promise.resolve(store.filter((item) => item.time >= window.since.toISOString() && item.time <= window.until.toISOString()));
      },
      emit: (item) => emitted.push(item.id)
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(emitted).toEqual(["old"]);
    store.push(event({ id: "new", time: new Date(start.getTime() + 5_000).toISOString() }));
    await vi.advanceTimersByTimeAsync(DEFAULT_FOLLOW_INTERVAL_MS - 1);
    expect(windows).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(windows).toHaveLength(2);
    expect(emitted).toEqual(["old", "new"]);
    await vi.advanceTimersByTimeAsync(DEFAULT_FOLLOW_INTERVAL_MS);
    expect(emitted).toEqual(["old", "new"]);
    // Each poll re-reads an overlap before the previous poll's end, never before the first window.
    expect(windows[1].since).toBe("2026-10-06T04:50:00.000Z");
    controller.abort();
    await vi.advanceTimersByTimeAsync(DEFAULT_FOLLOW_INTERVAL_MS);
    await expect(done).resolves.toMatchObject({ polls: 3, emitted: 2 });
  });

  it("does not stream a fact again when a later poll changes which record leads it", async () => {
    const commit = event({ id: "git:commit", time: "2026-10-06T04:00:00Z", dedupeKeys: ["commit:x"] });
    const settlement = event({ id: "asks:settlement", source: "asks", kind: "ask.settled", workKind: "govern", time: "2026-10-06T04:00:05Z", dedupeKeys: ["commit:x"] });
    let poll = 0;
    const emitted: string[] = [];
    await followTimeline({
      since: new Date("2026-10-06T03:00:00Z"),
      now: () => new Date("2026-10-06T05:00:00Z"),
      maxPolls: 3,
      sleep: () => Promise.resolve(),
      collect: () => Promise.resolve(mergeTimeline(poll++ === 0 ? [commit] : [commit, settlement])),
      emit: (item) => emitted.push(item.id)
    });
    expect(emitted).toEqual(["git:commit"]);
  });

  it("caps the backlog on the first poll", async () => {
    const store = [1, 2, 3, 4].map((n) => event({ id: `e${n}`, time: `2026-10-06T0${n}:00:00Z` }));
    const emitted: string[] = [];
    await followTimeline({ since: new Date("2026-10-06T00:00:00Z"), now: () => new Date("2026-10-06T05:00:00Z"), backlogLimit: 2, maxPolls: 1, collect: () => Promise.resolve(store), emit: (item) => emitted.push(item.id) });
    expect(emitted).toEqual(["e3", "e4"]);
  });
});

describe("point-in-time read model", () => {
  it("rebuilds active Sessions, worktrees, pointer, production state and the kind-of-work lens as of a past time", () => {
    const claude = actorFromEmail("claudia.mason@agents.arcadia.local")?.actor;
    const events = [
      event({ id: "p1", source: "production", kind: "production.policy.activate", workKind: "operate", time: "2026-10-06T01:00:00Z" }),
      event({ id: "s1", source: "sessions", kind: "session.started", time: "2026-10-06T01:10:00Z", subjects: { project: "demo", session: "s1", action: "a1" }, actor: claude }),
      event({ id: "c1", time: "2026-10-06T01:20:00Z", subjects: { project: "demo", worktree: "/h/.claude/worktrees/a1/r", branch: "claude/a1-20261006T011000000Z", action: "a1" }, actor: claude }),
      event({ id: "q1", source: "queue", kind: "queue.pointer_moved", workKind: "govern", time: "2026-10-06T01:25:00Z", subjects: { project: "demo", action: "a1" } }),
      event({ id: "s1-end", source: "sessions", kind: "session.ended", time: "2026-10-06T02:00:00Z", subjects: { project: "demo", session: "s1" } }),
      event({ id: "p2", source: "production", kind: "production.policy.deactivate", workKind: "operate", time: "2026-10-06T02:05:00Z" }),
      event({ id: "late", time: "2026-10-06T09:00:00Z", subjects: { project: "demo" }, attention: true })
    ];
    const view = buildPointInTimeView(events, new Date("2026-10-06T01:30:00Z"), new Date("2026-10-06T00:00:00Z"));
    expect(view.production).toEqual({ state: "active", since: "2026-10-06T01:00:00.000Z" });
    expect(view.activeSessions).toEqual([expect.objectContaining({ session: "s1", tool: "claude-code", name: "Claudia Mason" })]);
    expect(view.activeWorktrees).toEqual([expect.objectContaining({ action: "a1", tool: "claude-code", lastWorkKind: "implement" })]);
    expect(view.projects[0]).toMatchObject({ project: "demo", pointer: { action: "a1" } });
    expect(view.lens).toContainEqual({ tool: "claude-code", workKind: "implement", events: 2 });
    expect(view.attention).toEqual([]);
    // "Git ran here" alone never makes a worktree active or counts as work.
    const touchedOnly = buildPointInTimeView(
      [event({ id: "t1", kind: "git.worktree.touched", workKind: "observe", time: "2026-10-06T01:20:00Z", subjects: { project: "demo", worktree: "/h/.codex/worktrees/b/r" } })],
      new Date("2026-10-06T01:30:00Z"),
      new Date("2026-10-06T00:00:00Z")
    );
    expect(touchedOnly.activeWorktrees).toEqual([]);
    expect(touchedOnly.lens).toEqual([]);
    // An opened question needs the operator until it is decided.
    const opened = event({ id: "r-open", source: "decisions", kind: "decision.review_item.opened", workKind: "govern", time: "2026-10-06T01:00:00Z", subjects: { decision: "R1" }, attention: true });
    const decided = event({ id: "r-done", source: "decisions", kind: "decision.review_item.decided", workKind: "govern", time: "2026-10-06T02:00:00Z", subjects: { decision: "R1" } });
    expect(buildPointInTimeView([opened, decided], new Date("2026-10-06T01:30:00Z"), new Date("2026-10-06T00:00:00Z")).attention.map((item) => item.id)).toEqual(["r-open"]);
    expect(buildPointInTimeView([opened, decided], new Date("2026-10-06T02:30:00Z"), new Date("2026-10-06T00:00:00Z")).attention).toEqual([]);
    const later = buildPointInTimeView(events, new Date("2026-10-06T03:00:00Z"), new Date("2026-10-06T00:00:00Z"));
    expect(later.activeSessions).toEqual([]);
    expect(later.production.state).toBe("off");
  });
});
