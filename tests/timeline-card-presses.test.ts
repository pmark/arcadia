import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectOperatorScripts, OPERATOR_RUNS_DIR } from "../src/timeline/collectors/operatorScripts.js";
import type { CollectorContext } from "../src/timeline/collectors/context.js";

/**
 * Card presses are receipts two levels deep, `runs/<card id>/<run id>/receipt.json`
 * (the layout observed 2026-11-22; the main checkout's library was not read).
 */

let root: string;
let runs: string;
let context: CollectorContext;
const repository = { projectSlug: "demo", projectId: "proj_demo", path: "" };

function receipt(relative: string, body: unknown): void {
  const file = path.join(runs, relative, "receipt.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
}

const at = (offsetSeconds: number) => new Date(Date.now() + offsetSeconds * 1000).toISOString();

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "timeline-card-presses-"));
  repository.path = root;
  runs = path.join(root, OPERATOR_RUNS_DIR);
  context = {
    window: { since: new Date(Date.now() - 3600_000), until: new Date(Date.now() + 3600_000) },
    maxPerSource: 100
  } as CollectorContext;
  receipt("start-demo/run-1", { schema: "arcadia-standing-grant-receipt-v1", id: "start-demo", runId: "run-1", mode: "run", startedAt: at(-60), updatedAt: at(-50), outcome: "succeeded", record: { plan: "plan-a" } });
  receipt("start-named/run-2", { id: "start-named", runId: "run-2", mode: "run", updatedAt: at(-40), outcome: "refused", pressedBy: "Mark" });
  receipt("start-demo/run-0", { id: "start-demo", runId: "run-0", mode: "preflight", updatedAt: at(-70), outcome: "succeeded" });
  receipt("start-bad/run-3", "{not json");
  receipt("operator/run-4", { id: "operator", runId: "run-4", mode: "run", updatedAt: at(-30), outcome: "succeeded" });
  receipt("20261006T010000Z-1", { schema: "arcadia-operator-run-receipt-v1", id: "grant-demo", runId: "20261006T010000Z-1", startedAt: at(-50), finishedAt: at(-40), outcome: "succeeded", stage: "complete" });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("operator-script card presses", () => {
  it("emits one event per mode run press, with card, run, outcome, plan and a low-confidence actor", () => {
    const events = collectOperatorScripts(repository, context);
    const press = events.find((event) => event.id === "operator-scripts:demo:start-demo:run-1");
    expect(press).toMatchObject({
      source: "operator-scripts",
      kind: "operator-script.run",
      subjects: { project: "demo", plan: "plan-a" },
      actor: { confidence: "low" },
      attention: false
    });
    expect(press?.summary).toContain("start-demo");
    expect(press?.summary).toContain("succeeded");
    expect(press?.evidence.map((item) => item.value)).toContain("run-1");
  });

  it("omits the plan when the receipt has none, and names a presser when the receipt does", () => {
    const press = collectOperatorScripts(repository, context).find((event) => event.id.endsWith(":start-named:run-2"));
    expect(press?.subjects.plan).toBeUndefined();
    expect(press?.actor).toMatchObject({ name: "Mark", confidence: "medium" });
    expect(press?.attention).toBe(true);
  });

  it("skips preflights, malformed receipts and the operator directory without throwing", () => {
    const ids = collectOperatorScripts(repository, context).map((event) => event.id).sort();
    expect(ids).toEqual(["operator-scripts:demo:20261006T010000Z-1", "operator-scripts:demo:start-demo:run-1", "operator-scripts:demo:start-named:run-2"]);
  });

  it("keeps the one-level receipt's event as it was", () => {
    const event = collectOperatorScripts(repository, context).find((item) => item.id === "operator-scripts:demo:20261006T010000Z-1");
    expect(event?.summary).toBe("Operator script grant-demo: succeeded");
    expect(event?.actor).toMatchObject({ tool: "operator", confidence: "medium" });
    expect(event?.alsoSeenAs).toEqual([]);
    expect(event?.dedupeKeys).toEqual(["operator-run:grant-demo"]);
  });
});
