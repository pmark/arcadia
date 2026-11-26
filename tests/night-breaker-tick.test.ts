import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { withDatabase } from "../src/db/connection.js";
import {
  BREAKER_CLAUDE_FIVE_HOUR_PERCENT,
  BREAKER_FIRST_DAY_MERGE_LIMIT,
  BREAKER_LANE_INPUT_TOKEN_CEILING,
  BREAKER_LATER_MERGE_LIMIT,
  BREAKER_PARK_LIMIT,
  BREAKER_WINDOW_MS,
  HOUR_MS
} from "../src/production/parkAndContinue.js";
import { listProductionParks, NIGHT_BREAKER_REQUEST_PREFIX, recordProductionPark } from "../src/production/nightBreaker.js";
import { activateProduction, fingerprintProductionScope, normalizeProductionScope, readProductionPolicy } from "../src/production/policy.js";
import { runManagedProductionTick } from "../src/production/tick.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * Plan one-stop-never-ends-the-card-20261126, Action wire-night-breaker-into-tick (#3047): the production tick evaluates
 * the night breaker (src/production/parkAndContinue.ts) on every pass and, when it trips, turns production Off once with a
 * receipt and queues one attention ping naming the trip kind.
 */

const NOW = new Date("2026-11-26T09:00:00.000Z");
const adapters = defaultAdapters as ProviderAdapterRegistry;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-night-breaker-"));
  roots.push(root);
  const target = path.join(root, "workspace");
  initWorkspace(target);
  return target;
}

const scope = normalizeProductionScope({
  intent: "Night breaker fixture.",
  projects: ["arcadia"],
  plans: ["arcadia/one-stop-never-ends-the-card-20261126"],
  actions: ["arcadia/a", "arcadia/b", "arcadia/c", "arcadia/d"],
  providers: ["claude-code-cli"],
  maxConcurrentSessions: 1,
  mechanicalTransitions: ["acceptance", "pointer"]
});

