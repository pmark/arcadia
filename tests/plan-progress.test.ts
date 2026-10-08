import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLAN_PROGRESS_NOTE,
  countActions,
  renderPlanProgressSuccess,
  runPlanProgressCommand,
  runPlansCommand
} from "../src/commands/plans.js";
import { actionKeyOf } from "../src/scheduling/store.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface ActionSpec {
  id: string;
  status?: "open" | "in_progress" | "done" | "blocked" | "deferred";
  dependsOn?: string[];
  reason?: string;
}

function actionYaml(spec: ActionSpec): string {
  const status = spec.status ?? "open";
  const lines = [
    `  - id: ${spec.id}`,
    `    title: Title of ${spec.id}`,
    `    status: ${status}`,
    "    responsibility: agent"
  ];
  if (spec.reason) {
    lines.push("    clarification: question_open", "    gap_type: missing-decision", `    question: ${spec.reason}`);
  } else {
    lines.push(`    next_action: Do ${spec.id}.`, "    clarification: clarified");
  }
  lines.push("    confidence: high", "    acceptance_criteria:", `      - ${spec.id} is observably complete.`);
  lines.push(`    depends_on: [${(spec.dependsOn ?? []).join(", ")}]`);
  return lines.join("\n");
}

function planDoc(slug: string, status: string, specs: ActionSpec[]): string {
  return `---
arcadia: v1
type: plan
slug: ${slug}
project: demo
status: ${status}
milestone: Show progress
token_impact: small
token_budget: "Deterministic."
recommended_model: gpt-5.6-terra
updated: 2026-10-08
actions:
${specs.map(actionYaml).join("\n")}
---

# ${slug}
`;
}

function projectDoc(activePlan: string, currentAction: string | null): string {
  return `---
arcadia: v1
type: project
slug: demo
name: Demo
status: active
goal: Prove plan progress renders.
outcome: Progress is derived from the Plan.
milestone: Show progress
active_plan: ${activePlan}
${currentAction ? `current_action: ${currentAction}\n` : ""}updated: 2026-10-08
---

# Demo
`;
}

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-plan-progress-"));
  temporary.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  return root;
}

const MIXED: ActionSpec[] = [
  { id: "a", status: "done" },
  { id: "b", status: "in_progress", dependsOn: ["a"] },
  { id: "c", dependsOn: ["b"] },
  { id: "d", status: "blocked", reason: "Awaiting the operator's answer." },
  { id: "e", status: "deferred" },
  { id: "f" }
];

