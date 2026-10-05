import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePingChannels } from "../apps/discord-bot/src/config.js";
import { drainOperatorPings, operatorPingMessage, resolvePingChannel } from "../apps/discord-bot/src/notifications/operatorPings.js";
import {
  runPingPendingCommand,
  runPingSendCommand,
  runPingSentCommand
} from "../src/commands/ping.js";
import { openDatabase } from "../src/db/connection.js";
import {
  OPERATOR_PING_HOURLY_CAP,
  OPERATOR_PING_MESSAGE_MAX,
  queueOperatorPing
} from "../src/ping/operatorPing.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-ping-"));
  roots.push(root);
  const workspacePath = path.join(root, "workspace");
  initWorkspace(workspacePath);
  return workspacePath;
}

const ACTIONS_ID = "123456789012345678";
const DEFAULT_ID = "999999999999999999";
const config = { discordChannelId: DEFAULT_ID, pingChannels: { actions: ACTIONS_ID } };

describe("operator ping outbox", () => {
  it("queues a ping with defaults, then lists it as pending", () => {
    const ws = workspace();
    const sent = runPingSendCommand({ workspace: ws, message: "  Added a Retry   button  to Actions ", link: "https://example.com/actions" });
    expect(sent.data.deduplicated).toBe(false);
    expect(sent.data.ping).toMatchObject({
      message: "Added a Retry button to Actions", kind: "fyi", channel: null, status: "pending",
      link: "https://example.com/actions"
    });
    expect(runPingPendingCommand({ workspace: ws }).data.pings.map((ping) => ping.id)).toEqual([sent.data.ping.id]);
  });

  it("refuses an empty, oversized, or malformed ping before anything is queued", () => {
    const ws = workspace();
    expect(() => runPingSendCommand({ workspace: ws, message: "   " })).toThrow(/needs a message/);
    expect(() => runPingSendCommand({ workspace: ws, message: "x".repeat(OPERATOR_PING_MESSAGE_MAX + 1) })).toThrow(/at most/);
    expect(() => runPingSendCommand({ workspace: ws, message: "hi", kind: "urgent" })).toThrow(/--kind/);
    expect(() => runPingSendCommand({ workspace: ws, message: "hi", link: "javascript:alert(1)" })).toThrow(/http\(s\)/);
    expect(() => runPingSendCommand({ workspace: ws, message: "hi", link: "not a url" })).toThrow(/http\(s\)/);
    expect(() => runPingSendCommand({ workspace: ws, message: "hi", channel: "Bad Channel!" })).toThrow(/--channel/);
    expect(runPingPendingCommand({ workspace: ws }).data.pings).toEqual([]);
  });

  it("treats the same message to the same channel inside the window as one ping", () => {
    const ws = workspace();
    const first = runPingSendCommand({ workspace: ws, message: "Look at /actions", channel: "actions" });
    const again = runPingSendCommand({ workspace: ws, message: "Look at /actions", channel: "actions" });
    const elsewhere = runPingSendCommand({ workspace: ws, message: "Look at /actions" });
    expect(again.data).toMatchObject({ deduplicated: true, ping: { id: first.data.ping.id } });
    expect(elsewhere.data.deduplicated).toBe(false);
    expect(runPingPendingCommand({ workspace: ws }).data.pings).toHaveLength(2);
  });

  it("queues the same message again once the dedup window has passed", () => {
    const db = openDatabase(workspace());
    try {
      const start = new Date("2026-10-05T12:00:00Z");
      const first = queueOperatorPing(db, { message: "still broken", now: start });
      const later = queueOperatorPing(db, { message: "still broken", now: new Date(start.getTime() + 11 * 60 * 1000) });
      expect(later.deduplicated).toBe(false);
      expect(later.ping.id).not.toBe(first.ping.id);
    } finally {
      db.close();
    }
  });

  it("caps a looping agent at the hourly limit", () => {
    const db = openDatabase(workspace());
    try {
      const now = new Date("2026-10-05T12:00:00Z");
      for (let index = 0; index < OPERATOR_PING_HOURLY_CAP; index += 1) queueOperatorPing(db, { message: `ping ${index}`, now });
      expect(() => queueOperatorPing(db, { message: "one more", now })).toThrow(/already queued in the last hour/);
      const nextHour = new Date(now.getTime() + 61 * 60 * 1000);
      expect(queueOperatorPing(db, { message: "one more", now: nextHour }).deduplicated).toBe(false);
    } finally {
      db.close();
    }
  });

  it("records delivery once, idempotently, and refuses conflicting evidence", () => {
    const ws = workspace();
    const { ping } = runPingSendCommand({ workspace: ws, message: "delivery proof" }).data;
    runPingSentCommand({ workspace: ws, id: ping.id, messageId: "m-1" });
    runPingSentCommand({ workspace: ws, id: ping.id, messageId: "m-1" });
    expect(() => runPingSentCommand({ workspace: ws, id: ping.id, messageId: "m-2" })).toThrow(/different evidence/);
    expect(() => runPingSentCommand({ workspace: ws, id: "ping_missing", messageId: "m-1" })).toThrow(/not found/);
    expect(runPingPendingCommand({ workspace: ws }).data.pings).toEqual([]);
  });
});

