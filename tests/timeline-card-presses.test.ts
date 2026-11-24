import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectorContext, TimelineRepository } from "../src/timeline/collectors/context.js";
import { collectOperatorScripts, OPERATOR_RUNS_DIR } from "../src/timeline/collectors/operatorScripts.js";

/**
 * Layout used (the main checkout's library is gitignored and unreadable from a
 * candidate worktree), as observed on 2026-11-22: runs/<card>/<run>/receipt.json
 * with mode run or preflight and a record object, beside one-level
 * runs/<entry>/receipt.json files.
 */

let root: string;
let repository: TimelineRepository;
let context: CollectorContext;

const now = new Date();
const at = (offsetSeconds: number) => new Date(now.getTime() + offsetSeconds * 1000).toISOString();

function write(relative: string, body: unknown): void {
  const file = path.join(root, OPERATOR_RUNS_DIR, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "timeline-card-presses-"));
  repository = { projectSlug: "demo", projectId: "proj_demo", path: root };
  context = { window: { since: new Date(now.getTime() - 3600_000), until: new Date(now.getTime() + 3600_000) }, maxPerSource: 100, now } as unknown as CollectorContext;
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("operator-script collector reads per-card START presses", () => {
  it("emits one event per mode-run press with card, run, outcome, plan and a low-confidence actor", () => {
    write("start-demo/20261124T010000Z-1/receipt.json", {
      schema: "arcadia-start-run-receipt-v1", id: "start-demo", runId: "20261124T010000Z-1", mode: "run", startedAt: at(-60), finishedAt: at(-50), outcome: "succeeded", record: { project: "demo", plan: "demo-plan" }
    });
    write("start-demo/20261124T010100Z-2/receipt.json", { schema: "arcadia-start-run-receipt-v1", id: "start-demo", runId: "20261124T010100Z-2", mode: "run", finishedAt: at(-40), outcome: "refused", record: {} });
    const events = collectOperatorScripts(repository, context);
    expect(events).toHaveLength(2);
    const first = events.find((event) => event.id.endsWith("20261124T010000Z-1"))!;
    expect(first).toMatchObject({ source: "operator-scripts", subjects: { project: "demo", plan: "demo-plan" }, attention: false });
    expect(first.summary).toContain("start-demo");
    expect(first.summary).toContain("succeeded");
    expect(first.evidence.map((item) => item.value)).toContain("20261124T010000Z-1");
    expect(first.actor.confidence).toBe("low");
    const refused = events.find((event) => event.id.endsWith("20261124T010100Z-2"))!;
    expect(refused.subjects).not.toHaveProperty("plan");
    expect(refused.attention).toBe(true);
  });

  it("names who pressed when the receipt does", () => {
    write("grant-day/r1/receipt.json", { id: "grant-day", runId: "r1", mode: "run", finishedAt: at(-10), outcome: "succeeded", record: { pressedBy: "Mark" } });
    expect(collectOperatorScripts(repository, context)[0].actor).toMatchObject({ name: "Mark", confidence: "medium" });
  });

  it("skips preflights, malformed receipts and the operator directory without throwing", () => {
    write("start-demo/p1/receipt.json", { id: "start-demo", mode: "preflight", finishedAt: at(-10), outcome: "succeeded", record: {} });
    write("start-demo/bad/receipt.json", "{not json");
    write("start-demo/list/receipt.json", "[]");
    write("operator/r1/receipt.json", { id: "x", mode: "run", finishedAt: at(-10), outcome: "succeeded" });
    expect(collectOperatorScripts(repository, context)).toEqual([]);
  });

  it("still reads one-level receipts as before", () => {
    write("20261124T020000Z-1/receipt.json", { schema: "arcadia-operator-run-receipt-v1", id: "grant-demo", runId: "20261124T020000Z-1", startedAt: at(-30), finishedAt: at(-20), outcome: "succeeded", stage: "complete" });
    const events = collectOperatorScripts(repository, context);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "operator-scripts:demo:20261124T020000Z-1", summary: "Operator script grant-demo: succeeded", actor: { tool: "operator", confidence: "medium" } });
  });
});