describe("arcadia plans --plan", () => {
  it("counts every bucket, including deferred, through the shared countActions", () => {
    const root = repo({ "PROJECT.md": projectDoc("other", null), "docs/plans/mixed.md": planDoc("mixed", "draft", MIXED) });
    const response = runPlanProgressCommand({ repo: root, plan: "mixed" });

    expect(response.data.counts).toEqual({ done: 1, in_progress: 1, blocked: 1, deferred: 1, open: 2, total: 6 });
    const listed = runPlansCommand({ repo: root }).data.plans.find((plan) => plan.slug === "mixed");
    expect(listed?.actionCounts).toEqual({ open: 2, in_progress: 1, done: 1, blocked: 1, deferred: 1 });
    expect(countActions({ actions: [] })).toEqual({ open: 0, in_progress: 0, done: 0, blocked: 0, deferred: 0 });
  });

  it("uses PROJECT.md current_action for the active Plan", () => {
    const root = repo({ "PROJECT.md": projectDoc("mixed", "f"), "docs/plans/mixed.md": planDoc("mixed", "active", MIXED) });
    const { data } = runPlanProgressCommand({ repo: root, plan: "mixed" });

    expect(data.isActivePlan).toBe(true);
    expect(data.current).toMatchObject({ key: "demo/f", basis: "project_current_action" });
    expect(data.next.map((item) => item.key)).toEqual(["demo/b", "demo/c"]);
  });

  it("says so when the active Plan has no current_action", () => {
    const root = repo({ "PROJECT.md": projectDoc("mixed", null), "docs/plans/mixed.md": planDoc("mixed", "active", MIXED) });
    const { data } = runPlanProgressCommand({ repo: root, plan: "mixed" });

    expect(data.current).toBeNull();
    expect(data.currentNote).toBe("none (PROJECT.md declares no current_action)");
  });

  it("uses the first unfinished Action whose dependencies are done for an inactive Plan", () => {
    const root = repo({ "PROJECT.md": projectDoc("other", null), "docs/plans/mixed.md": planDoc("mixed", "draft", MIXED) });
    const { data } = runPlanProgressCommand({ repo: root, plan: "mixed" });

    expect(data.isActivePlan).toBe(false);
    expect(data.current).toMatchObject({ key: "demo/b", basis: "first_unfinished_ready" });
    expect(data.next.map((item) => item.key)).toEqual(["demo/c", "demo/f"]);
  });

  it("reports none (Plan not active) when nothing is ready", () => {
    const root = repo({
      "PROJECT.md": projectDoc("other", null),
      "docs/plans/stuck.md": planDoc("stuck", "draft", [
        { id: "a", status: "blocked", reason: "Needs a Decision." },
        { id: "b", dependsOn: ["a"] }
      ])
    });
    const response = runPlanProgressCommand({ repo: root, plan: "stuck" });

    expect(response.data.current).toBeNull();
    expect(response.data.currentNote).toBe("none (Plan not active)");
    expect(renderPlanProgressSuccess(response).join("\n")).toContain("Current Action: none (Plan not active)");
  });

  it("orders next by document order held back by depends_on", () => {
    const root = repo({
      "PROJECT.md": projectDoc("other", null),
      "docs/plans/order.md": planDoc("order", "draft", [
        { id: "late", dependsOn: ["early"] },
        { id: "middle" },
        { id: "early" }
      ])
    });
    const { data } = runPlanProgressCommand({ repo: root, plan: "order" });

    // "late" is first in the document but waits for "early"; "middle" is ready.
    expect(data.current?.key).toBe("demo/middle");
    expect(data.next.map((item) => item.key)).toEqual(["demo/early", "demo/late"]);
    expect(data.next[1].waitingOn).toEqual(["early"]);
  });

  it("lists blocked Actions with their recorded reason as [!] items", () => {
    const root = repo({ "PROJECT.md": projectDoc("other", null), "docs/plans/mixed.md": planDoc("mixed", "draft", MIXED) });
    const response = runPlanProgressCommand({ repo: root, plan: "mixed" });
    const text = renderPlanProgressSuccess(response).join("\n");

    expect(response.data.blocked).toEqual([
      expect.objectContaining({ key: "demo/d", reason: "Awaiting the operator's answer." })
    ]);
    expect(text).toContain("- [!] d — Title of d");
    expect(text).toContain("reason: Awaiting the operator's answer.");
    expect(text).toContain("not the dispatch queue");
    expect(text).toContain("Done means the recorded Action status, not re-proven acceptance.");
  });

  it("handles a large Plan: next is capped at five, --all prints every Action as a checklist", () => {
    const specs: ActionSpec[] = Array.from({ length: 60 }, (_, index) => ({
      id: `step-${String(index).padStart(2, "0")}`,
      status: index < 20 ? "done" : "open",
      dependsOn: index > 0 ? [`step-${String(index - 1).padStart(2, "0")}`] : []
    }));
    const root = repo({ "PROJECT.md": projectDoc("other", null), "docs/plans/big.md": planDoc("big", "draft", specs) });
    const response = runPlanProgressCommand({ repo: root, plan: "big" });

    expect(response.data.counts).toMatchObject({ done: 20, open: 40, total: 60 });
    expect(response.data.current?.key).toBe("demo/step-20");
    expect(response.data.next.map((item) => item.key)).toEqual([
      "demo/step-21",
      "demo/step-22",
      "demo/step-23",
      "demo/step-24",
      "demo/step-25"
    ]);

    const summary = renderPlanProgressSuccess(response);
    expect(summary.join("\n")).toContain("60 Actions in all: --all");
    expect(summary.filter((line) => line.startsWith("- [x]"))).toHaveLength(0);

    const full = renderPlanProgressSuccess(response, true);
    // 60 in the full list, plus the current Action and the five next ones above it.
    expect(full.filter((line) => /^- \[[x !]\] step-/.test(line))).toHaveLength(60 + 6);
    expect(full.filter((line) => line.startsWith("- [x] step-"))).toHaveLength(20);
  });

  it("keys every Action exactly as the scheduler does", () => {
    const root = repo({ "PROJECT.md": projectDoc("other", null), "docs/plans/mixed.md": planDoc("mixed", "draft", MIXED) });
    const { data } = runPlanProgressCommand({ repo: root, plan: "mixed" });

    expect(data.actions.map((action) => action.key)).toEqual(MIXED.map((spec) => actionKeyOf("demo", spec.id)));
  });

  it("emits the stable JSON shape", () => {
    const root = repo({
      "PROJECT.md": projectDoc("golden", "two"),
      "docs/plans/golden.md": planDoc("golden", "active", [
        { id: "one", status: "done" },
        { id: "two", dependsOn: ["one"] },
        { id: "three", status: "blocked", reason: "Needs an answer." }
      ])
    });
    const { data } = runPlanProgressCommand({ repo: root, plan: "golden" });

    expect(JSON.parse(JSON.stringify(data))).toEqual({
      schema: "arcadia-plan-progress-v1",
      source: { planSlug: "golden", planPath: "docs/plans/golden.md", updated: "2026-10-08" },
      counts: { open: 1, in_progress: 0, done: 1, blocked: 1, deferred: 0, total: 3 },
      isActivePlan: true,
      current: { key: "demo/two", title: "Title of two", status: "open", waitingOn: [], basis: "project_current_action" },
      currentNote: null,
      next: [],
      blocked: [{ key: "demo/three", title: "Title of three", status: "blocked", waitingOn: [], reason: "Needs an answer." }],
      actions: [
        { key: "demo/one", status: "done", dependsOn: [], title: "Title of one" },
        { key: "demo/two", status: "open", dependsOn: ["one"], title: "Title of two" },
        { key: "demo/three", status: "blocked", dependsOn: [], title: "Title of three" }
      ],
      note: PLAN_PROGRESS_NOTE
    });
  });

  it("rejects an unknown Plan", () => {
    const root = repo({ "PROJECT.md": projectDoc("other", null), "docs/plans/mixed.md": planDoc("mixed", "draft", MIXED) });

    expect(() => runPlanProgressCommand({ repo: root, plan: "nope" })).toThrow(/No governed Plan "nope"/);
  });
});