function activate(db: Database.Database, requestId: string, at: Date = new Date(NOW.getTime() - 2 * HOUR_MS)): void {
  activateProduction(db, { requestId, scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator", now: at });
}

function park(db: Database.Database, actionKey: string, cause: string, ageMs: number, hold?: "sign-in" | "capacity" | "outage") {
  return recordProductionPark(db, {
    actionKey, condition: "C4", cause, project: "arcadia", lane: "autonomous", now: NOW.getTime() - ageMs, head: "abc123", ...(hold ? { hold } : {})
  });
}

function tick(db: Database.Database, workspacePath: string, now: Date = NOW) {
  return runManagedProductionTick(db, workspacePath, { profiles: [], adapters, now });
}

function offReceipts(db: Database.Database): Array<{ request_id: string; receipt_json: string }> {
  return db.prepare("SELECT request_id, receipt_json FROM production_policy_receipts WHERE transition = 'deactivate' ORDER BY created_at")
    .all() as Array<{ request_id: string; receipt_json: string }>;
}

function attentionPings(db: Database.Database): Array<{ message: string; kind: string; agent: string }> {
  return db.prepare("SELECT message, kind, agent FROM operator_pings WHERE kind = 'attention' ORDER BY created_at")
    .all() as Array<{ message: string; kind: string; agent: string }>;
}

describe("the production tick's night breaker", () => {
  it("keeps every breaker limit unchanged", () => {
    expect(BREAKER_PARK_LIMIT).toBe(3);
    expect([BREAKER_FIRST_DAY_MERGE_LIMIT, BREAKER_LATER_MERGE_LIMIT]).toEqual([3, 6]);
    expect(BREAKER_LANE_INPUT_TOKEN_CEILING).toBe(40_000_000);
    expect(BREAKER_CLAUDE_FIVE_HOUR_PERCENT).toBe(70);
    expect(BREAKER_WINDOW_MS).toBe(24 * HOUR_MS);
  });

  it("turns production Off with exactly one receipt and one attention ping naming parks at three parks in 24 hours", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      activate(db, "grant-1");
      park(db, "arcadia/a", "cause one", 20 * HOUR_MS);
      park(db, "arcadia/b", "cause two", 5 * HOUR_MS);
      park(db, "arcadia/c", "cause three", HOUR_MS);

      const first = tick(db, ws);
      expect(first.policyActive).toBe(false);
      expect(first.nightBreaker).toMatchObject({ tripped: true, trips: ["parks"] });
      expect(readProductionPolicy(db).desiredState).toBe("inactive");

      const offs = offReceipts(db);
      expect(offs).toHaveLength(1);
      expect(offs[0].request_id.startsWith(NIGHT_BREAKER_REQUEST_PREFIX)).toBe(true);
      expect(JSON.parse(offs[0].receipt_json).reason).toMatch(/night breaker tripped \(parks\)/i);

      const pings = attentionPings(db);
      expect(pings).toHaveLength(1);
      expect(pings[0].message).toMatch(/Night breaker tripped \(parks\)/);
      expect(pings[0].message).toContain("3 parks in 24 hours on arcadia/autonomous");
      expect(pings[0].agent).toBe("production-tick");

      // Later passes neither turn Off again nor page again.
      tick(db, ws, new Date(NOW.getTime() + 60_000));
      tick(db, ws, new Date(NOW.getTime() + 120_000));
      expect(offReceipts(db)).toHaveLength(1);
      expect(attentionPings(db)).toHaveLength(1);
    });
  });

  it("records neither an Off nor a ping with two parks, or with a third park older than 24 hours", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      activate(db, "grant-1");
      park(db, "arcadia/a", "cause one", 25 * HOUR_MS);
      park(db, "arcadia/b", "cause two", 5 * HOUR_MS);
      park(db, "arcadia/c", "cause three", HOUR_MS);

      const result = tick(db, ws);
      expect(result.policyActive).toBe(true);
      expect(result.nightBreaker).toMatchObject({ tripped: false });
      expect(readProductionPolicy(db).desiredState).toBe("active");
      expect(offReceipts(db)).toHaveLength(0);
      expect(attentionPings(db)).toHaveLength(0);
    });
  });

  it("turns production Off through findRepeatedCause when two parks share a cause", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      activate(db, "grant-1");
      park(db, "arcadia/a", "required-check lint failed", 3 * HOUR_MS);
      const second = park(db, "arcadia/b", "required-check lint failed", HOUR_MS);
      expect(second).toMatchObject({ kind: "park", stopProduction: true });

      const result = tick(db, ws);
      expect(result.policyActive).toBe(false);
      expect(result.nightBreaker).toMatchObject({ tripped: true, trips: ["same-cause"] });
      expect(offReceipts(db)).toHaveLength(1);
      const pings = attentionPings(db);
      expect(pings).toHaveLength(1);
      expect(pings[0].message).toMatch(/Night breaker tripped \(same-cause\)/);
      expect(pings[0].message).toContain("the same cause twice: required-check lint failed");
    });
  });

  it("never counts sign-in, capacity or outage holds as parks", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      activate(db, "grant-1");
      for (const hold of ["sign-in", "capacity", "outage"] as const) {
        expect(park(db, "arcadia/c", "provider unavailable", HOUR_MS, hold)).toMatchObject({ kind: "hold", hold });
        expect(park(db, "arcadia/d", "provider unavailable", HOUR_MS, hold)).toMatchObject({ kind: "hold", hold });
      }
      park(db, "arcadia/a", "cause one", 2 * HOUR_MS);
      park(db, "arcadia/b", "cause two", HOUR_MS);
      expect(listProductionParks(db, NOW.getTime()).map((p) => p.actionKey)).toEqual(["arcadia/a", "arcadia/b"]);

      const result = tick(db, ws);
      expect(result.policyActive).toBe(true);
      expect(result.nightBreaker).toMatchObject({ tripped: false });
      expect(offReceipts(db)).toHaveLength(0);
      expect(attentionPings(db)).toHaveLength(0);
    });
  });

  it("keeps the Off when the page cannot be queued, and queues that one page on a later pass while production is Off", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      activate(db, "grant-1");
      park(db, "arcadia/a", "cause one", 3 * HOUR_MS);
      park(db, "arcadia/b", "cause two", 2 * HOUR_MS);
      park(db, "arcadia/c", "cause three", HOUR_MS);
      // Fill the outbox's hourly cap so the page is refused this pass.
      for (let i = 0; i < 30; i += 1) {
        db.prepare("INSERT INTO operator_pings (id, message, kind, agent, status, created_at) VALUES (?, ?, 'fyi', 'filler', 'pending', ?)")
          .run(`ping_filler_${i}`, `filler ${i}`, new Date(NOW.getTime() - 60_000).toISOString());
      }
      const logs: string[] = [];
      runManagedProductionTick(db, ws, { profiles: [], adapters, now: NOW, log: (line) => logs.push(line) });
      expect(readProductionPolicy(db).desiredState).toBe("inactive");
      expect(offReceipts(db)).toHaveLength(1);
      expect(attentionPings(db)).toHaveLength(0);
      expect(logs.some((line) => line.includes("not queued yet"))).toBe(true);

      tick(db, ws, new Date(NOW.getTime() + 2 * HOUR_MS));
      tick(db, ws, new Date(NOW.getTime() + 3 * HOUR_MS));
      expect(offReceipts(db)).toHaveLength(1);
      const pings = attentionPings(db);
      expect(pings).toHaveLength(1);
      expect(pings[0].message).toMatch(/Night breaker tripped \(parks\)/);
    });
  });

  it("does not trip again on the parks a trip already answered once the operator grants again", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      activate(db, "grant-1");
      park(db, "arcadia/a", "cause one", 3 * HOUR_MS);
      park(db, "arcadia/b", "cause two", 2 * HOUR_MS);
      park(db, "arcadia/c", "cause three", HOUR_MS);
      tick(db, ws);
      expect(readProductionPolicy(db).desiredState).toBe("inactive");

      activate(db, "grant-2", new Date(NOW.getTime() + 60_000));
      const later = tick(db, ws, new Date(NOW.getTime() + 120_000));
      expect(later.policyActive).toBe(true);
      expect(offReceipts(db)).toHaveLength(1);
      expect(attentionPings(db)).toHaveLength(1);
    });
  });
});