describe("operator ping delivery", () => {
  it("parses DISCORD_PING_CHANNELS and rejects malformed entries", () => {
    expect(parsePingChannels(undefined)).toEqual({});
    expect(parsePingChannels(` actions=${ACTIONS_ID}, review-queue=${DEFAULT_ID} `)).toEqual({ actions: ACTIONS_ID, "review-queue": DEFAULT_ID });
    expect(() => parsePingChannels("actions")).toThrow(/alias=<channel id>/);
    expect(() => parsePingChannels("Actions=123")).toThrow(/alias=<channel id>/);
  });

  it("routes only to configured channels and falls back to the default for anything else", () => {
    expect(resolvePingChannel(null, config)).toEqual({ channelId: DEFAULT_ID, unconfigured: null });
    expect(resolvePingChannel("actions", config)).toEqual({ channelId: ACTIONS_ID, unconfigured: null });
    expect(resolvePingChannel(ACTIONS_ID, config)).toEqual({ channelId: ACTIONS_ID, unconfigured: null });
    // An id that is not in the operator's list must not become a route.
    expect(resolvePingChannel("111111111111111111", config)).toEqual({ channelId: DEFAULT_ID, unconfigured: "111111111111111111" });
    expect(resolvePingChannel("typo", config)).toEqual({ channelId: DEFAULT_ID, unconfigured: "typo" });
  });

  it("formats a short read-only message and says when a channel was not configured", () => {
    const ping = { id: "p", message: "New Retry button on Actions", kind: "look" as const, channel: "actions", link: "http://localhost:3020/actions", agent: "Claudia Mason", createdAt: "2026-10-05T12:00:00Z" };
    const text = operatorPingMessage(ping);
    expect(text).toContain("👀 Take a look — Claudia Mason");
    expect(text).toContain("New Retry button on Actions");
    expect(text).toContain("http://localhost:3020/actions");
    expect(text).toContain("nothing to approve or answer");
    expect(operatorPingMessage(ping, "typo")).toContain('Channel "typo" is not configured');
  });

  function fakeCli(pings: Array<{ id: string; channel: string | null }>) {
    const recorded: Array<[string, string]> = [];
    return {
      recorded,
      cli: {
        operatorPings: async () => ({ data: { pings: pings.map((ping) => ({
          id: ping.id, message: `msg ${ping.id}`, kind: "fyi" as const, channel: ping.channel, link: null, agent: null, createdAt: "2026-10-05T12:00:00Z"
        })) } }),
        operatorPingSent: async (id: string, messageId: string) => { recorded.push([id, messageId]); return { data: { pingId: id, messageId } }; }
      } as never
    };
  }

  it("delivers each ping to its channel and records it only after Discord accepts it", async () => {
    const { cli, recorded } = fakeCli([{ id: "a", channel: "actions" }, { id: "b", channel: null }]);
    const posts: string[] = [];
    const delivered = await drainOperatorPings(cli, config, async (channelId) => { posts.push(channelId); return { id: `d-${posts.length}` }; }, () => {});
    expect(delivered).toBe(2);
    expect(posts).toEqual([ACTIONS_ID, DEFAULT_ID]);
    expect(recorded).toEqual([["a", "d-1"], ["b", "d-2"]]);
  });

  it("retries an unsendable named channel once in the default channel", async () => {
    const { cli, recorded } = fakeCli([{ id: "a", channel: "actions" }]);
    const posts: Array<[string, string]> = [];
    const delivered = await drainOperatorPings(cli, config, async (channelId, content) => {
      posts.push([channelId, content]);
      if (channelId === ACTIONS_ID) throw new Error("Missing Access");
      return { id: "fallback-1" };
    }, () => {});
    expect(delivered).toBe(1);
    expect(posts.map(([channelId]) => channelId)).toEqual([ACTIONS_ID, DEFAULT_ID]);
    expect(posts[1][1]).toContain('Channel "actions" is not configured');
    expect(recorded).toEqual([["a", "fallback-1"]]);
  });

  it("leaves pings queued and stops the batch when the default channel fails", async () => {
    const { cli, recorded } = fakeCli([{ id: "a", channel: null }, { id: "b", channel: null }]);
    const delivered = await drainOperatorPings(cli, config, async () => { throw new Error("rate limited"); }, () => {});
    expect(delivered).toBe(0);
    expect(recorded).toEqual([]);
  });
});
