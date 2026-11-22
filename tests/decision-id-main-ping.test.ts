import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { checkMainDecisionIds, duplicateDecisionIdPing, findDecisionIdClashes } from "../src/decisions/decisionIds.js";
import { ensureOperatorPingTable, queueOperatorPing } from "../src/ping/operatorPing.js";

describe("duplicate Decision id ping on main", () => {
  const clean = ["docs/decisions/0300-a.md", "docs/decisions/0301-b.md", "docs/decisions/0004-x.md", "docs/decisions/0004-y.md"];

  it("sends nothing for a clean main, grandfathered pairs aside", () => {
    expect(duplicateDecisionIdPing(findDecisionIdClashes(clean))).toBeNull();
  });

  it("names both files in one message whose episode key is stable across reruns", () => {
    const files = [...clean, "docs/decisions/0302-first.md", "docs/decisions/0302-second.md"];
    const ping = duplicateDecisionIdPing(findDecisionIdClashes(files));
    expect(ping?.message).toContain("docs/decisions/0302-first.md");
    expect(ping?.message).toContain("docs/decisions/0302-second.md");
    expect(ping?.message.startsWith(ping?.episodeKey ?? "?")).toBe(true);
    expect(duplicateDecisionIdPing(findDecisionIdClashes([...files, "docs/decisions/0303-c.md"]))?.episodeKey).toBe(ping?.episodeKey);
  });

  describe("host-side check (checkMainDecisionIds)", () => {
    // A real ping outbox (the production queue and its episode dedupe), in memory.
    function outbox() {
      const db = new Database(":memory:");
      ensureOperatorPingTable(db);
      const send = (ping: { message: string; episodeKey: string }) => {
        const queued = queueOperatorPing(db, { message: ping.message, kind: "attention", agent: "Decision id check", episodeKey: ping.episodeKey });
        return { pingId: queued.ping.id, deduplicated: queued.deduplicated };
      };
      const count = () => (db.prepare("SELECT COUNT(*) AS n FROM operator_pings").get() as { n: number }).n;
      return { send, count };
    }
    const clashing = [...clean, "docs/decisions/0302-first.md", "docs/decisions/0302-second.md"];

    it("queues exactly one ping naming both files, and a rerun over the same pair queues nothing new (exit 1 both times)", () => {
      const o = outbox();
      const first = checkMainDecisionIds({ workspace: "/ws", files: clashing, send: o.send });
      expect(first.exitCode).toBe(1);
      expect(first.stderr).toContain("0302-first.md");
      expect(first.stderr).toContain("0302-second.md");
      expect(o.count()).toBe(1);
      const rerun = checkMainDecisionIds({ workspace: "/ws", files: clashing, send: o.send });
      expect(rerun.exitCode).toBe(1);
      expect(rerun.stderr).toContain("already queued");
      expect(o.count()).toBe(1);
    });

    it("exits 0 and queues nothing for a clean main", () => {
      const o = outbox();
      const result = checkMainDecisionIds({ workspace: "/ws", files: clean, send: o.send });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("unique");
      expect(o.count()).toBe(0);
    });

    it("fails closed with exit 2 and a message when no workspace is named, and sends nothing", () => {
      const o = outbox();
      for (const workspace of [undefined, "", "   "]) {
        const result = checkMainDecisionIds({ workspace, files: clashing, send: o.send });
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("ARCADIA_WORKSPACE");
      }
      expect(o.count()).toBe(0);
    });

    it("is loud, never clean, when origin main is unreadable or the ping cannot be queued", () => {
      const o = outbox();
      const unreadable = checkMainDecisionIds({ workspace: "/ws", files: null, send: o.send });
      expect(unreadable.exitCode).toBe(1);
      expect(unreadable.stderr).toContain("could not be read");
      const failing = checkMainDecisionIds({ workspace: "/ws", files: clashing, send: () => { throw new Error("outbox locked"); } });
      expect(failing.exitCode).toBe(1);
      expect(failing.stderr).toContain("outbox locked");
      expect(failing.stderr).toContain("0302-first.md");
      expect(o.count()).toBe(0);
    });

    it("pings again for a different clash set (a new episode), still naming its files", () => {
      const o = outbox();
      checkMainDecisionIds({ workspace: "/ws", files: clashing, send: o.send });
      const other = [...clean, "docs/decisions/0310-a.md", "docs/decisions/0310-b.md"];
      const result = checkMainDecisionIds({ workspace: "/ws", files: other, send: o.send });
      expect(result.stderr).toContain("0310-a.md");
      expect(o.count()).toBe(2);
    });
  });
});
