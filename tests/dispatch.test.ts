import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isDispatchable, resolveDispatch } from "../src/docs/dispatch.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function repo(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-dispatch-"));
  temporary.push(directory);
  return directory;
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function projectDoc(options: { activePlan?: string | null; status?: string } = {}): string {
  const lines = [
    "---",
    "arcadia: v1",
    "type: project",
    "slug: demo",
    "name: Demo",
    `status: ${options.status ?? "active"}`,
    "goal: Prove the work pointer resolves.",
    "milestone: First milestone"
  ];
  if (options.activePlan !== null) {
    lines.push(`active_plan: ${options.activePlan ?? "main-plan"}`);
  }
  lines.push("updated: 2026-07-25", "---", "");
  return lines.join("\n");
}

/** A plan whose current action is clean, clarified, and codex-owned. */
function planDoc(overrides: { currentAction?: string | null; slug?: string; extra?: string } = {}): string {
  const lines = [
    "---",
    "arcadia: v1",
    "type: plan",
    `slug: ${overrides.slug ?? "main-plan"}`,
    "project: demo",
    "status: active",
    "milestone: First milestone"
  ];
  if (overrides.currentAction !== null) {
    lines.push(`current_action: ${overrides.currentAction ?? "ship-it"}`);
  }
  lines.push(
    "updated: 2026-07-25",
    "actions:",
    "  - id: ship-it",
    "    title: Ship the thing",
    "    status: open",
    "    responsibility: codex",
    "    effort: short",
    "    next_action: Add the migration and wire the command.",
    "    clarification: clarified",
    "    confidence: high",
    "    source: conversation",
    "    acceptance_criteria:",
    "      - The migration runs twice without duplicating a column.",
    "      - The command is covered by a test.",
    "    depends_on: []"
  );
  if (overrides.extra) {
    lines.push(overrides.extra);
  }
  lines.push("---", "");
  return lines.join("\n");
}

describe("dispatch resolution", () => {
  it("resolves exactly one current action and marks it dispatchable", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", planDoc());

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.blockers).toEqual([]);
    expect(resolution.context?.activePlan).toBe("main-plan");
    expect(resolution.context?.action.id).toBe("ship-it");
    expect(resolution.context?.action.acceptanceCriteria).toHaveLength(2);
    expect(resolution.context?.authorization).toContain("coding agent may implement");
    expect(isDispatchable(resolution)).toBe(true);
  });

  it("refuses to guess when PROJECT.md names no active_plan", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc({ activePlan: null }));
    write(root, "docs/plans/main-plan.md", planDoc());

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.context).toBeNull();
    const blocker = resolution.blockers.find((entry) => entry.field === "active_plan");
    expect(blocker?.message).toContain("no active_plan");
    // The remedy must name the real candidates, not just describe the problem.
    expect(blocker?.remedy).toContain("main-plan");
  });

  it("reports an active_plan pointing at a plan that does not exist", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc({ activePlan: "ghost-plan" }));
    write(root, "docs/plans/main-plan.md", planDoc());

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.context).toBeNull();
    expect(resolution.blockers[0].message).toContain("matches no plan");
  });

  it("reports an active plan that designates no current_action", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", planDoc({ currentAction: null }));

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.context).toBeNull();
    const blocker = resolution.blockers.find((entry) => entry.field === "current_action");
    expect(blocker?.remedy).toContain("ship-it");
  });

  it("rejects the plan outright when current_action points at no action", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", planDoc({ currentAction: "ghost-action" }));

    const resolution = resolveDispatch(root, "demo");

    // A dangling pointer leaves an agent with no objective at all, so the file
    // fails validation rather than resolving to something plausible.
    expect(resolution.context).toBeNull();
    expect(resolution.blockers.some((entry) => entry.message.includes("ghost-action"))).toBe(true);
  });

  it("refuses a clarified current action that defines no acceptance criteria", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(
      root,
      "docs/plans/main-plan.md",
      planDoc().replace(
        "    acceptance_criteria:\n      - The migration runs twice without duplicating a column.\n      - The command is covered by a test.\n",
        ""
      )
    );

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.context).toBeNull();
    expect(
      resolution.blockers.some((entry) => entry.message.includes("objective acceptance criteria"))
    ).toBe(true);
  });

  it("treats a second plan designating a current_action as a competing objective", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", planDoc());
    write(root, "docs/plans/other-plan.md", planDoc({ slug: "other-plan" }));

    const resolution = resolveDispatch(root, "demo");

    const blocker = resolution.blockers.find((entry) => entry.message.includes("competing") || entry.field === "current_action");
    expect(blocker?.message).toContain("other-plan");
    expect(isDispatchable(resolution)).toBe(false);
  });

  it("returns exactly one operator question for a question_open action", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(
      root,
      "docs/plans/main-plan.md",
      [
        "---",
        "arcadia: v1",
        "type: plan",
        "slug: main-plan",
        "project: demo",
        "status: active",
        "current_action: undecided",
        "updated: 2026-07-25",
        "actions:",
        "  - id: undecided",
        "    title: Something not yet decided",
        "    status: open",
        "    responsibility: requires_review",
        "    clarification: question_open",
        "    gap_type: missing-decision",
        "    question: Which environment goes first?",
        "    depends_on: []",
        "---",
        ""
      ].join("\n")
    );

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.operatorQuestion).toBe("Which environment goes first?");
    expect(resolution.context?.action.nextAction).toBeNull();
    // A question is not work a coding agent may start.
    expect(isDispatchable(resolution)).toBe(false);
  });

  it("blocks on a required decision that is missing or unresolved", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", planDoc().replace("    depends_on: []", '    decisions: ["0007"]\n    depends_on: []'));

    const missing = resolveDispatch(root, "demo");
    expect(missing.blockers.some((entry) => entry.message.includes('requires decision "0007"'))).toBe(true);

    write(
      root,
      "docs/decisions/0007-pick-one.md",
      [
        "---",
        "arcadia: v1",
        "type: decision",
        'id: "0007"',
        "slug: pick-one",
        "project: demo",
        "status: open",
        "question: Which way?",
        "updated: 2026-07-25",
        "---",
        ""
      ].join("\n")
    );

    const unresolved = resolveDispatch(root, "demo");
    expect(unresolved.blockers.some((entry) => entry.message.includes('still "open"'))).toBe(true);
    expect(isDispatchable(unresolved)).toBe(false);
  });

  it("does not dispatch work owned by the operator", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", planDoc().replace("responsibility: codex", "responsibility: requires_review"));

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.blockers).toEqual([]);
    expect(resolution.context?.authorization).toContain("operator must act");
    expect(isDispatchable(resolution)).toBe(false);
  });

  it("reports an inactive Project and an already-finished current action", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc({ status: "paused" }));
    write(root, "docs/plans/main-plan.md", planDoc().replace("status: open", "status: done"));

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.blockers.some((entry) => entry.message.includes("not active"))).toBe(true);
    expect(resolution.blockers.some((entry) => entry.message.includes("already done"))).toBe(true);
  });

  it("reports a repository with no managed PROJECT.md", () => {
    const root = repo();
    write(root, "README.md", "# Nothing managed here\n");

    const resolution = resolveDispatch(root);

    expect(resolution.context).toBeNull();
    expect(resolution.blockers[0].message).toContain("No PROJECT.md");
  });
});

