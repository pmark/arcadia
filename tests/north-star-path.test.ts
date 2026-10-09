import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { createSuccess } from "../src/cli/response.js";
import { renderPathSuccess } from "../src/commands/path.js";
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

describe("a gate whose Action was split", () => {
  it("shows an open remainder as a step that counts as remaining, and holds the gate open", () => {
    const workspace = splitWorkspace({ remainderStatus: "open" });
    const { leg, brief } = splitLeg(workspace);

    // The remainder depends on the Action it was split from, so the walk must
    // not loop back through that edge.
    expect(steps(leg.nodes).map((step) => step.title)).toEqual(["Narrowed proof", "Remainder one", "Remainder two"]);
    expect(steps(leg.nodes).map((step) => step.state)).toEqual(["done", "done", "planned"]);
    expect(leg.gateStatus).toBe("in_progress");
    expect(leg.done).toBe(2);
    expect(leg.remaining).toBe(1);
    expect(brief.totals.gatesDone).toBe(0);
    expect(brief.totals.remaining).toBe(1);
  });

  it("reads done with every step done once the whole split chain is done", () => {
    const workspace = splitWorkspace({ remainderStatus: "done" });
    const { leg, brief } = splitLeg(workspace);

    expect(steps(leg.nodes).map((step) => step.state)).toEqual(["done", "done", "done"]);
    expect(leg.gateStatus).toBe("done");
    expect(leg.remaining).toBe(0);
    expect(brief.totals.gatesDone).toBe(1);
  });

  it("terminates on a split cycle", () => {
    const workspace = splitWorkspace({ remainderStatus: "done", cycle: true });
    const { leg } = splitLeg(workspace);
    expect(steps(leg.nodes)).toHaveLength(3);
  });

  it("names a remainder no plan carries as a gap rather than dropping it", () => {
    const workspace = splitWorkspace({ remainderStatus: "done", ghostRemainder: true });
    const { leg } = splitLeg(workspace);

    expect(leg.gateStatus).toBe("in_progress");
    expect(leg.nodes.some((node) => node.kind === "gap" && node.reason === "missing_action")).toBe(true);
  });
});

