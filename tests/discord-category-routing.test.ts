import { describe, expect, it } from "vitest";
import type { AgentAskNotificationItem } from "../apps/discord-bot/src/arcadia/types.js";
import { parseCategoryChannels } from "../apps/discord-bot/src/config.js";
import {
  categorizeNotification,
  fetchCategoryChannel,
  resolveCategoryChannel,
  sendToCategory,
  type CategorizationContext
} from "../apps/discord-bot/src/notifications/categories.js";

const DEFAULT_ID = "999999999999999999";
const ALERTS_ID = "111111111111111111";
const BRIEFINGS_ID = "222222222222222222";
const LOG_ID = "333333333333333333";
const config = {
  discordChannelId: DEFAULT_ID,
  categoryChannels: { alerts: ALERTS_ID, briefings: BRIEFINGS_ID, log: LOG_ID }
};

function settlement(id: string, overrides: Partial<AgentAskNotificationItem>): AgentAskNotificationItem {
  return {
    settlementId: id, projectSlug: "arcadia", disposition: "accepted", intent: "log", effects: [],
    queueActionKey: null, queueActionKeys: [], queuePosition: null, nextActionKey: null,
    createdAt: "2026-10-06T00:00:00.000Z", ...overrides
  };
}

const context: CategorizationContext = {
  agentAskNotifications: [
    settlement("red", { desiredResult: "RED ALERT (stalled) on arcadia/x: no heartbeat", requestId: "red-alert-1" }),
    settlement("ci", { requestId: "ci-blocked-arcadia-pr9-2026-10-06", desiredResult: "required check failing" }),
    settlement("recover", { recovery: { documentsCommitted: false, operationalSync: "pending", reason: "x", remedy: "y" } }),
    settlement("decision", { intent: "decision", requestId: "decide-something" }),
    settlement("ready", { requestId: "pr-ready-arcadia-pr9-decision-answer-2026-10-06" }),
    settlement("opened", { requestId: "pr-opened-arcadia-pr9" }),
    settlement("complete", { intent: "complete", requestId: "complete-x" }),
    settlement("plain", { requestId: "ask-1" }),
    settlement("rejected", { disposition: "rejected", requestId: "ask-rejected" }),
    settlement("decision-recover", { intent: "decision", requestId: "d2", recovery: { documentsCommitted: false, operationalSync: "pending", reason: "x", remedy: "y" } }),
    settlement("red-ready", { requestId: "pr-ready-x", desiredResult: "RED ALERT (stalled) on arcadia/x: stuck" })
  ],
  runs: [
    { id: "r-failed", status: "failed" },
    { id: "r-review", status: "requires_review" },
    { id: "r-done", status: "completed" }
  ]
};

describe("categorizeNotification", () => {
  it.each([
    ["agent-ask:red", "alerts"],
    ["agent-ask:ci", "alerts"],
    ["agent-ask:recover", "alerts"],
    ["agent-ask:decision", null],
    ["agent-ask:ready", null],
    ["agent-ask:opened", "log"],
    ["agent-ask:complete", "log"],
    ["agent-ask:plain", "log"],
    ["agent-ask:rejected", "log"],
    ["agent-ask:decision-recover", null],
    ["agent-ask:red-ready", "alerts"],
    ["agent-ask:not-in-the-snapshot", null],
    ["requires-review:abc", null],
    ["requires-review:transition", null],
    ["blocked:w1", "alerts"],
    ["artifact:a1", "log"],
    ["milestone:m1", "log"],
    ["run:r-failed", "alerts"],
    ["run:r-review", null],
    ["run:r-done", "log"],
    ["run:r-unknown", null],
    ["codex:t1:failed", "alerts"],
    ["codex:t1:requires_review", null],
    ["codex:t1:completed", "log"],
    ["codex:t1:started", "log"],
    ["something-new:1", null]
  ] as const)("%s -> %s", (key, expected) => {
    expect(categorizeNotification(key, context)).toBe(expected);
  });

  it("keeps everything that needs the operator in the default channel", () => {
    for (const key of ["agent-ask:decision", "agent-ask:ready", "requires-review:abc", "run:r-review", "codex:t1:requires_review"]) {
      expect(resolveCategoryChannel(categorizeNotification(key, context), config)).toBe(DEFAULT_ID);
    }
  });
});

describe("DISCORD_CATEGORY_CHANNELS", () => {
  it("parses categories and leaves unset ones to the default channel", () => {
    expect(parseCategoryChannels(undefined)).toEqual({});
    expect(parseCategoryChannels(` alerts=${ALERTS_ID}, log=${LOG_ID} `)).toEqual({ alerts: ALERTS_ID, log: LOG_ID });
    expect(resolveCategoryChannel("briefings", { discordChannelId: DEFAULT_ID, categoryChannels: { alerts: ALERTS_ID } })).toBe(DEFAULT_ID);
    expect(resolveCategoryChannel(null, config)).toBe(DEFAULT_ID);
  });

  it("refuses an unknown category or a malformed id rather than misrouting", () => {
    expect(() => parseCategoryChannels(`alert=${ALERTS_ID}`)).toThrow(/DISCORD_CATEGORY_CHANNELS/);
    expect(() => parseCategoryChannels("alerts=123")).toThrow(/DISCORD_CATEGORY_CHANNELS/);
    expect(() => parseCategoryChannels("alerts")).toThrow(/DISCORD_CATEGORY_CHANNELS/);
    expect(() => parseCategoryChannels(`alerts=${ALERTS_ID}=${LOG_ID}`)).toThrow(/DISCORD_CATEGORY_CHANNELS/);
  });
});

