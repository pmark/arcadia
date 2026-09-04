import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderDocketSuccess, runDocketCommand } from "../src/commands/docket.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * A repository and nothing else — no workspace directory, no database, no
 * Arcadia checkout beside it. This is a cloud container: the environment where
 * `next` cannot run and an agent most needs to ask what to work on.
 */
function loneRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-docket-"));
  temporary.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  return root;
}

const PROJECT = `---
arcadia: v1
type: project
slug: lone
name: Lone
status: active
goal: Prove a repository can answer for itself.
outcome: The docket resolves with no workspace present.
milestone: Orientation works in a fresh clone
active_plan: only-plan
updated: 2026-08-16
---

# Lone
`;

const PLAN = `---
arcadia: v1
type: plan
slug: only-plan
project: lone
status: active
milestone: Orientation works in a fresh clone
current_action: do-the-thing
token_impact: small
token_budget: "Deterministic."
recommended_model: gpt-5.6-terra
updated: 2026-08-16
actions:
  - id: do-the-thing
    title: Do the thing
    status: open
    responsibility: codex
    next_action: Write the thing to the file.
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - The thing exists.
    depends_on: []
    references: []
---

# Only plan
`;

describe("arcadia docket", () => {
  it("resolves the pointer from a repository with no workspace anywhere", () => {
    const root = loneRepo({ "PROJECT.md": PROJECT, "docs/plans/only-plan.md": PLAN });

    const response = runDocketCommand({ repo: root });

    expect(response.ok).toBe(true);
    expect(response.data.context?.activePlan).toBe("only-plan");
    expect(response.data.context?.action.id).toBe("do-the-thing");
    expect(response.data.dispatchable).toBe(true);
    // The whole point: nothing was read outside the repository.
    expect(response.workspace).toBeUndefined();
  });

  it("carries the executability fields an agent would otherwise hand-read", () => {
    const root = loneRepo({ "PROJECT.md": PROJECT, "docs/plans/only-plan.md": PLAN });

    const lines = renderDocketSuccess(runDocketCommand({ repo: root })).join("\n");

    // These are exactly the fields the first PPN session said it could not
    // confirm from PROJECT.md alone.
    expect(lines).toContain("Responsibility: agent");
    expect(lines).toContain("Clarification: clarified");
    expect(lines).toContain("The thing exists.");
    expect(lines).toContain("Dispatchable: a coding agent may begin this action now.");
  });

  it("says it is reporting one repository rather than the portfolio", () => {
    const root = loneRepo({ "PROJECT.md": PROJECT, "docs/plans/only-plan.md": PLAN });

    const lines = renderDocketSuccess(runDocketCommand({ repo: root })).join("\n");

    expect(lines).toContain("no workspace, no portfolio context");
  });

  it("reports a repair instead of throwing when the repository has no PROJECT.md", () => {
    const root = loneRepo({ "README.md": "# nothing managed here\n" });

    const response = runDocketCommand({ repo: root });

    expect(response.data.context).toBeNull();
    expect(response.data.dispatchable).toBe(false);
    expect(response.data.blockers.map((blocker) => blocker.relativePath)).toContain("PROJECT.md");
    expect(renderDocketSuccess(response).join("\n")).toContain(
      "Repairing the control documentation is the immediate work."
    );
  });

  it("refuses a done action rather than reporting it as work", () => {
    const root = loneRepo({
      "PROJECT.md": PROJECT,
      "docs/plans/only-plan.md": PLAN.replace("status: open", "status: done")
    });

    const response = runDocketCommand({ repo: root });

    expect(response.data.dispatchable).toBe(false);
    expect(response.data.blockers.map((blocker) => blocker.field)).toContain("current_action");
  });
});