describe("each step's reason and link", () => {
  it("uses the Action's declared why and says it was declared", () => {
    const workspace = seededWorkspace({ secondWhy: "The pilot cannot start until this is real." });
    const leg = trackedLeg(workspace);
    const second = steps(leg.nodes).find((step) => step.title === "Second")!;

    expect(second.reason).toBe("The pilot cannot start until this is real.");
    expect(second.reasonSource).toBe("declared");
  });

  it("derives what the step unblocks, or the gate it completes, when no why is declared", () => {
    const workspace = seededWorkspace();
    const leg = trackedLeg(workspace);
    const byTitle = Object.fromEntries(steps(leg.nodes).map((step) => [step.title, step]));

    expect(byTitle["First"]).toMatchObject({ reason: "Unblocks The gate action", reasonSource: "derived" });
    expect(byTitle["Second"]).toMatchObject({ reason: "Unblocks The gate action", reasonSource: "derived" });
    expect(byTitle["The gate action"]).toMatchObject({ reason: "Completes gate: The tracked gate", reasonSource: "derived" });
  });

  it("collapses a multi-line why to one line and truncates a long one to 300 characters", () => {
    const multi = seededWorkspace({ secondWhy: "First line of a block scalar.\n\n  Second line,\n  third line.\n" });
    const second = steps(trackedLeg(multi).nodes).find((step) => step.title === "Second")!;
    expect(second.reason).toBe("First line of a block scalar. Second line, third line.");
    expect(second.reasonSource).toBe("declared");

    const long = seededWorkspace({ secondWhy: `${"word ".repeat(100)}end` });
    const truncated = steps(trackedLeg(long).nodes).find((step) => step.title === "Second")!.reason;
    expect(truncated.length).toBeLessThanOrEqual(300);
    expect(truncated.endsWith("\u2026")).toBe(true);
    expect(truncated).not.toMatch(/\n/);
  });

  it("treats a blank why as undeclared rather than showing an empty reason", () => {
    const workspace = seededWorkspace({ secondWhy: "   " });
    const second = steps(trackedLeg(workspace).nodes).find((step) => step.title === "Second")!;
    expect(second.reasonSource).toBe("derived");
    expect(second.reason).not.toBe("");
  });

  it("derives a split remainder's reason from the Action it continues", () => {
    const { leg } = splitLeg(splitWorkspace({ remainderStatus: "open" }));
    const byTitle = Object.fromEntries(steps(leg.nodes).map((step) => [step.title, step]));

    expect(byTitle["Narrowed proof"]).toMatchObject({ reason: "Completes gate: The proof", reasonSource: "derived" });
    expect(byTitle["Remainder one"]).toMatchObject({ reason: "Remainder of Narrowed proof", reasonSource: "derived" });
    expect(byTitle["Remainder two"]).toMatchObject({ reason: "Remainder of Remainder one", reasonSource: "derived" });
  });

  it("gives every step the planned work item it links to", () => {
    const workspace = seededWorkspace();
    const found = steps(trackedLeg(workspace).nodes);

    expect(found.map((step) => step.docRef)).toEqual([
      "plan/some-plan#first",
      "plan/some-plan#second",
      "plan/some-plan#gate-action"
    ]);
    for (const step of found) expect(step.workItemId).toBeTruthy();
  });

  it("gives a gap whose Action no plan carries nothing to link to, and says so", () => {
    const workspace = seededWorkspace();
    appendGate(workspace, ["  - id: stale", "    title: Tracks nothing", "    action: plan/gone#missing"]);
    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    const gap = brief.legs.find((entry) => entry.gateId === "stale")!.nodes[0];
    expect(gap).toMatchObject({ kind: "gap", reason: "missing_action", missingRef: "plan/gone#missing" });
    expect(gap).not.toHaveProperty("workItemId");
    expect((gap as { detail: string }).detail).toMatch(/no Action to open/);
  });

  it("prints the reason and the plan reference under each step in `arcadia path`", () => {
    const workspace = seededWorkspace({ secondWhy: "The pilot cannot start until this is real." });
    appendGate(workspace, ["  - id: stale", "    title: Tracks nothing", "    action: plan/gone#missing"]);
    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    const text = renderPathSuccess(createSuccess({ command: "path", workspace, data: brief })).join("\n");
    expect(text).toContain("why: The pilot cannot start until this is real.");
    expect(text).toContain("why (derived): Unblocks The gate action");
    expect(text).toContain("why (derived): Completes gate: The tracked gate");
    expect(text).toContain("plan/some-plan#first");
    expect(text).toContain("plan/some-plan#gate-action");
    expect(text).toContain("no Action to open");
  });
});

