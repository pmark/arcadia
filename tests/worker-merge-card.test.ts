import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBatchMergeCard, type BatchPrFacts } from "../src/decisions/batchMerge.js";
import { ensureWorkerMergeTable, operatorMergeQueue } from "../src/production/workerMerge.js";

const NOW = new Date("2026-10-17T12:00:00Z");
const EXPIRES = "2026-10-18T12:00:00Z";
const sha = (c: string) => c.repeat(40);
const URL7 = "https://github.com/pmark/arcadia/pull/7";

function facts(number: number, head: string): BatchPrFacts {
  return {
    number, title: `PR ${number}`, headSha: head, baseRef: "main", headRef: `b-${number}`, files: [`src/f${number}.ts`], changedFiles: 1,
    why: "Needs the operator.", decisions: [], reviews: [{ verdict: "APPROVED", headSha: head }],
    checks: [{ name: "ci", conclusion: "SUCCESS" }], requiredChecks: ["ci"]
  };
}

describe("the batch-merge card lists the worker's authority-adjacent queue", () => {
  let db: Database.Database;
  let n = 0;
  beforeEach(() => { db = new Database(":memory:"); ensureWorkerMergeTable(db); n = 0; });

  function record(action: string, url: string, head: string, outcome: "merged" | "refused", updated: string): void {
    db.prepare(`INSERT INTO production_worker_merges (request_id, session_id, action_key, pull_request_url, head, outcome, code, reason, boundaries_json, updated_at)
      VALUES (?, 's', ?, ?, ?, ?, ?, ?, ?, ?)`).run(`r${n++}`, action, url, head, outcome,
      outcome === "refused" ? "authority_adjacent" : null, outcome === "refused" ? "touches src/production/policy.ts" : "Merged.",
      outcome === "refused" ? '["production_policy"]' : "[]", updated);
  }
  const card = (queue = operatorMergeQueue(db)) => {
    const r = buildBatchMergeCard({ prs: [facts(4, sha("4"))], now: NOW, expires: EXPIRES, workerHeld: queue });
    if (!r.ok) throw new Error(r.refusal.code);
    return r;
  };

  it("shows a worker-held PR with its reason, exact head and link, and adds no merge authority", () => {
    record("p/act", URL7, sha("7"), "refused", "2026-10-17T10:00:00Z");
    const r = card();
    expect(r.held).toHaveLength(1);
    const ev = r.card.evidence.find((e) => e.url === URL7);
    expect(ev?.label).toContain("Held by worker");
    expect(ev?.label).toContain(sha("7").slice(0, 12));
    expect(ev?.label).toContain("src/production/policy.ts");
    expect(r.card.what).toMatch(/worker also holds 1 authority-adjacent/);
    expect(r.spec.prs.map((p) => p.number)).toEqual([4]);
    expect(r.card.options.map((o) => o.id)).toEqual(["merge-batch", "hold"]);
  });

  it("drops a PR once a later record shows it merged", () => {
    record("p/act", URL7, sha("7"), "refused", "2026-10-17T10:00:00Z");
    record("p/act", URL7, sha("7"), "merged", "2026-10-17T11:00:00Z");
    const r = card();
    expect(r.held).toEqual([]);
    expect(r.card.evidence).toHaveLength(1);
  });

  it("leaves the card unchanged for an empty queue", () => {
    const base = buildBatchMergeCard({ prs: [facts(4, sha("4"))], now: NOW, expires: EXPIRES });
    expect(card([])).toEqual({ ...base, held: [] });
  });

  it("merges the reason into a row for the same PR at the same head instead of listing it twice", () => {
    record("p/act", "https://github.com/pmark/arcadia/pull/4", sha("4"), "refused", "2026-10-17T10:00:00Z");
    const r = card();
    expect(r.held).toEqual([]);
    expect(r.items[0].why).toMatch(/authority_adjacent/);
  });
});
