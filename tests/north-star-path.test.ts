import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact,
  getWorkItemByDocRef,
  replaceDocumentWorkItemDependencies,
  setWorkItemDocRef
} from "../src/db/repositories.js";
import { parseDoc } from "../src/docs/parse.js";
import { computeNowBrief } from "../src/northStar/compute.js";
import { loadNorthStar, northStarPath } from "../src/northStar/document.js";
import { computePathBrief, type PathStep } from "../src/northStar/path.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("the path to the target", () => {
  it("orders each gate's chain dependencies first, with the gate's own Action last", () => {
    const workspace = seededWorkspace();

    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    const leg = brief.legs.find((entry) => entry.gateId === "tracked")!;
    expect(steps(leg.nodes).map((step) => step.title)).toEqual(["First", "Second", "The gate action"]);
    expect(steps(leg.nodes).map((step) => step.state)).toEqual(["done", "done", "planned"]);
    expect(leg.done).toBe(2);
    expect(leg.remaining).toBe(1);
  });

  it("counts finished work as history rather than dropping it", () => {
    const workspace = seededWorkspace();
    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    expect(brief.totals.steps).toBe(3);
    expect(brief.totals.stepsDone).toBe(2);
    expect(brief.totals.remaining).toBe(1);
  });

  it("names an operator-owned gate as unplanned rather than showing it empty", () => {
    const workspace = seededWorkspace();
    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    const leg = brief.legs.find((entry) => entry.gateId === "operator-owned")!;
    expect(leg.nodes).toHaveLength(1);
    expect(leg.nodes[0]).toMatchObject({ kind: "gap", reason: "operator_owned" });
    expect(brief.totals.gaps).toBeGreaterThan(0);
    expect(brief.warnings.join(" ")).toMatch(/no startable planned work/);
  });

  it("reports a gate whose Action no plan carries", () => {
    const workspace = seededWorkspace();
    appendGate(workspace, ["  - id: stale", "    title: Tracks nothing", "    action: plan/gone#missing"]);

    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    const leg = brief.legs.find((entry) => entry.gateId === "stale")!;
    expect(leg.nodes[0]).toMatchObject({ kind: "gap", reason: "missing_action" });
  });

  it("says so when a planned step's next move is still undecided", () => {
    const workspace = seededWorkspace({ gateClarification: "question_open" });
    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    const leg = brief.legs.find((entry) => entry.gateId === "tracked")!;
    expect(leg.nodes.some((node) => node.kind === "gap" && node.reason === "undefined_next_move")).toBe(true);
  });

  it("quotes the Action's own recorded question rather than a generic message", () => {
    // An operator once answered an unrelated Decision that happened to touch
    // the same Action and read the vague "not decided yet" wording as proof
    // their answer had cleared it. Quoting the real question is the fix: it
    // cannot be mistaken for a different question that was actually answered.
    const workspace = seededWorkspace({
      gateClarification: "question_open",
      gateOpenQuestion: "Does the whole approach in docs/design.md deserve ratification before code is written?"
    });
    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    const leg = brief.legs.find((entry) => entry.gateId === "tracked")!;
    const gap = leg.nodes.find((node) => node.kind === "gap" && node.reason === "undefined_next_move");
    expect(gap).toMatchObject({
      detail: 'Blocked on one open question: "Does the whole approach in docs/design.md deserve ratification before code is written?"'
    });
  });

  it("has no path at all without a declared target", () => {
    const workspace = initializedWorkspace();
    const brief = withDatabase(workspace, (db) => computePathBrief(db, null, []));
    expect(brief.target.declared).toBe(false);
    expect(brief.legs).toEqual([]);
    expect(brief.warnings[0]).toMatch(/no declared finish line/);
  });
});

describe("the legacy `dependencies` spelling", () => {
  it("is read as ordering when every entry names an Action in the plan", () => {
    const plan = parsePlan(["    dependencies:", "      - first"]);
    expect(plan.actions.find((action) => action.id === "second")?.dependsOn).toEqual(["first"]);
  });

  it("is ignored when it names components rather than Actions, without inventing an edge", () => {
    // The point of ignoring it: a component path must not become a dangling
    // Action reference the operator is then asked to repair.
    const plan = parsePlan(["    dependencies:", "      - packages/site-assembler"]);
    expect(plan.actions.find((action) => action.id === "second")?.dependsOn).toEqual([]);
  });

  it("never overrides an explicit depends_on", () => {
    const plan = parsePlan(["    depends_on: []", "    dependencies:", "      - first"]);
    expect(plan.actions.find((action) => action.id === "second")?.dependsOn).toEqual([]);
  });
});

