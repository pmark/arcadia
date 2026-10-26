import { describe, expect, it } from "vitest";
import { JOURNEY_FIXTURE } from "./journey-fixture";
import { SKIES, readSky } from "./system-sky";
import type { FeedItem } from "./workspace-feed";

const item = (over: Partial<FeedItem>): FeedItem => ({ key: Math.random().toString(36), kind: "todo", section: "Waiting on you", title: "t", detail: null, chip: "", href: null, external: false, at: null, urgent: false, ...over });
const quiet = { problems: [], loading: false };

describe("system sky", () => {
  it("is clear when nothing is moving or waiting", () => {
    expect(readSky({ ...quiet, items: [] })).toMatchObject({ id: "clear", reasons: [] });
  });

  it("names work moving without the operator as active", () => {
    const sky = readSky({ ...quiet, items: [item({ kind: "pr", section: "Pull requests" }), item({ kind: "action", section: "Waiting on others" })] });
    expect(sky).toMatchObject({ id: "active", reasons: ["1 step waiting on others", "1 pull request open"] });
  });

  it("asks for attention when something waits on the operator or a PR is failing", () => {
    expect(readSky({ ...quiet, items: [item({ kind: "action", section: "Your move", urgent: true })] }).id).toBe("attention");
    expect(readSky({ ...quiet, items: [item({ kind: "pr", section: "Pull requests", urgent: true })] })).toMatchObject({ id: "attention", reasons: ["1 pull request failing or blocked"] });
  });

  it("storms for a blocking item or a blocked mission, worst cause first", () => {
    const sky = readSky({ ...quiet, items: [item({}), item({ urgent: true }), item({ urgent: true })] });
    expect(sky).toMatchObject({ id: "storm", label: "Blocked", weather: "Dust storm" });
    expect(sky.reasons).toEqual(["2 blocking items for you", "1 item waiting on you"]);
    expect(readSky({ ...quiet, items: [], missions: JOURNEY_FIXTURE })).toMatchObject({ id: "storm", reasons: ["1 mission blocked", "2 missions moving"] });
  });

  it("goes static when a source could not be read, unless something is already blocking", () => {
    expect(readSky({ items: [item({})], problems: ["pull requests"], loading: false })).toMatchObject({ id: "static", reasons: ["could not read pull requests", "1 item waiting on you"] });
    expect(readSky({ items: [item({ urgent: true })], problems: ["pull requests"], loading: false }).id).toBe("storm");
  });

  it("stays clear while the first read is in flight", () => {
    expect(readSky({ items: [], problems: [], loading: true })).toMatchObject({ id: "clear", label: "Reading" });
  });

  it("draws every sky differently", () => {
    expect(new Set(Object.values(SKIES).map(s => JSON.stringify(s.draw))).size).toBe(Object.keys(SKIES).length);
  });
});
