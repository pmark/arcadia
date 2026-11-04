import { describe, expect, it } from "vitest";
import { JOURNEY_FIXTURE } from "./journey-fixture";
import { SKIES, SKY_HOLD_MS, SKY_STALE_MS, readSky, settleSky, staleSources, type ProductionFacts, type SkyId, type SkyReading } from "./system-sky";
import type { FeedItem } from "./workspace-feed";

const item = (over: Partial<FeedItem>): FeedItem => ({ key: Math.random().toString(36), kind: "todo", section: "Waiting on you", title: "t", detail: null, chip: "", href: null, external: false, at: null, urgent: false, ...over });
const quiet = { problems: [], loading: false };

const off: ProductionFacts = { displayState: "inactive_idle", workerRunning: true, heartbeatFresh: true, liveSessions: 0, stalledSessions: 0 };
const facts = (over: Partial<ProductionFacts>): ProductionFacts => ({ ...off, ...over });
const on = facts({ displayState: "active_idle" });
const texts = (reasons: Array<{ text: string }>) => reasons.map(r => r.text);

describe("system sky", () => {
  it("says All clear only when production is On and nothing is moving or waiting", () => {
    expect(readSky({ ...quiet, items: [], production: on })).toMatchObject({ id: "clear", label: "All clear", production: "Production on, idle", reasons: [] });
  });

  it("never says All clear while production is Off or hasn't been read", () => {
    expect(readSky({ ...quiet, items: [], production: off })).toMatchObject({ id: "clear", label: "Nothing waiting", production: "Production Off" });
    expect(readSky({ ...quiet, items: [] })).toMatchObject({ id: "clear", label: "Nothing waiting", production: null });
  });

  it("moves the sky only for something running, and keeps open PRs and waits as reasons", () => {
    const waiting = [item({ kind: "pr", section: "Pull requests" }), item({ kind: "action", section: "Waiting on others" })];
    const sky = readSky({ ...quiet, items: waiting, production: off });
    expect(sky).toMatchObject({ id: "clear", label: "Nothing waiting" });
    expect(texts(sky.reasons)).toEqual(["1 step waiting on others", "1 pull request open"]);
    expect(readSky({ ...quiet, items: [], production: facts({ liveSessions: 1 }) }).id).toBe("active");
    expect(readSky({ ...quiet, items: [], production: facts({ displayState: "inactive_finishing" }) })).toMatchObject({ id: "active", production: "Production finishing" });
    expect(readSky({ ...quiet, items: [], production: facts({ displayState: "active_building" }) })).toMatchObject({ id: "active", production: "Production building" });
  });

  it("asks for attention when something waits on the operator or a PR is failing", () => {
    expect(readSky({ ...quiet, items: [item({ kind: "action", section: "Your move", urgent: true })] }).id).toBe("attention");
    const sky = readSky({ ...quiet, items: [item({ kind: "pr", section: "Pull requests", urgent: true })] });
    expect(sky.id).toBe("attention");
    expect(texts(sky.reasons)).toEqual(["1 pull request failing or blocked"]);
  });

  it("storms for a blocking item or a blocked mission, worst cause first", () => {
    const sky = readSky({ ...quiet, items: [item({}), item({ urgent: true }), item({ urgent: true })] });
    expect(sky).toMatchObject({ id: "storm", label: "Blocked", weather: "Dust storm" });
    expect(texts(sky.reasons)).toEqual(["2 blocking items for you", "1 item waiting on you"]);
    const fleet = readSky({ ...quiet, items: [], missions: JOURNEY_FIXTURE });
    expect(fleet.id).toBe("storm");
    expect(texts(fleet.reasons)).toEqual(["1 mission blocked", "2 missions moving"]);
  });

  it("storms for a stalled Session or a silent worker, which a heartbeat alone doesn't separate", () => {
    expect(readSky({ ...quiet, items: [], production: facts({ displayState: "active_building", liveSessions: 2, stalledSessions: 1 }) })).toMatchObject({ id: "storm", production: "1 Session stalled" });
    expect(readSky({ ...quiet, items: [], production: facts({ displayState: "active_building", heartbeatFresh: false }) })).toMatchObject({ id: "storm", production: "Worker not responding" });
    expect(readSky({ ...quiet, items: [], production: facts({ displayState: "inactive_finishing", workerRunning: false }) })).toMatchObject({ id: "storm", production: "Worker not responding" });
    // With production Off, a stopped worker is expected.
    expect(readSky({ ...quiet, items: [], production: facts({ workerRunning: false, heartbeatFresh: false }) })).toMatchObject({ id: "clear", production: "Production Off" });
  });

  it("goes static when a source could not be read or is too old, unless something is already blocking", () => {
    const sky = readSky({ items: [item({})], problems: ["pull requests"], loading: false });
    expect(sky.id).toBe("static");
    expect(texts(sky.reasons)).toEqual(["could not read pull requests", "1 item waiting on you"]);
    expect(readSky({ items: [item({ urgent: true })], problems: ["pull requests"], loading: false }).id).toBe("storm");
    expect(readSky({ ...quiet, items: [], stale: ["next steps"], production: off })).toMatchObject({ id: "static", label: "Signal loss" });
  });

  it("never calls an unreadable production store Off", () => {
    for (const production of [null, facts({ displayState: "observation_unavailable" }), facts({ displayState: null }), facts({ workerRunning: null }), facts({ liveSessions: null })]) {
      expect(readSky({ ...quiet, items: [], production })).toMatchObject({ id: "static", production: "Can't read production" });
    }
  });

  it("lets the worst cause win when production's rows combine", () => {
    expect(readSky({ ...quiet, items: [], production: facts({ displayState: "observation_unavailable", liveSessions: 1, stalledSessions: 1 }) }).id).toBe("storm");
    expect(readSky({ ...quiet, items: [item({})], production: facts({ displayState: "active_building" }) }).id).toBe("attention");
  });

  it("links reasons to where the operator can act", () => {
    const sky = readSky({ ...quiet, items: [item({ urgent: true })], production: facts({ displayState: "active_building", heartbeatFresh: false }) });
    expect(sky.reasons).toEqual([{ text: "1 blocking item for you", href: "/workspace/feed" }, { text: "The production worker isn't responding", href: "/production" }]);
  });

  it("makes no calm claim until every read has landed, though bad news can show", () => {
    expect(readSky({ items: [], problems: [], loading: true })).toMatchObject({ id: "reading", label: "Reading" });
    expect(SKIES.reading.draw).toEqual({});
    const partial = readSky({ items: [item({ kind: "pr", section: "Pull requests" })], problems: [], loading: true, production: off });
    expect(partial).toMatchObject({ id: "reading", production: "Production Off" });
    expect(texts(partial.reasons)).toEqual(["1 pull request open"]);
    expect(readSky({ items: [item({ urgent: true })], problems: [], loading: true }).id).toBe("storm");
  });

  it("draws every sky differently", () => {
    expect(new Set(Object.values(SKIES).map(s => JSON.stringify(s.draw))).size).toBe(Object.keys(SKIES).length);
  });
});

