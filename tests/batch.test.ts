import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { batchSlotFor, resolveBatch } from "../src/docs/batch.js";

const roots: string[] = [];

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface FixtureAction {
  id: string;
  status?: string;
  responsibility?: string;
  clarification?: string;
  question?: string;
  decisions?: string[];
  dependsOn?: string[];
}

/**
 * One repository holding one or more managed Projects, each with an active
 * Plan. A fixture Plan is the whole production surface the batch reads, so the
 * suite never touches live state.
 */
function repository(
  projects: Array<{
    slug: string;
    name?: string;
    current: string | null;
    tokenImpact?: string;
    actions: FixtureAction[];
    decisions?: Array<{ id: string; status: string; action?: string; answer?: string }>;
  }>
): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-batch-"));
  roots.push(root);

  for (const project of projects) {
    const planSlug = `${project.slug}-plan`;
    write(root, `${project.slug}/PROJECT.md`, [
      "---",
      "arcadia: v1",
      "type: project",
      `slug: ${project.slug}`,
      `name: ${project.name ?? project.slug}`,
      "status: active",
      "goal: Exercise the batch walk.",
      `milestone: ${project.slug} milestone`,
      `active_plan: ${planSlug}`,
      ...(project.current ? [`current_action: ${project.current}`] : []),
      "updated: 2026-09-22",
      "---",
      "",
      `# ${project.slug}`,
      ""
    ].join("\n"));

    write(root, `${project.slug}/docs/plans/${planSlug}.md`, [
      "---",
      "arcadia: v1",
      "type: plan",
      `slug: ${planSlug}`,
      `project: ${project.slug}`,
      "status: active",
      `milestone: ${project.slug} milestone`,
      ...(project.current ? [`current_action: ${project.current}`] : []),
      `token_impact: ${project.tokenImpact ?? "medium"}`,
      "token_budget: One bounded pass.",
      "recommended_model: gpt-5.6-terra",
      "updated: 2026-09-22",
      "actions:",
      ...project.actions.flatMap(actionBlock),
      "questions: []",
      "---",
      "",
      `# ${planSlug}`,
      ""
    ].join("\n"));

    for (const decision of project.decisions ?? []) {
      write(root, `${project.slug}/docs/decisions/${decision.id}-${decision.status}.md`, [
        "---",
        "arcadia: v1",
        "type: decision",
        `id: "${decision.id}"`,
        `slug: decision-${decision.id}`,
        `project: ${project.slug}`,
        `status: ${decision.status}`,
        "question: Does this gate the push?",
        "confidence: high",
        ...(decision.action ? [`action: ${decision.action}`] : []),
        ...(decision.answer ? [`answer: ${decision.answer}`, "decided: 2026-09-22"] : []),
        "options:",
        "  - label: Defer until later",
        "    consequence: The Action stops dispatching.",
        "    effect: defer",
        "updated: 2026-09-22",
        "---",
        "",
        "# Decision",
        ""
      ].join("\n"));
    }
  }

  return root;
}

