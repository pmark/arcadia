import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  createReviewItem,
  createWorkItemWithOptionalArtifact,
  setWorkItemDocRef
} from "../src/db/repositories.js";
import { computeNowBrief } from "../src/northStar/compute.js";
import {
  loadNorthStar,
  NorthStarParseError,
  northStarPath,
  setDeclaredGateStatus
} from "../src/northStar/document.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("NORTH_STAR.md", () => {
  it("returns null when no target has been declared", () => {
    expect(loadNorthStar(initializedWorkspace())).toBeNull();
  });

  it("parses the target, the owning project, and both kinds of gate", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, [
      "target: Launch the thing",
      "project: the-thing",
      "why: Nothing else is real until this happens.",
      "looks_like: A stranger uses it and says something about it.",
      "gates:",
      "  - id: tracked",
      "    title: The tracked gate",
      "    action: plan/some-plan#some-action",
      "  - id: operator-owned",
      "    title: Someone agrees to be the pilot",
      "    status: open"
    ]);

    const northStar = loadNorthStar(workspace);
    expect(northStar?.target).toBe("Launch the thing");
    expect(northStar?.projectSlug).toBe("the-thing");
    expect(northStar?.gates).toHaveLength(2);
    expect(northStar?.gates[0].actionRef).toBe("plan/some-plan#some-action");
    expect(northStar?.gates[1].declaredStatus).toBe("open");
  });

  it("refuses a document with no target, a duplicate gate, or an unknown status", () => {
    const missingTarget = initializedWorkspace();
    writeNorthStar(missingTarget, ["project: the-thing"]);
    expect(() => loadNorthStar(missingTarget)).toThrow(NorthStarParseError);

    const duplicate = initializedWorkspace();
    writeNorthStar(duplicate, [
      "target: Launch",
      "project: the-thing",
      "gates:",
      "  - id: same",
      "    title: One",
      "  - id: same",
      "    title: Two"
    ]);
    expect(() => loadNorthStar(duplicate)).toThrow(/Duplicate gate/);

    const badStatus = initializedWorkspace();
    writeNorthStar(badStatus, [
      "target: Launch",
      "project: the-thing",
      "gates:",
      "  - id: one",
      "    title: One",
      "    status: nearly"
    ]);
    expect(() => loadNorthStar(badStatus)).toThrow(/expected one of/);
  });
});

describe("marking a gate", () => {
  it("sets the declared status of an operator-owned gate", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    const change = setDeclaredGateStatus(workspace, "operator-owned", "done");

    expect(change.changed).toBe(true);
    expect(change.previous).toBe("open");
    expect(change.title).toBe("Someone agrees to be the pilot");
    expect(loadNorthStar(workspace)?.gates.find((gate) => gate.id === "operator-owned")?.declaredStatus).toBe("done");
  });

  it("adds a status line to a gate that never had one", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, [
      "target: Launch",
      "project: the-thing",
      "gates:",
      "  - id: unstated",
      "    title: A gate with no declared status"
    ]);

    setDeclaredGateStatus(workspace, "unstated", "done");

    expect(loadNorthStar(workspace)?.gates[0].declaredStatus).toBe("done");
  });

  it("refuses a gate whose status comes from an Action", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    expect(() => setDeclaredGateStatus(workspace, "done-one", "done")).toThrow(/comes from that Action/);
    expect(readFileSync(northStarPath(workspace), "utf8")).toContain("action: plan/p#done-one");
  });

  it("refuses an unknown gate and names the ones that exist", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    let details: unknown = null;
    try {
      setDeclaredGateStatus(workspace, "typo", "done");
    } catch (error) {
      details = (error as { details?: unknown }).details;
    }

    expect(details).toMatchObject({ known: ["done-one", "open-one", "operator-owned"] });
  });

  it("reports no change rather than rewriting when the status already matches", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);
    const before = readFileSync(northStarPath(workspace), "utf8");

    const change = setDeclaredGateStatus(workspace, "operator-owned", "open");

    expect(change.changed).toBe(false);
    expect(readFileSync(northStarPath(workspace), "utf8")).toBe(before);
  });

  it("leaves the rest of the document byte-for-byte alone", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);
    const before = readFileSync(northStarPath(workspace), "utf8");

    setDeclaredGateStatus(workspace, "operator-owned", "done");
    const after = readFileSync(northStarPath(workspace), "utf8");

    const changedLines = after
      .split("\n")
      .filter((line, index) => line !== before.split("\n")[index]);
    expect(changedLines).toEqual(["    status: done"]);
  });

  it("reopens a gate that was marked done", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    setDeclaredGateStatus(workspace, "operator-owned", "done");
    const change = setDeclaredGateStatus(workspace, "operator-owned", "open");

    expect(change.previous).toBe("done");
    expect(change.next).toBe("open");
  });
});