describe("settling the sky", () => {
  const at = (id: SkyId, label: string = id): SkyReading => ({ id, label, weather: "w", reasons: [], production: null });

  it("shows worse news at once", () => {
    const state = settleSky(settleSky(null, at("clear"), 0), at("storm"), 1);
    expect(state).toMatchObject({ shown: { id: "storm" }, pending: null });
  });

  it("makes better news hold before it shows", () => {
    let state = settleSky(null, at("storm"), 0);
    state = settleSky(state, at("clear"), 1_000);
    expect(state.shown.id).toBe("storm");
    state = settleSky(state, at("clear"), 1_000 + SKY_HOLD_MS - 1);
    expect(state.shown.id).toBe("storm");
    state = settleSky(state, at("clear"), 1_000 + SKY_HOLD_MS);
    expect(state).toMatchObject({ shown: { id: "clear" }, pending: null });
  });

  it("restarts the hold when the better news changes", () => {
    let state = settleSky(null, at("storm"), 0);
    state = settleSky(state, at("clear"), 1_000);
    state = settleSky(state, at("active"), SKY_HOLD_MS + 1_000);
    expect(state).toMatchObject({ shown: { id: "storm" }, pending: { id: "active", since: SKY_HOLD_MS + 1_000 } });
  });

  it("clears a pending change when the worse news returns", () => {
    let state = settleSky(null, at("storm"), 0);
    state = settleSky(state, at("clear"), 1_000);
    state = settleSky(state, at("storm", "new words"), 2_000);
    expect(state).toMatchObject({ shown: { id: "storm", label: "new words" }, pending: null });
  });

  it("leaves Reading as soon as the first read lands", () => {
    const state = settleSky(settleSky(null, at("reading"), 0), at("clear"), 1);
    expect(state.shown.id).toBe("clear");
  });
});

describe("stale sources", () => {
  it("names sources past the limit, and doesn't count hidden time against them", () => {
    const lastGood = { "next steps": 0, production: SKY_STALE_MS };
    expect(staleSources(lastGood, 0, SKY_STALE_MS + 1)).toEqual(["next steps"]);
    expect(staleSources(lastGood, SKY_STALE_MS, SKY_STALE_MS + 1)).toEqual([]);
  });
});
