import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { admitStartScope, resolveAcceptedReadiness, WORTHWHILE_BATCH_MINIMUM } from "../src/docs/dispatch.js";
import { runStartRunReadinessCommand } from "../src/commands/startRun.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function repo(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-readiness-"));
  temporary.push(directory);
  return directory;
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function projectDoc(options: { activePlan?: string; status?: string } = {}): string {
  return [
    "---",
    "arcadia: v1",
    "type: project",
    "slug: demo",
    "name: Demo",
    `status: ${options.status ?? "active"}`,
    "goal: Prove accepted-scope readiness.",
    "milestone: First milestone",
    `active_plan: ${options.activePlan ?? "plan-a"}`,
    "updated: 2026-11-12",
    "---",
    ""
  ].join("\n");
}

interface TestAction {
  id: string;
  status?: string;
  responsibility?: string;
  clarification?: string;
  dependsOn?: string[];
}

function planDoc(slug: string, status: string, actions: TestAction[]): string {
  const lines = [
    "---",
    "arcadia: v1",
    "type: plan",
    `slug: ${slug}`,
    "project: demo",
    `status: ${status}`,
    "milestone: First milestone",
    "token_impact: medium",
    "token_budget: One bounded implementation pass; tests are deterministic.",
    "recommended_model: gpt-5.6-terra",
    "updated: 2026-11-12",
    "actions:"
  ];
  for (const action of actions) {
    lines.push(
      `  - id: ${action.id}`,
      `    title: Work ${action.id}`,
      `    status: ${action.status ?? "open"}`,
      `    responsibility: ${action.responsibility ?? "agent"}`,
      "    effort: short",
      `    clarification: ${action.clarification ?? "clarified"}`,
      ...(action.clarification === "question_open" ? ["    question: Which option should the Action take?", "    gap_type: missing-decision"] : [`    next_action: Do ${action.id}.`]),
      "    confidence: high",
      "    source: conversation",
      "    acceptance_criteria:",
      "      - The change is covered by a deterministic test.",
      `    depends_on: [${(action.dependsOn ?? []).join(", ")}]`
    );
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** Accepted plan-a with two ready Actions, a held one, and a draft plan-b with ready Actions of its own. */
function fixture(): string {
  const root = repo();
  write(root, "PROJECT.md", projectDoc({ activePlan: "plan-a" }));
  write(root, "docs/plans/plan-a.md", planDoc("plan-a", "active", [
    { id: "alpha" },
    { id: "beta" },
    { id: "gamma", status: "blocked" },
    { id: "delta", responsibility: "requires_review" },
    { id: "epsilon", clarification: "question_open" },
    { id: "zeta", dependsOn: ["beta"] }
  ]));
  write(root, "docs/plans/plan-b.md", planDoc("plan-b", "draft", [{ id: "omega" }, { id: "sigma" }]));
  return root;
}

describe("accepted-scope readiness", () => {
  it("lists every ready Action across accepted Plans and a reason for each other Action", () => {
    const resolution = resolveAcceptedReadiness(fixture(), "demo");

    expect(resolution.blockers).toEqual([]);
    const planA = resolution.plans.find((plan) => plan.planSlug === "plan-a")!;
    expect(planA.accepted).toBe(true);
    expect(planA.actions.filter((action) => action.ready).map((action) => action.actionId)).toEqual(["alpha", "beta"]);
    const reason = (id: string) => planA.actions.find((action) => action.actionId === id)!.reason;
    expect(reason("gamma")).toBe("status is blocked");
    expect(reason("delta")).toContain("not coding-agent work");
    expect(reason("epsilon")).toMatch(/clarification|question_open/);
    expect(reason("zeta")).toContain("blocked:");
  });

  it("never evaluates or lists Actions of an unaccepted draft Plan", () => {
    const resolution = resolveAcceptedReadiness(fixture(), "demo");

    const planB = resolution.plans.find((plan) => plan.planSlug === "plan-b")!;
    expect(planB.accepted).toBe(false);
    expect(planB.actions).toEqual([]);
    expect(planB.readyCount).toBe(0);
    expect(resolution.readyTotal).toBe(2);
  });

  it("reports the shortfall against the two-Action batch minimum", () => {
    expect(WORTHWHILE_BATCH_MINIMUM).toBe(2);
    const met = resolveAcceptedReadiness(fixture(), "demo");
    expect(met.bestScope).toEqual({ planSlug: "plan-a", readyCount: 2 });
    expect(met.shortfall).toBe(0);
    expect(met.statement).toContain("meeting the minimum of 2");

    const root = repo();
    write(root, "PROJECT.md", projectDoc({ activePlan: "plan-a" }));
    write(root, "docs/plans/plan-a.md", planDoc("plan-a", "active", [{ id: "alpha" }, { id: "beta", status: "blocked" }]));
    const short = resolveAcceptedReadiness(root, "demo");
    expect(short.shortfall).toBe(1);
    expect(short.statement).toContain("Shortfall");
  });

  it("states a full shortfall when no accepted Plan has a ready Action", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc({ activePlan: "plan-a" }));
    write(root, "docs/plans/plan-a.md", planDoc("plan-a", "draft", [{ id: "alpha" }]));
    const resolution = resolveAcceptedReadiness(root, "demo");
    expect(resolution.bestScope).toBeNull();
    expect(resolution.shortfall).toBe(2);
  });
});