describe("the Now brief", () => {
  it("derives gate status from the tracked Action rather than the document", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    const brief = withDatabase(workspace, (db) => {
      const { project } = seedProject(db);
      seedAction(db, project.id, {
        title: "Ship the tracked gate",
        docRef: "plan/p#done-one",
        status: "done"
      });
      seedAction(db, project.id, {
        title: "Ship the other gate",
        docRef: "plan/p#open-one",
        status: "open",
        clarification: "clarified",
        nextAction: "Write the thing."
      });
      return computeNowBrief(db, loadNorthStar(workspace));
    });

    expect(brief.distance.total).toBe(3);
    expect(brief.distance.done).toBe(1);
    expect(brief.distance.remaining).toBe(2);
    expect(brief.gates.find((gate) => gate.id === "done-one")?.derived).toBe(true);
  });

  it("prefers work already underway over work not yet started", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    const brief = withDatabase(workspace, (db) => {
      const { project } = seedProject(db);
      seedAction(db, project.id, {
        title: "Not started",
        docRef: "plan/p#done-one",
        status: "open",
        clarification: "clarified",
        nextAction: "Start the unstarted thing."
      });
      seedAction(db, project.id, {
        title: "Underway",
        docRef: "plan/p#open-one",
        status: "in_progress",
        clarification: "clarified",
        nextAction: "Finish the underway thing."
      });
      return computeNowBrief(db, loadNorthStar(workspace));
    });

    expect(brief.theOneThing.doThis).toBe("Finish the underway thing.");
    expect(brief.theOneThing.unlocks).toContain("Already underway");
  });

  it("falls back to an owed Decision when no gate Action is ready", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    const brief = withDatabase(workspace, (db) => {
      const { project } = seedProject(db);
      createReviewItem(db, decisionInput(project.id, "Which way should the intake link work?"));
      return computeNowBrief(db, loadNorthStar(workspace));
    });

    expect(brief.theOneThing.kind).toBe("decision");
    expect(brief.theOneThing.doThis).toContain("Which way should the intake link work?");
  });

  it("keeps the fifteen-minute option on the target and distinct from the main move", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    const brief = withDatabase(workspace, (db) => {
      const { project } = seedProject(db);
      for (const question of ["First question", "Second question"]) {
        createReviewItem(db, decisionInput(project.id, question));
      }
      return computeNowBrief(db, loadNorthStar(workspace));
    });

    expect(brief.fifteenMinutes).not.toBeNull();
    expect(brief.fifteenMinutes?.id).not.toBe(brief.theOneThing.id);
    expect(brief.fifteenMinutes?.onTarget).toBe(true);
  });

  it("tells the operator to declare a target before measuring anything", () => {
    const workspace = initializedWorkspace();
    const brief = withDatabase(workspace, (db) => computeNowBrief(db, null));

    expect(brief.target.declared).toBe(false);
    expect(brief.theOneThing.kind).toBe("declare_target");
    expect(brief.distance.total).toBe(0);
  });

  it("warns rather than silently dropping a gate whose Action does not exist", () => {
    const workspace = initializedWorkspace();
    writeNorthStar(workspace, GATE_DOC);

    const brief = withDatabase(workspace, (db) => {
      seedProject(db);
      return computeNowBrief(db, loadNorthStar(workspace));
    });

    expect(brief.gates).toHaveLength(3);
    expect(brief.warnings.join(" ")).toContain("plan/p#done-one");
  });
});

const GATE_DOC = [
  "target: Launch the thing",
  "project: the-thing",
  "looks_like: A stranger uses it.",
  "gates:",
  "  - id: done-one",
  "    title: First gate",
  "    action: plan/p#done-one",
  "  - id: open-one",
  "    title: Second gate",
  "    action: plan/p#open-one",
  "  - id: operator-owned",
  "    title: Someone agrees to be the pilot",
  "    status: open"
];

function decisionInput(projectId: string, decisionNeeded: string) {
  return {
    projectId,
    decisionNeeded,
    recommendation: "Pick one.",
    sourceInput: decisionNeeded,
    proposedAction: "Record the operator's answer.",
    resolvedIntent: decisionNeeded,
    confidenceLabel: "medium",
    confidence: 0.5
  };
}

function writeNorthStar(workspace: string, frontmatterLines: string[]): void {
  writeFileSync(
    northStarPath(workspace),
    ["---", "arcadia: v1", "type: north_star", ...frontmatterLines, "---", "", "# North Star", ""].join("\n"),
    "utf8"
  );
}

function seedProject(db: Parameters<typeof createProjectWithInitialWork>[0]) {
  return createProjectWithInitialWork(db, {
    name: "The Thing",
    mission: "Prove the thing works.",
    status: "active",
    currentMilestone: "First milestone",
    nextAction: "Do the first thing.",
    workClassification: "codex"
  });
}

function seedAction(
  db: Parameters<typeof createWorkItemWithOptionalArtifact>[0],
  projectId: string,
  input: { title: string; docRef: string; status: string; clarification?: string; nextAction?: string }
): void {
  const { workItem } = createWorkItemWithOptionalArtifact(db, {
    projectId,
    title: input.title,
    rawInput: input.title,
    queue: "work_queue",
    workClassification: "codex",
    nextAction: input.nextAction ?? input.title
  });
  setWorkItemDocRef(db, workItem.id, input.docRef);
  db.prepare("UPDATE work_items SET status = ?, clarification_status = ? WHERE id = ?").run(
    input.status,
    input.clarification ?? null,
    workItem.id
  );
}

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-north-star-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}