describe("the target's reason", () => {
  it("is carried on the path brief", () => {
    const workspace = seededWorkspace();
    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });
    expect(brief.target.why).toBe("Nothing else is real until this happens.");
  });

  it("renders in `arcadia path` as a labelled target with its reason", () => {
    const workspace = seededWorkspace();
    const brief = withDatabase(workspace, (db) => {
      const northStar = loadNorthStar(workspace);
      return computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    });

    const lines = renderPathSuccess(createSuccess({ command: "path", workspace, data: brief }));
    expect(lines.slice(0, 3)).toEqual([
      "Target: Launch the thing",
      "Why: Nothing else is real until this happens.",
      "Done when: A stranger uses it and says something about it."
    ]);
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

function trackedLeg(workspace: string) {
  return withDatabase(workspace, (db) => {
    const northStar = loadNorthStar(workspace);
    const brief = computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    return brief.legs.find((entry) => entry.gateId === "tracked")!;
  });
}

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

function seededWorkspace(options: { gateClarification?: string; gateOpenQuestion?: string; secondWhy?: string } = {}): string {
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
      workClassification: "agent"
    });

    seedAction(db, project.id, { title: "First", docRef: "plan/some-plan#first", status: "done" });
    seedAction(db, project.id, {
      title: "Second",
      docRef: "plan/some-plan#second",
      status: "done",
      why: options.secondWhy
    });
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

/**
 * A gate tracking `plan/split#proof`, which was narrowed to a finished slice
 * (`done`) and split into `remainder-one` then `remainder-two`. Each remainder
 * depends on the Action it was split from, as settlement writes them.
 */
function splitWorkspace(options: { remainderStatus: "open" | "done"; cycle?: boolean; ghostRemainder?: boolean }): string {
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
      "looks_like: A stranger uses it.",
      "gates:",
      "  - id: proof",
      "    title: The proof",
      "    action: plan/split#proof",
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
      workClassification: "agent"
    });

    seedAction(db, project.id, {
      title: "Narrowed proof",
      docRef: "plan/split#proof",
      status: "done",
      splitInto: options.ghostRemainder ? ["remainder-one", "ghost"] : ["remainder-one"]
    });
    seedAction(db, project.id, {
      title: "Remainder one",
      docRef: "plan/split#remainder-one",
      status: "done",
      splitInto: ["remainder-two"]
    });
    seedAction(db, project.id, {
      title: "Remainder two",
      docRef: "plan/split#remainder-two",
      status: options.remainderStatus,
      splitInto: options.cycle ? ["proof"] : undefined
    });

    const proof = getWorkItemByDocRef(db, "plan/split#proof")!;
    const one = getWorkItemByDocRef(db, "plan/split#remainder-one")!;
    const two = getWorkItemByDocRef(db, "plan/split#remainder-two")!;
    replaceDocumentWorkItemDependencies(db, one.id, "plan/split#remainder-one", [proof.id]);
    replaceDocumentWorkItemDependencies(db, two.id, "plan/split#remainder-two", [proof.id]);
  });

  return workspace;
}

function splitLeg(workspace: string) {
  return withDatabase(workspace, (db) => {
    const northStar = loadNorthStar(workspace);
    const brief = computePathBrief(db, northStar, computeNowBrief(db, northStar, {}).gates);
    return { brief, leg: brief.legs.find((entry) => entry.gateId === "proof")! };
  });
}

function appendGate(workspace: string, lines: string[]): void {
  const file = northStarPath(workspace);
  const source = readFileSync(file, "utf8");
  const marker = "---\n\n# North Star";
  writeFileSync(file, source.replace(marker, `${lines.join("\n")}\n${marker}`), "utf8");
}

function seedAction(
  db: Parameters<typeof createWorkItemWithOptionalArtifact>[0],
  projectId: string,
  input: {
    title: string;
    docRef: string;
    status: string;
    clarification?: string;
    openQuestion?: string;
    splitInto?: string[];
    why?: string;
  }
): void {
  const { workItem } = createWorkItemWithOptionalArtifact(db, {
    projectId,
    title: input.title,
    rawInput: input.title,
    queue: "work_queue",
    workClassification: "agent",
    nextAction: `Do: ${input.title}`
  });
  setWorkItemDocRef(db, workItem.id, input.docRef);
  db.prepare("UPDATE work_items SET status = ?, clarification_status = ?, open_question = ? WHERE id = ?").run(
    input.status,
    input.clarification ?? "clarified",
    input.openQuestion ?? null,
    workItem.id
  );
  if (input.splitInto) {
    db.prepare("UPDATE work_items SET split_into_json = ? WHERE id = ?").run(JSON.stringify(input.splitInto), workItem.id);
  }
  if (input.why !== undefined) {
    db.prepare("UPDATE work_items SET why = ? WHERE id = ?").run(input.why, workItem.id);
  }
}

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-path-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}