describe("sendToCategory", () => {
  const quiet = () => {};

  it("posts to the category channel, and to the default channel for an uncategorized message", async () => {
    const posted: string[] = [];
    const send = async (channelId: string) => { posted.push(channelId); return { id: `m${posted.length}` }; };
    await sendToCategory(send, config, "alerts", "x", quiet);
    await sendToCategory(send, config, "log", "x", quiet);
    await sendToCategory(send, config, null, "x", quiet);
    expect(posted).toEqual([ALERTS_ID, LOG_ID, DEFAULT_ID]);
  });

  it("falls back to the default channel, with a note and a warning, when the category channel is unsendable", async () => {
    const posted: Array<[string, string]> = [];
    const logs: Array<[string, Record<string, unknown>]> = [];
    const send = async (channelId: string, content: string) => {
      if (channelId === ALERTS_ID) throw new Error("Missing Access");
      posted.push([channelId, content]);
      return { id: "fallback" };
    };
    const sent = await sendToCategory(send, config, "alerts", "RED ALERT body", (level, obj) => logs.push([level, obj]));
    expect(sent.id).toBe("fallback");
    expect(posted).toHaveLength(1);
    expect(posted[0][0]).toBe(DEFAULT_ID);
    expect(posted[0][1]).toContain("RED ALERT body");
    expect(posted[0][1]).toContain('Routed from "alerts"');
    expect(logs[0][0]).toBe("warn");
  });

  it("propagates a default-channel failure so the notification is not marked delivered", async () => {
    const send = async () => { throw new Error("rate limited"); };
    await expect(sendToCategory(send, config, "alerts", "x", quiet)).rejects.toThrow("rate limited");
    await expect(sendToCategory(send, config, null, "x", quiet)).rejects.toThrow("rate limited");
  });

  it("does not retry the default channel twice when a category is configured to the default", async () => {
    let calls = 0;
    const send = async () => { calls += 1; throw new Error("nope"); };
    const sameAsDefault = { discordChannelId: DEFAULT_ID, categoryChannels: { log: DEFAULT_ID } };
    await expect(sendToCategory(send, sameAsDefault, "log", "x", quiet)).rejects.toThrow("nope");
    expect(calls).toBe(1);
  });
});

describe("fetchCategoryChannel", () => {
  const sendable = (id: string) => ({ id, send: async () => ({ id: "m" }) });
  const clientFor = (channels: Record<string, unknown>) => ({
    channels: { fetch: async (id: string) => { const value = channels[id]; if (value instanceof Error) throw value; return value ?? null; } }
  }) as never;
  const quiet = () => {};

  it("uses the briefings channel when it is sendable", async () => {
    const channel = await fetchCategoryChannel(clientFor({ [BRIEFINGS_ID]: sendable(BRIEFINGS_ID), [DEFAULT_ID]: sendable(DEFAULT_ID) }), config, "briefings", quiet);
    expect(channel?.id).toBe(BRIEFINGS_ID);
  });

  it("falls back to the default channel when the briefings channel is missing or errors", async () => {
    const missing = await fetchCategoryChannel(clientFor({ [DEFAULT_ID]: sendable(DEFAULT_ID) }), config, "briefings", quiet);
    expect(missing?.id).toBe(DEFAULT_ID);
    const errored = await fetchCategoryChannel(clientFor({ [BRIEFINGS_ID]: new Error("Unknown Channel"), [DEFAULT_ID]: sendable(DEFAULT_ID) }), config, "briefings", quiet);
    expect(errored?.id).toBe(DEFAULT_ID);
  });

  it("falls back to the default channel when the briefings channel fetches fine but rejects the send", async () => {
    const posted: Array<[string, string]> = [];
    const denied = { id: BRIEFINGS_ID, send: async () => { throw new Error("Missing Permissions"); } };
    const defaultChannel = { id: DEFAULT_ID, send: async (payload: { content: string }) => { posted.push([DEFAULT_ID, payload.content]); return { id: "d1" }; } };
    const logs: string[] = [];
    const channel = await fetchCategoryChannel(clientFor({ [BRIEFINGS_ID]: denied, [DEFAULT_ID]: defaultChannel }), config, "briefings", (level) => logs.push(level));
    const sent = await channel!.send({ content: "daily packet" });
    expect(sent.id).toBe("d1");
    expect(posted[0][1]).toContain("daily packet");
    expect(posted[0][1]).toContain('Routed from "briefings"');
    expect(logs).toEqual(["warn"]);
  });

  it("throws, so the post is retried next tick, when both channels reject the send", async () => {
    const denied = (id: string) => ({ id, send: async () => { throw new Error("Missing Permissions"); } });
    const channel = await fetchCategoryChannel(clientFor({ [BRIEFINGS_ID]: denied(BRIEFINGS_ID), [DEFAULT_ID]: denied(DEFAULT_ID) }), config, "briefings", () => {});
    await expect(channel!.send({ content: "x" })).rejects.toThrow("Missing Permissions");
  });

  it("returns null only when no sendable channel exists", async () => {
    expect(await fetchCategoryChannel(clientFor({}), config, "briefings", quiet)).toBeNull();
  });

  it("uses the default channel directly when no briefings channel is configured", async () => {
    const channel = await fetchCategoryChannel(clientFor({ [DEFAULT_ID]: sendable(DEFAULT_ID) }), { discordChannelId: DEFAULT_ID, categoryChannels: {} }, "briefings", quiet);
    expect(channel?.id).toBe(DEFAULT_ID);
  });
});