function steps(nodes: Array<{ kind: string }>): PathStep[] {
  return nodes.filter((node): node is PathStep => node.kind === "action");
}

/** Parse one plan and fail loudly if the fixture itself is invalid. */
function parsePlan(secondActionExtra: string[]): { actions: Array<{ id: string; dependsOn: string[] }> } {
  const result = parseDoc("docs/plans/legacy.md", "/tmp/legacy.md", planSource(secondActionExtra));
  expect(result.errors).toEqual([]);
  return result.doc as unknown as { actions: Array<{ id: string; dependsOn: string[] }> };
}

function planSource(secondActionExtra: string[]): string {
  return [
    "---",
    "arcadia: v1",
    "type: plan",
    "slug: legacy",
    "project: the-thing",
    "status: active",
    "milestone: A milestone",
    "token_impact: small",
    "token_budget: Deterministic parsing only.",
    "recommended_model: gpt-5.6-terra",
    "updated: 2026-08-25",
    "actions:",
    "  - id: first",
    "    title: First",
    "    status: done",
    "    responsibility: codex",
    "    next_action: Do the first thing.",
    "    clarification: clarified",
    "    acceptance_criteria:",
    "      - It is done.",
    "  - id: second",
    "    title: Second",
    "    status: open",
    "    responsibility: codex",
    "    next_action: Do the second thing.",
    "    clarification: clarified",
    "    acceptance_criteria:",
    "      - It is done.",
    ...secondActionExtra,
    "---",
    "",
    "# Legacy",
    ""
  ].join("\n");
}

function seededWorkspace(options: { gateClarification?: string; gateOpenQuestion?: string } = {}): string {
  const workspace = initializedWorkspace();
  writeFileSync(
    northStarPath(workspace),
    [
      "---",
      "arcadia: v1",
      "type: north_star",
      "target: Launch the thing",
      "project: the-thing",
      "why: Nothing else is real until this happens.",
      "looks_like: A stranger uses it and says something about it.",
      "gates:",
      "  - id: tracked",
      "    title: The tracked gate",
      "    action: plan/some-plan#gate-action",
      "  - id: operator-owned",
      "    title: Someone agrees to be the pilot",
      "    status: open",
      "---",
      "",
      "# North Star",
      ""
    ].join("\n"),
    "utf8"
  );

  withDatabase(workspace, (db) => {
    const { project } = createProjectWithInitialWork(db, {
      name: "The Thing",
      mission: "Prove the thing works.",
      status: "active",
      currentMilestone: "First milestone",
      nextAction: "Do the first thing.",
      workClassification: "codex"
    });

    seedAction(db, project.id, { title: "First", docRef: "plan/some-plan#first", status: "done" });
    seedAction(db, project.id, { title: "Second", docRef: "plan/some-plan#second", status: "done" });
    seedAction(db, project.id, {
      title: "The gate action",
      docRef: "plan/some-plan#gate-action",
      status: "open",
      clarification: options.gateClarification ?? "clarified",
      openQuestion: options.gateOpenQuestion
    });

    const gate = getWorkItemByDocRef(db, "plan/some-plan#gate-action")!;
    const first = getWorkItemByDocRef(db, "plan/some-plan#first")!;
    const second = getWorkItemByDocRef(db, "plan/some-plan#second")!;
    replaceDocumentWorkItemDependencies(db, gate.id, "plan/some-plan#gate-action", [first.id, second.id]);
    replaceDocumentWorkItemDependencies(db, second.id, "plan/some-plan#second", [first.id]);
  });

  return workspace;
}

function appendGate(workspace: string, lines: string[]): void {
  const file = northStarPath(workspace);
  const source = require("node:fs").readFileSync(file, "utf8") as string;
  const marker = "---\n\n# North Star";
  writeFileSync(file, source.replace(marker, `${lines.join("\n")}\n${marker}`), "utf8");
}

function seedAction(
  db: Parameters<typeof createWorkItemWithOptionalArtifact>[0],
  projectId: string,
  input: { title: string; docRef: string; status: string; clarification?: string; openQuestion?: string }
): void {
  const { workItem } = createWorkItemWithOptionalArtifact(db, {
    projectId,
    title: input.title,
    rawInput: input.title,
    queue: "work_queue",
    workClassification: "codex",
    nextAction: `Do: ${input.title}`
  });
  setWorkItemDocRef(db, workItem.id, input.docRef);
  db.prepare("UPDATE work_items SET status = ?, clarification_status = ?, open_question = ? WHERE id = ?").run(
    input.status,
    input.clarification ?? "clarified",
    input.openQuestion ?? null,
    workItem.id
  );
}

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-path-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}