/**
 * Build a plan whose actions are exactly the given graph, so a test can state
 * the ordering it means without editing the shared clean-plan fixture.
 */
function graphPlanDoc(
  current: string,
  actions: Array<{ id: string; status?: string; dependsOn?: string[] }>
): string {
  const lines = [
    "---",
    "arcadia: v1",
    "type: plan",
    "slug: main-plan",
    "project: demo",
    "status: active",
    "milestone: First milestone",
    `current_action: ${current}`,
    "updated: 2026-07-25",
    "actions:"
  ];
  for (const action of actions) {
    lines.push(
      `  - id: ${action.id}`,
      `    title: Action ${action.id}`,
      `    status: ${action.status ?? "open"}`,
      "    responsibility: codex",
      `    next_action: Do ${action.id}.`,
      "    clarification: clarified",
      "    acceptance_criteria:",
      `      - ${action.id} is finished and covered by a test.`,
      `    depends_on: [${(action.dependsOn ?? []).join(", ")}]`
    );
  }
  lines.push("---", "");
  return lines.join("\n");
}

describe("dependency readiness", () => {
  it("blocks the current action while a direct dependency is unfinished", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(
      root,
      "docs/plans/main-plan.md",
      graphPlanDoc("ship-it", [
        { id: "migrate", status: "in_progress" },
        { id: "ship-it", dependsOn: ["migrate"] }
      ])
    );

    const resolution = resolveDispatch(root, "demo");

    const blocker = resolution.blockers.find((entry) => entry.field === "actions.ship-it.depends_on");
    expect(blocker?.message).toContain('"migrate"');
    expect(blocker?.message).toContain("in_progress");
    expect(blocker?.remedy).toContain('Finish "migrate" first');
    // The action still resolves; the operator needs to see what is blocked.
    expect(resolution.context?.action.id).toBe("ship-it");
    expect(isDispatchable(resolution)).toBe(false);
  });

  it("follows the chain and names the transitive dependency that is not done", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(
      root,
      "docs/plans/main-plan.md",
      graphPlanDoc("ship-it", [
        { id: "schema", status: "open" },
        { id: "migrate", status: "done", dependsOn: ["schema"] },
        { id: "ship-it", dependsOn: ["migrate"] }
      ])
    );

    const resolution = resolveDispatch(root, "demo");

    const blockers = resolution.blockers.filter((entry) => entry.field === "actions.ship-it.depends_on");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toContain('"schema"');
    expect(blockers[0].message).toContain("via migrate");
  });

  it("dispatches once every dependency is done", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(
      root,
      "docs/plans/main-plan.md",
      graphPlanDoc("ship-it", [
        { id: "schema", status: "done" },
        { id: "migrate", status: "done", dependsOn: ["schema"] },
        { id: "ship-it", dependsOn: ["migrate"] }
      ])
    );

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.blockers).toEqual([]);
    expect(isDispatchable(resolution)).toBe(true);
  });

  it("rejects a dependency cycle instead of dispatching work that can never be ready", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(
      root,
      "docs/plans/main-plan.md",
      graphPlanDoc("ship-it", [
        { id: "ship-it", dependsOn: ["migrate"] },
        { id: "migrate", dependsOn: ["ship-it"] }
      ])
    );

    const resolution = resolveDispatch(root, "demo");

    const cycle = resolution.blockers.find((entry) => entry.message.includes("Dependency cycle"));
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain("migrate");
    expect(cycle?.message).toContain("ship-it");
    expect(isDispatchable(resolution)).toBe(false);
  });

  it("reports a self-dependency as a cycle", () => {
    const root = repo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", graphPlanDoc("ship-it", [{ id: "ship-it", dependsOn: ["ship-it"] }]));

    const resolution = resolveDispatch(root, "demo");

    expect(resolution.blockers.some((entry) => entry.message.includes("ship-it -> ship-it"))).toBe(true);
  });
});
