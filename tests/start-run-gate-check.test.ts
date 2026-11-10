import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runStartRunGateCheckCommand } from "../src/commands/startRun.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

// Issue #2038: `arcadia start-run gate-check` is the read-only answer scripts/start-run.sh refuses on. The executor's own
// refusal on a pending Agent Ask is tested in tests/start-run-executor.test.ts against the scripted CLI; this file pins the
// real command against the same resolver (`resolveOperatorGate`) that holds a launch.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function temp(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-start-run-gate-"));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function decisionDoc(action: string): string {
  return ["---", "arcadia: v1", "type: decision", "id: \"0001\"", "slug: hold-the-action", "project: demo", "status: open",
    `action: ${action}`, "question: Should the pinned Action proceed?", "updated: 2026-09-01", "---", "", "# Decision", ""].join("\n");
}

describe("arcadia start-run gate-check", () => {
  it("lists an open Decision naming a pinned Action as blocking, and only for that Action", () => {
    const repo = temp();
    write(repo, "docs/decisions/0001-hold-the-action.md", decisionDoc("ship-it"));
    const workspace = temp();
    initWorkspace(workspace);

    const held = runStartRunGateCheckCommand({ project: "demo", actions: ["ship-it", "other"], repository: repo, workspace });
    expect(held.data.blocking.map((item) => [item.action, item.kind, item.id])).toEqual([["ship-it", "decision", "0001"]]);

    const clear = runStartRunGateCheckCommand({ project: "demo", actions: ["other"], repository: repo, workspace });
    expect(clear.data.blocking).toEqual([]);
  });

  it("needs a pinned Action", () => {
    expect(() => runStartRunGateCheckCommand({ project: "demo", actions: [] })).toThrow(/at least one --action/);
  });
});