describe("start scope admission", () => {
  it("admits a ready scope drawn from the accepted active Plan", () => {
    const admission = admitStartScope(fixture(), "demo", "plan-a", ["alpha", "beta"]);
    expect(admission.refusals).toEqual([]);
    expect(admission.admitted).toBe(true);
  });

  it("never admits an unaccepted Plan, even with Actions that would otherwise be ready", () => {
    const admission = admitStartScope(fixture(), "demo", "plan-b", ["omega"]);
    expect(admission.admitted).toBe(false);
    expect(admission.refusals.join("\n")).toContain("draft, not accepted");
  });

  it("never admits an out-of-scope Action, a held Action, or a Plan Action named twice", () => {
    const root = fixture();
    expect(admitStartScope(root, "demo", "plan-a", ["omega"]).refusals.join("\n")).toContain("out of scope");
    expect(admitStartScope(root, "demo", "plan-a", ["gamma"]).refusals.join("\n")).toContain("not ready");
    expect(admitStartScope(root, "demo", "plan-a", ["alpha", "alpha"]).refusals.join("\n")).toContain("once");
    expect(admitStartScope(root, "demo", "plan-a", []).admitted).toBe(false);
  });

  it("refuses a scope when the operator's active_plan preference changes mid-run", () => {
    const root = fixture();
    const first = admitStartScope(root, "demo", "plan-a", ["alpha"]);
    expect(first.admitted).toBe(true);

    // The preference moves to a different Plan between two checks of the same scope.
    write(root, "PROJECT.md", projectDoc({ activePlan: "plan-b" }));
    const second = admitStartScope(root, "demo", "plan-a", ["alpha"]);
    expect(second.admitted).toBe(false);
    expect(second.refusals.join("\n")).toContain("active_plan preference is plan-b");
  });

  it("refuses everything when the Project is not active", () => {
    const root = fixture();
    write(root, "PROJECT.md", projectDoc({ activePlan: "plan-a", status: "paused" }));
    const admission = admitStartScope(root, "demo", "plan-a", ["alpha"]);
    expect(admission.admitted).toBe(false);
    expect(admission.refusals.join("\n")).toContain("Project blocker");
  });
});

describe("start-run readiness command", () => {
  it("is read-only and reports admission for a named scope without a workspace", () => {
    const root = fixture();
    const response = runStartRunReadinessCommand({ project: "demo", repository: root, plan: "plan-a", actions: ["alpha", "beta"] });
    expect(response.data.readiness.readyTotal).toBe(2);
    expect(response.data.admission?.admitted).toBe(true);
    expect(response.workspace).toBeUndefined();
  });

  it("rejects an admission check without a Plan or an Action", () => {
    expect(() => runStartRunReadinessCommand({ project: "demo", repository: fixture(), actions: ["alpha"] })).toThrow();
    expect(() => runStartRunReadinessCommand({ project: "demo", repository: fixture(), plan: "plan-a", actions: [] })).toThrow();
  });
});