function actionBlock(action: FixtureAction): string[] {
  const open = action.clarification === "question_open";
  return [
    `  - id: ${action.id}`,
    `    title: Action ${action.id}`,
    `    status: ${action.status ?? "open"}`,
    `    responsibility: ${action.responsibility ?? "agent"}`,
    "    effort: session",
    // A question_open Action is blocked by definition: the parser refuses a
    // next_action on one and demands the gap_type it is missing.
    ...(open ? [] : [`    next_action: Do ${action.id}.`]),
    `    expected_artifact: docs/${action.id}.md`,
    `    clarification: ${action.clarification ?? "clarified"}`,
    ...(action.question ? [`    question: ${action.question}`] : []),
    ...(open ? ["    gap_type: missing-decision"] : []),
    "    acceptance_criteria:",
    `      - ${action.id} is done.`,
    `    depends_on: [${(action.dependsOn ?? []).join(", ")}]`,
    `    decisions: [${(action.decisions ?? []).map((id) => `"${id}"`).join(", ")}]`,
    "    references: []"
  ];
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

describe("batch lanes", () => {
  it("gives each repository its own lane and leaves a lone Action unsequenced", () => {
    const left = repository([
      { slug: "alpha", current: "a1", actions: [{ id: "a1" }, { id: "after", status: "done" }] }
    ]);
    const right = repository([
      { slug: "beta", current: "b1", actions: [{ id: "b1" }, { id: "b2" }] }
    ]);

    const batch = resolveBatch([
      { repositoryRoot: left, projectSlug: "alpha" },
      { repositoryRoot: right, projectSlug: "beta" }
    ]);

    expect(batch.lanes).toHaveLength(2);
    expect(batch.lanes.map((lane) => lane.laneLabel)).toEqual([path.basename(left), path.basename(right)]);
    expect(batch.lanes.map((lane) => lane.projectSlugs)).toEqual([["alpha"], ["beta"]]);
    expect(batch.lanes[0].sequenceAdvised).toBe(false);
    expect(batch.lanes[1].sequenceAdvised).toBe(true);
    expect(batch.lanes[1].actions.map((action) => [action.actionId, action.position])).toEqual([
      ["b1", 1],
      ["b2", 2]
    ]);
  });

  it("merges two Projects that share a repository into one sequence-advised lane", () => {
    const root = repository([
      { slug: "alpha", current: "a1", actions: [{ id: "a1" }, { id: "a2" }] },
      { slug: "beta", current: "b1", actions: [{ id: "b1" }] }
    ]);

    const batch = resolveBatch([
      { repositoryRoot: root, projectSlug: "alpha" },
      { repositoryRoot: root, projectSlug: "beta" }
    ]);

    expect(batch.lanes).toHaveLength(1);
    expect(batch.lanes[0].projectSlugs).toEqual(["alpha", "beta"]);
    expect(batch.lanes[0].sequenceAdvised).toBe(true);
    expect(batch.lanes[0].actions.map((action) => action.actionId)).toEqual(["a1", "a2", "b1"]);
  });

  it("leads with current_action, then the document's own order, wrapping once", () => {
    const root = repository([
      { slug: "alpha", current: "middle", actions: [{ id: "behind" }, { id: "middle" }, { id: "ahead" }] }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);

    expect(batch.lanes[0].actions.map((action) => action.actionId)).toEqual(["middle", "ahead", "behind"]);
  });

  it("still leads a push whose pointer is declared last in the plan", () => {
    const root = repository([
      {
        slug: "alpha",
        current: "last",
        actions: [{ id: "first" }, { id: "second" }, { id: "last" }]
      }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);

    expect(batch.lanes[0].actions.map((action) => action.actionId)).toEqual(["last", "first", "second"]);
  });
});

describe("batch boundary", () => {
  it("stops at a required Decision that is still open", () => {
    const root = repository([
      {
        slug: "alpha",
        current: "first",
        // `later` is deferred so it is genuinely not ready: everything the
        // boundary leaves behind is named in the next push.
        actions: [{ id: "first" }, { id: "gated", decisions: ["0001"] }, { id: "later", status: "deferred" }],
        decisions: [{ id: "0001", status: "open" }]
      }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);
    const lane = batch.lanes[0];

    expect(lane.actions.map((action) => action.actionId)).toEqual(["first"]);
    expect(lane.stops).toHaveLength(1);
    expect(lane.boundary).toMatchObject({ kind: "decision", actionId: "gated", decisionId: "0001" });
    expect(lane.boundary?.prompt).toContain("0001");
    expect(lane.nextPush.map((action) => action.actionId)).toEqual(["later"]);
    expect(batchSlotFor(batch, "alpha", "gated")).toBe("decision");
    expect(batchSlotFor(batch, "alpha", "later")).toBe("next_push");
  });

  it("keeps a ready Action declared after the boundary in the push it can still run in", () => {
    const root = repository([
      {
        slug: "alpha",
        current: "first",
        actions: [{ id: "first" }, { id: "gated", responsibility: "requires_review" }, { id: "independent" }]
      }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);

    expect(batch.lanes[0].actions.map((action) => action.actionId)).toEqual(["first", "independent"]);
    expect(batch.lanes[0].boundary?.actionId).toBe("gated");
    expect(batchSlotFor(batch, "alpha", "independent")).toBe("this_push_sequence");
  });

  it("stops at a deferred Action", () => {
    const root = repository([
      { slug: "alpha", current: "first", actions: [{ id: "first" }, { id: "parked", status: "deferred" }] }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);

    expect(batch.lanes[0].boundary).toMatchObject({ kind: "deferred", actionId: "parked" });
    expect(batchSlotFor(batch, "alpha", "parked")).toBe("deferred");
  });

  it("stops at an Action parked by an answered defer Decision", () => {
    const root = repository([
      {
        slug: "alpha",
        current: "first",
        actions: [{ id: "first" }, { id: "parked" }],
        decisions: [{ id: "0057", status: "approved", action: "parked", answer: "Defer until later" }]
      }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);

    expect(batch.lanes[0].boundary).toMatchObject({ kind: "deferred", actionId: "parked", decisionId: "0057" });
  });

  it("stops at an open clarification question", () => {
    const root = repository([
      {
        slug: "alpha",
        current: "first",
        actions: [{ id: "first" }, { id: "unclear", clarification: "question_open", question: "Which provider?" }]
      }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);
    const stop = batch.lanes[0].boundary;

    expect(stop).toMatchObject({ kind: "question_open", actionId: "unclear" });
    expect(stop?.prompt).toContain("Which provider?");
  });

  it("stops at a capacity-gated proof run that only the operator may take", () => {
    const root = repository([
      {
        slug: "alpha",
        current: "first",
        actions: [{ id: "first" }, { id: "prove-live", responsibility: "requires_review" }]
      }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);

    expect(batch.lanes[0].boundary).toMatchObject({ kind: "capacity_proof_run", actionId: "prove-live" });
    expect(batchSlotFor(batch, "alpha", "prove-live")).toBe("capacity_proof_run");
  });

  it("stops at an unmet dependency without calling it an operator gate", () => {
    const root = repository([
      {
        slug: "alpha",
        current: "first",
        // `prerequisite` is declared and unfinished, so `blocked` has a real
        // unmet dependency rather than a dangling reference the parser rejects.
        actions: [{ id: "first" }, { id: "blocked", dependsOn: ["prerequisite"] }, { id: "prerequisite" }]
      }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);

    // A dependency stop is reported but is not an operator gate, so it never
    // becomes the boundary.
    expect(batch.lanes[0].stops[0]).toMatchObject({ kind: "dependency", actionId: "blocked" });
    expect(batch.lanes[0].boundary).toBeNull();
    expect(batch.lanes[0].actions.map((action) => action.actionId)).toEqual(["first", "prerequisite"]);
  });
});

describe("batch token rollup", () => {
  it("adds each lane's tiers and the overall total", () => {
    const medium = repository([
      { slug: "alpha", current: "a1", tokenImpact: "medium", actions: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] }
    ]);
    const small = repository([
      { slug: "beta", current: "b1", tokenImpact: "small", actions: [{ id: "b1" }] }
    ]);

    const batch = resolveBatch([
      { repositoryRoot: medium, projectSlug: "alpha" },
      { repositoryRoot: small, projectSlug: "beta" }
    ]);

    // medium = 2 points per Action, small = 1: 3 x 2 + 1 = 7.
    expect(batch.lanes[0].token).toEqual({ points: 6, tiers: ["medium"] });
    expect(batch.lanes[1].token).toEqual({ points: 1, tiers: ["small"] });
    expect(batch.token).toEqual({ points: 7, tiers: ["medium", "small"] });
  });

  it("reports an unknown tier as zero points rather than guessing", () => {
    const root = repository([
      { slug: "alpha", current: "a1", tokenImpact: "none", actions: [{ id: "a1" }] }
    ]);

    const batch = resolveBatch([{ repositoryRoot: root, projectSlug: "alpha" }]);

    expect(batch.token.points).toBe(0);
    expect(batch.token.tiers).toEqual(["none"]);
  });
});
